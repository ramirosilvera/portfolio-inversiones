import { describe, it, expect } from 'vitest';
import { calcularCostosCobro, estimarCostosCobro, netoEstimado, costosRegistrados, tasasPorDefecto, tasasParaCobro, TASA_RETENCION_EEUU, TASA_COMISION_DEPOSITARIA, TASA_IOL_COMISION_DIVIDENDO, TASA_IOL_COMISION_INTERES } from './costosCobros';

const IOL_DIV = { retencion: TASA_RETENCION_EEUU, depositaria: TASA_COMISION_DEPOSITARIA, comision: TASA_IOL_COMISION_DIVIDENDO };

describe('estimarCostosCobro', () => {
  it('con las tasas de IOL reproduce lo que acreditó IOL (retención 30 % + depositario 5,5 % + comisión 0,72 %)', () => {
    // UNH: bruto 3,09 → IOL acreditó 2,00 (64,7 %); MSFT: 2,21 → 1,43; MA: 1,27 → 0,81.
    expect(calcularCostosCobro(3.09, IOL_DIV).neto).toBeCloseTo(2.0, 1);
    expect(calcularCostosCobro(2.21, IOL_DIV).neto).toBeCloseTo(1.43, 1);
    expect(calcularCostosCobro(1.27, IOL_DIV).neto).toBeCloseTo(0.81, 1);
  });
  it('un broker sin dato usa 1 % de comisión sobre el pago (dividendos y cupones)', () => {
    expect(tasasPorDefecto('dividendo').comision).toBe(0.01);
    expect(tasasPorDefecto('interes').comision).toBe(0.01);
    expect(estimarCostosCobro('interes', 1000).comision).toBe(10);
  });
  it('cupón de ON: sin retención, solo la comisión del broker (IOL 0,45 %)', () => {
    const c = calcularCostosCobro(1000, { retencion: 0, depositaria: 0, comision: TASA_IOL_COMISION_INTERES });
    expect(c.retencion).toBe(0);
    expect(c.comision).toBe(4.5);
    expect(c.neto).toBe(995.5);
  });
  it('amortización: sin costos estimados (no hay datos observados)', () => {
    expect(estimarCostosCobro('amortizacion', 500).neto).toBe(500);
  });
  it('bruto + retención + comisión = neto, nunca negativo, y tasas absurdas se acotan', () => {
    const c = calcularCostosCobro(100, { retencion: 5, depositaria: 0.3, comision: -1 });
    expect(c.tasas.retencion).toBe(0.99);
    expect(c.tasas.depositaria).toBeCloseTo(0, 10);       // retención + depositaria nunca superan el 99 %
    expect(c.tasas.comision).toBe(0);
    expect(c.neto).toBeGreaterThanOrEqual(0);
    expect(calcularCostosCobro(-5, tasasPorDefecto('dividendo')).neto).toBe(0);
  });
  it('tasa editable: 30 % de retención exacta', () => {
    const c = calcularCostosCobro(10, { retencion: 0.3, depositaria: 0, comision: 0 });
    expect(c.retencion).toBe(3); expect(c.neto).toBe(7);
  });
});

describe('netoEstimado', () => {
  it('suma bruto, costos y neto de varios cobros proyectados', () => {
    const r = netoEstimado([{ tipo: 'dividendo', monto: 100 }, { tipo: 'interes', monto: 200 }]);
    expect(r.bruto).toBe(300);
    expect(r.neto).toBeCloseTo(100 * (1 - TASA_RETENCION_EEUU - TASA_COMISION_DEPOSITARIA) * (1 - 0.01) + 200 * (1 - 0.01), 1);
    expect(r.costos).toBeCloseTo(300 - r.neto, 1);
  });
});

describe('costosRegistrados', () => {
  it('null si el cobro no tiene costos cargados', () => {
    expect(costosRegistrados({ monto: 10 })).toBeNull();
    expect(costosRegistrados({ monto: 10, monto_bruto: 10, retencion_usd: 0, comision_usd: 0 })).toBeNull();
  });
  it('devuelve el detalle y si es estimado', () => {
    expect(costosRegistrados({ monto: 6.4, monto_bruto: 10, retencion_usd: 3.5, comision_usd: 0.1, costos_estimados: true }))
      .toEqual({ bruto: 10, retencion: 3.5, comision: 0.1, estimados: true });
  });
});

describe('capas de costos: lo universal vs lo que cambia de broker', () => {
  it('retención 30 % + depositaria 5,5 % + comisión del broker, separadas', () => {
    const c = estimarCostosCobro('dividendo', 100);
    expect(c.retencion).toBe(30);
    expect(c.depositaria).toBe(5.5);
    expect(c.comision).toBe(0.65);                       // (100 − 30 − 5,5) × 1 % = 0,645 → redondeado a centavos
    expect(c.comisiones).toBe(6.15);
  });
  it('una comisión de broker más alta baja el neto pero no toca la retención', () => {
    const iol = calcularCostosCobro(100, IOL_DIV);
    const caro = calcularCostosCobro(100, { ...IOL_DIV, comision: 0.02 });
    expect(caro.retencion).toBe(iol.retencion);
    expect(caro.neto).toBeLessThan(iol.neto);
  });
});

describe('tasasParaCobro', () => {
  it('sin reparto o sin configuración: las generales', () => {
    expect(tasasParaCobro('dividendo', [])).toEqual(tasasPorDefecto('dividendo'));
    expect(tasasParaCobro('dividendo', [{ cantidad: 10, broker: null }])).toEqual(tasasPorDefecto('dividendo'));
  });
  it('usa la configuración del broker y completa lo que falta con la general', () => {
    const t = tasasParaCobro('dividendo', [{ cantidad: 5, broker: { comision_cobro_dividendo: 0.015 } }]);
    expect(t.comision).toBe(0.015);
    expect(t.retencion).toBe(TASA_RETENCION_EEUU);
  });
  it('promedia ponderado por cantidad entre brokers (UNH: 44 en IOL y 113 en Santander)', () => {
    const t = tasasParaCobro('dividendo', [
      { cantidad: 44, broker: { comision_cobro_dividendo: 0.0072 } },
      { cantidad: 113, broker: { comision_cobro_dividendo: 0.02 } },
    ]);
    expect(t.comision).toBeCloseTo((44 * 0.0072 + 113 * 0.02) / 157, 8);
  });
  it('el cupón usa la comisión de cupones y no lleva retención; la amortización no lleva nada', () => {
    const t = tasasParaCobro('interes', [{ cantidad: 1, broker: { comision_cobro_interes: 0.01, retencion_dividendo: 0.5 } }]);
    expect(t).toEqual({ retencion: 0, depositaria: 0, comision: 0.01 });
    expect(tasasParaCobro('amortizacion', [{ cantidad: 1, broker: { comision_cobro_interes: 0.01 } }])).toEqual({ retencion: 0, depositaria: 0, comision: 0 });
  });
});
