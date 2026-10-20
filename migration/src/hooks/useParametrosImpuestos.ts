import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { parametrosDesdeFilas, type FilaParametroDB, type ParametrosImpuestos } from '../engine/impuestos';

// Parámetros impositivos que mantiene el servidor (tabla impuestos_parametros, migración 0060): el oficial del año cuando ARCA lo
// publica o, mientras tanto, la estimación con el IPC. Una fila mal formada se descarta en vez de romper el cálculo; sin filas, el
// motor usa las constantes del código.
export function useParametrosImpuestos(): ParametrosImpuestos & { isLoading: boolean } {
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ['impuestos_parametros'],
    enabled: !!session,
    staleTime: 6 * 60 * 60_000,
    queryFn: async (): Promise<FilaParametroDB[]> => {
      const { data, error } = await supabase.from('impuestos_parametros').select('anio, clave, valor, estimado, verificado, fuente');
      if (error) throw error;
      return (data ?? []) as FilaParametroDB[];
    },
  });
  const rows = q.data;
  const parsed = useMemo(() => parametrosDesdeFilas(rows ?? []), [rows]);
  return { ...parsed, isLoading: q.isLoading };
}
