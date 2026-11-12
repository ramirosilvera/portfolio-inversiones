import { describe, it, expect } from 'vitest';
import { valuarPortfolio, aportadoNeto, armarSnapshots, factorDesdeMacroCache, MAX_EDAD_PRECIO_MS, type PosicionValuable, type PrecioCache } from './_snapshots';

const AHORA = Date.parse('2026-10-16T22:00:00Z');
const fresco = '2026-10-16T21:49:00Z';
const px = (rows: [string, number, string?][]) => new Map<string, PrecioCache>(rows.map(([t, p, u]) => [t, { ticker: t, precio: p, updated_at: u ?? fresco }]));
const pos = (over: Partial<PosicionValuable>): PosicionValuable =>
  ({ portfolio_id: 'pf', ticker: 'X', tipo: 'cedear', cantidad: 10, precio_compra: 1, ratio_cedear: 10, ...over });

describe('valuarPortfolio — misma regla que el cliente (unitValueUSD)', () => {
  it('CEDEAR = subyacente ÷ ratio × cantidad; bono = precio × nominales; efectivo = cantidad', () => {
    const v = valuarPortfolio('pf', [
      pos({ ticker: 'MSFT', cantidad: 100, ratio_cedear: 30 }),
      pos({ ticker: 'DNC7D', tipo: 'bono', cantidad: 2000, ratio_cedear: null }),
      pos({ ticker: 'LIQUIDEZ', tipo: 'cash', cantidad: 500, precio_compra: 1, ratio_cedear: null }),
    ], px([['MSFT', 540], ['DNC7D', 1.07]]), AHORA);
    expect(v.valor).toBeCloseTo(100 * 540 / 30 + 2000 * 1.07 + 500, 2);   // 1800 + 2140 + 500
    expect(v.completo).toBe(true);
    expect(v.detalle).toHaveLength(3);
  });

  it('una posición abierta sin precio hace la cartera INCOMPLETA (no se cae a costo)', () => {
    const v = valuarPortfolio('pf', [pos({ ticker: 'MSFT', ratio_cedear: 30 }), pos({ ticker: 'RARO' })], px([['MSFT', 540]]), AHORA);
    expect(v.completo).toBe(false);
    expect(v.faltan).toEqual(['RARO']);
  });

  it('un precio viejo (más de 5 días) cuenta como faltante', () => {
    const viejo = new Date(AHORA - MAX_EDAD_PRECIO_MS - 60_000).toISOString();
    const v = valuarPortfolio('pf', [pos({ ticker: 'MSFT', ratio_cedear: 30 })], px([['MSFT', 540, viejo]]), AHORA);
    expect(v.completo).toBe(false);
  });

  it('CEDEAR sin ratio no se valúa (evita sobrevaluar N veces)', () => {
    const v = valuarPortfolio('pf', [pos({ ticker: 'MSFT', ratio_cedear: null })], px([['MSFT', 540]]), AHORA);
    expect(v.completo).toBe(false);
  });

  it('acciones locales (en pesos) no se valúan en el servidor', () => {
    expect(valuarPortfolio('pf', [pos({ ticker: 'GGAL', tipo: 'accion_ar' })], px([['GGAL', 10]]), AHORA).completo).toBe(false);
  });

  it('las posiciones cerradas (cantidad 0) no cuentan ni exigen precio', () => {
    const v = valuarPortfolio('pf', [pos({ ticker: 'MSFT', ratio_cedear: 30 }), pos({ ticker: 'VIEJA', cantidad: 0 })], px([['MSFT', 540]]), AHORA);
    expect(v.completo).toBe(true);
    expect(v.detalle).toHaveLength(1);
  });

  it('cartera vacía no es un snapshot válido', () => {
    expect(valuarPortfolio('pf', [], px([]), AHORA).completo).toBe(false);
  });
});

describe('aportadoNeto', () => {
  const ap = (fecha: string, monto: number, tipo = 'aporte') => ({ portfolio_id: 'pf', fecha, monto, tipo });
  it('suma aportes y resta retiros hasta la fecha', () => {
    expect(aportadoNeto([ap('2026-01-01', 1000), ap('2026-03-01', 500), ap('2026-04-01', 200, 'retiro'), ap('2027-01-01', 999)], '2026-10-16', 0)).toBe(1300);
  });
  it('sin aportes cae al costo (igual que el cliente)', () => {
    expect(aportadoNeto([], '2026-10-16', 4321.5)).toBe(4321.5);
  });
});

