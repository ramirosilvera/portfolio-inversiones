import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { BonoReferencia } from '../engine/rentaFija';

// Catálogo global de renta fija (bonos_referencia, ver migración 0034) — lectura directa a
// Supabase, mismo criterio que useCedearRatios: es una base compartida, no aislada por portfolio,
// y el cliente nunca escribe acá (la puebla el proceso de actualización mensual vía IOL).
export function useBonosReferencia() {
  return useQuery({
    queryKey: ['bonos_referencia'],
    staleTime: 24 * 60 * 60_000,
    queryFn: async (): Promise<BonoReferencia[]> => {
      const { data, error } = await supabase.from('bonos_referencia').select('*').order('ticker');
      if (error) throw error;
      return (data ?? []) as BonoReferencia[];
    },
  });
}
