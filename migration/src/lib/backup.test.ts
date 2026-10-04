import { describe, it, expect, vi, beforeEach } from 'vitest';

// Registra, por tabla, las llamadas de la cadena select().order().range() para verificar la paginación.
const log: { table: string; orden: string[]; rangos: [number, number][] }[] = [];
let filasPorTabla: Record<string, unknown[]> = {};

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      const entry = { table, orden: [] as string[], rangos: [] as [number, number][] };
      log.push(entry);
      const q = {
        select: () => q,
        order: (col: string) => { entry.orden.push(col); return q; },
        not: () => q,
        range: (a: number, b: number) => {
          entry.rangos.push([a, b]);
          return Promise.resolve({ data: (filasPorTabla[table] ?? []).slice(a, b + 1), error: null });
        },
      };
      return q;
    },
  },
}));

import { buildBackup } from './backup';
import { BACKUP_TABLAS } from './backupTablas';
import { verificarChecksum } from './backupParse';

beforeEach(() => { log.length = 0; filasPorTabla = {}; });

describe('buildBackup', () => {
  it('pagina de a 1000 ordenando SIEMPRE por la clave de la tabla (sin orden, las páginas pueden repetir o saltear filas)', async () => {
    filasPorTabla.aportes = Array.from({ length: 2300 }, (_, i) => ({ id: `a${String(i).padStart(4, '0')}` }));
    const r = await buildBackup('x@y.z');
    expect(r.counts.aportes).toBe(2300);
    const aportes = log.filter(l => l.table === 'aportes');
    expect(aportes.map(l => l.rangos[0])).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(aportes.every(l => l.orden.join() === 'id')).toBe(true);
    // clave compuesta: ordena por todas sus columnas; sin onConflict (solo exportables) usa id
    expect(log.find(l => l.table === 'portfolio_snapshots')!.orden).toEqual(['portfolio_id', 'fecha']);
    expect(log.find(l => l.table === 'transferencias')!.orden).toEqual(['id']);
    expect(log.find(l => l.table === 'analisis_ia')!.orden).toEqual(['id']);
  });

  it('lee de hijos a padres y todas las tablas del registro, y el checksum del archivo verifica', async () => {
    const r = await buildBackup(null);
    const orden = [...new Set(log.map(l => l.table))];
    expect(orden).toEqual([...BACKUP_TABLAS].reverse().map(t => t.table));
    const archivo = JSON.parse(r.json);
    expect(archivo.backup_version).toBe(11);
    expect(await verificarChecksum(archivo)).toBe('ok');
  });
});
