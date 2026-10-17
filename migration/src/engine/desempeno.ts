// =============================================================================
// Desempeño de la cartera para responder, con datos reales y verificables:
//   1. rentabilidad acumulada y anualizada (ponderada por tiempo y por dinero), en USD y neta de los costos registrados;
//   2. comparación contra el S&P 500 con LA MISMA METODOLOGÍA (el índice recibe tus mismos aportes y retiros, en las mismas fechas);
//   3. máxima caída (max drawdown) de la cartera y del benchmark.
// Puro y determinista (regla de oro #1: los números los calcula el código). NO inventa: sin cobertura suficiente devuelve null y
// dice por qué; una cifra con huecos se rotula como "mínimo conocido", nunca como el valor real. Nada se anualiza por debajo
// de un año: extrapolar semanas a un año es una estimación, no un dato.
// =============================================================================

import { xirr, type CashFlow } from './irr';

export interface PuntoValor { fecha: string; valor: number }
export interface FlujoFechado { fecha: string; monto: number }      // firmado: aporte +, retiro −
export interface PuntoSp { f: string; c: number }                    // cierre ajustado (retorno total) del benchmark

const DIA = 86_400_000;
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DIA);

// Un hueco mayor a esto entre dos valores consecutivos vuelve la serie "con huecos": la caída máxima observada puede ser menor
// que la real (el mínimo pudo ocurrir entre dos puntos). Una semana cubre fines de semana y feriados largos.
export const MAX_HUECO_CONFIABLE = 7;
// Por debajo de un año no se anualiza.
export const MIN_DIAS_ANUALIZAR = 365;

// ── Índice ponderado por tiempo (TWR) ─────────────────────────────────────────────────────────────────────────────────
// Encadena los rendimientos entre valores consecutivos NEUTRALIZANDO los aportes y retiros del período:
//   r = (V_fin − F) / V_ini − 1,   con F = flujo neto fechado en (fecha_ini, fecha_fin].
// El flujo se supone al FINAL del período (el valor de cierre ya lo incluye), que es como se graba el snapshot. Sin esto, un
// retiro se leería como una caída y un aporte como una suba — fatal para medir la máxima caída.
export interface PuntoIndice { fecha: string; indice: number }

export function indiceTwr(puntos: PuntoValor[], flujos: FlujoFechado[]): { serie: PuntoIndice[]; anomalias: number } {
  const pts = puntos
    .filter(p => p && !Number.isNaN(Date.parse(p.fecha)) && Number.isFinite(p.valor) && p.valor > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!pts.length) return { serie: [], anomalias: 0 };
  const serie: PuntoIndice[] = [{ fecha: pts[0].fecha, indice: 1 }];
  // `base` = último valor aceptado. Un tramo que no define un rendimiento creíble NO se descarta solo: se difiere y se vuelve a
  // intentar contra el valor siguiente, desde la misma base y con todos los flujos acumulados. Caso típico: el snapshot del día del
  // aporte se grabó ANTES de acreditar la plata (el valor no la incluye) y el siguiente sí → cada tramo por separado es absurdo
  // (−33 % y +31 %), pero juntos dan un retorno normal. Solo si nunca se resuelve queda como anomalía (y se avisa).
  let base = pts[0];
  let diferidos = 0, anomalias = 0;
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    if (b.fecha === base.fecha) continue;
    const F = flujos.filter(f => f.fecha > base.fecha && f.fecha <= b.fecha).reduce((s, f) => s + f.monto, 0);
    const neto = b.valor - F;
    const absurdo = F !== 0 && Math.abs(F) > 0.1 * base.valor && Math.abs(neto / base.valor - 1) > 0.2;   // flujo grande + retorno extremo
    if (!(neto > 0) || absurdo) { diferidos++; continue; }
    serie.push({ fecha: b.fecha, indice: serie[serie.length - 1].indice * (neto / base.valor) });
    base = b;
    diferidos = 0;
  }
  anomalias = diferidos;
  return { serie, anomalias };
}

export function twrAcumulado(serie: PuntoIndice[]): number | null {
  return serie.length >= 2 ? serie[serie.length - 1].indice / serie[0].indice - 1 : null;
}

// Anualiza solo con un año o más de historia; si no, null (no se extrapola).
export function anualizar(retorno: number | null, diasPeriodo: number): number | null {
  if (retorno == null || !Number.isFinite(retorno) || diasPeriodo < MIN_DIAS_ANUALIZAR || retorno <= -1) return null;
  return Math.pow(1 + retorno, 365 / diasPeriodo) - 1;
}

