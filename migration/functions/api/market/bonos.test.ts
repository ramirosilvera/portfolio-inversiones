import { describe, it, expect } from 'vitest';
import { esHardDollar, mergeFallback, precioUsdPlausible } from './bonos';

describe('esHardDollar', () => {
  it('sufijo D o C → hard dollar (MEP/CCL)', () => {
    expect(esHardDollar('AL30D')).toBe(true);
    expect(esHardDollar('GD30C')).toBe(true);
    expect(esHardDollar('YM41D')).toBe(true);
  });

  it('sin sufijo D/C → liquida en pesos', () => {
    expect(esHardDollar('AL30')).toBe(false);
    expect(esHardDollar('GD30')).toBe(false);
  });

  it('ticker demasiado corto no matchea aunque termine en D/C (evita falsos positivos triviales)', () => {
    expect(esHardDollar('AD')).toBe(false);
  });
});

describe('mergeFallback', () => {
  it('agrega al mapa los tickers cacheados que NO vinieron vivos', () => {
    const map = { AL30D: 0.65 };
    const r = mergeFallback(map, [{ ticker: 'GD30D', precio: 0.7 }, { ticker: 'YM41D', precio: 0.98 }]);
    expect(r).toEqual({ AL30D: 0.65, GD30D: 0.7, YM41D: 0.98 });
  });

  it('nunca pisa un precio que sí vino vivo', () => {
    const map = { AL30D: 0.65 };
    const r = mergeFallback(map, [{ ticker: 'AL30D', precio: 0.1 }]); // precio cacheado viejo/distinto
    expect(r.AL30D).toBe(0.65);
  });

  it('mapa vivo vacío (proveedor totalmente caído): el resultado es 100% del cache', () => {
    const r = mergeFallback({}, [{ ticker: 'AL30D', precio: 0.65 }, { ticker: 'GD30D', precio: 0.7 }]);
    expect(r).toEqual({ AL30D: 0.65, GD30D: 0.7 });
  });

  it('no muta el mapa original', () => {
    const map = { AL30D: 0.65 };
    mergeFallback(map, [{ ticker: 'GD30D', precio: 0.7 }]);
    expect(map).toEqual({ AL30D: 0.65 });
  });

  it('sin cacheados: devuelve el mapa vivo tal cual', () => {
    const map = { AL30D: 0.65 };
    expect(mergeFallback(map, [])).toEqual(map);
  });
});

describe('precioUsdPlausible — tope de cordura para especies en USD', () => {
  it('rango normal de un bono/ON (default a sobre la par) pasa', () => {
    expect(precioUsdPlausible(0.646)).toBe(true);
    expect(precioUsdPlausible(1.085)).toBe(true);
    expect(precioUsdPlausible(0.05)).toBe(true);
  });
  it('casos reales mal clasificados por el sufijo D: se descartan', () => {
    expect(precioUsdPlausible(1038.3)).toBe(false);   // BA37D (especie en pesos)
    expect(precioUsdPlausible(0.00062)).toBe(false);  // TXS8D (BONTE CER en pesos)
    expect(precioUsdPlausible(NaN)).toBe(false);
  });
  it('mergeFallback no reintroduce desde la cache un precio USD absurdo (pero sí los de especies en pesos)', () => {
    const out = mergeFallback({}, [
      { ticker: 'BA37D', precio: 1038.3 }, { ticker: 'YM43D', precio: 1.0045 }, { ticker: 'TX26', precio: 0.0009 },
    ]);
    expect(out).toEqual({ YM43D: 1.0045, TX26: 0.0009 });
  });
});
