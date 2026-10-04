import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

// Serie del S&P 500 (retorno total) para la tarjeta "Vs S&P 500". Cambia una vez por día: 6 h de staleTime alcanzan.
export function useSp500() {
  return useQuery({
    queryKey: ['sp500_anual'],
    staleTime: 6 * 60 * 60_000,
    retry: 1,
    queryFn: () => api.sp500Anual(),
  });
}
