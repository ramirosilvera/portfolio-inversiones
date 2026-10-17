import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { Punto } from '../engine/rendimiento';

// Serie de valores diarios del portfolio (para el rendimiento por año). Cada fila: valor de mercado
// + aportado neto acumulado a esa fecha.
export function useSnapshots(portfolioId: string | null | undefined) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['snapshots', portfolioId],
    enabled: !!portfolioId && !!session,
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<Punto[]> => {
      const { data, error } = await supabase.from('portfolio_snapshots')
        .select('fecha, valor, aportado, fuente').eq('portfolio_id', portfolioId).order('fecha', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Punto[];
    },
  });
}

// Registra (upsert) el valor del portfolio para una fecha. Idempotente por (portfolio_id, fecha):
// abrir la app varias veces el mismo día solo actualiza el valor de hoy, no crea filas nuevas.
export function useRecordSnapshot() {
  const qc = useQueryClient();
  // `detalle`: composición de ese día [{t: ticker, c: cantidad, v: valor USD}] — para auditar el valor y hacer atribución a futuro.
  return async (portfolioId: string, fecha: string, valor: number, aportado: number, detalle?: { t: string; c: number; v: number }[]) => {
    const { error } = await supabase.from('portfolio_snapshots')
      .upsert({ portfolio_id: portfolioId, fecha, valor, aportado, fuente: 'app', completo: true, detalle: detalle ?? null }, { onConflict: 'portfolio_id,fecha' });
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['snapshots', portfolioId] });
  };
}
