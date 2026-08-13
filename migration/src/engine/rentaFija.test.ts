import { describe, it, expect } from 'vitest';
import { calcularBonoReferencia, type BonoReferencia } from './rentaFija';
import type { CronogramaItem } from './coupons';

const cronograma: CronogramaItem[] = [
  { fecha: '2027-01-24', interes: 0.03, amortizacion: 0, saldo_residual: 1 },
  { fecha: '2027-07-24', interes: 0.03, amortizacion: 1, saldo_residual: 0 },
];

const ref: BonoReferencia = {
  ticker: 'TEST30',
  tipo: 'soberano',
  instrumento: 'BOND',
  moneda: 'USD',
  nombre: 'Test bond',
  emision: '2020-01-01',
  vencimiento: '2027-07-24',
  amortizable: false,
  valor_residual: 1,
  cronograma,
  fuente: 'IOL',
  actualizado_en: '2026-08-01T00:00:00Z',
};

describe('calcularBonoReferencia', () => {
  it('sin precio de mercado: paridad/tir/duracion null, pero conserva la referencia', () => {
    const r = calcularBonoReferencia(ref, null, '2026-07-24');
    expect(r.ref).toBe(ref);
    expect(r.px).toBeNull();
    expect(r.paridad).toBeNull();
    expect(r.tir).toBeNull();
    expect(r.duracion).toBeNull();
  });

  it('con precio: paridad = px*100, tir y duración calculadas', () => {
    const r = calcularBonoReferencia(ref, 0.9, '2026-07-24');
    expect(r.paridad).toBeCloseTo(90, 6);
    expect(r.tir).not.toBeNull();
    expect(r.tir!).toBeGreaterThan(0);
    expect(r.duracion).not.toBeNull();
    expect(r.duracion!.macaulay).toBeGreaterThan(0);
    expect(r.duracion!.modified).toBeLessThan(r.duracion!.macaulay);
  });

  it('bono ya vencido (cronograma sin flujos futuros): tir/duracion null, no rompe', () => {
    const r = calcularBonoReferencia(ref, 0.9, '2030-01-01');
    expect(r.tir).toBeNull();
    expect(r.duracion).toBeNull();
  });
});
