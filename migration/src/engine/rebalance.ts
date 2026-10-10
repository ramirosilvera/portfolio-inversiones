// =============================================================================
// Rebalanceo de objetivos y simulación de compra para acercarse a un objetivo. Puro y testeado
// (los NÚMEROS los calcula el código). Todo en la misma moneda (USD) que la valuación.
// =============================================================================

// Tolerancia (fracción, ej. 0.025 = ±2.5pp) por debajo de la cual una posición "fuera del
// objetivo" no se marca como desviada — evita ruido visual por micro-desvíos que el rebalanceo
// normal (precios moviéndose día a día) genera todo el tiempo. Un único valor compartido: Dashboard
// y Posiciones muestran el mismo concepto ("¿esta posición está fuera de su % objetivo?") y no
// pueden divergir en el umbral.
export const TOLERANCIA_OBJETIVO = 0.025;

// Monto (USD) a AGREGAR a una posición para que su peso llegue a `objetivo` (0..1), contemplando
// que comprar también agranda el total: resolvemos (vi + x)/(V + x) = t  →  x = (t·V − vi)/(1 − t).
// Negativo = la posición ya está por ENCIMA del objetivo (habría que vender ~|x|).
export function montoParaObjetivo(valorPosicion: number, valorTotal: number, objetivo: number): number {
  const t = Math.max(0, Math.min(0.999999, objetivo)); // t→1 sería infinito; lo acotamos
  return (t * valorTotal - valorPosicion) / (1 - t);
}

// Peso resultante de una posición tras agregarle `monto` comprando (el total crece igual).
export function pesoResultante(valorPosicion: number, valorTotal: number, monto: number): number {
  const V = valorTotal + monto;
  return V > 0 ? (valorPosicion + monto) / V : 0;
}

// Cantidad de unidades para invertir `monto` a `precioUnitario` (USD por unidad valuada).
export function cantidadPorMonto(monto: number, precioUnitario: number): number {
  return precioUnitario > 0 ? monto / precioUnitario : 0;
}

// Redondea una lista de objetivos (fracciones 0..1) a enteros de % que SUMAN 100 exactos (método
// del resto mayor / Hamilton): así lo que se muestra nunca da 99% o 101% por redondeos sueltos.
export function redondearPct(items: { id: string; peso: number }[]): Map<string, number> {
  const total = items.reduce((s, i) => s + (i.peso || 0), 0);
  const out = new Map<string, number>();
  if (total <= 0 || items.length === 0) { items.forEach(i => out.set(i.id, 0)); return out; }
  const exact = items.map(i => ({ id: i.id, e: ((i.peso || 0) / total) * 100 }));
  const floors = exact.map(x => ({ id: x.id, base: Math.floor(x.e), rem: x.e - Math.floor(x.e) }));
  floors.forEach(f => out.set(f.id, f.base));
  let restante = 100 - floors.reduce((s, f) => s + f.base, 0);
  // Las unidades que faltan para llegar a 100 van a los de mayor resto.
  const orden = [...floors].sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < orden.length && restante > 0; i++) { out.set(orden[i].id, (out.get(orden[i].id) ?? 0) + 1); restante--; }
  return out;
}

// ── Simulación de VARIAS compras a la vez ───────────────────────────────────
// Simular "llegar al 20% de A" y, a la vez, "llegar al 15% de B" no es lo mismo que resolver cada
// una por separado: comprar B agranda el total contra el que se mide el 20% de A. Hay que resolver
// el sistema junto. Para posiciones con método "monto"/"cantidad" el monto ya es fijo (no depende
// del total); para las que apuntan a un %-objetivo, se resuelven todas juntas.
export interface SimTarget { id: string; valorActual: number; objetivo: number }

// Clamp defensivo a [0,1] — SIN acotar por debajo de 1 (a diferencia de otras funciones de este
// archivo): un objetivo de exactamente 100% tiene que poder producir denom=0 y devolver
// "inalcanzable" más abajo. Si se lo empuja artificialmente a 99,9999% para "no dividir por cero",
// el resultado es un F financieramente absurdo (miles de millones) en vez del error correcto.
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

// Total final F si TODAS las `targets` llegan exacto a su objetivo, dado el total base V y lo ya
// comprometido en montos fijos (compras por monto/cantidad de otras simulaciones activas).
// Se despeja de: para cada i, (vi+xi)/F = ti, y F = V + montosFijos + Σxi.
function totalFinal(targets: SimTarget[], valorTotalBase: number, montosFijos: number): number | null {
  const sumT = targets.reduce((s, t) => s + clamp01(t.objetivo), 0);
  const sumV = targets.reduce((s, t) => s + t.valorActual, 0);
  const denom = 1 - sumT;
  if (denom <= 1e-9) return null; // los objetivos combinados suman ≥100%: inalcanzable comprando
  return (valorTotalBase + montosFijos - sumV) / denom;
}

