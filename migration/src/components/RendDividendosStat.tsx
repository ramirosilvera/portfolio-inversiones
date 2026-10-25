import { Stat, fmtPct } from './ui';
import type { RendDividendos } from '../engine/dividendYield';

// «Rend. dividendos» de los CEDEARs: el equivalente a «Rend. corriente» de los bonos. Un solo componente para Inicio y /cedears:
// el número y su explicación nunca difieren entre pantallas.
export function RendDividendosStat({ rd, isLoading, isError }: { rd: RendDividendos | null; isLoading: boolean; isError: boolean }) {
  if (!rd) {
    return <Stat label="Rend. dividendos" value={<span className="text-ink-500">{isLoading ? '…' : '—'}</span>}
      hint={isError ? 'No se pudo traer el calendario de dividendos.' : 'Calculando con el calendario de dividendos…'} />;
  }
  if (rd.yieldMercado == null) {
    return <Stat label="Rend. dividendos" value={<span className="text-ink-500">—</span>}
      hint="Sin datos de dividendos para tus CEDEARs (el proveedor no respondió o falta el ratio)." />;
  }
  const partes = [
    'Dividendo anualizado (último monto × pagos por año) ÷ valor de mercado, ponderado por capital (BRUTO, antes de la retención de EE.UU.). Cuentan como 0 % los CEDEARs que no pagan.',
    `${rd.pagadores} pagan${rd.sinPago > 0 ? `, ${rd.sinPago} no pagan` : ''}${rd.sinInfo > 0 ? `, ${rd.sinInfo} sin dato (fuera del promedio)` : ''}.`,
    rd.yieldCosto != null ? `Sobre tu costo: ${fmtPct(rd.yieldCosto, 1)}.` : '',
    rd.yieldNeto != null ? `Neto estimado de retención y costos: ${fmtPct(rd.yieldNeto, 1)}.` : '',
    'Estimación con el último dividendo y la cadencia histórica, no un cobro asegurado.',
  ].filter(Boolean);
  return <Stat label="Rend. dividendos" value={fmtPct(rd.yieldMercado, 1)} hint={partes.join(' ')} />;
}
