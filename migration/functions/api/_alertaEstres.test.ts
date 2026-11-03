import { describe, it, expect } from 'vitest';
import { nuevoEstadoActivos } from './_alertaEstres';

const K = 'alerta_estres_activos';
const f = (clave: string, valor: number | null, data_json?: unknown) => ({ clave, valor, data_json });

describe('nuevoEstadoActivos (banda de histéresis en el servidor)', () => {
  it('primera vez: riesgo país 805 en rojo → se escribe [riesgo_pais]', () => {
    expect(nuevoEstadoActivos([f('riesgo_pais', 805)], K)).toEqual(['riesgo_pais']);
  });
  it('sin cambios → null (no se escribe)', () => {
    expect(nuevoEstadoActivos([f('riesgo_pais', 810), f(K, 1, ['riesgo_pais'])], K)).toBeNull();
  });
  it('banda: 790 con estado previo sigue; sin estado previo no alerta (se escribe la lista vacía una vez)', () => {
    expect(nuevoEstadoActivos([f('riesgo_pais', 790), f(K, 1, ['riesgo_pais'])], K)).toBeNull();
    expect(nuevoEstadoActivos([f('riesgo_pais', 790)], K)).toEqual([]);
  });
  it('sale de la banda: 740 con estado previo → se apaga', () => {
    expect(nuevoEstadoActivos([f('riesgo_pais', 740), f(K, 1, ['riesgo_pais'])], K)).toEqual([]);
  });
  it('un valor imposible (400 en HY spread, el incidente de octubre) no cuenta ni alerta', () => {
    expect(nuevoEstadoActivos([f('hy_spread', 400), f('vix', 20)], K)).toEqual([]);
  });
  it('sin ningún dato de indicadores no toca el estado', () => {
    expect(nuevoEstadoActivos([f('oro', 4500), f(K, 1, ['vix'])], K)).toBeNull();
    expect(nuevoEstadoActivos([], K)).toBeNull();
  });
  it('indicadores que no son de estrés (oro, bitcoin) se ignoran', () => {
    expect(nuevoEstadoActivos([f('oro', 9000), f('bitcoin', 200000), f('vix', 35)], K)).toEqual(['vix']);
  });
});
