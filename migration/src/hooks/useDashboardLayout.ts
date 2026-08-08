import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { DEFAULT_LAYOUT, resolveKey } from '../engine/dashboardCatalog';
import type { DashboardWidget, SeccionKey, MetricKey, DashboardViz } from '../types/domain';

// Convierte una fila cruda del JSONB a un DashboardWidget válido, o `null` si no se puede — NUNCA
// un simple type-guard booleano: un guard como `w is DashboardWidget` puede devolver `true` sobre un
// objeto que en realidad no tiene la forma nueva (ver el caso `metrica` de abajo), y ese objeto
// mentiroso pasaría intacto a WidgetGrid, que rompe al hacer `.map()` sobre un campo que no existe.
// Acá se CONSTRUYE el objeto nuevo explícitamente, así no hay forma de que la validación mienta.
//
// Compat: layouts guardados ANTES de la selección múltiple tenían `{metrica: "x"}` (string), no
// `{metricas: ["x"]}` (array) — se normalizan en esta misma función, así un layout viejo sigue
// funcionando sin necesitar una migración de datos; el próximo guardado ya escribe el shape nuevo.
function normalizarWidget(w: unknown): DashboardWidget | null {
  if (!w || typeof w !== 'object') return null;
  const o = w as Record<string, unknown>;
  if (typeof o.id !== 'string') return null;
  if (o.kind === 'seccion') {
    // Resuelto ACÁ (no solo al renderizar) — así una key vieja fusionada por ALIASES (ej. 'aportes'
    // → 'rendimiento_por_anio') se canoniza la primera vez que se lee, y el próximo `persist()` ya
    // graba la key nueva. Sin esto, ALIASES queda cargando esa fila para siempre: si algún día se
    // borra el alias asumiendo "ya nadie tiene la key vieja", esta fila se rompe igual.
    return typeof o.seccion === 'string' ? { id: o.id, kind: 'seccion', seccion: resolveKey(o.seccion) as SeccionKey } : null;
  }
  if (o.kind === 'metrica') {
    if (typeof o.viz !== 'string') return null;
    const metricasRaw = Array.isArray(o.metricas) && o.metricas.every(m => typeof m === 'string') ? o.metricas as string[]
      : typeof o.metrica === 'string' ? [o.metrica] // legacy: 1 sola métrica en un campo singular
      : null;
    if (!metricasRaw) return null;
    const metricas = [...new Set(metricasRaw)] as MetricKey[]; // dedupe — una key repetida rompería las keys de React en el grid del combo
    if (metricas.length === 0) return null;
    return { id: o.id, kind: 'metrica', metricas, viz: o.viz as DashboardViz, titulo: typeof o.titulo === 'string' ? o.titulo : undefined };
  }
  return null;
}

// `null` = no hay nada usable (la columna no es ni siquiera un array) → el caller cae a
// DEFAULT_LAYOUT. Un array válido pero vacío (`[]`) es un resultado legítimo distinto de `null`
// (ver `isCustom` más abajo), aunque el render también lo trate como "usar default" — ver `widgets`.
function parseWidgets(raw: unknown): DashboardWidget[] | null {
  if (!Array.isArray(raw)) return null;
  const vistos = new Set<string>();
  const seccionesResueltas = new Set<string>();
  const out: DashboardWidget[] = [];
  for (const item of raw) {
    const w = normalizarWidget(item);
    if (!w || vistos.has(w.id)) continue; // ids duplicados → keys de React rotas
    if (w.kind === 'seccion') {
      // Dedupe por key YA resuelta (no por `w.seccion` crudo) — necesario cuando un ALIASES fusiona
      // 2 secciones viejas en 1 sola tarjeta (ej. 'aportes' → 'rendimiento_por_anio'): un layout que
      // llegó a tener ambas guardadas por separado no debe renderizar la misma tarjeta fusionada
      // dos veces. Se limpia solo (la próxima vez que se persista algo, el duplicado ya no vuelve).
      const key = resolveKey(w.seccion);
      if (seccionesResueltas.has(key)) continue;
      seccionesResueltas.add(key);
    }
    vistos.add(w.id);
    out.push(w);
  }
  return out;
}

