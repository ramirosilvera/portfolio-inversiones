import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, LineChart, Table2, History, X, TrendingDown, Eye, EyeOff, Pencil, ShoppingCart, Target } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, usePosicionMutations, useQuotes, useMovimientos } from '../hooks/usePosiciones';
import { useCedearRatios } from '../hooks/useCedearRatios';
import { useCikMap } from '../hooks/useCikMap';
import { useAporteMutations } from '../hooks/useAportes';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { PortfolioReview } from '../components/PortfolioReview';
import { Card, CardHeader, Button, Badge, Stat, Field, inputCls, Empty, fmtUsd, fmtUsdCompact, fmtNum, fmtPct } from '../components/ui';
import { realizedPnl } from '../engine/pnl';
import { cantidadPorMonto, aplicarObjetivo, redondearPct, resolverObjetivosSimultaneos, pesoResultanteConjunto, TOLERANCIA_OBJETIVO, type SimTarget } from '../engine/rebalance';
import { UpdatedAt } from '../components/UpdatedAt';
import { unitValueUSD } from '../lib/valuation';
import type { Posicion } from '../types/domain';

type Row = { p: Posicion; live: number | null; unit: number | null; mkt: number | null; cost: number; pnl: number | null; pnlPct: number | null };

export function PosicionesPage() {
  const { active } = usePortfolios();
  const { ratios: cedearRatios, saveRatio } = useCedearRatios();
  const { data: posiciones = [], isLoading: posLoading } = usePosiciones(active?.id);
  const { add, sell, update, remove, setObjetivos } = usePosicionMutations(active?.id);
  const { add: addAporte } = useAporteMutations(active?.id);

  const equity = posiciones.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker);
  const bonds = posiciones.filter(p => p.tipo === 'bono').map(p => p.ticker);
  const arStocks = posiciones.filter(p => p.tipo === 'accion_ar').map(p => p.ticker);
  const { data: quotes = {} } = useQuotes(equity, bonds, arStocks);

  const rows = useMemo(() => posiciones.map(p => {
    const live = quotes[p.ticker] ?? null;
    const unit = unitValueUSD(p, live);
    const mkt = unit != null ? unit * p.cantidad : null;
    const cost = p.precio_compra * p.cantidad;
    const pnl = mkt != null ? mkt - cost : null;
    const pnlPct = mkt != null && cost > 0 ? mkt / cost - 1 : null;
    return { p, live, unit, mkt, cost, pnl, pnlPct };
  }), [posiciones, quotes]);

  const totalMkt = rows.reduce((s, r) => s + (r.mkt ?? r.cost), 0);
  const pnlNoReal = rows.reduce((s, r) => s + (r.pnl ?? 0), 0);
  const costoTotal = rows.reduce((s, r) => s + r.cost, 0);

  const { data: allMovs = [] } = useMovimientos(active?.id);
  const realized = useMemo(() => realizedPnl(allMovs), [allMovs]);

  const [form, setForm] = useState<Partial<Posicion>>({ tipo: 'cedear', cantidad: 0, precio_compra: 0 });
  const [showForm, setShowForm] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Sin tildar por default: crear un aporte automático cuando en realidad se compró con plata que
  // ya estaba en el portfolio duplicaría capital en la TIR (ver portfolioTir en engine/irr.ts) —
  // más vale que el usuario lo tilde a propósito que asumirlo mal.
  const [capitalNuevo, setCapitalNuevo] = useState(false);
  const [histTicker, setHistTicker] = useState<string | null>(null);
  const [sellData, setSellData] = useState<{ pos: Posicion; sugerido: number | null } | null>(null);
  const [editPos, setEditPos] = useState<Posicion | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [simular, setSimular] = useState<{ pos?: Posicion; ticker?: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link desde otras páginas (ej. Radar, Cupones): ?simular=1&ticker=XXX abre el modal
  // pre-cargado. Se limpian los params apenas se consumen para que un refresh no lo reabra solo.
  useEffect(() => {
    if (searchParams.get('simular')) {
      setSimular({ ticker: searchParams.get('ticker') ?? undefined });
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const cerradas = rows.filter(r => r.p.cantidad <= 0).length;
  const visibleRows = showClosed ? rows : rows.filter(r => r.p.cantidad > 0);
  const openRows = rows.filter(r => r.p.cantidad > 0);
  // % objetivo mostrados como enteros que SUMAN 100 exactos (resto mayor), no redondeos sueltos.
  const objetivoPct = redondearPct(openRows.filter(r => r.p.peso_objetivo != null).map(r => ({ id: r.p.id, peso: r.p.peso_objetivo! })));

  // Edición inline del % objetivo con sincronización a 100%: el plan son las posiciones abiertas
  // con objetivo asignado (más la que se está tocando); el resto se reescala solo.
  const setTargetFor = async (pos: Posicion, pctStr: string) => {
    const nuevo = pctStr.trim() === '' ? null : Math.max(0, Math.min(100, Number(pctStr))) / 100;
    if (nuevo != null && !Number.isFinite(nuevo)) return;
    const planIds = new Set(openRows.filter(r => r.p.peso_objetivo != null).map(r => r.p.id));
    planIds.add(pos.id);
    const targeted = openRows.filter(r => planIds.has(r.p.id)).map(r => ({ id: r.p.id, peso_objetivo: r.p.peso_objetivo }));
    const result = aplicarObjetivo(targeted, pos.id, nuevo);
    try { await setObjetivos(result); } catch { /* el input vuelve al valor guardado en el próximo refetch */ }
  };

  // Pre-llena el ratio de un CEDEAR desde la base (si existe y el usuario no lo tipeó).
  const applyAuto = (f: Partial<Posicion>): Partial<Posicion> => {
    if (f.tipo === 'cedear' && f.ticker && cedearRatios[f.ticker] && !f.ratio_cedear) {
      return { ...f, ratio_cedear: cedearRatios[f.ticker] };
    }
    return f;
  };

  const guardar = async () => {
    if (!form.ticker) { setFormErr('Ingresá el ticker.'); return; }
    if (!(Number(form.cantidad) > 0)) { setFormErr('La cantidad debe ser mayor a 0.'); return; }
    if (!(Number(form.precio_compra) > 0)) { setFormErr('Ingresá el precio de compra.'); return; }
    if (form.tipo === 'cedear' && !(form.ratio_cedear && form.ratio_cedear > 0)) {
      setFormErr('Un CEDEAR necesita su ratio (subyacentes por CEDEAR) — sin eso el valor se calcula mal.'); return;
    }
    setSaving(true); setFormErr(null);
    try {
      await add(form);
      // Si es CEDEAR y no estaba en la base, la enriquecemos con este ratio.
      if (form.tipo === 'cedear' && form.ticker && form.ratio_cedear && !cedearRatios[form.ticker]) {
        void saveRatio(form.ticker, form.ratio_cedear);
      }
      // Aporte automático SOLO si el usuario tildó "es capital nuevo" — evita la carga duplicada
      // (posición + aporte a mano) sin arriesgar duplicar capital en la TIR cuando en realidad se
      // compró con plata que ya estaba en el portfolio (ver nota en el estado de capitalNuevo).
      if (capitalNuevo) {
        const monto = (Number(form.cantidad) || 0) * (Number(form.precio_compra) || 0);
        if (monto > 0) {
          try {
            await addAporte({
              monto, fecha: form.fecha_compra || new Date().toISOString().slice(0, 10),
              tipo: 'recurrente', descripcion: `Compra ${form.ticker}`,
            });
          } catch { /* la posición ya se guardó — un aporte fallido no debe parecer que todo falló */ }
        }
      }
      setShowForm(false);
      setForm({ tipo: 'cedear', cantidad: 0, precio_compra: 0 });
      setCapitalNuevo(false);
    } catch (e) {
      setFormErr(`No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`);
    } finally { setSaving(false); }
  };

  const borrar = async (p: Posicion) => {
    if (!window.confirm(`¿Borrar ${p.ticker}? Se elimina la posición y su historial. No se puede deshacer.`)) return;
    setDeletingId(p.id);
    try { await remove(p.id); }
    catch (e) { window.alert(`No se pudo borrar: ${e instanceof Error ? e.message : 'error'}`); }
    finally { setDeletingId(null); }
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-900 font-display">Posiciones · {active.nombre}</h1>
          <UpdatedAt icon />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setSimular({})}><ShoppingCart className="w-4 h-4" /> Simular compra</Button>
          <Button onClick={() => {
            // Al abrir, arrancar limpio: sin esto, campos de una carga anterior (incluido cupón)
            // reaparecían y podían mezclarse con el alta siguiente.
            setShowForm(v => { if (!v) { setForm({ tipo: 'cedear', cantidad: 0, precio_compra: 0 }); setFormErr(null); setCapitalNuevo(false); } return !v; });
          }}><Plus className="w-4 h-4" /> Agregar</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Valor de mercado" value={fmtUsdCompact(totalMkt)} />
        <Stat label="Costo" value={fmtUsdCompact(costoTotal)} />
        <Stat label="P&L no realizado" value={fmtUsdCompact(pnlNoReal)} delta={costoTotal > 0 ? pnlNoReal / costoTotal : undefined} hint="ganancia/pérdida de lo que tenés hoy" />
        <Stat label="P&L realizado" value={fmtUsdCompact(realized.total)} hint="resultado de las ventas (según historial)" />
      </div>

      {showForm && (
        <Card>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <Field label="Tipo">
              <select value={form.tipo} onChange={e => setForm(f => applyAuto({ ...f, tipo: e.target.value as Posicion['tipo'] }))}
                className={`${inputCls} appearance-none`}>
                <option value="cedear">CEDEAR</option>
                <option value="accion">Acción (US)</option>
                <option value="accion_ar">Acción ARG</option>
                <option value="etf">ETF</option>
                <option value="bono">Bono / ON</option>
                <option value="cash">Cash</option>
              </select>
            </Field>
            <Field label="Ticker">
              <input placeholder="Ticker" value={form.ticker ?? ''} onChange={e => setForm(f => applyAuto({ ...f, ticker: e.target.value.toUpperCase() }))} className={inputCls} />
            </Field>
            <Field label="Cantidad">
              <input placeholder="Cantidad" type="number" onChange={e => setForm({ ...form, cantidad: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Precio compra (USD)">
              <input placeholder="Precio compra USD" type="number" onChange={e => setForm({ ...form, precio_compra: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Ratio CEDEAR">
              <input placeholder={form.tipo === 'cedear' ? 'Ratio (auto)' : 'Ratio (CEDEAR)'} type="number" value={form.ratio_cedear ?? ''} onChange={e => setForm({ ...form, ratio_cedear: Number(e.target.value) || null })} className={inputCls} />
            </Field>
            <Field label="% objetivo">
              <input placeholder="% objetivo (0-100)" type="number" onChange={e => setForm({ ...form, peso_objetivo: e.target.value ? Number(e.target.value) / 100 : null })} className={inputCls} />
            </Field>
            <Field label="Fecha de compra">
              <input type="date" value={form.fecha_compra ?? ''} onChange={e => setForm({ ...form, fecha_compra: e.target.value || null })} className={inputCls} />
            </Field>
            <Field label="Sector">
              <input placeholder="Sector" onChange={e => setForm({ ...form, sector: e.target.value })} className={`${inputCls} text-base sm:text-sm`} />
            </Field>
            <div className="flex items-end">
              <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
            </div>
          </div>
          {form.tipo === 'bono' && (
            <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm border-t border-line pt-3">
              <div className="col-span-2 sm:col-span-4 text-[11px] text-ink-600">Datos de cupón (para el flujo de cupones):</div>
              <Field label="Tasa cupón (% anual)">
                <input placeholder="Tasa cupón % anual" type="number" step="0.1" value={form.cupon_tasa != null ? form.cupon_tasa * 100 : ''}
                  onChange={e => setForm({ ...form, cupon_tasa: e.target.value ? Number(e.target.value) / 100 : null })}
                  className={inputCls} />
              </Field>
              <Field label="Frecuencia">
                <select value={form.cupon_frecuencia ?? ''} onChange={e => setForm({ ...form, cupon_frecuencia: e.target.value ? Number(e.target.value) : null })}
                  className={`${inputCls} appearance-none`}>
                  <option value="">Frecuencia…</option>
                  <option value="1">Anual</option>
                  <option value="2">Semestral</option>
                  <option value="4">Trimestral</option>
                </select>
              </Field>
              <Field label="Mes de pago">
                <select value={form.cupon_mes ?? ''} onChange={e => setForm({ ...form, cupon_mes: e.target.value ? Number(e.target.value) : null })}
                  className={`${inputCls} appearance-none`}>
                  <option value="">Mes de pago…</option>
                  {['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'].map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="Vencimiento">
                <input placeholder="Vencimiento" type="date" value={form.vencimiento ?? ''}
                  onChange={e => setForm({ ...form, vencimiento: e.target.value || null })}
                  className={inputCls} />
              </Field>
            </div>
          )}
          <div className="px-4 pb-3">
            <label className="flex items-start gap-2 text-xs text-ink-700 cursor-pointer">
              <input type="checkbox" checked={capitalNuevo} onChange={e => setCapitalNuevo(e.target.checked)} className="mt-0.5" />
              <span>
                ¿Es capital nuevo (recién ingresado, no plata que ya estaba en el portfolio)? Si tildás esto se registra
                un aporte de {fmtUsd((Number(form.cantidad) || 0) * (Number(form.precio_compra) || 0), 0)} automáticamente,
                para no tener que cargarlo dos veces en Aportes.
              </span>
            </label>
          </div>
          {formErr && <p className="px-4 pb-3 text-xs text-warn">{formErr}</p>}
        </Card>
      )}

      <Card>
        <CardHeader title="Cartera" sub="Al agregar un activo ya existente se consolida (costo promedio ponderado); mirá el historial con el ícono de reloj."
          right={
            <div className="flex items-center gap-3">
              {cerradas > 0 && (
                <button onClick={() => setShowClosed(v => !v)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-600 hover:text-celeste-600">
                  {showClosed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showClosed ? 'Ocultar cerradas' : `Ver cerradas (${cerradas})`}
                </button>
              )}
              <span className="text-xs text-ink-600 tnum">Total {fmtUsd(totalMkt, 0)}</span>
            </div>
          } />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr>
                <th className="text-left px-4 py-2">Activo</th>
                <th className="text-right px-3">Cant.</th>
                <th className="text-right px-3">Compra</th>
                <th className="text-right px-3">Actual</th>
                <th className="text-right px-3">Mercado</th>
                <th className="text-right px-3">P&L</th>
                <th className="text-right px-3">Peso</th>
                <th className="px-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleRows.map(({ p, unit, mkt, pnl, pnlPct }) => {
                const pesoAct = mkt != null && totalMkt > 0 ? mkt / totalMkt : null;
                return (
                  <tr key={p.id} className="hover:bg-canvas">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink-900">{p.ticker}</span>
                        <Badge tone="gray">{p.tipo}</Badge>
                        {p.cantidad <= 0 && <Badge tone="neg">cerrada</Badge>}
                      </div>
                      {p.sector && <span className="text-[10px] text-ink-600">{p.sector}</span>}
                    </td>
                    <td className="text-right px-3 tnum">{fmtNum(p.cantidad, 0)}</td>
                    <td className="text-right px-3 tnum text-ink-700">{fmtUsd(p.precio_compra)}</td>
                    <td className="text-right px-3 tnum text-accent">{unit != null ? fmtUsd(unit) : '—'}</td>
                    <td className="text-right px-3 tnum">{fmtUsd(mkt)}</td>
                    <td className={`text-right px-3 tnum ${pnl == null ? '' : pnl >= 0 ? 'text-pos' : 'text-neg'}`}>
                      {pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}${fmtUsd(pnl, 0)}`}
                      {pnlPct != null && <span className="block text-[10px]">{fmtPct(pnlPct)}</span>}
                    </td>
                    <td className="text-right px-3">
                      {p.cantidad > 0
                        ? <TargetCell pos={p} actual={pesoAct} displayPct={objetivoPct.get(p.id) ?? null} onCommit={v => setTargetFor(p, v)} />
                        : <span className="tnum text-ink-600">—</span>}
                    </td>
                    <td className="px-2 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {p.cantidad > 0 && p.tipo !== 'cash' && (
                          <button onClick={() => setSimular({ pos: p })} className="text-ink-600 hover:text-pos inline-flex items-center justify-center w-9 h-9" title="Comprar / simular" aria-label="Comprar / simular"><ShoppingCart className="w-4 h-4" /></button>
                        )}
                        {p.cantidad > 0 && p.tipo !== 'cash' && (
                          <button onClick={() => setSellData({ pos: p, sugerido: unit ?? p.precio_compra })} className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9" title="Vender" aria-label="Vender"><TrendingDown className="w-4 h-4" /></button>
                        )}
                        <button onClick={() => setEditPos(p)} className="text-ink-600 hover:text-celeste-600 inline-flex items-center justify-center w-9 h-9" title="Editar" aria-label="Editar posición"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setHistTicker(p.ticker)} className="text-ink-600 hover:text-celeste-600 inline-flex items-center justify-center w-9 h-9" title="Historial de movimientos" aria-label="Historial de movimientos"><History className="w-4 h-4" /></button>
                        {p.tipo !== 'bono' && p.tipo !== 'cash' && (
                          <Link to={`/analisis/${p.ticker}`} className="text-ink-600 hover:text-accent inline-flex items-center justify-center w-9 h-9" title="Análisis / DCF" aria-label="Análisis DCF"><LineChart className="w-4 h-4" /></Link>
                        )}
                        <button onClick={() => borrar(p)} disabled={deletingId === p.id} className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9 disabled:opacity-50" title="Borrar" aria-label="Borrar posición"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {posLoading
                ? <tr><td colSpan={8}><p className="p-4 text-sm text-ink-600">Cargando…</p></td></tr>
                : visibleRows.length === 0 && <tr><td colSpan={8}><Empty icon={Table2} title="Sin posiciones todavía">Agregá tu primera posición con el botón "Agregar".</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mismo componente/endpoint que usa Consolidado (una sola cartera acá) — no es un llamado
          nuevo a Gemini, es la misma revisión de riesgo de cartera ya construida, disponible sin
          tener que ir a la vista "todos". */}
      {openRows.length > 0 && (
        <PortfolioReview
          posiciones={openRows.map(r => r.p)}
          pfName={new Map([[active.id, active.nombre]])}
          pesos={new Map(openRows.map(r => [r.p.ticker, totalMkt > 0 ? (r.mkt ?? r.cost) / totalMkt : 0]))}
        />
      )}

      {histTicker && <MovimientosModal portfolioId={active.id} ticker={histTicker} onClose={() => setHistTicker(null)} />}
      {sellData && <SellModal pos={sellData.pos} sugerido={sellData.sugerido}
        onClose={() => setSellData(null)}
        onSell={async (qty, precio, fecha, retiro) => {
          await sell(sellData.pos, qty, precio, fecha);
          // Retiro SOLO si el usuario tildó "sacás esta plata del portfolio" — vender y dejar el
          // efectivo adentro para la próxima compra no es un movimiento externo, no toca aportes
          // (mismo criterio que el toggle de "capital nuevo" al comprar, ver más arriba).
          if (retiro) {
            const monto = qty * precio;
            if (monto > 0) {
              try { await addAporte({ monto, fecha, tipo: 'retiro', descripcion: `Venta ${sellData.pos.ticker}` }); }
              catch { /* la venta ya se registró — un aporte fallido no debe parecer que todo falló */ }
            }
          }
          setSellData(null);
        }} />}
      {editPos && <EditModal pos={editPos} onClose={() => setEditPos(null)}
        onSave={async (patch) => { await update(editPos.id, patch); setEditPos(null); }} />}
      {simular && <SimularCompraModal openRows={openRows} totalMkt={totalMkt} cedearRatios={cedearRatios}
        initial={simular.pos} initialTicker={simular.ticker} onClose={() => setSimular(null)}
        onEjecutar={async (payload) => { await add(payload); }} />}
    </div>
  );
}

// Celda de peso: muestra el peso actual y permite editar el % objetivo inline (se sincroniza a 100%
// con el resto). Debajo, la desviación actual−objetivo (verde = por debajo → hay lugar para comprar).
function TargetCell({ pos, actual, displayPct, onCommit }: { pos: Posicion; actual: number | null; displayPct: number | null; onCommit: (v: string) => void }) {
  // displayPct viene redondeado a nivel del conjunto (suma 100 exacta), no por celda suelta.
  const fromPos = () => (displayPct != null ? String(displayPct) : '');
  const [val, setVal] = useState(fromPos());
  const [focused, setFocused] = useState(false);
  // Sincronizamos desde la base salvo mientras el usuario tipea (el rebalanceo de otra celda dispara
  // un refetch: sin este guard, pisaría lo que estás escribiendo). Al desenfocar, se re-sincroniza
  // (y así también se limpia un texto inválido que no llegó a guardarse).
  useEffect(() => { if (!focused) setVal(fromPos()); }, [displayPct, focused]);   // eslint-disable-line react-hooks/exhaustive-deps
  const off = actual != null && pos.peso_objetivo != null ? actual - pos.peso_objetivo : null;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="tnum font-medium text-ink-900">{actual != null ? fmtPct(actual, 0) : '—'}</span>
      <div className="flex items-center gap-1 text-ink-500">
        <span className="text-[9px] uppercase">obj</span>
        <input value={val} onChange={e => setVal(e.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => { onCommit(val); setFocused(false); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="—" inputMode="numeric" aria-label={`Objetivo de ${pos.ticker} en %`}
          className="w-9 text-right text-[11px] bg-canvas border border-line rounded px-1 py-0.5 tnum focus:outline-none focus:ring-1 focus:ring-celeste-300" />
        <span className="text-[9px]">%</span>
      </div>
      {off != null && Math.abs(off) >= TOLERANCIA_OBJETIVO && (
        <span className={`text-[9px] tnum ${off > 0 ? 'text-warn' : 'text-celeste-600'}`} title={off > 0 ? 'por encima del objetivo' : 'por debajo del objetivo'}>
          {off > 0 ? '+' : ''}{fmtPct(off, 0)}
        </span>
      )}
    </div>
  );
}

const MESES_E = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Edición/corrección directa de una posición (cantidad, costo promedio, objetivo, sector, ratio,
// cupón). Es una corrección manual: no genera movimientos (no es una compra/venta real).
function EditModal({ pos, onClose, onSave }: { pos: Posicion; onClose: () => void; onSave: (patch: Partial<Posicion>) => Promise<void> }) {
  useEscapeClose(onClose);
  const { map: cikMap } = useCikMap();
  const [ticker, setTicker] = useState(pos.ticker);
  const [cantidad, setCantidad] = useState(String(pos.cantidad));
  const [precio, setPrecio] = useState(String(pos.precio_compra));
  const [sector, setSector] = useState(pos.sector ?? '');
  const [ratio, setRatio] = useState(pos.ratio_cedear != null ? String(pos.ratio_cedear) : '');
  const [cTasa, setCTasa] = useState(pos.cupon_tasa != null ? String(pos.cupon_tasa * 100) : '');
  const [cFreq, setCFreq] = useState(pos.cupon_frecuencia != null ? String(pos.cupon_frecuencia) : '');
  const [cMes, setCMes] = useState(pos.cupon_mes != null ? String(pos.cupon_mes) : '');
  const [vto, setVto] = useState(pos.vencimiento ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Bonos licitados: al cargarlos muchas veces todavía no se sabe el ticker definitivo (se asigna
  // después de la licitación) — para el resto de los tipos el ticker es estable y renombrarlo no
  // tiene un caso de uso real, así que se deja bloqueado para no invitar a tocarlo por error.
  const tickerEditable = pos.tipo === 'bono';
  const tickerCambiado = tickerEditable && ticker.trim().toUpperCase() !== pos.ticker;
  // cik_map/watchlist quedan indexados por ticker (string) — si el viejo tenía un override de CIK
  // cargado, renombrar lo deja huérfano. No bloquea (el caso de uso es real y legítimo), solo avisa.
  const dejaCikHuerfano = tickerCambiado && cikMap.has(pos.ticker);

  const guardar = async () => {
    if (tickerEditable && !ticker.trim()) { setErr('Ingresá un ticker.'); return; }
    // Antes: `Number(cantidad) || 0` — vaciar el campo, o tipear un negativo, guardaba 0 (la
    // posición "se cierra" sin aviso) o un negativo (peso/valor de mercado negativos, contamina
    // totalMkt de toda la sección). El formulario de alta SÍ valida esto (ver arriba); acá faltaba.
    if (!(Number(cantidad) > 0)) { setErr('La cantidad debe ser mayor a 0.'); return; }
    if (!(Number(precio) > 0)) { setErr('El costo promedio debe ser mayor a 0.'); return; }
    // Mismo criterio que el alta: un CEDEAR sin ratio se valúa mal (unitValueUSD devuelve null), y
    // acá era posible VACIAR el ratio de un CEDEAR ya cargado sin ningún aviso.
    if (pos.tipo === 'cedear' && !(ratio && Number(ratio) > 0)) {
      setErr('Un CEDEAR necesita su ratio (subyacentes por CEDEAR) — sin eso el valor se calcula mal.'); return;
    }
    setBusy(true); setErr(null);
    const patch: Partial<Posicion> = {
      cantidad: Number(cantidad),
      precio_compra: Number(precio),
      sector: sector || null,
      ratio_cedear: ratio ? Number(ratio) : null,
    };
    if (tickerEditable) patch.ticker = ticker.trim().toUpperCase();
    if (pos.tipo === 'bono') {
      patch.cupon_tasa = cTasa ? Number(cTasa) / 100 : null;
      patch.cupon_frecuencia = cFreq ? Number(cFreq) : null;
      patch.cupon_mes = cMes ? Number(cMes) : null;
      patch.vencimiento = vto || null;
    }
    try { await onSave(patch); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-lg" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Editar ${pos.ticker}`}>
        <Card className="animate-rise">
          <CardHeader title={`Editar · ${pos.ticker}`} sub="Corrección directa de los datos (no registra compra/venta)."
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />
          <div className="p-4 grid grid-cols-2 gap-3 text-sm">
            {tickerEditable && (
              <Field label="Ticker" hint="Bono licitado sin ticker asignado todavía: podés corregirlo acá cuando lo tengas.">
                <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} className={inputCls} />
              </Field>
            )}
            <Field label="Cantidad"><input type="number" value={cantidad} onChange={e => setCantidad(e.target.value)} className={inputCls} /></Field>
            <Field label="Costo promedio (USD)"><input type="number" value={precio} onChange={e => setPrecio(e.target.value)} className={inputCls} /></Field>
            <Field label="Sector"><input value={sector} onChange={e => setSector(e.target.value)} className={inputCls} /></Field>
            {pos.tipo === 'cedear' && <Field label="Ratio CEDEAR"><input type="number" value={ratio} onChange={e => setRatio(e.target.value)} className={inputCls} /></Field>}
            {pos.tipo === 'bono' && <>
              <Field label="Tasa cupón (% anual)"><input type="number" step="0.1" value={cTasa} onChange={e => setCTasa(e.target.value)} className={inputCls} /></Field>
              <Field label="Frecuencia">
                <select value={cFreq} onChange={e => setCFreq(e.target.value)} className={`${inputCls} appearance-none`}>
                  <option value="">—</option><option value="1">Anual</option><option value="2">Semestral</option><option value="4">Trimestral</option>
                </select>
              </Field>
              <Field label="Mes de pago">
                <select value={cMes} onChange={e => setCMes(e.target.value)} className={`${inputCls} appearance-none`}>
                  <option value="">—</option>{MESES_E.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
              <Field label="Vencimiento"><input type="date" value={vto} onChange={e => setVto(e.target.value)} className={inputCls} /></Field>
            </>}
          </div>
          {dejaCikHuerfano && (
            <p className="px-4 pb-2 text-xs text-warn">
              Tenías un CIK cargado para {pos.ticker} en Configuración — al cambiar el ticker queda sin usar (no se borra, pero ya no aplica a esta posición).
            </p>
          )}
          {err && <p className="px-4 pb-2 text-xs text-warn">{err}</p>}
          <div className="px-4 pb-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function SellModal({ pos, sugerido, onClose, onSell }: {
  pos: Posicion; sugerido: number | null; onClose: () => void;
  onSell: (qty: number, precio: number, fecha: string, retiro: boolean) => Promise<void>;
}) {
  useEscapeClose(onClose);
  const [qty, setQty] = useState<string>(String(pos.cantidad));
  const [precio, setPrecio] = useState<string>(sugerido != null ? String(+sugerido.toFixed(2)) : '');
  const [fecha, setFecha] = useState<string>(new Date().toISOString().slice(0, 10));
  const [retiro, setRetiro] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const n = Number(qty) || 0;
  const p = Number(precio) || 0;
  const costoProm = pos.precio_compra;
  const resultado = n > 0 ? (p - costoProm) * n : 0;

  const hoyISO = new Date().toISOString().slice(0, 10);

  const confirmar = async () => {
    if (!(n > 0)) { setErr('Ingresá una cantidad válida.'); return; }
    if (!(p > 0)) { setErr('Ingresá el precio de venta (no puede ser 0).'); return; }
    if (n > pos.cantidad) { setErr(`No podés vender más de ${fmtNum(pos.cantidad, 0)} que tenés.`); return; }
    if (fecha > hoyISO) { setErr('La fecha no puede ser futura.'); return; }
    // Sin esto, una venta con fecha anterior a la compra ordena ANTES en realizedPnl (engine/pnl.ts)
    // — la venta "sale" con 0 unidades disponibles para vender, así que el P&L realizado se registra
    // en 0 silenciosamente (las tenencias sí bajan bien, solo el resultado queda mal).
    if (pos.fecha_compra && fecha < pos.fecha_compra) {
      setErr(`La fecha de venta no puede ser anterior a la de compra (${pos.fecha_compra}).`); return;
    }
    setBusy(true); setErr(null);
    try { await onSell(n, p, fecha, retiro); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo vender'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Vender ${pos.ticker}`}>
        <Card className="animate-rise">
          <CardHeader title={`Vender · ${pos.ticker}`} sub={`Tenés ${fmtNum(pos.cantidad, 0)} un. · costo prom. ${fmtUsd(pos.precio_compra)}`}
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />
          <div className="p-4 grid grid-cols-2 gap-3">
            <Field label="Cantidad a vender">
              <input type="number" value={qty} onChange={e => setQty(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Precio de venta (USD)">
              <input type="number" value={precio} onChange={e => setPrecio(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Fecha" className="col-span-2">
              <input type="date" min={pos.fecha_compra ?? undefined} max={hoyISO} value={fecha} onChange={e => setFecha(e.target.value)} className={inputCls} />
            </Field>
            <button type="button" onClick={() => setQty(String(pos.cantidad))} className="col-span-2 text-left text-[11px] text-celeste-600 hover:underline">Vender todo ({fmtNum(pos.cantidad, 0)})</button>
          </div>
          <div className="px-4 pb-2 flex items-center justify-between text-sm">
            <span className="text-ink-600">Resultado estimado (vs costo prom.)</span>
            <span className={`tnum font-semibold ${resultado >= 0 ? 'text-pos' : 'text-neg'}`}>{resultado >= 0 ? '+' : ''}{fmtUsd(resultado, 0)}</span>
          </div>
          <div className="px-4 pb-2">
            <label className="flex items-start gap-2 text-xs text-ink-700 cursor-pointer">
              <input type="checkbox" checked={retiro} onChange={e => setRetiro(e.target.checked)} className="mt-0.5" />
              <span>
                ¿Sacás esta plata del portfolio? Si tildás esto se registra un retiro de {fmtUsd(n * p, 0)} en Aportes
                automáticamente. Dejalo destildado si el efectivo se queda adentro para la próxima compra.
              </span>
            </label>
          </div>
          {err && <p className="px-4 pb-2 text-xs text-warn">{err}</p>}
          <div className="px-4 pb-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="danger" onClick={confirmar} disabled={busy}><TrendingDown className="w-4 h-4" /> {busy ? 'Vendiendo…' : 'Vender'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// Simulador de compra: elegís un activo (existente o nuevo), un método (por monto, por cantidad, o
// "llegar al objetivo") y ves el costo y el peso resultante ANTES de ejecutar. Al ejecutar, se
// consolida con la posición existente (costo promedio) igual que una compra normal.
// Una fila de simulación (una compra). El objetivo (%) NO se resuelve acá con el total de hoy: se
// resuelve más abajo, todas las filas con método "objetivo" juntas contra el total final combinado
// (ver resolverObjetivosSimultaneos) — si no, "llegar a 20% de A" ignoraría que "llegar a 15% de B"
// agranda el total contra el que se mide ese 20%.
interface SimDraft {
  key: string;
  modo: 'existente' | 'nuevo';
  selId: string;
  nTicker: string;
  nTipo: Posicion['tipo'];
  nRatio: string;
  precio: string;
  metodo: 'monto' | 'cantidad' | 'objetivo';
  montoStr: string;
  cantStr: string;
  objStr: string;
}

// Precio precargado con más decimales si es chico (ej. bono/ON por nominal muy castigado, < 1
// USD): con 2 decimales fijos un precio de 0,003 se prellenaba "0.00" y la fila quedaba
// inejecutable sin que se entendiera por qué.
const precioStr = (v: number) => String(+v.toFixed(v < 1 ? 4 : 2));

function nuevaSim(usadas: Set<string>, comprables: Row[]): SimDraft {
  const disponibles = comprables.filter(r => !usadas.has(r.p.id));
  const sel = disponibles[0];
  return {
    key: crypto.randomUUID(),
    modo: disponibles.length > 0 ? 'existente' : 'nuevo',
    selId: sel?.p.id ?? '',
    nTicker: '', nTipo: 'cedear', nRatio: '',
    precio: sel ? precioStr(sel.unit ?? sel.p.precio_compra) : '',
    metodo: 'objetivo', montoStr: '', cantStr: '',
    objStr: sel?.p.peso_objetivo != null ? String(Math.round(sel.p.peso_objetivo * 100)) : '',
  };
}

function SimularCompraModal({ openRows, totalMkt, cedearRatios, initial, initialTicker, onClose, onEjecutar }: {
  openRows: Row[]; totalMkt: number; cedearRatios: Record<string, number>;
  initial?: Posicion; initialTicker?: string; onClose: () => void; onEjecutar: (payload: Partial<Posicion>) => Promise<void>;
}) {
  useEscapeClose(onClose);
  const comprables = openRows.filter(r => r.p.tipo !== 'cash');
  const [sims, setSims] = useState<SimDraft[]>(() => {
    // Deep-link con ticker (sin posición existente elegida): arranca en modo "nuevo" con ese
    // ticker precargado — mismo shape que el fallback de nuevaSim() cuando no hay comprables.
    if (!initial && initialTicker) return [{ ...nuevaSim(new Set(), []), nTicker: initialTicker }];
    if (!initial) return [nuevaSim(new Set(), comprables)];
    const selInicial = comprables.find(r => r.p.id === initial.id);
    return [{
      key: crypto.randomUUID(), modo: 'existente', selId: initial.id,
      nTicker: '', nTipo: 'cedear', nRatio: '',
      precio: precioStr(selInicial?.unit ?? initial.precio_compra),
      metodo: 'objetivo', montoStr: '', cantStr: '',
      objStr: initial.peso_objetivo != null ? String(Math.round(initial.peso_objetivo * 100)) : '',
    }];
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const patchSim = (key: string, patch: Partial<SimDraft>) => setSims(prev => prev.map(s => s.key === key ? { ...s, ...patch } : s));

  // Elegir una posición puntual del <select>: precarga precio y objetivo de ESE activo.
  const elegirPosicion = (key: string, selId: string) => {
    const sel = comprables.find(r => r.p.id === selId);
    patchSim(key, {
      modo: 'existente', selId,
      precio: sel ? precioStr(sel.unit ?? sel.p.precio_compra) : '',
      objStr: sel?.p.peso_objetivo != null ? String(Math.round(sel.p.peso_objetivo * 100)) : '',
    });
  };
  // Botón "Activo existente": si la fila YA estaba en ese modo, no tocar la selección (un
  // reclick no debe voltear la posición elegida) — solo al entrar desde "nuevo" se preselecciona
  // la primera disponible.
  const elegirExistente = (key: string) => setSims(prev => prev.map(s => {
    if (s.key !== key || s.modo === 'existente') return s;
    const usadas = new Set(prev.filter(o => o.key !== key && o.modo === 'existente').map(o => o.selId));
    const sel = comprables.find(r => !usadas.has(r.p.id));
    return {
      ...s, modo: 'existente', selId: sel?.p.id ?? '',
      precio: sel ? precioStr(sel.unit ?? sel.p.precio_compra) : '',
      objStr: sel?.p.peso_objetivo != null ? String(Math.round(sel.p.peso_objetivo * 100)) : '',
    };
  }));
  // Igual criterio para "Nuevo activo": un reclick sobre el modo ya activo no debe borrar lo tipeado.
  const elegirNuevo = (key: string) => setSims(prev => prev.map(s =>
    s.key === key && s.modo !== 'nuevo' ? { ...s, modo: 'nuevo', precio: '', objStr: '' } : s));
  const cambiarTicker = (key: string, nTicker: string) => {
    const upper = nTicker.toUpperCase();
    setSims(prev => prev.map(s => {
      if (s.key !== key) return s;
      const nRatio = s.nTipo === 'cedear' && upper && cedearRatios[upper] && !s.nRatio ? String(cedearRatios[upper]) : s.nRatio;
      return { ...s, nTicker: upper, nRatio };
    }));
  };

  // Solo las filas EN modo "existente" bloquean su posición para las demás — una fila que pasó a
  // "nuevo" libera la que tenía elegida antes, aunque su selId interno quede como resto.
  const usadasPorOtras = (key: string) => new Set(sims.filter(s => s.key !== key && s.modo === 'existente').map(s => s.selId));
  const agregarSim = () => setSims(prev => [...prev, nuevaSim(new Set(prev.filter(s => s.modo === 'existente').map(s => s.selId)), comprables)]);
  const quitarSim = (key: string) => setSims(prev => prev.length > 1 ? prev.filter(s => s.key !== key) : prev);

  // Paso 1: por fila, valores independientes del resto (posición, precio, tipo, y el monto si el
  // método es "monto"/"cantidad" — esos NO dependen del total). Las de método "objetivo" quedan con
  // montoFijo=null: se resuelven en el paso 2, todas juntas.
  const derivadas = useMemo(() => sims.map(s => {
    const sel = s.modo === 'existente' ? comprables.find(r => r.p.id === s.selId) : undefined;
    const esNuevoCedear = s.modo === 'nuevo' && s.nTipo === 'cedear';
    const unitPrice = Number(s.precio) || 0;
    const ticker = s.modo === 'existente' ? (sel?.p.ticker ?? '') : s.nTicker.trim().toUpperCase();
    // "Nuevo activo" con un ticker que YA existe en la cartera: al ejecutar, `add()` lo consolida
    // en esa posición (mismo ticker+tipo) — así que el valor base para el peso resultante tiene
    // que ser el de esa posición real, no 0, o el % objetivo sale mal (ver tickerDuplicado más
    // abajo para el caso en que esa MISMA posición además esté elegida en otra fila).
    const posicionReal = s.modo === 'nuevo' && ticker ? comprables.find(r => r.p.ticker === ticker && r.p.tipo === s.nTipo) : undefined;
    const vi = sel ? (sel.mkt ?? sel.cost) : posicionReal ? (posicionReal.mkt ?? posicionReal.cost) : 0;
    let montoFijo: number | null = null;
    if (s.metodo === 'monto') montoFijo = Math.max(0, Number(s.montoStr) || 0);
    else if (s.metodo === 'cantidad') montoFijo = Math.max(0, (Number(s.cantStr) || 0) * unitPrice);
    const objetivo = s.metodo === 'objetivo' && s.objStr ? Math.max(0, Math.min(100, Number(s.objStr))) / 100 : null;
    // Fila "completa": tiene lo mínimo para participar del sistema compartido (targets/montosFijos
    // del paso 2). Una fila a medias (sin ticker, sin precio, CEDEAR nuevo sin ratio) NO debe
    // distorsionar el cálculo de las OTRAS filas — cuenta como si no estuviera.
    const completa = !!ticker && unitPrice > 0 && !(esNuevoCedear && !(Number(s.nRatio) > 0));
    return { key: s.key, sel, esNuevoCedear, vi, unitPrice, ticker, montoFijo, objetivo, completa };
  }), [sims, comprables]);

  // Paso 2: todas las filas por objetivo (%) COMPLETAS, resueltas juntas contra el total final.
  const targets: SimTarget[] = derivadas.filter(d => d.completa && d.objetivo != null).map(d => ({ id: d.key, valorActual: d.vi, objetivo: d.objetivo! }));
  const montosFijos = derivadas.reduce((s, d) => s + (d.completa ? (d.montoFijo ?? 0) : 0), 0);
  const solved = targets.length > 0 ? resolverObjetivosSimultaneos(targets, totalMkt, montosFijos) : new Map<string, number>();
  const objetivosInalcanzables = targets.length > 0 && solved == null;

  // Paso 3: monto final por fila + total final de la cartera con TODAS las compras incluidas
  // (las sobreponderadas/negativas y las filas incompletas no suman: acá no se ejecuta nada de eso).
  const montoPorKey = new Map<string, number>();
  for (const d of derivadas) {
    if (!d.completa) montoPorKey.set(d.key, 0);
    else if (d.montoFijo != null) montoPorKey.set(d.key, d.montoFijo);
    else if (d.objetivo != null) montoPorKey.set(d.key, solved ? (solved.get(d.key) ?? 0) : 0);
    else montoPorKey.set(d.key, 0);
  }
  const totalInvertido = [...montoPorKey.values()].reduce((s, v) => s + Math.max(0, v), 0);
  const totalFinalCartera = totalMkt + totalInvertido;

  const tickersActivos = derivadas.filter(d => d.ticker && (montoPorKey.get(d.key) ?? 0) > 0).map(d => d.ticker);
  const tickerDuplicado = new Set(tickersActivos).size !== tickersActivos.length;

  const filaValida = (d: (typeof derivadas)[number]) => {
    if (!d.completa) return false;
    const costo = Math.max(0, montoPorKey.get(d.key) ?? 0);
    return costo > 0;
  };
  const filasEjecutables = sims.filter((_, i) => filaValida(derivadas[i]));
  const puedeEjecutarAlgo = filasEjecutables.length > 0 && !objetivosInalcanzables && !tickerDuplicado;

  const ejecutarTodas = async () => {
    if (objetivosInalcanzables) { setErr('Los objetivos combinados no son alcanzables comprando (suman demasiado del total resultante) — bajá alguno.'); return; }
    if (tickerDuplicado) { setErr('Hay un ticker repetido entre las simulaciones activas.'); return; }
    if (filasEjecutables.length === 0) { setErr('Completá activo, precio y monto/cantidad/objetivo válidos en al menos una simulación.'); return; }
    setBusy(true); setErr(null);
    try {
      for (const s of filasEjecutables) {
        const d = derivadas.find(x => x.key === s.key)!;
        const monto = montoPorKey.get(d.key) ?? 0;
        const costo = Math.max(0, monto);
        const cantidad = s.metodo === 'cantidad' ? (Number(s.cantStr) || 0) : cantidadPorMonto(costo, d.unitPrice);
        // No seteamos peso_objetivo acá: el % objetivo se administra con el editor inline (que
        // mantiene el plan en 100%). El objetivo del simulador se usa solo para dimensionar la compra.
        const payload: Partial<Posicion> = s.modo === 'existente'
          ? { ticker: d.sel!.p.ticker, tipo: d.sel!.p.tipo, cantidad, precio_compra: d.unitPrice, ratio_cedear: d.sel!.p.ratio_cedear }
          : { ticker: d.ticker, tipo: s.nTipo, cantidad, precio_compra: d.unitPrice, ratio_cedear: s.nTipo === 'cedear' ? Number(s.nRatio) : null };
        await onEjecutar(payload);
        // Sacarla apenas se ejecuta: si una fila más adelante falla, un reintento no debe volver a
        // comprar esta (el catch de abajo NO cierra el modal, así que `sims` sigue visible).
        setSims(prev => prev.filter(x => x.key !== s.key));
      }
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo ejecutar una de las compras — las que ya se ejecutaron no se repiten si reintentás'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-lg" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Simular compra">
        <Card className="animate-rise max-h-[90vh] overflow-y-auto">
          <CardHeader title="Simular compra" sub="Agregá una o varias en simultáneo — el peso resultante de cada una se ajusta con todas."
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />

          <div className="p-4 space-y-4 text-sm">
            {sims.map((s, i) => {
              const d = derivadas[i];
              const monto = montoPorKey.get(d.key) ?? 0;
              const sobreponderada = d.objetivo != null && monto < 0;
              const costo = Math.max(0, monto);
              const cantidad = s.metodo === 'cantidad' ? (Number(s.cantStr) || 0) : cantidadPorMonto(costo, d.unitPrice);
              const pesoNuevo = pesoResultanteConjunto(d.vi, monto, totalFinalCartera);
              const nuevoProm = d.sel && d.sel.p.cantidad + cantidad > 0
                ? (d.sel.p.cantidad * d.sel.p.precio_compra + cantidad * d.unitPrice) / (d.sel.p.cantidad + cantidad) : d.unitPrice;
              // El fallback "|| r.p.id === s.selId" solo aplica en modo "existente" (mantiene visible
              // la posición ya elegida en el <select>). En "nuevo" el selId queda de resto de un
              // modo anterior — sin este distingo, el botón "Activo existente" se mostraba habilitado
              // (con esa opción fantasma) aunque ya no quedara ninguna posición realmente libre.
              const disponibles = comprables.filter(r => !usadasPorOtras(s.key).has(r.p.id) || (s.modo === 'existente' && r.p.id === s.selId));

              const tabBtn = (k: SimDraft['metodo'], label: string) =>
                <button type="button" onClick={() => patchSim(s.key, { metodo: k })} role="radio" aria-checked={s.metodo === k}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${s.metodo === k ? 'bg-celeste-500 text-white' : 'bg-canvas text-ink-600 hover:text-ink-900'}`}>{label}</button>;

              return (
                <div key={s.key} className={i > 0 ? 'pt-4 border-t border-line space-y-3' : 'space-y-3'}>
                  {sims.length > 1 && (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-ink-600 uppercase tracking-wide">Simulación {i + 1}</span>
                      <button onClick={() => quitarSim(s.key)} className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9" title="Quitar esta simulación" aria-label="Quitar esta simulación"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  )}

                  {/* Activo */}
                  <div role="radiogroup" aria-label="Activo a simular" className="flex items-center gap-2">
                    <button type="button" onClick={() => elegirExistente(s.key)} disabled={disponibles.length === 0} role="radio" aria-checked={s.modo === 'existente'}
                      className={`flex-1 px-3 py-1.5 rounded-full text-xs font-semibold ${s.modo === 'existente' ? 'bg-celeste-500 text-white' : 'bg-canvas text-ink-600'} disabled:opacity-40`}>Activo existente</button>
                    <button type="button" onClick={() => elegirNuevo(s.key)} role="radio" aria-checked={s.modo === 'nuevo'}
                      className={`flex-1 px-3 py-1.5 rounded-full text-xs font-semibold ${s.modo === 'nuevo' ? 'bg-celeste-500 text-white' : 'bg-canvas text-ink-600'}`}>Nuevo activo</button>
                  </div>

                  {s.modo === 'existente' ? (
                    <Field label="Posición">
                      <select value={s.selId} onChange={e => elegirPosicion(s.key, e.target.value)} className={`${inputCls} appearance-none`}>
                        {disponibles.map(r => <option key={r.p.id} value={r.p.id}>{r.p.ticker} · {fmtNum(r.p.cantidad, 0)} un · {fmtUsd(r.mkt, 0)}</option>)}
                      </select>
                    </Field>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Ticker"><input value={s.nTicker} onChange={e => cambiarTicker(s.key, e.target.value)} className={inputCls} placeholder="ej. GOOGL" /></Field>
                      <Field label="Tipo">
                        <select value={s.nTipo} onChange={e => patchSim(s.key, { nTipo: e.target.value as Posicion['tipo'] })} className={`${inputCls} appearance-none`}>
                          <option value="cedear">CEDEAR</option><option value="accion">Acción (US)</option><option value="accion_ar">Acción ARG</option><option value="etf">ETF</option><option value="bono">Bono / ON</option>
                        </select>
                      </Field>
                      {d.esNuevoCedear && <Field label="Ratio CEDEAR" className="col-span-2"><input type="number" value={s.nRatio} onChange={e => patchSim(s.key, { nRatio: e.target.value })} className={inputCls} placeholder="subyacentes por CEDEAR" /></Field>}
                    </div>
                  )}

                  <Field label="Precio unitario (USD)" hint={d.sel?.unit != null ? `valuación viva ${fmtUsd(d.sel.unit)}` : undefined}>
                    <input type="number" value={s.precio} onChange={e => patchSim(s.key, { precio: e.target.value })} className={inputCls} placeholder="USD por unidad" />
                  </Field>

                  <div>
                    <span className="block text-[11px] font-semibold text-ink-600 mb-1">Método</span>
                    <div role="radiogroup" aria-label="Método" className="flex flex-wrap items-center gap-1.5">{tabBtn('objetivo', 'Llegar al objetivo')}{tabBtn('monto', 'Por monto')}{tabBtn('cantidad', 'Por cantidad')}</div>
                  </div>

                  {s.metodo === 'monto' && <Field label="Monto a invertir (USD)"><input type="number" value={s.montoStr} onChange={e => patchSim(s.key, { montoStr: e.target.value })} className={inputCls} placeholder="USD" /></Field>}
                  {s.metodo === 'cantidad' && <Field label="Cantidad a comprar"><input type="number" value={s.cantStr} onChange={e => patchSim(s.key, { cantStr: e.target.value })} className={inputCls} placeholder="unidades" /></Field>}
                  {s.metodo === 'objetivo' && (
                    <Field label="% objetivo del activo" hint={targets.length > 1 ? 'se resuelve junto con las demás simulaciones por objetivo' : 'cuánto querés que pese en la cartera'}>
                      <input type="number" value={s.objStr} onChange={e => patchSim(s.key, { objStr: e.target.value })} className={inputCls} placeholder="ej. 10" />
                    </Field>
                  )}

                  {/* Preview de esta fila */}
                  <div className="rounded-xl bg-canvas ring-1 ring-inset ring-line p-3">
                    {sobreponderada ? (
                      <p className="text-xs text-warn flex items-center gap-1.5"><Target className="w-4 h-4 shrink-0" /> {d.ticker || 'El activo'} ya está por encima del objetivo — para llegar deberías vender ~{fmtUsd(Math.abs(monto), 0)}, no comprar.</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="min-w-0"><p className="text-[10px] uppercase text-ink-600 font-semibold">Cantidad</p><p className="tnum font-bold text-ink-900 mt-0.5 truncate" title={cantidad > 0 ? fmtNum(cantidad, cantidad < 10 ? 2 : 0) : undefined}>{cantidad > 0 ? fmtNum(cantidad, cantidad < 10 ? 2 : 0) : '—'}</p></div>
                        <div className="min-w-0"><p className="text-[10px] uppercase text-ink-600 font-semibold">Costo</p><p className="tnum font-bold text-ink-900 mt-0.5 truncate" title={costo > 0 ? fmtUsd(costo, 0) : undefined}>{costo > 0 ? fmtUsd(costo, 0) : '—'}</p></div>
                        <div className="min-w-0"><p className="text-[10px] uppercase text-ink-600 font-semibold">Peso result.</p><p className="tnum font-bold text-celeste-600 mt-0.5 truncate" title={costo > 0 ? fmtPct(pesoNuevo, 1) : undefined}>{costo > 0 ? fmtPct(pesoNuevo, 1) : '—'}</p></div>
                      </div>
                    )}
                    {!sobreponderada && costo > 0 && (
                      <p className="text-[11px] text-ink-600 mt-2 text-center">
                        {d.sel ? <>Peso hoy {fmtPct(totalMkt > 0 ? d.vi / totalMkt : 0, 1)} → {fmtPct(pesoNuevo, 1)} · nuevo costo prom. {fmtUsd(nuevoProm)}</>
                             : <>Nueva posición · pesaría {fmtPct(pesoNuevo, 1)} de la cartera</>}
                        {d.objetivo != null && <> · objetivo {fmtPct(d.objetivo, 0)}</>}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            <button type="button" onClick={agregarSim} className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2 text-xs font-semibold text-ink-600 hover:text-celeste-600 hover:border-celeste-300 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Agregar otra simulación
            </button>
          </div>

          {/* Resumen combinado (solo tiene sentido con 2+ simulaciones) */}
          {sims.length > 1 && (
            <div className="mx-4 mb-3 rounded-xl bg-celeste-50 dark:bg-celeste-500/10 ring-1 ring-inset ring-celeste-200 dark:ring-celeste-500/20 p-3 text-center">
              <p className="text-[11px] text-ink-700">
                Invertirías en total <b className="tnum">{fmtUsd(totalInvertido, 0)}</b> · cartera {fmtUsd(totalMkt, 0)} → <b className="tnum">{fmtUsd(totalFinalCartera, 0)}</b>
              </p>
            </div>
          )}
          {objetivosInalcanzables && <p className="px-4 pb-2 text-xs text-warn">Los objetivos combinados suman demasiado del total resultante — no son alcanzables comprando. Bajá alguno.</p>}
          {tickerDuplicado && <p className="px-4 pb-2 text-xs text-warn">Hay un ticker repetido entre las simulaciones activas.</p>}
          {err && <p className="px-4 pb-2 text-xs text-warn">{err}</p>}
          <div className="px-4 pb-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={ejecutarTodas} disabled={busy || !puedeEjecutarAlgo}>
              <ShoppingCart className="w-4 h-4" /> {busy ? 'Ejecutando…' : filasEjecutables.length > 1 ? `Ejecutar ${filasEjecutables.length} compras` : 'Ejecutar compra'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function MovimientosModal({ portfolioId, ticker, onClose }: { portfolioId: string; ticker: string; onClose: () => void }) {
  useEscapeClose(onClose);
  const { data: movs = [], isLoading } = useMovimientos(portfolioId, ticker);
  const { removeMovimiento } = usePosicionMutations(portfolioId);
  const [errMov, setErrMov] = useState<string | null>(null);
  const totalQty = movs.reduce((s, m) => s + (m.tipo === 'venta' ? -1 : 1) * m.cantidad, 0);
  const realizado = realizedPnl(movs).total;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Movimientos ${ticker}`}>
        <Card className="animate-rise">
          <CardHeader title={`Movimientos · ${ticker}`} sub="Registro de cada compra que consolidó esta posición."
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />
          {errMov && <p className="px-4 pt-2 text-xs text-warn">{errMov}</p>}
          <div className="max-h-[55vh] overflow-y-auto divide-y divide-line">
            {isLoading
              ? <p className="p-4 text-sm text-ink-600">Cargando…</p>
              : movs.length === 0
                ? <Empty icon={History} title="Sin movimientos">Las compras que hagas quedarán registradas acá.</Empty>
                : movs.map(m => (
                  <div key={m.id} className="px-4 py-2.5 flex items-center gap-3 text-sm flex-wrap">
                    <span className="text-ink-600 tnum w-24 shrink-0">{m.fecha}</span>
                    <Badge tone={m.tipo === 'compra' ? 'pos' : m.tipo === 'venta' ? 'neg' : 'gray'}>{m.tipo}</Badge>
                    <span className="flex-1 text-right text-ink-700 tnum">{fmtNum(m.cantidad, 0)} × {fmtUsd(m.precio)}</span>
                    <span className="font-semibold tnum text-ink-900 w-24 text-right">{fmtUsd(m.cantidad * m.precio, 0)}</span>
                    <button
                      onClick={() => { setErrMov(null); if (window.confirm(`¿Borrar este movimiento (${m.tipo} ${fmtNum(m.cantidad, 0)} × ${fmtUsd(m.precio)})? Se recalculan la cantidad y el costo promedio.`)) removeMovimiento(m).catch(e => setErrMov(e instanceof Error ? e.message : 'No se pudo borrar')); }}
                      title="Borrar movimiento" aria-label="Borrar movimiento"
                      className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
          </div>
          {movs.length > 0 && (
            <div className="px-4 py-3 border-t border-line space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Tenencia neta</span>
                <span className="tnum font-semibold text-ink-900">{fmtNum(totalQty, 0)} un.</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-600">P&L realizado</span>
                <span className={`tnum font-semibold ${realizado >= 0 ? 'text-pos' : 'text-neg'}`}>{realizado >= 0 ? '+' : ''}{fmtUsd(realizado, 0)}</span>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
