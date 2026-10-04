import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Presupuesto } from '../engine/presupuesto';

export interface ProyeccionInputs {
  aporteAnual: number;
  tasaAnual: number;
  anios: number;
  edadInicial: number;
}

// Lo que se guarda por portfolio: los supuestos del Forecast y, aparte, el PRESUPUESTO congelado
// (ver engine/presupuesto.ts). Comparten la fila jsonb de `proyeccion_inputs` (sin migración), así que
// cada escritura LEE la fila actual y mezcla: guardar/restablecer supuestos no puede borrar el
// presupuesto, ni fijar un presupuesto pisar los supuestos.
export type ProyeccionGuardado = Partial<ProyeccionInputs> & { presupuesto?: Presupuesto | null };

// Supuestos guardados por PORTFOLIO (el valor inicial ya es del portfolio activo, así que el resto
// de los supuestos viaja con él). Sin esto se perdían al recargar la página.
export function useProyeccionInputs(portfolioId: string | undefined) {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['proyeccion_inputs', portfolioId ?? ''],
    enabled: !!portfolioId,
    queryFn: async (): Promise<ProyeccionGuardado | null> => {
      const { data, error } = await supabase.from('proyeccion_inputs').select('inputs').eq('portfolio_id', portfolioId).maybeSingle();
      if (error) throw error;
      return (data?.inputs as ProyeccionGuardado | undefined) ?? null;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['proyeccion_inputs', portfolioId ?? ''] });

  // Lectura fresca de la base (no del cache de react-query): la mezcla tiene que partir de lo que
  // hay guardado AHORA, no de lo que esta pestaña vio hace un rato.
  const leer = async (): Promise<ProyeccionGuardado> => {
    const { data, error } = await supabase.from('proyeccion_inputs').select('inputs').eq('portfolio_id', portfolioId).maybeSingle();
    if (error) throw error;
    return (data?.inputs as ProyeccionGuardado | undefined) ?? {};
  };
  const escribir = async (inputs: ProyeccionGuardado) => {
    const vacio = Object.values(inputs).every(v => v == null);
    const { error } = vacio
      ? await supabase.from('proyeccion_inputs').delete().eq('portfolio_id', portfolioId)
      : await supabase.from('proyeccion_inputs').upsert({ portfolio_id: portfolioId, inputs, updated_at: new Date().toISOString() });
    if (error) throw error; invalidate();
  };

  return {
    data: q.data ?? null,
    isLoading: q.isLoading,
    save: async (inputs: ProyeccionInputs) => {
      if (!portfolioId) return;
      const actual = await leer();
      await escribir({ ...actual, ...inputs });
    },
    // Restablecer supuestos: conserva el presupuesto si hay uno.
    remove: async () => {
      if (!portfolioId) return;
      const { presupuesto } = await leer();
      await escribir({ presupuesto: presupuesto ?? null });
    },
    // Fija (o con null, borra) el presupuesto congelado; los supuestos quedan como estaban.
    savePresupuesto: async (presupuesto: Presupuesto | null) => {
      if (!portfolioId) return;
      const actual = await leer();
      await escribir({ ...actual, presupuesto });
    },
  };
}
