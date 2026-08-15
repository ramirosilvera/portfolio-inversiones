import { useMemo } from 'react';
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
    // string[], NO Set: el query client persiste la cache a localStorage vía JSON.stringify (ver
    // main.tsx) y un Set no sobrevive esa vuelta — JSON.stringify(new Set([...])) da "{}", así que
    // al rehidratar quedaba un objeto plano sin .has() ("i.has is not a function" en producción).
    // El Set se arma acá abajo, en cada render, nunca adentro de la query cacheada.
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.from('bonos_destacados').select('ticker');
      if (error) throw error;
      return (data ?? []).map(r => r.ticker as string);
    },
  });
  // Array.isArray(), no solo `?? []`: un navegador que ya había cacheado el Set roto de ANTES de este
  // fix (ver comentario arriba) tiene en localStorage un objeto plano "{}" persistido — es un valor
  // TRUTHY, así que `?? []` no lo reemplaza, y new Set({}) explota (un objeto plano no es iterable).
  // Con este chequeo, cualquier cache vieja/corrupta cae a [] en vez de tirar la pantalla abajo, y el
  // refetch normal (staleTime por defecto) la pisa con datos buenos enseguida.
  const destacados = useMemo(() => new Set(Array.isArray(q.data) ? q.data : []), [q.data]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['bonos_destacados'] });
  return {
    destacados,
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
