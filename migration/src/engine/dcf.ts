// =============================================================================
// Valuación DCF por Owner Earnings (Buffett / Munger). Puro y determinista.
// Owner Earnings = Cash Flow Operativo − Capex de MANTENIMIENTO.
// El capex de CRECIMIENTO (capex total − mantenimiento) se expone aparte: dice
// cuánto invierte la empresa en crecer (y cuánto deprime su FCF de hoy).
// =============================================================================

import type { Fundamentals, AnnualPoint, Ratios } from '../types/domain';

export type CapexMethod = 'dna' | 'capex' | 'avg';

// Cómo se normalizan los owner earnings (la BASE que después se proyecta a tasa g).
// Buffett NO dio una regla de N años para las ganancias: en la carta de 1986 el "promedio" que
// menciona corresponde al CAPEX DE MANTENIMIENTO (que es lumpy y hay que estimar). La regla de
// promediar 5-10 años viene de Graham & Dodd (Security Analysis), y de ahí desciende el CAPE.
// El principio común es usar la capacidad de generación SOSTENIBLE, y eso depende del negocio: en
// uno estable el último año es la mejor información; en uno cíclico hay que promediar el ciclo.
//
// OJO con el sesgo silencioso: promediar hacia atrás no solo normaliza el MARGEN, también achica la
// ESCALA. En una empresa que crece, cada método de promedio equivale a valuar un negocio de hace
// ~1-2 años (prom5 ≈ 1,9 años de rezago). Es conservadurismo legítimo, pero conviene saberlo.
export type OeMethod = 'ultimo' | 'prom3' | 'prom5' | 'ponderado' | 'mediana5' | 'margen';

// Default: el ÚLTIMO año. Fuente única de verdad (defaults, fallback de guardados viejos y el
// parámetro por defecto del normalizador) para que no queden comportamientos inconsistentes.
// Por qué: todo promedio hacia atrás no solo normaliza el margen, también achica la ESCALA — en una
// empresa que crece equivale a valuar el negocio de hace 1-2 años; y en una que se deteriora
// SOBREVALÚA (promediar años buenos que ya no existen). El último año refleja la escala real de hoy.
// Contrapartida: el valor intrínseco es LINEAL en esta base, así que un año con ruido (swing de
// capital de trabajo, venta puntual, margen pico) se traslada 1:1 → por eso existe el guard de base
// que bloquea COMPRAR si el último año se sale de su propia tendencia.
// Para negocios con volatilidad RECURRENTE (farma con cargos de I+D, cíclicas) conviene prom5.
export const OE_METHOD_DEFAULT: OeMethod = 'ultimo';

export interface DcfInputs {
  g: number;                 // crecimiento explícito anual (ej. 0.08)
  d: number;                 // tasa de descuento (ej. 0.10)
  gt: number;                // crecimiento terminal (ej. 0.025)
  N: number;                 // años explícitos (default 10)
  capexMethod: CapexMethod;  // capex de mantenimiento
  oeMethod?: OeMethod;       // normalización de los owner earnings (default: OE_METHOD_DEFAULT)
  mosRequired: number;       // margen de seguridad exigido (ej. 0.30)
}

export const DEFAULT_DCF_INPUTS: DcfInputs = {
  g: 0.08, d: 0.10, gt: 0.03, N: 20, capexMethod: 'dna', oeMethod: OE_METHOD_DEFAULT, mosRequired: 0.20,
};

// Techo de crecimiento explícito: ninguna empresa sostiene >15% anual durante N años. Sin este
// tope, un EG5Y histórico alto (growth) proyectado 20 años produce un valor intrínseco absurdo.
export const G_MAX = 0.15;

