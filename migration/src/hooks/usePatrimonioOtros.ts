import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { BaseValuacion, TipoOtroBien } from '../engine/impuestos';

// Bienes del usuario FUERA de los portfolios (vehículo, inmuebles, efectivo…): entran al patrimonio de Bienes Personales.
// Son de la persona, no de un portfolio (migración 0059, RLS por auth.uid()).
export interface PatrimonioOtro {
  id: string;
  nombre: string;
  tipo: TipoOtroBien;
  valor_ars: number;
  base: BaseValuacion;
  fecha_valuacion: string;
  nota: string | null;
}

export type PatrimonioOtroInput = Pick<PatrimonioOtro, 'nombre' | 'tipo' | 'valor_ars' | 'base' | 'nota'> & { fecha_valuacion?: string };

const VACIO: PatrimonioOtro[] = [];   // referencia estable: evita recalcular los useMemo de quien lo consume mientras carga

export function usePatrimonioOtros() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const key = ['patrimonio_otros', session?.user.id ?? 'anon'];
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const q = useQuery({
    queryKey: key,
    enabled: !!session,
    queryFn: async (): Promise<PatrimonioOtro[]> => {
      const { data, error } = await supabase.from('patrimonio_otros').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(r => ({ ...r, valor_ars: Number(r.valor_ars) })) as PatrimonioOtro[];
    },
  });

  const validar = (i: PatrimonioOtroInput) => {
    if (!i.nombre.trim()) throw new Error('Poné un nombre.');
    if (!(i.valor_ars >= 0) || !Number.isFinite(i.valor_ars)) throw new Error('El valor en pesos debe ser un número mayor o igual a 0.');
  };

  return {
    data: q.data ?? VACIO,
    isLoading: q.isLoading,
    isError: q.isError,
    agregar: async (i: PatrimonioOtroInput) => {
      validar(i);
      const { error } = await supabase.from('patrimonio_otros').insert({ ...i, nombre: i.nombre.trim(), nota: i.nota?.trim() || null });
      if (error) throw error;
      await invalidate();
    },
    actualizar: async (id: string, i: PatrimonioOtroInput) => {
      validar(i);
      const { error } = await supabase.from('patrimonio_otros').update({ ...i, nombre: i.nombre.trim(), nota: i.nota?.trim() || null }).eq('id', id);
      if (error) throw error;
      await invalidate();
    },
    eliminar: async (id: string) => {
      const { error } = await supabase.from('patrimonio_otros').delete().eq('id', id);
      if (error) throw error;
      await invalidate();
    },
  };
}
