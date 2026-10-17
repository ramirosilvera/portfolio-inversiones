import { describe, it, expect } from 'vitest';
import { calcularCostosCobro, estimarCostosCobro, netoEstimado, costosRegistrados, tasasPorDefecto, TASA_RETENCION_DIVIDENDO } from './costosCobros';

describe('estimarCostosCobro', () => {
  it('dividendo de CEDEAR: retención ~35,5 % y comisión ~0,72 % sobre lo que queda (reproduce lo que acreditó IOL)', () => {
    // UNH: bruto 3,09 → IOL acreditó 2,00 (64,7 %); MSFT: 2,21 → 1,43.
    expect(estimarCostosCobro('dividendo', 3.09).neto).toBeCloseTo(2.0, 1);
    expect(estimarCostosCobro('dividendo', 2.21).neto).toBeCloseTo(1.43, 1);
    expect(estimarCostosCobro('dividendo', 1.27).neto).toBeCloseTo(0.81, 1);
  });
  it('cupón de ON: sin retención, solo comisión chica', () => {
    const c = estimarCostosCobro('interes', 1000);
    expect(c.retencion).toBe(0);
    expect(c.comision).toBe(4.5);
    expect(c.neto).toBe(995.5);
  });
  it('amortización: sin costos estimados (no hay datos observados)', () => {
    expect(estimarCostosCobro('amortizacion', 500).neto).toBe(500);
  });
  it('bruto + retención + comisión = neto, nunca negativo, y tasas absurdas se acotan', () => {
    const c = calcularCostosCobro(100, { retencion: 5, comision: -1 });
    expect(c.tasas.retencion).toBe(0.99);
    expect(c.tasas.comision).toBe(0);
    expect(c.neto).toBeGreaterThanOrEqual(0);
    expect(calcularCostosCobro(-5, tasasPorDefecto('dividendo')).neto).toBe(0);
  });
  it('tasa editable: 30 % de retención exacta', () => {
    const c = calcularCostosCobro(10, { retencion: 0.3, comision: 0 });
    expect(c.retencion).toBe(3); expect(c.neto).toBe(7);
  });
});

describe('netoEstimado', () => {
  it('suma bruto, costos y neto de varios cobros proyectados', () => {
    const r = netoEstimado([{ tipo: 'dividendo', monto: 100 }, { tipo: 'interes', monto: 200 }]);
    expect(r.bruto).toBe(300);
    expect(r.neto).toBeCloseTo(100 * (1 - TASA_RETENCION_DIVIDENDO) * (1 - 0.0072) + 200 * (1 - 0.0045), 1);
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
