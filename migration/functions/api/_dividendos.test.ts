import { describe, it, expect } from 'vitest';
import { proyectarDividendo, parseTwelveData, parseEodhd, parseAlphaVantage, type DividendEvent } from './_dividendos';

const ev = (date: string, over: Partial<DividendEvent> = {}): DividendEvent =>
  ({ date, adjDividend: 1, dividend: 1, paymentDate: null, recordDate: null, declarationDate: null, ...over });

describe('proyectarDividendo', () => {
  it('sin historial → sin-dato', () => {
    expect(proyectarDividendo([], '2026-06-01')).toEqual({ proximaFecha: null, montoPorAccion: null, estado: 'sin-dato', frecuenciaAnual: null });
  });

  it('el paymentDate más reciente es futuro → estado "declarado" tal cual', () => {
    const r = proyectarDividendo([ev('2026-08-01', { paymentDate: '2026-08-15', adjDividend: 0.25 })], '2026-06-01');
    expect(r.estado).toBe('declarado');
    expect(r.proximaFecha).toBe('2026-08-15');
    expect(r.montoPorAccion).toBe(0.25);
  });

  it('sin paymentDate, usa el ex-date (`date`) como referencia', () => {
    const r = proyectarDividendo([ev('2026-06-05', { adjDividend: 0.5 })], '2026-06-01');
    expect(r.estado).toBe('declarado');
    expect(r.proximaFecha).toBe('2026-06-05');
  });

  it('el último pago quedó viejo (>7 días) → estima el próximo por cadencia trimestral', () => {
    // 4 pagos trimestrales dentro de los últimos 370 días (desde 2026-06-01 el corte es ~2025-05-27)
    // → frecuencia 4 → ~91 días entre pagos.
    const historial = [
      ev('2026-02-01'), ev('2025-11-01'), ev('2025-08-01'), ev('2025-05-28'),
    ];
    const r = proyectarDividendo(historial, '2026-06-01'); // el último (feb) quedó a 120 días
    expect(r.estado).toBe('estimado');
    expect(r.frecuenciaAnual).toBe(4);
    // 2026-02-01 + 91 días ≈ 2026-05-03, todavía pasado respecto a "hoy" (jun) → sigue sumando
    expect(new Date(r.proximaFecha!).getTime()).toBeGreaterThan(new Date('2026-06-01').getTime());
  });

  it('el próximo pago ya declarado NO cuenta para la frecuencia: trimestral con 4 pasados + 1 futuro = 4, no 5 (caso MSFT)', () => {
    // hoy 2026-10-25: pasados 2025-11-20, 2026-02-19, 2026-05-21, 2026-08-20 (4) y el declarado 2026-11-19 (futuro).
    const historial = [ev('2026-11-19'), ev('2026-08-20'), ev('2026-05-21'), ev('2026-02-19'), ev('2025-11-20')];
    const r = proyectarDividendo(historial, '2026-10-25');
    expect(r.estado).toBe('declarado');
    expect(r.frecuenciaAnual).toBe(4);
  });

  it('si el único pago de la ventana es el declarado (futuro), la frecuencia cae al conteo total en vez de quedar vacía', () => {
    const r = proyectarDividendo([ev('2026-11-19')], '2026-10-25');
    expect(r.frecuenciaAnual).toBe(1);
  });

  it('un solo evento muy viejo, sin poder inferir frecuencia (fuera de los últimos 370 días) → sin-dato', () => {
    const r = proyectarDividendo([ev('2020-01-01')], '2026-06-01');
    expect(r.estado).toBe('sin-dato');
    expect(r.montoPorAccion).toBe(1); // el monto histórico se informa igual, aunque no haya fecha
  });

  it('ordena el historial aunque venga desordenado (no asume que el proveedor lo manda ordenado)', () => {
    const r = proyectarDividendo([ev('2025-01-01'), ev('2026-08-15', { paymentDate: '2026-08-20' })], '2026-06-01');
    expect(r.proximaFecha).toBe('2026-08-20');
  });

  it('usa adjDividend si está, si no cae a dividend', () => {
    const r = proyectarDividendo([ev('2026-08-15', { paymentDate: '2026-08-20', adjDividend: null, dividend: 0.42 })], '2026-06-01');
    expect(r.montoPorAccion).toBe(0.42);
  });
});

