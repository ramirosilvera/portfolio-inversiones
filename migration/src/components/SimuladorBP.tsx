import { useState } from 'react';
import { Card, CardHeader, Field, NumField, inputCls, fmtArs, fmtUsd, fmtPct } from './ui';
import { calcularBienesPersonales, type EscalaBP, type ParamsBP } from '../engine/impuestos';

const ATAJOS = [250_000, 500_000, 1_000_000, 2_000_000];

// «¿Y si mi patrimonio fuera…?» — para planificar: cuánto pagarías de Bienes Personales con un patrimonio mayor, con la escala vigente
// (la última publicada; la ley baja las alícuotas en 2026 y 2027, así que es una cota alta). Todo el cálculo vive en engine/impuestos.ts.
export function SimuladorBP({ params, escala, mep, patrimonioUsd }: {
  params: ParamsBP; escala: EscalaBP; mep: number; patrimonioUsd: number;
}) {
  const [usd, setUsd] = useState(500_000);
  const r = calcularBienesPersonales(usd * mep, params, escala);
  const umbralUsd = params.minimoNoImponible / mep;

  return (
    <Card>
      <CardHeader title="¿Y si tu patrimonio fuera mayor?" sub="Simulá cuánto pagarías de Bienes Personales cuando tus inversiones crezcan." />
      <div className="p-4 space-y-3">
        <div className="grid sm:grid-cols-[minmax(0,220px)_1fr] gap-3 items-end">
          <Field label="Patrimonio total en US$ (todos tus bienes)">
            <NumField className={inputCls} value={usd} min={0} step="any" onChange={setUsd} />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {ATAJOS.map(a => (
              <button key={a} onClick={() => setUsd(a)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${usd === a ? 'border-celeste-400 bg-celeste-100 text-celeste-700 dark:bg-celeste-500/20 dark:text-celeste-300' : 'border-line text-ink-700 hover:bg-canvas'}`}>
                {fmtUsd(a, 0)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <Dato label="En pesos (MEP)" valor={fmtArs(usd * mep)} />
          <Dato label="Excedente sobre el mínimo" valor={fmtArs(r.excedente)} />
          <Dato label="Pagarías por año" valor={fmtArs(r.impuesto)} fuerte />
          <Dato label="Sobre el patrimonio" valor={r.impuesto > 0 ? fmtPct(r.alicuotaEfectiva, 2) : '—'} />
        </div>
        <p className="text-[11px] text-ink-600">
          {r.impuesto > 0
            ? `Con la escala ${escala.fuente.includes('2025') ? '2025' : 'vigente'} y una alícuota marginal de ${fmtPct(r.alicuotaMarginal ?? 0, 2)}. `
            : `Empezás a pagar con un patrimonio de unos ${fmtUsd(umbralUsd, 0)} (hoy tenés ${fmtUsd(patrimonioUsd, 0)}). `}
          Referencia con los parámetros publicados: la ley prevé alícuotas menores en 2026 y 2027 y el mínimo se actualiza por IPC cada año.
        </p>
      </div>
    </Card>
  );
}

function Dato({ label, valor, fuerte }: { label: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold truncate">{label}</p>
      <p className={`tnum mt-0.5 truncate ${fuerte ? 'font-bold text-ink-900' : 'text-ink-800'}`} title={valor}>{valor}</p>
    </div>
  );
}
