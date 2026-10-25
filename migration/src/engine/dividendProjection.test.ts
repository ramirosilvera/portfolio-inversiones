import { describe, it, expect } from 'vitest';
import { dividendEvents, dividendCalendar, dividendoAnualEstimado, dividendoAnualizado, type DividendPosicion, type DividendoInfo } from './dividendProjection';

const pos = (over: Partial<DividendPosicion> = {}): DividendPosicion =>
  ({ ticker: 'MSFT', tipo: 'cedear', cantidad: 100, ratioCedear: 30, ...over });

const info = (over: Partial<DividendoInfo> = {}): DividendoInfo =>
  ({ proximaFecha: '2026-03-12', montoPorAccion: 0.91, estado: 'declarado', frecuenciaAnual: 4, ...over });

describe('dividendEvents', () => {
  it('CEDEAR: divide por el ratio igual que la sugerencia del cron', () => {
    const ev = dividendEvents([pos()], { MSFT: info() }, 2026, 1, 12);
    expect(ev[0].monto).toBe(+((0.91 * 100) / 30).toFixed(2));
  });

  it('acción directa: no divide por nada', () => {
    const ev = dividendEvents([pos({ tipo: 'accion', ratioCedear: null })], { MSFT: info() }, 2026, 1, 12);
    expect(ev[0].monto).toBe(91); // 0.91 * 100
  });

  it('repite la cadencia hacia adelante según frecuenciaAnual (trimestral → 4 eventos en 12 meses)', () => {
    const ev = dividendEvents([pos()], { MSFT: info({ proximaFecha: '2026-03-12', frecuenciaAnual: 4 }) }, 2026, 1, 12);
    expect(ev).toHaveLength(4);
    expect(ev.map(e => e.ym)).toEqual(['2026-03', '2026-06', '2026-09', '2026-12']);
  });

  it('el primer evento hereda estado "declarado"; los siguientes son SIEMPRE "estimado" (son extrapolación nuestra)', () => {
    const ev = dividendEvents([pos()], { MSFT: info({ estado: 'declarado' }) }, 2026, 1, 12);
    expect(ev[0].estado).toBe('declarado');
    expect(ev.slice(1).every(e => e.estado === 'estimado')).toBe(true);
  });

  it('si el proveedor ya venía en "estimado", el primer evento también es "estimado"', () => {
    const ev = dividendEvents([pos()], { MSFT: info({ estado: 'estimado' }) }, 2026, 1, 12);
    expect(ev[0].estado).toBe('estimado');
  });

  it('sin frecuenciaAnual conocida: un solo evento, no se repite', () => {
    const ev = dividendEvents([pos()], { MSFT: info({ frecuenciaAnual: null }) }, 2026, 1, 12);
    expect(ev).toHaveLength(1);
  });

  it('un pagador SEMANAL cubre los 12 meses completos, no se corta a mitad de camino por el tope de iteraciones', () => {
    const ev = dividendEvents([pos()], { MSFT: info({ proximaFecha: '2026-01-02', frecuenciaAnual: 52 }) }, 2026, 1, 12);
    // ~52 semanas en 12 meses — el último evento tiene que caer en el último mes de la ventana (dic),
    // no cortarse antes por un tope de iteraciones demasiado bajo.
    expect(ev.length).toBeGreaterThan(48);
    expect(ev[ev.length - 1].ym).toBe('2026-12');
  });

  it('CEDEAR sin ratio → no proyecta (mismo criterio que el cron: mejor nada que un monto 30x mal)', () => {
    const ev = dividendEvents([pos({ ratioCedear: null })], { MSFT: info() }, 2026, 1, 12);
    expect(ev).toEqual([]);
  });

  it('bono, cash y accion_ar nunca generan evento de dividendo', () => {
    expect(dividendEvents([pos({ tipo: 'bono' })], { MSFT: info() }, 2026, 1, 12)).toEqual([]);
    expect(dividendEvents([pos({ tipo: 'cash' })], { MSFT: info() }, 2026, 1, 12)).toEqual([]);
    expect(dividendEvents([pos({ tipo: 'accion_ar' })], { MSFT: info() }, 2026, 1, 12)).toEqual([]);
  });

  it('sin info del ticker (null/undefined/sin-dato) → no proyecta, no rompe', () => {
    expect(dividendEvents([pos()], {}, 2026, 1, 12)).toEqual([]);
    expect(dividendEvents([pos()], { MSFT: null }, 2026, 1, 12)).toEqual([]);
    expect(dividendEvents([pos()], { MSFT: info({ estado: 'sin-dato', proximaFecha: null, montoPorAccion: null }) }, 2026, 1, 12)).toEqual([]);
  });

  it('posición cerrada (cantidad 0) → no proyecta', () => {
    expect(dividendEvents([pos({ cantidad: 0 })], { MSFT: info() }, 2026, 1, 12)).toEqual([]);
  });

  it('eventos fuera de la ventana [fromYear/fromMonth, +meses) quedan afuera', () => {
    const ev = dividendEvents([pos()], { MSFT: info({ proximaFecha: '2027-06-01', frecuenciaAnual: 4 }) }, 2026, 1, 12);
    expect(ev).toEqual([]);
  });

  it('monto que redondea a 0 (posición muy chica) se descarta', () => {
    const ev = dividendEvents([pos({ cantidad: 1, ratioCedear: 1000 })], { MSFT: info({ montoPorAccion: 0.001 }) }, 2026, 1, 12);
    expect(ev).toEqual([]);
  });
});

