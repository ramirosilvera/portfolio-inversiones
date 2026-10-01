import type { Posicion } from '../types/domain';

// Valor en USD de UNA unidad. Un CEDEAR liquida por (precio_subyacente / ratio); si el
// ratio no está cargado o es 0, devolvemos null (mostrar "—" y NO computar en el patrimonio)
// en vez de valuarlo al precio del subyacente completo — eso sobrevaluaba la posición N×.
export function unitValueUSD(p: Posicion, live: number | null): number | null {
  // Efectivo: no cotiza, su "precio" es el que tiene cargado (convención: cantidad = USD, precio 1).
  // Antes caía en `live == null → null` y Posiciones lo mostraba "sin precio" (Actual/Mercado/peso
  // en "—") aunque el Dashboard sí lo sumaba a costo — mismo valor en las dos pantallas ahora.
  if (p.tipo === 'cash') return Number(p.precio_compra) || 0;
  if (live == null) return null;
  if (p.tipo === 'cedear') return p.ratio_cedear && p.ratio_cedear > 0 ? live / p.ratio_cedear : null;
  return live; // etf/bono (precio ya por nominal) / cash
}

// Valor de mercado de la posición, o null si no hay precio válido.
export function marketValueUSD(p: Posicion, live: number | null): number | null {
  const u = unitValueUSD(p, live);
  return u != null ? u * p.cantidad : null;
}

// Valor a costo (cantidad × precio de compra).
export function costUSD(p: Posicion): number {
  return p.precio_compra * p.cantidad;
}
