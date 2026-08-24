import { useMemo, useState } from 'react';
import { Landmark, Plus, Trash2, X } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, useQuotes } from '../hooks/usePosiciones';
import { useBrokers } from '../hooks/useBrokers';
import { usePosicionBrokers } from '../hooks/usePosicionBrokers';
import { useChartTheme } from '../hooks/usePrefs';
import { resumenPorBroker } from '../engine/brokers';
import { unitValueUSD } from '../lib/valuation';
import { Card, CardHeader, Button, Badge, NumField, inputCls, Empty, fmtUsdCompact, fmtPct, colorDeBroker } from '../components/ui';
import type { Posicion } from '../types/domain';

// Brokers: dónde está físicamente cada posición. "Patrimonio por broker" es información MÍNIMA a
// propósito — nombre, USD, % y cantidad de posiciones. La asignación en sí (qué posición está en
// qué broker, y en qué cantidad si está repartida) vive acá, no en Posiciones — que vuelve a ser
// 1 fila por ticker. Ver 0018_posicion_brokers.sql.
export function BrokersPage() {
  const chart = useChartTheme();
  const { active } = usePortfolios();
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const { data: brokers, isLoading: brokersLoading, add, remove } = useBrokers();
  const { data: asignacionesAll, isLoading: asigLoading, setAsignaciones } = usePosicionBrokers();

  const abiertas = useMemo(() => posiciones.filter(p => p.cantidad > 0), [posiciones]);

  const equity = abiertas.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker);
  const bonds = abiertas.filter(p => p.tipo === 'bono').map(p => p.ticker);
  const arStocks = abiertas.filter(p => p.tipo === 'accion_ar').map(p => p.ticker);
  const { data: quotes = {} } = useQuotes(equity, bonds, arStocks);

  // Mismo criterio de valuación que Posiciones (unitValueUSD, fallback a costo sin cotización).
  const posValuadas = useMemo(() => abiertas.map(p => {
    const live = quotes[p.ticker] ?? null;
    const unit = unitValueUSD(p, live);
    const valorUsd = unit != null ? unit * p.cantidad : p.precio_compra * p.cantidad;
    return { id: p.id, cantidad: p.cantidad, valorUsd };
  }), [abiertas, quotes]);

  const asignaciones = useMemo(() => {
    const ids = new Set(abiertas.map(p => p.id));
    return asignacionesAll.filter(a => ids.has(a.posicion_id))
      .map(a => ({ posicionId: a.posicion_id, brokerId: a.broker_id, cantidad: a.cantidad }));
  }, [asignacionesAll, abiertas]);

  const asignacionesPorPosicion = useMemo(() => {
    const m = new Map<string, { brokerId: string; cantidad: number }[]>();
    for (const a of asignaciones) {
      const arr = m.get(a.posicionId) ?? [];
      arr.push({ brokerId: a.brokerId, cantidad: a.cantidad });
      m.set(a.posicionId, arr);
    }
    return m;
  }, [asignaciones]);

  const resumen = useMemo(() => resumenPorBroker(posValuadas, asignaciones, brokers), [posValuadas, asignaciones, brokers]);

  const [nombre, setNombre] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const agregar = async () => {
    if (!nombre.trim()) { setErr('Ingresá un nombre.'); return; }
    setBusy(true); setErr(null);
    try { await add(nombre); setNombre(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo agregar'); }
    finally { setBusy(false); }
  };

  const borrarBroker = async (id: string, nombreBroker: string) => {
    if (!window.confirm(`¿Borrar "${nombreBroker}"? Sus posiciones asignadas quedan sin asignar.`)) return;
    setDeletingId(id); setDeleteErr(null);
    try { await remove(id); }
    catch (e) { setDeleteErr(e instanceof Error ? e.message : 'No se pudo borrar'); }
    finally { setDeletingId(null); }
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Brokers · {active.nombre}</h1>

      <Card>
        <CardHeader title="Agregar broker" sub="Ej. Invertir Online, Santander. Después asigná cada posición más abajo." />
        <div className="p-4 flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[160px] block">
            <span className="block text-[11px] text-ink-600 mb-1">Nombre</span>
            <input value={nombre} onChange={e => setNombre(e.target.value)} className={inputCls} placeholder="ej. Invertir Online" />
          </label>
          <Button onClick={agregar} disabled={busy}><Plus className="w-4 h-4" /> Agregar</Button>
        </div>
        {err && <p className="px-4 pb-3 text-xs text-warn">{err}</p>}
      </Card>

      <Card>
        <CardHeader title="Patrimonio por broker" sub={`Portfolio activo: ${active.nombre} · valuado igual que Posiciones.`} />
        {asigLoading || brokersLoading ? (
          <p className="p-4 text-sm text-ink-600">Cargando…</p>
        ) : resumen.length === 0 ? (
          <Empty icon={Landmark} title="Sin posiciones abiertas">Cuando tengas posiciones abiertas, van a aparecer acá agrupadas por broker.</Empty>
        ) : (
          <>
            <div className="p-4 grid sm:grid-cols-[minmax(0,180px)_1fr] gap-4 items-center border-b border-line">
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={resumen} dataKey="valorUsd" nameKey="nombre" cx="50%" cy="50%" innerRadius={42} outerRadius={72} paddingAngle={2} stroke="none">
                      {resumen.map((r, i) => <Cell key={r.brokerId ?? 'sin-asignar'} fill={colorDeBroker(i, r.brokerId)} />)}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => [fmtUsdCompact(v), 'Patrimonio']}
                      contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, color: chart.tooltipText, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1">
                {resumen.map((r, i) => (
                  <div key={r.brokerId ?? 'sin-asignar'} className="flex items-center gap-2 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorDeBroker(i, r.brokerId) }} />
                    <span className={`font-semibold flex-1 min-w-0 truncate ${r.brokerId == null ? 'text-ink-500' : 'text-ink-800'}`}>{r.nombre}</span>
                    <span className="tnum text-ink-600 w-16 text-right">{fmtPct(r.pct, 0)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead className="text-[11px] text-ink-600 border-b border-line">
                <tr>
                  <th className="text-left px-4 py-2">Broker</th>
                  <th className="text-right px-3">Patrimonio</th>
                  <th className="text-right px-3">%</th>
                  <th className="text-right px-4">Posiciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {resumen.map(r => (
                  <tr key={r.brokerId ?? 'sin-asignar'} className="hover:bg-canvas">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-semibold ${r.brokerId == null ? 'text-ink-500' : 'text-ink-900'}`}>{r.nombre}</span>
                        {r.brokerId == null && <Badge tone="warn">asignar</Badge>}
                      </div>
                    </td>
                    <td className={`text-right px-3 tnum font-semibold ${r.brokerId == null ? 'text-ink-500' : 'text-ink-900'}`}>{fmtUsdCompact(r.valorUsd)}</td>
                    <td className="text-right px-3 tnum text-ink-600">{fmtPct(r.pct, 0)}</td>
                    <td className="text-right px-4 tnum text-ink-600">{r.cantidadPosiciones}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Asignación por posición" sub="Ticker, cantidad y broker. Si una posición está repartida, agregá una fila por cada broker." />
        {asigLoading ? (
          <p className="p-4 text-sm text-ink-600">Cargando…</p>
        ) : abiertas.length === 0 ? (
          <Empty icon={Landmark} title="Sin posiciones abiertas">Cuando tengas posiciones abiertas, van a aparecer acá para asignarles un broker.</Empty>
        ) : (
          <div className="divide-y divide-line">
            {abiertas.map(pos => (
              <AsignacionRow key={pos.id} pos={pos} asignaciones={asignacionesPorPosicion.get(pos.id) ?? []} brokers={brokers}
                onSave={rows => setAsignaciones(pos.id, rows)} />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Tus brokers" />
        {deleteErr && <p className="px-4 pt-2 text-xs text-warn">{deleteErr}</p>}
        {brokersLoading ? (
          <p className="p-4 text-sm text-ink-600">Cargando…</p>
        ) : brokers.length === 0 ? (
          <Empty icon={Landmark} title="Sin brokers cargados">Agregá el primero arriba.</Empty>
        ) : (
          <div className="divide-y divide-line">
            {brokers.map(b => (
              <div key={b.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                <span className="text-ink-800">{b.nombre}</span>
                <button onClick={() => borrarBroker(b.id, b.nombre)} disabled={deletingId === b.id}
                  className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9 disabled:opacity-50" title="Borrar" aria-label="Borrar">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// Fila de asignación de una posición: en reposo muestra ticker + chips (broker cantidad); al
// editar, una fila por asignación (broker + cantidad) con alta/baja libre. Guarda reemplazando
// TODA la lista de esa posición de una sola vez (ver usePosicionBrokers.setAsignaciones).
function AsignacionRow({ pos, asignaciones, brokers, onSave }: {
  pos: Posicion;
  asignaciones: { brokerId: string; cantidad: number }[];
  brokers: { id: string; nombre: string }[];
  onSave: (rows: { brokerId: string; cantidad: number }[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<{ brokerId: string; cantidad: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nombreOf = (id: string) => brokers.find(b => b.id === id)?.nombre ?? 'Broker eliminado';
  const asignado = asignaciones.reduce((s, a) => s + a.cantidad, 0);
  const sinAsignar = +(pos.cantidad - asignado).toFixed(6);

  const startEdit = () => {
    setRows(asignaciones.length ? asignaciones.map(a => ({ ...a })) : [{ brokerId: '', cantidad: pos.cantidad }]);
    setErr(null);
    setEditing(true);
  };

  const guardar = async () => {
    const limpio = rows.filter(r => r.brokerId && r.cantidad > 0);
    const suma = limpio.reduce((s, r) => s + r.cantidad, 0);
    if (suma - pos.cantidad > 1e-6) { setErr(`La suma (${suma}) no puede superar la cantidad de la posición (${pos.cantidad}).`); return; }
    if (new Set(limpio.map(r => r.brokerId)).size !== limpio.length) { setErr('No repitas el mismo broker en dos filas.'); return; }
    // Si borraron un broker mientras este editor estaba abierto, una fila puede seguir apuntando a
    // un id que ya no existe: guardar() hace delete+insert (no atómico) — validar ACÁ, antes del
    // delete, evita perder las asignaciones válidas de la posición por culpa de la fila inválida.
    const brokerIds = new Set(brokers.map(b => b.id));
    if (limpio.some(r => !brokerIds.has(r.brokerId))) { setErr('Uno de los brokers elegidos ya no existe (lo borraste recién) — volvé a elegirlo.'); return; }
    setBusy(true); setErr(null);
    try { await onSave(limpio); setEditing(false); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); }
    finally { setBusy(false); }
  };

  if (!editing) {
    return (
      <div className="px-4 py-2.5 flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <span className="font-semibold text-ink-900">{pos.ticker}</span>
          <span className="text-ink-500 tnum text-xs">{pos.cantidad}u</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {asignaciones.map((a, i) => <Badge key={i} tone="gray">{nombreOf(a.brokerId)} {a.cantidad}</Badge>)}
          {sinAsignar > 0 && <Badge tone="warn">sin asignar {sinAsignar}</Badge>}
          {/* Cantidad vendida después de asignar brokers (ej. venta parcial): las asignaciones viejas
              quedan sumando más que la posición actual — avisar en vez de esconderlo (resumenPorBroker
              solo corrige el TOTAL en USD, no arregla estos números por posición). */}
          {sinAsignar < 0 && <Badge tone="warn">excede cantidad por {-sinAsignar} — revisar</Badge>}
          <button onClick={startEdit} className="text-celeste-600 hover:underline text-xs ml-1">Editar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 text-sm bg-canvas/60 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-ink-900">{pos.ticker} · {pos.cantidad}u</span>
        <button onClick={() => setEditing(false)} aria-label="Cerrar" className="text-ink-500 hover:text-ink-900"><X className="w-4 h-4" /></button>
      </div>
      {rows.map((r, i) => (
        // El select va en su propia línea a ancho completo: un broker con nombre largo (o esta
        // fila en un celular angosto) competía por espacio con la cantidad y el botón de borrar,
        // y con flex-1 se terminaba encogiendo hasta casi 0px — el usuario elegía bien un broker
        // pero no veía QUÉ había elegido (el select se veía vacío, aunque no lo estuviera).
        <div key={i} className="space-y-1.5">
          <select value={r.brokerId} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, brokerId: e.target.value } : x))}
            className={`${inputCls} appearance-none w-full`} aria-label={`Broker de la fila ${i + 1}`}>
            <option value="">Elegí un broker…</option>
            {brokers.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <NumField value={r.cantidad || null}
              onChange={n => setRows(rs => rs.map((x, j) => j === i ? { ...x, cantidad: n } : x))}
              onEmptyBlur={() => setRows(rs => rs.map((x, j) => j === i ? { ...x, cantidad: 0 } : x))}
              className={`${inputCls} w-24 shrink-0`} aria-label={`Cantidad en broker de la fila ${i + 1}`} />
            <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} className="text-ink-600 hover:text-neg w-9 h-9 inline-flex items-center justify-center shrink-0" aria-label="Quitar fila">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
      <button onClick={() => setRows(rs => [...rs, { brokerId: '', cantidad: 0 }])} className="text-xs text-celeste-600 hover:underline inline-flex items-center gap-1">
        <Plus className="w-3 h-3" /> Agregar broker
      </button>
      {err && <p className="text-xs text-warn">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
        <Button onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</Button>
      </div>
    </div>
  );
}
