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
// registra el retiro por el mismo monto). Todo en una transacción: transferir_posicion_con_costo (0058).
export interface TrasladoCosto { ticker: string; cantidadPosicion: number; origenNombre: string; destinoNombre: string }

export function useTransferirPosicion() {
  const qc = useQueryClient();
  return async (posicionId: string, portfolioDestino: string, cantidad: number, nota?: string, valorMercado?: number | null, traslado?: TrasladoCosto): Promise<void> => {
    // Origen antes de transferir: si se mueve TODO, la fila queda en 0 con su objetivo y hay que sacarla del plan.
    const { data: origen } = await supabase.from('posiciones').select('portfolio_id, cantidad').eq('id', posicionId).maybeSingle();
    // Costo de las órdenes que viaja con la posición: el plan se calcula ACÁ (engine/trasladoCosto.ts, con las órdenes de hoy) y la función de la base
    // lo aplica junto con la transferencia en UNA transacción (0058): o se mueve todo —posición, flujos, órdenes y comisiones— o no se mueve nada.
    let plan: ReturnType<typeof planTrasladoCosto> | null = null;
    if (traslado && origen) {
      const { data: ords, error: oErr } = await supabase.from('ordenes_ejecutadas')
        .select('id, ticker, estado, origen, lado, comision_usd, comision_ars, mep').eq('portfolio_id', origen.portfolio_id);
      if (oErr) throw oErr;
      const p = planTrasladoCosto(ords ?? [], traslado.ticker, cantidad, traslado.cantidadPosicion);
      if (p.totalUsd > 0 || p.arsSinMep > 0) plan = p;
    }
    const argsComunes = {
      p_posicion_id: posicionId, p_portfolio_destino: portfolioDestino, p_cantidad: cantidad, p_nota: nota || null,
      p_valor_mercado: valorMercado != null && valorMercado > 0 ? valorMercado : null,
    };
    const { error } = plan && traslado
      ? await supabase.rpc('transferir_posicion_con_costo', {
          ...argsComunes,
          p_plan: { total_usd: plan.totalUsd, ars_sin_mep: plan.arsSinMep, fraccion: plan.fraccion, origen_nombre: traslado.origenNombre, destino_nombre: traslado.destinoNombre, ordenes: plan.origen },
        })
      : await supabase.rpc('transferir_posicion', argsComunes);
    if (error) throw error;
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
    if (avisoObjetivos) throw new Error(`Transferencia hecha, pero no se pudieron reajustar los objetivos del portfolio de origen: ${avisoObjetivos}`);
  };
}
