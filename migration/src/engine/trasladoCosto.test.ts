import { describe, it, expect } from 'vitest';
import { planTrasladoCosto, mismaPosicion, type OrdenParaTraslado } from './trasladoCosto';

const o = (over: Partial<OrdenParaTraslado>): OrdenParaTraslado => ({ id: 'a', ticker: 'COC4D', estado: 'terminada', comision_usd: 10, comision_ars: null, mep: null, ...over });

describe('mismaPosicion', () => {
  it('equivalencias de línea', () => {
    expect(mismaPosicion('MAD', 'MA')).toBe(true);
    expect(mismaPosicion('CS51O', 'CS51D')).toBe(true);
    expect(mismaPosicion('MA', 'MA')).toBe(true);
    expect(mismaPosicion('MELID', 'MA')).toBe(false);
  });
});

describe('planTrasladoCosto', () => {
  it('transferir TODO mueve toda la comisión (caso COC4D: US$ 10) y deja el origen en 0', () => {
    const p = planTrasladoCosto([o({})], 'COC4D', 2000, 2000);
    expect(p.fraccion).toBe(1);
    expect(p.totalUsd).toBe(10);
    expect(p.origen).toEqual([{ id: 'a', comision_usd: 0, comision_ars: null }]);
  });
  it('transferir la mitad mueve la mitad y deja la mitad en el origen', () => {
    const p = planTrasladoCosto([o({ comision_usd: 10 })], 'COC4D', 1000, 2000);
    expect(p.totalUsd).toBe(5);
    expect(p.origen[0].comision_usd).toBe(5);
  });
  it('suma varias órdenes, convierte los $ con MEP y avisa la parte en pesos sin MEP', () => {
    const p = planTrasladoCosto([
      o({ id: '1', ticker: 'MAD', comision_usd: 3, comision_ars: 1500, mep: 1500 }),     // 3 + 1 = 4
      o({ id: '2', ticker: 'MA', comision_usd: null, comision_ars: 3000, mep: null }),   // sin MEP
    ], 'MA', 10, 10);
    expect(p.totalUsd).toBe(4);
    expect(p.arsSinMep).toBe(3000);
    expect(p.origen.map(x => x.id)).toEqual(['1', '2']);
  });
  it('ignora órdenes de otra posición, de venta, no terminadas y sin comisión', () => {
    const p = planTrasladoCosto([
      o({ id: 'otra', ticker: 'MSFT' }), o({ id: 'venta', lado: 'venta' }), o({ id: 'canc', estado: 'cancelada' }),
      o({ id: 'cero', comision_usd: 0 }), o({ id: 'ok', comision_usd: 2 }),
    ], 'COC4D', 5, 5);
    expect(p.origen.map(x => x.id)).toEqual(['ok']);
    expect(p.totalUsd).toBe(2);
  });
  it('cantidad mayor a la de la posición se acota a 100 % y posición vacía no mueve nada', () => {
    expect(planTrasladoCosto([o({})], 'COC4D', 5000, 2000).fraccion).toBe(1);
    expect(planTrasladoCosto([o({})], 'COC4D', 5, 0).totalUsd).toBe(0);
  });
});
