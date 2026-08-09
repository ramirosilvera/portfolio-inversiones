// Tarjetas atómicas del Dashboard personalizable — una por MetricKey (engine/dashboardCatalog.ts).
// Cada una es un componente chico y AUTOCONTENIDO que llama exactamente el mismo hook/engine que ya
// usa la sección equivalente (CedearsResumen, BonosResumen, etc. en DashboardPage.tsx) — regla de
// oro #1: nunca un cálculo nuevo o distinto. React Query dedupea por query key, así que si el usuario
// agrega varias tarjetas de la misma familia (ej. 2 métricas de CEDEARs), el hook subyacente
// (useCedearsCalc) se pide una sola vez igual — no hace falta un store central para evitar refetching.
//
// Cada componente termina en MetricShell (abajo) — mismo patrón que las secciones (CedearsResumen,
// etc.) para el modo normal: arma su propio Card+CardHeader con badge/tono/link "Ver detalle →" que
// reusan EXACTAMENTE el mismo hook/constante que ya usa la sección equivalente para lo mismo. Esto es
// deliberado: WidgetGrid arma el CardHeader de una sección ANTES de conocer sus datos (mira
// seccionNodes, ya renderizado); para que una tarjeta atómica tenga un badge que depende de datos
// que solo ELLA calcula, tiene que armar su propio header — la alternativa (que WidgetGrid llame un
// hook por widget dentro de un .map()) viola las reglas de hooks.
//
// MetricShell TAMBIÉN sabe pintarse "compacto" (una tarjeta combinando 2+ métricas escalares en una
// sola Card — ver MetricWidgetRenderer al final) leyendo un Context en vez de un prop: así ningún
// componente puede "olvidarse" de manejar el modo combo (no hay una rama que alguien tenga que
// acordarse de escribir en cada uno de los 15) — el chequeo vive en UN solo lugar.
//
// `ctx` es SOLO para las 2 métricas de "Cartera" (distribución), que no tienen un hook propio — usan
// `alloc`/`patrimonio` ya calculados por el componente principal del Dashboard (mismo dato que el
// Hero y la sección Distribución), pasados por prop para no duplicar ni tocar ese cálculo sensible
// (alimenta el registro histórico de rendimiento — ver DashboardPage.tsx).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Flame } from 'lucide-react';
import { usePortfolios } from '../../hooks/usePortfolios';
import { useMacro } from '../../hooks/usePosiciones';
import { useChartTheme } from '../../hooks/usePrefs';
import { useCedearsCalc, resumenCedears, useObjetivoConcentracion } from '../../hooks/useCedears';
import { SIN_CLASIFICAR_COLOR, CONCENTRACION_POSICION_ALERTA } from '../../engine/cedears';
import { PIE_COLORS, Card, CardHeader, Badge, fmtPct } from '../ui';
import { useBonosCalc, useObjetivoDuracion, resumenBonos } from '../../hooks/useBonos';
import { useWatchlist } from '../../hooks/useWatchlist';
import { useCikMap } from '../../hooks/useCikMap';
import { useDcfInputs, type StoredDcf } from '../../hooks/useDcfInputs';
import { useRadarTicker } from '../../hooks/useRadarTicker';
import { useCobros } from '../../hooks/useCobros';
import { useFlujo } from '../../hooks/useFlujo';
import { useAmortizaciones } from '../../hooks/useAmortizaciones';
import { resumenCobros } from '../../engine/cobros';
import { resumenFlujo } from '../../engine/flujo';
import { SEMAFOROS, resumenMacro, type Lectura } from '../../engine/semaforos';
import { agruparPorCategoria, agruparPorTipo } from '../../engine/distribucion';
import { capitalCalendar, agruparCuotasPorPosicion, type CapitalBond } from '../../engine/coupons';
import { LoadingViz, EmptyViz, StatViz, StatCompactoViz, DonutViz, BarViz, TableViz } from './viz';
import { getMetricDef, resolveViz, type MetricValue } from '../../engine/dashboardCatalog';
import type { AssetType, DashboardViz, MetricKey } from '../../types/domain';

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export interface MetricContext {
  alloc: { ticker: string; mkt: number; target: number | null; tipo: AssetType }[];
  patrimonio: number;
  isLoading: boolean;
}

