import { useMemo } from 'react';
import { Card, CardHeader, fmtPctSigno } from './ui';
import { useSp500 } from '../hooks/useSp500';
import { compararConSp500 } from '../engine/sp500';

const tono = (n: number | null) => (n == null ? 'text-ink-500' : n >= 0 ? 'text-pos' : 'text-neg');

// Tarjeta "Vs S&P 500": cómo le fue al portfolio en cada año contra el índice (retorno total, SPY ajustado), medido sobre
// el MISMO período que "Rendimiento por año". El 8% del presupuesto es la vara de planificación (conservadora a propósito);
// esto mide el resultado contra el mercado real. Informativo: no cambia el presupuesto ni los supuestos.
export function VsSp500({ rendAnios, hoy }: {
  rendAnios: { anio: number; rendimiento: number | null; dias?: number; concentrado?: boolean }[]; hoy: string;
}) {
  const { data, isLoading, isError } = useSp500();
  const filas = useMemo(
    () => (data?.puntos?.length ? compararConSp500(rendAnios.filter(r => r.rendimiento != null), data.puntos, hoy).filter(f => f.sp500 != null) : []),
    [rendAnios, data, hoy]);
  const ordenadas = [...filas].reverse();

  return (
    <Card>
      <CardHeader title="Vs S&P 500" />
      <div className="p-4 space-y-2 text-sm">
        {isLoading && <p className="text-[11px] text-ink-500">Cargando S&amp;P 500…</p>}
        {isError && <p className="text-[11px] text-ink-500">No se pudo traer el S&amp;P 500. Reintentá más tarde.</p>}
        {!isLoading && !isError && ordenadas.length === 0 && <p className="text-[11px] text-ink-500">Sin años comparables todavía.</p>}
        {ordenadas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[300px]">
              <thead><tr className="text-ink-500 text-left">
                <th className="font-medium py-1">Año</th><th className="font-medium text-right">Portfolio</th>
                <th className="font-medium text-right">S&amp;P 500</th><th className="font-medium text-right">Dif.</th>
              </tr></thead>
              <tbody>
                {ordenadas.map(f => (
                  <tr key={f.anio} className="border-t border-ink-200/40"
                    title={f.parcial ? `Período parcial (${f.dias} días): los dos se miden sobre las mismas fechas.${f.concentrado ? ' El % del portfolio es poco representativo (casi todo el capital entró hace poco).' : ''}` : undefined}>
                    <td className="py-1">{f.anio}{f.parcial && ' ·'}</td>
                    <td className={`tnum text-right font-semibold ${tono(f.portfolio)}`}>{fmtPctSigno(f.portfolio, 1)}{f.concentrado && '*'}</td>
                    <td className="tnum text-right text-ink-700">{fmtPctSigno(f.sp500, 1)}</td>
                    <td className={`tnum text-right font-semibold ${tono(f.diferencia)}`}>{f.diferencia == null ? '—' : `${f.diferencia >= 0 ? '+' : ''}${(f.diferencia * 100).toFixed(1)} pp`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-ink-500">
          S&amp;P 500 con dividendos reinvertidos (SPY). · = año parcial, mismas fechas para ambos. El presupuesto sigue en 8%: esto es solo cómo te fue contra el mercado.
        </p>
      </div>
    </Card>
  );
}
