import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Cobro, CobroTipo } from '../types/domain';
import { asegurarHistorial, borrarMovimiento } from './usePosiciones';

export function useCobros(portfolioId: string | null | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cobros', portfolioId] });
    qc.invalidateQueries({ queryKey: ['posiciones'] });
    qc.invalidateQueries({ queryKey: ['movimientos'] });
    qc.invalidateQueries({ queryKey: ['posicion_brokers'] });
  };

  const q = useQuery({
    queryKey: ['cobros', portfolioId],
    enabled: !!portfolioId,
    queryFn: async (): Promise<Cobro[]> => {
      const { data, error } = await supabase.from('cobros').select('*').eq('portfolio_id', portfolioId)
        .order('fecha', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return {
    data: q.data ?? [],
    isLoading: q.isLoading,

    // `acreditar` (en las 3 altas de abajo): el monto entra a la LIQUIDEZ del portfolio, en la misma
    // transacción (migración 0050). Sin eso la plata cobrada no estaba en el patrimonio y el
    // rendimiento por año la perdía (y una amortización se veía como pérdida de capital).

    // Dividendo o interés: solo plata, no toca la posición (a diferencia de la amortización).
    registrar: async (input: { posicionId: string | null; ticker: string; tipo: 'dividendo' | 'interes'; fecha: string; monto: number; nota?: string | null; acreditar?: boolean }) => {
      if (!portfolioId) return;
      if (!(input.monto > 0)) throw new Error('El monto debe ser mayor a 0.');
      const { error } = await supabase.rpc('registrar_cobro', {
        p_portfolio: portfolioId, p_posicion_id: input.posicionId, p_ticker: input.ticker, p_tipo: input.tipo,
        p_fecha: input.fecha, p_monto: input.monto, p_nota: input.nota || null, p_acreditar: !!input.acreditar,
      });
      if (error) throw error; invalidate();
    },

    // Amortización — hay DOS convenciones posibles en el mercado argentino para lo que pasa con
    // tus nominales cuando un bono amortiza, y son mutuamente EXCLUYENTES para el mismo evento (ver
    // el aviso en CuponesPage.tsx): tu bróker reduce los nominales (acá) O el nominal queda igual y
    // lo que baja es el valor residual (registrarAmortizacionVR, más abajo) — nunca las dos para el
    // mismo pago, o se cuenta la baja de capital dos veces. Esta reduce el nominal tenido vía un
    // movimiento 'ajuste' (mismo camino que un split/corrección: no toca el costo promedio, ver
    // engine/tenencia.ts). Para deshacerlo, se borra ese movimiento desde el historial de Posiciones.
    registrarAmortizacion: async (input: { posicionId: string; ticker: string; fecha: string; monto: number; nominales: number; nota?: string | null; acreditar?: boolean }) => {
      if (!portfolioId) return;
      if (!(input.monto > 0)) throw new Error('El monto debe ser mayor a 0.');
      if (!(input.nominales > 0)) throw new Error('Los nominales amortizados deben ser mayores a 0.');
      // Historial cuadrado antes del ajuste: si el bono no tenía movimientos (cargado antes de que
      // existieran), el 'ajuste' quedaba solo y borrarlo reconstruía el nominal en 0.
      await asegurarHistorial(input.posicionId);
      // Movimiento + nominal + cobro + liquidez en una transacción; brokers por trigger.
      const { error } = await supabase.rpc('registrar_amortizacion', {
        p_posicion_id: input.posicionId, p_fecha: input.fecha, p_monto: input.monto,
        p_nominales: input.nominales, p_nota: input.nota || null, p_acreditar: !!input.acreditar,
      });
      invalidate();
      if (error) throw error;
    },

    // Amortización, convención "nominal constante": el bróker NO reduce tus nominales, lo que baja
    // es el valor residual (% del nominal original que queda por cobrar). `valorResidualPct` es el
    // valor NUEVO y ABSOLUTO (ej. "quedó en 75%"), no un incremento — así coincide con lo que suele
    // mostrar la ficha técnica del bono o el extracto del bróker. El costo base baja en la misma
    // proporción (movimiento 'amortizacion_vr'): antes quedaba igual y el capital ya cobrado se veía
    // como pérdida. Para deshacerlo, se borra ese movimiento (restaura costo y valor residual).
    registrarAmortizacionVR: async (input: { posicionId: string; ticker: string; fecha: string; monto: number; valorResidualPct: number; nota?: string | null; acreditar?: boolean }) => {
      if (!portfolioId) return;
      if (!(input.monto > 0)) throw new Error('El monto debe ser mayor a 0.');
      if (!(input.valorResidualPct > 0 && input.valorResidualPct <= 100)) throw new Error('El valor residual debe ser mayor a 0% y hasta 100%.');
      await asegurarHistorial(input.posicionId);
      const { error } = await supabase.rpc('registrar_amortizacion_vr', {
        p_posicion_id: input.posicionId, p_fecha: input.fecha, p_monto: input.monto,
        p_valor_residual: input.valorResidualPct / 100, p_nota: input.nota || null, p_acreditar: !!input.acreditar,
      });
      invalidate();
      if (error) throw error;
    },

    marcarEstado: async (id: string, estado: 'disponible' | 'reinvertido') => {
      const { error } = await supabase.from('cobros').update({ estado }).eq('id', id);
      if (error) throw error; invalidate();
    },

    // Confirmar un PENDIENTE (generado por el cron): pasa a 'disponible' y el usuario puede haber
    // corregido el monto antes de confirmar (dividendo real ≠ estimado por retención/redondeo/
    // dividendo especial). Nunca en lote — uno a la vez, a propósito, para que se revise cada uno.
    confirmarPendiente: async (id: string, montoFinal: number, acreditar = false) => {
      if (!(montoFinal > 0)) throw new Error('El monto debe ser mayor a 0.');
      const { data: c, error } = await supabase.from('cobros').update({ estado: 'disponible', monto: montoFinal })
        .eq('id', id).select('portfolio_id, ticker, tipo, fecha').single();
      if (error) throw error;
      if (acreditar) {
        const { data: liqMovId, error: liqErr } = await supabase.rpc('mover_liquidez', {
          p_portfolio: c.portfolio_id, p_monto: montoFinal, p_fecha: c.fecha, p_nota: `${c.tipo} ${c.ticker}`,
        });
        if (liqErr) { invalidate(); throw new Error(`Cobro confirmado, pero no se pudo acreditar en liquidez: ${liqErr.message}`); }
        await supabase.from('cobros').update({ liquidez_mov_id: liqMovId }).eq('id', id);
      }
      invalidate();
    },

    // Descartar un PENDIENTE (sugerido por el cron): NO se borra la fila, se marca 'descartado' —
    // si se borrara, el índice de deduplicación (cobros_cron_dedupe) quedaría libre y el cron
    // volvería a sugerir EXACTAMENTE lo mismo en la próxima corrida (cada 30 min, o el mes/ventana
    // completa para cupones de bono). engine/cobros.ts excluye 'descartado' de todos los totales.
    descartarPendiente: async (id: string) => {
      const { error } = await supabase.from('cobros').update({ estado: 'descartado' }).eq('id', id);
      if (error) throw error; invalidate();
    },

    // Borra SOLO el registro de cobro (la plata que se anotó como cobrada). Si era una
    // amortización, el nominal reducido NO se revierte acá a propósito: eso realmente pasó. Para
    // deshacer el efecto en la posición hay que borrar el movimiento 'ajuste' desde su historial
    // en Posiciones (el link movimiento_id de este cobro queda en null solo, por la FK).
    // Para un PENDIENTE usar descartarPendiente, no esto (ver comentario arriba).
    // Si el cobro se había acreditado en LIQUIDEZ (liquidez_mov_id), ese crédito se revierte: la
    // plata "cobrada" deja de existir, no puede quedar en el efectivo del portfolio.
    remove: async (id: string) => {
      const { data: c, error: selErr } = await supabase.from('cobros').select('liquidez_mov_id').eq('id', id).maybeSingle();
      if (selErr) throw selErr;
      const { error } = await supabase.from('cobros').delete().eq('id', id);
      if (error) throw error;
      try { if (c?.liquidez_mov_id) await borrarMovimiento(c.liquidez_mov_id); }
      finally { invalidate(); }
    },
  };
}

export const COBRO_TIPO_LABEL: Record<CobroTipo, string> = {
  dividendo: 'Dividendo', interes: 'Interés', amortizacion: 'Amortización',
};