// `titulo`/`sub`/`detalleHref` ya resueltos por quien renderiza (WidgetGrid para 1 sola métrica,
// MetricWidgetRenderer para una combinación — ver el final del archivo) a partir del catálogo, nunca
// un string repetido a mano en cada componente. `personalizando`: mientras se edita el layout, el
// link "Ver detalle →" se suprime (un click ahí navega fuera del Dashboard a mitad de una
// reordenada) — el badge, si lo hay, se mantiene pero deja de ser clickeable.
export type MetricComponent = ComponentType<{ ctx: MetricContext; viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }>;

// 'card' (default): cada componente es dueño de su propia Card+CardHeader, como las secciones.
// 'compacto': el componente vive DENTRO de la Card de otro (una tarjeta combinada) — se pinta como
// un tile chico sin su propio borde/header/badge/link. Se lee vía Context, no vía prop, para que sea
// estructuralmente imposible que un componente "se olvide" de respetarlo (ver MetricShell).
const MetricModoContext = createContext<'card' | 'compacto'>('card');

// Frame compartido por las 15 tarjetas — mismo borde/spacing que las secciones en modo 'card'; en
// modo 'compacto' ignora `sub`/`right` (no tienen lugar en un tile chico) y pinta un Stat mini.
function MetricShell({ titulo, sub, right, mv, viz }: { titulo: string; sub?: string; right?: ReactNode; mv: MetricValue; viz: DashboardViz }) {
  const modo = useContext(MetricModoContext);
  if (modo === 'compacto') return <StatCompactoViz titulo={titulo} mv={mv} />;
  return <Card><CardHeader title={titulo} sub={sub} right={right} /><Render mv={mv} viz={viz} /></Card>;
}

// "Ver detalle →" — mismo texto/estilo que usa cada sección para su propio link. `null` cuando la
// métrica no tiene página fuente (las 2 de Cartera) o mientras se está personalizando el layout.
function VerDetalle({ href, personalizando }: { href: string | undefined; personalizando: boolean }) {
  if (personalizando || !href) return null;
  return <Link to={href} className="text-[11px] text-celeste-600 hover:underline">Ver detalle →</Link>;
}

// Envuelve un badge en el link de detalle (mismo patrón que CedearsResumen/BonosResumen/RadarResumen:
// el badge ENTERO es clickeable) — si no hay link (personalizando, o sin detalleHref), el badge se
// muestra solo, sin envoltura.
function BadgeConLink({ href, personalizando, children }: { href: string | undefined; personalizando: boolean; children: ReactNode }) {
  if (personalizando || !href) return <>{children}</>;
  return <Link to={href} className="inline-flex items-center gap-1.5">{children}</Link>;
}

// Pinta un MetricValue con el renderer que corresponda a `viz` — separa "qué número es" (calculado
// arriba, siempre igual) de "cómo se ve" (elegido por el usuario al armar la tarjeta). Se usa SOLO en
// modo 'card' (MetricShell) — el modo 'compacto' pasa directo por StatCompactoViz.
function Render({ mv, viz }: { mv: MetricValue; viz: DashboardViz }) {
  if (mv.status === 'loading') return <LoadingViz />;
  if (mv.status === 'empty') return <EmptyViz motivo={mv.motivo} />;
  if (mv.shape === 'scalar') return <StatViz mv={mv} />;
  // shape === 'categorico'
  if (viz === 'bar') return <BarViz mv={mv} />;
  if (viz === 'table') return <TableViz mv={mv} />;
  return <DonutViz mv={mv} />;
}

// ── Cartera (usan ctx, no hooks propios) ───────────────────────────────────────
function DistribucionCategoriaMetric({ ctx, viz, titulo, sub }: { ctx: MetricContext; viz: DashboardViz; titulo: string; sub?: string }) {
  const grupos = agruparPorCategoria(ctx.alloc);
  const mv: MetricValue = ctx.isLoading ? { status: 'loading' }
    : grupos.length === 0 ? { status: 'empty', motivo: 'Sin posiciones valuadas todavía.' }
    : { status: 'ok', shape: 'categorico', format: 'usd-compact', items: grupos.map(g => ({ label: g.label, value: g.value, color: g.color })) };
  return <MetricShell titulo={titulo} sub={sub} mv={mv} viz={viz} />;
}

