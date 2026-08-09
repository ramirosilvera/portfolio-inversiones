// =============================================================================
// Rendimiento por año calendario (como los fondos): cuánto rindió el portfolio en 2025, 2026, etc.
// Es rendimiento del PASADO, no anualizado ni proyectado. Puro y determinista.
//
// Cada "punto" es el valor de mercado del portfolio a una fecha + el capital APORTADO acumulado
// (neto: aportes − retiros) a esa fecha. El rendimiento de un año = ganancia del año sobre el
// capital que estuvo trabajando: (Vfin − Vini − aportesNetosDelAño) / (Vini + aportesNetosDelAño).
// Simple (no time-weighted) pero estable; coincide con el total cuando el portfolio nace ese año.
//
// HONESTO ante la falta de datos: un año solo se calcula si hay un CIERRE real dentro del año
// (snapshot ≥ inicio del año) y una APERTURA válida (snapshot del año previo, o 0 si es el año de
// creación). Los años sin datos suficientes devuelven null (no se inventa el corte).
// =============================================================================

export interface Punto { fecha: string; valor: number; aportado: number } // aportado = neto acumulado
export interface Flujo { fecha: string; monto: number }                   // firmado: aporte +, retiro −
// `aportadoNeto`/`pnl` viajan junto a `rendimiento` (no hay que recalcularlos aparte): son el mismo
// numerador/flujo que ya arma el cálculo del % — aportadoNeto = aportes − retiros DEL AÑO (no
// acumulado histórico), pnl = ganancia en dólares del año (Vfin − Vini − aportadoNeto), el mismo
// numerador tanto si el % se calculó con Dietz como con el método simple. Pueden ser no-nulos aunque
// `rendimiento` sí sea null (un retiro que deja la base en ≤0 invalida el %, no el monto en dólares).
export interface RendAnio { anio: number; rendimiento: number | null; aportadoNeto: number | null; pnl: number | null }

const DIA = 86_400_000;
const dias = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DIA;

// Modified Dietz: pondera cada flujo por la fracción del período que estuvo invertido.
// R = (Vfin − Vini − ΣF) / (Vini + Σ w_i·F_i),  w_i = (T − t_i)/T
// Sin esto, un aporte grande en diciembre entra al denominador como si hubiera estado todo el año
// y hunde el rendimiento (o lo infla, si fue un retiro).
function dietz(vIni: number, vFin: number, flujos: Flujo[], desde: string, hasta: string): number | null {
  const T = dias(desde, hasta);
  if (!(T > 0)) return null;
  let sumF = 0, sumPond = 0;
  for (const f of flujos) {
    const t = dias(desde, f.fecha);
    const w = Math.min(1, Math.max(0, (T - t) / T));
    sumF += f.monto;
    sumPond += w * f.monto;
  }
  const base = vIni + sumPond;
  return base > 1e-9 ? (vFin - vIni - sumF) / base : null;
}

// `flujos` (aportes/retiros fechados) es opcional: si se pasan, el rendimiento del año se calcula
// con Modified Dietz (ponderado por tiempo). Si no, se usa el método simple (todo el flujo neto en
// el denominador), que es exacto solo cuando no hubo movimientos de capital dentro del año.
export function rendimientoPorAnio(puntos: Punto[], inceptionYear: number, hoy: string, flujos: Flujo[] = []): RendAnio[] {
  const pts = puntos
    .filter(p => p && !Number.isNaN(Date.parse(p.fecha)) && Number.isFinite(p.valor) && Number.isFinite(p.aportado))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (Number.isNaN(Date.parse(hoy)) || !Number.isFinite(inceptionYear)) return [];

  const hasta = Number(hoy.slice(0, 4));
  const out: RendAnio[] = [];

  for (let y = inceptionYear; y <= hasta; y++) {
    const yStart = `${y}-01-01`;
    const yEnd = `${y}-12-31`;
    // Apertura: 0 si es el año de creación; si no, el último snapshot DEL AÑO PREVIO (su cierre).
    // Debe ser del año Y−1 específicamente: si falta todo un año de datos, no arrastramos un cierre
    // viejo (eso metería la ganancia de los años faltantes en este → null honesto).
    const prior = [...pts].reverse().find(p => p.fecha >= `${y - 1}-01-01` && p.fecha < yStart);
    const vIni = y === inceptionYear ? 0 : (prior ? prior.valor : null);
    const aIni = y === inceptionYear ? 0 : (prior ? prior.aportado : null);
    // Cierre: último punto DENTRO del año (≥ inicio, ≤ fin). Para el año en curso, hoy cae adentro.
    const fin = [...pts].reverse().find(p => p.fecha >= yStart && p.fecha <= yEnd);

    if (vIni == null || aIni == null || !fin) { out.push({ anio: y, rendimiento: null, aportadoNeto: null, pnl: null }); continue; }

    // Aportes netos y ganancia en dólares DEL AÑO — independientes de qué método calcule el %
    // (Dietz solo cambia cómo se pondera el denominador; el numerador Vfin−Vini−aportadoNeto es el
    // mismo en los dos casos, porque en ambos `delAnio`/`fNeto` cubren exactamente los flujos del año).
    const fNeto = fin.aportado - aIni;
    const pnl = fin.valor - vIni - fNeto;

    // Con flujos fechados dentro del año usamos Modified Dietz (ponderado por tiempo).
    const delAnio = flujos.filter(f => f.fecha >= yStart && f.fecha <= fin.fecha && !Number.isNaN(Date.parse(f.fecha)));
    if (delAnio.length) {
      // El período arranca en el 1-ene, salvo el año de creación (ahí, en el primer flujo real).
      const desde = y === inceptionYear ? delAnio.map(f => f.fecha).sort()[0] : yStart;
      const r = dietz(vIni, fin.valor, delAnio.filter(f => f.fecha >= desde), desde, fin.fecha);
      out.push({ anio: y, rendimiento: r, aportadoNeto: fNeto, pnl });
      continue;
    }

    const base = vIni + fNeto;             // capital que estuvo trabajando
    // base > 0: si un retiro deja la base ≤ 0, el % no es representativo → null (no un número raro).
    // El $ (pnl) sigue siendo válido igual — no depende de la base, solo el %.
    const rend = base > 1e-9 ? pnl / base : null;
    out.push({ anio: y, rendimiento: rend, aportadoNeto: fNeto, pnl });
  }
  return out;
}