describe('dividendCalendar', () => {
  it('agrupa por mes con el mismo shape que couponCalendar (ym/year/month/total/detalle)', () => {
    const cal = dividendCalendar([pos()], { MSFT: info({ frecuenciaAnual: 4 }) }, 2026, 1, 12);
    expect(cal).toHaveLength(12);
    const marzo = cal.find(m => m.ym === '2026-03')!;
    expect(marzo.total).toBeGreaterThan(0);
    expect(marzo.detalle[0].ticker).toBe('MSFT');
  });

  it('varios tickers en el mismo mes se suman en el total', () => {
    const cal = dividendCalendar(
      [pos({ ticker: 'MSFT' }), pos({ ticker: 'MA', ratioCedear: 33 })],
      { MSFT: info({ proximaFecha: '2026-03-12', frecuenciaAnual: null }), MA: info({ proximaFecha: '2026-03-12', montoPorAccion: 0.87, frecuenciaAnual: null }) },
      2026, 1, 12,
    );
    const marzo = cal.find(m => m.ym === '2026-03')!;
    expect(marzo.detalle).toHaveLength(2);
    expect(marzo.total).toBe(+(marzo.detalle[0].monto + marzo.detalle[1].monto).toFixed(2));
  });

  it('mes sin eventos → total 0, detalle vacío (no se omite del calendario)', () => {
    const cal = dividendCalendar([pos()], { MSFT: info({ proximaFecha: '2026-03-12', frecuenciaAnual: null }) }, 2026, 1, 12);
    expect(cal.find(m => m.ym === '2026-01')).toEqual({ ym: '2026-01', year: 2026, month: 1, total: 0, detalle: [] });
  });
});

