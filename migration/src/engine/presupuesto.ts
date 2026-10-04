// =============================================================================
// Presupuesto vs real vs forecast actualizado, período a período (mensual). Puro y determinista.
//
//  - PRESUPUESTO: los supuestos del Forecast CONGELADOS en una fecha (valor inicial, aporte anual,
//    retorno, horizonte). Camino mensual: aporte = aporteAnual/12 al cierre de cada mes y retorno
//    mensual equivalente (1+r)^(1/12)−1. Ojo: como los aportes mensuales rinden dentro del año, el
//    cierre del mes 12 es levemente MAYOR que el del año 1 de la tabla anual de engine/projection.ts
//    (ahí el aporte entra al final del año, sin rendimiento).
//  - REAL: valor = último snapshot hasta el fin de cada mes (en el mes en curso, hasta hoy);
//    aporte = flujos firmados (retiro < 0) del mes.
//  - DESVÍO exacto en dos efectos. Como valor_k = inicial + ΣAporte + ΣRendimiento (rend. = Δvalor −
//    aporte), el desvío acumulado = (ΣAporte real − ΣAporte ppto) + (ΣRend. real − ΣRend. ppto).
//    No hace falta conocer el valor del mes anterior, así que un mes sin snapshot no rompe la cuenta.
//  - FORECAST ACTUALIZADO: real hasta el último mes con dato y, hacia adelante, el retorno
//    presupuestado con el aporte presupuestado ('presupuesto') o el ritmo real promedio ('ritmo').
// =============================================================================

export const MESES_PRESUPUESTO = 12;

export interface Presupuesto {
  inicio: string;        // 'YYYY-MM' — primer mes del presupuesto (el valor inicial es al cierre del mes anterior)
  valorInicial: number;  // patrimonio de arranque (USD)
  aporteAnual: number;   // USD por año (se presupuesta A/12 por mes)
  tasaAnual: number;     // retorno esperado (0.08 = 8%)
  anios: number;         // horizonte total desde el inicio
  edadInicial: number;
  fijadoEn: string;      // 'YYYY-MM-DD' en que se congeló
}

export interface PuntoValor { fecha: string; valor: number }
export interface FlujoFirmado { fecha: string; monto: number }

export const tasaMensual = (tasaAnual: number): number => Math.pow(1 + tasaAnual, 1 / 12) - 1;