// Supuestos por defecto CALCULADOS por empresa: g = EG5Y real − 1 punto; d = Ke (CAPM);
// gt 3%, N 20 años, MoS exigido 20%. Son el punto de partida; el usuario puede editar y guardar.
//
// POR QUÉ Ke Y NO WACC: los owner earnings (OCF − capex mant.) ya están DESPUÉS de intereses, o sea
// son flujo del ACCIONISTA, y el valor resultante se divide directo por acciones sin restar deuda
// neta → es una valuación de equity. Descontarla al WACC (que mezcla deuda más barata) infla el
// valor cuanto más apalancada esté la empresa. El WACC correspondería solo si se descontara un
// flujo unlevered (FCFF) y luego se restara la deuda neta, que no es lo que hace este modelo.
//
// g se acota a G_MAX y, además, por debajo de d: con g ≥ d el período explícito compone hacia
// arriba y el modelo deja de ser estable (ver el gate del veredicto en computeDcf).
export function dcfDefaultsFor(r: Ratios): DcfInputs {
  const d = r.costOfEquity != null ? Math.max(0.06, +r.costOfEquity.toFixed(4)) : DEFAULT_DCF_INPUTS.d; // piso 6%
  const gBruto = r.eg5y != null ? Math.max(0, r.eg5y - 0.01) : DEFAULT_DCF_INPUTS.g;
  const g = +Math.max(0, Math.min(gBruto, G_MAX, d - 0.01)).toFixed(4);
  return { g, d, gt: 0.03, N: 20, capexMethod: 'dna', oeMethod: OE_METHOD_DEFAULT, mosRequired: 0.20 };
}

export interface OwnerEarningsYear {
  fy: number;
  ocf: number;
  maintenanceCapex: number;
  growthCapex: number;
  ownerEarnings: number;
}

export interface MungerCheck { label: string; ok: boolean; detail: string; }

export interface DcfResult {
  ownerEarningsByYear: OwnerEarningsYear[];
  ownerEarningsNorm: number;        // base normalizada según inp.oeMethod (default: último año)
  histCagrOE: number | null;        // CAGR histórico de owner earnings
  intrinsicValue: number;           // equity total
  intrinsicPerShare: number | null;
  terminalPV: number;
  terminalShare: number;            // % del valor total que viene de la perpetuidad
  marginOfSafety: number | null;    // 1 − precio/valor
  verdict: 'COMPRAR' | 'ESPERAR' | 'CARO' | 'SIN_DATOS';
  motivoInestable: string | null;   // si != null, el veredicto NO puede ser COMPRAR (supuestos frágiles)
  mungerChecks: MungerCheck[];
  shares: number | null;
  price: number | null;
}

const byFy = (arr: AnnualPoint[]) => new Map(arr.map(p => [p.fy, p.val]));

// Join OCF / D&A / capex por año fiscal y arma owner earnings por año.
export function ownerEarningsByYear(f: Fundamentals, method: CapexMethod): OwnerEarningsYear[] {
  const ocf = byFy(f.ocf), dna = byFy(f.dna), capex = byFy(f.capex);
  // Exigir SOLO lo que el método necesita. Antes se pedía capex siempre, incluso con el método
  // 'dna' (el default), que no lo usa: si EDGAR no traía el capex del último año, ese año se
  // descartaba entero y los owner earnings normalizados quedaban anclados a años viejos y chicos.
  const needsDna = method === 'dna' || method === 'avg';
  const needsCapex = method === 'capex' || method === 'avg';
  const years = [...ocf.keys()]
    .filter(fy => (!needsDna || dna.has(fy)) && (!needsCapex || capex.has(fy)))
    .sort((a, b) => a - b);
  return years.map(fy => {
    const cf = ocf.get(fy)!;
    const d = dna.has(fy) ? Math.abs(dna.get(fy)!) : 0;
    const tieneCapex = capex.has(fy);
    const cx = tieneCapex ? Math.abs(capex.get(fy)!) : 0;
    const maint = method === 'dna' ? d : method === 'capex' ? cx : (d + cx) / 2;
    // El capex de crecimiento solo tiene sentido si conocemos el capex total del año.
    return { fy, ocf: cf, maintenanceCapex: maint, growthCapex: tieneCapex ? cx - maint : 0, ownerEarnings: cf - maint };
  });
}

