import { useEffect, useState } from 'react';
import { calcularCostosCobro, tasasPorDefecto, type CostosCobro } from '../engine/costosCobros';
import { fmtUsd } from './ui';
import type { CobroTipo } from '../types/domain';
import type { CostosAlta } from '../hooks/useCobros';

// Estado + cálculo de los costos de un cobro (retención y comisión, en %). El cálculo es del motor (engine/costosCobros.ts); acá solo
// se guardan los % editables. `aplicar`: si el cobro se registra por su NETO estimado (monto = neto) o por el monto tal cual.
export function useCostosCobro(tipo: CobroTipo, bruto: number, aplicarPorDefecto: boolean) {
  const [aplicar, setAplicar] = useState(aplicarPorDefecto);
  const pct = (x: number) => String(+(x * 100).toFixed(2));
  const [ret, setRet] = useState(() => pct(tasasPorDefecto(tipo).retencion));
  const [com, setCom] = useState(() => pct(tasasPorDefecto(tipo).comision));
  // Al cambiar el tipo (formulario manual) las tasas vuelven a las de ese tipo.
  useEffect(() => { const t = tasasPorDefecto(tipo); setRet(pct(t.retencion)); setCom(pct(t.comision)); }, [tipo]);
  const costos: CostosCobro = calcularCostosCobro(bruto, { retencion: (Number(ret) || 0) / 100, comision: (Number(com) || 0) / 100 });
  const hayCostos = costos.retencion + costos.comision > 0;
  // Lo que se registra: con costos aplicados, el neto (y el detalle); si no, el monto tal cual.
  const montoRegistrar = aplicar && hayCostos ? costos.neto : +bruto.toFixed(2);
  const alta: CostosAlta | undefined = aplicar && hayCostos
    ? { bruto: costos.bruto, retencion: costos.retencion, comision: costos.comision, estimados: true } : undefined;
  return { aplicar, setAplicar, ret, setRet, com, setCom, costos, hayCostos, montoRegistrar, alta };
}

export function CostosCobroEditor({ c, bruto, disabled, etiquetaBruto = 'bruto' }: {
  c: ReturnType<typeof useCostosCobro>; bruto: number; disabled?: boolean; etiquetaBruto?: string;
}) {
  if (!(bruto > 0)) return null;
  const { costos } = c;
  return (
    <div className="mt-2 rounded-xl border border-line px-3 py-2 text-[11px] text-ink-700">
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={c.aplicar} onChange={e => c.setAplicar(e.target.checked)} disabled={disabled} className="mt-0.5" />
        <span>
          <b>Registrar neto con costos estimados</b> (el monto de arriba es {etiquetaBruto}).
          {c.aplicar && c.hayCostos
            ? <> Se registra <b className="tnum">{fmtUsd(costos.neto, 2)}</b> = {fmtUsd(costos.bruto, 2)} − retención {fmtUsd(costos.retencion, 2)} − comisión {fmtUsd(costos.comision, 2)}, marcado como <i>estimado</i>.</>
            : !c.aplicar ? <> Si no, se registra el monto tal cual; si te acreditaron menos, cargá el neto real.</> : null}
        </span>
      </label>
      {c.aplicar && (
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <label className="flex items-center gap-1">Retención %
            <input type="number" min="0" max="99" step="0.1" value={c.ret} onChange={e => c.setRet(e.target.value)} disabled={disabled}
              className="w-16 bg-surface border border-line rounded-lg px-2 py-1 text-xs tnum" />
          </label>
          <label className="flex items-center gap-1">Comisión %
            <input type="number" min="0" max="99" step="0.01" value={c.com} onChange={e => c.setCom(e.target.value)} disabled={disabled}
              className="w-16 bg-surface border border-line rounded-lg px-2 py-1 text-xs tnum" />
          </label>
          <span className="text-ink-500">Tasas observadas en pagos reales de IOL; editalas si tu bróker difiere.</span>
        </div>
      )}
    </div>
  );
}
