import { describe, it, expect } from 'vitest';
import { interesDevengadoMes, calendarioInteresLiquidez, sumarCalendarios, diasDelMes } from './interesLiquidez';

describe('interés de la cuenta remunerada', () => {
  it('devengado = saldo × TNA × días ÷ 365 (octubre: 31 días)', () => {
    expect(diasDelMes(2026, 10)).toBe(31);
    expect(interesDevengadoMes(6733.74, 0.0103, 2026, 10)).toBeCloseTo(5.89, 2);   // ≈ el 5,80 real acreditado el 1/11
  });
  it('sin saldo o sin tasa → 0', () => {
    expect(interesDevengadoMes(0, 0.01, 2026, 10)).toBe(0);
    expect(interesDevengadoMes(1000, 0, 2026, 10)).toBe(0);
    expect(interesDevengadoMes(-5, 0.01, 2026, 10)).toBe(0);
  });
  it('se acredita el mes siguiente: el bucket de diciembre trae lo devengado en noviembre (30 días)', () => {
    const cal = calendarioInteresLiquidez(3000, 0.01, 2026, 11, 3);
    expect(cal.map(m => m.ym)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(cal[0].total).toBeCloseTo(3000 * 0.01 * 31 / 365, 2);   // lo devengado en octubre
    expect(cal[1].total).toBeCloseTo(3000 * 0.01 * 30 / 365, 2);   // noviembre
    expect(cal[2].total).toBeCloseTo(3000 * 0.01 * 31 / 365, 2);   // diciembre
    expect(cal[1].detalle).toEqual([{ ticker: 'LIQUIDEZ', monto: cal[1].total }]);
  });
  it('cruza el año correctamente (enero acredita diciembre)', () => {
    const cal = calendarioInteresLiquidez(1000, 0.02, 2026, 12, 2);
    expect(cal[1].ym).toBe('2027-01');
    expect(cal[1].total).toBeCloseTo(1000 * 0.02 * 31 / 365, 2);
  });
  it('sumarCalendarios suma mes a mes y conserva el detalle', () => {
    const a = [{ ym: '2026-11', year: 2026, month: 11, total: 10, detalle: [{ ticker: 'X', monto: 10 }] }];
    const b = [{ ym: '2026-11', year: 2026, month: 11, total: 2.5, detalle: [{ ticker: 'LIQUIDEZ', monto: 2.5 }] }];
    expect(sumarCalendarios(a, b)).toEqual([{ ym: '2026-11', year: 2026, month: 11, total: 12.5, detalle: [{ ticker: 'X', monto: 10 }, { ticker: 'LIQUIDEZ', monto: 2.5 }] }]);
  });
});
