// =============================================================================
// Margen de seguridad (DCF) de los CEDEARs en cartera, ponderado por capital. El margen por ticker lo calcula computeDcf con los
// supuestos que el usuario GUARDÓ en el Radar (1 − precio ÷ valor intrínseco); acá solo se agrega. Puro y testeado.
// Un ticker sin margen calculable (sin supuestos guardados, sin fundamentals o valor intrínseco ≤ 0) queda FUERA del promedio.
// =============================================================================

import type { CedearCalc } from './cedears';

export interface MargenPosicion { id: string; ticker: string; margen: number | null }

export interface MargenCartera {
  porPosicion: Record<string, MargenPosicion>;   // por id de posición
  ponderado: number | null;   // ponderado por capital (valor de mercado, o costo sin cotización); null si ninguno tiene margen
  conMargen: number;
  sinMargen: number;
  baratos: number;            // margen ≥ 0 (el precio está por debajo del valor intrínseco)
  caros: number;              // margen < 0
}

export function margenSeguridadCedears(cedears: CedearCalc[], margenPorTicker: Map<string, number | null>): MargenCartera {
  const porPosicion: Record<string, MargenPosicion> = {};
  let suma = 0, peso = 0, conMargen = 0, sinMargen = 0, baratos = 0, caros = 0;
  for (const c of cedears) {
    const m = margenPorTicker.get(c.pos.ticker.toUpperCase());
    const valido = typeof m === 'number' && Number.isFinite(m);
    porPosicion[c.pos.id] = { id: c.pos.id, ticker: c.pos.ticker, margen: valido ? m : null };
    if (!valido) { sinMargen++; continue; }
    conMargen++;
    if (m >= 0) baratos++; else caros++;
    const w = c.capitalUsado > 0 ? c.capitalUsado : 0;
    suma += m * w; peso += w;
  }
  return { porPosicion, ponderado: peso > 0 ? suma / peso : null, conMargen, sinMargen, baratos, caros };
}
