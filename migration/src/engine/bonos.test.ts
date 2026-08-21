import { describe, it, expect } from 'vitest';
import { calcularBono, resumenBonos, alertasBonos, type BonoCalc } from './bonos';
import type { Posicion } from '../types/domain';

const basePos: Posicion = {
  id: '1', portfolio_id: 'p', tipo: 'bono', ticker: 'GD30', empresa: null, sector: null, rol: null,
  cantidad: 1000, precio_compra: 0.5, fecha_compra: '2024-01-01', peso_objetivo: null, ratio_cedear: null,
  tir_esperada: null, beta: null, cupon_tasa: 0.08, cupon_frecuencia: 2, cupon_mes: 1, vencimiento: '2031-07-24',
  calificadora: null, calificacion: null, ley: null, amortizable: false, valor_residual: null, notas: null, created_at: '2024-01-01',
};
const HOY = '2026-07-24';

describe('calcularBono', () => {
  it('sin cotización: capitalUsado cae al costo', () => {
    const b = calcularBono(basePos, null, HOY);
    expect(b.mkt).toBeNull();
    expect(b.capital).toBe(500);
    expect(b.capitalUsado).toBe(500);
  });

  it('con cotización: capitalUsado usa el valor de mercado', () => {
    const b = calcularBono(basePos, 0.6, HOY);
    expect(b.mkt).toBe(600);
    expect(b.capitalUsado).toBe(600);
    expect(b.paridad).toBe(60);
  });

  it('calcula TIR, duración y rendimiento corriente cuando hay cupón + vencimiento', () => {
    const b = calcularBono(basePos, 0.6, HOY);
    expect(b.tir).not.toBeNull();
    expect(b.duracion).not.toBeNull();
    expect(b.rendCorriente).toBeCloseTo(0.08 / 0.6, 6);
  });

  it('clasifica el grado a partir de calificadora + calificación (escala global)', () => {
    const b = calcularBono({ ...basePos, calificadora: 'S&P', calificacion: 'BB-' }, 0.6, HOY);
    expect(b.grado).toBe('especulativo');
    expect(b.escalaGrado).toBe('global');
  });

  it('calificadora de escala nacional (FIX SCR): clasifica igual, marcando escala "local"', () => {
    const b = calcularBono({ ...basePos, calificadora: 'FIX SCR', calificacion: 'AAA(arg)' }, 0.6, HOY);
    expect(b.grado).toBe('grado_inversion');
    expect(b.escalaGrado).toBe('local');
  });

  it('sin calificar → grado y escalaGrado null', () => {
    const b = calcularBono(basePos, 0.6, HOY);
    expect(b.grado).toBeNull();
    expect(b.escalaGrado).toBeNull();
  });

  describe('amortizable / valor_residual', () => {
    it('bullet (amortizable: false): valorResidual siempre 1, aunque haya un valor_residual cargado por error', () => {
      const b = calcularBono({ ...basePos, amortizable: false, valor_residual: 0.5 }, 0.6, HOY);
      expect(b.valorResidual).toBe(1);
    });

    it('amortizable sin valor_residual cargado: se trata como 1 (bullet) por defecto, no revienta', () => {
      const b = calcularBono({ ...basePos, amortizable: true, valor_residual: null }, 0.6, HOY);
      expect(b.valorResidual).toBe(1);
    });

    it('amortizable con valor_residual cargado: se usa para TIR/duración/rendimiento corriente', () => {
      const bullet = calcularBono({ ...basePos, amortizable: false, valor_residual: null }, 0.6, HOY);
      const amort = calcularBono({ ...basePos, amortizable: true, valor_residual: 0.5 }, 0.6, HOY);
      expect(amort.valorResidual).toBe(0.5);
      // A mismo precio, cobrar menos capital real (mitad) da una TIR menor que asumir el 100%.
      expect(amort.tir!).toBeLessThan(bullet.tir!);
      expect(amort.rendCorriente).toBeCloseTo(bullet.rendCorriente! * 0.5, 6);
    });

    it('valor_residual NUNCA ajusta paridad/mkt/capital — el precio de mercado ya refleja el valor real', () => {
      const bullet = calcularBono({ ...basePos, amortizable: false, valor_residual: null }, 0.6, HOY);
      const amort = calcularBono({ ...basePos, amortizable: true, valor_residual: 0.5 }, 0.6, HOY);
      expect(amort.paridad).toBe(bullet.paridad);
      expect(amort.mkt).toBe(bullet.mkt);
      expect(amort.capital).toBe(bullet.capital);
    });
  });
});

