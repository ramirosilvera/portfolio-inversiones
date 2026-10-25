import { Stat, fmtPct } from './ui';
import type { TasaDescuentoCartera } from '../engine/tasaDescuento';

// «Tasa de desc.» de los CEDEARs: la d que guardaste en los supuestos del DCF del Radar, ponderada por capital. Un solo componente para
// Inicio y /cedears (el número y su explicación nunca difieren entre pantallas).
export function TasaDescuentoStat({ td, isLoading }: { td: TasaDescuentoCartera; isLoading: boolean }) {
  if (td.ponderada == null) {
    return <Stat label="Tasa de desc." value={<span className="text-ink-500">{isLoading ? '…' : '—'}</span>}
      hint={isLoading ? 'Cargando los supuestos del Radar…' : 'Ningún CEDEAR tiene supuestos de DCF guardados en el Radar (Análisis → guardar supuestos).'} />;
  }
  const partes = [
    'Tasa de descuento (d) que guardaste en el DCF del Radar para cada CEDEAR, ponderada por capital.',
    `${td.conTasa} con tasa guardada${td.sinTasa > 0 ? `, ${td.sinTasa} sin supuestos (fuera del promedio: no se usa la d por defecto)` : ''}.`,
    td.minima != null && td.maxima != null && td.minima !== td.maxima ? `Rango: ${fmtPct(td.minima, 1)} a ${fmtPct(td.maxima, 1)}.` : '',
    'Es tu retorno exigido para el DCF, no el 8 % de presupuesto del portfolio ni un retorno esperado.',
  ].filter(Boolean);
  return <Stat label="Tasa de desc." value={fmtPct(td.ponderada, 1)} hint={partes.join(' ')} />;
}
