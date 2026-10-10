import { describe, it, expect } from 'vitest';
import {
  sugerirDividendoPendiente, sugerirCuponPendiente, sugerirCuponesDeCronograma, cronogramaVigente, cantidadAlCorte,
  sugerirDividendosHistoricos, sugerirCuponesHistoricos,
  type PosicionParaCobro,
} from './_cobros_pendientes';
import type { DividendoInfo, DividendEvent } from './_dividendos';

const pos = (over: Partial<PosicionParaCobro> = {}): PosicionParaCobro => ({
  id: 'p1', portfolio_id: 'pf1', ticker: 'AAPL', tipo: 'accion', cantidad: 10, ratio_cedear: null,
  cupon_tasa: null, cupon_frecuencia: null, cupon_mes: null, vencimiento: null, ...over,
});
const div = (over: Partial<DividendoInfo> = {}): DividendoInfo =>
  ({ proximaFecha: '2026-06-01', montoPorAccion: 1, estado: 'declarado', frecuenciaAnual: 4, ...over });

describe('sugerirDividendoPendiente', () => {
  it('acción directa: monto = por acción × cantidad, sin dividir por nada', () => {
    const r = sugerirDividendoPendiente(pos({ tipo: 'accion', cantidad: 10 }), div({ montoPorAccion: 2 }), '2026-06-01');
    expect(r?.monto).toBe(20);
    expect(r?.tipo).toBe('dividendo');
  });

  it('CEDEAR CON ratio: divide por el ratio (el error más grande si se omite)', () => {
    const r = sugerirDividendoPendiente(pos({ tipo: 'cedear', cantidad: 100, ratio_cedear: 20 }), div({ montoPorAccion: 1 }), '2026-06-01');
    expect(r?.monto).toBe(5); // 1 * 100 / 20
  });

  it('CEDEAR SIN ratio cargado: no sugiere nada (mejor nada que un monto 20x mal)', () => {
    const r = sugerirDividendoPendiente(pos({ tipo: 'cedear', cantidad: 100, ratio_cedear: null }), div({ montoPorAccion: 1 }), '2026-06-01');
    expect(r).toBeNull();
  });

  it('la fecha proyectada todavía no llegó → no sugiere', () => {
    const r = sugerirDividendoPendiente(pos(), div({ proximaFecha: '2026-12-01' }), '2026-06-01');
    expect(r).toBeNull();
  });

  it('sin dato de dividendo (sin-dato o null) → no sugiere', () => {
    expect(sugerirDividendoPendiente(pos(), null, '2026-06-01')).toBeNull();
    expect(sugerirDividendoPendiente(pos(), div({ estado: 'sin-dato', proximaFecha: null, montoPorAccion: null }), '2026-06-01')).toBeNull();
  });

  it('bono o cash nunca generan dividendo pendiente (van por sugerirCuponPendiente)', () => {
    expect(sugerirDividendoPendiente(pos({ tipo: 'bono' }), div(), '2026-06-01')).toBeNull();
    expect(sugerirDividendoPendiente(pos({ tipo: 'cash' }), div(), '2026-06-01')).toBeNull();
  });

  it('accion_ar NUNCA sugiere (el ticker puede compartirse con un ADR/CEDEAR de otro portfolio, y ' +
     'no hay ratio conocido entre el ADR en USD y la acción local — mezclarlos infla el monto un orden de magnitud)', () => {
    expect(sugerirDividendoPendiente(pos({ tipo: 'accion_ar', ticker: 'GGAL', cantidad: 500 }), div({ montoPorAccion: 5 }), '2026-06-01')).toBeNull();
  });

  it('posición cerrada (cantidad 0) → no sugiere', () => {
    expect(sugerirDividendoPendiente(pos({ cantidad: 0 }), div(), '2026-06-01')).toBeNull();
  });

  it('estado "estimado" igual sugiere, pero la nota lo aclara (no es una fecha confirmada)', () => {
    const r = sugerirDividendoPendiente(pos(), div({ estado: 'estimado' }), '2026-06-01');
    expect(r).not.toBeNull();
    expect(r?.nota).toContain('estimado');
  });
});

