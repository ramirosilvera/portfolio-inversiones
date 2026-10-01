import { describe, it, expect } from 'vitest';
import { frescuraPrecios } from './status';

describe('frescuraPrecios', () => {
  const ahora = Date.parse('2026-10-05T12:00:00Z');
  it('marca viejos los tickers sin fila o con más de 72 h, y devuelve el más viejo de la cartera', () => {
    const r = frescuraPrecios(['AAA', 'BBB', 'CCC'], [
      { ticker: 'AAA', updated_at: '2026-10-05T11:30:00Z' },
      { ticker: 'BBB', updated_at: '2026-10-01T10:00:00Z' },   // > 72 h
      { ticker: 'ZZZ', updated_at: '2026-10-05T11:59:00Z' },   // no tenido: no cuenta
    ], ahora);
    expect(r.viejos).toEqual(['BBB', 'CCC']);
    expect(r.masViejo).toBe('2026-10-01T10:00:00Z');
  });
  it('un fin de semana sin rueda (viernes → lunes) no es "viejo"', () => {
    const r = frescuraPrecios(['AAA'], [{ ticker: 'AAA', updated_at: '2026-10-02T20:00:00Z' }], ahora);
    expect(r.viejos).toEqual([]);
  });
});
