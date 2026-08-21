import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Plus, Trash2, LineChart, Radar, RefreshCw, ArrowUp, ArrowDown, ArrowUpDown, ShoppingCart, Flame, Search, X, Star, Download } from 'lucide-react';
import { useMacro, useBonosPrecios } from '../hooks/usePosiciones';
import { useCikMap } from '../hooks/useCikMap';
import { DEFAULT_CIK } from '../lib/defaultCik';
import { useWatchlist, type WatchItem } from '../hooks/useWatchlist';
import { useRadarTicker } from '../hooks/useRadarTicker';
import { useBonosReferencia } from '../hooks/useBonosReferencia';
import { useBonosDestacados } from '../hooks/useBonosDestacados';
import { useChartTheme } from '../hooks/usePrefs';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { MARGEN_COMPRA_AGRESIVA } from '../engine/dcf';
import type { Rating } from '../engine/score';
import { calcularBonoReferencia, TIPO_LABEL, LEY_LABEL, LEY_TONE, type BonoReferencia } from '../engine/rentaFija';
import { evaluarOperabilidad, type OperabilidadNivel } from '../engine/volumenRentaFija';
import { bonosACSV, nombreArchivoCsv } from '../engine/exportRentaFija';
import { COMPANY_MOAT, SECTOR_LABEL, FOSO_LABEL, AMPLITUD_LABEL, AMPLITUD_TONE, type Sector, type AmplitudFoso } from '../lib/companyMoat';
import { CALIFICADORAS, ETIQUETA_GRADO, type GradoCredito } from '../engine/rating';
import { useDcfInputs, type StoredDcf } from '../hooks/useDcfInputs';
import { type Vista, vistaInicial, guardarVista } from '../lib/radarVista';
import { descargarTexto } from '../lib/download';
import { Card, CardHeader, Button, Badge, RatingBadge, ViewToggle, Field, Empty, inputCls, fmtUsd, fmtNum, fmtPct } from '../components/ui';
import { UpdatedAt } from '../components/UpdatedAt';

// Tickers conocidos para el desplegable de "agregar" — derivados de DEFAULT_CIK (única fuente de
// verdad, no una lista aparte para no duplicar mantenimiento). Deduplicados por CIK: BRKB/BRK.B
// son 2 formas de escribir el mismo ticker (Berkshire) — mostrar ambos como si fueran empresas
// distintas se leería como un bug, no como una lista curada. Un Map(cik → ticker), recorriendo
// DEFAULT_CIK en orden, se queda con el ÚLTIMO ticker visto por cada CIK — en el objeto fuente
// 'BRK.B' aparece después de 'BRKB', así que gana la forma con punto (el formato real de mercado).
const TICKERS_CONOCIDOS: string[] = [...new Map(Object.entries(DEFAULT_CIK).map(([t, cik]) => [cik, t])).values()].sort();

