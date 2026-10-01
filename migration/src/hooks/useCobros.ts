import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Cobro, CobroTipo } from '../types/domain';
import { asegurarHistorial } from './usePosiciones';

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

    // Dividendo o interés: solo plata, no toca la posición (a diferencia de la amortización).
    registrar: async (input: { posicionId: string | null; ticker: string; tipo: 'dividendo' | 'interes'; fecha: string; monto: number; nota?: string | null }) => {
      if (!portfolioId) return;
      if (!(input.monto > 0)) throw new Error('El monto debe ser mayor a 0.');
      const { error } = await supabase.from('cobros').insert({
        portfolio_id: portfolioId, posicion_id: input.posicionId, ticker: input.ticker.toUpperCase().trim(),
        tipo: input.tipo, fecha: input.fecha, monto: input.monto, nota: input.nota || null, origen: 'manual',
      });
      if (error) throw error; invalidate();
    },

    // Amortización — hay DOS convenciones posibles en el mercado argentino para lo que pasa con
    // tus nominales cuando un bono amortiza, y son mutuamente EXCLUYENTES para el mismo evento (ver
    // el aviso en CuponesPage.tsx): tu bróker reduce los nominales (acá) O el nominal queda igual y
    // lo que baja es el valor residual (registrarAmortizacionVR, más abajo) — nunca las dos para el
    // mismo pago, o se cuenta la baja de capital dos veces. Esta reduce el nominal tenido vía un
    // movimiento 'ajuste' (mismo camino que un split/corrección: no toca el costo promedio, ver
    // engine/tenencia.ts). Si el usuario quiere deshacerlo, lo hace borrando ese movimiento desde el
    // historial de Posiciones (ya reconstruye la tenencia correctamente).
    registrarAmortizacion: async (input: { posicionId: string; ticker: string; fecha: string; monto: number; nominales: number; nota?: string | null }) => {
      if (!portfolioId) return;
      if (!(input.monto > 0)) throw new Error('El monto debe ser mayor a 0.');
      if (!(input.nominales > 0)) throw new Error('Los nominales amortizados deben ser mayores a 0.');
      // Historial cuadrado antes del ajuste: si el bono no tenía movimientos (cargado antes de que
      // existieran), el 'ajuste' quedaba solo y borrarlo reconstruía el nominal en 0.
      await asegurarHistorial(input.posicionId);
      const { data: pos, error: posErr } = await supabase.from('posiciones').select('cantidad').eq('id', input.posicionId).single();
      if (posErr) throw posErr;
      const cantidadActual = Number(pos.cantidad) || 0;
      const nominales = Math.min(input.nominales, cantidadActual);
      const ticker = input.ticker.toUpperCase().trim();
      const { data: mov, error: movErr } = await supabase.from('movimientos').insert({
        portfolio_id: portfolioId, posicion_id: input.posicionId, ticker,
        tipo: 'ajuste', cantidad: -nominales, precio: 0, fecha: input.fecha, nota: 'amortización de capital',
      }).select('id').single();
      if (movErr) throw movErr;
      const nuevaCantidad = Math.max(0, cantidadActual - nominales);
      const { error: updErr } = await supabase.from('posiciones').update({ cantidad: nuevaCantidad }).eq('id', input.posicionId);
      if (updErr) throw new Error(`Se registró el movimiento pero no se pudo actualizar el nominal: ${updErr.message}`);
      // La asignación por broker baja en la misma proporción (mismo criterio que vender/transferir);
      // si no, la suma por broker quedaba por encima del nominal real.
      const { data: pbs } = await supabase.from('posicion_brokers').select('id, cantidad').eq('posicion_id', input.posicionId);
      const ratio = cantidadActual > 0 ? nuevaCantidad / cantidadActual : 0;
      for (const pb of pbs ?? []) {
        const restante = Number(pb.cantidad) * ratio;
        const { error: e } = restante > 1e-9
          ? await supabase.from('posicion_brokers').update({ cantidad: restante }).eq('id', pb.id)
          : await supabase.from('posicion_brokers').delete().eq('id', pb.id);
        if (e) throw new Error(`El nominal se ajustó pero no se pudo actualizar la asignación por broker: ${e.message}`);
      }
      const { error: cobroErr } = await supabase.from('cobros').insert({
        portfolio_id: portfolioId, posicion_id: input.posicionId, ticker,
        tipo: 'amortizacion', fecha: input.fecha, monto: input.monto, movimiento_id: mov.id, nota: input.nota || null, origen: 'manual',
      });
      if (cobroErr) throw new Error(`El nominal se ajustó pero no se pudo registrar el cobro: ${cobroErr.message}`);
      invalidate();
    },

    // Amortización, convención "nominal constante": el bróker NO reduce tus nominales, lo que baja
    // es el valor residual (% del nominal original que queda por cobrar) — se guarda directo en
    // posiciones.valor_residual (marca amortizable=true de paso) y NO se toca cantidad ni se crea
    // un movimiento 'ajuste'. `valorResidualPct` es el valor NUEVO y ABSOLUTO (ej. "quedó en 75%"),
    // no un incremento — así coincide con lo que suele mostrar la ficha técnica del bono o el
    // extracto del bróker, sin que el usuario tenga que hacer la resta a mano.
    registrarAmortizacionVR: async (input: { posicionId: string; ticker: string; fecha: string; monto: number; valorResidualPct: number; nota?: string | null }) => {
      if (!portfolioId) return;
      if (!(input.monto > 0)) throw new Error('El monto debe ser mayor a 0.');
      if (!(input.valorResidualPct > 0 && input.valorResidualPct <= 100)) throw new Error('El valor residual debe ser mayor a 0% y hasta 100%.');
      const { error: updErr } = await supabase.from('posiciones')
        .update({ amortizable: true, valor_residual: input.valorResidualPct / 100 }).eq('id', input.posicionId);
      if (updErr) throw updErr;
      const ticker = input.ticker.toUpperCase().trim();
      const { error: cobroErr } = await supabase.from('cobros').insert({
        portfolio_id: portfolioId, posicion_id: input.posicionId, ticker,
        tipo: 'amortizacion', fecha: input.fecha, monto: input.monto, nota: input.nota || null, origen: 'manual',
      });
      if (cobroErr) throw new Error(`Se actualizó el valor residual pero no se pudo registrar el cobro: ${cobroErr.message}`);
      invalidate();
    },

    marcarEstado: async (id: string, estado: 'disponible' | 'reinvertido') => {
      const { error } = await supabase.from('cobros').update({ estado }).eq('id', id);
      if (error) throw error; invalidate();
    },

    // Confirmar un PENDIENTE (generado por el cron): pasa a 'disponible' y el usuario puede haber
    // corregido el monto antes de confirmar (dividendo real ≠ estimado por retención/redondeo/
    // dividendo especial). Nunca en lote — uno a la vez, a propósito, para que se revise cada uno.
    confirmarPendiente: async (id: string, montoFinal: number) => {
      if (!(montoFinal > 0)) throw new Error('El monto debe ser mayor a 0.');
      const { error } = await supabase.from('cobros').update({ estado: 'disponible', monto: montoFinal }).eq('id', id);
      if (error) throw error; invalidate();
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
    remove: async (id: string) => {
      const { error } = await supabase.from('cobros').delete().eq('id', id);
      if (error) throw error; invalidate();
    },
  };
}

export const COBRO_TIPO_LABEL: Record<CobroTipo, string> = {
  dividendo: 'Dividendo', interes: 'Interés', amortizacion: 'Amortización',
};