describe('resumenBonos — agregados', () => {
  const a = calcularBono({ ...basePos, ticker: 'GD30', calificadora: 'S&P', calificacion: 'B' }, 0.6, HOY);          // capitalUsado 600, especulativo
  const b = calcularBono({ ...basePos, ticker: 'AL30', cantidad: 2000, calificadora: 'S&P', calificacion: 'BBB' }, 0.5, HOY); // capitalUsado 1000, grado inversión
  const c = calcularBono({ ...basePos, ticker: 'GNCXO', cantidad: 500, calificadora: null, calificacion: null }, 1.0, HOY);   // capitalUsado 500, sin calificar

  it('totalCapital y totalMkt suman todos los bonos', () => {
    const r = resumenBonos([a, b, c]);
    expect(r.totalMkt).toBeCloseTo(600 + 1000 + 500, 6);
  });

  it('duracionPromedio y tirPromedio son ponderados por capitalUsado (no simples)', () => {
    const r = resumenBonos([a, b, c]);
    // ponderado: entre el promedio simple y el valor del bono de mayor peso (b, 1000 de 2100)
    const simple = ((a.tir ?? 0) + (b.tir ?? 0) + (c.tir ?? 0)) / 3;
    expect(r.tirPromedio).not.toBeNull();
    expect(r.tirPromedio).not.toBeCloseTo(simple, 4); // confirma que NO es el promedio simple
  });

  it('mayorPosicion es el de mayor capitalUsado, con su % correcto', () => {
    const r = resumenBonos([a, b, c]);
    expect(r.mayorPosicion?.ticker).toBe('AL30');
    expect(r.mayorPosicion?.pct).toBeCloseTo(1000 / 2100, 6);
  });

  it('distribucionGrado suma 1 (o 0 si no hay capital) y refleja la clasificación real', () => {
    const r = resumenBonos([a, b, c]);
    const suma = r.distribucionGrado.gradoInversion + r.distribucionGrado.especulativo + r.distribucionGrado.default + r.distribucionGrado.sinCalificar;
    expect(suma).toBeCloseTo(1, 6);
    expect(r.distribucionGrado.gradoInversion).toBeCloseTo(1000 / 2100, 6);  // b
    expect(r.distribucionGrado.especulativo).toBeCloseTo(600 / 2100, 6);     // a
    expect(r.distribucionGrado.sinCalificar).toBeCloseTo(500 / 2100, 6);     // c
  });

  it('distribucionLey suma 1 (o 0 si no hay capital) y refleja `ley` de cada posición', () => {
    const conLey = [
      calcularBono({ ...basePos, ticker: 'AL30', ley: 'local' }, 0.6, HOY),        // capitalUsado 600
      calcularBono({ ...basePos, ticker: 'GD30', cantidad: 2000, ley: 'extranjera' }, 0.5, HOY), // capitalUsado 1000
      calcularBono({ ...basePos, ticker: 'XXX', cantidad: 500, ley: null }, 1.0, HOY),  // capitalUsado 500
    ];
    const r = resumenBonos(conLey);
    const suma = r.distribucionLey.local + r.distribucionLey.extranjera + r.distribucionLey.sinClasificar;
    expect(suma).toBeCloseTo(1, 6);
    expect(r.distribucionLey.local).toBeCloseTo(600 / 2100, 6);
    expect(r.distribucionLey.extranjera).toBeCloseTo(1000 / 2100, 6);
    expect(r.distribucionLey.sinClasificar).toBeCloseTo(500 / 2100, 6);
  });

  it('cartera vacía: distribucionLey en 0, no divide por cero', () => {
    const r = resumenBonos([]);
    expect(r.distribucionLey).toEqual({ local: 0, extranjera: 0, sinClasificar: 0 });
  });

  it('spreadPromedio: null si no se pasa risk-free; calculado si se pasa', () => {
    const sinRf = resumenBonos([a, b, c]);
    expect(sinRf.spreadPromedio).toBeNull();
    const conRf = resumenBonos([a, b, c], 0.04);
    expect(conRf.spreadPromedio).not.toBeNull();
    expect(conRf.spreadPromedio).toBeCloseTo((sinRf.tirPromedio ?? 0) - 0.04, 4);
  });

  it('cartera vacía: no divide por cero, todo en null/0', () => {
    const r = resumenBonos([]);
    expect(r.totalMkt).toBe(0);
    expect(r.tirPromedio).toBeNull();
    expect(r.mayorPosicion).toBeNull();
    expect(r.distribucionGrado).toEqual({ gradoInversion: 0, especulativo: 0, default: 0, sinCalificar: 0 });
  });

  it('bonosSinDatos cuenta los que no tienen cupón o vencimiento completo (no los ya vencidos)', () => {
    const incompleto = calcularBono({ ...basePos, ticker: 'XXX', cupon_tasa: null }, 0.6, HOY);
    const completo = calcularBono({ ...basePos, ticker: 'YYY' }, 0.6, HOY);
    const r = resumenBonos([incompleto, completo]);
    expect(r.bonosSinDatos).toBe(1);
  });

  it('bonosAmortizablesSinVR cuenta los marcados amortizable sin valor_residual cargado (no los que ya lo tienen, ni los bullet)', () => {
    const sinVR = calcularBono({ ...basePos, ticker: 'XXX', amortizable: true, valor_residual: null }, 0.6, HOY);
    const conVR = calcularBono({ ...basePos, ticker: 'YYY', amortizable: true, valor_residual: 0.7 }, 0.6, HOY);
    const bullet = calcularBono({ ...basePos, ticker: 'ZZZ', amortizable: false, valor_residual: null }, 0.6, HOY);
    const r = resumenBonos([sinVR, conVR, bullet]);
    expect(r.bonosAmortizablesSinVR).toBe(1);
  });
});