// Mediana del MARGEN de owner earnings sobre ventas × ventas del último año. Normaliza la
// rentabilidad (no capitaliza un margen pico) pero conserva la escala ACTUAL del negocio → sin el
// rezago que arrastran los promedios. Es la mejor opción para una empresa que creció y además es
// cíclica. Devuelve null si no hay ventas para emparejar.
export function normalizarPorMargen(oe: { fy: number; ownerEarnings: number }[], ventasPorFy: Map<number, number>): number | null {
  const margenes: number[] = [];
  for (const y of oe) {
    const v = ventasPorFy.get(y.fy);
    if (v != null && v > 0) margenes.push(y.ownerEarnings / v);
  }
  const ultimoFy = oe.length ? oe[oe.length - 1].fy : null;
  const ventasHoy = ultimoFy != null ? ventasPorFy.get(ultimoFy) : null;
  if (!margenes.length || ventasHoy == null || !(ventasHoy > 0)) return null;
  const a = [...margenes].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  const mediana = a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  return mediana * ventasHoy;
}

// Normaliza la serie de owner earnings según el método elegido. La serie debe venir ordenada de MÁS
// VIEJA a MÁS RECIENTE. Un método desconocido (dato guardado corrupto) cae al ponderado.
export function normalizarOwnerEarnings(serie: number[], metodo: OeMethod = OE_METHOD_DEFAULT): number {
  if (!serie.length) return 0;
  const prom = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  switch (metodo) {
    case 'ultimo':                                  // negocio estable: el dato más actual
      return serie[serie.length - 1];
    case 'prom3':
      return prom(serie.slice(-3));
    case 'prom5':                                   // cíclicos: promedia el ciclo
      return prom(serie.slice(-5));
    case 'mediana5': {                              // robusto a UN año atípico (cargo/venta puntual)
      const a = [...serie.slice(-5)].sort((x, y) => x - y);
      const m = Math.floor(a.length / 2);
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    }
    case 'ponderado':
    default: {                                      // pesos lineales: sigue la tendencia sin saltar al pico
      let num = 0, den = 0;
      serie.forEach((v, i) => { const w = i + 1; num += v * w; den += w; });
      return den > 0 ? num / den : 0;
    }
  }
}

// CAGR histórico de owner earnings (para el chequeo Munger de "supuesto no optimista" y para el
// cruce precio-vs-negocio de la tarjeta de Análisis, ver tendenciaPrecio.ts). `anios` son los años
// REALES transcurridos entre el primer y el último punto (last5[último].fy − last5[primero].fy) —
// NO "cantidad de puntos − 1": si algún ejercicio intermedio falta en la serie (un concepto de EDGAR,
// ej. OCF, no resolvió para ese año puntual — pasa incluso con netIncome/revenue completos, ver
// ownerEarningsByYear), 5 puntos pueden abarcar 5 años reales, no 4, y dividir por "puntos−1" infla
// el CAGR. Con MRK real (OCF sin 2021, la serie salta 2020→2022) esto inflaba histCagrOE de ~9.4% a
// 11.8% — suficiente para esconder un recalentamiento real en el cruce de la tarjeta de Análisis.
function cagr(series: number[], anios: number): number | null {
  if (series.length < 2 || anios <= 0) return null;
  const first = series[0], last = series[series.length - 1];
  if (first <= 0 || last <= 0) return null;
  return (last / first) ** (1 / anios) - 1;
}

