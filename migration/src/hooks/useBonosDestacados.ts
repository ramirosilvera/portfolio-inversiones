import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

// Tickers de renta fija marcados como destacados por el usuario, para que aparezcan primero en el
// catálogo del Radar (ver RadarPage.tsx). Per-user (RLS) — separado de bonos_referencia porque ese
// catálogo es compartido/global (ver useBonosReferencia), no algo que cada usuario pueda anotar.
export function useBonosDestacados() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ['bonos_destacados', session?.user.id ?? 'anon'],
    enabled: !!session,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.from('bonos_destacados').select('ticker');
      if (error) throw error;
      return new Set((data ?? []).map(r => r.ticker as string));
    },
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['bonos_destacados'] });
  return {
    destacados: q.data ?? new Set<string>(),
    isLoading: q.isLoading,
    toggle: async (ticker: string, destacado: boolean) => {
      if (destacado) {
        // upsert (no insert): un doble click antes de que invalide la cache no debe romper contra
        // la PK (user_id, ticker) — mismo criterio que useWatchlist.add().
        const { error } = await supabase.from('bonos_destacados').upsert({ ticker }, { onConflict: 'user_id,ticker' });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('bonos_destacados').delete().eq('ticker', ticker);
        if (error) throw error;
      }
      invalidate();
    },
  };
}