describe('sugerirCuponPendiente', () => {
  const bono = (over: Partial<PosicionParaCobro> = {}): PosicionParaCobro =>
    pos({ tipo: 'bono', cantidad: 1000, cupon_tasa: 0.08, cupon_frecuencia: 2, cupon_mes: 6, ...over });

  it('mes de pago (semestral desde junio → jun y dic): monto = tasa/frecuencia × nominales', () => {
    const r = sugerirCuponPendiente(bono(), '2026-06-15');
    expect(r?.monto).toBe(40); // 0.08/2 * 1000
    expect(r?.fecha).toBe('2026-06-01');
    expect(r?.tipo).toBe('interes');
  });

  it('el otro mes de pago (diciembre) también dispara', () => {
    const r = sugerirCuponPendiente(bono(), '2026-12-20');
    expect(r?.fecha).toBe('2026-12-01');
  });

  it('un mes que NO es de pago → no sugiere', () => {
    expect(sugerirCuponPendiente(bono(), '2026-07-15')).toBeNull();
  });

  it('sin los 4 campos de cupón cargados → no sugiere', () => {
    expect(sugerirCuponPendiente(bono({ cupon_tasa: null }), '2026-06-15')).toBeNull();
    expect(sugerirCuponPendiente(bono({ cupon_frecuencia: null }), '2026-06-15')).toBeNull();
    expect(sugerirCuponPendiente(bono({ cupon_mes: null }), '2026-06-15')).toBeNull();
  });

  it('bono ya vencido → no sigue pagando', () => {
    expect(sugerirCuponPendiente(bono({ vencimiento: '2026-01-01' }), '2026-06-15')).toBeNull();
  });

  it('no es tipo bono → no sugiere cupón', () => {
    expect(sugerirCuponPendiente(pos({ tipo: 'accion', cupon_tasa: 0.08, cupon_frecuencia: 2, cupon_mes: 6 }), '2026-06-15')).toBeNull();
  });

  it('reintentar el cron el mismo mes da la MISMA fecha (día 1 fijo) — así dedupe la capa de arriba', () => {
    const a = sugerirCuponPendiente(bono(), '2026-06-05');
    const b = sugerirCuponPendiente(bono(), '2026-06-28');
    expect(a?.fecha).toBe(b?.fecha);
  });
});

