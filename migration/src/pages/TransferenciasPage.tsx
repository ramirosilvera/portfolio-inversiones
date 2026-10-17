import { useMemo, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, useQuotes } from '../hooks/usePosiciones';
import { unitValueUSD } from '../lib/valuation';
import { useTransferencias, useTransferirPosicion } from '../hooks/useTransferencias';
import { useOrdenes } from '../hooks/useOrdenes';
import { planTrasladoCosto } from '../engine/trasladoCosto';
import { Card, CardHeader, Button, Field, inputCls, Empty, fmtNum, fmtUsd } from '../components/ui';
import type { Posicion } from '../types/domain';

// Reasignación interna de activos entre portfolios propios (fines contables) — preserva el costo y
// la fecha de compra exactos, no es una venta/recompra. Todo el movimiento pasa por una función de
// base de datos atómica (transferir_posicion, ver 0024_transferencias.sql): no toca movimientos/
// pnl.ts (no es una venta). SÍ registra un flujo en `aportes` (retiro en el origen, inicial en el
// destino, a costo — ver 0048_transferir_posicion_registra_aportes.sql): sin eso, el rendimiento por
// año (Modified Dietz) confundía el valor transferido con una ganancia/pérdida de mercado real.
export function TransferenciasPage() {
  const { active, portfolios } = usePortfolios();
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const abiertas = useMemo(() => posiciones.filter(p => p.cantidad > 0), [posiciones]);
  const destinos = useMemo(() => portfolios.filter(p => p.id !== active?.id), [portfolios, active]);
  const { data: transferencias = [], isLoading: histLoading } = useTransferencias();
  const transferirRpc = useTransferirPosicion();
  // Cotización de hoy de lo que se puede transferir: el flujo en aportes que registra la transferencia
  // tiene que ser a VALOR DE MERCADO (es lo que se mueve el patrimonio de cada portfolio), no a costo —
  // ver 0049. Sin cotización (ej. un bono sin precio), la función cae al costo.
  const { data: quotes = {} } = useQuotes(
    abiertas.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker),
    abiertas.filter(p => p.tipo === 'bono').map(p => p.ticker),
    abiertas.filter(p => p.tipo === 'accion_ar').map(p => p.ticker));
  const transferir = (posicionId: string, portfolioDestino: string, cantidad: number, nota?: string, llevarCosto = false) => {
    const pos = abiertas.find(p => p.id === posicionId);
    const unit = pos ? unitValueUSD(pos, quotes[pos.ticker] ?? null) : null;
    const traslado = llevarCosto && pos && active
      ? { ticker: pos.ticker, cantidadPosicion: pos.cantidad, origenNombre: active.nombre, destinoNombre: portfolios.find(p => p.id === portfolioDestino)?.nombre ?? 'otro portfolio' }
      : undefined;
    return transferirRpc(posicionId, portfolioDestino, cantidad, nota, unit != null ? unit * cantidad : null, traslado);
  };
  const pfName = useMemo(() => new Map(portfolios.map(p => [p.id, p.nombre])), [portfolios]);

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ArrowRightLeft className="w-5 h-5 text-accent" />
        <h1 className="text-2xl font-bold text-ink-900 font-display">Transferencias · {active.nombre}</h1>
      </div>

      <TransferirForm portfolioOrigenId={active.id} posiciones={abiertas} destinos={destinos} transferir={transferir} />

      <Card>
        <CardHeader title="Historial" sub="Transferencias de tus portfolios." />
        {histLoading ? (
          <p className="p-4 text-sm text-ink-600">Cargando…</p>
        ) : transferencias.length === 0 ? (
          <Empty icon={ArrowRightLeft} title="Sin transferencias todavía" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="text-[11px] text-ink-600 border-b border-line">
                <tr>
                  <th className="text-left px-4 py-2">Fecha</th>
                  <th className="text-left px-3">Activo</th>
                  <th className="text-right px-3">Cantidad</th>
                  <th className="text-left px-3">De</th>
                  <th className="text-left px-3">A</th>
                  <th className="text-left px-4">Nota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {transferencias.map(t => (
                  <tr key={t.id} className="hover:bg-canvas">
                    <td className="px-4 py-2 text-[11px] text-ink-600 whitespace-nowrap">{new Date(t.created_at).toLocaleDateString('es-AR')}</td>
                    <td className="px-3 font-semibold text-ink-900">{t.ticker}</td>
                    <td className="text-right px-3 tnum">{fmtNum(t.cantidad, 0)}</td>
                    <td className="px-3 text-ink-700">{pfName.get(t.portfolio_origen_id) ?? '—'}</td>
                    <td className="px-3 text-ink-700">{pfName.get(t.portfolio_destino_id) ?? '—'}</td>
                    <td className="px-4 text-[11px] text-ink-600 truncate max-w-[200px]">{t.nota ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function TransferirForm({ portfolioOrigenId, posiciones, destinos, transferir }: {
  portfolioOrigenId: string;
  posiciones: Posicion[];
  destinos: { id: string; nombre: string }[];
  transferir: (posicionId: string, portfolioDestino: string, cantidad: number, nota?: string, llevarCosto?: boolean) => Promise<void>;
}) {
  const [posicionId, setPosicionId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const pos = posiciones.find(p => p.id === posicionId);
  // Costo de las órdenes de compra de la posición que viajaría con la parte transferida (cálculo en engine/trasladoCosto.ts).
  const { data: ordenesOrigen = [] } = useOrdenes(portfolioOrigenId);
  const plan = useMemo(() => (pos ? planTrasladoCosto(ordenesOrigen, pos.ticker, Number(cantidad) || 0, pos.cantidad) : null), [ordenesOrigen, pos, cantidad]);
  const [llevarCosto, setLlevarCosto] = useState(true);

  const enviar = async () => {
    setErr(null); setOk(null);
    if (!pos) { setErr('Elegí una posición.'); return; }
    if (!destinoId) { setErr('Elegí el portfolio destino.'); return; }
    const cant = Number(cantidad) || 0;
    if (!(cant > 0)) { setErr('Ingresá una cantidad válida.'); return; }
    if (cant > pos.cantidad) { setErr(`No podés transferir más de ${fmtNum(pos.cantidad, 0)} que tenés.`); return; }
    setBusy(true);
    try {
      await transferir(pos.id, destinoId, cant, nota || undefined, llevarCosto && !!plan && plan.totalUsd > 0);
      setOk(`Transferido ${fmtNum(cant, 0)} de ${pos.ticker}.`);
      setPosicionId(''); setCantidad(''); setDestinoId(''); setNota('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo transferir');
    } finally { setBusy(false); }
  };

  if (destinos.length === 0) {
    return (
      <Card>
        <CardHeader title="Transferir posición" />
        <Empty icon={ArrowRightLeft} title="Necesitás otro portfolio">Creá otro portfolio en Configuración para transferir.</Empty>
      </Card>
    );
  }
  if (posiciones.length === 0) {
    return (
      <Card>
        <CardHeader title="Transferir posición" />
        <Empty icon={ArrowRightLeft} title="Sin posiciones abiertas">Vas a poder transferir cuando tengas posiciones abiertas.</Empty>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Transferir posición" sub="Preserva costo y fecha de compra. No es una venta." />
      <div className="p-4 flex flex-wrap items-end gap-2 text-sm">
        <Field label="Posición" className="flex-1 min-w-[160px]">
          <select value={posicionId} onChange={e => { setPosicionId(e.target.value); setCantidad(''); }} className={`${inputCls} appearance-none`}>
            <option value="">Elegí una posición…</option>
            {posiciones.map(p => <option key={p.id} value={p.id}>{p.ticker} · {fmtNum(p.cantidad, 0)}u</option>)}
          </select>
        </Field>
        <Field label="Cantidad" className="w-32">
          <input type="number" value={cantidad} onChange={e => setCantidad(e.target.value)} className={inputCls} placeholder="0" />
        </Field>
        {pos && (
          <button type="button" onClick={() => setCantidad(String(pos.cantidad))} className="text-[11px] text-celeste-600 hover:underline pb-2.5">
            Todo ({fmtNum(pos.cantidad, 0)})
          </button>
        )}
        <Field label="Portfolio destino" className="flex-1 min-w-[160px]">
          <select value={destinoId} onChange={e => setDestinoId(e.target.value)} className={`${inputCls} appearance-none`}>
            <option value="">Elegí un portfolio…</option>
            {destinos.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </Field>
        <Field label="Nota (opcional)" className="flex-1 min-w-[160px]">
          <input value={nota} onChange={e => setNota(e.target.value)} className={inputCls} placeholder="ej. reasignación familiar" />
        </Field>
        <Button onClick={enviar} disabled={busy}><ArrowRightLeft className="w-4 h-4" /> {busy ? 'Transfiriendo…' : 'Transferir'}</Button>
      </div>
      {pos && plan && (plan.totalUsd > 0 || plan.arsSinMep > 0) && (Number(cantidad) || 0) > 0 && (
        <div className="px-4 pb-3">
          <label className="flex items-start gap-2 text-xs text-ink-700 cursor-pointer">
            <input type="checkbox" checked={llevarCosto} onChange={e => setLlevarCosto(e.target.checked)} disabled={busy} className="mt-0.5" />
            <span>
              <b>Llevar también el costo de las órdenes</b>: {fmtUsd(plan.totalUsd, 2)} de comisiones ({Math.round(plan.fraccion * 100)} % de lo que pagaste por {pos.ticker}).
              {plan.arsSinMep > 0 && <> Además $ {Math.round(plan.arsSinMep).toLocaleString('es-AR')} en pesos sin MEP (viajan sin convertir).</>}
              {' '}El origen registra un retiro y el destino un aporte por ese monto, y su orden pasa a mostrar la comisión en el destino. Es lo correcto para una reasignación;
              destildalo si la transferencia es una venta entre carteras a valor de mercado.
            </span>
          </label>
        </div>
      )}
      {err && <p className="px-4 pb-3 text-xs text-warn">{err}</p>}
      {ok && <p className="px-4 pb-3 text-xs text-pos">{ok}</p>}
    </Card>
  );
}
