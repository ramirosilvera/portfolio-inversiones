import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, LineChart, Radar, RefreshCw, ArrowUp, ArrowDown, ArrowUpDown, ShoppingCart, Flame } from 'lucide-react';
import { useMacro, useBonosPrecios } from '../hooks/usePosiciones';
import { useCikMap } from '../hooks/useCikMap';
import { useWatchlist, type WatchItem } from '../hooks/useWatchlist';
import { useRadarTicker } from '../hooks/useRadarTicker';
import { useBonosReferencia } from '../hooks/useBonosReferencia';
import { MARGEN_COMPRA_AGRESIVA } from '../engine/dcf';
import type { Rating } from '../engine/score';
import { calcularBonoReferencia, type BonoReferencia } from '../engine/rentaFija';
import { useDcfInputs, type StoredDcf } from '../hooks/useDcfInputs';
import { Card, CardHeader, Button, Badge, Field, Empty, inputCls, fmtUsd, fmtNum, fmtPct } from '../components/ui';
import { UpdatedAt } from '../components/UpdatedAt';

const RATING_TONE: Record<Rating, 'pos' | 'accent' | 'warn' | 'neg'> = { A: 'pos', B: 'accent', C: 'warn', D: 'neg' };

// Orden por columna: cada fila calcula su propio score/DCF de forma independiente (fetch por
// ticker), así que esos valores se reportan al padre (onComputed) para poder ordenar sin
// duplicar el fetch ni levantar el cálculo entero acá arriba.
type SortKey = 'ticker' | 'price' | 'mos' | 'roic' | 'eg5y' | 'score';
interface RowSortData { price: number | null; mos: number | null; roic: number | null; eg5y: number | null; score: number | null; agresiva: boolean }
const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = { ticker: 'asc', price: 'desc', mos: 'desc', roic: 'desc', eg5y: 'desc', score: 'desc' };

// Renta fija: catálogo de referencia (bonos_referencia), no la watchlist de acciones de arriba —
// ver useBonosReferencia. Orden propio (columnas distintas: TIR/duración/vencimiento en vez de
// MoS/ROIC/EG5Y/score).
type SortKeyRF = 'ticker' | 'precio' | 'paridad' | 'tir' | 'duracion' | 'vencimiento';
const DEFAULT_DIR_RF: Record<SortKeyRF, 'asc' | 'desc'> = { ticker: 'asc', precio: 'desc', paridad: 'desc', tir: 'desc', duracion: 'asc', vencimiento: 'asc' };

