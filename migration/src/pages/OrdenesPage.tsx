import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Receipt, X, Pencil, Trash2, Plus } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { useOrdenes, useOrdenMutations, type OrdenInput } from '../hooks/useOrdenes';
import { useMovimientos, usePosiciones, useMacro } from '../hooks/usePosiciones';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { Card, CardHeader, Stat, Badge, Button, Field, Empty, inputCls, fmtUsd, fmtPct } from '../components/ui';
import { resumenOrdenes, resumenPorMes, controlarOrdenes, type OrdenFila, type Control } from '../engine/ordenes';

// Órdenes y costos: lo operado en el broker, sus comisiones (USD y pesos) y los CONTROLES que detectan datos faltantes o incoherentes
// (sin comisión, sin MEP, monto ≠ nominales × precio, órdenes que no cuadran con los movimientos de compra). La app no ejecuta
// órdenes (regla de oro #4): esto es solo registro y control. Cálculos en engine/ordenes.ts.

const fmtFecha = (iso: string) => iso.split('-').reverse().join('/');
const fmtMes = (m: string) => { const [a, mm] = m.split('-'); return `${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(mm) - 1]} ${a}`; };
const tonoEstado = (e: string) => (e === 'terminada' ? 'pos' : e === 'rechazada' ? 'neg' : 'gray') as 'pos' | 'neg' | 'gray';
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

interface Draft {
  fecha: string; ticker: string; broker: string; numero_orden: string; nominales: string; precio: string; monto: string;
  comUsd: string; comArs: string; mep: string; estado: string; nota: string; lado: 'compra' | 'venta';
}
const vacio = (mep: number | null): Draft => ({
  fecha: new Date().toISOString().slice(0, 10), ticker: '', broker: 'IOL', numero_orden: '', nominales: '', precio: '', monto: '',
  comUsd: '', comArs: '', mep: mep ? String(Math.round(mep * 100) / 100) : '', estado: 'terminada', nota: '', lado: 'compra',
});
const deOrden = (o: OrdenFila): Draft => ({
  fecha: o.fecha, ticker: o.ticker, broker: o.broker, numero_orden: o.numero_orden ?? '', nominales: String(o.nominales),
  precio: o.precio_ejecutado == null ? '' : String(o.precio_ejecutado), monto: String(o.monto_usd),
  comUsd: o.comision_usd == null ? '' : String(o.comision_usd), comArs: o.comision_ars == null ? '' : String(o.comision_ars),
  mep: o.mep == null ? '' : String(o.mep), estado: o.estado, nota: o.nota ?? '', lado: o.lado ?? 'compra',
});

