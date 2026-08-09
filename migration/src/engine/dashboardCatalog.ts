// =============================================================================
// Catálogo del Dashboard personalizable — SOLO metadata (títulos, categorías, forma del dato,
// visualizaciones compatibles). Los VALORES los calculan los mismos hooks/engine que ya usa cada
// página hoy (regla de oro #1: nunca recalcular un número distinto acá) — ver
// components/dashboard/*.tsx, que envuelve esos hooks para producir un MetricValue.
//
// Dos tipos de tarjeta:
// - `kind:'seccion'`: envuelve un componente YA EXISTENTE tal cual (CedearsResumen, BonosResumen,
//   etc.) — agregar/quitar/reordenar, sin tocar su cálculo ni su UI.
// - `kind:'metrica'`: tarjeta atómica libre — el usuario elige una métrica de este catálogo + una
//   visualización compatible con su `shape`.
// =============================================================================

import type { DashboardWidget, DashboardViz, MetricKey, SeccionKey } from '../types/domain';

export type MetricShape = 'scalar' | 'categorico';
export type Formato = 'usd' | 'usd-compact' | 'pct' | 'num' | 'int' | 'ars-compact';
export type Tono = 'pos' | 'neg' | 'warn' | 'neutral';

export interface MetricDef {
  key: MetricKey;
  categoria: string;
  titulo: string;
  descripcion: string;
  shape: MetricShape;
  vizDisponibles: DashboardViz[];
  vizDefault: DashboardViz;
  // Ruta de la página fuente — "Ver detalle →" en el header de la tarjeta atómica, mismo patrón que
  // el `right` de cada sección (CedearsResumen → /cedears, etc.). Estático (no depende de datos),
  // así que vive acá y no en el componente. Ausente en las 2 métricas de Cartera: no tienen página
  // propia (Distribución vive solo en el Dashboard).
  detalleHref?: string;
}

export interface SeccionDef {
  key: SeccionKey;
  titulo: string;
  descripcion: string;
}

export const SECCION_CATALOG: SeccionDef[] = [
  { key: 'objetivo_capital', titulo: 'Objetivo de capital', descripcion: 'Progreso hacia tu meta de patrimonio — se muestra solo si cargaste un objetivo en el portfolio.' },
  // Título/descripción fijos del catálogo (usados en "Agregar tarjeta" y en el placeholder de
  // "ya no disponible") — la tarjeta en sí es dinámica: agrupa Rendimiento por año Y Aportes, con
  // un selector de modo en su propio header (ver CapitalResumen en DashboardPage.tsx). Antes eran
  // 2 secciones separadas (`aportes` incluida acá); se fusionaron en una sola tarjeta configurable
  // — `aportes` sigue resolviendo acá vía ALIASES, así un layout guardado con la key vieja no
  // rompe ni duplica la tarjeta.
  { key: 'rendimiento_por_anio', titulo: 'Rendimiento por año / Aportes', descripcion: 'Cuánto rindió cada año calendario y/o cuánto capital aportaste — elegís qué ver desde la propia tarjeta.' },
  { key: 'distribucion', titulo: 'Distribución', descripcion: 'Renta fija vs. variable, con objetivo editable y desvío por ticker.' },
  { key: 'cedears', titulo: 'CEDEARs', descripcion: 'Capital, concentración y diversificación sectorial.' },
  { key: 'bonos', titulo: 'Bonos', descripcion: 'Capital, TIR y duración promedio ponderada.' },
  { key: 'radar', titulo: 'Radar', descripcion: 'Tickers en seguimiento y señales de compra agresiva (DCF).' },
  { key: 'patrimonio_broker', titulo: 'Patrimonio por broker', descripcion: 'Dónde está físicamente cada posición.' },
  { key: 'cobros', titulo: 'Cobros', descripcion: 'Dividendos, intereses y amortizaciones cobrados + próximo capital proyectado.' },
  { key: 'liquidez_fci', titulo: 'Finanzas', descripcion: 'Ingresos, egresos y reserva de liquidez ya asignada — compartido entre todos tus portfolios.' },
  { key: 'macro', titulo: 'Contexto macro', descripcion: 'Semáforos de mercado, de un vistazo.' },
];

