// =============================================================================
// Tasa de descuento (d) de los CEDEARs en cartera: la que el usuario GUARDÓ en los supuestos del DCF del Radar (dcf_inputs.inputs.d),
// por posición y ponderada por capital. Puro y testeado (regla de oro #1: el código calcula).
// Un ticker sin supuestos guardados queda «sin dato» y FUERA del promedio: no se mezcla con la d por defecto del DCF, que el usuario no eligió.
// =============================================================================

import type { CedearCalc } from './cedears';

export interface TasaDescuentoPosicion {
  id: string;
  ticker: string;
  d: number | null;            // null = sin supuestos guardados en el Radar
}

export interface TasaDescuentoCartera {
  porPosicion: Record<string, TasaDescuentoPosicion>;   // por id de posición
  ponderada: number | null;    // ponderada por capital (valor de mercado, o costo sin cotización); null si ninguna tiene d
  conTasa: number;
  sinTasa: number;
  minima: number | null;
  maxima: number | null;
}

// `dcf`: mapa ticker (mayúsculas) → supuestos guardados (useDcfInputs().map). Una d no finita o ≤ 0 se trata como sin dato.
export function tasaDescuentoCedears(cedears: CedearCalc[], dcf: Map<string, { d: number }>): TasaDescuentoCartera {
  const porPosicion: Record<string, TasaDescuentoPosicion> = {};
  let suma = 0, peso = 0, conTasa = 0, sinTasa = 0;
  let minima: number | null = null, maxima: number | null = null;
  for (const c of cedears) {
    const d = dcf.get(c.pos.ticker.toUpperCase())?.d;
    const valida = typeof d === 'number' && Number.isFinite(d) && d > 0;
    porPosicion[c.pos.id] = { id: c.pos.id, ticker: c.pos.ticker, d: valida ? d : null };
    if (!valida) { sinTasa++; continue; }
    conTasa++;
    const w = c.capitalUsado > 0 ? c.capitalUsado : 0;
    suma += d * w; peso += w;
    minima = minima == null ? d : Math.min(minima, d);
    maxima = maxima == null ? d : Math.max(maxima, d);
  }
  return { porPosicion, ponderada: peso > 0 ? suma / peso : null, conTasa, sinTasa, minima, maxima };
}
