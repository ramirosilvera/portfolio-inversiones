import type { Posicion } from '../types/domain';

// Valor en USD de UNA unidad. Un CEDEAR liquida por (precio_subyacente / ratio); si el
// ratio no está cargado o es 0, devolvemos null (mostrar "—" y NO computar en el patrimonio)
// en vez de valuarlo al precio del subyacente completo — eso sobrevaluaba la posición N×.
// Brecha CCL ÷ MEP. El precio del subyacente ÷ ratio es el valor en dólar CABLE (CCL); el CEDEAR cotiza y se opera en pesos / en su serie D (dólar
// MEP) y la Liquidez, los aportes y los costos de compra están en dólares MEP. Valuar al CCL subvaluaba cada CEDEAR ≈ 5,5 % (2026-11-12: MSFTD operaba a
// US$ 18,40 y la app lo valuaba a 17,37; Herencia −US$ 930 contra la pantalla de IOL). Valor MEP = subyacente ÷ ratio × (CCL ÷ MEP). Sin alguno de los
// dos dólares o con una brecha imposible (< 0,95 o > 1,25) devuelve 1 (no se corrige: mejor el valor por paridad que uno inventado).
export const FACTOR_MEP_MIN = 0.95;
export const FACTOR_MEP_MAX = 1.25;
// `null` = NO se pudo calcular (falta un dólar o la brecha es imposible): quien GRABA algo (snapshot, transferencia, precio de venta) no debe usar
// el 1 de reemplazo, porque dejaría un valor ≈ 5,5 % bajo persistido (revisión independiente 2026-11-12).
export function factorMepCclOrNull(mep: number | null | undefined, ccl: number | null | undefined): number | null {
  const m = Number(mep), c = Number(ccl);
  if (!(Number.isFinite(m) && m > 0 && Number.isFinite(c) && c > 0)) return null;
  const f = c / m;
  return f >= FACTOR_MEP_MIN && f <= FACTOR_MEP_MAX ? f : null;
}
// Para MOSTRAR: con 1 los CEDEARs se valúan por paridad (al CCL) en vez de quedar sin valor.
export function factorMepCcl(mep: number | null | undefined, ccl: number | null | undefined): number {
  return factorMepCclOrNull(mep, ccl) ?? 1;
}

export function unitValueUSD(p: Posicion, live: number | null, factorCedear = 1): number | null {
  // Efectivo: no cotiza, su "precio" es el que tiene cargado (convención: cantidad = USD, precio 1).
  // Antes caía en `live == null → null` y Posiciones lo mostraba "sin precio" (Actual/Mercado/peso
  // en "—") aunque el Dashboard sí lo sumaba a costo — mismo valor en las dos pantallas ahora.
  if (p.tipo === 'cash') return Number(p.precio_compra) || 0;
  if (live == null) return null;
  if (p.tipo === 'cedear') return p.ratio_cedear && p.ratio_cedear > 0 ? (live / p.ratio_cedear) * factorCedear : null;
  return live; // etf/bono (precio ya por nominal) / cash
}

// Valor de mercado de la posición, o null si no hay precio válido.
export function marketValueUSD(p: Posicion, live: number | null, factorCedear = 1): number | null {
  const u = unitValueUSD(p, live, factorCedear);
  return u != null ? u * p.cantidad : null;
}

// Valor a costo (cantidad × precio de compra).
export function costUSD(p: Posicion): number {
  return p.precio_compra * p.cantidad;
}