function DistribucionTipoActivoMetric({ ctx, viz, titulo, sub }: { ctx: MetricContext; viz: DashboardViz; titulo: string; sub?: string }) {
  const grupos = agruparPorTipo(ctx.alloc);
  const mv: MetricValue = ctx.isLoading ? { status: 'loading' }
    : grupos.length === 0 ? { status: 'empty', motivo: 'Sin posiciones valuadas todavía.' }
    : { status: 'ok', shape: 'categorico', format: 'usd-compact', items: grupos.map(g => ({ label: g.label, value: g.value, color: g.color })) };
  return <MetricShell titulo={titulo} sub={sub} mv={mv} viz={viz} />;
}

// ── CEDEARs (useCedearsCalc, igual que CedearsResumen/CedearsPage) ────────────
function useCedearsResumenValue() {
  const { active } = usePortfolios();
  const { cedears, cedearsCalc, isLoading } = useCedearsCalc(active?.id);
  return { resumen: isLoading || cedears.length === 0 ? null : resumenCedears(cedearsCalc), isLoading };
}

function CedearsCapitalMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { resumen, isLoading } = useCedearsResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen ? { status: 'empty', motivo: 'Sin CEDEARs en este portfolio.' }
    : { status: 'ok', shape: 'scalar', value: resumen.totalMkt, format: 'usd-compact' };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

function CedearsMayorPosicionMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { resumen, isLoading } = useCedearsResumenValue();
  // Mismo umbral que el Stat "Mayor posición" de CedearsResumen (tono warn si >= 40% del capital).
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen || !resumen.mayorPosicion ? { status: 'empty', motivo: 'Sin CEDEARs en este portfolio.' }
    : {
        status: 'ok', shape: 'scalar', value: resumen.mayorPosicion.pct, format: 'pct',
        label: `${resumen.mayorPosicion.ticker} · ${fmtPct(resumen.mayorPosicion.pct, 0)}`,
        tone: resumen.mayorPosicion.pct >= CONCENTRACION_POSICION_ALERTA ? 'warn' : 'neutral',
      };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

function CedearsPorSectorMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { resumen, isLoading } = useCedearsResumenValue();
  // Umbral de concentración sectorial — solo esta tarjeta lo necesita (para el badge), así que el
  // hook vive acá y no en useCedearsResumenValue (evita una suscripción a localStorage sin uso en
  // las otras 2 tarjetas de CEDEARs).
  const { active } = usePortfolios();
  const { sectorPct: concentracionSectorPct } = useObjetivoConcentracion(active?.id);
  // Mismo criterio de color que CedearsPage.tsx: "Sin sector" en gris neutro (no compite por un
  // color de PIE_COLORS como si fuera un sector real), los sectores reales ciclan PIE_COLORS con su
  // propio contador — así el mismo dato se ve con los mismos colores acá y en /cedears.
  let sectorRealIdx = 0;
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen || resumen.porSector.length === 0 ? { status: 'empty', motivo: 'Sin CEDEARs en este portfolio.' }
    : {
        status: 'ok', shape: 'categorico', format: 'usd-compact',
        items: resumen.porSector.map(s => ({
          label: s.sector, value: s.pct * resumen.totalMkt,
          color: s.sector === 'Sin sector' ? SIN_CLASIFICAR_COLOR : PIE_COLORS[sectorRealIdx++ % PIE_COLORS.length],
        })),
      };
  // Badge del mayor sector — mismo campo/umbral que el header de CedearsResumen.
  const mayorSector = resumen && resumen.porSector.length > 0 ? resumen.porSector[0] : null;
  const right = mayorSector
    ? <BadgeConLink href={detalleHref} personalizando={personalizando}>
        <Badge tone={mayorSector.pct * 100 >= concentracionSectorPct ? 'warn' : 'accent'}>{mayorSector.sector} {fmtPct(mayorSector.pct, 0)}</Badge>
      </BadgeConLink>
    : <VerDetalle href={detalleHref} personalizando={personalizando} />;
  return <MetricShell titulo={titulo} sub={sub} right={right} mv={mv} viz={viz} />;
}

// ── Bonos (useBonosCalc, igual que BonosResumen/BonosPage) ────────────────────
function useBonosResumenValue() {
  const { active } = usePortfolios();
  const { bonos, bonosCalc, isLoading } = useBonosCalc(active?.id);
  const { data: macro = {} } = useMacro();
  const riskFree = (macro as Record<string, number | null>).dgs10 != null ? (macro as Record<string, number | null>).dgs10! / 100 : null;
  return { bonos, resumen: isLoading || bonos.length === 0 ? null : resumenBonos(bonosCalc, riskFree), isLoading };
}

function BonosCapitalMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { resumen, isLoading } = useBonosResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen ? { status: 'empty', motivo: 'Sin bonos en este portfolio.' }
    : { status: 'ok', shape: 'scalar', value: resumen.totalMkt, format: 'usd-compact' };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

function BonosTirPromedioMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { resumen, isLoading } = useBonosResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen || resumen.tirPromedio == null ? { status: 'empty', motivo: 'Sin TIR calculable (faltan datos de cupón/vencimiento).' }
    : { status: 'ok', shape: 'scalar', value: resumen.tirPromedio, format: 'pct', tone: resumen.tirPromedio >= 0 ? 'pos' : 'neg' };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

function BonosDuracionPromedioMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { resumen, isLoading } = useBonosResumenValue();
  // Objetivo personal de duración máxima — solo esta tarjeta lo necesita (para el badge), así que el
  // hook vive acá y no en useBonosResumenValue (evita una suscripción a localStorage sin uso en las
  // otras 3 tarjetas de Bonos).
  const { active } = usePortfolios();
  const { maxDuracionAnios } = useObjetivoDuracion(active?.id);
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen || resumen.duracionPromedio == null ? { status: 'empty', motivo: 'Sin duración calculable (faltan datos de cupón/vencimiento).' }
    // dp:1 — mismo redondeo que BonosResumen (fmtNum(duracionPromedio, 1)), para no mostrar "6.30"
    // acá y "6.3a" en la sección del mismo dato.
    : { status: 'ok', shape: 'scalar', value: resumen.duracionPromedio, format: 'num', dp: 1, sub: 'años (Macaulay, ponderado)' };
  // Badge: solo el objetivo + tono (no repite la duración — ya es el número grande de la tarjeta).
  const cumpleObjetivo = resumen?.duracionPromedio != null && resumen.duracionPromedio <= maxDuracionAnios;
  const right = resumen?.duracionPromedio != null
    ? <BadgeConLink href={detalleHref} personalizando={personalizando}><Badge tone={cumpleObjetivo ? 'pos' : 'warn'}>máx. {maxDuracionAnios}a</Badge></BadgeConLink>
    : <VerDetalle href={detalleHref} personalizando={personalizando} />;
  return <MetricShell titulo={titulo} sub={sub} right={right} mv={mv} viz={viz} />;
}

function BonosGradoInversionMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { resumen, isLoading } = useBonosResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !resumen ? { status: 'empty', motivo: 'Sin bonos en este portfolio.' }
    // dp:0 — mismo redondeo que BonosResumen (fmtPct(x, 0)).
    : { status: 'ok', shape: 'scalar', value: resumen.distribucionGrado.gradoInversion, format: 'pct', dp: 0 };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

// Mismo cálculo EXACTO que `proximoCapital` en DashboardPage.tsx (capitalCalendar sobre
// amortizaciones_programadas, filtrando cuotas ya cobradas) — reusado acá para que esta tarjeta
// atómica también muestre un número real, no solo un remito a la tarjeta Cobros.
function useBonosProximoCapitalValue() {
  const { active } = usePortfolios();
  const { bonos, isLoading: bonosLoading } = useBonosCalc(active?.id);
  const { data: amortizaciones = [], isLoading: amortLoading } = useAmortizaciones();
  const cuotasPorPosicion = useMemo(() => agruparCuotasPorPosicion(amortizaciones), [amortizaciones]);
  const hoy = new Date();
  const hoyISO = hoy.toISOString().slice(0, 10);
  const proximoCapital = useMemo(() => {
    const capitalBonds: CapitalBond[] = bonos.map(p => ({
      ticker: p.ticker, faceValue: p.cantidad, vencimiento: p.vencimiento,
      valorResidual: p.amortizable && p.valor_residual != null ? p.valor_residual : 1,
      amortizaciones: (cuotasPorPosicion.get(p.id) ?? []).filter(c => c.fecha >= hoyISO),
    }));
    if (capitalBonds.length === 0) return null;
    return capitalCalendar(capitalBonds, hoy.getFullYear(), hoy.getMonth() + 1, 12).find(m => m.total > 0) ?? null;
  }, [bonos, cuotasPorPosicion, hoyISO, hoy.getFullYear(), hoy.getMonth()]);
  return { bonos, proximoCapital, isLoading: bonosLoading || amortLoading };
}

function BonosProximoCapitalMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { bonos, proximoCapital, isLoading } = useBonosProximoCapitalValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : bonos.length === 0 ? { status: 'empty', motivo: 'Sin bonos en este portfolio.' }
    : !proximoCapital ? { status: 'empty', motivo: 'Sin capital proyectado en los próximos 12 meses.' }
    : {
        status: 'ok', shape: 'scalar', value: proximoCapital.total, format: 'usd-compact',
        sub: `${MESES_CORTOS[proximoCapital.month - 1]} ${proximoCapital.year} — amortización o rescate, no es renta`,
      };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

// ── Radar (useWatchlist + useRadarTicker por probe, igual que RadarResumen) ───
function useRadarCompraAgresivaValue() {
  const { data: items = [], isLoading } = useWatchlist();
  const { map: cikMap, isLoading: cikLoading } = useCikMap();
  const { data: macro = {} } = useMacro();
  const riskFree = ((macro as Record<string, number | null>).dgs10 ?? 4.3) / 100;
  const { map: dcfMap } = useDcfInputs();
  const [agresivos, setAgresivos] = useState<Set<string>>(new Set());
  // Tickers que YA reportaron al menos una vez (sea agresivo o no) — separado de `agresivos` para
  // poder distinguir "todavía calculando" de "el resultado es 0 compras agresivas". Sin esto, la
  // tarjeta mostraba "0 de N" mientras cada probe (fundamentals/DCF, varios segundos en frío) seguía
  // resolviendo — un 0 provisorio indistinguible del resultado real, justo lo que este mismo archivo
  // documenta evitar (ver el comentario de `status` en engine/dashboardCatalog.ts).
  //
  // OJO: `agresiva` de useRadarTicker es `false` TAMBIÉN mientras el DCF todavía está en vuelo (no
  // solo cuando ya se resolvió sin compra agresiva) — así que un probe no puede reportarse "listo"
  // apenas monta (ver RadarProbe abajo, que ahora manda también `listo`), o el gate de arriba queda
  // inútil: reportados se llena en el primer render con el `false` provisorio de TODOS los tickers,
  // antes de que ningún DCF haya terminado.
  const [reportados, setReportados] = useState<Set<string>>(new Set());

  const onProbe = useCallback((ticker: string, agresiva: boolean, listo: boolean) => {
    setAgresivos(prev => {
      if (prev.has(ticker) === agresiva) return prev;
      const next = new Set(prev);
      if (agresiva) next.add(ticker); else next.delete(ticker);
      return next;
    });
    if (listo) setReportados(prev => (prev.has(ticker) ? prev : new Set(prev).add(ticker)));
  }, []);

  const probesListos = items.length === 0 || items.every(it => reportados.has(it.ticker.toUpperCase()));
  return { items, cikMap, cikLoading, riskFree, dcfMap, agresivos, onProbe, isLoading: isLoading || !probesListos };
}

function RadarCompraAgresivaMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { items, cikMap, cikLoading, riskFree, dcfMap, agresivos, onProbe, isLoading } = useRadarCompraAgresivaValue();
  const mv: MetricValue = items.length === 0 && !isLoading ? { status: 'empty', motivo: 'Sin tickers en seguimiento — agregalos en /radar.' }
    : isLoading ? { status: 'loading' }
    : { status: 'ok', shape: 'scalar', value: agresivos.size, format: 'int', sub: `de ${items.length} en seguimiento` };
  // Badge: solo el ícono (el conteo ya es el número grande de la tarjeta, no hace falta repetirlo) —
  // mismo criterio que RadarResumen, pero con texto sr-only (el ícono solo no tiene nombre accesible:
  // lucide-react le pone aria-hidden automáticamente al no tener hijos ni prop de accesibilidad).
  const right = !isLoading && agresivos.size > 0
    ? <BadgeConLink href={detalleHref} personalizando={personalizando}>
        <Badge tone="pos"><Flame className="w-3 h-3" /><span className="sr-only">{agresivos.size} compra agresiva{agresivos.size > 1 ? 's' : ''} — ver Radar</span></Badge>
      </BadgeConLink>
    : <VerDetalle href={detalleHref} personalizando={personalizando} />;
  return (
    <>
      {items.map(it => {
        const T = it.ticker.toUpperCase();
        return <RadarProbe key={it.id} ticker={T} cik={it.cik || cikMap.get(T)?.cik} cikLoading={cikLoading}
          riskFree={riskFree} saved={dcfMap.get(T)} onResult={onProbe} />;
      })}
      <MetricShell titulo={titulo} sub={sub} right={right} mv={mv} viz={viz} />
    </>
  );
}

