// =============================================================================
// Cálculo agregado de la cartera de renta fija: por bono (capital, TIR, duración, rating) y en
// conjunto (promedios ponderados, concentración, distribución por calidad crediticia). Puro y
// testeado — compartido por BonosPage (tabla + gráfico) y el resumen del Dashboard, así nunca
// muestran números distintos del mismo bono (mismo criterio que engine/rebalance.ts + useRadarTicker
// para el resto de la app).
// =============================================================================

import { ytm, bondDuration, rendimientoCorriente } from './coupons';
import { clasificarRating, type GradoCredito, type EscalaRating } from './rating';
import type { Alerta } from './alertas';
import type { Posicion } from '../types/domain';

// Umbrales de alerta — compartidos entre BonosPage y el resumen del Dashboard para que nunca
// muestren un criterio distinto de "esto necesita tu atención".
export const CONCENTRACION_POSICION_ALERTA = 0.40;  // un solo ticker concentra esto o más del capital en bonos
export const ESPECULATIVO_ALERTA = 0.40;            // % del capital en bonos "especulativo" a partir del cual avisar

export interface BonoCalc {
  pos: Posicion;
  px: number | null;           // precio por nominal (data912/100)
  paridad: number | null;      // en %
  capital: number;             // costo (precio_compra × cantidad)
  mkt: number | null;          // valor de mercado (null si no hay cotización)
  res: number | null;          // resultado (mkt − capital)
  cuponOk: boolean;
  tir: number | null;          // YTM
  duracion: { macaulay: number; modified: number } | null;
  rendCorriente: number | null;   // cupón / precio (ignora pull-to-par, a diferencia de la YTM)
  grado: GradoCredito | null;     // null = sin calificar, o calificadora 'Otra' (notación desconocida)
  escalaGrado: EscalaRating | null;   // a qué escala corresponde `grado` — global o nacional (Arg.)
  capitalUsado: number;        // mkt si hay cotización, si no cae al costo
  valorResidual: number;       // fracción 0..1 usada en TIR/duración/rend. corriente (1 = bullet)
}

// Un solo bono: capital, mercado, TIR, duración, rendimiento corriente y clasificación de rating.
// `mkt`/`paridad`/`capital` NUNCA se ajustan por valor residual: si hay cotización de mercado, el
// precio ya refleja lo que vale el bono hoy (por definición) — ajustarlo de nuevo con un % cargado a
// mano sería corregir dos veces (o mal) algo que el mercado ya resolvió. `valorResidual` solo corrige
// TIR/duración/rendimiento corriente, donde SIEMPRE es correcto sin importar de dónde salió el precio
// (ver el comentario de ytm() en engine/coupons.ts).
export function calcularBono(pos: Posicion, px: number | null, hoy: string): BonoCalc {
  const paridad = px != null ? px * 100 : null;
  const capital = pos.precio_compra * pos.cantidad;
  const mkt = px != null ? px * pos.cantidad : null;
  const res = mkt != null ? mkt - capital : null;
  const cuponOk = pos.cupon_tasa != null && pos.cupon_frecuencia != null && pos.cupon_mes != null;
  const valorResidual = pos.amortizable && pos.valor_residual != null ? pos.valor_residual : 1;
  // TIR al vencimiento sobre el precio de MERCADO (si no hay, sobre el costo).
  const precioNominal = px ?? (pos.precio_compra > 0 ? pos.precio_compra : null);
  const tir = precioNominal != null && pos.cupon_tasa != null && pos.cupon_frecuencia != null && pos.vencimiento
    ? ytm({ precio: precioNominal, tasaAnual: pos.cupon_tasa, frecuencia: pos.cupon_frecuencia, vencimiento: pos.vencimiento, hoy, valorResidual })
    : null;
  // Duración: se descuenta a la MISMA TIR de arriba (consistencia, ver engine/coupons.ts).
  const duracion = tir != null && pos.cupon_tasa != null && pos.cupon_frecuencia != null && pos.vencimiento
    ? bondDuration({ tasaAnual: pos.cupon_tasa, frecuencia: pos.cupon_frecuencia, vencimiento: pos.vencimiento, hoy, ytmAnual: tir, valorResidual })
    : null;
  const rendCorriente = precioNominal != null && pos.cupon_tasa != null
    ? rendimientoCorriente(pos.cupon_tasa, precioNominal, valorResidual)
    : null;
  const clasif = clasificarRating(pos.calificadora, pos.calificacion);
  return {
    pos, px, paridad, capital, mkt, res, cuponOk, tir, duracion, rendCorriente,
    grado: clasif?.grado ?? null, escalaGrado: clasif?.escala ?? null,
    capitalUsado: mkt ?? capital, valorResidual,
  };
}

