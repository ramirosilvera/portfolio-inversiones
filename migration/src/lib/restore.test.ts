import { describe, it, expect, vi, beforeEach } from 'vitest';

// Cliente de Supabase simulado: registra cada upsert/count y responde según el escenario.
type Resp = { error: { message: string; code?: string } | null };
const calls: { table: string; op: string; payload?: unknown }[] = [];
let upsertImpl: (table: string, payload: unknown) => Resp = () => ({ error: null });
let countImpl: (table: string, filtro: { campo: string; ids: string[] } | null) => { count: number | null; error: { message: string } | null } = () => ({ count: 0, error: null });

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: async (payload: unknown) => { calls.push({ table, op: 'upsert', payload }); return upsertImpl(table, payload); },
      select: () => {
        let filtro: { campo: string; ids: string[] } | null = null;
        const q = {
          in: (campo: string, ids: string[]) => { filtro = { campo, ids }; return q; },
          then: (res: (v: unknown) => unknown) => { calls.push({ table, op: 'count', payload: filtro }); return Promise.resolve(countImpl(table, filtro)).then(res); },
        };
        return q;
      },
    }),
  },
}));

import { restoreBackup, verificarRestauracion } from './restore';
import type { BackupFile } from './backupParse';

const bk = (tables: Record<string, Record<string, unknown>[]>): BackupFile => ({ app: 'portfolio-inversiones', backup_version: 11, tables });
const upserts = (t: string) => calls.filter(c => c.table === t && c.op === 'upsert');

beforeEach(() => { calls.length = 0; upsertImpl = () => ({ error: null }); countImpl = () => ({ count: 999, error: null }); });

describe('restoreBackup', () => {
  it('camino feliz: un upsert por lote, sin reintentos', async () => {
    const r = await restoreBackup(bk({ portfolios: [{ id: 'p' }], aportes: [{ id: 'a', portfolio_id: 'p' }] }), 'u1');
    expect(r.total).toBe(2);
    expect(r.errores).toEqual([]);
    expect(r.fallidasTotal).toBe(0);
    expect(upserts('portfolios')).toHaveLength(1);
  });

  it('re-mapea user_id al usuario actual solo en las tablas por usuario', async () => {
    await restoreBackup(bk({ portfolios: [{ id: 'p', user_id: 'otro' }], aportes: [{ id: 'a', portfolio_id: 'p' }] }), 'yo');
    expect((upserts('portfolios')[0].payload as { user_id: string }[])[0].user_id).toBe('yo');
    expect((upserts('aportes')[0].payload as Record<string, unknown>[])[0]).not.toHaveProperty('user_id');
  });

  it('error de toda la tabla (RLS 42501): NO reintenta fila por fila y cuenta todas las filas como fallidas', async () => {
    upsertImpl = (t) => t === 'portfolios' ? { error: { message: 'new row violates row-level security policy', code: '42501' } } : { error: null };
    const filas = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}` }));
    const r = await restoreBackup(bk({ portfolios: filas }), 'u1');
    expect(upserts('portfolios')).toHaveLength(1);        // un solo intento, sin 50 reintentos
    expect(r.fallidasTotal).toBe(50);
    expect(r.errores[0]).toContain('portfolios');
  });

  it('lote con UNA fila mala (FK): reintenta fila por fila, salva el resto e informa cuál no entró', async () => {
    upsertImpl = (t, payload) => {
      if (t !== 'aportes') return { error: null };
      const filas = Array.isArray(payload) ? payload : [payload];
      return filas.some((f: { id: string }) => f.id === 'mala') ? { error: { message: 'FK violada', code: '23503' } } : { error: null };
    };
    const r = await restoreBackup(bk({ portfolios: [{ id: 'p' }], aportes: [{ id: 'a1' }, { id: 'mala' }, { id: 'a3' }] }), 'u1');
    expect(r.restaurados.aportes).toBe(2);
    expect(r.fallidasTotal).toBe(1);
    expect(r.fallidas).toEqual([{ table: 'aportes', fila: 'mala', error: 'FK violada' }]);
  });

  it('si nada entra y fallan 5 filas seguidas (error por fila, no sistémico), corta en vez de seguir miles de requests', async () => {
    upsertImpl = (t) => t === 'aportes' ? { error: { message: 'check violado', code: '23514' } } : { error: null };
    const filas = Array.from({ length: 300 }, (_, i) => ({ id: `a${i}` }));
    const r = await restoreBackup(bk({ portfolios: [{ id: 'p' }], aportes: filas }), 'u1');
    expect(upserts('aportes').length).toBeLessThanOrEqual(1 + 5);   // 1 lote + 5 reintentos
    expect(r.fallidasTotal).toBe(300);
    expect(r.fallidas.length).toBeLessThanOrEqual(30);
  });

  it('descarta posiciones.broker_id (columna que ya no existe) de backups viejos', async () => {
    await restoreBackup(bk({ portfolios: [{ id: 'p' }], posiciones: [{ id: 'x', portfolio_id: 'p', broker_id: 'b' }] }), 'u1');
    expect((upserts('posiciones')[0].payload as Record<string, unknown>[])[0]).not.toHaveProperty('broker_id');
  });

  it('movimientos: los que no tienen liquidez_mov_id se suben primero', async () => {
    await restoreBackup(bk({ portfolios: [{ id: 'p' }], movimientos: [{ id: 'venta', liquidez_mov_id: 'liq' }, { id: 'liq', liquidez_mov_id: null }] }), 'u1');
    expect((upserts('movimientos')[0].payload as { id: string }[]).map(m => m.id)).toEqual(['liq', 'venta']);
  });

  it('analisis_ia no se restaura (el cliente no puede escribirla)', async () => {
    await restoreBackup(bk({ portfolios: [{ id: 'p' }], analisis_ia: [{ id: 'i', portfolio_id: 'p' }] }), 'u1');
    expect(upserts('analisis_ia')).toHaveLength(0);
  });
});

describe('verificarRestauracion', () => {
  it('cuenta acotado a los portfolios del backup y detecta tablas con menos filas', async () => {
    countImpl = (t, f) => ({ count: t === 'aportes' ? 1 : 5, error: null });
    const v = await verificarRestauracion(bk({ portfolios: [{ id: 'p' }], aportes: [{ id: 'a', portfolio_id: 'p' }, { id: 'b', portfolio_id: 'p' }] }));
    expect(v.completa).toBe(true);
    expect(v.faltantes).toEqual([{ table: 'aportes', esperado: 2, enBase: 1 }]);
    const c = calls.find(x => x.table === 'aportes' && x.op === 'count');
    expect(c?.payload).toEqual({ campo: 'portfolio_id', ids: ['p'] });
  });

  it('si una tabla no se pudo contar, la verificación queda incompleta (no se afirma que todo coincide)', async () => {
    countImpl = (t) => t === 'aportes' ? { count: null, error: { message: 'timeout' } } : { count: 5, error: null };
    const v = await verificarRestauracion(bk({ portfolios: [{ id: 'p' }], aportes: [{ id: 'a', portfolio_id: 'p' }] }));
    expect(v.completa).toBe(false);
    expect(v.faltantes).toEqual([]);
  });
});
