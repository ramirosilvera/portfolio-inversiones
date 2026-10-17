import { describe, it, expect } from 'vitest';
import { estadoSnapshotServidor, filaSnapshotApp } from './snapshotServidor';

const op = { hayPosiciones: true, tieneAccionAr: false };

describe('estadoSnapshotServidor', () => {
  it('ok si el cron grabó hoy o hasta 2 días atrás (fin de semana)', () => {
    expect(estadoSnapshotServidor([{ fecha: '2026-10-17', fuente: 'cron' }], '2026-10-17', op).estado).toBe('ok');
    expect(estadoSnapshotServidor([{ fecha: '2026-10-15', fuente: 'cron' }], '2026-10-17', op).estado).toBe('ok');
  });
  it('atrasado si el último snapshot del cron tiene más de 2 días', () => {
    const r = estadoSnapshotServidor([{ fecha: '2026-10-10', fuente: 'cron' }], '2026-10-17', op);
    expect(r).toEqual({ estado: 'atrasado', ultimo: '2026-10-10', dias: 7 });
  });
  it('los snapshots que grabó la app no cuentan: sin ninguno del cron es "sin_registro"', () => {
    expect(estadoSnapshotServidor([{ fecha: '2026-10-17', fuente: 'app' }, { fecha: '2026-10-16' }], '2026-10-17', op).estado).toBe('sin_registro');
  });
  it('toma el más reciente aunque vengan desordenados', () => {
    const r = estadoSnapshotServidor([{ fecha: '2026-10-17', fuente: 'cron' }, { fecha: '2026-09-01', fuente: 'cron' }], '2026-10-17', op);
    expect(r).toEqual({ estado: 'ok', ultimo: '2026-10-17' });
  });
  it('no aplica sin posiciones o con acciones locales (el servidor no las valúa)', () => {
    expect(estadoSnapshotServidor([], '2026-10-17', { hayPosiciones: false, tieneAccionAr: false }).estado).toBe('no_aplica');
    expect(estadoSnapshotServidor([], '2026-10-17', { hayPosiciones: true, tieneAccionAr: true }).estado).toBe('no_aplica');
  });
});

describe('filaSnapshotApp', () => {
  it('no incluye fuente ni completo: el navegador no pisa el origen "cron" de una fila ya grabada por el servidor', () => {
    const f = filaSnapshotApp('pf', '2026-10-17', 1000, 900, [{ t: 'MA', c: 1, v: 1000 }]);
    expect(f).not.toHaveProperty('fuente');
    expect(f).not.toHaveProperty('completo');
    expect(f).toMatchObject({ portfolio_id: 'pf', fecha: '2026-10-17', valor: 1000, aportado: 900 });
  });
  it('sin detalle manda null', () => { expect(filaSnapshotApp('pf', '2026-10-17', 1, 1).detalle).toBeNull(); });
});