// ── Máxima caída ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface MaxDrawdown {
  mdd: number;                      // ≤ 0 (−0,12 = caída del 12 % desde el máximo hasta el mínimo posterior)
  fechaPico: string | null;
  fechaMinimo: string | null;
  fechaRecuperacion: string | null; // primer día en que el índice vuelve a su pico; null si todavía no
  enCurso: boolean;                 // hoy sigue por debajo de su máximo
  actual: number;                   // caída actual desde el máximo (≤ 0)
}

export function maxDrawdown(serie: { fecha: string; indice: number }[]): MaxDrawdown | null {
  if (serie.length < 2) return null;
  let pico = serie[0], mdd = 0, picoDelMdd = serie[0], minimo = serie[0];
  for (const p of serie) {
    if (p.indice > pico.indice) pico = p;
    const dd = p.indice / pico.indice - 1;
    if (dd < mdd) { mdd = dd; picoDelMdd = pico; minimo = p; }
  }
  let recuperacion: string | null = null;
  if (mdd < 0) {
    for (const p of serie) if (p.fecha > minimo.fecha && p.indice >= picoDelMdd.indice) { recuperacion = p.fecha; break; }
  }
  const maximo = Math.max(...serie.map(p => p.indice));
  const actual = serie[serie.length - 1].indice / maximo - 1;
  return {
    mdd, fechaPico: mdd < 0 ? picoDelMdd.fecha : null, fechaMinimo: mdd < 0 ? minimo.fecha : null,
    fechaRecuperacion: recuperacion, enCurso: actual < -1e-9, actual,
  };
}

// ── Calidad de la serie ───────────────────────────────────────────────────────────────────────────────────────────────
export interface CalidadSerie {
  puntos: number;
  desde: string | null;
  hasta: string | null;
  diasCubiertos: number;
  maxHueco: number;                 // días entre dos valores consecutivos
  huecos: { desde: string; hasta: string; dias: number }[];   // los mayores a MAX_HUECO_CONFIABLE
  confiable: boolean;               // sin huecos mayores a una semana (la máxima caída observada es la real, salvo intradía)
}

export function calidadSerie(puntos: PuntoValor[]): CalidadSerie {
  const pts = puntos.filter(p => p && !Number.isNaN(Date.parse(p.fecha)) && p.valor > 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const huecos: CalidadSerie['huecos'] = [];
  let maxHueco = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dias(pts[i - 1].fecha, pts[i].fecha);
    if (d > maxHueco) maxHueco = d;
    if (d > MAX_HUECO_CONFIABLE) huecos.push({ desde: pts[i - 1].fecha, hasta: pts[i].fecha, dias: d });
  }
  return {
    puntos: pts.length, desde: pts[0]?.fecha ?? null, hasta: pts[pts.length - 1]?.fecha ?? null,
    diasCubiertos: pts.length >= 2 ? dias(pts[0].fecha, pts[pts.length - 1].fecha) : 0,
    maxHueco, huecos, confiable: pts.length >= 2 && huecos.length === 0,
  };
}

// ── Benchmark con TUS mismos flujos ───────────────────────────────────────────────────────────────────────────────────
// Comparar tu rendimiento (que depende de CUÁNDO pusiste plata) contra el cierre a cierre del índice mide cosas distintas. La
// comparación homogénea: si cada aporte y retiro tuyo se hubiera hecho en el índice, el mismo día, ¿cuánto valdría hoy y a qué TIR?
const MAX_GAP_SERIE = 7;

export function cierreAl(serie: PuntoSp[], fecha: string): number | null {
  if (!serie.length) return null;
  if (dias(fecha, serie[0].f) > MAX_GAP_SERIE) return null;          // la serie empieza después de la fecha pedida
  let lo = 0, hi = serie.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (serie[m].f <= fecha) { ans = m; lo = m + 1; } else hi = m - 1; }
  if (ans < 0) return serie[0].c;
  if (ans === serie.length - 1 && dias(serie[ans].f, fecha) > MAX_GAP_SERIE * 3) return null;   // la serie TERMINA mucho antes de la fecha pedida
  return serie[ans].c;
}

export interface BenchmarkMismosFlujos {
  valorFinal: number;               // lo que valdría hoy el índice con tus mismos aportes y retiros
  tir: number | null;               // TIR (XIRR) de esa cartera hipotética; null si el período es menor a un año
  rendimientoPeriodo: number | null;// ganancia / capital aportado, sin anualizar
}

