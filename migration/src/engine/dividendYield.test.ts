import { describe, it, expect } from 'vitest';
import { rendimientoDividendos, tickersConCobroReciente } from './dividendYield';
import { calcularCedear } from './cedears';
import { netoSobreBruto } from './impuestos';
import type { DividendoInfo } from './dividendProjection';
import type { Posicion } from '../types/domain';

const pos = (o: Partial<Posicion>): Posicion => ({
  id: o.ticker ?? 'x', portfolio_id: 'p', tipo: 'cedear', ticker: 'UNH', empresa: null, sector: null, rol: null,
  cantidad: 33, precio_compra: 10, fecha_compra: '2025-01-01', peso_objetivo: null, ratio_cedear: 33,
  tir_esperada: null, beta: null, cupon_tasa: null, cupon_frecuencia: null, cupon_mes: null, vencimiento: null,
  calificadora: null, calificacion: null, notas: null, created_at: '2025-01-01', ...o,
} as Posicion);

// UNH: 33 CEDEARs con ratio 33 = 1 acción. Trimestral de US$ 2,32 (declarado) → 4 pagos en 12 meses = US$ 9,28.
const trimestral = (monto: number, proxima: string): DividendoInfo =>
  ({ proximaFecha: proxima, montoPorAccion: monto, estado: 'declarado', frecuenciaAnual: 4 });
const SIN_DATO: DividendoInfo = { proximaFecha: null, montoPorAccion: null, estado: 'sin-dato', frecuenciaAnual: null };

describe('rendimientoDividendos', () => {
  it('un pagador trimestral: monto × 4 pagos al año sobre el valor de mercado (acción 400 → 9,28 / 400)', () => {
    const c = calcularCedear(pos({ ticker: 'UNH' }), 400);   // 33 CEDEARs / ratio 33 × 400 = US$ 400
    const r = rendimientoDividendos([c], { UNH: trimestral(2.32, '2026-11-10') });
    expect(r.dividendoAnualUsd).toBeCloseTo(9.28, 2);
    expect(r.yieldMercado).toBeCloseTo(9.28 / 400, 6);
    expect(r.porPosicion['UNH'].estado).toBe('declarado');
    expect(r.pagadores).toBe(1);
  });

  it('escala por nominales ÷ ratio: 66 CEDEARs de ratio 33 cobran por 2 acciones', () => {
    const c = calcularCedear(pos({ ticker: 'UNH', cantidad: 66 }), 400);
    const r = rendimientoDividendos([c], { UNH: trimestral(2.32, '2026-11-10') });
    expect(r.dividendoAnualUsd).toBeCloseTo(18.56, 2);
    expect(r.yieldMercado).toBeCloseTo(9.28 / 400, 6);   // el % no cambia con la cantidad
  });

  it('el promedio de la cartera INCLUYE a los que no pagan (MELI/LAC cuentan como 0 %)', () => {
    const unh = calcularCedear(pos({ ticker: 'UNH' }), 400);                       // US$ 400, paga 9,28
    const meli = calcularCedear(pos({ ticker: 'MELI', id: 'MELI', ratio_cedear: 120, cantidad: 120 }), 400); // US$ 400, no paga
    const r = rendimientoDividendos([unh, meli], { UNH: trimestral(2.32, '2026-11-10'), MELI: SIN_DATO });
    expect(r.yieldMercado).toBeCloseTo(9.28 / 800, 6);   // la mitad del de UNH
    expect(r.porPosicion['MELI'].estado).toBe('sin-pago');
    expect(r.porPosicion['MELI'].yieldMercado).toBe(0);
    expect(r.pagadores).toBe(1);
    expect(r.sinPago).toBe(1);
  });

  it('sin información del proveedor NO es «no paga»: queda fuera del numerador y del denominador', () => {
    const unh = calcularCedear(pos({ ticker: 'UNH' }), 400);
    const ma = calcularCedear(pos({ ticker: 'MA', id: 'MA' }), 400);
    const r = rendimientoDividendos([unh, ma], { UNH: trimestral(2.32, '2026-11-10') });   // MA sin respuesta
    expect(r.yieldMercado).toBeCloseTo(9.28 / 400, 6);   // solo UNH; no se diluye con MA
    expect(r.porPosicion['MA'].estado).toBe('sin-info');
    expect(r.porPosicion['MA'].yieldMercado).toBeNull();
    expect(r.sinInfo).toBe(1);
  });

  it('NO depende del calendario: el mismo pagador trimestral da igual con el próximo pago en 1 o en 3 meses (caso WMT)', () => {
    const c = calcularCedear(pos({ ticker: 'UNH' }), 400);
    const cerca = rendimientoDividendos([c], { UNH: trimestral(2.32, '2026-11-10') });
    const lejos = rendimientoDividendos([c], { UNH: trimestral(2.32, '2027-01-04') });
    expect(lejos.yieldMercado).toBeCloseTo(cerca.yieldMercado!, 10);
  });

  it('un pago declarado pero sin cadencia conocida no se anualiza a ojo: sin-info', () => {
    const c = calcularCedear(pos({ ticker: 'UNH' }), 400);
    const r = rendimientoDividendos([c], { UNH: { proximaFecha: '2026-11-10', montoPorAccion: 2.32, estado: 'declarado', frecuenciaAnual: null } });
    expect(r.porPosicion['UNH'].estado).toBe('sin-info');
  });

  it('un CEDEAR sin ratio no se convierte (no se inventa un dividendo): sin-info', () => {
    const c = calcularCedear(pos({ ticker: 'UNH', ratio_cedear: null }), 400);
    const r = rendimientoDividendos([c], { UNH: trimestral(2.32, '2026-11-10') });
    expect(r.porPosicion['UNH'].estado).toBe('sin-info');
    expect(r.yieldMercado).toBeNull();
  });

  it('estimado por cadencia (el proveedor no declaró el próximo) se marca «estimado»', () => {
    const c = calcularCedear(pos({ ticker: 'UNH' }), 400);
    const r = rendimientoDividendos([c], { UNH: { ...trimestral(2.32, '2026-11-10'), estado: 'estimado' } });
    expect(r.porPosicion['UNH'].estado).toBe('estimado');
  });

  it('sobre costo y neto estimado: costo 330 → 9,28 / 330; neto = bruto × tasas generales', () => {
    const c = calcularCedear(pos({ ticker: 'UNH', precio_compra: 10 }), 400);   // costo 33 × 10 = 330
    const r = rendimientoDividendos([c], { UNH: trimestral(2.32, '2026-11-10') });
    expect(r.yieldCosto).toBeCloseTo(9.28 / 330, 6);
    expect(r.yieldNeto).toBeCloseTo((9.28 / 400) * netoSobreBruto(), 6);
    expect(r.yieldNeto!).toBeLessThan(r.yieldMercado!);
  });

  it('sin cotización usa el costo como base (igual que el resto de los resúmenes de CEDEARs)', () => {
    const c = calcularCedear(pos({ ticker: 'UNH', precio_compra: 10 }), null);
    const r = rendimientoDividendos([c], { UNH: trimestral(2.32, '2026-11-10') });
    expect(r.yieldMercado).toBeCloseTo(9.28 / 330, 6);
  });

  it('cartera vacía o todo sin información: sin porcentaje, no 0 %', () => {
    expect(rendimientoDividendos([], {}).yieldMercado).toBeNull();
    const c = calcularCedear(pos({ ticker: 'UNH' }), 400);
    expect(rendimientoDividendos([c], {}).yieldMercado).toBeNull();
  });

  it('el ticker se busca sin importar mayúsculas (el proveedor devuelve en mayúscula)', () => {
    const c = calcularCedear(pos({ ticker: 'unh' }), 400);
    const r = rendimientoDividendos([c], { UNH: trimestral(2.32, '2026-11-10') });
    expect(r.yieldMercado).not.toBeNull();
  });
});