describe('sugerirDividendosHistoricos (primera carga: recorre TODO el historial, no solo "hoy")', () => {
  const ev = (over: Partial<DividendEvent> = {}): DividendEvent =>
    ({ date: '2026-03-15', adjDividend: 1, dividend: 1, paymentDate: '2026-03-20', recordDate: null, declarationDate: null, ...over });

  it('acción directa: un evento dentro del rango → una sugerencia, sin dividir por nada', () => {
    const r = sugerirDividendosHistoricos(pos({ tipo: 'accion', cantidad: 10 }), [ev({ adjDividend: 2 })], '2026-01-01', '2026-07-30');
    expect(r).toHaveLength(1);
    expect(r[0].monto).toBe(20);
    expect(r[0].fecha).toBe('2026-03-20'); // usa paymentDate si está
  });

  it('varios pagos reales dentro del año → una sugerencia por cada uno', () => {
    const historical = [
      ev({ date: '2026-01-10', paymentDate: '2026-01-15', adjDividend: 1 }),
      ev({ date: '2026-04-10', paymentDate: '2026-04-15', adjDividend: 1 }),
      ev({ date: '2026-07-10', paymentDate: '2026-07-15', adjDividend: 1 }),
    ];
    const r = sugerirDividendosHistoricos(pos({ tipo: 'accion', cantidad: 5 }), historical, '2026-01-01', '2026-07-30');
    expect(r).toHaveLength(3);
    expect(r.map(x => x.fecha)).toEqual(['2026-01-15', '2026-04-15', '2026-07-15']);
  });

  it('CEDEAR: divide por el ratio igual que la sugerencia del cron', () => {
    const r = sugerirDividendosHistoricos(pos({ tipo: 'cedear', cantidad: 100, ratio_cedear: 20 }), [ev({ adjDividend: 1 })], '2026-01-01', '2026-07-30');
    expect(r[0].monto).toBe(5); // 1 * 100 / 20
  });

  it('CEDEAR sin ratio → no sugiere nada (mismo criterio que el cron)', () => {
    expect(sugerirDividendosHistoricos(pos({ tipo: 'cedear', cantidad: 100, ratio_cedear: null }), [ev()], '2026-01-01', '2026-07-30')).toEqual([]);
  });

  it('eventos fuera del rango [desde,hasta] quedan afuera', () => {
    const historical = [ev({ date: '2025-12-01', paymentDate: '2025-12-05' }), ev({ date: '2026-08-01', paymentDate: '2026-08-05' })];
    expect(sugerirDividendosHistoricos(pos(), historical, '2026-01-01', '2026-07-30')).toEqual([]);
  });

  it('bono, cash y accion_ar nunca generan dividendo histórico', () => {
    expect(sugerirDividendosHistoricos(pos({ tipo: 'bono' }), [ev()], '2026-01-01', '2026-07-30')).toEqual([]);
    expect(sugerirDividendosHistoricos(pos({ tipo: 'cash' }), [ev()], '2026-01-01', '2026-07-30')).toEqual([]);
    expect(sugerirDividendosHistoricos(pos({ tipo: 'accion_ar' }), [ev()], '2026-01-01', '2026-07-30')).toEqual([]);
  });

  it('sin historial (null o vacío) → lista vacía, no rompe', () => {
    expect(sugerirDividendosHistoricos(pos(), null, '2026-01-01', '2026-07-30')).toEqual([]);
    expect(sugerirDividendosHistoricos(pos(), [], '2026-01-01', '2026-07-30')).toEqual([]);
  });

  it('posición cerrada (cantidad 0) → no sugiere', () => {
    expect(sugerirDividendosHistoricos(pos({ cantidad: 0 }), [ev()], '2026-01-01', '2026-07-30')).toEqual([]);
  });

  it('monto que redondea a 0 (posición muy chica) → se descarta', () => {
    const r = sugerirDividendosHistoricos(pos({ tipo: 'cedear', cantidad: 1, ratio_cedear: 1000 }), [ev({ adjDividend: 0.001 })], '2026-01-01', '2026-07-30');
    expect(r).toEqual([]);
  });

  it('sin paymentDate usa la ex-date como fecha del evento', () => {
    const r = sugerirDividendosHistoricos(pos(), [ev({ paymentDate: null, date: '2026-05-01' })], '2026-01-01', '2026-07-30');
    expect(r[0].fecha).toBe('2026-05-01');
  });
});

