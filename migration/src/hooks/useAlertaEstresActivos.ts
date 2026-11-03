import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { CLAVE_ACTIVOS } from '../engine/alertaMacro';

// Estado de la banda de la alerta de estrés macro que calcula el cron (macro_cache, solo lectura para la app): misma lista en todos los
// dispositivos. null = todavía no hay fila (primer refresco pendiente) o no se pudo leer: el componente cae a su estado local.
export function useAlertaEstresActivos() {
  return useQuery({
    queryKey: ['macro_alerta_activos'],
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<string[] | null> => {
      const { data, error } = await supabase.from('macro_cache').select('data_json').eq('clave', CLAVE_ACTIVOS).maybeSingle();
      if (error) throw error;
      const j = data?.data_json;
      return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : null;
    },
  });
}