export interface ResumenBonos {
  totalCapital: number;
  totalMkt: number;
  duracionPromedio: number | null;
  tirPromedio: number | null;
  rendCorrientePromedio: number | null;
  spreadPromedio: number | null;      // TIR − tasa libre de riesgo, ponderado por capital
  // Concentración por POSICIÓN (ticker), no por emisor real: varias series del mismo emisor (ej.
  // AL30/AL35/GD30 son todos deuda soberana argentina) cuentan aparte — no hay un campo de emisor
  // separado del ticker en el schema, así que agrupar de verdad requeriría cargarlo a mano.
  mayorPosicion: { ticker: string; pct: number } | null;
  // Fracciones (0..1) del capital total en bonos por calidad crediticia — suman 1 si totalMkt > 0.
  distribucionGrado: { gradoInversion: number; especulativo: number; default: number; sinCalificar: number };
  // Fracciones (0..1) del capital total en bonos por ley aplicable — mismo criterio que
  // distribucionGrado, sobre `pos.ley` (cargado a mano, ver types/domain.ts). Suman 1 si totalMkt > 0.
  distribucionLey: { local: number; extranjera: number; sinClasificar: number };
  // Bonos con cupón o vencimiento sin cargar (no se les puede estimar TIR ni duración) — distinto
  // de un bono YA VENCIDO (ese sí tiene los datos completos, simplemente no tiene TIR futura).
  bonosSinDatos: number;
  // Marcados amortizable=true pero sin valor_residual cargado — se están tratando como bullet
  // (100%) por defecto, lo que puede sobre/subestimar bastante su TIR real (ver engine/coupons.ts).
  bonosAmortizablesSinVR: number;
}

// Promedio ponderado por capitalUsado de `sel(b)` sobre los bonos donde `sel(b)` no es null.
function promedioPonderado(bonos: BonoCalc[], sel: (b: BonoCalc) => number | null): number | null {
  const con = bonos.filter(b => sel(b) != null && b.capitalUsado > 0);
  const capital = con.reduce((s, b) => s + b.capitalUsado, 0);
  if (capital <= 0) return null;
  return con.reduce((s, b) => s + sel(b)! * b.capitalUsado, 0) / capital;
}

export function resumenBonos(bonosCalc: BonoCalc[], riskFree?: number | null): ResumenBonos {
  const totalCapital = bonosCalc.reduce((s, b) => s + b.capital, 0);
  const totalMkt = bonosCalc.reduce((s, b) => s + b.capitalUsado, 0);

  const duracionPromedio = promedioPonderado(bonosCalc, b => b.duracion?.macaulay ?? null);
  const tirPromedio = promedioPonderado(bonosCalc, b => b.tir);
  const rendCorrientePromedio = promedioPonderado(bonosCalc, b => b.rendCorriente);
  const spreadPromedio = riskFree != null ? promedioPonderado(bonosCalc, b => b.tir != null ? b.tir - riskFree : null) : null;

  const mayorPosicion = totalMkt > 0 && bonosCalc.length > 0
    ? bonosCalc.reduce((max, b) => b.capitalUsado > max.capitalUsado ? b : max, bonosCalc[0])
    : null;

  const sumGrado = (g: GradoCredito) => bonosCalc.filter(b => b.grado === g).reduce((s, b) => s + b.capitalUsado, 0);
  const capGradoInversion = sumGrado('grado_inversion');
  const capEspeculativo = sumGrado('especulativo');
  const capDefault = sumGrado('default');
  const capSinCalificar = totalMkt - capGradoInversion - capEspeculativo - capDefault;

  const sumLey = (l: 'local' | 'extranjera') => bonosCalc.filter(b => b.pos.ley === l).reduce((s, b) => s + b.capitalUsado, 0);
  const capLeyLocal = sumLey('local');
  const capLeyExtranjera = sumLey('extranjera');
  const capLeySinClasificar = totalMkt - capLeyLocal - capLeyExtranjera;

  const bonosSinDatos = bonosCalc.filter(b => !b.cuponOk || !b.pos.vencimiento).length;
  const bonosAmortizablesSinVR = bonosCalc.filter(b => b.pos.amortizable && b.pos.valor_residual == null).length;

  return {
    totalCapital, totalMkt, duracionPromedio, tirPromedio, rendCorrientePromedio, spreadPromedio,
    mayorPosicion: mayorPosicion && totalMkt > 0 ? { ticker: mayorPosicion.pos.ticker, pct: mayorPosicion.capitalUsado / totalMkt } : null,
    distribucionGrado: totalMkt > 0
      ? { gradoInversion: capGradoInversion / totalMkt, especulativo: capEspeculativo / totalMkt, default: capDefault / totalMkt, sinCalificar: capSinCalificar / totalMkt }
      : { gradoInversion: 0, especulativo: 0, default: 0, sinCalificar: 0 },
    distribucionLey: totalMkt > 0
      ? { local: capLeyLocal / totalMkt, extranjera: capLeyExtranjera / totalMkt, sinClasificar: capLeySinClasificar / totalMkt }
      : { local: 0, extranjera: 0, sinClasificar: 0 },
    bonosSinDatos, bonosAmortizablesSinVR,
  };
}