describe('sugerirCuponesHistoricos (primera carga: recorre mes a mes en el rango, no solo "hoy")', () => {
  const bono = (over: Partial<PosicionParaCobro> = {}): PosicionParaCobro =>
    pos({ tipo: 'bono', cantidad: 1000, cupon_tasa: 0.08, cupon_frecuencia: 4, cupon_mes: 1, ...over }); // trimestral: ene/abr/jul/oct

  it('trimestral desde enero, rango ene-jul → 3 cupones (ene, abr, jul)', () => {
    const r = sugerirCuponesHistoricos(bono(), '2026-01-01', '2026-07-30');
    expect(r.map(x => x.fecha)).toEqual(['2026-01-01', '2026-04-01', '2026-07-01']);
    expect(r[0].monto).toBe(20); // 0.08/4 * 1000
    expect(r.every(x => x.tipo === 'interes')).toBe(true);
  });

  it('rango de un solo mes que SÍ es de pago → un cupón', () => {
    const r = sugerirCuponesHistoricos(bono(), '2026-04-01', '2026-04-30');
    expect(r).toHaveLength(1);
    expect(r[0].fecha).toBe('2026-04-01');
  });

  it('rango que no incluye ningún mes de pago → vacío', () => {
    expect(sugerirCuponesHistoricos(bono(), '2026-02-01', '2026-03-31')).toEqual([]);
  });

  it('vencimiento a mitad de rango → no genera cupones después de vencer', () => {
    const r = sugerirCuponesHistoricos(bono({ vencimiento: '2026-05-01' }), '2026-01-01', '2026-07-30');
    expect(r.map(x => x.fecha)).toEqual(['2026-01-01', '2026-04-01']); // julio ya venció
  });

  it('sin los 4 campos de cupón cargados → vacío', () => {
    expect(sugerirCuponesHistoricos(bono({ cupon_tasa: null }), '2026-01-01', '2026-07-30')).toEqual([]);
  });

  it('no es bono → vacío', () => {
    expect(sugerirCuponesHistoricos(pos({ tipo: 'accion', cupon_tasa: 0.08, cupon_frecuencia: 4, cupon_mes: 1 }), '2026-01-01', '2026-07-30')).toEqual([]);
  });

  it('rango que cruza fin de año → sigue contando meses bien', () => {
    const r = sugerirCuponesHistoricos(bono({ cupon_mes: 12, cupon_frecuencia: 2 }), '2025-11-01', '2026-01-31'); // semestral: jun/dic
    expect(r.map(x => x.fecha)).toEqual(['2025-12-01']);
  });

  it('posición cerrada (cantidad 0) → vacío', () => {
    expect(sugerirCuponesHistoricos(bono({ cantidad: 0 }), '2026-01-01', '2026-07-30')).toEqual([]);
  });
});

describe('sugerirCuponesDeCronograma (fecha exacta de pago)', () => {
  const bono = (over: Partial<PosicionParaCobro> = {}): PosicionParaCobro =>
    pos({ tipo: 'bono', cantidad: 2400, cupon_tasa: 0.08, cupon_frecuencia: 2, cupon_mes: 10, ...over });
  const crono = [
    { fecha: '2026-10-14', interes: 0.04, amortizacion: 0 },
    { fecha: '2027-04-14', interes: 0.04, amortizacion: 0 },
    { fecha: '2027-10-14T00:00:00', interes: 0.04, amortizacion: 1 },
  ];

  it('sugiere el cupón en su día real (no el día 1) con monto = nominales × interés', () => {
    const r = sugerirCuponesDeCronograma(bono(), crono, '2026-09-20', '2026-10-14');
    expect(r).toHaveLength(1);
    expect(r[0].fecha).toBe('2026-10-14');
    expect(r[0].monto).toBe(96);
  });
  it('antes de la fecha de pago todavía no sugiere nada', () => {
    expect(sugerirCuponesDeCronograma(bono(), crono, '2026-09-10', '2026-10-13')).toEqual([]);
  });
  it('acepta fechas del cronograma con timestamp', () => {
    expect(sugerirCuponesDeCronograma(bono(), crono, '2027-10-01', '2027-10-20')[0].fecha).toBe('2027-10-14');
  });
  it('un cupón anterior a la compra no es tuyo', () => {
    expect(sugerirCuponesDeCronograma(bono({ fecha_compra: '2026-10-20' }), crono, '2026-09-20', '2026-10-31')).toEqual([]);
    expect(sugerirCuponesDeCronograma(bono({ fecha_compra: '2026-10-14' }), crono, '2026-09-20', '2026-10-31')).toHaveLength(1);
  });
  it('no sugiere después del vencimiento ni sin posición abierta ni para no-bonos', () => {
    expect(sugerirCuponesDeCronograma(bono({ vencimiento: '2026-09-01' }), crono, '2026-09-20', '2026-10-31')).toEqual([]);
    expect(sugerirCuponesDeCronograma(bono({ cantidad: 0 }), crono, '2026-09-20', '2026-10-31')).toEqual([]);
    expect(sugerirCuponesDeCronograma(pos({ tipo: 'cedear' }), crono, '2026-09-20', '2026-10-31')).toEqual([]);
  });
});

