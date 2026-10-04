import { describe, it, expect } from 'vitest';
import { BACKUP_TABLAS, TABLAS_EXCLUIDAS, REFERENCIAS, BACKUP_VERSION } from './backupTablas';
import { RESTORE_ORDER } from './backupParse';

describe('registro de tablas del backup', () => {
  const idx = (t: string) => BACKUP_TABLAS.findIndex(x => x.table === t);

  it('no hay tablas repetidas ni una tabla a la vez incluida y excluida', () => {
    const nombres = BACKUP_TABLAS.map(t => t.table);
    expect(new Set(nombres).size).toBe(nombres.length);
    for (const t of nombres) expect(TABLAS_EXCLUIDAS[t]).toBeUndefined();
  });

  it('cada tabla declara desde qué versión existe (≥1 y ≤ la actual) y la restaurable tiene clave de upsert', () => {
    for (const t of BACKUP_TABLAS) {
      expect(t.desde, t.table).toBeGreaterThanOrEqual(1);
      expect(t.desde, t.table).toBeLessThanOrEqual(BACKUP_VERSION);
      if (t.restaurable) expect(t.onConflict, t.table).toBeTruthy();
    }
    // al menos una tabla nace en la versión actual (si no, el bump de versión no agregó nada)
    expect(BACKUP_TABLAS.some(t => t.desde === BACKUP_VERSION)).toBe(true);
  });

  it('el orden de restauración respeta TODAS las claves foráneas (padres antes que hijos)', () => {
    for (const r of REFERENCIAS) {
      expect(idx(r.tabla), `${r.tabla} en el registro`).toBeGreaterThanOrEqual(0);
      expect(idx(r.padre), `${r.padre} en el registro`).toBeGreaterThanOrEqual(0);
      if (r.padre !== r.tabla) expect(idx(r.padre), `${r.padre} antes que ${r.tabla}`).toBeLessThan(idx(r.tabla));
    }
  });

  it('RESTORE_ORDER sale del registro: sin las solo-exportables y con onConflict en todas', () => {
    expect(RESTORE_ORDER.map(t => t.table)).toEqual(BACKUP_TABLAS.filter(t => t.restaurable).map(t => t.table));
    expect(RESTORE_ORDER.every(t => !!t.onConflict)).toBe(true);
  });

  it('las tablas solo exportables son las que el cliente no puede escribir por RLS/RPC', () => {
    expect(BACKUP_TABLAS.filter(t => !t.restaurable).map(t => t.table).sort()).toEqual(['analisis_ia', 'transferencias']);
  });

  it('las tablas con user_id se re-mapean al usuario actual al restaurar (userScoped) y las de portfolio no', () => {
    const scoped = BACKUP_TABLAS.filter(t => t.userScoped).map(t => t.table).sort();
    expect(scoped).toEqual(['bonos_destacados', 'brokers', 'cik_map', 'dashboard_layout', 'dcf_inputs', 'flujo_items', 'portfolios', 'profiles', 'watchlist']);
  });
});
