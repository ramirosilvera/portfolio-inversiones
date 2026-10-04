import type { ResumenForecast } from '../engine/presupuesto';
import { useMemo } from 'react';
import { fmtPctSigno, fmtUsd } from './ui';
import { useSp500 } from '../hooks/useSp500';
import { retornoSp, MIN_DIAS_COMPARABLE } from '../engine/sp500';

// Líneas que conectan el Forecast con el resto de la app (tarjeta de rendimiento y Aportes). Compartidas por la tarjeta del
// Inicio y la página Forecast para que digan EXACTAMENTE lo mismo; los números salen de engine/presupuesto.calcularForecast.

const tono = (n: number) => (n >= 0 ? 'text-pos' : 'text-neg');

// Rendimiento real del período del presupuesto vs el presupuestado equivalente, en % — misma fórmula (Modified Dietz) que
// "Rendimiento por año". Con pocos días el % es ruido: el tooltip lo aclara.
export function RendimientoLinea({ resumen, className = '' }: { resumen: ResumenForecast; className?: string }) {
  const r = resumen.rendimiento;
  if (!r || r.real == null) return null;
  return (
    <p className={`text-[11px] text-ink-500 ${className}`}
      title={`Mismo cálculo (Modified Dietz) que "Rendimiento por año", sobre los ${r.dias} días del presupuesto. El presupuestado es la tasa anual prorrateada. En períodos cortos el % es muy volátil.${r.concentrado ? ' Casi todo el capital entró hace pocos días: poco representativo.' : ''}`}>
      Rendimiento del período ({r.dias} d): <span className={`tnum font-semibold ${tono(r.real)}`}>{fmtPctSigno(r.real, 1)}{r.concentrado && '*'}</span>
      {' '}· presupuestado <span className="tnum font-semibold text-ink-700">{fmtPctSigno(r.presupuestado, 1)}</span>
    </p>
  );
}

// Cumplimiento del aporte comprometido (meses cerrados, acumulado): en Ahorros los US$200/mes son obligatorios, así que lo
// que falta es una alerta y lo que sobra es un extra.
export function AportesLinea({ resumen, className = '' }: { resumen: ResumenForecast; className?: string }) {
  const a = resumen.aportes;
  if (!a) return null;
  if (a.faltante > 0.5) {
    return <p className={`text-[11px] text-warn ${className}`} title="Acumulado de los meses cerrados: aportes reales − aporte presupuestado.">Aporte comprometido: faltan <span className="tnum font-semibold">{fmtUsd(a.faltante, 0)}</span> acumulados.</p>;
  }
  if (a.extra > 0.5) {
    return <p className={`text-[11px] text-ink-500 ${className}`} title="Acumulado de los meses cerrados: aportes reales − aporte presupuestado.">Aportes por encima del mínimo comprometido: <span className="tnum font-semibold text-pos">+{fmtUsd(a.extra, 0)}</span>.</p>;
  }
  return null;
}

// Mismo período que RendimientoLinea (los `dias` del presupuesto, hacia atrás desde hoy) contra el S&P 500 con dividendos
// reinvertidos. Informativo: no mueve el presupuesto (8%). Si la serie no carga o no cubre el período, no muestra nada.
export function Sp500Linea({ resumen, hoy, className = '' }: { resumen: ResumenForecast; hoy: string; className?: string }) {
  const { data } = useSp500();
  const r = resumen.rendimiento;
  const sp = useMemo(() => {
    if (!r || r.real == null || r.dias < MIN_DIAS_COMPARABLE || !data?.puntos?.length) return null;
    const desde = new Date(Date.parse(hoy) - r.dias * 86_400_000).toISOString().slice(0, 10);
    return retornoSp(data.puntos, desde, hoy);
  }, [r, data, hoy]);
  if (!r || r.real == null || sp == null) return null;
  const dif = (r.real - sp) * 100;
  return (
    <p className={`text-[11px] text-ink-500 ${className}`}
      title={`S&P 500 con dividendos reinvertidos (SPY) sobre los mismos ${r.dias} días. Es solo una referencia: el presupuesto sigue en ${fmtPctSigno(r.presupuestado, 1)} prorrateado.`}>
      Vs S&amp;P 500 ({r.dias} d): <span className="tnum font-semibold text-ink-700">{fmtPctSigno(sp, 1)}</span>
      {' '}· vos <span className={`tnum font-semibold ${tono(dif)}`}>{dif >= 0 ? '+' : ''}{dif.toFixed(1)} pp</span>
    </p>
  );
}
