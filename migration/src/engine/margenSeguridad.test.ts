import { describe, it, expect } from 'vitest';
import { margenSeguridadCedears } from './margenSeguridad';
import type { CedearCalc } from './cedears';

const cc = (id: string, ticker: string, capitalUsado: number): CedearCalc =>
  ({ pos: { id, ticker } as any, mkt: capitalUsado, capital: capitalUsado, res: 0, capitalUsado });

describe('margenSeguridadCedears', () => {
  it('pondera por capital: (0,30×3000 + (−0,10)×1000) ÷ 4000 = 20 %', () => {
    const r = margenSeguridadCedears([cc('1', 'MSFT', 3000), cc('2', 'WMT', 1000)], new Map([['MSFT', 0.30], ['WMT', -0.10]]));
    expect(r.ponderado).toBeCloseTo(0.20, 10);
    expect(r.baratos).toBe(1); expect(r.caros).toBe(1);
  });
  it('sin margen calculable queda fuera del promedio', () => {
    const r = margenSeguridadCedears([cc('1', 'MSFT', 1000), cc('2', 'LAC', 9000)], new Map<string, number | null>([['MSFT', 0.2], ['LAC', null]]));
    expect(r.ponderado).toBeCloseTo(0.2, 10); expect(r.sinMargen).toBe(1); expect(r.porPosicion['2'].margen).toBeNull();
  });
  it('ninguno → null; NaN e Infinity cuentan como sin dato', () => {
    expect(margenSeguridadCedears([], new Map()).ponderado).toBeNull();
    const r = margenSeguridadCedears([cc('1', 'A', 1), cc('2', 'B', 1)], new Map([['A', NaN], ['B', Infinity]]));
    expect(r.ponderado).toBeNull(); expect(r.sinMargen).toBe(2);
  });
  it('un margen negativo grande no se acota: refleja que está caro', () => {
    expect(margenSeguridadCedears([cc('1', 'A', 100)], new Map([['A', -0.6]])).ponderado).toBeCloseTo(-0.6, 10);
  });
});
