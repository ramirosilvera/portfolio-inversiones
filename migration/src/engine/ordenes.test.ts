import { describe, it, expect } from 'vitest';
import { resumenOrdenes, resumenPorMes, controlarOrdenes, montoCoherente, tickerDePosicion, type OrdenFila } from './ordenes';

const o = (over: Partial<OrdenFila>): OrdenFila => ({
  id: Math.random().toString(36).slice(2), fecha: '2026-10-13', ticker: 'MAD', broker: 'IOL', numero_orden: '1', nominales: 9, precio_limite: null,
  precio_ejecutado: 19.07, monto_usd: 171.63, comision_usd: 0.62, comision_ars: 159.39, mep: 1540, estado: 'terminada', origen: 'api', nota: null, movimiento_id: null, ...over,
});

describe('resumenOrdenes', () => {
  it('solo cuentan las ejecutadas; canceladas y rechazadas se cuentan aparte (una cancelada con monto no infla lo operado)', () => {
    const r = resumenOrdenes([o({}), o({ estado: 'cancelada', monto_usd: 1500, comision_usd: null, comision_ars: null }), o({ estado: 'rechazada' })]);
    expect(r.ejecutadas).toBe(1); expect(r.canceladas).toBe(1); expect(r.rechazadas).toBe(1);
    expect(r.operadoUsd).toBe(171.63);
  });
  it('la comisión en pesos se convierte solo con MEP registrado; sin MEP queda aparte', () => {
    const r = resumenOrdenes([o({ comision_ars: 1540, mep: 1540 }), o({ comision_ars: 3000, mep: null })]);
    expect(r.comisionArsEnUsd).toBe(1);
    expect(r.comisionArsSinMepPesos).toBe(3000);
    expect(r.totalUsdConocido).toBe(+(0.62 * 2 + 1).toFixed(2));
  });
});

describe('resumenPorMes', () => {
  it('agrupa por mes y ordena ascendente', () => {
    const r = resumenPorMes([o({ fecha: '2026-10-05' }), o({ fecha: '2026-09-28' }), o({ fecha: '2026-10-13' })]);
    expect(r.map(x => [x.mes, x.ordenes])).toEqual([['2026-09', 1], ['2026-10', 2]]);
  });
});

describe('montoCoherente', () => {
  it('CEDEAR por unidad y bono cada 100 nominales', () => {
    expect(montoCoherente({ nominales: 9, precio_ejecutado: 19.07, monto_usd: 171.63 })).toBe(true);
    expect(montoCoherente({ nominales: 700, precio_ejecutado: 107.3, monto_usd: 751.1 })).toBe(true);
    expect(montoCoherente({ nominales: 9, precio_ejecutado: 19.07, monto_usd: 250 })).toBe(false);
  });
  it('sin precio no se puede verificar', () => { expect(montoCoherente({ nominales: 9, precio_ejecutado: null, monto_usd: 10 })).toBeNull(); });
});

describe('tickerDePosicion', () => {
  it('MAD → MA si la cartera tiene MA; los bonos que terminan en D quedan igual', () => {
    const s = new Set(['MA', 'DNC7D']);
    expect(tickerDePosicion('MAD', s)).toBe('MA');
    expect(tickerDePosicion('DNC7D', s)).toBe('DNC7D');
  });
  it('CS51O (ON en pesos) → CS51D', () => { expect(tickerDePosicion('CS51O', new Set(['CS51D']))).toBe('CS51D'); });
});

describe('controlarOrdenes', () => {
  const pos = ['MA', 'DNC7D'];
  it('una orden bien cargada y conciliada no genera controles', () => {
    expect(controlarOrdenes([o({})], [{ fecha: '2026-10-13', ticker: 'MA', cantidad: 9 }], pos)).toEqual([]);
  });
  it('detecta comisión faltante, sin MEP, monto incoherente y comisión alta', () => {
    const c = controlarOrdenes([
      o({ id: 'a', comision_usd: null, comision_ars: null }),
      o({ id: 'b', mep: null }),
      o({ id: 'c', monto_usd: 400 }),
      o({ id: 'd', comision_usd: 5 }),
    ], [{ fecha: '2026-10-13', ticker: 'MA', cantidad: 36 }], pos);
    const tipos = c.map(x => x.tipo);
    expect(tipos).toEqual(expect.arrayContaining(['sin_comision', 'sin_mep', 'monto_incoherente', 'comision_alta']));
    expect(c[0].severidad).toBe('error');                                    // los errores van primero
  });
  it('concilia por (fecha, ticker): suma de nominales de las órdenes vs compra registrada', () => {
    const ok = controlarOrdenes([o({ nominales: 5, monto_usd: 95.35 }), o({ nominales: 4, monto_usd: 76.28 })], [{ fecha: '2026-10-13', ticker: 'MA', cantidad: 9 }], pos);
    expect(ok.filter(x => x.tipo === 'movimiento_distinto' || x.tipo === 'sin_movimiento')).toEqual([]);
    const mal = controlarOrdenes([o({})], [{ fecha: '2026-10-13', ticker: 'MA', cantidad: 10 }], pos);
    expect(mal.some(x => x.tipo === 'movimiento_distinto')).toBe(true);
    expect(controlarOrdenes([o({})], [{ fecha: '2026-10-01', ticker: 'MA', cantidad: 3 }], pos).some(x => x.tipo === 'sin_movimiento')).toBe(true);   // hay historial desde el 01/10 y ese día no hay compra
    expect(controlarOrdenes([o({})], [{ fecha: '2026-10-01', ticker: 'DNC7D', cantidad: 3 }], pos).some(x => x.tipo === 'sin_movimiento')).toBe(true);
    expect(controlarOrdenes([o({})], [], pos).some(x => x.tipo === 'anterior_al_historial')).toBe(true);   // sin historial de compras no se concilia
  });
  it('compra sin orden: solo desde la primera orden y sin contar la liquidez', () => {
    const c = controlarOrdenes([o({})], [
      { fecha: '2026-10-13', ticker: 'MA', cantidad: 9 },
      { fecha: '2026-08-10', ticker: 'COC4D', cantidad: 2000 },     // posterior a la primera orden? no: es anterior → no se marca
      { fecha: '2026-10-20', ticker: 'COC4D', cantidad: 500 },
      { fecha: '2026-10-20', ticker: 'LIQUIDEZ', cantidad: 8000 },
    ], pos);
    const sin = c.filter(x => x.tipo === 'compra_sin_orden');
    expect(sin).toHaveLength(1);
    expect(sin[0].texto).toContain('COC4D');
  });
  it('un portfolio sin órdenes no genera "compra sin orden" (no llevaba el registro)', () => {
    expect(controlarOrdenes([], [{ fecha: '2026-10-13', ticker: 'MA', cantidad: 9 }], pos)).toEqual([]);
  });
});

