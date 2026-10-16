import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

// Serie del S&P 500 (retorno total) desde `desde` (inicio de la historia que se quiere comparar; el servidor guarda la serie larga y
// recorta). Cambia una vez por día: 6 h de staleTime alcanzan. Sin `desde`, el servidor devuelve los últimos 5 años.
export function useSp500(desde?: string | null) {
  return useQuery({
    queryKey: ['sp500_anual', desde ?? '5y'],
    staleTime: 6 * 60 * 60_000,
    retry: 1,
    queryFn: () => api.sp500Anual(desde ?? undefined),
  });
}
