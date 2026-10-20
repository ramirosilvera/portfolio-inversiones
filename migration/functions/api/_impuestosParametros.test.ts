import { describe, it, expect, vi } from 'vitest';
import { parsearIPC, factorIPC, escalarParams, escalarTramos, filasEstimadas, urlIPC, INDEC_IPC_SERIE } from './_impuestosParametros';

const respuesta = (filas: [string, number | null][]) => ({ data: filas, meta: [] });
const OFICIAL_2025 = {
  params: { minimoNoImponible: 384_728_044.57, casaHabitacion: 1_346_548_155.99 },
  escala: { tramos: [
    { hasta: 52_664_283.73, fijo: 0, alicuota: 0.005 },
    { hasta: 114_105_948.16, fijo: 263_321.42, alicuota: 0.0075 },
    { hasta: null, fijo: 724_133.89, alicuota: 0.01 },
  ] },
};
const existentes2025 = [
  { anio: 2025, clave: 'bp_params', valor: OFICIAL_2025.params, estimado: false },
  { anio: 2025, clave: 'bp_escala', valor: OFICIAL_2025.escala, estimado: false },
];
const ipc2026 = respuesta([['2025-09-01', 7000], ['2025-10-01', 7100], ['2026-10-01', 9500]]);

describe('parsearIPC / factorIPC', () => {
  it('lee la respuesta de la API de series y calcula octubre contra octubre', () => {
    const s = parsearIPC(ipc2026);
    expect(s.get('2025-10')).toBe(7100);
    expect(factorIPC(s, 2026)).toBeCloseTo(9500 / 7100, 10);
  });
  it('si falta alguno de los dos octubres no hay factor', () => {
    expect(factorIPC(parsearIPC(respuesta([['2025-10-01', 7100]])), 2026)).toBeNull();
    expect(factorIPC(parsearIPC(respuesta([['2026-10-01', 9500]])), 2026)).toBeNull();
  });
  it('ignora filas rotas y respuestas que no son lo esperado', () => {
    const s = parsearIPC({ data: [['2025-10-01', 7100], ['2026-10-01', null], ['basura', 5], 'x', ['2026-09-01', -3]] });
    expect([...s.keys()]).toEqual(['2025-10']);
    expect(parsearIPC(null).size).toBe(0);
    expect(parsearIPC({ data: 'no' }).size).toBe(0);
  });
  it('arma la URL de la serie nacional desde el octubre anterior', () => {
    expect(urlIPC('2025-10')).toContain(`ids=${INDEC_IPC_SERIE}`);
    expect(urlIPC('2025-10')).toContain('start_date=2025-10');
  });
});

describe('control de la fórmula con datos reales', () => {
  it('período 2024 × (1 + 31,31 %) reproduce el mínimo oficial 2025 con menos de 0,01 % de diferencia', () => {
    const est = escalarParams({ minimoNoImponible: 292_994_964.89, casaHabitacion: 0 }, 1.3131).minimoNoImponible;
    expect(Math.abs(est - 384_728_044.57) / 384_728_044.57).toBeLessThan(0.0001);
  });
});

describe('escalar', () => {
  it('multiplica montos (no alícuotas) y redondea a centavos; el tramo sin tope sigue sin tope', () => {
    const t = escalarTramos(OFICIAL_2025.escala.tramos, 1.5);
    expect(t[0]).toEqual({ hasta: 78_996_425.6, fijo: 0, alicuota: 0.005 });
    expect(t[2]).toEqual({ hasta: null, fijo: 1_086_200.84, alicuota: 0.01 });
  });
});

describe('filasEstimadas', () => {
  it('con la base oficial del año anterior y el IPC publicado devuelve las dos filas, marcadas estimadas', async () => {
    const obtener = vi.fn().mockResolvedValue(ipc2026);
    const filas = await filasEstimadas(2026, existentes2025, obtener);
    expect(filas.map(f => f.clave)).toEqual(['bp_params', 'bp_escala']);
    expect(filas.every(f => f.estimado && !f.verificado && f.anio === 2026)).toBe(true);
    expect((filas[0].valor as { minimoNoImponible: number }).minimoNoImponible).toBeCloseTo(384_728_044.57 * 9500 / 7100, 1);
    expect(filas[0].fuente).toMatch(/INDEC/);
    expect(obtener).toHaveBeenCalledWith('2025-10');
  });
  it('si ya hay una fila de ese año (oficial o estimada) no pide nada', async () => {
    const obtener = vi.fn();
    const ya = [...existentes2025, { anio: 2026, clave: 'bp_params', valor: OFICIAL_2025.params, estimado: true }];
    expect(await filasEstimadas(2026, ya, obtener)).toEqual([]);
    expect(obtener).not.toHaveBeenCalled();
  });
  it('no usa como base una fila estimada (no se acumulan estimaciones)', async () => {
    const obtener = vi.fn().mockResolvedValue(ipc2026);
    const soloEstimadas = existentes2025.map(f => ({ ...f, estimado: true }));
    expect(await filasEstimadas(2026, soloEstimadas, obtener)).toEqual([]);
    expect(obtener).not.toHaveBeenCalled();
  });
  it('sin base cargada o con base rota no hace nada', async () => {
    const obtener = vi.fn();
    expect(await filasEstimadas(2026, [], obtener)).toEqual([]);
    expect(await filasEstimadas(2026, [{ anio: 2025, clave: 'bp_params', valor: { x: 1 }, estimado: false }, existentes2025[1]], obtener)).toEqual([]);
    expect(obtener).not.toHaveBeenCalled();
  });
  it('si INDEC todavía no publicó octubre, no escribe nada', async () => {
    const aun = respuesta([['2025-10-01', 7100], ['2026-09-01', 9300]]);
    expect(await filasEstimadas(2026, existentes2025, async () => aun)).toEqual([]);
  });
  it('un factor absurdo (dato roto) no se guarda', async () => {
    const roto = respuesta([['2025-10-01', 7100], ['2026-10-01', 7100 * 50]]);
    expect(await filasEstimadas(2026, existentes2025, async () => roto)).toEqual([]);
  });
  it('si el fetch falla, la excepción sube (el cron la atrapa y reintenta mañana)', async () => {
    await expect(filasEstimadas(2026, existentes2025, async () => { throw new Error('red'); })).rejects.toThrow('red');
  });
});
