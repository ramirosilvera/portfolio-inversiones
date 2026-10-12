import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { borrarMovimiento } from './usePosiciones';
import type { CobroInversion } from '../types/domain';

// Ledger de lo que salió del saldo disponible de cobros: hoy son sobre todo los PASES a Liquidez (botón de la tarjeta Historial en
// Cobros) y, de antes, las inversiones marcadas a mano — ver 0019_cobros_inversiones.sql, 0052 y
// engine/cobros.ts (saldoInvertible). Por portfolio, no por usuario (cada portfolio tiene su
// propio saldo disponible).
export function useCobrosInversiones(portfolioId: string | null | undefined) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['cobros_inversiones', portfolioId] });
  // Pasar a Liquidez mueve el efectivo de la cartera: hay que refrescar posiciones y movimientos también.
  const invalidateLiquidez = () => {
    invalidate();
    qc.invalidateQueries({ queryKey: ['posiciones'] });
    qc.invalidateQueries({ queryKey: ['movimientos'] });
    qc.invalidateQueries({ queryKey: ['posicion_brokers'] });
  };

  const q = useQuery({
    queryKey: ['cobros_inversiones', portfolioId],
    enabled: !!portfolioId,
    queryFn: async (): Promise<CobroInversion[]> => {
      const { data, error } = await supabase.from('cobros_inversiones').select('*').eq('portfolio_id', portfolioId)
        .order('fecha', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return {
    data: q.data ?? [],
    isLoading: q.isLoading,

    marcarInversion: async (input: { monto: number; fecha: string; nota?: string | null }) => {
      if (!portfolioId) return;
      if (!(input.monto > 0)) throw new Error('El monto debe ser mayor a 0.');
      const { error } = await supabase.from('cobros_inversiones').insert({
        portfolio_id: portfolioId, fecha: input.fecha, monto: input.monto, nota: input.nota || null,
      });
      if (error) throw error; invalidate();
    },

    // Pasa parte del saldo disponible a la posición LIQUIDEZ (efectivo de la cartera). Atómico en la base (0052): mueve la
    // Liquidez, anota el pase en este mismo ledger y valida que el monto no supere el saldo pasable.
    pasarALiquidez: async (input: { monto: number; fecha: string; nota?: string | null }) => {
      if (!portfolioId) return;
      if (!(input.monto > 0)) throw new Error('El monto debe ser mayor a 0.');
      const { error } = await supabase.rpc('pasar_saldo_a_liquidez', {
        p_portfolio: portfolioId, p_monto: input.monto, p_fecha: input.fecha, p_nota: input.nota || null,
      });
      invalidateLiquidez();
      if (error) throw new Error(error.message);
    },

    // No es un dato "real" con historial impositivo — es una anotación del usuario ("ya invertí
    // esto"), así que un borrado directo (sin descartado/soft-delete) alcanza para deshacerla.
    // Si era un pase a Liquidez (liquidez_mov_id), deshacerlo también revierte ese crédito de efectivo: la plata deja
    // de estar en la Liquidez y vuelve al saldo (mismo criterio que borrar un cobro acreditado, useCobros.remove).
    remove: async (id: string) => {
      const { data: inv, error: selErr } = await supabase.from('cobros_inversiones').select('liquidez_mov_id').eq('id', id).maybeSingle();
      if (selErr) throw selErr;
      const { error } = await supabase.from('cobros_inversiones').delete().eq('id', id);
      if (error) throw error;
      try { if (inv?.liquidez_mov_id) await borrarMovimiento(inv.liquidez_mov_id); }
      catch (e) { throw new Error(`Pase deshecho, pero no se pudo revertir la Liquidez: ${e instanceof Error ? e.message : e}`); }
      finally { invalidateLiquidez(); }
    },
  };
}
