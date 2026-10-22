import { describe, it, expect } from 'vitest';
import { parsearYahooChart } from './_yahoo';

const chart = (p: unknown) => ({ chart: { result: [{ meta: { regularMarketPrice: p } }], error: null } });

describe('parsearYahooChart', () => {
  it('lee el precio de una respuesta real (VIX 16,68; ^TNX 5,146; ^IRX 4,063 en %)', () => {
    expect(parsearYahooChart(chart(16.68))).toBe(16.68);
    expect(parsearYahooChart(chart(5.146))).toBe(5.146);
    expect(parsearYahooChart(chart(4.063))).toBe(4.063);
  });
  it('null si falta el dato, no es número o no es positivo', () => {
    for (const bad of [chart(undefined), chart('16.7'), chart(0), chart(-3), chart(NaN), { chart: { result: [] } }, { chart: { result: null, error: { code: 'Not Found' } } }, {}, null, undefined, 'x'])
      expect(parsearYahooChart(bad)).toBeNull();
  });
});
