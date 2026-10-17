import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { OrdenCosto } from '../engine/desempeno';

// Órdenes ejecutadas del portfolio (solo lo necesario para costos): comisiones en USD y en pesos, monto operado y el tipo de cambio
// MEP de la fecha cuando está registrado (migración 0053). Las filas sin `mep` mantienen su comisión en pesos sin convertir.
export function useOrdenesEjecutadas(portfolioId: string | null | undefined) {
  return useQuery({
    queryKey: ['ordenes_ejecutadas', portfolioId],
    enabled: !!portfolioId,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<OrdenCosto[]> => {
      const { data, error } = await supabase.from('ordenes_ejecutadas')
        .select('monto_usd, comision_usd, comision_ars, mep, origen').eq('portfolio_id', portfolioId)
        .eq('estado', 'terminada');   // las canceladas/rechazadas no operaron: no suman a lo operado ni a las comisiones
      if (error) throw error;
      return (data ?? []) as OrdenCosto[];
    },
  });
}