export function RadarPage() {
  const { data: items = [], isLoading, add, remove } = useWatchlist();
  const qc = useQueryClient();
  const [ticker, setTicker] = useState('');
  const [nota, setNota] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rowData, setRowData] = useState<Record<string, RowSortData>>({});
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

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

  const { data: bonosRef = [], isLoading: bonosRefLoading } = useBonosReferencia();
  const { data: bonosPrecios = {} } = useBonosPrecios();
  const hoy = new Date().toISOString().slice(0, 10);
  const bonosCalc = useMemo(
    () => bonosRef.map(ref => calcularBonoReferencia(ref, bonosPrecios[ref.ticker] ?? null, hoy)),
    [bonosRef, bonosPrecios, hoy],
  );
  const [sortRF, setSortRF] = useState<{ key: SortKeyRF; dir: 'asc' | 'desc' } | null>(null);
  const handleSortRF = (key: SortKeyRF) => setSortRF(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DEFAULT_DIR_RF[key] });
  const bonosOrdenados = useMemo(() => {
    if (!sortRF) return bonosCalc;
    const { key, dir } = sortRF;
    const factor = dir === 'asc' ? 1 : -1;
    const val = (b: typeof bonosCalc[number]): number | string | null => {
      if (key === 'ticker') return b.ref.ticker;
      if (key === 'precio') return b.px;
      if (key === 'paridad') return b.paridad;
      if (key === 'tir') return b.tir;
      if (key === 'duracion') return b.duracion?.macaulay ?? null;
      return b.ref.vencimiento;
    };
    return [...bonosCalc].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * factor;
      return (av - bv) * factor;
    });
  }, [bonosCalc, sortRF]);

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
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold text-ink-900 font-display">Radar · Watchlist</h1>
        <UpdatedAt icon />
      </div>

      <Card>
        <div className="p-4 flex flex-wrap gap-2 items-end text-sm">
          <Field label="Ticker">
            <input placeholder="Ticker (ej. GOOGL)" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
              className={`${inputCls} w-32`} />
          </Field>
          <Field label="Nota (opcional)" className="flex-1 min-w-[140px]">
            <input placeholder="Nota (opcional)" value={nota} onChange={e => setNota(e.target.value)}
              className={inputCls} />
          </Field>
          <div className="flex items-end">
            <Button onClick={agregar} disabled={busy}><Plus className="w-4 h-4" /> Seguir</Button>
          </div>
        </div>
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
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr>
                <ThSort label="Ticker" align="left" sortKey="ticker" sort={sort} onClick={handleSort} />
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
                <tr><td colSpan={8}><Empty icon={Radar} title="Radar vacío">Agregá un ticker arriba para ver su score.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-[11px] text-ink-600">
          El score de fundamentos requiere datos de EDGAR (SEC proxy). Sin eso, se muestra solo el precio y el score queda parcial o —.
        </p>
      </Card>

      <Card>
        <CardHeader title="Renta fija · Catálogo de referencia"
          sub="TIR y duración calculadas por el código a partir del cronograma real de cada bono/ON (fuente: IOL, actualizado periódicamente) — no cargás cupón a mano." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr>
                <ThSort<SortKeyRF> label="Ticker" align="left" sortKey="ticker" sort={sortRF} onClick={handleSortRF} />
                <th className="text-right px-3">Tipo</th>
                <ThSort<SortKeyRF> label="Precio" sortKey="precio" sort={sortRF} onClick={handleSortRF} />
                <ThSort<SortKeyRF> label="Paridad" sortKey="paridad" sort={sortRF} onClick={handleSortRF} />
                <ThSort<SortKeyRF> label="TIR" sortKey="tir" sort={sortRF} onClick={handleSortRF} />
                <ThSort<SortKeyRF> label="Duración" sortKey="duracion" sort={sortRF} onClick={handleSortRF} />
                <ThSort<SortKeyRF> label="Vencimiento" sortKey="vencimiento" sort={sortRF} onClick={handleSortRF} />
                <th className="px-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {bonosOrdenados.map(b => <RentaFijaRow key={b.ref.ticker} calc={b} />)}
              {!bonosRefLoading && bonosRef.length === 0 && (
                <tr><td colSpan={7}><Empty icon={Radar} title="Todavía sin catálogo de renta fija">Se está armando — volvé a mirar en unos días.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function RentaFijaRow({ calc }: { calc: ReturnType<typeof calcularBonoReferencia> }) {
  const { ref, px, paridad, tir, duracion } = calc;
  return (
    <tr className="hover:bg-canvas">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink-900">{ref.ticker}</span>
          {ref.amortizable && <span title="Amortiza en cuotas, no todo al vencimiento"><Badge tone="warn">amort.</Badge></span>}
        </div>
      </td>
      <td className="text-right px-3"><Badge tone={ref.tipo === 'soberano' ? 'accent' : 'gray'}>{ref.tipo === 'soberano' ? 'Soberano' : 'ON'}</Badge></td>
      <td className="text-right px-3 tnum">{fmtUsd(px)}</td>
      <td className="text-right px-3 tnum">{paridad != null ? `${fmtNum(paridad, 1)}%` : '—'}</td>
      <td className="text-right px-3 tnum">{tir != null ? fmtPct(tir) : '—'}</td>
      <td className="text-right px-3 tnum">{duracion ? `${fmtNum(duracion.macaulay, 1)}a` : '—'}</td>
      <td className="text-right px-3 tnum">{ref.vencimiento}</td>
      <td className="px-2 text-right whitespace-nowrap">
        <Link to={`/analisis/bono/${ref.ticker}`} className="text-ink-600 hover:text-accent inline-flex items-center justify-center w-9 h-9" title="Análisis" aria-label="Análisis del bono"><LineChart className="w-4 h-4" /></Link>
      </td>
    </tr>
  );
}

// Genérico en K: lo reusa también la tabla de renta fija más abajo (RentaFijaSort), que ordena por
// columnas distintas (tir/duracion/vencimiento) a las del radar de acciones (mos/roic/eg5y/score).
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
      <td className="text-right px-3 tnum">{fmtUsd(price)}</td>
      <td className="text-right px-3 tnum">{dcf ? fmtPct(dcf.marginOfSafety) : '—'}</td>
      <td className={`text-right px-3 tnum ${ratios?.roic != null && ratios.wacc != null && ratios.roic > ratios.wacc ? 'text-pos' : ''}`}>
        {ratios ? fmtPct(ratios.roic) : '—'}{ratios?.roic != null && ratios.wacc != null && ratios.roic > ratios.wacc ? ' ✓' : ''}
      </td>
      <td className="text-right px-3 tnum">{ratios ? fmtPct(ratios.eg5y) : '—'}</td>
      <td className="text-right px-3">{dcf ? <Badge tone={verdictTone as 'pos' | 'neg' | 'warn'}>{dcf.verdict}</Badge> : <span className="text-ink-600">—</span>}</td>
      <td className="text-right px-3">
        {score?.score != null
          ? <span className="inline-flex items-center gap-1.5"><span className="tnum font-bold text-ink-900">{score.score}</span><Badge tone={RATING_TONE[score.rating!]}>{score.rating}</Badge></span>
          : !cik
            ? <Link to="/config" className="text-[10px] text-warn hover:underline" title="Cargá el CIK en Configuración">sin CIK</Link>
            : isFetching
              ? <span className="text-ink-500 text-xs" title="Cargando fundamentals de EDGAR…">…</span>
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
