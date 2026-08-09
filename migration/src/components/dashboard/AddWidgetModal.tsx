import { useState } from 'react';
import { X } from 'lucide-react';
import { Card, CardHeader, Field, Button, inputCls } from '../ui';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { METRIC_CATALOG, SECCION_CATALOG, getMetricDef, resolveKey, resolveViz, tituloWidget } from '../../engine/dashboardCatalog';
import type { DashboardViz, DashboardWidget, MetricKey, SeccionKey } from '../../types/domain';

const VIZ_LABEL: Record<DashboardViz, string> = { stat: 'Número', donut: 'Donut', bar: 'Barras', table: 'Tabla' };
// Más de esto y la grilla de 4 columnas queda en 2 filas desparejas (4+1, 4+2...) — difícil de leer
// de un vistazo, que es todo el punto de una tarjeta combinada.
const MAX_COMBO = 4;

// Constructor de tarjetas: agregar una sección completa (de las que todavía no están en el layout) o
// armar una tarjeta a medida — una o más métricas del catálogo (2+ solo entre `shape:'scalar'`, se
// combinan en una grilla dentro de la misma Card) + visualización (solo aplica con 1 sola métrica) +
// título opcional. También sirve para editar una tarjeta 'metrica' existente: agregar/quitar métricas
// libremente, no solo cambiar viz/título — pensado para poder sumarle un 4to número a una
// combinación ya armada sin tener que borrarla y rehacerla desde cero.
export function AddWidgetModal({
  layout, editing, onClose, onAgregarMetrica, onAgregarSeccion, onActualizarMetrica,
}: {
  layout: DashboardWidget[];
  editing: Extract<DashboardWidget, { kind: 'metrica' }> | null;
  onClose: () => void;
  onAgregarMetrica: (metricas: MetricKey[], viz: DashboardViz, titulo?: string) => Promise<void>;
  onAgregarSeccion: (seccion: SeccionKey) => Promise<void>;
  onActualizarMetrica: (id: string, metricas: MetricKey[], viz: DashboardViz, titulo?: string) => Promise<void>;
}) {
  useEscapeClose(onClose);
  const [seleccion, setSeleccion] = useState<MetricKey[]>(editing?.metricas ?? []);
  const [viz, setViz] = useState<DashboardViz | null>(
    editing && editing.metricas.length === 1 ? resolveViz(editing.metricas[0], editing.viz) : null,
  );
  const [titulo, setTitulo] = useState(editing?.titulo ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const seccionesUsadas = new Set(layout.filter(w => w.kind === 'seccion').map(w => resolveKey(w.seccion)));
  const seccionesDisponibles = SECCION_CATALOG.filter(s => !seccionesUsadas.has(s.key));

  const defsSeleccionados = seleccion.map(k => getMetricDef(k)).filter((d): d is NonNullable<typeof d> => !!d);
  // Mismo helper que usa WidgetGrid para derivar el título real de una tarjeta guardada — antes cada
  // lado calculaba esto con un criterio propio (acá "Bonos", en WidgetGrid "Capital en bonos · TIR
  // promedio", para la MISMA combinación), así que el preview de este modal podía no coincidir con
  // cómo terminaba viéndose la tarjeta ya guardada.
  const tituloDefault = seleccion.length > 0 ? tituloWidget(seleccion) : '';

  const toggleMetrica = (key: MetricKey) => {
    const yaElegida = seleccion.includes(key);
    let next: MetricKey[];
    if (yaElegida) {
      next = seleccion.filter(k => k !== key);
    } else {
      if (seleccion.length >= MAX_COMBO) return;
      const def = getMetricDef(key);
      if (!def) return;
      // Combinar solo tiene sentido entre escalares (varios números en una grilla) — una categórica
      // (donut/tabla) no cabe ahí, así que elegir una bloquea cualquier otra combinación.
      const hayCategoricaElegida = seleccion.some(k => getMetricDef(k)?.shape === 'categorico');
      if (seleccion.length > 0 && (hayCategoricaElegida || def.shape === 'categorico')) return;
      next = [...seleccion, key];
    }
    setSeleccion(next);
    if (next.length === 1) setViz(getMetricDef(next[0])!.vizDefault);
  };

  const agregarSeccion = async (key: SeccionKey) => {
    setErr(null); setBusy(true);
    try { await onAgregarSeccion(key); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo agregar'); setBusy(false); }
  };

  const guardarMetrica = async () => {
    if (seleccion.length === 0 || (seleccion.length === 1 && !viz)) return;
    setErr(null); setBusy(true);
    try {
      const vizFinal: DashboardViz = seleccion.length === 1 ? viz! : 'stat'; // ignorado en modo combo, pero el tipo lo pide
      // Nunca persistir el título derivado (undefined si el usuario no escribió uno propio) — así se
      // re-deriva en cada render vía tituloWidget(), y agregar/quitar una métrica de un combo ya
      // guardado (re-editándolo) actualiza el título solo, en vez de quedar pegado al título viejo
      // calculado la primera vez que se guardó la tarjeta.
      const tituloFinal = titulo.trim() || undefined;
      if (editing) await onActualizarMetrica(editing.id, seleccion, vizFinal, tituloFinal);
      else await onAgregarMetrica(seleccion, vizFinal, tituloFinal);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Agregar tarjeta">
        <Card className="animate-rise">
          <CardHeader title={editing ? 'Editar tarjeta' : 'Agregar tarjeta'}
            sub={editing ? 'Agregá o quitá métricas, cambiá el título — para cambiar de visualización, dejá una sola métrica elegida.' : 'Elegí una sección completa, o armá una tarjeta a medida con una o más métricas.'}
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />

          {!editing && seccionesDisponibles.length > 0 && (
            <div className="p-4 border-b border-line">
              <p className="text-[11px] uppercase tracking-wide text-ink-600 font-semibold mb-2">Secciones</p>
              <div className="flex flex-wrap gap-2">
                {seccionesDisponibles.map(s => (
                  <button key={s.key} disabled={busy} onClick={() => agregarSeccion(s.key)} title={s.descripcion}
                    className="px-3 py-1.5 rounded-full text-sm font-semibold border border-line bg-surface text-ink-800 hover:bg-canvas hover:border-celeste-300 disabled:opacity-50">
                    {s.titulo}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-4 space-y-4">
            {err && <p className="text-xs text-neg">{err}</p>}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-600 font-semibold mb-2">
                Tarjeta a medida {seleccion.length > 0 && <span className="text-ink-400 normal-case font-normal">· {seleccion.length}/{MAX_COMBO} elegidas</span>}
              </p>
              <div className="space-y-3">
                {Object.entries(agrupar(METRIC_CATALOG)).map(([categoria, metricas]) => (
                  <div key={categoria}>
                    <p className="text-[10px] text-ink-500 font-semibold mb-1">{categoria}</p>
                    <div className="flex flex-wrap gap-2">
                      {metricas.map(m => {
                        const yaElegida = seleccion.includes(m.key);
                        const alcanzoMax = seleccion.length >= MAX_COMBO;
                        const hayCategoricaElegida = seleccion.some(k => getMetricDef(k)?.shape === 'categorico');
                        const chocaConCategorica = seleccion.length > 0 && (hayCategoricaElegida || m.shape === 'categorico');
                        const deshabilitada = !yaElegida && (busy || alcanzoMax || chocaConCategorica);
                        // El motivo real varía — antes siempre decía "solo numéricas", incluso cuando
                        // la causa real era haber llegado al máximo de 4 elegidas.
                        const motivo = deshabilitada
                          ? (alcanzoMax && !chocaConCategorica ? `Ya elegiste el máximo de ${MAX_COMBO} métricas` : 'Solo se pueden combinar métricas numéricas entre sí')
                          : (m.descripcion || undefined);
                        return (
                          <button key={m.key} disabled={deshabilitada} onClick={() => toggleMetrica(m.key)}
                            title={motivo}
                            aria-pressed={yaElegida}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold border disabled:opacity-40 ${yaElegida ? 'bg-celeste-500 text-white border-celeste-500' : 'border-line bg-surface text-ink-800 hover:bg-canvas hover:border-celeste-300'}`}>
                            {m.titulo}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 pt-1">
              {seleccion.length === 1 && viz && (
                <Field label="Visualización">
                  {/* Selección única entre varias opciones → radiogroup/radio (no aria-pressed, que es
                      para toggles independientes) — mismo patrón que el filtro de años en AportesPage
                      y el selector Rendimiento/Aportes/Ambos en DashboardPage. */}
                  <div role="radiogroup" aria-label="Visualización" className="flex flex-wrap gap-2">
                    {defsSeleccionados[0]!.vizDisponibles.map(v => (
                      <button key={v} type="button" disabled={busy} onClick={() => setViz(v)} role="radio" aria-checked={viz === v}
                        className={`px-3 py-1.5 rounded-full text-sm font-semibold border disabled:opacity-50 ${viz === v ? 'bg-celeste-500 text-white border-celeste-500' : 'border-line bg-surface text-ink-800 hover:bg-canvas hover:border-celeste-300'}`}>
                        {VIZ_LABEL[v]}
                      </button>
                    ))}
                  </div>
                </Field>
              )}
              {seleccion.length > 0 && (
                <Field label="Título (opcional)" hint={`Default: "${tituloDefault}"`}>
                  <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder={tituloDefault} className={inputCls} maxLength={60} />
                </Field>
              )}
              {/* Siempre visible (antes se ocultaba con selección vacía) — deseleccionar todo mientras
                  se edita una tarjeta ya guardada no debía dejar al usuario sin Cancelar a la vista. */}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
                <Button onClick={guardarMetrica} disabled={busy || seleccion.length === 0 || (seleccion.length === 1 && !viz)}>
                  {editing ? 'Guardar' : 'Agregar tarjeta'}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function agrupar<T extends { categoria: string }>(items: T[]): Record<string, T[]> {
  const m: Record<string, T[]> = {};
  for (const it of items) (m[it.categoria] ??= []).push(it);
  return m;
}
