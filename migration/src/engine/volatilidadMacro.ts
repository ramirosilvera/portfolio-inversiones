// =============================================================================
// Volatilidad real de un indicador macro a partir de su serie diaria (macro_historico, 0065) para calibrar la banda de salida de la alerta
// de estrés (engine/alertaMacro.ts#SALIDA), que hoy son estimaciones. Puro y testeado.
// =============================================================================

export interface PuntoSerie { fecha: string; valor: number }

// Mínimo de variaciones diarias para fiarse del percentil (menos de eso → null: no se inventa una banda con 3 datos).
export const MIN_VARIACIONES = 20;

// Variaciones relativas entre días consecutivos de la serie (ordenada por fecha). Se ignoran valores no positivos o no finitos.
export function variacionesDiarias(serie: PuntoSerie[]): number[] {
  const s = [...serie].filter(p => Number.isFinite(p.valor) && p.valor > 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const out: number[] = [];
  for (let i = 1; i < s.length; i++) out.push(s[i].valor / s[i - 1].valor - 1);
  return out;
}

// Percentil (0..1) por interpolación lineal sobre los valores absolutos.
export function percentilAbs(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const a = xs.map(Math.abs).sort((x, y) => x - y);
  const pos = Math.min(1, Math.max(0, p)) * (a.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

// Umbral de salida sugerido: el umbral de rojo corrido `ruedas` movimientos «grandes» (percentil 75 del cambio diario absoluto) hacia el
// lado sano. `lado`: 'sube' si el rojo es hacia arriba (VIX, riesgo país…: sale por debajo), 'baja' si es hacia abajo (ADR YPF: sale por encima).
export function salidaSugerida(serie: PuntoSerie[], umbralRojo: number, lado: 'sube' | 'baja', ruedas = 2): { salida: number; movDiarioP75: number; observaciones: number } | null {
  const vars = variacionesDiarias(serie);
  if (vars.length < MIN_VARIACIONES) return null;
  const mov = percentilAbs(vars, 0.75)!;
  const f = Math.min(0.5, mov * ruedas);   // tope: nunca una banda de más de 50 %
  return { salida: lado === 'sube' ? umbralRojo * (1 - f) : umbralRojo * (1 + f), movDiarioP75: mov, observaciones: vars.length };
}
