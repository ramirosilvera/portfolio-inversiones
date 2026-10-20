import { fmtUsd } from './ui';
import type { GananciasAnio } from '../engine/impuestos';

// Dividendos del exterior por año. En el celular un bloque por año (una tabla de 6 columnas no entra y se cortaba contra el borde de la
// tarjeta); desde `sm`, la tabla. «*» = incluye montos estimados (cobros anteriores al detalle de costos).
export function GananciasTabla({ ganancias }: { ganancias: GananciasAnio[] }) {
  return (
    <>
    {/* Celular: un bloque por año (la tabla de 6 columnas no entra y se cortaba contra el borde de la tarjeta). */}
    <ul className="sm:hidden divide-y divide-line">
      {ganancias.map(g => (
        <li key={g.anio} className="px-4 py-3">
          <p className="font-semibold text-ink-900 mb-2">{g.anio} <span className="text-[11px] font-normal text-ink-600">· {g.cobros} cobro{g.cobros === 1 ? '' : 's'}</span></p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <Dato label="Dividendos brutos" valor={fmtUsd(g.dividendosBruto)} />
            <Dato label="Retención EE.UU." valor={g.retencionExterior > 0 ? fmtUsd(g.retencionExterior) : '—'} estimado={g.retencionEstimada > 0} />
            <Dato label="Acreditado" valor={fmtUsd(g.dividendosNeto)} estimado={g.netoEstimado > 0} />
            <Dato label="Cupones ON" valor={g.intereses > 0 ? fmtUsd(g.intereses) : '—'} />
          </dl>
        </li>
      ))}
    </ul>
    <div className="hidden sm:block overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[11px] text-ink-600 border-b border-line">
          <tr>
            <th className="text-left px-4 py-2">Año</th><th className="text-right px-3">Dividendos brutos</th>
            <th className="text-right px-3">Retención EE.UU.</th><th className="text-right px-3">Acreditado</th>
            <th className="text-right px-3">Cobros</th><th className="text-right px-4">Cupones ON</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {ganancias.map(g => (
            <tr key={g.anio}>
              <td className="px-4 py-2 font-semibold text-ink-900">{g.anio}</td>
              <td className="text-right px-3 tnum" title={g.sinDetalle > 0 ? `${g.sinDetalle} cobro(s) cargados por el pago declarado (bruto) sin detalle de costos` : undefined}>
                {fmtUsd(g.dividendosBruto)}
              </td>
              <td className="text-right px-3 tnum" title={g.retencionEstimada > 0 ? `${fmtUsd(g.retencionEstimada)} son estimados` : undefined}>
                {g.retencionExterior > 0 ? fmtUsd(g.retencionExterior) : '—'}{g.retencionEstimada > 0 && <span className="text-warn"> *</span>}
              </td>
              <td className="text-right px-3 tnum" title={g.netoEstimado > 0 ? `${fmtUsd(g.netoEstimado)} son estimados` : undefined}>
                {fmtUsd(g.dividendosNeto)}{g.netoEstimado > 0 && <span className="text-warn"> *</span>}
              </td>
              <td className="text-right px-3 tnum">{g.cobros}</td>
              <td className="text-right px-4 tnum text-ink-600">{g.intereses > 0 ? fmtUsd(g.intereses) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

function Dato({ label, valor, estimado }: { label: string; valor: string; estimado?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-600">{label}</dt>
      <dd className="tnum text-ink-900 truncate" title={estimado ? 'Incluye montos estimados' : undefined}>{valor}{estimado && <span className="text-warn"> *</span>}</dd>
    </div>
  );
}