// Alertas de riesgo/calidad de datos sobre la cartera de bonos — mismos umbrales que ya coloreaban
// los Stats de BonosPage, ahora en un único lugar para que BonosPage y el resumen del Dashboard
// muestren EXACTAMENTE la misma lista. `minGradoInversionPct`, `maxDuracionAnios` y
// `minLeyExtranjeraPct` son umbrales PERSONALES del usuario (no una constante fija del motor, a
// diferencia de los de arriba) — se piden como parámetro obligatorio, y quien llama los trae de
// useObjetivoDuracion (localStorage por portfolio).
export function alertasBonos(r: ResumenBonos, minGradoInversionPct: number, maxDuracionAnios: number, minLeyExtranjeraPct: number): Alerta[] {
  const alertas: Alerta[] = [];

  if (r.mayorPosicion && r.mayorPosicion.pct >= CONCENTRACION_POSICION_ALERTA) {
    alertas.push({ severidad: 'warn', texto: `${r.mayorPosicion.ticker} concentra ${Math.round(r.mayorPosicion.pct * 100)}% del capital en bonos — un solo ticker por encima del ${Math.round(CONCENTRACION_POSICION_ALERTA * 100)}%.` });
  }

  if (r.distribucionGrado.default > 0) {
    alertas.push({ severidad: 'neg', texto: `${Math.round(r.distribucionGrado.default * 100)}% del capital en bonos está calificado en DEFAULT.` });
  }

  if (r.distribucionGrado.especulativo >= ESPECULATIVO_ALERTA) {
    alertas.push({ severidad: 'warn', texto: `${Math.round(r.distribucionGrado.especulativo * 100)}% del capital en bonos es especulativo (por debajo de grado de inversión, dentro de su escala).` });
  }

  if (r.totalMkt > 0 && r.distribucionGrado.gradoInversion * 100 < minGradoInversionPct) {
    alertas.push({ severidad: 'warn', texto: `Solo ${Math.round(r.distribucionGrado.gradoInversion * 100)}% del capital en bonos está en grado de inversión — por debajo de tu mínimo personal de ${minGradoInversionPct}%.` });
  }

  if (r.duracionPromedio != null && r.duracionPromedio > maxDuracionAnios) {
    alertas.push({ severidad: 'warn', texto: `Duración promedio de ${r.duracionPromedio.toFixed(1)} años — por encima de tu máximo personal de ${maxDuracionAnios} años (mayor sensibilidad a suba de tasas).` });
  }

  // Umbral MÍNIMO (no máximo): ley extranjera es la opción más segura (jurisdicción de cobro fuera
  // de Argentina) pero rinde menos que ley local — se avisa si te quedaste con MUY POCA cobertura
  // "segura" para el balance riesgo/rendimiento que buscás, no si tenés demasiada.
  if (r.totalMkt > 0 && r.distribucionLey.extranjera * 100 < minLeyExtranjeraPct) {
    alertas.push({ severidad: 'warn', texto: `Solo ${Math.round(r.distribucionLey.extranjera * 100)}% del capital en bonos está bajo ley extranjera (más segura) — por debajo de tu mínimo personal de ${minLeyExtranjeraPct}%.` });
  }

  if (r.spreadPromedio != null && r.spreadPromedio < 0) {
    alertas.push({ severidad: 'neg', texto: `La TIR promedio de tus bonos está por debajo de la tasa libre de riesgo (spread ${Math.round(r.spreadPromedio * 100)}%) — el mercado no te está pagando prima por este riesgo.` });
  }

  if (r.bonosSinDatos > 0) {
    alertas.push({ severidad: 'warn', texto: `${r.bonosSinDatos} bono${r.bonosSinDatos > 1 ? 's' : ''} sin cupón o vencimiento cargado — no se puede estimar su TIR ni duración.` });
  }

  if (r.bonosAmortizablesSinVR > 0) {
    alertas.push({ severidad: 'warn', texto: `${r.bonosAmortizablesSinVR} bono${r.bonosAmortizablesSinVR > 1 ? 's' : ''} marcado${r.bonosAmortizablesSinVR > 1 ? 's' : ''} amortizable sin valor residual cargado — se está calculando su TIR y duración como si fuera bullet (100% del capital al vencimiento).` });
  }

  return alertas;
}
