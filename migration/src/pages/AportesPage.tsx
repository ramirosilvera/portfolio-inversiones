import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Wallet, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { useAportes, useAporteMutations } from '../hooks/useAportes';
import { useMacro } from '../hooks/usePosiciones';
import { useRendimientoAnual } from '../hooks/useRendimientoAnual';
import { resumenAportes } from '../engine/aportes';
import { Card, CardHeader, Button, Badge, Field, Empty, inputCls, fmtUsd, fmtArs, fmtPct } from '../components/ui';
import type { Aporte, AporteTipo } from '../types/domain';

// Conversión USD↔ARS con el MEP vigente, mismo criterio que el campo ARS vinculado de Comprar/
// Vender en PosicionesPage: el USD sigue siendo el valor que de verdad se guarda (`f.monto`), el ARS
// es solo una vista de conversión para tipear más cómodo. Si no hay MEP (todavía cargando o la
// Function cayó), devuelve '' y el campo ARS queda deshabilitado — el USD sigue funcionando igual.
const arsFromUsd = (usd: number, mep: number | null): string => (mep && usd > 0 ? String(+(usd * mep).toFixed(2)) : '');
const usdFromArs = (ars: number, mep: number | null): string => (mep && ars > 0 ? String(+(ars / mep).toFixed(2)) : '');

const TIPO_TONE: Record<AporteTipo, 'accent' | 'gray' | 'warn' | 'neg'> = { inicial: 'accent', recurrente: 'gray', adelanto: 'warn', retiro: 'neg' };

type AnioFiltro = 'todos' | 'positivos' | 'negativos' | 'sindatos';
// "Sin datos" → "Sin %": filtra por `rendimiento == null` (ver más abajo), y desde que la tabla
// también muestra Aportes/P&L un año puede no tener % pero sí tener esas otras dos columnas — el
// nombre viejo sugería "no hay nada en esta fila", que ya no es necesariamente cierto.
const FILTRO_LABEL: Record<AnioFiltro, string> = { todos: 'Todos', positivos: 'Positivos', negativos: 'Negativos', sindatos: 'Sin %' };
type AnioSortKey = 'anio' | 'rendimiento' | 'aportes' | 'pnl';

// Años "sin dato" siempre al final, sea cual sea la dirección — null no es "peor que -100%" ni
// "peor que -$1000", es una pregunta sin respuesta todavía. Compartido por las 3 columnas numéricas
// (Rendimiento, Aportes, P&L) — cada una puede ser null independientemente de las otras (ej. un
// retiro que deja la base ≤0 invalida el %, pero el P&L en dólares sigue siendo un número real).
function compararConNulls(a: number | null, b: number | null, dir: 'asc' | 'desc'): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

