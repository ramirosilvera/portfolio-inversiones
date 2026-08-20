import { describe, it, expect } from 'vitest';
import { parseBackup } from './backupParse';

// El backup de este archivo lo lee la app tal cual llega del usuario (JSON.parse de un archivo
// externo, potencialmente viejo) — no hace falta más que 1 fila en cualquier tabla para pasar el
// chequeo total > 0 de parseBackup.
function backup(version: number | undefined, extra: Record<string, unknown[]> = {}) {
  return JSON.stringify({
    app: 'portfolio-inversiones',
    backup_version: version,
    tables: { portfolios: [{ id: '1' }], ...extra },
  });
}

describe('parseBackup — avisos por versión (cada tabla nueva debe avisar en los backups anteriores)', () => {
  it('backup <= v6: avisa que falta amortizaciones_programadas (agregada en v7) Y dashboard_layout (v8)', () => {
    const r = parseBackup(backup(6));
    expect(r.avisos.some(a => a.includes('amortización manual'))).toBe(true);
    expect(r.avisos.some(a => a.includes('Dashboard personalizable'))).toBe(true);
  });

  it('backup v7: ya trae amortizaciones_programadas, pero todavía avisa que falta dashboard_layout (v8)', () => {
    const r = parseBackup(backup(7));
    expect(r.avisos.some(a => a.includes('amortización manual'))).toBe(false);
    expect(r.avisos.some(a => a.includes('Dashboard personalizable'))).toBe(true);
  });

  it('backup v8: ya trae dashboard_layout, pero avisa que falta bonos_destacados (v9) — este aviso faltaba antes del fix', () => {
    const r = parseBackup(backup(8));
    expect(r.avisos.some(a => a.includes('Dashboard personalizable'))).toBe(false);
    expect(r.avisos.some(a => a.includes('Destacados de renta fija'))).toBe(true);
  });

  it('backup v9 (versión actual): sin avisos de tablas faltantes', () => {
    const r = parseBackup(backup(9));
    expect(r.avisos.some(a => a.includes('amortización manual'))).toBe(false);
    expect(r.avisos.some(a => a.includes('Dashboard personalizable'))).toBe(false);
    expect(r.avisos.some(a => a.includes('Destacados de renta fija'))).toBe(false);
  });

  it('backup de una versión futura no soportada: avisa en vez de fallar en silencio', () => {
    const r = parseBackup(backup(10));
    expect(r.avisos.some(a => a.includes('más nueva'))).toBe(true);
  });

  it('backup sin backup_version (undefined): no explota, no dispara avisos de "<= N" por accidente', () => {
    const r = parseBackup(backup(undefined));
    expect(r.ok).toBe(true);
    expect(r.avisos.some(a => a.includes('amortización manual') || a.includes('Dashboard personalizable') || a.includes('Destacados de renta fija'))).toBe(false);
  });
});