function OrdenModal({ inicial, onClose, onSave }: { inicial: Draft; onClose: () => void; onSave: (d: OrdenInput) => Promise<void> }) {
  useEscapeClose(onClose);
  const [d, setD] = useState<Draft>(inicial);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD(p => ({ ...p, [k]: e.target.value }));

  const guardar = async () => {
    const nominales = num(d.nominales), monto = num(d.monto), precio = num(d.precio);
    const cu = num(d.comUsd), ca = num(d.comArs), mep = num(d.mep);
    if (!d.ticker.trim()) { setErr('Ingresá el ticker.'); return; }
    if (!d.fecha) { setErr('Ingresá la fecha.'); return; }
    if (nominales == null || !(nominales >= 0)) { setErr('Los nominales deben ser un número mayor o igual a 0.'); return; }
    if (d.estado === 'terminada' && !(nominales > 0)) { setErr('Una orden terminada necesita nominales mayores a 0.'); return; }
    if (monto == null || !(monto >= 0)) { setErr('Ingresá el monto operado en USD.'); return; }
    if ([cu, ca, mep, precio].some(x => x != null && !(x >= 0))) { setErr('Precio, comisiones y MEP no pueden ser negativos.'); return; }
    setSaving(true); setErr(null);
    try {
      await onSave({
        fecha: d.fecha, ticker: d.ticker.toUpperCase().trim(), broker: d.broker.trim() || 'IOL', numero_orden: d.numero_orden.trim() || null,
        nominales, precio_ejecutado: precio, monto_usd: monto, comision_usd: cu, comision_ars: ca, mep: mep != null && mep > 0 ? mep : null,
        estado: d.estado, origen: 'manual', nota: d.nota.trim() || null, lado: d.lado,
      });
      onClose();
    } catch (e) { setErr(`No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-2xl" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Orden">
        <Card className="animate-rise">
          <CardHeader title="Orden ejecutada" sub="Registro de lo operado en el broker. No ejecuta ni modifica nada en el mercado."
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />
          <div className="p-4 grid grid-cols-2 gap-3 text-sm">
            <Field label="Operación">
              <select className={inputCls} value={d.lado} onChange={set('lado')}><option value="compra">compra</option><option value="venta">venta</option></select>
            </Field>
            <Field label="Fecha"><input type="date" className={inputCls} value={d.fecha} onChange={set('fecha')} /></Field>
            <Field label="Ticker"><input className={inputCls} value={d.ticker} onChange={set('ticker')} placeholder="MAD, DNC7D…" /></Field>
            <Field label="Nominales"><input className={inputCls} value={d.nominales} onChange={set('nominales')} inputMode="decimal" /></Field>
            <Field label="Precio ejecutado"><input className={inputCls} value={d.precio} onChange={set('precio')} inputMode="decimal" /></Field>
            <Field label="Monto operado (USD)"><input className={inputCls} value={d.monto} onChange={set('monto')} inputMode="decimal" /></Field>
            <Field label="Estado">
              <select className={inputCls} value={d.estado} onChange={set('estado')}>
                <option value="terminada">terminada</option><option value="cancelada">cancelada</option>
                <option value="rechazada">rechazada</option><option value="pendiente">pendiente</option>
              </select>
            </Field>
            <Field label="Comisión en USD"><input className={inputCls} value={d.comUsd} onChange={set('comUsd')} inputMode="decimal" /></Field>
            <Field label="Comisión en $ (ARS)"><input className={inputCls} value={d.comArs} onChange={set('comArs')} inputMode="decimal" /></Field>
            <Field label="MEP del día" hint="pasa la comisión en pesos a USD"><input className={inputCls} value={d.mep} onChange={set('mep')} inputMode="decimal" /></Field>
            <Field label="Nº de orden"><input className={inputCls} value={d.numero_orden} onChange={set('numero_orden')} /></Field>
            <Field label="Broker"><input className={inputCls} value={d.broker} onChange={set('broker')} /></Field>
            <Field label="Nota" className="col-span-2"><input className={inputCls} value={d.nota} onChange={set('nota')} /></Field>
          </div>
          {err && <p className="px-4 pb-2 text-xs text-warn">{err}</p>}
          <div className="px-4 pb-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

const iconoControl = { error: 'text-neg', aviso: 'text-warn', info: 'text-ink-500' } as const;

export function OrdenesPage() {
  const { active } = usePortfolios();
  const { data: ordenes = [], isLoading, isError } = useOrdenes(active?.id);
  const { data: movs = [] } = useMovimientos(active?.id);
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const { data: macro = {} } = useMacro();
  const mep = (macro as Record<string, number | null>).dolar_mep ?? (macro as Record<string, number | null>).dolar_ccl ?? null;
  const { add, update, remove } = useOrdenMutations(active?.id);
  const [modal, setModal] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [filtro, setFiltro] = useState<'todas' | 'terminada' | 'otras'>('todas');
  const [errBorrar, setErrBorrar] = useState<string | null>(null);

  const resumen = useMemo(() => resumenOrdenes(ordenes), [ordenes]);
  const meses = useMemo(() => resumenPorMes(ordenes), [ordenes]);
  const controles = useMemo<Control[]>(() => controlarOrdenes(
    ordenes,
    movs.filter(m => m.tipo === 'compra').map(m => ({ fecha: m.fecha, ticker: m.ticker, cantidad: Number(m.cantidad) || 0 })),
    posiciones.map(p => p.ticker), ['LIQUIDEZ'],
    movs.filter(m => m.tipo === 'venta').map(m => ({ fecha: m.fecha, ticker: m.ticker, cantidad: Number(m.cantidad) || 0 })),
  ), [ordenes, movs, posiciones]);
  const porOrden = useMemo(() => { const m = new Map<string, Control[]>(); for (const c of controles) if (c.ordenId) (m.get(c.ordenId) ?? m.set(c.ordenId, []).get(c.ordenId)!).push(c); return m; }, [controles]);
  const filas = ordenes.filter(o => filtro === 'todas' || (filtro === 'terminada' ? o.estado === 'terminada' : o.estado !== 'terminada'));

  if (!active) return null;
  const errores = controles.filter(c => c.severidad === 'error').length;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink-900 font-display">Órdenes y costos · {active.nombre}</h1>
          <p className="text-xs text-ink-600 mt-0.5">Lo operado en el broker, sus comisiones y los controles de coherencia. Alimenta la TIR neta de <Link to="/desempeno" className="text-celeste-600 underline">Desempeño</Link>.</p>
        </div>
        <Button onClick={() => setModal({ id: null, draft: vacio(mep) })}><span className="inline-flex items-center gap-1"><Plus className="w-4 h-4" />Cargar orden</span></Button>
      </div>

      {isError && <Card><p className="p-4 text-sm text-warn">No se pudieron cargar las órdenes. Reintentá más tarde.</p></Card>}
      {isLoading && <Card><p className="p-4 text-sm text-ink-600">Cargando órdenes…</p></Card>}

      {!isLoading && !isError && ordenes.length === 0 && (
        <Card><Empty icon={Receipt} title="Sin órdenes registradas">
          Este portfolio no lleva el registro de órdenes: sus costos de operación no se descuentan del rendimiento. Cargá una orden acá, o al agregar una posición completá «Costos de la orden».
        </Empty></Card>
      )}

      {ordenes.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Órdenes ejecutadas" value={String(resumen.ejecutadas)} hint={`${resumen.canceladas} canceladas · ${resumen.rechazadas} rechazadas`} />
            <Stat label="Operado" value={fmtUsd(resumen.operadoUsd, 0)} hint="solo órdenes terminadas" />
            <Stat label="Comisiones (USD)" value={fmtUsd(resumen.totalUsdConocido, 2)} hint={`${fmtUsd(resumen.comisionUsd, 2)} en USD + ${fmtUsd(resumen.comisionArsEnUsd, 2)} de pesos al MEP`} />
            <Stat label="Costo sobre lo operado" value={resumen.pctSobreOperado != null ? fmtPct(resumen.pctSobreOperado, 2) : '—'} hint={resumen.comisionArsSinMepPesos > 0 ? `+ $ ${resumen.comisionArsSinMepPesos.toLocaleString('es-AR', { maximumFractionDigits: 0 })} sin MEP, no incluidos` : 'incluye todo lo registrado'} />
          </div>

          <Card>
            <CardHeader title="Controles" sub="Datos faltantes o incoherentes que afectan el costo y el rendimiento neto."
              right={<Badge tone={errores > 0 ? 'neg' : controles.length > 0 ? 'warn' : 'pos'}>{controles.length === 0 ? 'todo en orden' : `${controles.length} ${controles.length === 1 ? 'aviso' : 'avisos'}`}</Badge>} />
            {controles.length === 0 ? (
              <p className="p-4 text-xs text-ink-600">Todas las órdenes tienen comisión, MEP y monto coherente, y cuadran con los movimientos de compra.</p>
            ) : (
              <ul className="divide-y divide-line">
                {controles.map((c, i) => (
                  <li key={i} className="px-4 py-2 text-xs flex items-start gap-2">
                    <span className={`mt-0.5 font-bold ${iconoControl[c.severidad]}`}>{c.severidad === 'error' ? '✕' : c.severidad === 'aviso' ? '!' : 'i'}</span>
                    <span className="text-ink-800">{c.texto}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Costos por mes" />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ink-600 border-b border-line">
                  <th className="px-4 py-2 font-semibold">Mes</th><th className="px-2 py-2 font-semibold text-right">Órdenes</th><th className="px-2 py-2 font-semibold text-right">Operado</th>
                  <th className="px-2 py-2 font-semibold text-right">Comisión USD</th><th className="px-2 py-2 font-semibold text-right">Comisión $ → USD</th><th className="px-4 py-2 font-semibold text-right">Total</th>
                </tr></thead>
                <tbody>
                  {meses.map(m => (
                    <tr key={m.mes} className="border-b border-line/60">
                      <td className="px-4 py-2">{fmtMes(m.mes)}</td><td className="px-2 py-2 text-right tnum">{m.ordenes}</td>
                      <td className="px-2 py-2 text-right tnum">{fmtUsd(m.operadoUsd, 0)}</td><td className="px-2 py-2 text-right tnum">{fmtUsd(m.comisionUsd, 2)}</td>
                      <td className="px-2 py-2 text-right tnum">{fmtUsd(m.comisionArsEnUsd, 2)}{m.comisionArsSinMepPesos > 0 && <span className="text-warn"> +$ {Math.round(m.comisionArsSinMepPesos).toLocaleString('es-AR')}</span>}</td>
                      <td className="px-4 py-2 text-right tnum font-semibold">{fmtUsd(m.totalUsd, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Órdenes" right={
              <select className={`${inputCls} !w-auto !py-1 text-xs`} value={filtro} onChange={e => setFiltro(e.target.value as typeof filtro)} aria-label="Filtrar órdenes">
                <option value="todas">todas</option><option value="terminada">terminadas</option><option value="otras">canceladas / rechazadas</option>
              </select>} />
            {errBorrar && <p className="px-4 pt-2 text-xs text-warn">{errBorrar}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ink-600 border-b border-line">
                  <th className="px-4 py-2 font-semibold">Fecha</th><th className="px-2 py-2 font-semibold">Ticker</th><th className="px-2 py-2 font-semibold text-right">Nominales</th>
                  <th className="px-2 py-2 font-semibold text-right">Precio</th><th className="px-2 py-2 font-semibold text-right">Monto</th><th className="px-2 py-2 font-semibold text-right">Com. USD</th>
                  <th className="px-2 py-2 font-semibold text-right">Com. $</th><th className="px-2 py-2 font-semibold text-right">MEP</th><th className="px-2 py-2 font-semibold">Estado</th><th className="px-4 py-2" />
                </tr></thead>
                <tbody>
                  {filas.map(o => {
                    const cs = porOrden.get(o.id) ?? [];
                    return (
                      <tr key={o.id} className="border-b border-line/60 align-top">
                        <td className="px-4 py-2 whitespace-nowrap">{fmtFecha(o.fecha)}</td>
                        <td className="px-2 py-2 font-semibold">{o.ticker}{o.lado === 'venta' && <span className="ml-1 text-[10px] font-bold text-neg">venta</span>}{o.numero_orden && <span className="block text-[10px] font-normal text-ink-500">#{o.numero_orden}</span>}</td>
                        <td className="px-2 py-2 text-right tnum">{o.nominales.toLocaleString('es-AR')}</td>
                        <td className="px-2 py-2 text-right tnum">{o.precio_ejecutado ?? '—'}</td>
                        <td className="px-2 py-2 text-right tnum">{fmtUsd(o.monto_usd, 2)}</td>
                        <td className="px-2 py-2 text-right tnum">{o.comision_usd != null ? fmtUsd(o.comision_usd, 2) : '—'}</td>
                        <td className="px-2 py-2 text-right tnum">{o.comision_ars != null ? o.comision_ars.toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '—'}</td>
                        <td className="px-2 py-2 text-right tnum">{o.mep != null ? o.mep.toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '—'}</td>
                        <td className="px-2 py-2"><Badge tone={tonoEstado(o.estado)}>{o.estado}</Badge>{cs.length > 0 && <span className="ml-1 text-warn font-bold" title={cs.map(c => c.texto).join('\n')}>!</span>}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-right">
                          <button aria-label="Editar orden" className="p-1.5 text-ink-600 hover:text-ink-900" onClick={() => setModal({ id: o.id, draft: deOrden(o) })}><Pencil className="w-3.5 h-3.5" /></button>
                          <button aria-label="Borrar orden" className="p-1.5 text-ink-600 hover:text-neg" onClick={async () => {
                            if (!window.confirm(`¿Borrar la orden de ${o.ticker} del ${fmtFecha(o.fecha)}? Solo borra el registro; no toca posiciones ni movimientos.`)) return;
                            setErrBorrar(null);
                            try { await remove(o.id); } catch (e) { setErrBorrar(`No se pudo borrar: ${e instanceof Error ? e.message : 'error'}`); }
                          }}><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {modal && (
        <OrdenModal inicial={modal.draft} onClose={() => setModal(null)}
          onSave={async d => { if (modal.id) await update(modal.id, d); else await add(d); }} />
      )}
    </div>
  );
}
