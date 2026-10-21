// Rangos PLAUSIBLES de los indicadores macro que vienen de proveedores externos (FRED). Un valor fuera de rango es un dato corrupto
// —p. ej. una página de error leída como si fuera el CSV, que dejó las cinco series en 400,0 el 2026-10-21—, no un mercado extremo:
// se descarta (queda «sin dato») en vez de mostrarse como «estrés» o de entrar a una cuenta (el dgs10 es la tasa libre de riesgo del
// DCF, el costo de capital y la TIR de los bonos: 400 → 400 % de costo del capital). Cotas MUY anchas a propósito (el VIX tocó 82,7 en
// 2020; el HY OAS 20 % en 2008): solo atrapan lo imposible. Lo usan el servidor (functions/api/market/fred.ts) y el cliente (useMacro).

export const RANGOS_MACRO: Record<string, readonly [number, number]> = {
  dgs10: [-2, 25],          // Treasury 10Y (%)
  dgs3mo: [-2, 25],         // T-Bills 3M (%)
  hy_spread: [0.3, 40],     // High Yield OAS (%)
  vix: [5, 150],            // nivel
  dollar_index: [60, 250],  // dólar amplio nominal (base ene-2006 = 100)
};

/** ¿Es un número finito y, si la clave tiene rango conocido, cae dentro? Las claves sin rango solo exigen que sea finito. */
export function valorPlausible(clave: string, v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  const r = RANGOS_MACRO[clave];
  return !r || (v >= r[0] && v <= r[1]);
}

/** Copia del mapa macro con los valores implausibles reemplazados por null (el cliente muestra «—» y usa los defaults). */
export function sanearMacro<T extends Record<string, number | null>>(m: T): T {
  const out: Record<string, number | null> = { ...m };
  for (const k of Object.keys(RANGOS_MACRO)) if (k in out && out[k] != null && !valorPlausible(k, out[k])) out[k] = null;
  return out as T;
}
