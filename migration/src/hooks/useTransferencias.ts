import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { reajustarObjetivosTrasCierre } from '../lib/objetivos';
import { planTrasladoCosto } from '../engine/trasladoCosto';

export interface Transferencia {
  id: string;
  portfolio_origen_id: string;
  portfolio_destino_id: string;
  posicion_origen_id: string;
  posicion_destino_id: string | null;
  ticker: string;
  tipo: string;
  cantidad: number;
  precio_compra: number;
  fecha_compra: string | null;
  nota: string | null;
  created_at: string;
}

// Historial de transferencias donde participó CUALQUIERA de los portfolios del usuario (como
// origen o como destino) — no se filtra por uno solo, porque una transferencia le importa a los
// dos lados. RLS (transferencias_select) ya solo deja ver las propias.
export function useTransferencias() {
  return useQuery({
    queryKey: ['transferencias'],
    queryFn: async (): Promise<Transferencia[]> => {
      const { data, error } = await supabase.from('transferencias').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Todo el movimiento (restar en origen + crear en destino + loguear) pasa por una única función
// atómica en la base — ver 0024/0048/0049. No es una venta: no realiza P&L (en el origen queda un
// movimiento 'ajuste', en el destino una 'compra' al costo original), pero SÍ registra un flujo en
// aportes (retiro/inicial) para que el rendimiento por año no la cuente como ganancia/pérdida de
// mercado. `valorMercado` (cantidad × cotización de hoy) hace que ese flujo sea a mercado; sin
// cotización, la función cae al costo.
// `traslado`: llevar también el costo de las órdenes de compra de la posición (comisiones), en proporción a la cantidad transferida. Ver
// engine/trasladoCosto.ts: el origen queda sin ese costo (sus órdenes bajan) y el destino lo asume (registro de costo + aporte; el origen
// registra el retiro por el mismo monto).
export interface TrasladoCosto { ticker: string; cantidadPosicion: number; origenNombre: string; destinoNombre: string }

export function useTransferirPosicion() {
  const qc = useQueryClient();
  return async (posicionId: string, portfolioDestino: string, cantidad: number, nota?: string, valorMercado?: number | null, traslado?: TrasladoCosto): Promise<void> => {
    // Origen antes de transferir: si se mueve TODO, la fila queda en 0 con su objetivo y hay que sacarla del plan.
    const { data: origen } = await supabase.from('posiciones').select('portfolio_id, cantidad').eq('id', posicionId).maybeSingle();
    const { error } = await supabase.rpc('transferir_posicion', {
      p_posicion_id: posicionId, p_portfolio_destino: portfolioDestino, p_cantidad: cantidad, p_nota: nota || null,
      p_valor_mercado: valorMercado != null && valorMercado > 0 ? valorMercado : null,
    });
    if (error) throw error;
    // Costo de las órdenes que viaja con la posición (después de la transferencia: si ella falla, no se mueve nada).
    let avisoCosto: string | null = null;
    if (traslado && origen) {
      try {
        const { data: ords, error: oErr } = await supabase.from('ordenes_ejecutadas')
          .select('id, ticker, estado, origen, lado, comision_usd, comision_ars, mep').eq('portfolio_id', origen.portfolio_id);
        if (oErr) throw oErr;
        const plan = planTrasladoCosto(ords ?? [], traslado.ticker, cantidad, traslado.cantidadPosicion);
        if (plan.totalUsd > 0 || plan.arsSinMep > 0) {
          const hoy = new Date().toISOString().slice(0, 10);
          const pct = `${Math.round(plan.fraccion * 100)} % de la posición`;
          const { error: insErr } = await supabase.from('ordenes_ejecutadas').insert({
            portfolio_id: portfolioDestino, fecha: hoy, ticker: traslado.ticker, broker: 'Traslado', nominales: cantidad, precio_ejecutado: null, monto_usd: 0,
            comision_usd: plan.totalUsd > 0 ? plan.totalUsd : null, comision_ars: plan.arsSinMep > 0 ? plan.arsSinMep : null, mep: null,
            estado: 'terminada', origen: 'transferida', lado: 'compra',
            nota: `Costo de las órdenes trasladado desde ${traslado.origenNombre} (${pct}). Solo registra la comisión: la compra original queda en el origen.`,
          });
          if (insErr) throw insErr;
          for (const u of plan.origen) {
            const { error: upErr } = await supabase.from('ordenes_ejecutadas').update({ comision_usd: u.comision_usd, comision_ars: u.comision_ars }).eq('id', u.id);
            if (upErr) throw upErr;
          }
          if (plan.totalUsd > 0) {
            const { error: apErr } = await supabase.from('aportes').insert([
              { portfolio_id: origen.portfolio_id, fecha: hoy, monto: plan.totalUsd, tipo: 'retiro', descripcion: `Costo de las órdenes de ${traslado.ticker} trasladado a ${traslado.destinoNombre} (${pct}); no es un retiro de efectivo real.` },
              { portfolio_id: portfolioDestino, fecha: hoy, monto: plan.totalUsd, tipo: 'inicial', descripcion: `Costo de las órdenes de ${traslado.ticker} trasladado desde ${traslado.origenNombre} (${pct}); no es capital externo real.` },
            ]);
            if (apErr) throw apErr;
          }
        }
      } catch (e) {
        avisoCosto = e instanceof Error ? e.message : String(e);
      }
    }
    let avisoObjetivos: string | null = null;
    if (origen && cantidad >= Number(origen.cantidad) - 1e-9) {
      try { await reajustarObjetivosTrasCierre(origen.portfolio_id, posicionId); }
      catch (e) { avisoObjetivos = e instanceof Error ? e.message : String(e); }
    }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['posiciones'] }),
      qc.invalidateQueries({ queryKey: ['transferencias'] }),
      qc.invalidateQueries({ queryKey: ['movimientos'] }),
      qc.invalidateQueries({ queryKey: ['aportes'] }),
      qc.invalidateQueries({ queryKey: ['posicion_brokers'] }),
      qc.invalidateQueries({ queryKey: ['ordenes'] }),
      qc.invalidateQueries({ queryKey: ['ordenes_ejecutadas'] }),
    ]);
    if (avisoCosto) throw new Error(`Transferencia hecha, pero el traslado del costo de las órdenes quedó incompleto (revisá Órdenes y Aportes): ${avisoCosto}`);
    if (avisoObjetivos) throw new Error(`Transferencia hecha, pero no se pudieron reajustar los objetivos del portfolio de origen: ${avisoObjetivos}`);
  };
}
