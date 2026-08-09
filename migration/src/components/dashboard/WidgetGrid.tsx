import type { ReactNode } from 'react';
import { ChevronUp, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { Card, CardHeader } from '../ui';
import { getMetricDef, getSeccionDef, resolveKey, tituloWidget } from '../../engine/dashboardCatalog';
import type { DashboardWidget, MetricKey, SeccionKey } from '../../types/domain';
import { METRIC_COMPONENTS, MetricWidgetRenderer, type MetricContext } from './metrics';

const ctrlBtn = 'w-7 h-7 inline-flex items-center justify-center rounded-full text-ink-600 hover:text-ink-900 hover:bg-canvas disabled:opacity-30 disabled:hover:bg-transparent';

// Motor de renderizado del Dashboard personalizable: recorre el layout guardado y, para cada
// tarjeta, decide qué pintar. `seccionNodes` son elementos YA armados por DashboardPage (JSX es
// perezoso — armar `<CedearsResumen/>` acá no ejecuta sus hooks hasta que React lo monte de verdad,
// así que una sección que el usuario sacó del layout simplemente nunca corre sus queries).
export function WidgetGrid({
  layout, seccionNodes, ctx, personalizando, onMover, onEliminar, onEditar,
}: {
  layout: DashboardWidget[];
  seccionNodes: Partial<Record<SeccionKey, ReactNode>>;
  ctx: MetricContext;
  personalizando: boolean;
  onMover: (id: string, dir: 'arriba' | 'abajo') => void;
  onEliminar: (id: string) => void;
  onEditar: (widget: Extract<DashboardWidget, { kind: 'metrica' }>) => void;
}) {
  return (
    <>
      {layout.map((w, i) => {
        let titulo: string;
        let sub: string | undefined;
        let contenido: ReactNode;
        let enCatalogo: boolean;
        // Distinto de "no está en el catálogo" (se renombró/borró la key — ver más abajo): esto es
        // una sección VÁLIDA que hoy no tiene nada que mostrar (ej. "Bonos" sin bonos cargados) — el
        // componente ya se auto-oculta (null) igual que hacía antes de existir el Dashboard
        // personalizable. En modo Personalizar necesita igual un lugar visible para sus controles
        // (mover/eliminar), porque si no quedan flotando sobre nada.
        let sinDatosAhora = false;

        // Resolver alias ANTES de indexar cualquier catálogo/registro — si esto solo se resolviera
        // en getMetricDef/getSeccionDef pero no acá, una key renombrada quedaba en un estado
        // inconsistente: el catálogo la reconoce pero el componente/nodo no se encuentra nunca.
        if (w.kind === 'seccion') {
          const key = resolveKey(w.seccion) as SeccionKey;
          const def = getSeccionDef(key);
          enCatalogo = !!def;
          titulo = def?.titulo ?? w.seccion;
          sub = undefined; // las secciones arman su propio CardHeader — no se envuelve de nuevo
          const nodo = enCatalogo ? seccionNodes[key] : undefined;
          sinDatosAhora = enCatalogo && nodo == null;
          contenido = nodo ?? null;
        } else {
          const metricas = w.metricas.map(m => resolveKey(m) as MetricKey);
          const defs = metricas.map(k => getMetricDef(k));
          // No alcanza con "todas existen en el catálogo": si es una combinación (2+), TODAS tienen
          // que ser 'scalar' — una categórica mezclada en una grilla de números no tiene sentido
          // (el constructor ya lo impide al armar la tarjeta; esto es la misma regla del lado de
          // lectura, por si una fila vieja o corrupta la viola). Si CUALQUIER métrica de la
          // combinación no está disponible, se trata la tarjeta ENTERA como no disponible — más
          // simple y más seguro que degradarla parcialmente.
          enCatalogo = metricas.length > 0 && defs.every(d => !!d && !!METRIC_COMPONENTS[d.key])
            && (metricas.length === 1 || defs.every(d => d!.shape === 'scalar'));
          titulo = w.titulo ?? tituloWidget(metricas);
          sub = personalizando ? undefined : (metricas.length === 1 ? defs[0]?.descripcion || undefined : undefined);
          // Las tarjetas 'metrica' siempre renderizan algo (Loading/Empty/valor real, vía
          // MetricWidgetRenderer → Render en metrics.tsx) — nunca quedan sin nodo, así que no aplica
          // el caso "sinDatosAhora". MetricWidgetRenderer arma su PROPIO Card+CardHeader (con
          // badge/link — ver metrics.tsx), así que `sub` viaja como prop en vez de envolverse acá.
          contenido = enCatalogo
            ? <MetricWidgetRenderer ctx={ctx} metricas={metricas} viz={w.viz} titulo={titulo} sub={sub} personalizando={personalizando} />
            : null;
        }

        if (!enCatalogo) {
          // Nunca desaparece en silencio (una métrica/sección guardada dejó de existir en el
          // catálogo, ej. tras un rename mal migrado) — se ve como placeholder con botón Eliminar,
          // no como si el dato fuera 0 o el layout estuviera roto.
          return (
            <Card key={w.id}>
              <CardHeader title={titulo} sub="Esta tarjeta ya no está disponible." />
              <div className="p-3">
                <button onClick={() => onEliminar(w.id)}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-neg hover:underline">
                  <Trash2 className="w-4 h-4" /> Eliminar
                </button>
              </div>
            </Card>
          );
        }

        if (sinDatosAhora) {
          // Fuera de modo Personalizar, una sección sin datos no debe ocupar espacio — mismo
          // comportamiento que antes de que existiera el Dashboard personalizable.
          if (!personalizando) return null;
          return (
            <div key={w.id}>
              <Controles i={i} total={layout.length} onMover={dir => onMover(w.id, dir)} onEliminar={() => onEliminar(w.id)} />
              <Card><CardHeader title={titulo} sub="Sin datos en este portfolio — se mostrará cuando los haya." /></Card>
            </div>
          );
        }

        // Tanto 'seccion' como 'metrica' llegan acá ya siendo un <Card> completo (armado por el
        // componente, no por WidgetGrid) — envolver de nuevo duplicaría el borde.
        const cuerpo = contenido;

        if (!personalizando) return <div key={w.id}>{cuerpo}</div>;

        return (
          <div key={w.id}>
            <Controles i={i} total={layout.length} onMover={dir => onMover(w.id, dir)}
              // Resolver alias ACÁ también (no solo al renderizar, arriba) — si no, el modal de edición
              // arranca con las keys viejas sin resolver, el chip de la métrica renombrada aparece
              // "no elegida" (comparación contra la key canónica del catálogo) y un click la duplica
              // en vez de deseleccionarla.
              onEditar={w.kind === 'metrica' ? () => onEditar({ ...w, metricas: w.metricas.map(m => resolveKey(m) as MetricKey) }) : undefined}
              onEliminar={() => onEliminar(w.id)} />
            {cuerpo}
          </div>
        );
      })}
    </>
  );
}

// Cluster de controles del modo Personalizar. Antes flotaba "absolute -top-2 -right-2" sobre la
// esquina de la tarjeta para no tapar el slot `right` del CardHeader — pero eso solo funcionaba
// cuando `right` era chico: con badges que envuelven a dos líneas o contenido ancho (varias
// secciones tienen eso), el cluster igual lo tapaba parcialmente. En vez de perseguir cada caso,
// va en su propia fila ARRIBA de la tarjeta (flujo normal, no absolute) — cero superposición
// posible con nada del contenido, para cualquier `right` que tenga la sección.
function Controles({ i, total, onMover, onEditar, onEliminar }: {
  i: number; total: number; onMover: (dir: 'arriba' | 'abajo') => void; onEditar?: () => void; onEliminar: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-0.5 mb-1.5">
      <button onClick={() => onMover('arriba')} disabled={i === 0} className={ctrlBtn} aria-label="Mover arriba"><ChevronUp className="w-4 h-4" /></button>
      <button onClick={() => onMover('abajo')} disabled={i === total - 1} className={ctrlBtn} aria-label="Mover abajo"><ChevronDown className="w-4 h-4" /></button>
      {onEditar && <button onClick={onEditar} className={ctrlBtn} aria-label="Editar tarjeta"><Pencil className="w-4 h-4" /></button>}
      <button onClick={onEliminar} className={`${ctrlBtn} hover:text-neg`} aria-label="Eliminar tarjeta"><Trash2 className="w-4 h-4" /></button>
    </div>
  );
}
