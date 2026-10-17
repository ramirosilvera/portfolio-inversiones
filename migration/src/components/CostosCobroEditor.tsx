import { useEffect, useState } from 'react';
import { calcularCostosCobro, type CostosCobro, type TasasCobro } from '../engine/costosCobros';
import { fmtUsd } from './ui';
import type { CostosAlta } from '../hooks/useCobros';

// Estado + cálculo de los costos de un cobro (retención, comisión del depositario y comisión del broker, en %). El cálculo es del motor
// (engine/costosCobros.ts); acá solo se guardan los % editables, que arrancan en las tasas del/los broker(s) de la posición.
// `aplicar`: si el cobro se registra por su NETO estimado (monto = neto) o por el monto tal cual.
export function useCostosCobro(tasas: TasasCobro, bruto: number, aplicarPorDefecto: boolean) {
  const [aplicar, setAplicar] = useState(aplicarPorDefecto);
  const pct = (x: number) => String(+(x * 100).toFixed(2));
  const [ret, setRet] = useState(() => pct(tasas.retencion));
  const [dep, setDep] = useState(() => pct(tasas.depositaria));
  const [com, setCom] = useState(() => pct(tasas.comision));
  // Si cambian las tasas de origen (otro tipo de cobro, otra configuración de broker), los campos vuelven a ellas.
  const clave = `${tasas.retencion}|${tasas.depositaria}|${tasas.comision}`;
  useEffect(() => { setRet(pct(tasas.retencion)); setDep(pct(tasas.depositaria)); setCom(pct(tasas.comision)); }, [clave]); // eslint-disable-line react-hooks/exhaustive-deps
  const costos: CostosCobro = calcularCostosCobro(bruto, { retencion: (Number(ret) || 0) / 100, depositaria: (Number(dep) || 0) / 100, comision: (Number(com) || 0) / 100 });
  const hayCostos = costos.retencion + costos.comisiones > 0;
  // Lo que se registra: con costos aplicados, el neto (y el detalle); si no, el monto tal cual.
  const montoRegistrar = aplicar && hayCostos ? costos.neto : +bruto.toFixed(2);
  const alta: CostosAlta | undefined = aplicar && hayCostos
    ? { bruto: costos.bruto, retencion: costos.retencion, comision: costos.comisiones, estimados: true } : undefined;
  return { aplicar, setAplicar, ret, setRet, dep, setDep, com, setCom, costos, hayCostos, montoRegistrar, alta, tasas };
}

const campo = 'w-16 bg-surface border border-line rounded-lg px-2 py-1 text-xs tnum';

export function CostosCobroEditor({ c, bruto, disabled, etiquetaBruto = 'bruto', esDividendo = true }: {
  c: ReturnType<typeof useCostosCobro>; bruto: number; disabled?: boolean; etiquetaBruto?: string; esDividendo?: boolean;
}) {
  if (!(bruto > 0)) return null;
  const { costos } = c;
  return (
    <div className="mt-2 rounded-xl border border-line px-3 py-2 text-[11px] text-ink-700">
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={c.aplicar} onChange={e => c.setAplicar(e.target.checked)} disabled={disabled} className="mt-0.5" />
        <span>
          <b>Registrar neto con costos estimados</b> (el monto cargado es {etiquetaBruto}).
          {c.aplicar && c.hayCostos
            ? <> Se registra <b className="tnum">{fmtUsd(costos.neto, 2)}</b> = {fmtUsd(costos.bruto, 2)}{costos.retencion > 0 && <> − retención {fmtUsd(costos.retencion, 2)}</>}{costos.depositaria > 0 && <> − comisión del depositario {fmtUsd(costos.depositaria, 2)}</>} − comisión del broker {fmtUsd(costos.comision, 2)}, marcado como <i>estimado</i>.</>
            : !c.aplicar ? <> Si no, se registra el monto tal cual; si te acreditaron menos, cargá el neto real.</> : null}
        </span>
      </label>
      {c.aplicar && (
        <div className="flex flex-wrap items-center gap-3 mt-2">
          {esDividendo && (
            <>
              <label className="flex items-center gap-1" title="Retención de EE.UU. sobre dividendos (universal: no depende del broker)">Retención EE.UU. %
                <input type="number" min="0" max="99" step="0.1" value={c.ret} onChange={e => c.setRet(e.target.value)} disabled={disabled} className={campo} />
              </label>
              <label className="flex items-center gap-1" title="La fija el banco depositario del CEDEAR (Caja de Valores), no el broker">Com. depositario %
                <input type="number" min="0" max="99" step="0.1" value={c.dep} onChange={e => c.setDep(e.target.value)} disabled={disabled} className={campo} />
              </label>
            </>
          )}
          <label className="flex items-center gap-1" title="Lo que cobra tu broker sobre el pago; se configura en Brokers">Com. broker %
            <input type="number" min="0" max="99" step="0.01" value={c.com} onChange={e => c.setCom(e.target.value)} disabled={disabled} className={campo} />
          </label>
          <span className="text-ink-500">Arrancan en lo configurado en Brokers; si tu broker no tiene dato, la comisión general es 1 %.</span>
        </div>
      )}
    </div>
  );
}
