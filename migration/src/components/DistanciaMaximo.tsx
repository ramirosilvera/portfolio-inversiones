import { DD_ITEMS, distanciaMaximo } from '../engine/semaforos';
import { fmtNum, fmtPct } from './ui';

type Drawdowns = Record<string, { actual: number; max: number; dd: number } | null>;

// Distancia al máximo histórico (S&P 500, Merval, Oro) — mismo bloque en el resumen del Dashboard
// (MacroResumen) y en la página Macro completa, así que vive acá para que ambos queden idénticos.
export function DistanciaMaximo({ dd }: { dd: Drawdowns }) {
  return (
    <div className="px-4 pt-3.5">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-500 mb-1.5">Distancia al máximo histórico</p>
      <div className="grid grid-cols-3 gap-2">
        {DD_ITEMS.map(({ key, label }) => {
          const d = dd[key];
          const pct = d ? distanciaMaximo(d.actual, d.max) : null;
          // Cerca del máximo = caro (warn); caída grande = posible oportunidad (celeste); medio = neutral.
          const cls = pct == null ? 'text-ink-500' : pct > -0.02 ? 'text-warn' : pct < -0.15 ? 'text-celeste-600' : 'text-ink-900';
          const estado = pct == null ? null : pct > -0.02 ? 'caro' : pct < -0.15 ? 'oportunidad' : null;
          return (
            <div key={key} className="rounded-xl bg-canvas ring-1 ring-inset ring-line px-3 py-2.5 min-w-0"
              title={d ? `Actual ${fmtNum(d.actual, 0)} · máx histórico ${fmtNum(d.max, 0)}` : undefined}>
              <p className="text-[10px] uppercase text-ink-600 font-semibold truncate">{label}</p>
              <p className={`text-lg font-bold tnum mt-0.5 ${cls}`}>{pct == null ? '—' : pct === 0 ? 'en máx.' : fmtPct(pct, 1)}</p>
              <p className="text-[10px] text-ink-500">vs máx{estado ? ` · ${estado}` : ''}</p>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-ink-500 mt-1.5">Todo en USD · Merval = ^MERV ÷ CCL.</p>
    </div>
  );
}
