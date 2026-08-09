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
// `aportadoNeto` = aportes − retiros DEL AÑO (no acumulado histórico); `pnl` = ganancia en dólares
// del año (Vfin − Vini − aportadoNeto). Pueden ser no-nulos aunque `rendimiento` sí sea null (un
// retiro que deja la base en ≤0 invalida el %, no el monto en dólares) — ver abajo de dónde sale
// cada uno según el método usado para el %.
export interface RendAnio { anio: number; rendimiento: number | null; aportadoNeto: number | null; pnl: number | null }

const DIA = 86_400_000;
const dias = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DIA;

// Modified Dietz: pondera cada flujo por la fracción del período que estuvo invertido.
// R = (Vfin − Vini − ΣF) / (Vini + Σ w_i·F_i),  w_i = (T − t_i)/T
// Sin esto, un aporte grande en diciembre entra al denominador como si hubiera estado todo el año
// y hunde el rendimiento (o lo infla, si fue un retiro).
// Devuelve `sumF` (el total de flujos SIN ponderar) además del %: es el numerador real del año según
// los flujos fechados — más preciso que el delta de `aportado` entre snapshots (ver el llamador),
// así el caller puede armar aportadoNeto/pnl con el mismo dato que usó para el %, sin inventar un
// segundo cálculo que podría no coincidir.
function dietz(vIni: number, vFin: number, flujos: Flujo[], desde: string, hasta: string): { rendimiento: number | null; sumF: number } {
  const T = dias(desde, hasta);
  let sumF = 0, sumPond = 0;
  for (const f of flujos) {
    const t = dias(desde, f.fecha);
    const w = Math.min(1, Math.max(0, (T - t) / T));
    sumF += f.monto;
    sumPond += w * f.monto;
  }
  if (!(T > 0)) return { rendimiento: null, sumF };
  const base = vIni + sumPond;
  return { rendimiento: base > 1e-9 ? (vFin - vIni - sumF) / base : null, sumF };
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

    // Con flujos fechados dentro del año usamos Modified Dietz (ponderado por tiempo).
    const delAnio = flujos.filter(f => f.fecha >= yStart && f.fecha <= fin.fecha && !Number.isNaN(Date.parse(f.fecha)));
    if (delAnio.length) {
      // El período arranca en el 1-ene, salvo el año de creación (ahí, en el primer flujo real).
      const desde = y === inceptionYear ? delAnio.map(f => f.fecha).sort()[0] : yStart;
      const { rendimiento: r, sumF } = dietz(vIni, fin.valor, delAnio.filter(f => f.fecha >= desde), desde, fin.fecha);
      // aportadoNeto/pnl acá SALEN DE `sumF` (los flujos fechados que ya usó Dietz para el %), NO del
      // delta `fin.aportado - aIni` entre snapshots. Son dos fuentes de datos distintas: los flujos
      // vienen de la tabla `aportes` (siempre al día); el `aportado` de un snapshot es una FOTO fija
      // del día que se grabó, que nunca se reescribe — si después se carga/edita/borra un aporte con
      // fecha pasada, o el snapshot simplemente no cayó justo el 31-dic, el delta de snapshots queda
      // desalineado con lo que el % realmente usó. Usar `sumF` mantiene el $ coherente con el % de
      // ESTA fila, en vez de una segunda fuente que puede contradecirlo.
      out.push({ anio: y, rendimiento: r, aportadoNeto: sumF, pnl: fin.valor - vIni - sumF });
      continue;
    }

    // Sin flujos fechados en el año: no hay con qué armar Dietz, así que tanto el % como el $ caen al
    // delta de `aportado` entre snapshots (menos preciso, pero es lo único disponible — y % y $ usan
    // la MISMA fuente acá, así que no pueden contradecirse entre sí).
    const fNeto = fin.aportado - aIni;
    const pnl = fin.valor - vIni - fNeto;
    const base = vIni + fNeto;             // capital que estuvo trabajando
    // base > 0: si un retiro deja la base ≤ 0, el % no es representativo → null (no un número raro).
    // El $ (pnl) sigue siendo válido igual — no depende de la base, solo el %.
    const rend = base > 1e-9 ? pnl / base : null;
    out.push({ anio: y, rendimiento: rend, aportadoNeto: fNeto, pnl });
  }
  return out;
}
