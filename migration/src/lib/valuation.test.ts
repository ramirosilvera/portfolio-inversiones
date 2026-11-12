import { describe, it, expect } from 'vitest';
import { factorMepCcl as _factor, factorMepCclOrNull, unitValueUSD, marketValueUSD } from './valuation';
import { valuarPortfolio } from '../../functions/api/_snapshots';
describe('factorMepCcl / CEDEAR en dólar MEP', () => {
  it('MEP 1578,3 y CCL 1664,9 → factor ≈ 1,0549; MSFT 521,125 ÷ 30 × factor ≈ 18,32 (IOL: MSFTD a 18,34–18,40)', () => {
    const f = _factor(1578.3, 1664.9);
    expect(f).toBeCloseTo(1.0549, 4);
    expect((521.125 / 30) * f).toBeCloseTo(18.32, 1);
  });
  it('sin alguno de los dos dólares, o con una brecha imposible, no corrige (factor 1)', () => {
    expect(_factor(null, 1664.9)).toBe(1);
    expect(_factor(1578.3, undefined)).toBe(1);
    expect(_factor(0, 1664.9)).toBe(1);
    expect(_factor(100, 1664.9)).toBe(1);   // 16,6× : dato corrupto
    expect(_factor(1700, 1600)).toBe(1);    // 0,94 < 0,95
  });
  it('unitValueUSD aplica el factor solo a CEDEARs (bonos y cash quedan igual)', () => {
    const ced = { tipo: 'cedear', ratio_cedear: 30, precio_compra: 1 } as never;
    const bono = { tipo: 'bono', precio_compra: 1 } as never;
    expect(unitValueUSD(ced, 521.125, 1.0549)).toBeCloseTo(18.325, 2);
    expect(unitValueUSD(ced, 521.125)).toBeCloseTo(17.371, 2);
    expect(unitValueUSD(bono, 0.99, 1.0549)).toBe(0.99);
  });
});

describe('bordes del factor y paridad cliente/servidor', () => {
  it('bordes inclusivos y entradas raras', () => {
    expect(_factor(1000, 950)).toBeCloseTo(0.95); expect(_factor(1000, 1250)).toBeCloseTo(1.25);
    expect(_factor(1000, 949.9)).toBe(1); expect(_factor(1000, 1250.1)).toBe(1);
    expect(factorMepCclOrNull(1000, 949.9)).toBeNull(); expect(factorMepCclOrNull(null, 1600)).toBeNull();
    expect(_factor(NaN, 1600)).toBe(1); expect(_factor(1500, Infinity)).toBe(1); expect(_factor(-1500, -1600)).toBe(1);
    expect(_factor('1.578,3' as never, 1664.9)).toBe(1);
  });
  it('marketValueUSD / cash / sin ratio con factor', () => {
    const ced = { tipo: 'cedear', ratio_cedear: 30, cantidad: 30, precio_compra: 1 } as never;
    expect(marketValueUSD(ced, 540, 1.05)).toBeCloseTo(540 * 1.05);
    expect(unitValueUSD({ tipo: 'cash', precio_compra: 1 } as never, null, 1.05)).toBe(1);
    expect(unitValueUSD({ tipo: 'cedear', ratio_cedear: null } as never, 540, 1.05)).toBeNull();
  });
  it('cliente y servidor valúan igual un CEDEAR con factor', () => {
    const p = { portfolio_id: 'p', tipo: 'cedear', ticker: 'MSFT', cantidad: 7, precio_compra: 1, ratio_cedear: 30 };
    const px = new Map([['MSFT', { ticker: 'MSFT', precio: 521.125, updated_at: '2026-11-12T11:00:00Z' }]]);
    const srv = valuarPortfolio('p', [p] as never, px as never, Date.parse('2026-11-12T12:00:00Z'), 1.0549).valor;
    expect(srv).toBeCloseTo(marketValueUSD(p as never, 521.125, 1.0549)!, 1);
  });
});
