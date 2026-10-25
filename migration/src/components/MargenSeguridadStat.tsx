import { Stat, fmtPct } from './ui';
import type { MargenCartera } from '../engine/margenSeguridad';

// «Margen de seg.» de los CEDEARs: 1 − precio ÷ valor intrínseco del DCF del Radar (con TUS supuestos guardados), ponderado por capital.
// Un solo componente para Inicio y /cedears.
export function MargenSeguridadStat({ mg, isLoading }: { mg: MargenCartera; isLoading: boolean }) {
  if (mg.ponderado == null) {
    return <Stat label="Margen de seg." value={<span className="text-ink-500">{isLoading ? '…' : '—'}</span>}
      hint={isLoading ? 'Calculando el DCF de cada CEDEAR con los supuestos del Radar…' : 'No hay margen calculable: faltan supuestos guardados en el Radar o fundamentals del ticker.'} />;
  }
  const tono = mg.ponderado >= 0 ? 'text-pos' : 'text-neg';
  const partes = [
    '1 − precio ÷ valor intrínseco del DCF, con los supuestos que guardaste en el Radar, ponderado por capital. Positivo = el precio está bajo tu valor intrínseco; negativo = por encima.',
    `${mg.conMargen} con margen (${mg.baratos} bajo el valor, ${mg.caros} sobre el valor)${mg.sinMargen > 0 ? `, ${mg.sinMargen} sin dato (fuera del promedio)` : ''}.`,
    'Depende de tus supuestos de crecimiento y tasa: es una estimación, no un precio objetivo.',
  ];
  return <Stat label="Margen de seg." value={<span className={tono}>{fmtPct(mg.ponderado, 0)}</span>} hint={partes.join(' ')} />;
}