describe('DIV-05: el proveedor dice «sin dividendos» pero ya cobraste', () => {
  it('un ticker con cobro reciente NO se cuenta como «no paga»: queda sin-dato y fuera del promedio', () => {
    const unh = calcularCedear(pos({ ticker: 'UNH' }), 400);
    const mrk = calcularCedear(pos({ ticker: 'MRK', id: 'MRK', ratio_cedear: 5, cantidad: 5 }), 400);
    const r = rendimientoDividendos([unh, mrk], { UNH: trimestral(2.32, '2026-11-10'), MRK: SIN_DATO }, new Set(['MRK']));
    expect(r.porPosicion['MRK'].estado).toBe('sin-info');
    expect(r.yieldMercado).toBeCloseTo(9.28 / 400, 6);   // no se diluye con un 0 % falso
    expect(r.sinPago).toBe(0);
  });

  it('sin cobros, «sin dividendos» sigue siendo «no paga» (LAC, MELI)', () => {
    const meli = calcularCedear(pos({ ticker: 'MELI', id: 'MELI', ratio_cedear: 120, cantidad: 120 }), 400);
    const r = rendimientoDividendos([meli], { MELI: SIN_DATO }, new Set());
    expect(r.porPosicion['MELI'].estado).toBe('sin-pago');
  });
});

describe('tickersConCobroReciente', () => {
  const cobro = (o: Partial<{ ticker: string; tipo: string; estado: string; fecha: string }>) =>
    ({ ticker: 'MRK', tipo: 'dividendo', estado: 'disponible', fecha: '2026-07-08', ...o });

  it('cuenta dividendos confirmados (disponible/reinvertido) dentro de la ventana', () => {
    const s = tickersConCobroReciente([cobro({}), cobro({ ticker: 'ma', estado: 'reinvertido' })], '2026-10-25');
    expect([...s].sort()).toEqual(['MA', 'MRK']);
  });

  it('ignora pendientes, descartados, intereses y cobros viejos (> 400 días)', () => {
    const s = tickersConCobroReciente([
      cobro({ estado: 'pendiente' }), cobro({ ticker: 'A', estado: 'descartado' }), cobro({ ticker: 'B', tipo: 'interes' }),
      cobro({ ticker: 'C', fecha: '2025-01-10' }),
    ], '2026-10-25');
    expect(s.size).toBe(0);
  });
});