export const METRIC_CATALOG: MetricDef[] = [
  { key: 'distribucion_categoria', categoria: 'Cartera', titulo: 'Distribución por categoría', descripcion: 'Renta fija / variable / liquidez — sin los controles de objetivo de la sección Distribución.', shape: 'categorico', vizDisponibles: ['donut', 'bar', 'table'], vizDefault: 'donut' },
  { key: 'distribucion_tipo_activo', categoria: 'Cartera', titulo: 'Distribución por tipo de activo', descripcion: 'CEDEARs / bonos / ETFs / acciones (US y AR) / cash.', shape: 'categorico', vizDisponibles: ['donut', 'bar', 'table'], vizDefault: 'donut' },
  { key: 'cedears_capital', categoria: 'CEDEARs', titulo: 'Capital en CEDEARs', descripcion: '', shape: 'scalar', vizDisponibles: ['stat'], vizDefault: 'stat', detalleHref: '/cedears' },
  { key: 'cedears_mayor_posicion', categoria: 'CEDEARs', titulo: 'Mayor posición (CEDEARs)', descripcion: 'Ticker con mayor % del capital en CEDEARs.', shape: 'scalar', vizDisponibles: ['stat'], vizDefault: 'stat', detalleHref: '/cedears' },
  { key: 'cedears_por_sector', categoria: 'CEDEARs', titulo: 'CEDEARs por sector', descripcion: '', shape: 'categorico', vizDisponibles: ['donut', 'bar', 'table'], vizDefault: 'donut', detalleHref: '/cedears' },
  { key: 'bonos_capital', categoria: 'Bonos', titulo: 'Capital en bonos', descripcion: '', shape: 'scalar', vizDisponibles: ['stat'], vizDefault: 'stat', detalleHref: '/bonos' },
  { key: 'bonos_tir_promedio', categoria: 'Bonos', titulo: 'TIR promedio', descripcion: 'Promedio ponderado por capital.', shape: 'scalar', vizDisponibles: ['stat'], vizDefault: 'stat', detalleHref: '/bonos' },
  { key: 'bonos_duracion_promedio', categoria: 'Bonos', titulo: 'Duración promedio', descripcion: 'Duración de Macaulay, promedio ponderado por capital.', shape: 'scalar', vizDisponibles: ['stat'], vizDefault: 'stat', detalleHref: '/bonos' },
  { key: 'bonos_grado_inversion', categoria: 'Bonos', titulo: '% grado inversión', descripcion: '', shape: 'scalar', vizDisponibles: ['stat'], vizDefault: 'stat', detalleHref: '/bonos' },
  { key: 'bonos_proximo_capital', categoria: 'Bonos', titulo: 'Próximo capital proyectado', descripcion: 'Amortización o rescate al vencimiento — no es renta.', shape: 'scalar', vizDisponibles: ['stat'], vizDefault: 'stat', detalleHref: '/cupones' },
  { key: 'radar_compra_agresiva', categoria: 'Radar', titulo: 'Compra agresiva (Radar)', descripcion: 'Tickers en seguimiento con margen de seguridad amplio (DCF).', shape: 'scalar', vizDisponibles: ['stat'], vizDefault: 'stat', detalleHref: '/radar' },
  { key: 'cobros_total', categoria: 'Cobros', titulo: 'Cobrado total', descripcion: 'Dividendos + intereses + amortizaciones.', shape: 'scalar', vizDisponibles: ['stat'], vizDefault: 'stat', detalleHref: '/cupones' },
  { key: 'cobros_disponible', categoria: 'Cobros', titulo: 'Disponible para reinvertir', descripcion: '', shape: 'scalar', vizDisponibles: ['stat'], vizDefault: 'stat', detalleHref: '/cupones' },
  { key: 'macro_semaforos', categoria: 'Macro', titulo: 'Semáforos macro', descripcion: 'Cuántos indicadores en verde / atención / estrés.', shape: 'categorico', vizDisponibles: ['donut', 'bar'], vizDefault: 'donut', detalleHref: '/macro' },
  { key: 'liquidez_fci', categoria: 'Liquidez', titulo: 'FCI + billetera', descripcion: 'En pesos — compartido entre todos tus portfolios.', shape: 'scalar', vizDisponibles: ['stat'], vizDefault: 'stat', detalleHref: '/finanzas' },
  { key: 'liquidez_disponible', categoria: 'Liquidez', titulo: 'Disponible', descripcion: 'En pesos — ingresos menos egresos del flujo de caja, compartido entre todos tus portfolios.', shape: 'scalar', vizDisponibles: ['stat'], vizDefault: 'stat', detalleHref: '/finanzas' },
  { key: 'liquidez_sin_asignar', categoria: 'Liquidez', titulo: 'Sin asignar', descripcion: 'En pesos — disponible que todavía no se colocó en ningún destino, compartido entre todos tus portfolios.', shape: 'scalar', vizDisponibles: ['stat'], vizDefault: 'stat', detalleHref: '/finanzas' },
];

