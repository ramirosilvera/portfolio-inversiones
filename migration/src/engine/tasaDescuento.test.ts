import { describe, it, expect } from 'vitest';
import { tasaDescuentoCedears } from './tasaDescuento';
import type { CedearCalc } from './cedears';

const cc = (id: string, ticker: string, capitalUsado: number): CedearCalc =>
  ({ pos: { id, ticker } as any, mkt: capitalUsado, capital: capitalUsado, res: 0, capitalUsado });

describe('tasaDescuentoCedears', () => {
  it('pondera por capital: (0,10×3000 + 0,08×1000) ÷ 4000 = 9,5 %', () => {
    const r = tasaDescuentoCedears([cc('1', 'MSFT', 3000), cc('2', 'WMT', 1000)], new Map([['MSFT', { d: 0.10 }], ['WMT', { d: 0.08 }]]));
    expect(r.ponderada).toBeCloseTo(0.095, 10);
    expect(r.conTasa).toBe(2); expect(r.sinTasa).toBe(0);
    expect(r.minima).toBe(0.08); expect(r.maxima).toBe(0.10);
  });

  it('un ticker sin supuestos guardados queda FUERA del promedio (no se diluye con una d por defecto)', () => {
    const r = tasaDescuentoCedears([cc('1', 'MSFT', 3000), cc('2', 'LAC', 9000)], new Map([['MSFT', { d: 0.10 }]]));
    expect(r.ponderada).toBeCloseTo(0.10, 10);
    expect(r.sinTasa).toBe(1);
    expect(r.porPosicion['2'].d).toBeNull();
  });

  it('ninguna con tasa → ponderada null', () => {
    expect(tasaDescuentoCedears([cc('1', 'MSFT', 3000)], new Map()).ponderada).toBeNull();
    expect(tasaDescuentoCedears([], new Map()).ponderada).toBeNull();
  });

  it('d inválida (0, negativa, NaN) cuenta como sin dato', () => {
    const r = tasaDescuentoCedears([cc('1', 'A', 100), cc('2', 'B', 100), cc('3', 'C', 100)], new Map([['A', { d: 0 }], ['B', { d: -1 }], ['C', { d: NaN }]]));
    expect(r.ponderada).toBeNull(); expect(r.sinTasa).toBe(3);
  });

  it('el ticker de la posición se busca en mayúsculas', () => {
    expect(tasaDescuentoCedears([cc('1', 'msft', 100)], new Map([['MSFT', { d: 0.09 }]])).ponderada).toBeCloseTo(0.09, 10);
  });
});
