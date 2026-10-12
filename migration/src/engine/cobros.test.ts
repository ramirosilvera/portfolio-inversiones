import { describe, it, expect } from 'vitest';
import { resumenCobros, saldoInvertible, acreditadoEnLiquidez } from './cobros';
import type { Cobro } from '../types/domain';

const c = (over: Partial<Cobro>): Cobro => ({
  id: 'x', portfolio_id: 'p', posicion_id: null, ticker: 'AAPL', tipo: 'dividendo',
  fecha: '2026-01-01', monto: 100, estado: 'disponible', origen: 'manual', movimiento_id: null, nota: null,
  created_at: '2026-01-01T00:00:00Z', ...over,
});

describe('resumenCobros', () => {
  it('lista vacía → todo en cero', () => {
    expect(resumenCobros([])).toEqual({ total: 0, disponible: 0, reinvertido: 0, porTipo: { dividendo: 0, interes: 0, amortizacion: 0 } });
  });

  it('suma el total sin importar el tipo (la amortización SÍ es plata que entró)', () => {
    const r = resumenCobros([c({ monto: 100, tipo: 'dividendo' }), c({ monto: 50, tipo: 'interes' }), c({ monto: 200, tipo: 'amortizacion' })]);
    expect(r.total).toBe(350);
    expect(r.porTipo).toEqual({ dividendo: 100, interes: 50, amortizacion: 200 });
  });

  it('separa disponible vs reinvertido por estado', () => {
    const r = resumenCobros([c({ monto: 100, estado: 'disponible' }), c({ monto: 60, estado: 'reinvertido' })]);
    expect(r.disponible).toBe(100);
    expect(r.reinvertido).toBe(60);
    expect(r.total).toBe(160);
  });

  it('acumula varios cobros del mismo tipo', () => {
    const r = resumenCobros([c({ monto: 10, tipo: 'dividendo' }), c({ monto: 15, tipo: 'dividendo' }), c({ monto: 5, tipo: 'dividendo' })]);
    expect(r.porTipo.dividendo).toBe(30);
  });

  it('un cobro "pendiente" (generado por el cron, sin confirmar) NO suma a ningún total', () => {
    const r = resumenCobros([
      c({ monto: 100, estado: 'disponible' }),
      c({ monto: 999, estado: 'pendiente', origen: 'cron' }),
    ]);
    expect(r.total).toBe(100);
    expect(r.disponible).toBe(100);
    expect(r.porTipo.dividendo).toBe(100);
  });

  it('todo pendiente → resumen en cero (no solo "disponible" en cero)', () => {
    const r = resumenCobros([c({ monto: 500, estado: 'pendiente', origen: 'cron' })]);
    expect(r).toEqual({ total: 0, disponible: 0, reinvertido: 0, porTipo: { dividendo: 0, interes: 0, amortizacion: 0 } });
  });

  it('un cobro "descartado" tampoco suma a ningún total (allowlist, no un continue puntual por estado)', () => {
    const r = resumenCobros([
      c({ monto: 100, estado: 'disponible' }),
      c({ monto: 999, estado: 'descartado', origen: 'cron' }),
    ]);
    expect(r.total).toBe(100);
    expect(r.disponible).toBe(100);
  });

  it('un estado desconocido/futuro (no disponible/reinvertido) queda afuera por default', () => {
    // @ts-expect-error — a propósito: probar la robustez ante un estado que TypeScript no conoce
    // pero que igual podría llegar en runtime (dato viejo, columna nueva sin migrar el cliente, etc.)
    const r = resumenCobros([c({ monto: 100, estado: 'disponible' }), c({ monto: 50, estado: 'algo_nuevo' })]);
    expect(r.total).toBe(100);
  });
});

describe('saldoInvertible', () => {
  it('sin inversiones registradas → neto = disponible bruto', () => {
    const r = saldoInvertible(500, []);
    expect(r).toEqual({ disponibleBruto: 500, acreditado: 0, pasable: 500, invertido: 0, neto: 500, sobregirado: false });
  });

  it('resta la suma de inversiones del disponible', () => {
    const r = saldoInvertible(500, [{ monto: 100 }, { monto: 50 }]);
    expect(r.invertido).toBe(150);
    expect(r.neto).toBe(350);
    expect(r.sobregirado).toBe(false);
  });

  it('invertido == disponible → neto en 0, no negativo', () => {
    const r = saldoInvertible(200, [{ monto: 200 }]);
    expect(r.neto).toBe(0);
    expect(r.sobregirado).toBe(false);
  });

  it('invertido > disponible (ej. se editó/borró un cobro después) → neto clampeado a 0 pero marca sobregirado', () => {
    const r = saldoInvertible(100, [{ monto: 150 }]);
    expect(r.neto).toBe(0);
    expect(r.invertido).toBe(150);
    expect(r.sobregirado).toBe(true);
  });

  it('redondea a centavos, no arrastra error de punto flotante', () => {
    const r = saldoInvertible(10, [{ monto: 0.1 }, { monto: 0.2 }]);
    expect(r.invertido).toBe(0.3);
    expect(r.neto).toBe(9.7);
  });
});

describe('saldoInvertible con cobros ya acreditados en Liquidez', () => {
  it('lo acreditado ya está en el efectivo: no cuenta como saldo por pasar (evita duplicarlo)', () => {
    const s = saldoInvertible(100, [], 30);
    expect(s.neto).toBe(70);
    expect(s.pasable).toBe(70);
    expect(s.acreditado).toBe(30);
  });
  it('un pase a Liquidez (inversión del ledger) baja el saldo igual que cualquier inversión', () => {
    const s = saldoInvertible(100, [{ monto: 40 }], 30);
    expect(s.neto).toBe(30);
    expect(s.invertido).toBe(40);
  });
  it('sin acreditado el comportamiento es el de antes', () => {
    expect(saldoInvertible(100, [{ monto: 25 }])).toMatchObject({ neto: 75, invertido: 25, acreditado: 0, sobregirado: false });
  });
  it('si lo acreditado + lo invertido supera lo disponible, queda 0 y marca sobregiro', () => {
    const s = saldoInvertible(50, [{ monto: 40 }], 30);
    expect(s.neto).toBe(0);
    expect(s.sobregirado).toBe(true);
  });
  it('acreditadoEnLiquidez suma solo cobros DISPONIBLES con crédito en Liquidez', () => {
    const t = acreditadoEnLiquidez([
      { estado: 'disponible', monto: 12.07, liquidez_mov_id: 'm1' },
      { estado: 'disponible', monto: 5, liquidez_mov_id: null },
      { estado: 'reinvertido', monto: 9, liquidez_mov_id: 'm2' },
      { estado: 'pendiente', monto: 7, liquidez_mov_id: 'm3' },
    ]);
    expect(t).toBe(12.07);
  });
});