function RadarProbe({ ticker, cik, cikLoading, riskFree, saved, onResult }: {
  ticker: string; cik: string | undefined; cikLoading: boolean; riskFree: number;
  saved: StoredDcf | undefined;
  onResult: (ticker: string, agresiva: boolean, listo: boolean) => void;
}) {
  const { agresiva, isFetching } = useRadarTicker(ticker, cik, cikLoading, riskFree, saved);
  // Latcheado (nunca vuelve a false): una vez que el primer fetch terminó, un refetch de fondo
  // (window focus, etc.) NO debe hacer "desaparecer" al ticker de `reportados` en el padre — eso
  // haría reaparecer el "Cargando…" con datos que ya se mostraron una vez.
  const [listoAlguna, setListoAlguna] = useState(false);
  useEffect(() => {
    if (!cikLoading && !isFetching) setListoAlguna(true);
  }, [cikLoading, isFetching]);
  useEffect(() => { onResult(ticker, agresiva, listoAlguna); }, [ticker, agresiva, listoAlguna, onResult]);
  useEffect(() => () => onResult(ticker, false, false), [ticker, onResult]);
  return null;
}

// ── Cobros (resumenCobros, igual que CobrosResumen/Cupones) ───────────────────
function useCobrosResumenValue() {
  const { active } = usePortfolios();
  const { data: cobros = [], isLoading } = useCobros(active?.id);
  return { resumen: resumenCobros(cobros), tieneCobros: cobros.length > 0, isLoading };
}

function CobrosTotalMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { resumen, tieneCobros, isLoading } = useCobrosResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !tieneCobros ? { status: 'empty', motivo: 'Sin cobros registrados todavía.' }
    : { status: 'ok', shape: 'scalar', value: resumen.total, format: 'usd-compact' };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

function CobrosDisponibleMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { resumen, tieneCobros, isLoading } = useCobrosResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : !tieneCobros ? { status: 'empty', motivo: 'Sin cobros registrados todavía.' }
    : { status: 'ok', shape: 'scalar', value: resumen.disponible, format: 'usd-compact', tone: resumen.disponible > 0 ? 'warn' : 'neutral' };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

// ── Macro (SEMAFOROS + resumenMacro, igual que MacroResumen/MacroPage) ────────
function MacroSemaforosMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { data: macro = {}, isLoading } = useMacro();
  // Mismos hex que --pos/--warn/--neg por tema (useChartTheme, no un color de paleta categórica que
  // por casualidad se le parece) — así el semáforo se ve igual acá que en /macro y en cualquier
  // badge/texto de estado del resto de la app, y respeta el tema oscuro (recharts no puede resolver
  // `rgb(var(--pos))` en un fill SVG).
  const chart = useChartTheme();
  const semaforos: Lectura[] = SEMAFOROS.map(s => {
    const v = (macro as Record<string, number | null>)[s.key];
    return { def: s, valor: v ?? null, luz: v != null ? s.evalua(v) : null };
  });
  const { conteo, titulo: tituloSalud, luz } = resumenMacro(semaforos);
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : conteo.total === 0 ? { status: 'empty', motivo: 'Sin datos de mercado todavía.' }
    : {
        status: 'ok', shape: 'categorico', format: 'int', items: [
          { label: 'En verde', value: conteo.verdes, color: chart.pos },
          { label: 'Atención', value: conteo.amarillos, color: chart.warn },
          { label: 'Estrés', value: conteo.rojos, color: chart.neg },
        ].filter(i => i.value > 0),
      };
  // Badge: mismo título/tono que el header de MacroResumen ("Todo en calma" / etc.).
  const tono = luz === 'rojo' ? 'neg' : luz === 'amarillo' ? 'warn' : 'pos';
  const right = conteo.total > 0
    ? <BadgeConLink href={detalleHref} personalizando={personalizando}><Badge tone={tono}>{tituloSalud}</Badge></BadgeConLink>
    : <VerDetalle href={detalleHref} personalizando={personalizando} />;
  return <MetricShell titulo={titulo} sub={sub} right={right} mv={mv} viz={viz} />;
}