// Desplegable de tickers conocidos (DEFAULT_CIK) con autocompletado — SIEMPRE se puede seguir
// escribiendo cualquier otra cosa (la resolución automática de CIK, ver fundamentals.ts, ya cubre
// tickers fuera de esta lista): esto es una ayuda para elegir rápido entre los ~80 verificados, no
// un límite de lo que se puede cargar. Si lo tipeado no matchea ningún conocido, el propio
// desplegable ofrece "Agregar '…' como nuevo" — mismo campo, sin un flujo separado.
// `tickers`: lista sobre la que autocompletar — el padre puede pasar un subconjunto ya filtrado
// por sector/foso económico (ver filtroSector/filtroFoso en RadarVariable); default: todos los conocidos.
function TickerCombobox({ value, onChange, tickers = TICKERS_CONOCIDOS }: { value: string; onChange: (v: string) => void; tickers?: string[] }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const q = value.trim().toUpperCase();
  // Sin cap artificial: son ~83 tickers en total, nada que justifique cortar la lista (bug real
  // reportado — con cap en 8 y el campo vacío, "AAPL..AMGN" son EXACTAMENTE los primeros 8
  // alfabéticos: no era un problema de scroll, la lista de verdad terminaba ahí).
  const matches = q ? tickers.filter(t => t.startsWith(q)) : tickers;
  // "Conocido" se sigue evaluando contra TODOS los tickers de DEFAULT_CIK (no solo el subconjunto
  // filtrado) — si el usuario tipeó un ticker real que el filtro de sector/foso dejó afuera, sigue
  // siendo un ticker conocido y no corresponde ofrecerle "agregar como nuevo".
  const esConocido = q !== '' && TICKERS_CONOCIDOS.includes(q);
  const mostrarAgregarNuevo = q !== '' && !esConocido;
  const items = mostrarAgregarNuevo ? [...matches, '__nuevo__'] : matches;

  useEffect(() => { setActiveIndex(0); }, [value, open]);

  const elegir = (item: string) => {
    if (item !== '__nuevo__') onChange(item);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && items[activeIndex]) { e.preventDefault(); elegir(items[activeIndex]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="relative">
      <input placeholder="Ticker (ej. GOOGL)" value={value} autoComplete="off"
        onChange={e => { onChange(e.target.value.toUpperCase()); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown}
        className={`${inputCls} w-32`} aria-expanded={open} aria-autocomplete="list" />
      {open && items.length > 0 && (
        <>
          {/* Scrim: sin esto, en mobile con el teclado abierto (pantalla útil muy chica) el
              desplegable quedaba flotando SOBRE el botón "Seguir" y la tarjeta de abajo sin ninguna
              separación visual clara — se leía como que el desplegable "rompía" el layout, cuando en
              realidad era el resto de la página quedando visible detrás (bug real reportado con
              captura). Oscurece el fondo para que quede inequívoco qué es overlay y qué no — mismo
              patrón que un modal. z-index por debajo de la lista, por encima de todo lo demás.
              onMouseDown (no onClick): cierra ANTES de que el blur del input dispare, mismo truco
              que las opciones de abajo. */}
          <div className="fixed inset-0 z-40 bg-ink-900/20" onMouseDown={e => { e.preventDefault(); setOpen(false); }} />
          <ul className="absolute z-50 mt-1 max-h-64 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-line bg-surface shadow-soft py-1 text-sm">
            {items.map((item, i) => (
              <li key={item}>
                {/* onMouseDown (no onClick) + preventDefault: evita que el input pierda foco (onBlur)
                    ANTES de que el click en la opción llegue a dispararse — truco estándar de combobox. */}
                <button type="button" onMouseDown={e => { e.preventDefault(); elegir(item); }}
                  className={`w-full text-left px-3 py-1.5 ${i === activeIndex ? 'bg-canvas' : ''} ${item === '__nuevo__' ? 'text-accent' : 'tnum'}`}>
                  {item === '__nuevo__' ? <><Plus className="w-3.5 h-3.5 inline mr-1" />Agregar "{q}" como nuevo</> : item}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const RATING_TONE: Record<Rating, 'pos' | 'accent' | 'warn' | 'neg'> = { A: 'pos', B: 'accent', C: 'warn', D: 'neg' };
const TIPO_TONE: Record<BonoReferencia['tipo'], 'accent' | 'sol' | 'gray'> = { soberano: 'accent', subsoberano: 'sol', on: 'gray' };
// PIE_COLORS[0]/[4]/[3] (ui.tsx) — categóricos, no compiten con pos/warn/neg (rating)
const TIPO_COLOR: Record<BonoReferencia['tipo'], string> = { soberano: '#4F97D4', subsoberano: '#E08E6D', on: '#B08BD6' };
// PIE_COLORS[2]/[1] — mismos índices categóricos, sin pisar los 3 ya usados por TIPO_COLOR arriba.
const LEY_COLOR: Record<'local' | 'extranjera', string> = { local: '#5FB49C', extranjera: '#F4C752' };
// Para ordenar la columna Foso: ancho primero (lo que se quiere ver arriba al pedir "todas las
// anchas") — ver DEFAULT_DIR.amplitud = 'desc'.
const AMPLITUD_ORDEN: Record<AmplitudFoso, number> = { ancho: 3, estrecho: 2, ninguno: 1 };
// Orden por columna: cada fila calcula su propio score/DCF de forma independiente (fetch por
// ticker), así que esos valores se reportan al padre (onComputed) para poder ordenar sin
// duplicar el fetch ni levantar el cálculo entero acá arriba. Sector/amplitud NO dependen de ese
// fetch (son estáticos de companyMoat.ts) — se resuelven directo por ticker al ordenar.
type SortKey = 'ticker' | 'sector' | 'amplitud' | 'price' | 'mos' | 'roic' | 'eg5y' | 'score';
interface RowSortData { price: number | null; mos: number | null; roic: number | null; eg5y: number | null; score: number | null; agresiva: boolean }
const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = { ticker: 'asc', sector: 'asc', amplitud: 'desc', price: 'desc', mos: 'desc', roic: 'desc', eg5y: 'desc', score: 'desc' };

// Radar de acciones/CEDEARs y de renta fija son dos universos completamente distintos (score DCF
// vs. TIR/duración de un cronograma, ninguna columna en común) — un toggle en vez de dos tablas
// apiladas, para no forzar al usuario a escanear un tipo de activo que no le interesa en ese
// momento para llegar al otro. Se persiste en localStorage: la mayoría de las visitas a Radar son
// para un solo universo a la vez.
export function RadarPage() {
  const [vista, setVista] = useState<Vista>(vistaInicial);
  const cambiarVista = (v: Vista) => { setVista(v); guardarVista(v); };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-ink-900 font-display">Radar</h1>
          <ViewToggle value={vista} onChange={cambiarVista}
            options={[{ value: 'variable', label: 'Renta variable' }, { value: 'fija', label: 'Renta fija' }]} />
        </div>
        <UpdatedAt icon />
      </div>
      {vista === 'variable' ? <RadarVariable /> : <RadarFija />}
    </div>
  );
}

// ── Renta variable: watchlist de acciones/CEDEARs con score DCF ──────────────────────────────
function RadarVariable() {
  const { data: items = [], isLoading, add, remove } = useWatchlist();
  const qc = useQueryClient();
  const [ticker, setTicker] = useState('');
  const [nota, setNota] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // Filtro de sector/amplitud de foso — solo para acotar el desplegable al buscar QUÉ empresa
  // seguir (pedido explícito del usuario), no un filtro de la tabla de seguimiento de abajo: una
  // vez agregado, un ticker se sigue viendo en la tabla sin importar estos filtros.
  // Amplitud, no tipo de foso: el usuario aclaró que para FILTRAR le alcanza con "ancho / estrecho
  // / ninguno" (ej. "quiero seguir todas las anchas") — los tipos de foso (red, costos_cambio, etc.)
  // le interesan como INFORMACIÓN, no como criterio de búsqueda, y se siguen mostrando debajo.
  const [filtroSector, setFiltroSector] = useState<'todos' | Sector>('todos');
  const [filtroAmplitud, setFiltroAmplitud] = useState<'todos' | AmplitudFoso>('todos');
  const tickersFiltrados = useMemo(() => TICKERS_CONOCIDOS.filter(t => {
    const m = COMPANY_MOAT[t];
    if (!m) return false;
    if (filtroSector !== 'todos' && m.sector !== filtroSector) return false;
    if (filtroAmplitud !== 'todos' && m.amplitud !== filtroAmplitud) return false;
    return true;
  }), [filtroSector, filtroAmplitud]);
  const moatDelTicker = COMPANY_MOAT[ticker.trim().toUpperCase()];
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rowData, setRowData] = useState<Record<string, RowSortData>>({});
  // Por defecto, ordenado por MoS (margen de seguridad) descendente — lo primero que un inversor
  // value quiere ver es qué está más lejos de su valor intrínseco, no el orden en que se agregaron
  // al watchlist. El usuario puede cambiarlo clickeando cualquier columna, como siempre.
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>({ key: 'mos', dir: 'desc' });

  const onRowComputed = useCallback((t: string, d: RowSortData) => {
    setRowData(prev => {
      const cur = prev[t];
      if (cur && cur.price === d.price && cur.mos === d.mos && cur.roic === d.roic && cur.eg5y === d.eg5y && cur.score === d.score && cur.agresiva === d.agresiva) return prev;
      return { ...prev, [t]: d };
    });
  }, []);
  // rowData es acumulativo (onRowComputed nunca borra entradas) — filtrar por los tickers
  // presentes hoy en items, si no un ticker sacado del radar sigue inflando el conteo.
  const compraAgresivaCount = useMemo(() => {
    const presentes = new Set(items.map(it => it.ticker.toUpperCase()));
    return Object.entries(rowData).filter(([t, d]) => presentes.has(t) && d.agresiva).length;
  }, [rowData, items]);

  const handleSort = (key: SortKey) => setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DEFAULT_DIR[key] });

  // Los tickers sin dato (fundamentals aún no cargados / sin CIK) quedan siempre al final,
  // sea cual sea la dirección — si no, "sin dato" saltaría de arriba a abajo al invertir el orden.
  const sortedItems = useMemo(() => {
    if (!sort) return items;
    const { key, dir } = sort;
    const factor = dir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      if (key === 'ticker') return a.ticker.localeCompare(b.ticker) * factor;
      // Sector/amplitud son estáticos (companyMoat.ts) — no dependen de rowData/fetch. Tickers sin
      // clasificación (agregados a mano, fuera del hardcodeado) quedan siempre al final, mismo
      // criterio que "sin dato" en las columnas numéricas de abajo.
      if (key === 'sector') {
        const as = COMPANY_MOAT[a.ticker.toUpperCase()]?.sector;
        const bs = COMPANY_MOAT[b.ticker.toUpperCase()]?.sector;
        if (as == null && bs == null) return 0;
        if (as == null) return 1;
        if (bs == null) return -1;
        return SECTOR_LABEL[as].localeCompare(SECTOR_LABEL[bs]) * factor;
      }
      if (key === 'amplitud') {
        const aa = COMPANY_MOAT[a.ticker.toUpperCase()]?.amplitud;
        const ba = COMPANY_MOAT[b.ticker.toUpperCase()]?.amplitud;
        const av = aa != null ? AMPLITUD_ORDEN[aa] : null;
        const bv = ba != null ? AMPLITUD_ORDEN[ba] : null;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * factor;
      }
      const av = rowData[a.ticker.toUpperCase()]?.[key] ?? null;
      const bv = rowData[b.ticker.toUpperCase()]?.[key] ?? null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * factor;
    });
  }, [items, sort, rowData]);

  const { data: macro = {} } = useMacro();
  const riskFree = ((macro as Record<string, number | null>).dgs10 ?? 4.3) / 100;
  const { map: dcfMap } = useDcfInputs();

  const refrescar = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['quotes'] }),
        qc.invalidateQueries({ queryKey: ['fundamentals'] }),
        qc.invalidateQueries({ queryKey: ['macro'] }),
        qc.invalidateQueries({ queryKey: ['watchlist'] }),
      ]);
    } finally { setRefreshing(false); }
  };

  const agregar = async () => {
    if (!ticker.trim()) { setErr('Ingresá un ticker.'); return; }
    setBusy(true); setErr(null);
    try { await add(ticker, null, nota); setTicker(''); setNota(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo agregar'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-4 flex flex-wrap gap-2 items-end text-sm">
          {/* Filtros de sector/foso: acotan el desplegable de Ticker antes de tipear, para poder
              explorar "qué empresas de Salud con foso ancho no estoy siguiendo todavía" en vez de
              tener que conocer el ticker de antemano. Clasificación cualitativa curada a mano
              (ver src/lib/companyMoat.ts) — no calculada por el código. */}
          <Field label="Sector">
            <select value={filtroSector} onChange={e => setFiltroSector(e.target.value as typeof filtroSector)} className={`${inputCls} w-40`}>
              <option value="todos">Todos</option>
              {(Object.keys(SECTOR_LABEL) as Sector[]).map(s => <option key={s} value={s}>{SECTOR_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Amplitud de foso">
            <select value={filtroAmplitud} onChange={e => setFiltroAmplitud(e.target.value as typeof filtroAmplitud)} className={`${inputCls} w-40`}>
              <option value="todos">Todas</option>
              {(Object.keys(AMPLITUD_LABEL) as AmplitudFoso[]).map(a => <option key={a} value={a}>{AMPLITUD_LABEL[a]}</option>)}
            </select>
          </Field>
          <Field label="Ticker" hint={`${tickersFiltrados.length} de ${TICKERS_CONOCIDOS.length} verificadas con este filtro, o escribí cualquier otro ticker`}>
            <TickerCombobox value={ticker} onChange={setTicker} tickers={tickersFiltrados} />
          </Field>
          <Field label="Nota (opcional)" className="flex-1 min-w-[140px]">
            <input placeholder="Nota (opcional)" value={nota} onChange={e => setNota(e.target.value)}
              className={inputCls} />
          </Field>
          <div className="flex items-end">
            <Button onClick={agregar} disabled={busy}><Plus className="w-4 h-4" /> Seguir</Button>
          </div>
        </div>
        {moatDelTicker && (
          <p className="px-4 pb-3 text-[11px] text-ink-600">
            {SECTOR_LABEL[moatDelTicker.sector]} · {moatDelTicker.fosos.length > 0 ? moatDelTicker.fosos.map(f => FOSO_LABEL[f]).join(', ') : 'sin foso claro'} — {moatDelTicker.nota}
          </p>
        )}
        {err && <p className="px-4 pb-3 text-xs text-warn">{err}</p>}
      </Card>

      <Card>
        <CardHeader title="Tickers en seguimiento"
          sub="Score = valuación (MoS) + calidad (ROIC−Ke, margen) + crecimiento (EG5Y) + solidez (deuda). Calculado por el código."
          right={<div className="flex items-center gap-2 flex-wrap justify-end">
            {compraAgresivaCount > 0 &&
              <Badge tone="pos"><Flame className="w-3 h-3" /><span className="ml-1">{compraAgresivaCount} compra agresiva{compraAgresivaCount > 1 ? 's' : ''}</span></Badge>}
            <Button variant="ghost" onClick={refrescar} disabled={refreshing}>
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> {refreshing ? 'Actualizando…' : 'Refrescar'}
            </Button>
          </div>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr>
                <ThSort label="Ticker" align="left" sortKey="ticker" sort={sort} onClick={handleSort} />
                <ThSort label="Sector" align="left" sortKey="sector" sort={sort} onClick={handleSort} />
                <ThSort label="Foso" sortKey="amplitud" sort={sort} onClick={handleSort} />
                <ThSort label="Precio" sortKey="price" sort={sort} onClick={handleSort} />
                <ThSort label="MoS" sortKey="mos" sort={sort} onClick={handleSort} />
                <ThSort label="ROIC" sortKey="roic" sort={sort} onClick={handleSort} />
                <ThSort label="EG5Y" sortKey="eg5y" sort={sort} onClick={handleSort} />
                <th className="text-right px-3">Veredicto</th>
                <ThSort label="Score" sortKey="score" sort={sort} onClick={handleSort} />
                <th className="px-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sortedItems.map(it => <RadarRow key={it.id} item={it} riskFree={riskFree} saved={dcfMap.get(it.ticker.toUpperCase())} onRemove={() => remove(it.id)} onComputed={onRowComputed} />)}
              {!isLoading && items.length === 0 && (
                <tr><td colSpan={10}><Empty icon={Radar} title="Radar vacío">Agregá un ticker arriba para ver su score.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-[11px] text-ink-600">
          El score de fundamentos requiere datos de EDGAR (SEC proxy). Sin eso, se muestra solo el precio y el score queda parcial o —.
        </p>
      </Card>
    </div>
  );
}

function ThSort<K extends string>({ label, sortKey, sort, onClick, align = 'right' }: {
  label: string; sortKey: K; sort: { key: K; dir: 'asc' | 'desc' } | null; onClick: (key: K) => void; align?: 'left' | 'right';
}) {
  const active = sort?.key === sortKey;
  return (
    <th className={align === 'left' ? 'text-left' : 'text-right'}
      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {/* Padding DENTRO del botón (no en el <th>): el área clickeable es todo el label, no solo el
          texto — con el padding afuera el botón queda de ~16px de alto, bajo el mínimo táctil de 24px.
          Mismo patrón que ThSortAnio en AportesPage.tsx. */}
      <button onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-1 py-2 hover:text-ink-900 transition-colors ${align === 'left' ? 'px-4' : 'px-3 flex-row-reverse justify-end'} ${active ? 'text-ink-900 font-semibold' : ''}`}>
        {label}
        {active
          ? (sort!.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  );
}

function RadarRow({ item, riskFree, saved, onRemove, onComputed }: {
  item: WatchItem; riskFree: number; saved?: StoredDcf; onRemove: () => Promise<void>; onComputed: (ticker: string, d: RowSortData) => void;
}) {
  const T = item.ticker.toUpperCase();
  const { map: cikMap, isLoading: cikLoading } = useCikMap();
  const cik = item.cik || cikMap.get(T)?.cik;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const borrar = async () => {
    if (!window.confirm(`¿Sacar ${T} del radar?`)) return;
    setBusy(true); setErr(null);
    try { await onRemove(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo quitar'); setBusy(false); }
  };

  const { price, ratios, dcf, score, agresiva, isFetching, isError } = useRadarTicker(T, cik, cikLoading, riskFree, saved);
  // Solo existe para las empresas hardcodeadas de companyMoat.ts — un ticker agregado a mano fuera
  // de esa lista (resolución automática de CIK) simplemente no tiene sector/foso clasificado.
  const moat = COMPANY_MOAT[T];

  useEffect(() => {
    onComputed(T, { price, mos: dcf?.marginOfSafety ?? null, roic: ratios?.roic ?? null, eg5y: ratios?.eg5y ?? null, score: score?.score ?? null, agresiva });
  }, [T, price, dcf, ratios, score, agresiva, onComputed]);

  const verdictTone = dcf?.verdict === 'COMPRAR' ? 'pos' : dcf?.verdict === 'CARO' ? 'neg' : 'warn';

  return (
    <tr className={`hover:bg-canvas ${agresiva ? 'bg-pos/5' : ''}`}>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          {agresiva && (
            <span title={`Compra agresiva — margen de seguridad ≥${Math.round(MARGEN_COMPRA_AGRESIVA * 100)}%, estándar Buffett de oportunidad amplia`}>
              <Flame className="w-3.5 h-3.5 text-pos shrink-0" aria-label="Compra agresiva" />
            </span>
          )}
          <span className="font-semibold text-ink-900">{T}</span>
          {item.nota && <span className="text-[10px] text-ink-600 truncate max-w-[160px]">{item.nota}</span>}
        </div>
      </td>
      <td className="px-3 text-ink-700 truncate max-w-[130px]">{moat ? SECTOR_LABEL[moat.sector] : <span className="text-ink-500">—</span>}</td>
      <td className="px-3">
        {moat
          ? <span title={`${AMPLITUD_LABEL[moat.amplitud]} · ${moat.fosos.length > 0 ? moat.fosos.map(f => FOSO_LABEL[f]).join(', ') : 'sin foso claro'} — ${moat.nota}`}>
              <Badge tone={AMPLITUD_TONE[moat.amplitud]}>{AMPLITUD_LABEL[moat.amplitud]}</Badge>
            </span>
          : <span className="text-ink-500 text-xs" title="Ticker agregado a mano, fuera del listado hardcodeado clasificado">—</span>}
      </td>
      <td className="text-right px-3 tnum">{fmtUsd(price)}</td>
      <td className="text-right px-3 tnum">{dcf ? fmtPct(dcf.marginOfSafety) : '—'}</td>
      <td className={`text-right px-3 tnum ${ratios?.roic != null && ratios.wacc != null && ratios.roic > ratios.wacc ? 'text-pos' : ''}`}>
        {ratios ? fmtPct(ratios.roic) : '—'}{ratios?.roic != null && ratios.wacc != null && ratios.roic > ratios.wacc ? ' ✓' : ''}
      </td>
      <td className="text-right px-3 tnum">{ratios ? fmtPct(ratios.eg5y) : '—'}</td>
      <td className="text-right px-3">{dcf ? <Badge tone={verdictTone as 'pos' | 'neg' | 'warn'}>{dcf.verdict}</Badge> : <span className="text-ink-600">—</span>}</td>
      <td className="text-right px-3">
        {/* Orden importa: mientras el fetch está en vuelo (isFetching) el servidor puede estar
            todavía intentando resolver el CIK solo (cache global → cik_map propio → FMP, ver
            resolverCikAutomatico en fundamentals.ts) — mostrar "sin CIK" ANTES de que termine de
            intentarlo (como antes, cuando la resolución era 100% local) sería un falso negativo. La
            distinción "sin CIK" vs. "falló" recién tiene sentido DESPUÉS de asentarse: si isError y
            localmente tampoco conocíamos un CIK, lo más probable es que ninguna fuente automática lo
            tenga — ahí sí vale mandar a Configuración. Si isError con un CIK sí conocido, el problema
            es otra cosa (EDGAR/rate-limit), no el CIK. */}
        {score?.score != null
          ? <span className="inline-flex items-center gap-1.5"><span className="tnum font-bold text-ink-900">{score.score}</span><Badge tone={RATING_TONE[score.rating!]}>{score.rating}</Badge></span>
          : isFetching
            ? <span className="text-ink-500 text-xs" title="Cargando fundamentals de EDGAR (probando resolver el CIK solo, si hace falta)…">…</span>
            : isError && !cik
              ? <Link to="/config" className="text-[10px] text-warn hover:underline" title="No pudimos identificar el CIK automáticamente — cargalo a mano en Configuración">sin CIK</Link>
              : isError
                ? <span className="text-neg text-[10px]" title="No se pudo cargar (ya reintentó solo) — probá 'Refrescar' arriba">falló</span>
                : <span className="text-ink-600">—</span>}
      </td>
      <td className="px-2 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-1">
          <Link to={`/analisis/${T}`} className="text-ink-600 hover:text-accent inline-flex items-center justify-center w-9 h-9" title="Análisis / DCF" aria-label="Análisis DCF"><LineChart className="w-4 h-4" /></Link>
          <Link to={`/posiciones?simular=1&ticker=${T}`} className="text-ink-600 hover:text-pos inline-flex items-center justify-center w-9 h-9" title="Comprar / simular" aria-label="Comprar / simular"><ShoppingCart className="w-4 h-4" /></Link>
          <button onClick={borrar} disabled={busy} className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9 disabled:opacity-50" title="Sacar" aria-label="Sacar del radar"><Trash2 className="w-4 h-4" /></button>
        </div>
        {err && <p className="text-[10px] text-warn mt-0.5">{err}</p>}
      </td>
    </tr>
  );
}

// ── Renta fija: catálogo de referencia, búsqueda/filtro + curva TIR-duración ──────────────────
type SortKeyRF = 'ticker' | 'ley' | 'paridad' | 'tir' | 'duracion' | 'vencimiento';
const DEFAULT_DIR_RF: Record<SortKeyRF, 'asc' | 'desc'> = { ticker: 'asc', ley: 'asc', paridad: 'desc', tir: 'desc', duracion: 'asc', vencimiento: 'asc' };
type FiltroGrado = 'todos' | GradoCredito | 'sin_calificar';
type FiltroLey = 'todos' | 'local' | 'extranjera' | 'sin_clasificar';
// Mismo gris que RatingBadge/BonosPage para "sin calificar" — reusado también para "sin
// clasificar" (ley), mismo concepto de "sin dato" en un eje categórico distinto.
const SIN_DATO_COLOR = '#8B96A5';
const FILTRO_GRADO_LABEL: Record<FiltroGrado, string> = { todos: 'Todos', ...ETIQUETA_GRADO, sin_calificar: 'Sin calificar' };
// Texto corto (no "Ley local"/"Ley extranjera" — el propio <select> ya está bajo el label "Ley",
// repetirlo en cada opción sería redundante, a diferencia de LEY_LABEL que sí necesita ser
// autoexplicativo donde aparece suelto (badge de la tabla, CSV).
const FILTRO_LEY_LABEL: Record<FiltroLey, string> = { todos: 'Todas', local: 'Local', extranjera: 'Extranjera', sin_clasificar: 'Sin clasificar' };
// Mismo criterio de color que MacroPage/TasasPage (engine/semaforos.ts) para Luz — acá es
// OperabilidadNivel (engine/volumenRentaFija.ts), un tipo distinto pero con las mismas 3
// categorías, así que se reusa la misma paleta para que el usuario no tenga que aprender un
// código de colores nuevo.
const OPERABLE_DOT: Record<OperabilidadNivel, string> = { verde: 'bg-pos', amarillo: 'bg-warn', rojo: 'bg-neg' };
const OPERABLE_LABEL: Record<OperabilidadNivel, string> = {
  verde: 'Operable con holgura para este monto',
  amarillo: 'Operable, pero con riesgo de spread ancho en un día flojo',
  rojo: 'Poco líquido para este monto — alto riesgo de mal precio de entrada/salida',
};
const MONTO_OPERAR_DEFAULT = 1000;

function RadarFija() {
  const { data: bonosRef = [], isLoading: bonosRefLoading, isError: bonosRefError, actualizarClasificacion } = useBonosReferencia();
  const { data: bonosPrecios = {} } = useBonosPrecios();
  const { destacados, toggle: toggleDestacado } = useBonosDestacados();
  const qc = useQueryClient();
  const [refreshingRF, setRefreshingRF] = useState(false);
  // El catálogo tiene staleTime de 1h y gcTime/persistencia de hasta 1 semana (ver
  // useBonosReferencia.ts) — sin un botón acá, un usuario que abrió esta pantalla antes de una
  // corrección de emisor/rating/tipo podía quedarse viendo la foto vieja sin ninguna forma de
  // forzar el refetch (mismo criterio que "Refrescar" en RadarVariable, arriba).
  const refrescarRF = async () => {
    setRefreshingRF(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['bonos_referencia'] }),
        qc.invalidateQueries({ queryKey: ['bonos_precios_universo'] }),
      ]);
    } finally { setRefreshingRF(false); }
  };
  const chart = useChartTheme();
  const hoy = new Date().toISOString().slice(0, 10);
  const bonosCalc = useMemo(
    () => bonosRef.map(ref => calcularBonoReferencia(ref, bonosPrecios[ref.ticker] ?? null, hoy)),
    [bonosRef, bonosPrecios, hoy],
  );

  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<'todos' | BonoReferencia['tipo']>('todos');
  const [filtroGrado, setFiltroGrado] = useState<FiltroGrado>('todos');
  const [filtroLey, setFiltroLey] = useState<FiltroLey>('todos');
  // Duración en años (Macaulay) — string, no number, para poder dejar el campo vacío sin que un 0
  // se interprete como "duración exactamente 0" (mismo criterio que `busqueda`). Un bono sin
  // duración calculable (sin cotización de mercado) no puede verificarse contra el rango, así que
  // se excluye en vez de asumir que "sí" o "no" entra.
  const [filtroDuracionMin, setFiltroDuracionMin] = useState('');
  const [filtroDuracionMax, setFiltroDuracionMax] = useState('');
  const [colorPor, setColorPor] = useState<'tipo' | 'calificacion' | 'ley'>('tipo');
  // String (no number) por el mismo motivo que filtroDuracionMin/Max: dejar el campo vacío sin que
  // se interprete como "monto 0". Vacío o inválido cae al default, no bloquea la columna.
  const [montoOperarStr, setMontoOperarStr] = useState(String(MONTO_OPERAR_DEFAULT));
  const montoOperar = Number(montoOperarStr) > 0 ? Number(montoOperarStr) : MONTO_OPERAR_DEFAULT;
  const [sortRF, setSortRF] = useState<{ key: SortKeyRF; dir: 'asc' | 'desc' } | null>(null);
  const [editando, setEditando] = useState<ReturnType<typeof calcularBonoReferencia> | null>(null);

  const durMin = filtroDuracionMin ? Number(filtroDuracionMin) : null;
  const durMax = filtroDuracionMax ? Number(filtroDuracionMax) : null;
  const filtrados = useMemo(() => bonosCalc.filter(b => {
    if (filtroTipo !== 'todos' && b.ref.tipo !== filtroTipo) return false;
    if (filtroGrado !== 'todos' && (filtroGrado === 'sin_calificar' ? b.grado != null : b.grado !== filtroGrado)) return false;
    if (filtroLey !== 'todos' && (filtroLey === 'sin_clasificar' ? b.ref.ley != null : b.ref.ley !== filtroLey)) return false;
    if (durMin != null || durMax != null) {
      const d = b.duracion?.macaulay;
      if (d == null || !Number.isFinite(d)) return false;
      if (durMin != null && d < durMin) return false;
      if (durMax != null && d > durMax) return false;
    }
    const q = busqueda.trim().toUpperCase();
    if (q && !b.ref.ticker.includes(q) && !(b.ref.emisor?.toUpperCase().includes(q)) && !(b.ref.nombre?.toUpperCase().includes(q))) return false;
    return true;
  }), [bonosCalc, filtroTipo, filtroGrado, filtroLey, durMin, durMax, busqueda]);

  const handleSortRF = (key: SortKeyRF) => setSortRF(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DEFAULT_DIR_RF[key] });
  const ordenadosPorColumna = useMemo(() => {
    if (!sortRF) return filtrados;
    const { key, dir } = sortRF;
    const factor = dir === 'asc' ? 1 : -1;
    const val = (b: typeof filtrados[number]): number | string | null => {
      if (key === 'ticker') return b.ref.ticker;
      if (key === 'ley') return b.ref.ley ? LEY_LABEL[b.ref.ley] : null;
      if (key === 'paridad') return b.paridad;
      if (key === 'tir') return b.tir;
      if (key === 'duracion') { const m = b.duracion?.macaulay; return m != null && Number.isFinite(m) ? m : null; }
      return b.ref.vencimiento;
    };
    return [...filtrados].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * factor;
      return (av - bv) * factor;
    });
  }, [filtrados, sortRF]);
  // Destacados siempre arriba, sin importar el orden de columna elegido — sort() es estable (spec
  // desde ES2019, todos los motores modernos), así que dentro de cada grupo (destacado / no
  // destacado) se conserva el orden de ordenadosPorColumna tal cual.
  const ordenados = useMemo(
    () => [...ordenadosPorColumna].sort((a, b) => Number(destacados.has(b.ref.ticker)) - Number(destacados.has(a.ref.ticker))),
    [ordenadosPorColumna, destacados],
  );

  // Curva: solo entran los que tienen TIR y duración calculables (necesitan cotización de
  // mercado) — sin eso no hay punto que graficar, no un punto en el origen.
  const puntos = useMemo(
    () => filtrados
      .filter(b => b.tir != null && b.duracion != null && Number.isFinite(b.duracion.macaulay))
      .map(b => ({ ...b, duracionAnios: b.duracion!.macaulay, tirPct: b.tir! * 100 })),
    [filtrados],
  );
  const colorDePunto = (b: (typeof puntos)[number]): string => {
    if (colorPor === 'tipo') return TIPO_COLOR[b.ref.tipo];
    if (colorPor === 'ley') return b.ref.ley ? LEY_COLOR[b.ref.ley] : SIN_DATO_COLOR;
    if (b.grado === 'grado_inversion') return chart.pos;
    if (b.grado === 'especulativo') return chart.warn;
    if (b.grado === 'default') return chart.neg;
    return SIN_DATO_COLOR;
  };
  const leyenda: { color: string; label: string }[] = colorPor === 'tipo'
    ? (Object.keys(TIPO_LABEL) as BonoReferencia['tipo'][]).map(t => ({ color: TIPO_COLOR[t], label: TIPO_LABEL[t] }))
    : colorPor === 'ley'
    ? [{ color: LEY_COLOR.local, label: LEY_LABEL.local }, { color: LEY_COLOR.extranjera, label: LEY_LABEL.extranjera }, { color: SIN_DATO_COLOR, label: 'Sin clasificar' }]
    : [{ color: chart.pos, label: 'Grado de inversión' }, { color: chart.warn, label: 'Especulativo' }, { color: chart.neg, label: 'Default' }, { color: SIN_DATO_COLOR, label: 'Sin calificar' }];

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-4 flex flex-wrap gap-3 items-end">
          <Field label="Buscar" className="flex-1 min-w-[180px]">
            <div className="relative">
              <Search className="w-4 h-4 text-ink-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input placeholder="Ticker o emisor" value={busqueda} onChange={e => setBusqueda(e.target.value)} className={`${inputCls} pl-9`} />
            </div>
          </Field>
          <Field label="Tipo">
            <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as typeof filtroTipo)} className={`${inputCls} w-36`}>
              <option value="todos">Todos</option>
              <option value="soberano">{TIPO_LABEL.soberano}</option>
              <option value="subsoberano">{TIPO_LABEL.subsoberano}</option>
              <option value="on">{TIPO_LABEL.on}</option>
            </select>
          </Field>
          <Field label="Calificación">
            <select value={filtroGrado} onChange={e => setFiltroGrado(e.target.value as FiltroGrado)} className={`${inputCls} w-44`}>
              {(Object.keys(FILTRO_GRADO_LABEL) as FiltroGrado[]).map(g => <option key={g} value={g}>{FILTRO_GRADO_LABEL[g]}</option>)}
            </select>
          </Field>
          <Field label="Ley" hint="Jurisdicción aplicable — Bonares/Globales en soberanos, y su equivalente en ONs">
            <select value={filtroLey} onChange={e => setFiltroLey(e.target.value as FiltroLey)} className={`${inputCls} w-32`}>
              {(Object.keys(FILTRO_LEY_LABEL) as FiltroLey[]).map(l => <option key={l} value={l}>{FILTRO_LEY_LABEL[l]}</option>)}
            </select>
          </Field>
          <Field label="Duración (años)">
            <div className="flex items-center gap-1.5">
              <input type="number" min="0" step="0.5" placeholder="Desde" value={filtroDuracionMin}
                onChange={e => setFiltroDuracionMin(e.target.value)} className={`${inputCls} w-20`} />
              <span className="text-ink-500 text-xs">–</span>
              <input type="number" min="0" step="0.5" placeholder="Hasta" value={filtroDuracionMax}
                onChange={e => setFiltroDuracionMax(e.target.value)} className={`${inputCls} w-20`} />
            </div>
          </Field>
          <Field label="Monto a operar (USD)" hint="Para la columna Operable: ¿alcanza el volumen real reciente para este monto?">
            <input type="number" min="0" step="100" value={montoOperarStr}
              onChange={e => setMontoOperarStr(e.target.value)} className={`${inputCls} w-28`} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Curva TIR / duración" sub="Cada punto es un bono u ON — eje X duración (Macaulay, años, sensibilidad a la tasa), eje Y TIR. Calculado por el código a partir del cronograma real (fuente: IOL)."
          right={<div className="flex items-center gap-1.5">
            <span className="text-[11px] text-ink-600 mr-1">Colorear por</span>
            <ViewToggle value={colorPor} onChange={setColorPor} label="Colorear por"
              options={[{ value: 'tipo', label: 'Tipo' }, { value: 'calificacion', label: 'Calificación' }, { value: 'ley', label: 'Ley' }]} />
          </div>} />
        {puntos.length > 0 ? (
          <>
            <div className="px-4 pt-1">
              <ResponsiveContainer width="100%" height={340}>
                <ScatterChart margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="duracionAnios" name="Duración" unit="a" stroke={chart.axis} fontSize={11}
                    domain={[0, (max: number) => max * 1.1]} />
                  <YAxis type="number" dataKey="tirPct" name="TIR" unit="%" stroke={chart.axis} fontSize={11} width={48} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const b = payload[0].payload as (typeof puntos)[number];
                    return (
                      <div className="rounded-xl border px-3 py-2 text-xs shadow-soft" style={{ background: chart.tooltipBg, borderColor: chart.tooltipBorder, color: chart.tooltipText }}>
                        <p className="font-bold mb-0.5">{b.ref.ticker}{b.ref.emisor && <span className="font-normal opacity-70"> · {b.ref.emisor}</span>}</p>
                        <p>TIR: <b className="tnum">{fmtPct(b.tir)}</b> · Duración: <b className="tnum">{fmtNum(b.duracionAnios, 1)}a</b></p>
                        <p>Paridad: <b className="tnum">{fmtNum(b.paridad, 1)}%</b> · Vence {b.ref.vencimiento}</p>
                        {(b.ref.calificadora || b.ref.calificacion) && <p>Rating: {b.ref.calificacion} ({b.ref.calificadora})</p>}
                        {b.ref.ley && <p>{LEY_LABEL[b.ref.ley]}</p>}
                      </div>
                    );
                  }} />
                  <Scatter data={puntos} name="Bonos">
                    {puntos.map((p, i) => <Cell key={i} fill={colorDePunto(p)} />)}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="px-4 pb-4 flex flex-wrap gap-x-4 gap-y-1">
              {leyenda.map(l => (
                <span key={l.label} className="inline-flex items-center gap-1.5 text-[11px] text-ink-600">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: l.color }} />
                  {l.label}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="p-4"><Empty icon={Radar} title="Sin puntos para graficar">Ningún bono del filtro actual tiene cotización de mercado todavía.</Empty></div>
        )}
      </Card>

      <Card>
        <CardHeader title="Catálogo de referencia" sub={`${ordenados.length} de ${bonosRef.length} instrumentos · TIR y duración calculadas por el código, no cargás cupón a mano.`}
          right={<div className="flex items-center gap-1.5">
            {/* Exporta EXACTAMENTE lo que está en pantalla — mismo filtro/orden/destacados que
                `ordenados`, así "catálogo completo o filtrado" no necesita un modo separado: sin
                filtros aplicados ya es el completo. */}
            <span title="Exporta a CSV (Excel/Sheets) exactamente lo que se ve en la tabla de abajo">
              <Button variant="ghost" onClick={() => descargarTexto(bonosACSV(ordenados), nombreArchivoCsv(hoy), 'text/csv;charset=utf-8')}
                disabled={ordenados.length === 0}>
                <Download className="w-4 h-4" /> Exportar CSV
              </Button>
            </span>
            <Button variant="ghost" onClick={refrescarRF} disabled={refreshingRF}>
              <RefreshCw className={`w-4 h-4 ${refreshingRF ? 'animate-spin' : ''}`} /> {refreshingRF ? 'Actualizando…' : 'Refrescar'}
            </Button>
          </div>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr>
                <th className="px-2" title="Destacado"><span className="sr-only">Destacado</span></th>
                <ThSort<SortKeyRF> label="Ticker" align="left" sortKey="ticker" sort={sortRF} onClick={handleSortRF} />
                <th className="text-left px-3">Emisor</th>
                <th className="text-right px-3">Tipo</th>
                <ThSort<SortKeyRF> label="Ley" sortKey="ley" sort={sortRF} onClick={handleSortRF} />
                <th className="text-left px-3">Rating</th>
                <ThSort<SortKeyRF> label="Paridad" sortKey="paridad" sort={sortRF} onClick={handleSortRF} />
                <ThSort<SortKeyRF> label="TIR" sortKey="tir" sort={sortRF} onClick={handleSortRF} />
                <ThSort<SortKeyRF> label="Duración" sortKey="duracion" sort={sortRF} onClick={handleSortRF} />
                <ThSort<SortKeyRF> label="Vencimiento" sortKey="vencimiento" sort={sortRF} onClick={handleSortRF} />
                <th className="px-3" title="¿Alcanza el volumen real reciente para el monto de arriba?">Operable</th>
                <th className="px-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ordenados.map(b => (
                <RentaFijaRow key={b.ref.ticker} calc={b} hoy={hoy} onEditarRating={() => setEditando(b)}
                  destacado={destacados.has(b.ref.ticker)} onToggleDestacado={() => toggleDestacado(b.ref.ticker, !destacados.has(b.ref.ticker))}
                  montoOperar={montoOperar} />
              ))}
              {bonosRefError && (
                <tr><td colSpan={12}><Empty icon={Radar} title="No se pudo cargar el catálogo">Probá recargar la página — si sigue fallando, puede ser un problema temporal de conexión.</Empty></td></tr>
              )}
              {!bonosRefLoading && !bonosRefError && bonosRef.length === 0 && (
                <tr><td colSpan={12}><Empty icon={Radar} title="Todavía sin catálogo de renta fija">Se está armando — volvé a mirar en unos días.</Empty></td></tr>
              )}
              {!bonosRefLoading && !bonosRefError && bonosRef.length > 0 && ordenados.length === 0 && (
                <tr><td colSpan={12}><Empty icon={Search} title="Sin resultados">Probá con otra búsqueda o sacá algún filtro.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {editando && (
        <EditarClasificacionModal calc={editando} onClose={() => setEditando(null)}
          onGuardar={async (calificadora, calificacion, ley) => actualizarClasificacion(editando.ref.ticker, calificadora, calificacion, ley)} />
      )}
    </div>
  );
}

function RentaFijaRow({ calc, hoy, onEditarRating, destacado, onToggleDestacado, montoOperar }: {
  calc: ReturnType<typeof calcularBonoReferencia>; hoy: string; onEditarRating: () => void;
  destacado: boolean; onToggleDestacado: () => Promise<void>; montoOperar: number;
}) {
  const { ref, paridad, tir, duracion, grado, escalaGrado, volumen } = calc;
  const operable = volumen ? evaluarOperabilidad(montoOperar, volumen) : null;
  const vencido = ref.vencimiento < hoy;
  const [busyDestacado, setBusyDestacado] = useState(false);
  const toggle = async () => {
    setBusyDestacado(true);
    try { await onToggleDestacado(); } catch { /* la fila simplemente no cambia — el usuario puede reintentar */ }
    finally { setBusyDestacado(false); }
  };
  return (
    <tr className={`hover:bg-canvas ${destacado ? 'bg-sol/5' : ''}`}>
      <td className="px-2 py-2 text-center">
        <button onClick={toggle} disabled={busyDestacado} className="hover:opacity-75 transition-opacity disabled:opacity-40"
          title={destacado ? 'Quitar de destacados' : 'Marcar como destacado'}
          aria-label={destacado ? `Quitar ${ref.ticker} de destacados` : `Marcar ${ref.ticker} como destacado`} aria-pressed={destacado}>
          <Star className={`w-4 h-4 ${destacado ? 'fill-sol text-sol' : 'text-ink-400'}`} />
        </button>
      </td>
      <td className="px-4 py-2">
        {/* title con la fecha de actualización del catálogo — mismo criterio que UpdatedAt en el
            resto de la app: no hay columna dedicada, pero el dato queda a un hover de distancia. */}
        <div className="flex items-center gap-2" title={`Catálogo actualizado ${ref.actualizado_en.slice(0, 10)}`}>
          <span className="font-semibold text-ink-900">{ref.ticker}</span>
          {ref.amortizable && <span title="Amortiza en cuotas, no todo al vencimiento"><Badge tone="warn">amort.</Badge></span>}
          {vencido && <Badge tone="gray">vencido</Badge>}
        </div>
      </td>
      <td className="px-3 text-ink-700 truncate max-w-[160px]" title={ref.emisor ?? undefined}>{ref.emisor ?? <span className="text-ink-500">—</span>}</td>
      <td className="text-right px-3"><Badge tone={TIPO_TONE[ref.tipo]}>{TIPO_LABEL[ref.tipo]}</Badge></td>
      <td className="text-right px-3">
        <button onClick={onEditarRating} className="hover:opacity-75 transition-opacity" title="Editar ley aplicable" aria-label={`Editar ley aplicable de ${ref.ticker}`}>
          {ref.ley ? <Badge tone={LEY_TONE[ref.ley]}>{LEY_LABEL[ref.ley]}</Badge> : <span className="text-ink-500 text-xs">sin clasificar</span>}
        </button>
      </td>
      <td className="px-3">
        <button onClick={onEditarRating} className="hover:opacity-75 transition-opacity" title="Editar calificación" aria-label={`Editar calificación de ${ref.ticker}`}>
          <RatingBadge calificadora={ref.calificadora} calificacion={ref.calificacion} grado={grado} escala={escalaGrado} />
        </button>
      </td>
      <td className="text-right px-3 tnum">{paridad != null ? `${fmtNum(paridad, 1)}%` : '—'}</td>
      <td className="text-right px-3 tnum">{tir != null ? fmtPct(tir) : '—'}</td>
      <td className="text-right px-3 tnum">{duracion ? `${fmtNum(duracion.macaulay, 1)}a` : '—'}</td>
      <td className="text-right px-3 tnum">{ref.vencimiento}</td>
      <td className="px-3">
        {operable ? (
          <span className="inline-flex items-center gap-1.5" title={`${OPERABLE_LABEL[operable]} · mediana ${fmtUsd(volumen!.medianaUsd, 0)}/día, peor día reciente ${fmtUsd(volumen!.minimoUsd, 0)} (últimas ${volumen!.diasConDatos} ruedas)`}>
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${OPERABLE_DOT[operable]}`} />
          </span>
        ) : <span className="text-ink-500 text-xs" title="Catálogo todavía sin volumen refrescado para este ticker">—</span>}
      </td>
      <td className="px-2 text-right whitespace-nowrap">
        <Link to={`/analisis/bono/${ref.ticker}`} className="text-ink-600 hover:text-accent inline-flex items-center justify-center w-9 h-9" title="Análisis" aria-label="Análisis del bono"><LineChart className="w-4 h-4" /></Link>
      </td>
    </tr>
  );
}

// Editar calificadora/calificación/ley — los únicos campos de bonos_referencia editables desde la
// app (el resto del catálogo lo puebla el proceso mensual vía IOL, ver migración 0036/0042). No hay
// API gratuita que dé rating ni ley aplicable para renta fija argentina, así que se cargan a mano —
// mismo criterio que cedear_ratios.
function EditarClasificacionModal({ calc, onClose, onGuardar }: {
  calc: ReturnType<typeof calcularBonoReferencia>;
  onClose: () => void;
  onGuardar: (calificadora: string | null, calificacion: string | null, ley: 'local' | 'extranjera' | null) => Promise<void>;
}) {
  useEscapeClose(onClose);
  const [calificadora, setCalificadora] = useState(calc.ref.calificadora ?? '');
  const [calificacion, setCalificacion] = useState(calc.ref.calificacion ?? '');
  const [ley, setLey] = useState<'' | 'local' | 'extranjera'>(calc.ref.ley ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const guardar = async () => {
    setBusy(true); setErr(null);
    try { await onGuardar(calificadora.trim() || null, calificacion.trim() || null, ley || null); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-sm" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Clasificación de ${calc.ref.ticker}`}>
        <Card className="animate-rise">
          <CardHeader title={`Clasificación · ${calc.ref.ticker}`}
            sub="Cargada a mano — no hay API gratuita de rating ni de ley aplicable para renta fija argentina."
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />
          <div className="p-4 space-y-3">
            <Field label="Ley aplicable" hint="Jurisdicción — Bonares/Globales en soberanos, y su equivalente en ONs">
              <select value={ley} onChange={e => setLey(e.target.value as typeof ley)} className={inputCls}>
                <option value="">Sin clasificar</option>
                <option value="local">{LEY_LABEL.local}</option>
                <option value="extranjera">{LEY_LABEL.extranjera}</option>
              </select>
            </Field>
            <Field label="Calificadora">
              <select value={calificadora} onChange={e => setCalificadora(e.target.value)} className={inputCls}>
                <option value="">Sin calificadora</option>
                {CALIFICADORAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Nota" hint='ej. "AAA(arg)", "B-", "Caa1"'>
              <input value={calificacion} onChange={e => setCalificacion(e.target.value)} className={inputCls} placeholder="Nota" maxLength={20} />
            </Field>
            {err && <p className="text-xs text-neg">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
              <Button onClick={guardar} disabled={busy}>Guardar</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
