import { useMemo } from 'react';
import { Layers, Info } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { useAllPosiciones, useQuotes } from '../hooks/usePosiciones';
import { useChartTheme } from '../hooks/usePrefs';
import { PortfolioReview } from '../components/PortfolioReview';
import { Card, CardHeader, Stat, Badge, fmtUsd, fmtUsdCompact, fmtPct, Empty, PIE_COLORS } from '../components/ui';
import { unitValueUSD as unitUSD } from '../lib/valuation';
import type { Posicion } from '../types/domain';

export function ConsolidadoPage() {
  const chart = useChartTheme();
  const { portfolios } = usePortfolios();
  const { data: allPosiciones = [], isLoading } = useAllPosiciones(true);
  // Solo posiciones de portfolios ACTIVOS (RLS aísla por usuario, no por estado) — si no,
  // el total y los % incluirían portfolios archivados que no aparecen en la lista.
  const activeIds = useMemo(() => new Set(portfolios.map(p => p.id)), [portfolios]);
  const posiciones = useMemo(() => allPosiciones.filter(p => activeIds.has(p.portfolio_id)), [allPosiciones, activeIds]);
  const equity = [...new Set(posiciones.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker))];
  const bonds = [...new Set(posiciones.filter(p => p.tipo === 'bono').map(p => p.ticker))];
  const arStocks = [...new Set(posiciones.filter(p => p.tipo === 'accion_ar').map(p => p.ticker))];
  const { data: quotes = {} } = useQuotes(equity, bonds, arStocks);

  const pfName = useMemo(() => new Map(portfolios.map(p => [p.id, p.nombre])), [portfolios]);

  const { porPortfolio, porTicker, total } = useMemo(() => {
    const mv = (p: Posicion) => {
      const u = unitUSD(p, quotes[p.ticker] ?? null);
      return u != null ? u * p.cantidad : p.precio_compra * p.cantidad;
    };
    const porPortfolio = new Map<string, number>();
    const porTicker = new Map<string, { total: number; portfolios: Set<string> }>();
    let total = 0;
    for (const p of posiciones) {
      const v = mv(p);
      total += v;
      porPortfolio.set(p.portfolio_id, (porPortfolio.get(p.portfolio_id) ?? 0) + v);
      const t = porTicker.get(p.ticker) ?? { total: 0, portfolios: new Set<string>() };
      t.total += v; t.portfolios.add(p.portfolio_id); porTicker.set(p.ticker, t);
    }
    return { porPortfolio, porTicker, total };
  }, [posiciones, quotes]);

  const tickersOrdenados = [...porTicker.entries()].sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Layers className="w-5 h-5 text-accent" />
        <h1 className="text-2xl font-bold text-ink-900 font-display">Consolidado</h1>
        <Badge tone="accent">solo lectura</Badge>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-surface border border-line px-3 py-2 text-[11px] text-ink-600">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p>Vista agregada de todos los portfolios. La <b className="text-ink-800">gestión se hace por portfolio</b> (elegilo en el header); acá solo ves el total y la exposición combinada.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Stat label="Patrimonio total" value={fmtUsdCompact(total)} />
        <Stat label="Portfolios" value={portfolios.length} />
        <Stat label="Activos distintos" value={porTicker.size} />
      </div>

      <Card>
        <CardHeader title="Peso por portfolio" />
        {portfolios.length > 0 && (
          <div className="p-4 grid sm:grid-cols-[minmax(0,180px)_1fr] gap-4 items-center border-b border-line">
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={portfolios} dataKey={p => porPortfolio.get(p.id) ?? 0} nameKey="nombre" cx="50%" cy="50%" innerRadius={42} outerRadius={72} paddingAngle={2} stroke="none">
                    {portfolios.map((p, i) => <Cell key={p.id} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => [fmtUsdCompact(v), 'Patrimonio']}
                    contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, color: chart.tooltipText, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1">
              {portfolios.map((p, i) => {
                const v = porPortfolio.get(p.id) ?? 0;
                const w = total > 0 ? v / total : 0;
                return (
                  <div key={p.id} className="flex items-center gap-2 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="font-semibold flex-1 min-w-0 truncate text-ink-800">{p.nombre}</span>
                    <span className="tnum text-ink-600 w-16 text-right">{fmtPct(w, 0)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="p-4 space-y-2">
          {portfolios.map(p => {
            const v = porPortfolio.get(p.id) ?? 0;
            const w = total > 0 ? v / total : 0;
            return (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <span className="w-28 font-semibold text-ink-800 truncate">{p.nombre}</span>
                <div className="flex-1 h-2 rounded-full bg-canvas overflow-hidden"><div className="h-full bg-celeste-500 rounded-full" style={{ width: `${Math.min(100, w * 100)}%` }} /></div>
                <span className="w-24 text-right tnum text-ink-600 truncate" title={fmtUsd(v, 0)}>{fmtUsd(v, 0)}</span>
                <span className="w-12 text-right tnum">{fmtPct(w, 0)}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title="Exposición consolidada por activo" sub="Cuánto pesa cada activo sumando todos los portfolios." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr><th className="text-left px-4 py-2">Activo</th><th className="text-right px-3">Valor total</th><th className="text-right px-3">% del total</th><th className="text-left px-4">En portfolios</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tickersOrdenados.map(([ticker, info]) => (
                <tr key={ticker} className="hover:bg-canvas">
                  <td className="px-4 py-2 font-semibold text-ink-900">{ticker}
                    {info.portfolios.size > 1 && <Badge tone="warn"><span className="ml-1">en {info.portfolios.size}</span></Badge>}
                  </td>
                  <td className="text-right px-3 tnum">{fmtUsdCompact(info.total)}</td>
                  <td className="text-right px-3 tnum">{fmtPct(total > 0 ? info.total / total : 0, 0)}</td>
                  <td className="px-4 text-[11px] text-ink-600">{[...info.portfolios].map(id => pfName.get(id)).join(', ')}</td>
                </tr>
              ))}
              {isLoading
                ? <tr><td colSpan={4}><p className="p-4 text-sm text-ink-600">Cargando…</p></td></tr>
                : tickersOrdenados.length === 0 && <tr><td colSpan={4}><Empty icon={Layers} title="Nada para consolidar">Cargá posiciones en algún portfolio para ver la exposición combinada.</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <PortfolioReview posiciones={posiciones} pfName={pfName}
        pesos={new Map([...porTicker.entries()].map(([t, info]) => [t, total > 0 ? info.total / total : 0]))} />
    </div>
  );
}
