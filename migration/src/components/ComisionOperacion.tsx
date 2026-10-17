import { useMemo, useState } from 'react';
import { useBrokers } from '../hooks/useBrokers';
import { usePosicionBrokers } from '../hooks/usePosicionBrokers';
import { brokerPrincipal, estimarComisionOperacion, tasaOperacion } from '../engine/costosOperacion';
import { fmtUsd } from './ui';

// Comisión estimada de una compra o venta: se calcula sola (monto × tasa del broker, ver engine/costosOperacion.ts), queda a la vista y
// editable, y no se registra hasta que el usuario guarda la operación. El broker arranca en el principal de la posición (el de más
// cantidad) o, si no hay, en la tasa general; se puede cambiar.
export function useComisionOperacion(monto: number, posicionId?: string | null, registrarPorDefecto = true) {
  const { data: brokers } = useBrokers();
  const { data: asignaciones } = usePosicionBrokers();
  const [brokerSel, setBrokerSel] = useState<string | null>(null);            // null = automático (principal de la posición o general)
  const [editada, setEditada] = useState<string | null>(null);
  const [registrar, setRegistrar] = useState(registrarPorDefecto);
  const [descontar, setDescontar] = useState(true);

  const principal = useMemo(() => brokerPrincipal(
    (posicionId ? asignaciones.filter(a => a.posicion_id === posicionId) : []).map(a => ({ brokerId: a.broker_id, cantidad: a.cantidad }))), [asignaciones, posicionId]);
  const brokerId = brokerSel ?? principal ?? '';
  const broker = brokers.find(b => b.id === brokerId) ?? null;
  const tasa = tasaOperacion(broker);
  const estimada = estimarComisionOperacion(monto, tasa);
  const comisionStr = editada ?? (estimada > 0 ? estimada.toFixed(2) : '');
  const comision = Number(comisionStr) > 0 ? Number(comisionStr) : 0;
  return {
    brokers, brokerId, broker, tasa, estimada, comisionStr, comision, editadaPorUsuario: editada != null,
    setBroker: (id: string) => { setBrokerSel(id); setEditada(null); },     // cambiar de broker vuelve a la estimación de ese broker
    setComision: (s: string) => setEditada(s),
    registrar, setRegistrar, descontar, setDescontar,
  };
}

export function ComisionOperacionCampos({ c, monto, etiqueta, puedeDescontar, descontarTexto, disabled }: {
  c: ReturnType<typeof useComisionOperacion>; monto: number; etiqueta: string; puedeDescontar: boolean; descontarTexto: string; disabled?: boolean;
}) {
  if (!(monto > 0)) return null;
  return (
    <div className="mt-2 rounded-xl border border-line px-3 py-2 text-[11px] text-ink-700">
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={c.registrar} onChange={e => c.setRegistrar(e.target.checked)} disabled={disabled} className="mt-0.5" />
        <span><b>Registrar la orden con su comisión</b> (queda en Órdenes y costos, y entra en el rendimiento neto). Se guarda recién cuando confirmás.</span>
      </label>
      {c.registrar && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0">
              <span className="block font-semibold text-ink-600 mb-1">Broker</span>
              <select value={c.brokerId} onChange={e => c.setBroker(e.target.value)} disabled={disabled}
                className="w-full bg-surface border border-line rounded-lg px-2 py-1.5 text-xs">
                <option value="">Sin asignar (tasa general)</option>
                {c.brokers.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="block font-semibold text-ink-600 mb-1">Comisión {etiqueta} (USD)</span>
              <input type="number" min="0" step="0.01" value={c.comisionStr} onChange={e => c.setComision(e.target.value)} disabled={disabled}
                className="w-full bg-surface border border-line rounded-lg px-2 py-1.5 text-xs tnum" />
            </label>
          </div>
          <p className="text-ink-500">
            Estimada: <b className="tnum">{fmtUsd(c.estimada, 2)}</b> = {fmtUsd(monto, 2)} × {(c.tasa * 100).toFixed(3).replace(/\.?0+$/, '')} %
            {c.broker ? ` (${c.broker.nombre}${c.broker.comision_operacion == null ? ', tasa general' : ''})` : ' (tasa general)'}.
            {c.editadaPorUsuario && <> Editaste el valor: se guarda tal cual lo ves.</>} Editá la tasa por broker en Brokers → Costos por broker; si tenés el boleto, cargá el monto real.
          </p>
          {puedeDescontar && (
            <label className="flex items-start gap-2 text-ink-700 cursor-pointer">
              <input type="checkbox" checked={c.descontar} onChange={e => c.setDescontar(e.target.checked)} disabled={disabled} className="mt-0.5" />
              <span>{descontarTexto}</span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
