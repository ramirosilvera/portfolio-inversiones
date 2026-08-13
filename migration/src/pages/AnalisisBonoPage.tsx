import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, LineChart } from 'lucide-react';
import { useBonosReferencia } from '../hooks/useBonosReferencia';
import { useBonosPrecios } from '../hooks/usePosiciones';
import { calcularBonoReferencia } from '../engine/rentaFija';
import { Card, CardHeader, Stat, Badge, Empty, fmtUsd, fmtNum, fmtPct } from '../components/ui';

// Análisis de un bono/ON del catálogo de referencia (bonos_referencia): cronograma completo +
// TIR/duración/paridad, calculados por engine/rentaFija.ts — no hay DCF acá (Owner Earnings no
// aplica a renta fija), a diferencia de AnalisisPage.tsx que sí es DCF de acciones/CEDEARs.
export function AnalisisBonoPage() {
  const { ticker = '' } = useParams();
  const T = ticker.toUpperCase();
  const { data: catalogo = [], isLoading } = useBonosReferencia();
  const { data: precios = {} } = useBonosPrecios();
  const hoy = new Date().toISOString().slice(0, 10);

  const ref = catalogo.find(b => b.ticker === T);
  const calc = useMemo(() => ref ? calcularBonoReferencia(ref, precios[T] ?? null, hoy) : null, [ref, precios, T, hoy]);

  const comparativa = useMemo(
    () => catalogo
      .map(r => calcularBonoReferencia(r, precios[r.ticker] ?? null, hoy))
      .filter(c => c.ref.ticker !== T && c.tir != null)
      .sort((a, b) => b.tir! - a.tir!)
      .slice(0, 6),
    [catalogo, precios, T, hoy],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/radar" className="text-ink-600 hover:text-ink-900 inline-flex items-center justify-center w-9 h-9" aria-label="Volver al Radar"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="text-2xl font-bold text-ink-900 font-display">{T || 'Renta fija'}</h1>
        {ref && <Badge tone={ref.tipo === 'soberano' ? 'accent' : 'gray'}>{ref.tipo === 'soberano' ? 'Soberano' : 'ON'}</Badge>}
        {ref?.amortizable && <Badge tone="warn">amortizable</Badge>}
      </div>

      {!isLoading && !ref && (
        <Card><Empty icon={LineChart} title="No está en el catálogo de referencia">
          Todavía no cargamos el cronograma de {T}. El catálogo se actualiza periódicamente — si es un bono/ON líquido, puede sumarse en la próxima actualización.
        </Empty></Card>
      )}

      {ref && calc && (
        <>
          <Card>
            <CardHeader title={ref.nombre || ref.ticker}
              sub={`${ref.moneda} · vence ${ref.vencimiento}${ref.emision ? ` · emitido ${ref.emision}` : ''} · fuente: ${ref.fuente}, actualizado ${ref.actualizado_en.slice(0, 10)}`} />
            <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Precio" value={fmtUsd(calc.px)} />
              <Stat label="Paridad" value={calc.paridad != null ? `${fmtNum(calc.paridad, 1)}%` : '—'} />
              <Stat label="TIR" value={calc.tir != null ? fmtPct(calc.tir) : '—'} />
              <Stat label="Duración" value={calc.duracion ? `${fmtNum(calc.duracion.macaulay, 1)} años` : '—'} />
            </div>
            {calc.px == null && (
              <p className="px-4 pb-4 text-[11px] text-warn">Sin cotización disponible ahora mismo — TIR y duración no se pueden calcular sin precio de mercado.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Cronograma de flujos" sub="Fracción del nominal ORIGINAL por período (interés + amortización) — fuente: IOL." />
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead className="text-[11px] text-ink-600 border-b border-line">
                  <tr>
                    <th className="text-left px-4 py-2">Fecha</th>
                    <th className="text-right px-3">Interés</th>
                    <th className="text-right px-3">Amortización</th>
                    <th className="text-right px-3">Saldo residual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ref.cronograma.map(f => (
                    <tr key={f.fecha} className={f.fecha <= hoy ? 'opacity-40' : ''}>
                      <td className="px-4 py-2">{f.fecha}</td>
                      <td className="text-right px-3 tnum">{fmtNum(f.interes * 100, 3)}%</td>
                      <td className="text-right px-3 tnum">{f.amortizacion > 0 ? `${fmtNum(f.amortizacion * 100, 1)}%` : '—'}</td>
                      <td className="text-right px-3 tnum">{fmtNum(f.saldo_residual * 100, 1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {comparativa.length > 0 && (
            <Card>
              <CardHeader title="Comparativa" sub="Mejores TIR del catálogo (excluyendo este bono)." />
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[420px]">
                  <thead className="text-[11px] text-ink-600 border-b border-line">
                    <tr>
                      <th className="text-left px-4 py-2">Ticker</th>
                      <th className="text-right px-3">TIR</th>
                      <th className="text-right px-3">Duración</th>
                      <th className="px-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {comparativa.map(c => (
                      <tr key={c.ref.ticker} className="hover:bg-canvas">
                        <td className="px-4 py-2 font-semibold text-ink-900">{c.ref.ticker}</td>
                        <td className="text-right px-3 tnum">{fmtPct(c.tir)}</td>
                        <td className="text-right px-3 tnum">{c.duracion ? `${fmtNum(c.duracion.macaulay, 1)}a` : '—'}</td>
                        <td className="px-2 text-right"><Link to={`/analisis/bono/${c.ref.ticker}`} className="text-ink-600 hover:text-accent text-xs">Ver</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