export function AportesPage() {
  const { active } = usePortfolios();
  const { data: aportes = [], isLoading } = useAportes(active?.id);
  const { add, remove } = useAporteMutations(active?.id);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [f, setF] = useState<{ monto: string; montoArs: string; fecha: string; tipo: AporteTipo; descripcion: string }>({
    monto: '', montoArs: '', fecha: new Date().toISOString().slice(0, 10), tipo: 'recurrente', descripcion: '',
  });
  const { data: macro = {} } = useMacro();
  const mep = (macro as Record<string, number | null>).dolar_mep ?? (macro as Record<string, number | null>).dolar_ccl ?? null;

  // Bidireccional: tipear en un campo recalcula el otro con el MEP vigente. Un valor no positivo (0,
  // negativo, a medio tipear) LIMPIA el otro campo en vez de dejarlo con un número viejo que ya no
  // corresponde — mismo criterio que SellModal/SimularCompraModal en PosicionesPage.
  const onUsdChange = (raw: string) => {
    const n = Number(raw);
    setF(prev => ({ ...prev, monto: raw, montoArs: Number.isFinite(n) && n > 0 ? arsFromUsd(n, mep) : '' }));
  };
  const onArsChange = (raw: string) => {
    const n = Number(raw);
    setF(prev => ({ ...prev, montoArs: raw, monto: Number.isFinite(n) && n > 0 ? usdFromArs(n, mep) : '' }));
  };

  // Si el usuario tipea el monto USD antes de que useMacro() resuelva el MEP (mep null al montar),
  // el campo ARS queda deshabilitado y vacío; cuando el MEP llega unos instantes después, sin este
  // efecto el campo se HABILITA pero se queda vacío al lado de un USD ya tipeado — mismo caso que
  // SellModal en PosicionesPage. Solo completa si sigue vacío (no pisa nada que el usuario ya tipeó).
  useEffect(() => {
    if (!mep || f.montoArs !== '') return;
    const n = Number(f.monto);
    if (Number.isFinite(n) && n > 0) setF(prev => ({ ...prev, montoArs: arsFromUsd(n, mep) }));
  }, [mep]); // eslint-disable-line react-hooks/exhaustive-deps

  const { aportado, retirado, neto } = resumenAportes(aportes);

  // Detalle completo de rendimiento por año — MISMO hook que usa el resumen del Dashboard
  // (RendimientoPorAnioCard), nunca recalculado acá con su propia copia (regla de oro #1).
  const { porAnio, anioActual, sinPrecio: sinPrecioRend, preciosPendientes, valuacionDeMercado, hayDatos, cargando } = useRendimientoAnual(active?.id);
  const [filtroAnio, setFiltroAnio] = useState<AnioFiltro>('todos');
  const [sortAnio, setSortAnio] = useState<{ key: AnioSortKey; dir: 'asc' | 'desc' }>({ key: 'anio', dir: 'desc' });
  const handleSortAnio = (key: AnioSortKey) => setSortAnio(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });

  // Si se llegó desde el link "Ver los N años más →" del Dashboard, la tarjeta de detalle queda
  // 3ra en la página (después del form y el historial) — sin esto, el usuario cae arriba de todo y
  // tiene que buscarla a mano.
  useEffect(() => {
    if (window.location.hash === '#rendimiento-anual') {
      document.getElementById('rendimiento-anual')?.scrollIntoView({ block: 'start' });
    }
  }, []);

  const filasAnio = useMemo(() => {
    let filas = porAnio;
    if (filtroAnio === 'positivos') filas = filas.filter(r => r.rendimiento != null && r.rendimiento >= 0);
    else if (filtroAnio === 'negativos') filas = filas.filter(r => r.rendimiento != null && r.rendimiento < 0);
    else if (filtroAnio === 'sindatos') filas = filas.filter(r => r.rendimiento == null);
    return [...filas].sort((a, b) => {
      if (sortAnio.key === 'anio') return sortAnio.dir === 'asc' ? a.anio - b.anio : b.anio - a.anio;
      if (sortAnio.key === 'rendimiento') return compararConNulls(a.rendimiento, b.rendimiento, sortAnio.dir);
      if (sortAnio.key === 'aportes') return compararConNulls(a.aportadoNeto, b.aportadoNeto, sortAnio.dir);
      return compararConNulls(a.pnl, b.pnl, sortAnio.dir);
    });
  }, [porAnio, filtroAnio, sortAnio]);

  const borrar = async (a: Aporte) => {
    if (!window.confirm(`¿Borrar el aporte de ${fmtUsd(a.monto)} del ${a.fecha}?`)) return;
    setDeletingId(a.id); setDeleteErr(null);
    try { await remove(a.id); }
    catch (e) { setDeleteErr(e instanceof Error ? e.message : 'No se pudo borrar'); }
    finally { setDeletingId(null); }
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Aportes · {active.nombre}</h1>

      <Card>
        <CardHeader title="Registrar movimiento de capital" sub="El capital que entra (aporte) o sale (retiro) del portfolio. Impacta la TIR del Dashboard." />
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <Field label="Monto (USD)">
            <input type="number" placeholder="Monto USD" value={f.monto} onChange={e => onUsdChange(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Monto (ARS)" hint={mep ? `MEP ${fmtArs(mep)}` : 'MEP no disponible'}>
            <input type="number" placeholder="Monto ARS" value={f.montoArs} onChange={e => onArsChange(e.target.value)} disabled={!mep}
              className={`${inputCls} disabled:opacity-50 disabled:cursor-not-allowed`} />
          </Field>
          <Field label="Fecha">
            <input type="date" min="2000-01-01" max={new Date().toISOString().slice(0, 10)} value={f.fecha} onChange={e => setF({ ...f, fecha: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Tipo">
            <select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value as AporteTipo })} className={inputCls}>
              <option value="inicial">Inicial</option><option value="recurrente">Recurrente</option><option value="adelanto">Adelanto</option><option value="retiro">Retiro (salida)</option>
            </select>
          </Field>
          <Field label="Descripción">
            <input placeholder="Descripción" value={f.descripcion} onChange={e => setF({ ...f, descripcion: e.target.value })} className={inputCls} />
          </Field>
          <div className="flex items-end">
            <Button disabled={busy} onClick={async () => {
              // Antes: sin validar (aceptaba negativos y fechas futuras) y el error se tragaba, así
              // que un fallo parecía "no hizo nada" y el doble tap duplicaba el aporte.
              const monto = Number(f.monto);
              if (!(monto > 0)) { setErr('El monto debe ser mayor a 0.'); return; }
              if (f.fecha > new Date().toISOString().slice(0, 10)) { setErr('La fecha no puede ser futura.'); return; }
              // Sin cota inferior, un typo de año en el date picker nativo (ej. "0202" en vez de
              // "2026") pasaba silencioso: inceptionYear terminaba en el año 202, y
              // rendimientoPorAnio() generaba ~1800 filas (todas null) en la tabla de Aportes y en
              // el "Ver N años más" del Dashboard — visible recién ahí, no acá donde se originó.
              if (f.fecha < '2000-01-01') { setErr('La fecha no puede ser anterior a 2000.'); return; }
              setBusy(true); setErr(null);
              try {
                await add({ monto, fecha: f.fecha, tipo: f.tipo, descripcion: f.descripcion || null });
                setF({ ...f, monto: '', montoArs: '', descripcion: '' });
              } catch (e) { setErr(`No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`); }
              finally { setBusy(false); }
            }}>
              <Plus className="w-4 h-4" /> {busy ? 'Guardando…' : 'Agregar'}
            </Button>
          </div>
        </div>
        {err && <p className="px-4 pb-3 text-xs text-warn">{err}</p>}
      </Card>

      <Card>
        <CardHeader title="Historial de movimientos"
          right={<span className="text-xs text-ink-600 tnum" title={`Aportado ${fmtUsd(aportado, 0)} · Retirado ${fmtUsd(retirado, 0)}`}>Neto {fmtUsd(neto, 0)}</span>} />
        {deleteErr && <p className="px-4 pt-2 text-xs text-warn">{deleteErr}</p>}
        <div className="divide-y divide-line">
          {isLoading ? (
            <p className="p-4 text-sm text-ink-600">Cargando…</p>
          ) : aportes.length === 0 ? (
            <Empty icon={Wallet} title="Sin aportes">Registrá el primer aporte arriba.</Empty>
          ) : aportes.map(a => (
            <div key={a.id} className="px-4 py-2.5 flex items-center gap-3 gap-y-1 flex-wrap text-sm">
              <span className="text-ink-600 tnum w-24 shrink-0">{a.fecha}</span>
              <Badge tone={TIPO_TONE[a.tipo]}>{a.tipo}</Badge>
              <span className="flex-1 min-w-[80px] text-ink-600 truncate">{a.descripcion || '—'}</span>
              {/* flex-wrap (no un solo renglón sin quiebre): un monto de 7 cifras + el botón de
                  borrar podían empujar la fila entera más allá del borde de la Card en mobile —
                  misma clase de bug que se arregló en Stat (ui.tsx). */}
              <span className={`font-semibold tnum ${a.tipo === 'retiro' ? 'text-neg' : 'text-ink-900'}`}>{a.tipo === 'retiro' ? '−' : ''}{fmtUsd(a.monto, 0)}</span>
              <button onClick={() => borrar(a)} disabled={deletingId === a.id} aria-label="Borrar aporte" title="Borrar aporte" className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9 shrink-0 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      </Card>

      {(cargando || hayDatos) && (
        <div id="rendimiento-anual" className="scroll-mt-4">
          <Card>
            <CardHeader title="Rendimiento por año"
              sub="Detalle completo, año por año — rendimiento (%), aportes netos y ganancia en dólares (P&L). Mismo cálculo que el resumen del Dashboard." />
            {cargando ? (
              <p className="p-4 text-sm text-ink-600">Cargando…</p>
            ) : (
              <>
                {/* `preciosPendientes` (cotizaciones todavía en vuelo) es DISTINTO de "falta un precio
                    de verdad" — sin esta distinción, el aviso aparecía en CADA carga fría (quotes
                    arranca vacío) aunque un instante después resolviera bien, entrenando al usuario a
                    ignorarlo justo el día que sí importa. */}
                {!preciosPendientes && !valuacionDeMercado && (
                  <p className="px-4 pt-3 text-[11px] text-warn">
                    Sin cotización de <b>{sinPrecioRend.slice(0, 4).join(', ')}{sinPrecioRend.length > 4 ? ` +${sinPrecioRend.length - 4}` : ''}</b>:
                    el año en curso se calcula a costo, no a precio de mercado, y hoy no queda registrado en el histórico —
                    el año que viene puede quedar sin punto de apertura.
                  </p>
                )}
                <div role="radiogroup" aria-label="Filtrar años" className="px-4 pt-3 flex flex-wrap gap-2">
                  {(['todos', 'positivos', 'negativos', 'sindatos'] as const).map(opt => (
                    <button key={opt} onClick={() => setFiltroAnio(opt)} role="radio" aria-checked={filtroAnio === opt}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${filtroAnio === opt ? 'bg-celeste-500 text-white border-celeste-500' : 'border-line bg-surface text-ink-700 hover:bg-canvas'}`}>
                      {FILTRO_LABEL[opt]}
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto mt-1">
                  <table className="w-full text-sm">
                    <thead className="text-[11px] text-ink-600">
                      <tr className="border-b border-line">
                        <ThSortAnio label="Año" sortKey="anio" sort={sortAnio} onClick={handleSortAnio} align="left" />
                        <ThSortAnio label="Rendimiento" sortKey="rendimiento" sort={sortAnio} onClick={handleSortAnio} />
                        <ThSortAnio label="Aportes netos" sortKey="aportes" sort={sortAnio} onClick={handleSortAnio}
                          title="Aportes − retiros de ESE año, no el acumulado histórico" />
                        <ThSortAnio label="P&L del año" sortKey="pnl" sort={sortAnio} onClick={handleSortAnio}
                          title="Ganancia en dólares de ESE año — distinto del P&L del Hero del Dashboard, que es la ganancia no realizada actual sobre las posiciones" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {filasAnio.length === 0 ? (
                        <tr><td colSpan={4} className="px-3 py-3 text-ink-600">Sin años que coincidan con el filtro.</td></tr>
                      ) : filasAnio.map(({ anio, rendimiento, aportadoNeto, pnl }) => (
                        <tr key={anio}>
                          <td className="px-3 py-2 text-left tnum text-ink-800">{anio}{anio === anioActual ? ' · en curso' : ''}</td>
                          <td className={`px-3 py-2 text-right tnum font-semibold ${rendimiento == null ? 'text-ink-600' : rendimiento >= 0 ? 'text-pos' : 'text-neg'}`}
                            title={rendimiento != null ? undefined
                              : aportadoNeto == null ? 'Sin snapshot de cierre para este año'
                              : 'Un retiro dejó el capital base en ≤0: el % no es representativo, pero el P&L en dólares sí'}>
                            {rendimiento != null ? fmtPct(rendimiento) : '—'}
                          </td>
                          {/* Sin color pos/neg (a diferencia de Rendimiento/P&L): un aporte neto
                              positivo no es una ganancia, solo dice que entró más capital del que
                              salió ese año — mismo criterio que "Neto aportado" en el Dashboard. */}
                          <td className="px-3 py-2 text-right tnum text-ink-700"
                            title={aportadoNeto == null ? 'Sin snapshot de cierre para este año' : 'Aportes − retiros de ESE año (no acumulado histórico)'}>
                            {aportadoNeto != null ? fmtUsd(aportadoNeto, 0) : <span className="text-ink-600">—</span>}
                          </td>
                          <td className={`px-3 py-2 text-right tnum font-semibold ${pnl == null ? 'text-ink-600' : pnl >= 0 ? 'text-pos' : 'text-neg'}`}
                            title={pnl == null ? 'Sin snapshot de cierre para este año' : 'Ganancia en dólares del año — Vfin − Vini − aportes netos'}>
                            {pnl != null ? fmtUsd(pnl, 0) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-3 text-[11px] text-ink-500">Rendimiento del PASADO, no anualizado ni proyectado. Los años en "—" se completan a medida que la app registra el valor diario; el histórico previo a esta función no se puede reconstruir.</p>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

// Mismo patrón que ThSort en RadarPage.tsx (columna ordenable con click + flecha) — copiado local
// en vez de compartido porque son columnas/tipos de dato distintos (acá 4 columnas). El padding vive
// DENTRO del botón (no en el <th>) para que el área clickeable sea todo el label, no solo el texto —
// un <th className="px-3 py-2"><button>...</button></th> deja un botón de ~16px de alto, bajo el
// mínimo táctil recomendado de 24px. `flex-row-reverse` en las columnas right-aligned: sin esto la
// flecha queda pegada al label (que ya está pegado al borde derecho), separándose visualmente de los
// números de la columna — con la flecha primero, el LABEL es lo que queda pegado al borde, igual que
// los valores de abajo.
function ThSortAnio({ label, sortKey, sort, onClick, align = 'right', title }: {
  label: string; sortKey: AnioSortKey; sort: { key: AnioSortKey; dir: 'asc' | 'desc' }; onClick: (key: AnioSortKey) => void; align?: 'left' | 'right'; title?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={align === 'left' ? 'text-left' : 'text-right'}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => onClick(sortKey)} title={title}
        className={`inline-flex items-center gap-1 px-3 py-2 hover:text-ink-900 transition-colors ${align === 'left' ? '' : 'flex-row-reverse justify-end'} ${active ? 'text-ink-900 font-semibold' : ''}`}>
        {label}
        {active
          ? (sort.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  );
}