describe('parseTwelveData', () => {
  it('mapea ex_date/amount/payment_date al shape DividendEvent', () => {
    const r = parseTwelveData({ dividends: [{ ex_date: '2026-02-19', amount: 0.91, payment_date: '2026-03-12', record_date: '2026-02-19', declaration_date: '2025-12-02' }] });
    expect(r).toEqual([{ date: '2026-02-19', adjDividend: 0.91, dividend: 0.91, paymentDate: '2026-03-12', recordDate: '2026-02-19', declarationDate: '2025-12-02' }]);
  });

  // Twelve Data devuelve HTTP 200 con status:"error" para key inválida/símbolo no encontrado/rate
  // limit — no es un HTTP error que fetchJson pueda atrapar por sí solo, hay que chequearlo.
  it('status "error" (HTTP 200 pero la llamada falló) → null, no una lista vacía de eventos', () => {
    expect(parseTwelveData({ status: 'error', dividends: [{ ex_date: '2026-02-19', amount: 0.91 }] })).toBeNull();
  });

  it('sin campo dividends (respuesta inesperada) → null (no se pudo responder)', () => {
    expect(parseTwelveData({})).toBeNull();
  });

  it('dividends: [] → [] (SÍ respondió, confirmado sin dividendos — hay que cachearlo así, no reintentar)', () => {
    expect(parseTwelveData({ dividends: [] })).toEqual([]);
  });

  it('campos opcionales ausentes (record_date/declaration_date/payment_date) → null en vez de romper', () => {
    const r = parseTwelveData({ dividends: [{ ex_date: '2026-02-19', amount: 0.91 }] });
    expect(r).toEqual([{ date: '2026-02-19', adjDividend: 0.91, dividend: 0.91, paymentDate: null, recordDate: null, declarationDate: null }]);
  });

  it('fila sin ex_date o sin amount se descarta, no rompe el resto', () => {
    const r = parseTwelveData({
      dividends: [
        { ex_date: '2026-02-19', amount: 0.91 },
        { amount: 0.5 },                        // sin ex_date
        { ex_date: '2026-05-21' },               // sin amount
      ],
    });
    expect(r).toHaveLength(1);
  });

  it('amount 0 es un valor válido, no se descarta como "sin dato" (usa != null, no truthy)', () => {
    const r = parseTwelveData({ dividends: [{ ex_date: '2026-02-19', amount: 0 }] });
    expect(r).toEqual([{ date: '2026-02-19', adjDividend: 0, dividend: 0, paymentDate: null, recordDate: null, declarationDate: null }]);
  });
});

describe('parseEodhd (fixture: respuesta real de eodhd.com/api/div/AAPL.US, jul-2026)', () => {
  const real = [
    { date: '2025-02-10', declarationDate: '2025-01-30', recordDate: '2025-02-10', paymentDate: '2025-02-13', period: 'Quarterly', value: 0.25, unadjustedValue: 0.25, currency: 'USD' },
    { date: '2025-05-12', declarationDate: '2025-05-01', recordDate: '2025-05-12', paymentDate: '2025-05-15', period: 'Quarterly', value: 0.26, unadjustedValue: 0.26, currency: 'USD' },
  ];

  it('mapea el fixture real (array directo, sin envoltorio) al shape DividendEvent', () => {
    const r = parseEodhd(real);
    expect(r).toEqual([
      { date: '2025-02-10', adjDividend: 0.25, dividend: 0.25, paymentDate: '2025-02-13', recordDate: '2025-02-10', declarationDate: '2025-01-30' },
      { date: '2025-05-12', adjDividend: 0.26, dividend: 0.26, paymentDate: '2025-05-15', recordDate: '2025-05-12', declarationDate: '2025-05-01' },
    ]);
  });

  it('no es array (error/objeto inesperado) → null', () => {
    expect(parseEodhd({ message: 'error' })).toBeNull();
    expect(parseEodhd(null)).toBeNull();
  });

  it('array vacío → [] (SÍ respondió, confirmado sin dividendos — ej. LAC, que nunca pagó nada)', () => {
    expect(parseEodhd([])).toEqual([]);
  });

  it('sin value pero con unadjustedValue → usa el unadjustedValue como ambos campos', () => {
    const r = parseEodhd([{ date: '2025-02-10', unadjustedValue: 0.25 }]);
    expect(r).toEqual([{ date: '2025-02-10', adjDividend: 0.25, dividend: 0.25, paymentDate: null, recordDate: null, declarationDate: null }]);
  });

  it('fila sin date o sin ningún monto se descarta', () => {
    const r = parseEodhd([{ date: '2025-02-10', value: 0.25 }, { value: 0.5 }, { date: '2025-05-12' }]);
    expect(r).toHaveLength(1);
  });
});

describe('parseAlphaVantage (fixture: respuesta real de alphavantage.co DIVIDENDS, IBM, jul-2026)', () => {
  const real = {
    symbol: 'IBM',
    data: [
      { ex_dividend_date: '2026-08-10', declaration_date: '2026-07-22', record_date: '2026-08-10', payment_date: '2026-09-10', amount: '1.69' },
      { ex_dividend_date: '2026-05-08', declaration_date: '2026-04-22', record_date: '2026-05-08', payment_date: '2026-06-10', amount: '1.69' },
    ],
  };

  it('mapea el fixture real al shape DividendEvent — amount viene como STRING, hay que parsearlo', () => {
    const r = parseAlphaVantage(real);
    expect(r).toEqual([
      { date: '2026-08-10', adjDividend: 1.69, dividend: 1.69, paymentDate: '2026-09-10', recordDate: '2026-08-10', declarationDate: '2026-07-22' },
      { date: '2026-05-08', adjDividend: 1.69, dividend: 1.69, paymentDate: '2026-06-10', recordDate: '2026-05-08', declarationDate: '2026-04-22' },
    ]);
  });

  it('sin campo "data" (ej. respuesta de error tipo {"Note": "..."} por rate limit) → null', () => {
    expect(parseAlphaVantage({})).toBeNull();
  });

  it('data: [] → [] (SÍ respondió, confirmado sin dividendos)', () => {
    expect(parseAlphaVantage({ data: [] })).toEqual([]);
  });

  it('amount "None" (evento sin monto confirmado) se descarta → [] (no NaN, no null: la llamada sí respondió)', () => {
    const r = parseAlphaVantage({ data: [{ ex_dividend_date: '2026-08-10', amount: 'None' }] });
    expect(r).toEqual([]);
  });

  it('fila sin ex_dividend_date se descarta', () => {
    const r = parseAlphaVantage({ data: [{ amount: '1.69' }, { ex_dividend_date: '2026-08-10', amount: '1.69' }] });
    expect(r).toHaveLength(1);
  });
});