describe('alertasBonos', () => {
  const conRating = (ticker: string, cantidad: number, calificadora: string | null, calificacion: string | null) =>
    calcularBono({ ...basePos, ticker, cantidad, calificadora, calificacion }, 1, HOY); // precio=1 -> capitalUsado = cantidad
  // Umbrales personales por defecto usados en la mayoría de los tests (50% mínimo grado inversión,
  // 100 años máximo de duración = prácticamente deshabilitado) — los tests que apuntan a estas 2
  // condiciones pasan umbrales ajustados explícitos.
  const MIN_GRADO = 50, MAX_DURACION = 100;

  it('cartera balanceada, sin bonos especulativos/default, duración corta: sin alertas', () => {
    // 3 posiciones parejas (~33% c/u) para que ninguna sola pase el umbral de concentración (40%).
    const a = conRating('AL30', 340, 'S&P', 'AAA');
    const b = conRating('GD30', 330, 'S&P', 'AAA');
    const c = conRating('AL35', 330, 'S&P', 'AAA');
    const r = resumenBonos([a, b, c]);
    expect(alertasBonos(r, MIN_GRADO, MAX_DURACION)).toHaveLength(0);
  });

  it('mayor posición ≥40%: alerta warn', () => {
    const dominante = conRating('AL30', 500, 'S&P', 'AAA');
    const resto = conRating('GD30', 500, 'S&P', 'AAA');
    const r = resumenBonos([dominante, resto]);
    expect(alertasBonos(r, MIN_GRADO, MAX_DURACION).some(a => a.severidad === 'warn' && a.texto.includes('AL30'))).toBe(true);
  });

  it('capital en default: alerta neg (severidad alta)', () => {
    const enDefault = conRating('DEF1', 100, 'S&P', 'D');
    const r = resumenBonos([enDefault]);
    const alertas = alertasBonos(r, MIN_GRADO, MAX_DURACION);
    expect(alertas.some(a => a.severidad === 'neg' && a.texto.includes('DEFAULT'))).toBe(true);
  });

  it('≥40% especulativo: alerta warn', () => {
    const especulativo = conRating('SPEC', 500, 'S&P', 'BB');
    const inversionGrade = conRating('SAFE', 500, 'S&P', 'AAA');
    const r = resumenBonos([especulativo, inversionGrade]);
    expect(alertasBonos(r, MIN_GRADO, MAX_DURACION).some(a => a.texto.includes('especulativo'))).toBe(true);
  });

  it('grado de inversión por debajo del mínimo personal: alerta warn', () => {
    // Se usa "sin calificar" (no "especulativo") para el resto del capital, para aislar la
    // condición nueva: baja gradoInversion sin disparar además la alerta de "especulativo".
    const inversionGrade = conRating('SAFE', 400, 'S&P', 'AAA');
    const sinCalificar = conRating('N1', 600, null, null);
    const r = resumenBonos([inversionGrade, sinCalificar]); // gradoInversion = 40%
    const alertas = alertasBonos(r, 60, MAX_DURACION); // mínimo personal 60% > 40% real
    expect(alertas.some(a => a.severidad === 'warn' && a.texto.includes('grado de inversión') && a.texto.includes('mínimo personal'))).toBe(true);
    // con un mínimo personal más laxo (30%), la misma cartera no alerta por este motivo
    expect(alertasBonos(r, 30, MAX_DURACION).some(a => a.texto.includes('mínimo personal'))).toBe(false);
  });

  it('duración promedio por encima del máximo personal: alerta warn', () => {
    const b = calcularBono({ ...basePos, ticker: 'LARGO', vencimiento: '2040-07-24' }, 1, HOY); // duración larga
    const r = resumenBonos([b]);
    expect(r.duracionPromedio).not.toBeNull();
    const alertas = alertasBonos(r, MIN_GRADO, 2); // máximo personal 2 años, muy por debajo de la duración real
    expect(alertas.some(a => a.severidad === 'warn' && a.texto.includes('Duración promedio') && a.texto.includes('máximo personal'))).toBe(true);
    // con un máximo personal generoso (100 años), la misma cartera no alerta por este motivo
    expect(alertasBonos(r, MIN_GRADO, 100).some(a => a.texto.includes('máximo personal'))).toBe(false);
  });

  it('spread negativo (TIR < tasa libre de riesgo): alerta neg', () => {
    const b = conRating('AL30', 500, 'S&P', 'AAA');
    const r = resumenBonos([b], 10); // risk-free 10% (absurdamente alto a propósito, fuerza spread negativo)
    expect(alertasBonos(r, MIN_GRADO, MAX_DURACION).some(a => a.severidad === 'neg' && a.texto.includes('spread'))).toBe(true);
  });

  it('bonos sin datos: alerta warn', () => {
    const incompleto = calcularBono({ ...basePos, ticker: 'XXX', cupon_tasa: null }, 0.6, HOY);
    const r = resumenBonos([incompleto]);
    expect(alertasBonos(r, MIN_GRADO, MAX_DURACION).some(a => a.texto.includes('sin cupón o vencimiento'))).toBe(true);
  });

  it('bono marcado amortizable sin valor residual cargado: alerta warn', () => {
    const sinVR = calcularBono({ ...basePos, ticker: 'XXX', amortizable: true, valor_residual: null }, 0.6, HOY);
    const r = resumenBonos([sinVR]);
    expect(alertasBonos(r, MIN_GRADO, MAX_DURACION).some(a => a.texto.includes('amortizable') && a.texto.includes('valor residual'))).toBe(true);
  });

  it('bono amortizable CON valor residual cargado: no dispara esa alerta', () => {
    const conVR = calcularBono({ ...basePos, ticker: 'YYY', amortizable: true, valor_residual: 0.7 }, 0.6, HOY);
    const r = resumenBonos([conVR]);
    expect(alertasBonos(r, MIN_GRADO, MAX_DURACION).some(a => a.texto.includes('valor residual'))).toBe(false);
  });

  it('cartera vacía: sin alertas, no revienta', () => {
    expect(alertasBonos(resumenBonos([]), MIN_GRADO, MAX_DURACION)).toHaveLength(0);
  });
});
