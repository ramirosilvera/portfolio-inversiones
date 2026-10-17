import { describe, it, expect } from 'vitest';
import { estadoSnapshotServidor } from './snapshotServidor';

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
