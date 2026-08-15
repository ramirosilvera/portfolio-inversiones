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
    expect(tendenciaPrecio([])).toEqual({ actual: null, var52sem: null, var5y: null, varVentana: null, anios: null, distanciaMax: null });
  });

  it('varVentana = precio de hoy vs. el primer punto de TODA la ventana recibida', () => {
    const puntos = semanal([100, 110, 90, 150]);
    const t = tendenciaPrecio(puntos);
    expect(t.actual).toBe(150);
    expect(t.varVentana).toBeCloseTo(150 / 100 - 1, 6);
  });

  it('con menos de 5 años de historia, var5y cae al primer punto disponible (igual que varVentana)', () => {
    const puntos = semanal([100, 110, 90, 150]); // 4 semanas, muy por debajo de 261
    const t = tendenciaPrecio(puntos);
    expect(t.var5y).toBeCloseTo(t.varVentana!, 6);
  });

  it('con más de 5 años de historia (ventana de 10 años), var5y usa SOLO los últimos ~5 años, distinto de varVentana', () => {
    // 10 años de semanas (~521), precio sube de 50 (hace 10a) a 100 (hace ~5a) y de 100 a 200 (hoy).
    const vals = Array.from({ length: 521 }, (_, i) => (i < 261 ? 50 + i * (50 / 260) : 100 + (i - 261) * (100 / 259)));
    const puntos = semanal(vals);
    const t = tendenciaPrecio(puntos);
    const actual = vals[520];
    const inicio5y = vals[521 - 261];
    const inicioVentana = vals[0];
    expect(t.var5y).toBeCloseTo(actual / inicio5y - 1, 6);
    expect(t.varVentana).toBeCloseTo(actual / inicioVentana - 1, 6);
    expect(t.var5y).not.toBeCloseTo(t.varVentana!, 2);
    expect(t.anios).toBe(10);
  });

  it('var52sem = precio de hoy vs. ~52 semanas atrás (no vs. el inicio de toda la ventana)', () => {
    // 60 semanas: la semana 60-53=7 (índice, 0-based) es el "hace 1 año".
    const vals = Array.from({ length: 60 }, (_, i) => 100 + i);
    const puntos = semanal(vals);
    const t = tendenciaPrecio(puntos);
    const esperadoInicio1y = vals[60 - 53]; // idx1y = length-53
    expect(t.var52sem).toBeCloseTo(vals[59] / esperadoInicio1y - 1, 6);
  });

  it('menos de 1 año de historia (IPO reciente): var52sem es null, varVentana sí se calcula', () => {
    const puntos = semanal([100, 105, 110]); // 3 semanas
    const t = tendenciaPrecio(puntos);
    expect(t.var52sem).toBeNull();
    expect(t.varVentana).toBeCloseTo(110 / 100 - 1, 6);
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
