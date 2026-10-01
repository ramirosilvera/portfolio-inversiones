import { describe, it, expect } from 'vitest';
import { realizedPnl } from './pnl';
import type { Movimiento } from '../types/domain';

const mv = (o: Partial<Movimiento>): Movimiento => ({
  id: Math.random().toString(36), portfolio_id: 'p', posicion_id: null, ticker: 'X',
  tipo: 'compra', cantidad: 0, precio: 0, fecha: '2026-01-01', nota: null, created_at: '2026-01-01T00:00:00Z', ...o,
});

describe('realizedPnl', () => {
  it('venta con ganancia sobre costo promedio', () => {
    const r = realizedPnl([
      mv({ ticker: 'KO', tipo: 'compra', cantidad: 10, precio: 50, fecha: '2026-01-01' }),
      mv({ ticker: 'KO', tipo: 'venta', cantidad: 4, precio: 70, fecha: '2026-02-01' }),
    ]);
    expect(r.porTicker.KO).toBe(80);   // (70-50)*4
    expect(r.total).toBe(80);
  });

  it('costo promedio ponderado con dos compras antes de vender', () => {
    const r = realizedPnl([
      mv({ ticker: 'MSFT', tipo: 'compra', cantidad: 10, precio: 100, fecha: '2026-01-01' }),
      mv({ ticker: 'MSFT', tipo: 'compra', cantidad: 10, precio: 200, fecha: '2026-01-05' }), // avg 150
      mv({ ticker: 'MSFT', tipo: 'venta', cantidad: 5, precio: 180, fecha: '2026-02-01' }),
    ]);
    expect(r.porTicker.MSFT).toBe(150); // (180-150)*5
  });

  it('respeta el orden cronológico aunque lleguen desordenados', () => {
    const r = realizedPnl([
      mv({ ticker: 'A', tipo: 'venta', cantidad: 2, precio: 30, fecha: '2026-03-01' }),
      mv({ ticker: 'A', tipo: 'compra', cantidad: 2, precio: 10, fecha: '2026-01-01' }),
    ]);
    expect(r.porTicker.A).toBe(40); // compra primero (10), venta después (30) → (30-10)*2
  });

  it('sin ventas → 0', () => {
    expect(realizedPnl([mv({ tipo: 'compra', cantidad: 5, precio: 20 })]).total).toBe(0);
  });

  it('ajuste cambia cantidad sin diluir el costo promedio', () => {
    const r = realizedPnl([
      mv({ ticker: 'B', tipo: 'compra', cantidad: 10, precio: 100, fecha: '2026-01-01' }),
      mv({ ticker: 'B', tipo: 'ajuste', cantidad: 10, precio: 0, fecha: '2026-01-15' }), // split 2:1 sin costo
      mv({ ticker: 'B', tipo: 'venta', cantidad: 5, precio: 120, fecha: '2026-02-01' }),
    ]);
    // El promedio sigue en 100 (no se diluyó con precio 0): (120-100)*5 = 100
    expect(r.porTicker.B).toBe(100);
  });

  it('amortizacion_vr: vender después de amortizar no realiza como pérdida el capital ya cobrado', () => {
    // 1000 VN a 1,00; amortiza 50% (factor 0,5) → costo 0,50; vende todo a 0,52 (precio por VN original).
    const r = realizedPnl([
      mv({ ticker: 'B', tipo: 'compra', cantidad: 1000, precio: 1, fecha: '2026-01-01' }),
      mv({ ticker: 'B', tipo: 'amortizacion_vr', cantidad: 0, precio: 0.5, fecha: '2026-06-01' }),
      mv({ ticker: 'B', tipo: 'venta', cantidad: 1000, precio: 0.52, fecha: '2026-07-01' }),
    ]);
    expect(r.porTicker.B).toBe(20);   // sin el factor daría −480
  });
});
