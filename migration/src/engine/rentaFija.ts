// =============================================================================
// Renta fija "de referencia": bonos/ONs del catálogo compartido (bonos_referencia, poblado desde
// IOL — ver migración 0034), no necesariamente en cartera. Combina el cronograma real con el precio
// de mercado (data912, mismo `api.bonos()` que ya usa BonosPage) para dar TIR/duración/paridad sin
// que el usuario cargue cupón a mano. Puro y testeado — igual criterio que engine/bonos.ts, pero para
// el universo de seguimiento (Radar) en vez de la cartera.
// =============================================================================

import { ytmFromCronograma, bondDurationFromCronograma, type CronogramaItem } from './coupons';

// Mismo criterio que Posicion en types/domain.ts: los campos mirror 1:1 las columnas de
// bonos_referencia (snake_case) — sin capa de mapeo entre la fila de Supabase y el tipo de TS.
export interface BonoReferencia {
  ticker: string;
  tipo: 'soberano' | 'on';
  instrumento: 'BOND' | 'NOTE';
  // Solo USD por ahora (ver CHECK de la migración 0034): el cronograma es una fracción 0..1
  // currency-agnostic del nominal, pero valuarlo en USD para una especie que en los hechos paga en
  // PESOS requeriría un supuesto de tipo de cambio futuro que este motor no modela — mejor no
  // ofrecer el catálogo para esas especies que dar una TIR en USD que asume un MEP constante.
  moneda: 'USD';
  nombre: string | null;
  emision: string | null;
  vencimiento: string;
  amortizable: boolean;
  valor_residual: number;
  cronograma: CronogramaItem[];
  fuente: string;
  actualizado_en: string;
}

export interface BonoReferenciaCalc {
  ref: BonoReferencia;
  px: number | null;        // precio por nominal, USD (data912/api.bonos())
  paridad: number | null;   // px * 100
  tir: number | null;
  duracion: { macaulay: number; modified: number } | null;
}

// `px` es SIEMPRE en USD (misma convención que el resto de la app — ver esHardDollar en
// functions/api/market/bonos.ts, que ya convierte las especies en pesos a USD con el MEP antes de
// devolver el mapa). El cronograma también está en la moneda de emisión del bono (USD para los
// soberanos/ONs hard-dollar de este catálogo), así que ambos son consistentes sin conversión extra.
export function calcularBonoReferencia(ref: BonoReferencia, px: number | null, hoy: string): BonoReferenciaCalc {
  const paridad = px != null ? px * 100 : null;
  const tir = px != null ? ytmFromCronograma(px, ref.cronograma, hoy) : null;
  const duracion = tir != null ? bondDurationFromCronograma(ref.cronograma, tir, hoy) : null;
  return { ref, px, paridad, tir, duracion };
}
