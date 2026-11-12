// =============================================================================
// Neutraliza el cambio de método de valuación de los CEDEARs (2026-11-12): hasta esa fecha un CEDEAR valía subyacente ÷ ratio (dólar CCL); desde entonces
// × (CCL ÷ MEP) (dólar MEP, el de la Liquidez y los aportes). Los snapshots viejos NO se reescriben (no hay MEP/CCL diario antes del 17/10 y reescribir
// datos contradice «no se reconstruye»): el punto anterior al cambio recibe un VALOR PUENTE = su valor expresado en el método nuevo, y el índice ponderado
// por tiempo (engine/desempeno.ts#indiceTwr) usa ese puente como base del tramo que cruza el cambio. Así el escalón no se cuenta como ganancia: TWR,
// máxima caída y fecha de recuperación quedan limpios. Puro y testeado.
// Límite declarado: Dietz del año y la ganancia de ventana de Ahorros siguen partiendo del valor del 31/12/2025 al CCL (sin composición ni dólar de ese día).
// =============================================================================

export interface SnapMetodo {
  fecha: string; valor: number;
  factor_cedear?: number | null;                          // null/ausente = valuado por paridad (método viejo)
  detalle?: { t: string; c?: number; v: number }[] | null;
}

// `factorVivo`: factor del punto de «hoy» en vivo si ya está en el método nuevo (macro con dólares válidos), o null.
// Devuelve fecha → valor puente, solo para el ÚLTIMO snapshot viejo que tenga un punto posterior en el método nuevo y composición (`detalle`) para rehacerlo.
export function puentesMetodo(
  snaps: SnapMetodo[], tickersCedear: ReadonlySet<string>, factorVivo: number | null, hoy?: string,
): Map<string, number> {
  const out = new Map<string, number>();
  const s = [...snaps].filter(x => x && Number.isFinite(x.valor) && x.valor > 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const esNuevo = (x: SnapMetodo) => x.factor_cedear != null && Number.isFinite(x.factor_cedear) && x.factor_cedear > 0;
  const primerNuevo = s.findIndex(esNuevo);
  let f: number | null = null, idxViejo = -1;
  if (primerNuevo > 0) { f = s[primerNuevo].factor_cedear!; idxViejo = primerNuevo - 1; }
  else if (primerNuevo === -1 && factorVivo != null && factorVivo > 0) {
    // Ningún snapshot en el método nuevo todavía: el punto vivo es el primero. El último snapshot (anterior a hoy) es el viejo.
    const prev = s.filter(x => !hoy || x.fecha < hoy);
    if (prev.length) { f = factorVivo; idxViejo = s.indexOf(prev[prev.length - 1]); }
  }
  if (idxViejo < 0 || f == null) return out;
  const v = s[idxViejo];
  if (esNuevo(v) || !v.detalle?.length) return out;
  const cedears = v.detalle.filter(d => tickersCedear.has(d.t)).reduce((a, d) => a + (Number(d.v) || 0), 0);
  if (!(cedears > 0)) return out;
  out.set(v.fecha, +(v.valor + cedears * (f - 1)).toFixed(2));
  return out;
}