describe('dividendoAnualizado', () => {
  it('último monto × pagos por año × nominales ÷ ratio (MSFT: 0,91 × 4 × 100 ÷ 30)', () => {
    const v = dividendoAnualizado(pos({ cantidad: 100, ratioCedear: 30 }), info({ montoPorAccion: 0.91, frecuenciaAnual: 4 }));
    expect(v).toBeCloseTo((0.91 * 4 * 100) / 30, 8);
  });

  it('una acción directa (sin ratio) usa divisor 1', () => {
    expect(dividendoAnualizado(pos({ tipo: 'accion', cantidad: 10, ratioCedear: null }), info({ montoPorAccion: 2, frecuenciaAnual: 4 }))).toBe(80);
  });

  it('null si falta algo para calcular: ratio de un CEDEAR, cadencia, monto, dato del proveedor o posición cerrada', () => {
    expect(dividendoAnualizado(pos({ ratioCedear: null }), info())).toBeNull();
    expect(dividendoAnualizado(pos(), info({ frecuenciaAnual: null }))).toBeNull();
    expect(dividendoAnualizado(pos(), info({ montoPorAccion: null }))).toBeNull();
    expect(dividendoAnualizado(pos(), info({ estado: 'sin-dato' }))).toBeNull();
    expect(dividendoAnualizado(pos(), null)).toBeNull();
    expect(dividendoAnualizado(pos({ cantidad: 0 }), info())).toBeNull();
    expect(dividendoAnualizado(pos({ tipo: 'bono' }), info())).toBeNull();
  });
});

describe('dividendo especial (DIV-04)', () => {
  const conEspecial = info({ proximaFecha: '2026-03-12', montoPorAccion: 15, montoRegularPorAccion: 1, frecuenciaAnual: 4, estado: 'declarado' });

  it('el anualizado usa el monto REGULAR: 1 × 4 × 100 ÷ 30, no 15 × 4 × 100 ÷ 30', () => {
    expect(dividendoAnualizado(pos(), conEspecial)).toBeCloseTo((1 * 4 * 100) / 30, 8);
  });

  it('el calendario cobra el especial UNA vez (el primero) y repite el regular', () => {
    const ev = dividendEvents([pos()], { MSFT: conEspecial }, 2026, 1, 12);
    expect(ev.length).toBeGreaterThanOrEqual(3);
    expect(ev[0].monto).toBe(+((15 * 100) / 30).toFixed(2));            // el especial declarado
    expect(ev[1].monto).toBe(+((1 * 100) / 30).toFixed(2));             // los que repiten la cadencia, regulares
    expect(ev[2].monto).toBe(ev[1].monto);
  });

  it('sin montoRegular (respuesta vieja) todo sigue como antes', () => {
    expect(dividendoAnualizado(pos(), info({ montoPorAccion: 0.91 }))).toBeCloseTo((0.91 * 4 * 100) / 30, 8);
  });
});

describe('dividendoAnualEstimado', () => {
  it('suma el dividendo anualizado de cada posición', () => {
    const total = dividendoAnualEstimado(
      [pos({ ticker: 'MSFT', cantidad: 100, ratioCedear: 30 }), pos({ ticker: 'MA', cantidad: 66, ratioCedear: 33 })],
      { MSFT: info({ montoPorAccion: 0.91, frecuenciaAnual: 4 }), MA: info({ montoPorAccion: 0.87, frecuenciaAnual: 4 }) });
    expect(total).toBe(+((0.91 * 4 * 100) / 30 + (0.87 * 4 * 66) / 33).toFixed(2));
  });

  it('NO depende del mes en que cae el próximo pago (regresión: Cupones daba 10–13 % menos que la tarjeta de CEDEARs)', () => {
    // Pagador trimestral cuyo próximo pago cae a ~3 meses del inicio de la ventana: la suma del calendario de 12 meses dejaba afuera un pago.
    const cercano = dividendoAnualEstimado([pos()], { MSFT: info({ proximaFecha: '2026-02-15', frecuenciaAnual: 4 }) });
    const lejano = dividendoAnualEstimado([pos()], { MSFT: info({ proximaFecha: '2026-04-20', frecuenciaAnual: 4 }) });
    expect(lejano).toBe(cercano);
    expect(lejano).toBeGreaterThan(0);
  });

  it('sin posiciones con dato → 0', () => {
    expect(dividendoAnualEstimado([], {})).toBe(0);
  });
});