// ── fechas ('YYYY-MM' / 'YYYY-MM-DD'), sin Date locales para no depender de la zona horaria ─────────
export function sumarMeses(ym: string, k: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = (y * 12 + (m - 1)) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export function finDeMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
const inicioDeMes = (ym: string) => `${ym}-01`;

// ── presupuesto ──────────────────────────────────────────────────────────────────────────────────
export interface FilaPresupuesto { k: number; periodo: string; aporte: number; rendimiento: number; valor: number }

export function presupuestoMensual(b: Presupuesto, n = MESES_PRESUPUESTO): FilaPresupuesto[] {
  const rm = tasaMensual(b.tasaAnual), aporte = b.aporteAnual / 12;
  let valor = b.valorInicial;
  const rows: FilaPresupuesto[] = [];
  for (let k = 1; k <= n; k++) {
    const rendimiento = valor * rm;
    valor = valor + rendimiento + aporte;
    rows.push({ k, periodo: sumarMeses(b.inicio, k - 1), aporte, rendimiento, valor });
  }
  return rows;
}

// Valor al horizonte: sigue desde el cierre del mes 12 con años completos (aporte al final del año,
// misma convención que engine/projection.ts).
export function valorAlHorizonte(valorMes12: number, aporteAnual: number, tasaAnual: number, anios: number): number {
  let v = valorMes12;
  for (let y = 1; y < anios; y++) v = v * (1 + tasaAnual) + aporteAnual;
  return v;
}

// ── real ─────────────────────────────────────────────────────────────────────────────────────────
export interface FilaReal {
  k: number; periodo: string;
  futuro: boolean;          // el mes todavía no empezó
  parcial: boolean;         // mes en curso (valor y aporte "a la fecha")
  aporte: number | null;    // null si es futuro
  valor: number | null;     // null si es futuro o no hay ningún snapshot hasta esa fecha
  valorEstimado: boolean;   // el snapshot usado es de un mes anterior (no hubo registro en el mes)
  fraccion: number;         // parte del mes transcurrida: 1 en meses completos, (0,1) en el mes en curso, 0 si es futuro
}

export function realMensual(
  b: Presupuesto, puntos: PuntoValor[], flujos: FlujoFirmado[], hoy: string, n = MESES_PRESUPUESTO,
): FilaReal[] {
  const ordenados = [...puntos].sort((a, c) => a.fecha.localeCompare(c.fecha));
  const rows: FilaReal[] = [];
  for (let k = 1; k <= n; k++) {
    const periodo = sumarMeses(b.inicio, k - 1);
    const desde = inicioDeMes(periodo), finMes = finDeMes(periodo);
    if (desde > hoy) { rows.push({ k, periodo, futuro: true, parcial: false, aporte: null, valor: null, valorEstimado: false, fraccion: 0 }); continue; }
    const hasta = finMes < hoy ? finMes : hoy;
    let ultimo: PuntoValor | null = null;
    for (const p of ordenados) { if (p.fecha <= hasta) ultimo = p; else break; }
    const aporte = flujos.filter(f => f.fecha >= desde && f.fecha <= hasta).reduce((s, f) => s + f.monto, 0);
    rows.push({
      k, periodo, futuro: false, parcial: finMes > hoy,
      aporte, valor: ultimo ? ultimo.valor : null, valorEstimado: !!ultimo && ultimo.fecha < desde,
      fraccion: finMes > hoy ? Number(hoy.slice(8, 10)) / Number(finMes.slice(8, 10)) : 1,
    });
  }
  return rows;
}

// ── cruce presupuesto ↔ real ─────────────────────────────────────────────────────────────────────
export interface FilaCruce {
  k: number; periodo: string; parcial: boolean; valorEstimado: boolean;
  aportePpto: number; aporteReal: number | null;
  valorPpto: number; valorReal: number | null;
  desvio: number | null;          // valorReal − valorPpto
  desvioPct: number | null;       // sobre valorPpto
  desvioAportes: number | null;   // Σ(aporte real − ppto) hasta el período
  desvioMercado: number | null;   // desvio − desvioAportes (= Σ rend. real − Σ rend. ppto)
}

// El mes en curso es PARCIAL: su valor real es el de hoy, no el del fin de mes. Compararlo contra el
// presupuesto del fin de mes completo daba un desvío artificialmente negativo a principios de cada
// mes (aportes −1/12 del anual el día 4). Por eso, en ese mes, el presupuesto (valor y aporte) se
// PRORRATEA linealmente por la fracción transcurrida del mes: `valorInicial` es el punto de partida
// del mes 1 (sin él no se puede prorratear el primer mes y se compara contra el mes completo).
export function cruzar(ppto: FilaPresupuesto[], real: FilaReal[], valorInicial?: number): FilaCruce[] {
  let acumAporteReal = 0, acumAportePpto = 0;
  return ppto.map((p, i) => {
    const r = real[i];
    const f = r?.parcial && r.fraccion > 0 && r.fraccion < 1 ? r.fraccion : 1;
    const previo = i > 0 ? ppto[i - 1].valor : valorInicial;
    const valorPptoMes = f < 1 && previo != null ? previo + (p.valor - previo) * f : p.valor;
    const aportePptoMes = f < 1 && previo != null ? p.aporte * f : p.aporte;
    acumAportePpto += aportePptoMes;
    if (r && r.aporte != null) acumAporteReal += r.aporte;
    const tieneValor = !!r && r.valor != null;
    const desvio = tieneValor ? r.valor! - valorPptoMes : null;
    const desvioAportes = tieneValor ? acumAporteReal - acumAportePpto : null;
    return {
      k: p.k, periodo: p.periodo, parcial: !!r?.parcial, valorEstimado: !!r?.valorEstimado,
      aportePpto: aportePptoMes, aporteReal: r?.aporte ?? null,
      valorPpto: valorPptoMes, valorReal: tieneValor ? r.valor! : null,
      desvio,
      desvioPct: desvio != null && valorPptoMes !== 0 ? desvio / valorPptoMes : null,
      desvioAportes,
      desvioMercado: desvio != null && desvioAportes != null ? desvio - desvioAportes : null,
    };
  });
}

// ── forecast actualizado ─────────────────────────────────────────────────────────────────────────
export type ModoAportes = 'presupuesto' | 'ritmo';

export interface FilaForecast { k: number; periodo: string; valor: number; proyectado: boolean }
export interface Reproyeccion {
  ultimoRealK: number;            // último mes con dato real (base de la reproyección)
  aporteMensualUsado: number;
  meses: FilaForecast[];          // los n meses: real hasta ultimoRealK, proyectado después
  valorMes12: number;
  valorHorizonte: number;         // forecast actualizado al horizonte del presupuesto
  valorHorizontePpto: number;     // el que decía el presupuesto original
  difHorizonte: number;           // forecast − presupuesto
}

export function reproyectar(
  b: Presupuesto, ppto: FilaPresupuesto[], real: FilaReal[], modo: ModoAportes,
): Reproyeccion | null {
  let ult = -1;
  real.forEach((r, i) => { if (r.valor != null) ult = i; });
  if (ult < 0) return null;
  const n = ppto.length;
  // Meses efectivamente transcurridos: los completos + la FRACCIÓN del mes en curso (antes el mes
  // parcial contaba como entero y el ritmo se subestimaba: 1000 en 4 días de octubre daba 1000/mes,
  // y 0 aportes en lo que va del mes diluía el promedio). Con menos de 1 mes de historia el ritmo no
  // es confiable: se usa el presupuestado.
  const mesesTranscurridos = real.slice(0, ult + 1).reduce((s, r) => s + (r.parcial ? r.fraccion : 1), 0);
  const aporteRealAcum = real.slice(0, ult + 1).reduce((s, r) => s + (r.aporte ?? 0), 0);
  const aporteMensual = modo === 'ritmo' && mesesTranscurridos >= 1 ? aporteRealAcum / mesesTranscurridos : b.aporteAnual / 12;
  const rm = tasaMensual(b.tasaAnual);

  const out: FilaForecast[] = [];
  let valor = real[ult].valor!;
  for (let i = 0; i < n; i++) {
    if (i < ult || (i === ult && !real[ult].parcial)) { out.push({ k: i + 1, periodo: ppto[i].periodo, valor: real[i].valor ?? b.valorInicial, proyectado: false }); continue; }
    if (i === ult) {
      // Mes en curso: el valor real es el de HOY; el cierre del mes se proyecta con lo que falta del mes
      // (si no, el forecast perdía el resto del retorno y del aporte de este mes).
      const resto = 1 - real[ult].fraccion;
      valor = valor * Math.pow(1 + rm, resto) + aporteMensual * resto;
      out.push({ k: i + 1, periodo: ppto[i].periodo, valor, proyectado: true });
      continue;
    }
    valor = valor * (1 + rm) + aporteMensual;
    out.push({ k: i + 1, periodo: ppto[i].periodo, valor, proyectado: true });
  }
  const valorMes12 = out[n - 1].valor;
  const valorHorizonte = valorAlHorizonte(valorMes12, aporteMensual * 12, b.tasaAnual, b.anios);
  const valorHorizontePpto = valorAlHorizonte(ppto[n - 1].valor, b.aporteAnual, b.tasaAnual, b.anios);
  return {
    ultimoRealK: ult + 1, aporteMensualUsado: aporteMensual, meses: out, valorMes12,
    valorHorizonte, valorHorizontePpto, difHorizonte: valorHorizonte - valorHorizontePpto,
  };
}

// ── objetivo de capital: ¿cuándo se llega? ──────────────────────────────────────────────────────
// Conecta el Forecast con la meta (portfolios.capital_objetivo): en qué mes/año el valor proyectado
// alcanza la meta, y qué tan sensible es eso al retorno. Misma convención que el resto del motor: los
// 12 primeros meses con aporte mensual y retorno mensual equivalente, después años completos con el
// aporte al final del año (valorAlHorizonte / engine/projection.ts).
export const MAX_ANIOS_META = 80;

export interface Llegada {
  meses: number | null;   // meses desde el inicio hasta alcanzar la meta (null = no llega dentro de MAX_ANIOS_META)
  anio: number | null;    // año calendario en que se alcanza
}

// `valoresMes` = valor proyectado al cierre de cada uno de los primeros meses (normalmente 12).
export function llegadaAMeta(inicio: string, valoresMes: number[], aporteAnual: number, tasaAnual: number, meta: number): Llegada {
  const sinLlegada: Llegada = { meses: null, anio: null };
  if (!(meta > 0) || valoresMes.length === 0 || !Number.isFinite(meta)) return sinLlegada;
  const [y0, m0] = inicio.split('-').map(Number);
  const aAnio = (meses: number) => Math.floor((y0 * 12 + (m0 - 1) + (meses - 1)) / 12);
  for (let i = 0; i < valoresMes.length; i++) {
    if (valoresMes[i] >= meta) return { meses: i + 1, anio: aAnio(i + 1) };
  }
  let v = valoresMes[valoresMes.length - 1];
  for (let k = 1; k <= MAX_ANIOS_META; k++) {
    v = v * (1 + tasaAnual) + aporteAnual;
    if (!Number.isFinite(v)) return sinLlegada;
    const meses = valoresMes.length + 12 * k;
    if (v >= meta) return { meses, anio: aAnio(meses) };
  }
  return sinLlegada;
}

export interface EscenarioMeta {
  delta: number;                 // variación del retorno en puntos (−0.02 = −2 pp)
  tasa: number;
  llegada: Llegada;
  valorHorizonte: number;        // valor al horizonte del presupuesto con esa tasa
  dentroDelHorizonte: boolean;   // la meta se alcanza antes de cumplirse `anios`
}
export interface AnalisisMeta {
  objetivo: number;
  yaAlcanzada: boolean;
  presupuesto: EscenarioMeta;    // con los supuestos tal cual (delta 0)
  sensibilidad: EscenarioMeta[]; // −2 pp, base, +2 pp
}

type SupuestosMeta = Pick<Presupuesto, 'inicio' | 'valorInicial' | 'aporteAnual' | 'tasaAnual' | 'anios'>;

function escenarioMeta(b: SupuestosMeta, meta: number, delta: number): EscenarioMeta {
  const tasa = b.tasaAnual + delta;
  const filas = presupuestoMensual({ ...b, tasaAnual: tasa } as Presupuesto);
  const llegada = llegadaAMeta(b.inicio, filas.map(f => f.valor), b.aporteAnual, tasa, meta);
  const valorHorizonte = valorAlHorizonte(filas[filas.length - 1].valor, b.aporteAnual, tasa, b.anios);
  return { delta, tasa, llegada, valorHorizonte, dentroDelHorizonte: llegada.meses != null && llegada.meses <= b.anios * 12 };
}

// Análisis de la meta a partir de unos supuestos (los del presupuesto fijado o, en la página, los de
// pantalla). `valorActual` decide si la meta ya se alcanzó.
export function analisisMeta(b: SupuestosMeta, meta: number, valorActual: number, delta = 0.02): AnalisisMeta | null {
  if (!(meta > 0) || !Number.isFinite(meta) || !(b.anios >= 1) || !(b.tasaAnual > -1 + delta)) return null;
  return {
    objetivo: meta,
    yaAlcanzada: valorActual >= meta,
    presupuesto: escenarioMeta(b, meta, 0),
    sensibilidad: [escenarioMeta(b, meta, -delta), escenarioMeta(b, meta, 0), escenarioMeta(b, meta, delta)],
  };
}

// ── resumen listo para mostrar (página Forecast y tarjeta del Inicio) ───────────────────────────
// Una sola función arma todo: así la tarjeta del Inicio y la página muestran EXACTAMENTE los mismos
// números (regla de oro #1: un solo cálculo, dos presentaciones).
export interface ResumenForecast {
  ppto: FilaPresupuesto[];
  cruce: FilaCruce[];
  ultimo: FilaCruce | null;        // último mes con dato real (base de los indicadores)
  repro: Reproyeccion | null;
  meta: AnalisisMeta | null;       // solo si se pasó una meta válida
  llegadaForecast: Llegada | null; // cuándo llega a la meta con el forecast ACTUALIZADO (null si no hay reproyección o meta)
}

export function calcularForecast(
  b: Presupuesto, puntos: PuntoValor[], flujos: FlujoFirmado[], hoy: string, modo: ModoAportes = 'presupuesto',
  meta: number | null = null,
): ResumenForecast {
  const ppto = presupuestoMensual(b);
  const real = realMensual(b, puntos, flujos, hoy);
  const cruce = cruzar(ppto, real, b.valorInicial);
  const ultimo = [...cruce].reverse().find(f => f.valorReal != null) ?? null;
  const repro = reproyectar(b, ppto, real, modo);
  const valorActual = ultimo?.valorReal ?? b.valorInicial;
  const analisis = meta != null ? analisisMeta(b, meta, valorActual) : null;
  const llegadaForecast = analisis && repro
    ? llegadaAMeta(b.inicio, repro.meses.map(m => m.valor), repro.aporteMensualUsado * 12, b.tasaAnual, analisis.objetivo)
    : null;
  return { ppto, cruce, ultimo, repro, meta: analisis, llegadaForecast };
}