// Layout que hoy está hardcodeado en el Dashboard — se usa cuando el usuario todavía no personalizó
// (sin fila en dashboard_layout) O cuando personalizó y después le quedó un layout vacío. Se RENDERIZA
// nomás, nunca se escribe a la base al leerlo — así se elimina cualquier carrera de "sembrar la
// primera vez" (ver diseño). IDs fijos (no random) porque es una constante, no algo creado en runtime.
export const DEFAULT_LAYOUT: DashboardWidget[] = [
  { id: 'default-objetivo-capital', kind: 'seccion', seccion: 'objetivo_capital' },
  { id: 'default-rendimiento-por-anio', kind: 'seccion', seccion: 'rendimiento_por_anio' },
  { id: 'default-distribucion', kind: 'seccion', seccion: 'distribucion' },
  { id: 'default-cedears', kind: 'seccion', seccion: 'cedears' },
  { id: 'default-bonos', kind: 'seccion', seccion: 'bonos' },
  { id: 'default-radar', kind: 'seccion', seccion: 'radar' },
  { id: 'default-patrimonio-broker', kind: 'seccion', seccion: 'patrimonio_broker' },
  { id: 'default-cobros', kind: 'seccion', seccion: 'cobros' },
  { id: 'default-liquidez-fci', kind: 'seccion', seccion: 'liquidez_fci' },
  { id: 'default-macro', kind: 'seccion', seccion: 'macro' },
];

// Renames/fusiones de key (métrica o sección). Se resuelve ANTES de buscar en el catálogo, así un
// layout viejo con una key renombrada (o fusionada a otra tarjeta, como acá) sigue funcionando.
// `aportes` era su propia sección hasta que se fusionó con `rendimiento_por_anio` en una sola
// tarjeta configurable — un layout guardado con la key vieja resuelve al mismo slot, en vez de
// mostrar "esta tarjeta ya no está disponible". `useDashboardLayout.ts` además deduplica por key
// YA resuelta, así un layout que llegó a tener las dos secciones a la vez no termina mostrando el
// mismo contenido dos veces.
export const ALIASES: Record<string, string> = {
  aportes: 'rendimiento_por_anio',
};

export function resolveKey(key: string): string { return ALIASES[key] ?? key; }

export function getMetricDef(key: string): MetricDef | undefined {
  return METRIC_CATALOG.find(m => m.key === resolveKey(key));
}
export function getSeccionDef(key: string): SeccionDef | undefined {
  return SECCION_CATALOG.find(s => s.key === resolveKey(key));
}

// Si el viz guardado ya no es válido para esa métrica (el catálogo cambió), cae en silencio al
// default de la métrica — a diferencia de una métrica/sección que ya no existe en absoluto (eso lo
// resuelve WidgetGrid con una tarjeta placeholder, nunca desapareciendo en silencio), esto es cosmético.
export function resolveViz(metricKey: string, viz: DashboardViz): DashboardViz {
  const def = getMetricDef(metricKey);
  if (!def) return viz;
  return def.vizDisponibles.includes(viz) ? viz : def.vizDefault;
}

// Título default de una tarjeta 'metrica' cuando el usuario no puso uno propio — UN solo lugar
// (antes AddWidgetModal calculaba su preview con un criterio y WidgetGrid derivaba el título real con
// otro: "Bonos" vs. "Capital en bonos · TIR promedio" para la MISMA combinación). 1 métrica: su
// propio título de catálogo. 2+: el nombre de categoría si todas la comparten (ej. "Bonos"), si no,
// la unión de los títulos — mismo criterio en ambos lados, así el preview del constructor y la
// tarjeta ya guardada siempre coinciden.
export function tituloWidget(metricas: string[]): string {
  if (metricas.length === 1) return getMetricDef(metricas[0])?.titulo ?? metricas[0];
  const defs = metricas.map(k => getMetricDef(k));
  const categorias = new Set(defs.map(d => d?.categoria).filter((c): c is string => !!c));
  if (categorias.size === 1 && defs.every(d => !!d)) return [...categorias][0];
  return metricas.map((k, i) => defs[i]?.titulo ?? k).join(' · ');
}

// =============================================================================
// MetricValue: lo que un componente de métrica atómica produce, para que el renderer genérico
// (StatWidget/DonutWidget/BarWidget/TableWidget) lo pinte sin conocer de dónde salió el número.
// `status` explícito (no "ausente = cargando") para no mostrar un guion/cero que se confunda con un
// dato real mientras carga — mismo criterio que el resto de las secciones del Dashboard, que
// retornan null mientras cargan en vez de mostrar un 0 provisorio.
// =============================================================================
export type MetricValue =
  | { status: 'loading' }
  | { status: 'empty'; motivo: string }
  // `dp` override opcional: por default cada `format` tiene su propia precisión (fmtValor en
  // viz.tsx), pero cuando la MISMA métrica también se ve en su sección original con otra precisión
  // (ej. "TIR promedio" en BonosResumen usa 1 decimal), se pasa acá para que no se vean dos números
  // distintos del mismo dato en la misma página.
  | { status: 'ok'; shape: 'scalar'; value: number | null; label?: string; sub?: string; format?: Formato; dp?: number; tone?: Tono }
  | { status: 'ok'; shape: 'categorico'; items: { label: string; value: number; color?: string }[]; format?: Formato };
