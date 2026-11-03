import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

// «Descartar por hoy» de la alerta de estrés macro, guardado POR USUARIO en el servidor (macro_alerta_descartes, 0064): el descarte hecho en el
// celular también vale en la compu. data = la clave descartada («AAAA-MM-DD|keys») o null si no hay. Si la tabla no existe todavía o falla la
// lectura, el componente usa el estado local del navegador.
export function useAlertaDescartada() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const key = ['macro_alerta_descartada', session?.user.id ?? 'anon'];
  const q = useQuery({
    queryKey: key,
    enabled: !!session,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.from('macro_alerta_descartes').select('clave').maybeSingle();
      if (error) throw error;
      return data?.clave ?? null;
    },
  });
  const descartar = async (clave: string) => {
    qc.setQueryData(key, clave);   // optimista: se oculta ya; si el guardado falla, queda el respaldo local
    if (!session) return;
    const { error } = await supabase.from('macro_alerta_descartes').upsert({ user_id: session.user.id, clave, updated_at: new Date().toISOString() });
    if (error) qc.invalidateQueries({ queryKey: key });
  };
  return { servidor: q.data ?? null, cargando: q.isLoading, descartar };
}