// Layout del Dashboard personalizable — 1 fila JSONB por usuario (0029_dashboard_layout.sql), GLOBAL
// (no por portfolio, mismo criterio que Liquidez & FCI). Sin fila todavía (usuario que nunca
// personalizó) O con un array vacío (se quedó sin tarjetas) se renderiza DEFAULT_LAYOUT sin escribir
// nada — a propósito no hay "sembrado" en el primer load: eso eliminaría cualquier carrera de
// doble-insert (dos pestañas, StrictMode) de raíz.
export function useDashboardLayout() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const queryKey = ['dashboard_layout', session?.user.id ?? 'anon'];

  const q = useQuery({
    queryKey,
    enabled: !!session,
    queryFn: async (): Promise<DashboardWidget[] | null> => {
      const { data, error } = await supabase.from('dashboard_layout').select('widgets').maybeSingle();
      if (error) throw error;
      return parseWidgets(data?.widgets);
    },
  });

  const widgets = q.data && q.data.length > 0 ? q.data : DEFAULT_LAYOUT;

  const persist = async (next: DashboardWidget[]) => {
    if (!session) return;
    // Optimista: se escribe en caché ANTES de esperar la red, así una segunda acción disparada
    // rápido (doble click en mover/eliminar) parte del estado recién escrito, no del que había al
    // momento del primer render — sin esto, dos acciones seguidas podían pisarse entre sí.
    qc.setQueryData(queryKey, next);
    const { error } = await supabase.from('dashboard_layout')
      .upsert({ user_id: session.user.id, widgets: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) { qc.invalidateQueries({ queryKey }); throw error; } // revierte al estado real del server
    qc.invalidateQueries({ queryKey });
  };

  // Todas las acciones parten del valor MÁS RECIENTE en caché (no del `widgets` cerrado en este
  // render) — mismo motivo que el comentario de `persist` de arriba.
  const mutate = (updater: (prev: DashboardWidget[]) => DashboardWidget[]) => {
    const cached = qc.getQueryData<DashboardWidget[] | null>(queryKey);
    const base = cached && cached.length > 0 ? cached : DEFAULT_LAYOUT;
    const next = updater(base);
    if (next === base) return Promise.resolve(); // no-op (ej. mover en el borde) — no pega a la red
    return persist(next);
  };

  return {
    widgets,
    // false = todavía usando DEFAULT_LAYOUT (nunca personalizó, o vació su layout); true = tiene
    // layout propio guardado — distingue "sin fila usable" de "fila con contenido real".
    isCustom: q.data != null && q.data.length > 0,
    isLoading: q.isLoading,
    save: persist,
    agregar: (w: Omit<Extract<DashboardWidget, { kind: 'metrica' }>, 'id'>) =>
      mutate(prev => [...prev, { ...w, id: crypto.randomUUID() }]),
    agregarSeccion: (seccion: SeccionKey) =>
      mutate(prev => [...prev, { id: crypto.randomUUID(), kind: 'seccion', seccion }]),
    // Deliberadamente 'id'|'kind' (no también 'metrica', que ya ni existe en el tipo) — así
    // `metricas` SÍ es patcheable, necesario para poder agregar/quitar métricas de una tarjeta combo
    // ya guardada sin tener que borrarla y rearmarla desde cero.
    actualizar: (id: string, patch: Partial<Omit<Extract<DashboardWidget, { kind: 'metrica' }>, 'id' | 'kind'>>) =>
      mutate(prev => prev.map(w => (w.id === id && w.kind === 'metrica' ? { ...w, ...patch } : w))),
    eliminar: (id: string) => mutate(prev => prev.filter(w => w.id !== id)),
    mover: (id: string, dir: 'arriba' | 'abajo') => mutate(prev => {
      const i = prev.findIndex(w => w.id === id);
      const j = dir === 'arriba' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }),
    restaurarDefault: () => persist(DEFAULT_LAYOUT),
  };
}