// ── Finanzas (resumenFlujo, igual que FinanzasResumen en DashboardPage.tsx) ────
function useLiquidezResumenValue() {
  const { data: flujo = [], isLoading } = useFlujo();
  const { data: macro = {} } = useMacro();
  const mep = (macro as Record<string, number | null>).dolar_mep ?? (macro as Record<string, number | null>).dolar_ccl ?? null;
  return { flujo, resumen: resumenFlujo(flujo, mep), mep, isLoading };
}

function LiquidezFciMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { flujo, resumen, mep, isLoading } = useLiquidezResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : flujo.length === 0 ? { status: 'empty', motivo: 'Sin flujo de caja cargado — cargalo en /finanzas.' }
    : { status: 'ok', shape: 'scalar', value: resumen.fci, format: 'ars-compact', sub: mep ? `≈ US$${(resumen.fci / mep).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : undefined };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

function LiquidezDisponibleMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { flujo, resumen, isLoading } = useLiquidezResumenValue();
  // Mismo sub/tono que la tarjeta "Disponible" de la vieja sección Liquidez & FCI (ya no existe
  // como default, pero la métrica atómica sigue disponible para armar una tarjeta a medida).
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : flujo.length === 0 ? { status: 'empty', motivo: 'Sin flujo de caja cargado — cargalo en /finanzas.' }
    : { status: 'ok', shape: 'scalar', value: resumen.disponible, format: 'ars-compact', sub: 'ingresos − egresos', tone: resumen.disponible >= 0 ? 'pos' : 'neg' };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

function LiquidezSinAsignarMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { flujo, resumen, isLoading } = useLiquidezResumenValue();
  // Mismo sub/tono que la tarjeta "Sin asignar" de la vieja sección Liquidez & FCI (ídem arriba).
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : flujo.length === 0 ? { status: 'empty', motivo: 'Sin flujo de caja cargado — cargalo en /finanzas.' }
    : { status: 'ok', shape: 'scalar', value: resumen.sinAsignar, format: 'ars-compact', sub: 'sin colocar', tone: resumen.sinAsignar >= 0 ? 'neutral' : 'neg' };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

// Las 3 métricas que la sección "Finanzas" (antes "Liquidez & FCI") muestra por default — como
// atómicas, para poder armar una tarjeta a medida con solo una de las tres (o combinarla con otra).
function LiquidezIngresosMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { flujo, resumen, isLoading } = useLiquidezResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : flujo.length === 0 ? { status: 'empty', motivo: 'Sin flujo de caja cargado — cargalo en /finanzas.' }
    : { status: 'ok', shape: 'scalar', value: resumen.ingresos, format: 'ars-compact', sub: 'mensuales, según tu flujo', tone: 'pos' };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

function LiquidezEgresosMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { flujo, resumen, isLoading } = useLiquidezResumenValue();
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : flujo.length === 0 ? { status: 'empty', motivo: 'Sin flujo de caja cargado — cargalo en /finanzas.' }
    : { status: 'ok', shape: 'scalar', value: resumen.egresos, format: 'ars-compact', sub: 'mensuales, según tu flujo', tone: 'neg' };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

function LiquidezReservaMetric({ viz, titulo, sub, detalleHref, personalizando }: { viz: DashboardViz; titulo: string; sub?: string; detalleHref?: string; personalizando: boolean }) {
  const { flujo, resumen, isLoading } = useLiquidezResumenValue();
  // resumen.invertido — FinanzasPage.tsx lo llama "Inversiones · asignaciones"; acá "Reserva de
  // liquidez" (plata YA colocada en FCI/Mercado Pago/CEDEARs/bonos, ver engine/flujo.ts).
  const mv: MetricValue = isLoading ? { status: 'loading' }
    : flujo.length === 0 ? { status: 'empty', motivo: 'Sin flujo de caja cargado — cargalo en /finanzas.' }
    : { status: 'ok', shape: 'scalar', value: resumen.invertido, format: 'ars-compact', sub: 'ya asignado (FCI, CEDEARs, bonos…)', tone: 'neutral' };
  return <MetricShell titulo={titulo} sub={sub} right={<VerDetalle href={detalleHref} personalizando={personalizando} />} mv={mv} viz={viz} />;
}

// ── Registro: MetricKey -> componente ──────────────────────────────────────────
export const METRIC_COMPONENTS: Partial<Record<MetricKey, MetricComponent>> = {
  distribucion_categoria: DistribucionCategoriaMetric,
  distribucion_tipo_activo: DistribucionTipoActivoMetric,
  cedears_capital: CedearsCapitalMetric,
  cedears_mayor_posicion: CedearsMayorPosicionMetric,
  cedears_por_sector: CedearsPorSectorMetric,
  bonos_capital: BonosCapitalMetric,
  bonos_tir_promedio: BonosTirPromedioMetric,
  bonos_duracion_promedio: BonosDuracionPromedioMetric,
  bonos_grado_inversion: BonosGradoInversionMetric,
  bonos_proximo_capital: BonosProximoCapitalMetric,
  radar_compra_agresiva: RadarCompraAgresivaMetric,
  cobros_total: CobrosTotalMetric,
  cobros_disponible: CobrosDisponibleMetric,
  macro_semaforos: MacroSemaforosMetric,
  liquidez_fci: LiquidezFciMetric,
  liquidez_disponible: LiquidezDisponibleMetric,
  liquidez_sin_asignar: LiquidezSinAsignarMetric,
  liquidez_ingresos: LiquidezIngresosMetric,
  liquidez_egresos: LiquidezEgresosMetric,
  liquidez_reserva: LiquidezReservaMetric,
};

// ── Orquestador: 1 métrica → tarjeta normal; 2+ → combinada ───────────────────
// `metricas.length === 1`: delega tal cual en el componente de esa métrica (cualquier shape/viz,
// comportamiento IDÉNTICO a antes de que existiera la selección múltiple).
// `metricas.length > 1`: todas deben ser `shape:'scalar'` (se valida al construir la tarjeta en
// AddWidgetModal; acá se filtra de nuevo por las dudas — una fila corrupta o un rename mal migrado
// no debería poder colar una categórica dentro de una grilla de números). Se arma UNA Card con UN
// CardHeader (el link "Ver detalle →" solo aparece si TODAS las métricas comparten la misma página
// fuente — combinar algo de Bonos con algo de Cobros no tiene un único destino razonable) y adentro,
// en modo 'compacto' (Context), cada métrica se pinta como un tile chico — cada tile usa su propio
// título de catálogo (no el título de la tarjeta combinada, que es el de la Card entera).
export function MetricWidgetRenderer({ ctx, metricas, viz, titulo, sub, personalizando }: {
  ctx: MetricContext; metricas: MetricKey[]; viz: DashboardViz; titulo: string; sub?: string; personalizando: boolean;
}) {
  if (metricas.length <= 1) {
    const key = metricas[0];
    const Comp = key ? METRIC_COMPONENTS[key] : undefined;
    if (!key || !Comp) return null; // WidgetGrid ya filtra esto vía enCatalogo — defensivo
    const def = getMetricDef(key);
    return <Comp ctx={ctx} viz={resolveViz(key, viz)} titulo={titulo} sub={sub} detalleHref={def?.detalleHref} personalizando={personalizando} />;
  }

  const combinables = metricas.filter(k => getMetricDef(k)?.shape === 'scalar');
  const hrefs = new Set(combinables.map(k => getMetricDef(k)?.detalleHref).filter((h): h is string => !!h));
  const href = hrefs.size === 1 ? [...hrefs][0] : undefined;
  // grid-cols-4 fijo dejaba huecos con 2 o 3 tiles (mismo criterio que las grillas a mano de
  // CobrosResumen/LiquidezFci en DashboardPage.tsx, que usan grid-cols-3 para 3 tiles, no 4 con un
  // hueco) — acá el conteo es dinámico (1 a MAX_COMBO), así que se resuelve por lookup.
  const cols = combinables.length <= 2 ? 'grid-cols-2' : combinables.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4';

  return (
    <Card>
      <CardHeader title={titulo} sub={sub} right={<VerDetalle href={href} personalizando={personalizando} />} />
      <MetricModoContext.Provider value="compacto">
        <div className={`grid ${cols} gap-2 p-3`}>
          {combinables.map(k => {
            const Comp = METRIC_COMPONENTS[k];
            const def = getMetricDef(k);
            return Comp && def ? <Comp key={k} ctx={ctx} viz="stat" titulo={def.titulo} personalizando={personalizando} /> : null;
          })}
        </div>
      </MetricModoContext.Provider>
    </Card>
  );
}