describe('cronogramaVigente', () => {
  it('vigente si hay algún flujo hoy o a futuro', () => {
    expect(cronogramaVigente([{ fecha: '2026-10-14', interes: 0.04 }], '2026-10-14')).toBe(true);
  });
  it('catálogo viejo (todos los flujos pasaron) o vacío o inválido → no sirve, se usa el cálculo sintético', () => {
    expect(cronogramaVigente([{ fecha: '2026-01-14', interes: 0.04 }], '2026-10-14')).toBe(false);
    expect(cronogramaVigente([], '2026-10-14')).toBe(false);
    expect(cronogramaVigente(null, '2026-10-14')).toBe(false);
    expect(cronogramaVigente([{ fecha: 'xx', interes: 0.04 }], '2026-10-14')).toBe(false);
  });
});

describe('cantidadAlCorte (solo cobra quien tenía la acción antes del ex-dividendo)', () => {
  const movs = [
    { tipo: 'compra', cantidad: 38, fecha: '2026-09-28' },
    { tipo: 'compra', cantidad: 2, fecha: '2026-10-05' },
  ];
  it('compras posteriores al ex-dividendo no cuentan', () => {
    expect(cantidadAlCorte(40, movs, '2026-09-15')).toBe(0);
  });
  it('lo comprado ANTES del corte sí cuenta; lo posterior se resta de la cantidad actual', () => {
    expect(cantidadAlCorte(172, [{ tipo: 'compra', cantidad: 9, fecha: '2026-10-12' }], '2026-10-09')).toBe(163);
  });
  it('la compra del mismo día del ex-dividendo no tiene derecho (liquida después)', () => {
    expect(cantidadAlCorte(10, [{ tipo: 'compra', cantidad: 4, fecha: '2026-09-15' }], '2026-09-15')).toBe(6);
  });
  it('una venta posterior al corte devuelve las unidades que sí tenías', () => {
    expect(cantidadAlCorte(5, [{ tipo: 'venta', cantidad: 5, fecha: '2026-10-01' }], '2026-09-15')).toBe(10);
  });
  it('robusto a historial parcial: solo se mira lo posterior al corte, no se suma desde cero', () => {
    expect(cantidadAlCorte(148, [{ tipo: 'compra', cantidad: 100, fecha: '2026-08-14' }], '2026-10-09')).toBe(148);
  });
  it('sin corte (pago estimado) o sin movimientos → cantidad actual', () => {
    expect(cantidadAlCorte(40, movs, null)).toBe(40);
    expect(cantidadAlCorte(40, undefined, '2026-09-15')).toBe(40);
  });
});

describe('sugerirDividendoPendiente con fecha de corte', () => {
  const div = (over: Partial<DividendoInfo> = {}): DividendoInfo =>
    ({ proximaFecha: '2026-10-07', montoPorAccion: 0.85, estado: 'declarado', frecuenciaAnual: 4, fechaCorte: '2026-09-15', ...over });
  const cedear = pos({ tipo: 'cedear', ticker: 'MRK', cantidad: 40, ratio_cedear: 5 });

  it('comprado después del ex-dividendo → no sugiere (caso real Herencia/MRK)', () => {
    const movs = [{ tipo: 'compra', cantidad: 38, fecha: '2026-09-28' }, { tipo: 'compra', cantidad: 2, fecha: '2026-10-05' }];
    expect(sugerirDividendoPendiente(cedear, div(), '2026-10-10', movs)).toBeNull();
  });
  it('parte comprada antes y parte después → solo cuenta la anterior, y la nota lo aclara', () => {
    const movs = [{ tipo: 'compra', cantidad: 10, fecha: '2026-10-01' }];
    const r = sugerirDividendoPendiente(cedear, div(), '2026-10-10', movs)!;
    expect(r.monto).toBe(+(0.85 * 30 / 5).toFixed(2));
    expect(r.nota).toContain('después del ex-dividendo');
  });
  it('sin movimientos conocidos se comporta como antes', () => {
    expect(sugerirDividendoPendiente(cedear, div(), '2026-10-10')!.monto).toBe(+(0.85 * 40 / 5).toFixed(2));
  });
});