describe('armarSnapshots', () => {
  it('graba solo las carteras completas y reporta las salteadas', () => {
    const posiciones = [
      pos({ portfolio_id: 'a', ticker: 'MSFT', ratio_cedear: 30, cantidad: 30 }),
      pos({ portfolio_id: 'b', ticker: 'RARO' }),
    ];
    const r = armarSnapshots('2026-10-16', posiciones, px([['MSFT', 540]]), [{ portfolio_id: 'a', fecha: '2026-01-01', monto: 500, tipo: 'aporte' }], AHORA);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({ portfolio_id: 'a', fecha: '2026-10-16', valor: 540, aportado: 500, fuente: 'cron', completo: true });
    expect(r.omitidas).toEqual([{ portfolio_id: 'b', faltan: ['RARO'] }]);
  });
});

describe('valuarPortfolio: CEDEARs en dólar MEP (factor CCL ÷ MEP)', () => {
  it('aplica el factor solo a los CEDEARs', () => {
    const ahora = Date.parse('2026-11-12T12:00:00Z');
    const precios = new Map([['MSFT', { ticker: 'MSFT', precio: 521.125, updated_at: '2026-11-12T11:00:00Z' }], ['DNC7D', { ticker: 'DNC7D', precio: 0.994, updated_at: '2026-11-12T11:00:00Z' }]]);
    const pos = [
      { portfolio_id: 'p', tipo: 'cedear', ticker: 'MSFT', cantidad: 30, precio_compra: 17, ratio_cedear: 30 },
      { portfolio_id: 'p', tipo: 'bono', ticker: 'DNC7D', cantidad: 1000, precio_compra: 1, ratio_cedear: null },
    ] as never;
    const base = valuarPortfolio('p', pos, precios as never, ahora);
    const mep = valuarPortfolio('p', pos, precios as never, ahora, 1.0549);
    expect(base.valor).toBeCloseTo(521.125 + 994, 1);
    expect(mep.valor).toBeCloseTo(521.125 * 1.0549 + 994, 1);
  });
});

describe('factor de CEDEARs en el cron: faltante o inválido no se graba', () => {
  const AHORA = Date.parse('2026-11-12T12:00:00Z');
  const px = new Map([['MSFT', { ticker: 'MSFT', precio: 540, updated_at: '2026-11-12T11:00:00Z' }]]);
  const pos = [{ portfolio_id: 'p', tipo: 'cedear', ticker: 'MSFT', cantidad: 30, precio_compra: 17, ratio_cedear: 30 }] as never;
  it('armarSnapshots pasa el factor y lo guarda en la fila', () => {
    const r1 = armarSnapshots('2026-11-12', pos, px as never, [], AHORA, 1);
    const r2 = armarSnapshots('2026-11-12', pos, px as never, [], AHORA, 1.05);
    expect(r2.filas[0].valor / r1.filas[0].valor).toBeCloseTo(1.05, 6);
    expect(r2.filas[0].factor_cedear).toBe(1.05);
  });
  it('con factor null la cartera con CEDEARs queda omitida (no se graba un valor a paridad)', () => {
    const r = armarSnapshots('2026-11-12', pos, px as never, [], AHORA, null);
    expect(r.filas).toHaveLength(0);
    expect(r.omitidas[0].faltan).toContain('MSFT');
  });
  it('una cartera SIN CEDEARs se graba igual con factor null', () => {
    const bonos = [{ portfolio_id: 'p', tipo: 'bono', ticker: 'DNC7D', cantidad: 1000, precio_compra: 1, ratio_cedear: null }] as never;
    const r = armarSnapshots('2026-11-12', bonos, new Map([['DNC7D', { ticker: 'DNC7D', precio: 1, updated_at: '2026-11-12T11:00:00Z' }]]) as never, [], AHORA, null);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].factor_cedear).toBeNull();
  });
  it('factorDesdeMacroCache: ok, faltante, viejo y desfasado', () => {
    const ok = [{ clave: 'dolar_mep', valor: 1578.3, updated_at: '2026-11-12T09:53:44Z' }, { clave: 'dolar_ccl', valor: 1664.9, updated_at: '2026-11-12T09:53:44Z' }];
    expect(factorDesdeMacroCache(ok, AHORA)).toBeCloseTo(1.0549, 4);
    expect(factorDesdeMacroCache([ok[0]], AHORA)).toBeNull();
    expect(factorDesdeMacroCache(ok, AHORA + 6 * 86_400_000)).toBeNull();                                            // > 5 días
    expect(factorDesdeMacroCache([ok[0], { ...ok[1], updated_at: '2026-11-09T09:53:44Z' }], AHORA)).toBeNull();     // desfase > 1 día
    expect(factorDesdeMacroCache([ok[0], { ...ok[1], valor: 100 }], AHORA)).toBeNull();                              // brecha imposible
  });
});
