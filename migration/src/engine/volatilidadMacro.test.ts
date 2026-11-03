import { describe, it, expect } from 'vitest';
import { variacionesDiarias, percentilAbs, salidaSugerida, MIN_VARIACIONES } from './volatilidadMacro';

const serie = (vals: number[]) => vals.map((valor, i) => ({ fecha: `2026-01-${String(i + 1).padStart(2, '0')}`, valor }));

describe('volatilidad macro', () => {
  it('variaciones relativas entre días consecutivos, ordenadas por fecha y sin valores inválidos', () => {
    expect(variacionesDiarias([{ fecha: '2026-01-02', valor: 110 }, { fecha: '2026-01-01', valor: 100 }, { fecha: '2026-01-03', valor: 0 }])).toEqual([0.10000000000000009]);
  });
  it('percentil sobre valores absolutos con interpolación', () => {
    expect(percentilAbs([-0.02, 0.01, 0.03, -0.04], 0.5)).toBeCloseTo(0.025, 10);
    expect(percentilAbs([], 0.75)).toBeNull();
  });
  it('con pocos datos no sugiere nada', () => {
    expect(salidaSugerida(serie([100, 101, 102]), 30, 'sube')).toBeNull();
    expect(MIN_VARIACIONES).toBe(20);
  });
  it('serie de ±5 % por día: el rojo de 30 (sube) sale ≈ 10 % más abajo (2 ruedas de P75)', () => {
    const v: number[] = [100]; for (let i = 0; i < 30; i++) v.push(v[v.length - 1] * (i % 2 ? 1.05 : 0.95238095));
    const r = salidaSugerida(serie(v.map(x => x)).slice(0, 31).map((p, i) => ({ ...p, fecha: `2026-02-${String(i + 1).padStart(2, '0')}` })), 30, 'sube')!;
    expect(r.movDiarioP75).toBeCloseTo(0.05, 2);
    expect(r.salida).toBeCloseTo(30 * 0.9, 0);
  });
  it('rojo hacia abajo (ADR YPF): la salida queda por ENCIMA del umbral', () => {
    const v: number[] = [100]; for (let i = 0; i < 25; i++) v.push(v[v.length - 1] * (i % 2 ? 1.02 : 1 / 1.02));
    const r = salidaSugerida(v.map((valor, i) => ({ fecha: `2026-03-${String(i + 1).padStart(2, '0')}`, valor })), 25, 'baja')!;
    expect(r.salida).toBeGreaterThan(25);
  });
  it('tope: una serie enloquecida no da una banda de más de 50 %', () => {
    const v: number[] = [100]; for (let i = 0; i < 25; i++) v.push(v[v.length - 1] * (i % 2 ? 1.6 : 0.5));
    expect(salidaSugerida(v.map((valor, i) => ({ fecha: `2026-04-${String(i + 1).padStart(2, '0')}`, valor })), 30, 'sube')!.salida).toBeCloseTo(15, 6);
  });
});