export function benchmarkConMismosFlujos(serie: PuntoSp[], flujos: FlujoFechado[], hasta: string): BenchmarkMismosFlujos | null {
  const fl = flujos.filter(f => f.monto !== 0 && f.fecha <= hasta && !Number.isNaN(Date.parse(f.fecha))).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!fl.length) return null;
  let unidades = 0, aportado = 0, retirado = 0;
  for (const f of fl) {
    const px = cierreAl(serie, f.fecha);
    if (px == null || !(px > 0)) return null;                       // sin cobertura de precios en la fecha del flujo: no se estima
    unidades += f.monto / px;
    if (f.monto > 0) aportado += f.monto; else retirado -= f.monto;
  }
  const pxFin = cierreAl(serie, hasta);
  if (pxFin == null || !(unidades > 0)) return null;
  const valorFinal = unidades * pxFin;
  const dp = dias(fl[0].fecha, hasta);
  const flows: CashFlow[] = [...fl.map(f => ({ date: f.fecha, amount: -f.monto })), { date: hasta, amount: valorFinal }];
  return {
    valorFinal, tir: dp >= MIN_DIAS_ANUALIZAR ? xirr(flows) : null,
    rendimientoPeriodo: aportado > 0 ? (valorFinal + retirado - aportado) / aportado : null,
  };
}

// Índice del benchmark en las mismas fechas que los snapshots de la cartera (comparación punto a punto) y, aparte, diario (exacto).
export function indiceBenchmark(serie: PuntoSp[], desde: string, hasta: string, fechas?: string[]): PuntoIndice[] {
  const base = cierreAl(serie, desde);
  if (base == null || !(base > 0)) return [];
  if (fechas) {
    return fechas.filter(f => f >= desde && f <= hasta).map(f => ({ fecha: f, indice: (cierreAl(serie, f) ?? NaN) / base })).filter(p => Number.isFinite(p.indice));
  }
  return serie.filter(p => p.f >= desde && p.f <= hasta).map(p => ({ fecha: p.f, indice: p.c / base }));
}

// ── Costos registrados ────────────────────────────────────────────────────────────────────────────────────────────────
export interface OrdenCosto { monto_usd: number | null; comision_usd: number | null; comision_ars: number | null; mep: number | null }

export interface ResumenCostos {
  ordenes: number;
  operadoUsd: number;
  comisionUsd: number;               // comisiones cobradas en dólares (ya debitadas de la Liquidez al registrar la orden)
  comisionArsPesos: number;          // comisiones cobradas en pesos
  comisionArsConvertidaUsd: number;  // la parte de esas comisiones en pesos que tiene tipo de cambio REGISTRADO (mep)
  comisionArsSinConvertirPesos: number; // la parte SIN tipo de cambio: no se estima, queda en pesos
  totalUsdConocido: number;          // comisionUsd + comisionArsConvertidaUsd
  pctSobreOperado: number | null;
}

export function resumenCostos(ordenes: OrdenCosto[]): ResumenCostos {
  let operado = 0, cUsd = 0, cArs = 0, cArsConv = 0, cArsSin = 0;
  for (const o of ordenes) {
    operado += Number(o.monto_usd) || 0;
    cUsd += Number(o.comision_usd) || 0;
    const ars = Number(o.comision_ars) || 0;
    cArs += ars;
    if (ars > 0) { if (o.mep && o.mep > 0) cArsConv += ars / o.mep; else cArsSin += ars; }
  }
  const total = cUsd + cArsConv;
  return {
    ordenes: ordenes.length, operadoUsd: +operado.toFixed(2), comisionUsd: +cUsd.toFixed(2), comisionArsPesos: +cArs.toFixed(2),
    comisionArsConvertidaUsd: +cArsConv.toFixed(2), comisionArsSinConvertirPesos: +cArsSin.toFixed(2),
    totalUsdConocido: +total.toFixed(2), pctSobreOperado: operado > 0 ? total / operado : null,
  };
}

// ── Composición: todo junto para la pantalla ──────────────────────────────────────────────────────────────────────────
export interface Desempeno {
  periodo: { desde: string | null; hasta: string | null; dias: number; menorAUnAnio: boolean };
  calidad: CalidadSerie;
  twr: { acumulado: number | null; anualizado: number | null; anomalias: number };
  tir: { anualizada: number | null; acumulada: number | null; neta: number | null; invertido: number; retirado: number };
  costos: ResumenCostos;
  cartera: { mdd: MaxDrawdown | null; rotuloMinimoConocido: boolean };
  benchmark: null | {
    mismosFlujos: BenchmarkMismosFlujos;
    twrBenchmark: number | null;                   // mismo período, cierre a cierre
    mddEnMismasFechas: MaxDrawdown | null;         // comparación homogénea con la cartera observada
    mddDiario: MaxDrawdown | null;                 // exacto, con todos los días
    diferenciaTirPuntos: number | null;            // cartera − benchmark (TIR anualizada, solo con ≥ 1 año)
    diferenciaValor: number;                       // valor hoy de la cartera − valor hipotético del benchmark con tus flujos
  };
}

