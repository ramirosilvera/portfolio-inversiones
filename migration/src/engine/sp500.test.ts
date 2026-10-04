import { describe, it, expect } from 'vitest';
import { retornoSp, compararConSp500, type PuntoSp } from './sp500';

// Serie sintética: 100 al 2024-12-31, 110 al 2025-06-30, 121 al 2025-12-31, 133,1 al 2026-06-30, 140 al 2026-10-02.
const S: PuntoSp[] = [
  { f: '2024-12-31', c: 100 }, { f: '2025-06-30', c: 110 }, { f: '2025-12-31', c: 121 },
  { f: '2026-06-30', c: 133.1 }, { f: '2026-10-02', c: 140 },
];

describe('retornoSp', () => {
  it('año calendario completo', () => expect(retornoSp(S, '2024-12-31', '2025-12-31')).toBeCloseTo(0.21, 10));
  it('período parcial', () => expect(retornoSp(S, '2025-06-30', '2025-12-31')).toBeCloseTo(0.1, 10));
  it('usa el último cierre ≤ fecha (finde/feriado)', () => expect(retornoSp(S, '2025-07-02', '2025-12-31')).toBeCloseTo(0.1, 10));
  it('null si la serie no cubre el inicio', () => expect(retornoSp(S, '2020-01-01', '2025-12-31')).toBeNull());
  it('null si la serie no llega al final del período', () => expect(retornoSp(S, '2025-12-31', '2027-06-30')).toBeNull());
  it('null con serie vacía o período invertido', () => {
    expect(retornoSp([], '2025-01-01', '2025-12-31')).toBeNull();
    expect(retornoSp(S, '2025-12-31', '2025-06-30')).toBeNull();
  });
});

describe('compararConSp500', () => {
  it('diferencia = portfolio − S&P sobre el mismo período, y marca el año en curso como parcial', () => {
    const f = compararConSp500([
      { anio: 2025, rendimiento: 0.30, dias: 365 },
      { anio: 2026, rendimiento: 0.05, dias: 275, concentrado: true },
    ], S, '2026-10-02');
    expect(f[0].sp500).toBeCloseTo(0.21, 2);
    expect(f[0].diferencia).toBeCloseTo(0.09, 2);
    expect(f[0].parcial).toBe(false);
    expect(f[1].parcial).toBe(true);
    expect(f[1].concentrado).toBe(true);
    expect(f[1].sp500).toBeCloseTo(140 / 121 - 1, 2);
  });
  it('sin rendimiento del portfolio no hay S&P ni diferencia', () => {
    const f = compararConSp500([{ anio: 2025, rendimiento: null }], S, '2026-10-02');
    expect(f[0].sp500).toBeNull();
    expect(f[0].diferencia).toBeNull();
  });
});