describe('controlarOrdenes — antes del historial de movimientos', () => {
  const pos = ['MELI', 'CS51D'];
  it('las órdenes anteriores a la primera compra registrada no son error: se avisa una sola vez', () => {
    const c = controlarOrdenes(
      [o({ fecha: '2025-10-06', ticker: 'MELI', nominales: 7, precio_ejecutado: 18.34, monto_usd: 128.41 }),
       o({ fecha: '2025-12-22', ticker: 'MELI', nominales: 14, precio_ejecutado: 17.05, monto_usd: 238.7 }),
       o({ fecha: '2026-08-19', ticker: 'CS51O', nominales: 1914, precio_ejecutado: 1.0156, monto_usd: 1943.8, comision_usd: 5 })],
      [{ fecha: '2026-08-19', ticker: 'CS51D', cantidad: 1914 }], pos);
    expect(c.filter(x => x.tipo === 'sin_movimiento')).toEqual([]);
    expect(c.filter(x => x.tipo === 'anterior_al_historial')).toHaveLength(1);
    expect(c.filter(x => x.tipo === 'movimiento_distinto')).toEqual([]);
  });
  it('una orden POSTERIOR al inicio del historial sin compra sigue siendo error', () => {
    const c = controlarOrdenes([o({ fecha: '2026-10-13', ticker: 'MELI', nominales: 5, precio_ejecutado: 20, monto_usd: 100 })], [{ fecha: '2026-08-19', ticker: 'CS51D', cantidad: 10 }], pos);
    expect(c.some(x => x.tipo === 'sin_movimiento')).toBe(true);
  });
});

describe('controlarOrdenes — ventas', () => {
  const pos = ['MA'];
  it('una orden de venta se concilia contra las ventas, no contra las compras', () => {
    const v = o({ lado: 'venta', nominales: 9 });
    expect(controlarOrdenes([v], [], pos, ['LIQUIDEZ'], [{ fecha: '2026-10-13', ticker: 'MA', cantidad: 9 }]).filter(x => x.tipo === 'sin_movimiento' || x.tipo === 'movimiento_distinto')).toEqual([]);
    expect(controlarOrdenes([v], [], pos, ['LIQUIDEZ'], [{ fecha: '2026-10-13', ticker: 'MA', cantidad: 5 }]).some(x => x.tipo === 'movimiento_distinto')).toBe(true);
    expect(controlarOrdenes([v], [], pos, ['LIQUIDEZ'], []).some(x => x.tipo === 'sin_movimiento')).toBe(true);
  });
  it('sin la lista de ventas no se concilian (y una venta no cuenta como "compra sin conciliar")', () => {
    const c = controlarOrdenes([o({ lado: 'venta' })], [{ fecha: '2026-10-13', ticker: 'MA', cantidad: 9 }], pos);
    expect(c.filter(x => x.tipo === 'sin_movimiento' || x.tipo === 'movimiento_distinto')).toEqual([]);
  });
});

describe('órdenes estimadas', () => {
  it('se cuentan aparte y generan un aviso informativo', () => {
    const lista = [o({}), o({ origen: 'estimada', comision_usd: 7.83, comision_ars: null, mep: null })];
    const r = resumenOrdenes(lista);
    expect(r.estimadas).toBe(1);
    expect(r.comisionEstimadaUsd).toBe(7.83);
    expect(controlarOrdenes(lista, [{ fecha: '2026-10-13', ticker: 'MA', cantidad: 18 }], ['MA']).some(x => x.tipo === 'ordenes_estimadas')).toBe(true);
    expect(controlarOrdenes([o({})], [{ fecha: '2026-10-13', ticker: 'MA', cantidad: 9 }], ['MA']).some(x => x.tipo === 'ordenes_estimadas')).toBe(false);
  });
});