export function calcularDesempeno(p: {
  puntos: PuntoValor[]; flujos: FlujoFechado[]; valorActual: number; hoy: string;
  serieSp: PuntoSp[] | null; ordenes: OrdenCosto[];
}): Desempeno {
  const puntos = p.puntos.filter(x => x.fecha <= p.hoy);
  const calidad = calidadSerie(puntos);
  const { serie, anomalias } = indiceTwr(puntos, p.flujos);
  const twrAc = twrAcumulado(serie);
  const diasPer = calidad.diasCubiertos;
  const costos = resumenCostos(p.ordenes);

  // TIR money-weighted desde el primer flujo, con el valor de hoy. Solo se anualiza con ≥ 1 año de historia.
  // VENTANA ÚNICA de medición: desde el primer valor diario registrado. Ese valor es el capital inicial (un flujo de entrada ese día) y
  // solo cuentan los aportes/retiros POSTERIORES. Así rentabilidad, TIR, benchmark y máxima caída miden exactamente el mismo
  // período; antes la TIR y el índice partían del primer aporte (importado de la planilla, sin valores diarios) y el acumulado del
  // primer snapshot, y las cifras se contradecían.
  const validos = puntos.filter(x => x && !Number.isNaN(Date.parse(x.fecha)) && x.valor > 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const flujosVentana: FlujoFechado[] = validos.length
    ? [{ fecha: validos[0].fecha, monto: validos[0].valor }, ...p.flujos.filter(f => f.fecha > validos[0].fecha && f.monto !== 0)]
    : p.flujos;
  const fl = flujosVentana.filter(f => f.fecha <= p.hoy && f.monto !== 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const invertido = fl.filter(f => f.monto > 0).reduce((s, f) => s + f.monto, 0);
  const retirado = -fl.filter(f => f.monto < 0).reduce((s, f) => s + f.monto, 0);
  const diasFlujos = fl.length ? dias(fl[0].fecha, p.hoy) : 0;
  const flows = (valorFinal: number): CashFlow[] => [...fl.map(f => ({ date: f.fecha, amount: -f.monto })), { date: p.hoy, amount: valorFinal }];
  const anualOk = diasFlujos >= MIN_DIAS_ANUALIZAR;
  const tirBruta = anualOk && fl.length ? xirr(flows(p.valorActual)) : null;
  // Neta de costos: la parte de las comisiones en pesos con tipo de cambio registrado NO está reflejada en el valor (se pagó de una
  // cuenta en pesos que la app no lleva) → se resta. Las comisiones en USD ya salieron de la Liquidez; las que no tienen tipo de
  // cambio quedan fuera y se informan aparte.
  const tirNeta = anualOk && fl.length ? xirr(flows(p.valorActual - costos.comisionArsConvertidaUsd)) : null;
  const acumulada = invertido > 0 ? (p.valorActual + retirado - invertido) / invertido : null;

  const mddCartera = maxDrawdown(serie);
  let benchmark: Desempeno['benchmark'] = null;
  const desde = calidad.desde, hasta = calidad.hasta;
  if (p.serieSp?.length && desde && hasta) {
    const mf = benchmarkConMismosFlujos(p.serieSp, flujosVentana, p.hoy);
    if (mf) {
      const fechasSnap = serie.map(s => s.fecha);
      const pxIni = cierreAl(p.serieSp, desde), pxFin = cierreAl(p.serieSp, hasta);
      benchmark = {
        mismosFlujos: mf,
        twrBenchmark: pxIni && pxFin ? pxFin / pxIni - 1 : null,
        mddEnMismasFechas: maxDrawdown(indiceBenchmark(p.serieSp, desde, hasta, fechasSnap)),
        mddDiario: maxDrawdown(indiceBenchmark(p.serieSp, desde, hasta)),
        diferenciaTirPuntos: tirBruta != null && mf.tir != null ? tirBruta - mf.tir : null,
        diferenciaValor: p.valorActual - mf.valorFinal,
      };
    }
  }

  return {
    periodo: { desde, hasta, dias: diasPer, menorAUnAnio: diasPer < MIN_DIAS_ANUALIZAR },
    calidad,
    twr: { acumulado: twrAc, anualizado: anualizar(twrAc, diasPer), anomalias },
    tir: { anualizada: tirBruta, acumulada, neta: costos.comisionArsConvertidaUsd > 0 ? tirNeta : tirBruta, invertido, retirado },
    costos,
    cartera: { mdd: mddCartera, rotuloMinimoConocido: !calidad.confiable },
    benchmark,
  };
}
