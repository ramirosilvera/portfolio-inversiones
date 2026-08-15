import { describe, it, expect } from 'vitest';
import { tendenciaPrecio, contrastarConNegocio } from './tendenciaPrecio';

const semanal = (vals: number[], desde = '2021-01-01'): { fecha: string; close: number }[] =>
  vals.map((close, i) => {
    const d = new Date(desde);
    d.setDate(d.getDate() + i * 7);
    return { fecha: d.toISOString().slice(0, 10), close };
  });

describe('tendenciaPrecio', () => {
  it('serie vacía → todo null, no revienta', () => {
    expect(tendenciaPrecio([])).toEqual({ actual: null, var52sem: null, var5y: null, distanciaMax: null });
  });

  it('var5y = precio de hoy vs. el primer punto de la ventana', () => {
    const puntos = semanal([100, 110, 90, 150]);
    const t = tendenciaPrecio(puntos);
    expect(t.actual).toBe(150);
    expect(t.var5y).toBeCloseTo(150 / 100 - 1, 6);
  });

  it('var52sem = precio de hoy vs. ~52 semanas atrás (no vs. el inicio de toda la ventana)', () => {
    // 60 semanas: la semana 60-52=8 (índice 7, 0-based) es el "hace 1 año".
    const vals = Array.from({ length: 60 }, (_, i) => 100 + i);
    const puntos = semanal(vals);
    const t = tendenciaPrecio(puntos);
    const esperadoInicio1y = vals[60 - 53]; // idx1y = length-53
    expect(t.var52sem).toBeCloseTo(vals[59] / esperadoInicio1y - 1, 6);
  });

  it('menos de 1 año de historia (IPO reciente): var52sem es null, var5y sí se calcula', () => {
    const puntos = semanal([100, 105, 110]); // 3 semanas
    const t = tendenciaPrecio(puntos);
    expect(t.var52sem).toBeNull();
    expect(t.var5y).toBeCloseTo(110 / 100 - 1, 6);
  });

  it('distanciaMax: 0 si el precio de hoy ES el máximo de la ventana; negativo si no', () => {
    const enMaximos = tendenciaPrecio(semanal([80, 100, 90]));
    expect(enMaximos.distanciaMax).toBeCloseTo(90 / 100 - 1, 6);
    const enElMaximo = tendenciaPrecio(semanal([80, 90, 100]));
    expect(enElMaximo.distanciaMax).toBe(0);
  });
});

describe('contrastarConNegocio — el falsificador de value trap', () => {
  it('precio cayó pero el negocio (owner earnings) NO cayó → posible pánico, no deterioro', () => {
    expect(contrastarConNegocio(-0.20, 0.12)).toBe('posible-panico');
    expect(contrastarConNegocio(-0.20, 0)).toBe('posible-panico'); // negocio estable, no cayó
  });

  it('precio cayó Y el negocio también cayó → posible deterioro real, nada contradice la caída', () => {
    expect(contrastarConNegocio(-0.20, -0.15)).toBe('posible-deterioro');
  });

  it('precio subió pero el negocio cayó → euforia sin respaldo, también deterioro', () => {
    expect(contrastarConNegocio(0.30, -0.10)).toBe('posible-deterioro');
  });

  it('movimientos chicos (<5%) → sin señal clara, no fuerza una lectura de ruido', () => {
    expect(contrastarConNegocio(0.02, 0.01)).toBe('sin-señal-clara');
    expect(contrastarConNegocio(-0.03, 0.20)).toBe('sin-señal-clara');
  });

  it('sin datos de precio o de negocio → null (no inventa una lectura)', () => {
    expect(contrastarConNegocio(null, 0.1)).toBeNull();
    expect(contrastarConNegocio(-0.1, null)).toBeNull();
  });
});
