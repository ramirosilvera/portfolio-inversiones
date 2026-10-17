import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { OrdenFila } from '../engine/ordenes';

// Órdenes ejecutadas del portfolio (tabla ordenes_ejecutadas, migraciones 0047/0053/0054): registro de lo operado en el broker, con
// sus comisiones y el MEP del día. La app NO ejecuta órdenes (regla de oro #4): esto es solo registro y control.
export function useOrdenes(portfolioId: string | null | undefined) {
  return useQuery({
    queryKey: ['ordenes', portfolioId],
    enabled: !!portfolioId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OrdenFila[]> => {
      const { data, error } = await supabase.from('ordenes_ejecutadas').select('*').eq('portfolio_id', portfolioId)
        .order('fecha', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(r => ({
        ...r, nominales: Number(r.nominales) || 0, monto_usd: Number(r.monto_usd) || 0,
        precio_limite: r.precio_limite == null ? null : Number(r.precio_limite),
        precio_ejecutado: r.precio_ejecutado == null ? null : Number(r.precio_ejecutado),
        comision_usd: r.comision_usd == null ? null : Number(r.comision_usd),
        comision_ars: r.comision_ars == null ? null : Number(r.comision_ars),
        mep: r.mep == null ? null : Number(r.mep),
      })) as OrdenFila[];
    },
  });
}

export interface OrdenInput {
  fecha: string; ticker: string; broker: string; numero_orden: string | null; nominales: number;
  precio_ejecutado: number | null; monto_usd: number; comision_usd: number | null; comision_ars: number | null; mep: number | null;
  estado: string; origen: string; nota: string | null; movimiento_id?: string | null; lado?: 'compra' | 'venta';
}

export function useOrdenMutations(portfolioId: string | null | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ordenes', portfolioId] });
    qc.invalidateQueries({ queryKey: ['ordenes_ejecutadas', portfolioId] });
  };
  return {
    add: async (o: OrdenInput) => {
      const { error } = await supabase.from('ordenes_ejecutadas').insert({ ...o, ticker: o.ticker.toUpperCase().trim(), portfolio_id: portfolioId });
      if (error) throw error;
      invalidate();
    },
    update: async (id: string, patch: Partial<OrdenInput>) => {
      const { error } = await supabase.from('ordenes_ejecutadas').update(patch).eq('id', id).eq('portfolio_id', portfolioId);
      if (error) throw error;
      invalidate();
    },
    remove: async (id: string) => {
      const { error } = await supabase.from('ordenes_ejecutadas').delete().eq('id', id).eq('portfolio_id', portfolioId);
      if (error) throw error;
      invalidate();
    },
  };
}
