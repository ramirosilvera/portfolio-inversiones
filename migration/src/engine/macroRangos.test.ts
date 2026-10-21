import { describe, it, expect } from 'vitest';
import { RANGOS_MACRO, valorPlausible, sanearMacro } from './macroRangos';

describe('valorPlausible', () => {
  it('rechaza el 400 que dejó una respuesta corrupta en TODAS las series de FRED', () => {
    for (const k of Object.keys(RANGOS_MACRO)) expect(valorPlausible(k, 400), k).toBe(false);
  });
  it('acepta valores reales de mercado', () => {
    expect(valorPlausible('dgs10', 4.3)).toBe(true);
    expect(valorPlausible('dgs3mo', 4.1)).toBe(true);
    expect(valorPlausible('hy_spread', 3.1)).toBe(true);
    expect(valorPlausible('vix', 17.2)).toBe(true);
    expect(valorPlausible('dollar_index', 121.4)).toBe(true);
  });
  it('acepta extremos históricos reales (VIX 82,7 en 2020; HY OAS 20 % en 2008; tasas negativas)', () => {
    expect(valorPlausible('vix', 82.7)).toBe(true);
    expect(valorPlausible('hy_spread', 20)).toBe(true);
    expect(valorPlausible('dgs3mo', -0.5)).toBe(true);
  });
  it('rechaza lo que no es un número finito', () => {
    for (const v of [NaN, Infinity, '4.3', null, undefined]) expect(valorPlausible('dgs10', v)).toBe(false);
  });
  it('una clave sin rango solo exige un número finito', () => {
    expect(valorPlausible('oro', 3790)).toBe(true);
    expect(valorPlausible('oro', NaN)).toBe(false);
  });
});

describe('sanearMacro', () => {
  it('anula las series con valor imposible y deja el resto intacto', () => {
    const r = sanearMacro({ dgs10: 400, dgs3mo: 400, vix: 400, hy_spread: 400, dollar_index: 400, dolar_mep: 1548.4, sp500: 7731, oro: null });
    expect(r).toEqual({ dgs10: null, dgs3mo: null, vix: null, hy_spread: null, dollar_index: null, dolar_mep: 1548.4, sp500: 7731, oro: null });
  });
  it('no toca los valores plausibles y no muta el original', () => {
    const orig = { dgs10: 4.3, vix: 17 };
    const r = sanearMacro(orig);
    expect(r).toEqual({ dgs10: 4.3, vix: 17 });
    expect(r).not.toBe(orig);
  });
});