export function computeDcf(f: Fundamentals, price: number | null, wacc: number | null, inp: DcfInputs, roic: number | null = null): DcfResult {
  const oeYears = ownerEarningsByYear(f, inp.capexMethod);
  const last5 = oeYears.slice(-5);
  const shares = f.shares ?? null;

  if (last5.length === 0) {
    return {
      ownerEarningsByYear: oeYears, ownerEarningsNorm: 0, histCagrOE: null,
      intrinsicValue: 0, intrinsicPerShare: null, terminalPV: 0, terminalShare: 0,
      marginOfSafety: null, verdict: 'SIN_DATOS', motivoInestable: null, mungerChecks: [], shares, price,
    };
  }

  const oeMethod = inp.oeMethod ?? OE_METHOD_DEFAULT;   // guardados viejos siguen el default actual
  const serieOe = last5.map(y => y.ownerEarnings);
  // 'margen' necesita las ventas; si no se pueden emparejar, cae al ponderado (no inventa).
  const porMargen = oeMethod === 'margen' ? normalizarPorMargen(last5, byFy(f.revenue)) : null;
  const ownerEarningsNorm = porMargen ?? normalizarOwnerEarnings(serieOe, oeMethod === 'margen' ? 'ponderado' : oeMethod);
  const histCagrOE = cagr(last5.map(y => y.ownerEarnings), last5[last5.length - 1].fy - last5[0].fy);

  // Owner earnings normalizados ≤ 0 (capex agresivo / OCF < capex mant.): el DCF no
  // aplica. Sin esto, un valor intrínseco negativo produce MoS > 100% y un falso "COMPRAR".
  if (ownerEarningsNorm <= 0) {
    return {
      ownerEarningsByYear: oeYears, ownerEarningsNorm, histCagrOE,
      intrinsicValue: 0, intrinsicPerShare: null, terminalPV: 0, terminalShare: 0,
      marginOfSafety: null, verdict: 'SIN_DATOS', motivoInestable: null,
      mungerChecks: [], shares, price,
    };
  }

  // Proyección: N años a tasa g, descontados a d, valor terminal de Gordon con gt.
  // Saneamos los supuestos: un N no finito o enorme (dato guardado corrupto) haría que el bucle
  // no termine y cuelgue el render; g/d/gt no finitos propagarían NaN. N se acota a 1..100.
  const g = Number.isFinite(inp.g) ? inp.g : DEFAULT_DCF_INPUTS.g;
  const d = Number.isFinite(inp.d) && inp.d > 0 ? inp.d : DEFAULT_DCF_INPUTS.d;
  const gt = Number.isFinite(inp.gt) ? inp.gt : DEFAULT_DCF_INPUTS.gt;
  const N = Number.isFinite(inp.N) ? Math.min(Math.max(Math.round(inp.N), 1), 100) : DEFAULT_DCF_INPUTS.N;
  let pvExplicit = 0;
  let oeT = ownerEarningsNorm;
  for (let t = 1; t <= N; t++) {
    oeT = ownerEarningsNorm * (1 + g) ** t;
    pvExplicit += oeT / (1 + d) ** t;
  }
  const oeN = ownerEarningsNorm * (1 + g) ** N;
  // Guarda: si d <= gt el modelo de Gordon no es válido (valor infinito) → terminal 0.
  const terminalValue = d > gt ? (oeN * (1 + gt)) / (d - gt) : 0;
  const terminalPV = terminalValue / (1 + d) ** N;

  const intrinsicValue = pvExplicit + terminalPV;
  const intrinsicPerShare = shares && shares > 0 ? intrinsicValue / shares : null;
  const terminalShare = intrinsicValue > 0 ? terminalPV / intrinsicValue : 0;
  const marginOfSafety = intrinsicPerShare && intrinsicPerShare > 0 && price ? 1 - price / intrinsicPerShare : null;

  // Gate de estabilidad: con g ≥ d el período explícito compone hacia arriba (el valor intrínseco
  // se infla y daría un COMPRAR falso), y un valor terminal que es casi todo el total significa que
  // la valuación depende de una perpetuidad, no del negocio proyectado. En esos casos NO afirmamos
  // COMPRAR: degradamos a ESPERAR y exponemos el motivo para que el usuario revise los supuestos.
  // Guard de BASE (además de los de tasas): el valor intrínseco es LINEAL en ownerEarningsNorm, así
  // que un error del 25% en la base se come entero el margen de seguridad — y ninguno de los otros
  // chequeos lo detecta (todos son invariantes de escala). Si se eligió el último año y ese año está
  // muy por encima de la mediana, probablemente estemos capitalizando ruido (swing de capital de
  // trabajo, venta puntual, margen pico) a perpetuidad.
  // Comparar contra la mediana NO sirve: en una empresa que crece sano el último año siempre está
  // por encima (MSFT: +31%) y daría falso positivo. Lo que delata ruido es que el último año se
  // salga de SU PROPIA tendencia: que el salto interanual sea muy superior al salto típico.
  const saltoAnomalo = (serie: number[]): number | null => {
    if (serie.length < 3) return null;
    const ratios: number[] = [];
    for (let i = 1; i < serie.length; i++) {
      if (serie[i - 1] > 0 && serie[i] > 0) ratios.push(serie[i] / serie[i - 1]);
    }
    if (ratios.length < 2) return null;
    const ultimo = ratios[ratios.length - 1];
    const previos = [...ratios.slice(0, -1)].sort((a, b) => a - b);
    const m = Math.floor(previos.length / 2);
    const tipico = previos.length % 2 ? previos[m] : (previos[m - 1] + previos[m]) / 2;
    if (!(tipico > 0)) return null;
    return ultimo > Math.max(1.5, 2 * tipico) ? ultimo / tipico : null;
  };
  const anomalia = oeMethod === 'ultimo' ? saltoAnomalo(serieOe) : null;
  const baseInflada = anomalia != null;

  const motivoInestable = !(g < d)
    ? `supuesto inestable: g ${(g * 100).toFixed(1)}% ≥ d ${(d * 100).toFixed(1)}%`
    : baseInflada
      ? `la base es el último año y saltó ${anomalia!.toFixed(1)}× más que su salto habitual (¿ruido puntual?)`
      : terminalShare > 0.85
        ? `el ${(terminalShare * 100).toFixed(0)}% del valor viene de la perpetuidad`
        : null;

  const verdict: DcfResult['verdict'] =
    marginOfSafety == null ? 'SIN_DATOS'
    : (marginOfSafety >= inp.mosRequired && !motivoInestable) ? 'COMPRAR'
    : marginOfSafety >= 0 ? 'ESPERAR' : 'CARO';

  const mungerChecks: MungerCheck[] = [
    {
      // ROIC es retorno sobre el capital TOTAL (equity + deuda), así que el benchmark correcto es el
      // WACC (costo del capital total), no Ke. El rótulo decía "Ke" aunque recibía el WACC.
      label: '¿ROIC > WACC? (crea valor)',
      ok: roic != null && wacc != null ? roic > wacc : false,
      detail: roic != null && wacc != null ? `ROIC ${(roic * 100).toFixed(1)}% vs WACC ${(wacc * 100).toFixed(1)}%` : 'ROIC/WACC no disponible',
    },
    {
      label: '¿g ≤ CAGR histórico de owner earnings? (supuesto no optimista)',
      ok: histCagrOE != null ? g <= histCagrOE + 1e-9 : false,
      detail: histCagrOE != null ? `g ${(g * 100).toFixed(1)}% vs histórico ${(histCagrOE * 100).toFixed(1)}%` : 'sin histórico',
    },
    {
      label: '¿g < d? (modelo estable)',
      ok: g < d,
      detail: `g ${(g * 100).toFixed(1)}% vs d ${(d * 100).toFixed(1)}%`,
    },
    {
      label: '¿valor terminal < 75% del total?',
      ok: terminalShare < 0.75,
      detail: `terminal = ${(terminalShare * 100).toFixed(0)}% del valor`,
    },
  ];

  return {
    ownerEarningsByYear: oeYears, ownerEarningsNorm, histCagrOE,
    intrinsicValue, intrinsicPerShare, terminalPV, terminalShare,
    marginOfSafety, verdict, motivoInestable, mungerChecks, shares, price,
  };
}

// "Compra agresiva" (estándar Buffett): no alcanza con estar barato — el margen de seguridad tiene
// que ser AMPLIO, un colchón grande para el error de estimación. Exige verdict COMPRAR (que ya
// descarta bases inestables vía motivoInestable) además del margen — así una empresa barata pero
// con datos ruidosos nunca se marca como oportunidad agresiva.
export const MARGEN_COMPRA_AGRESIVA = 0.5;
export function esCompraAgresiva(
  dcf: Pick<DcfResult, 'verdict' | 'marginOfSafety'>,
  umbral = MARGEN_COMPRA_AGRESIVA,
): boolean {
  return dcf.verdict === 'COMPRAR' && dcf.marginOfSafety != null && dcf.marginOfSafety >= umbral;
}

// Tabla de sensibilidad: valor intrínseco por acción variando g (filas) contra d (columnas).
export function sensitivityTable(
  f: Fundamentals, wacc: number | null, base: DcfInputs,
  gValues: number[], dValues: number[],
): { g: number; cells: (number | null)[] }[] {
  return gValues.map(g => ({
    g,
    cells: dValues.map(d => computeDcf(f, null, wacc, { ...base, g, d }).intrinsicPerShare),
  }));
}
