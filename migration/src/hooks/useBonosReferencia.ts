import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { BonoReferencia } from '../engine/rentaFija';

// Catálogo global de renta fija (bonos_referencia, ver migración 0034) — lectura directa a
// Supabase, mismo criterio que useCedearRatios: es una base compartida, no aislada por portfolio.
// El cliente NUNCA escribe cronograma/vencimiento/etc. (los puebla el proceso de actualización
// mensual vía IOL) — la única excepción es calificadora/calificacion, editable a mano (ver
// migración 0036: grant column-level, no toda la fila) porque no hay API gratuita de rating.
export function useBonosReferencia() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['bonos_referencia'],
    staleTime: 24 * 60 * 60_000,
    queryFn: async (): Promise<BonoReferencia[]> => {
      const { data, error } = await supabase.from('bonos_referencia').select('*').order('ticker');
      if (error) throw error;
      return (data ?? []) as BonoReferencia[];
    },
  });
  return {
    ...query,
    // update() en vez de un nombre "guardar rating": el grant column-level de la migración 0036
    // hace que cualquier otro campo en el payload sea rechazado por Postgres, así que solo estos 2
    // deberían pasarse nunca — si algún día hace falta editar más campos desde acá, hace falta
    // ampliar el grant primero, no alcanza con tocar esta función.
    actualizarRating: async (ticker: string, calificadora: string | null, calificacion: string | null) => {
      const { error } = await supabase.from('bonos_referencia')
        .update({ calificadora: calificadora || null, calificacion: calificacion || null })
        .eq('ticker', ticker);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['bonos_referencia'] });
    },
  };
}
