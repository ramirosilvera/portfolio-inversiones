import { describe, it, expect } from 'vitest';
import { factorMepCcl as _factor, unitValueUSD } from './valuation';
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
