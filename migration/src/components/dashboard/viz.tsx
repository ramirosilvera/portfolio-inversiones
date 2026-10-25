// Renderers genéricos para tarjetas atómicas del Dashboard personalizable — pintan un MetricValue
// (engine/dashboardCatalog.ts) sin saber de dónde salió el número. Cada componente de métrica
// (components/dashboard/metrics.tsx) hace el cálculo real (siempre reusando el hook/engine que ya
// usa la sección equivalente) y entrega acá solo el resultado tipado.
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { useChartTheme } from '../../hooks/usePrefs';
import { fmtUsd, fmtUsdCompact, fmtNum, fmtPct, fmtArsCompact, PIE_COLORS } from '../ui';
import type { Formato, MetricValue, Tono } from '../../engine/dashboardCatalog';

function fmtValor(n: number | null, format: Formato | undefined, dp?: number): string {
  if (n == null) return '—';
  switch (format) {
    case 'usd': return fmtUsd(n, dp ?? 0);
    case 'usd-compact': return fmtUsdCompact(n);
    case 'pct': return fmtPct(n, dp ?? 1);
    case 'int': return fmtNum(n, 0);
    case 'ars-compact': return fmtArsCompact(n);
    default: return fmtNum(n, dp ?? 2);
  }
}

const TONO_CLASE: Record<Tono, string> = {
  pos: 'text-pos', neg: 'text-neg', warn: 'text-warn', neutral: 'text-ink-900',
};

export function LoadingViz() {
  return <p className="p-4 text-sm text-ink-600">Cargando…</p>;
}

export function EmptyViz({ motivo }: { motivo: string }) {
  return <p className="p-4 text-sm text-ink-600">{motivo}</p>;
}

export function StatViz({ mv }: { mv: Extract<MetricValue, { status: 'ok'; shape: 'scalar' }> }) {
  return (
    <div className="p-4">
      <p className={`text-2xl font-bold font-display tnum ${TONO_CLASE[mv.tone ?? 'neutral']}`}>
        {mv.label ?? fmtValor(mv.value, mv.format, mv.dp)}
      </p>
      {mv.sub && <p className="text-[11px] text-ink-500 mt-1">{mv.sub}</p>}
    </div>
  );
}

// Tile chico para tarjetas combinadas (2+ métricas en una sola Card) — mismo look que los tiles a
// mano de CobrosResumen/LiquidezFci en DashboardPage.tsx (rounded-2xl con label/valor/sub visibles),
// NO el `Stat` genérico de ui.tsx: `Stat` solo expone su `hint` como `title` (tooltip), invisible en
// touch — y acá el sub casi siempre es información que cambia el significado del número ("no es
// renta", la unidad "años", "compartido entre todos tus portfolios", el signo de una tasa en otra
// moneda), no un detalle accesorio que valga la pena esconder. Solo maneja `scalar` (el constructor
// de tarjetas solo deja combinar métricas escalares) — el caso `categorico` es defensivo, no debería
// alcanzarse nunca en uso normal.
export function StatCompactoViz({ titulo, mv }: { titulo: string; mv: MetricValue }) {
  const cuerpo = mv.status === 'loading' ? { valor: <>…</>, sub: undefined, tono: undefined as string | undefined }
    : mv.status === 'empty' ? { valor: <span className="text-ink-500">—</span>, sub: mv.motivo, tono: undefined }
    : mv.shape !== 'scalar' ? { valor: <span className="text-ink-500">—</span>, sub: undefined, tono: undefined }
    : { valor: mv.label ?? fmtValor(mv.value, mv.format, mv.dp), sub: mv.sub, tono: TONO_CLASE[mv.tone ?? 'neutral'] };
  return (
    // px-2 + text-sm en pantallas angostas: con 3 tiles en UNA fila (celular, ~100 px cada uno) el valor tiene que entrar sin cortarse;
    // desde `sm` vuelven el padding y el tamaño de siempre. `title` en el valor: si igual se cortara, el número completo queda a un toque.
    <div className="rounded-2xl border border-line bg-surface shadow-soft px-2 sm:px-3 py-3 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold truncate" title={titulo}>{titulo}</p>
      <p className={`text-sm sm:text-lg font-bold font-display tnum mt-1 truncate ${cuerpo.tono ?? 'text-ink-900'}`} title={typeof cuerpo.valor === 'string' ? cuerpo.valor : undefined}>{cuerpo.valor}</p>
      {cuerpo.sub && <p className="text-[10px] text-ink-500 mt-0.5 truncate" title={cuerpo.sub}>{cuerpo.sub}</p>}
    </div>
  );
}

export function DonutViz({ mv }: { mv: Extract<MetricValue, { status: 'ok'; shape: 'categorico' }> }) {
  const chart = useChartTheme();
  const total = mv.items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="p-4 grid sm:grid-cols-[minmax(0,160px)_1fr] gap-4 items-center">
      <div className="h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={mv.items} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={40} outerRadius={68} paddingAngle={2} stroke="none">
              {mv.items.map((it, i) => <Cell key={it.label} fill={it.color ?? PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v: number, n: string) => [fmtValor(v, mv.format), n]}
              contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, color: chart.tooltipText, fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1.5">
        {mv.items.map((it, i) => (
          <div key={it.label} className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: it.color ?? PIE_COLORS[i % PIE_COLORS.length] }} />
            <span className="font-semibold text-ink-800 truncate">{it.label}</span>
            <span className="tnum text-ink-700 ml-auto">{total > 0 ? fmtPct(it.value / total, 0) : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarViz({ mv }: { mv: Extract<MetricValue, { status: 'ok'; shape: 'categorico' }> }) {
  const chart = useChartTheme();
  return (
    <div className="p-2 h-52">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={mv.items} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke={chart.axis} fontSize={11} />
          <YAxis stroke={chart.axis} fontSize={11} tickFormatter={v => fmtValor(v, mv.format)} width={56} />
          <Tooltip formatter={(v: number) => fmtValor(v, mv.format)}
            contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, fontSize: 12, color: chart.tooltipText }}
            cursor={{ fill: 'rgba(116,172,223,0.10)' }} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
            {mv.items.map((it, i) => <Cell key={it.label} fill={it.color ?? PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TableViz({ mv }: { mv: Extract<MetricValue, { status: 'ok'; shape: 'categorico' }> }) {
  const total = mv.items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="px-4 py-3 space-y-1.5">
      {mv.items.map(it => (
        <div key={it.label} className="flex items-center gap-2 text-sm">
          {it.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: it.color }} />}
          <span className="font-semibold text-ink-800 truncate">{it.label}</span>
          <span className="tnum text-ink-700 ml-auto">{fmtValor(it.value, mv.format)}</span>
          <span className="tnum text-[11px] text-ink-500 w-12 text-right">{total > 0 ? fmtPct(it.value / total, 0) : '—'}</span>
        </div>
      ))}
    </div>
  );
}