// Resuelve el monto de cada target para llegar exacto a su %-objetivo, todos a la vez sobre el
// mismo total final. Si alguno ya está por ENCIMA de su objetivo (monto negativo, habría que
// vender), se excluye del sistema —no infla el total con una "compra negativa" que no se va a
// ejecutar— y se recalcula el resto; ese excluido igual devuelve su monto negativo (para avisar en
// la UI), calculado contra el total final ya sin él. `null` global = objetivos inalcanzables.
export function resolverObjetivosSimultaneos(
  targets: SimTarget[], valorTotalBase: number, montosFijos: number,
): Map<string, number> | null {
  let activos = targets;
  const excluidos: SimTarget[] = [];
  for (let i = 0; i <= targets.length; i++) {
    const F = totalFinal(activos, valorTotalBase, montosFijos);
    if (F == null) return null;
    const negativos = activos.filter(t => clamp01(t.objetivo) * F - t.valorActual < 0);
    if (negativos.length === 0) {
      const out = new Map<string, number>();
      for (const t of activos) out.set(t.id, clamp01(t.objetivo) * F - t.valorActual);
      for (const t of excluidos) out.set(t.id, clamp01(t.objetivo) * F - t.valorActual);
      return out;
    }
    excluidos.push(...negativos);
    activos = activos.filter(t => !negativos.includes(t));
  }
  return null; // no debería llegar acá (el loop converge en ≤ targets.length pasadas)
}

// Peso resultante de una posición dado su monto simulado y el total FINAL de la cartera (ya con
// TODAS las compras simuladas incluidas) — a diferencia de `pesoResultante`, acá `valorTotalFinal`
// ya incluye este mismo `monto` (no hay que sumarlo de nuevo).
export function pesoResultanteConjunto(valorPosicion: number, monto: number, valorTotalFinal: number): number {
  return valorTotalFinal > 0 ? (valorPosicion + monto) / valorTotalFinal : 0;
}

export interface ObjetivoItem { id: string; peso_objetivo: number | null }

// Reajusta los objetivos del "plan" (las posiciones con objetivo asignado) para que sumen 100%
// cuando cambia uno. El resto se escala proporcional a lo que tenía; si ninguno tenía, en partes
// iguales. `nuevo = null` saca la posición del plan y reparte su lugar entre las demás.
export function aplicarObjetivo(
  targeted: ObjetivoItem[], changedId: string, nuevo: number | null,
): { id: string; peso_objetivo: number | null }[] {
  // Con nuevo=null la posición sale del plan (objetivo null) y el resto se renormaliza a 1.
  if (nuevo == null) {
    const otros = targeted.filter(i => i.id !== changedId);
    const sum = otros.reduce((s, i) => s + (i.peso_objetivo ?? 0), 0);
    return targeted.map(i => {
      if (i.id === changedId) return { id: i.id, peso_objetivo: null };
      if (otros.length === 0) return { id: i.id, peso_objetivo: null };
      const base = sum > 0 ? (i.peso_objetivo ?? 0) / sum : 1 / otros.length;
      return { id: i.id, peso_objetivo: base };
    });
  }
  const t = Math.max(0, Math.min(1, nuevo));
  const otros = targeted.filter(i => i.id !== changedId);
  const restante = 1 - t;
  const sumOtros = otros.reduce((s, i) => s + (i.peso_objetivo ?? 0), 0);
  return targeted.map(i => {
    if (i.id === changedId) return { id: i.id, peso_objetivo: t };
    if (otros.length === 0) return { id: i.id, peso_objetivo: t >= 1 ? 0 : 1 }; // caso borde: 1 solo activo
    const base = sumOtros > 0 ? (i.peso_objetivo ?? 0) / sumOtros : 1 / otros.length;
    return { id: i.id, peso_objetivo: restante * base };
  });
}

// Tolerancia para decir que el plan "está completo" (suma 100 %): medio punto, para absorber redondeos de carga.
const TOLERANCIA_SUMA_PLAN = 0.005;

// Qué objetivos hay que escribir cuando una posición SALE del portfolio (se borró, se vendió entera o se transfirió entera).
//  · Plan completo (los objetivos sumaban 100 %): la posición pierde su objetivo y el resto se reescala proporcional para
//    volver a sumar 100 % — el lugar que dejó se reparte, no queda huérfano.
//  · Plan parcial (el usuario eligió no asignar todo): solo se limpia el objetivo de la que salió; reescalar al resto
//    inventaría objetivos que nadie pidió.
// Devuelve solo las filas que cambian. Una posición sin objetivo no dispara nada.
export function objetivosTrasCierre(targeted: ObjetivoItem[], cerradoId: string): ObjetivoItem[] {
  const conObjetivo = targeted.filter(i => i.peso_objetivo != null);
  if (!conObjetivo.some(i => i.id === cerradoId)) return [];
  const suma = conObjetivo.reduce((s, i) => s + (i.peso_objetivo ?? 0), 0);
  if (Math.abs(suma - 1) > TOLERANCIA_SUMA_PLAN) return [{ id: cerradoId, peso_objetivo: null }];
  return aplicarObjetivo(conObjetivo, cerradoId, null).filter(o => {
    const antes = conObjetivo.find(i => i.id === o.id)?.peso_objetivo ?? null;
    return o.peso_objetivo == null ? antes != null : antes == null || Math.abs(o.peso_objetivo - antes) > 1e-9;
  });
}
