import { describe, it, expect } from 'vitest';
import { tasaOperacion, estimarComisionOperacion, brokerPrincipal, TASA_OPERACION_GENERAL } from './costosOperacion';

describe('costosOperacion', () => {
  it('usa la tasa del broker y, si no la tiene, la general', () => {
    expect(tasaOperacion({ comision_operacion: 0.01148 })).toBe(0.01148);
    expect(tasaOperacion({ comision_operacion: null })).toBe(TASA_OPERACION_GENERAL);
    expect(tasaOperacion(null)).toBe(TASA_OPERACION_GENERAL);
    expect(tasaOperacion({ comision_operacion: 5 })).toBe(TASA_OPERACION_GENERAL);       // tasa absurda → general
  });
  it('reproduce el costo de tus boletos de BBVA (MA 100 u: $2.714.000 → comisión+gastos+IVA $31.147,19)', () => {
    const tasa = (0.0605 + 0.8985 * 1.21) / 100;                                         // 1,148 %
    expect(Math.abs(2_714_000 * tasa - 31_147.19)).toBeLessThan(1.5);          // diferencia = redondeo de los porcentajes del boleto
    expect(estimarComisionOperacion(1791.7, 0.01148)).toBeCloseTo(20.57, 2);
  });
  it('reproduce lo observado en IOL en pesos con su tasa propia (0,67 %)', () => {
    expect(estimarComisionOperacion(193781.09 - 1281.09, 0.0067)).toBeCloseTo(1289.8, 1);
  });
  it('la tasa general (broker sin dato) es 1 %', () => {
    expect(TASA_OPERACION_GENERAL).toBe(0.01);
    expect(estimarComisionOperacion(1000, TASA_OPERACION_GENERAL)).toBe(10);
  });
  it('monto inválido o negativo → 0', () => {
    expect(estimarComisionOperacion(-10, 0.01)).toBe(0);
    expect(estimarComisionOperacion(NaN, 0.01)).toBe(0);
  });
  it('broker principal = el de mayor cantidad', () => {
    expect(brokerPrincipal([{ brokerId: 'a', cantidad: 44 }, { brokerId: 'b', cantidad: 113 }])).toBe('b');
    expect(brokerPrincipal([])).toBeNull();
  });
});
