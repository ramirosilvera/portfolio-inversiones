import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKUP_TABLAS, TABLAS_EXCLUIDAS } from './backupTablas';

// Guardia contra el olvido más caro de un backup: agregar una tabla en una migración y no decidir qué pasa con ella. Lee las
// migraciones (supabase/migrations/*.sql) y exige que TODA tabla creada esté en el registro (se respalda) o en TABLAS_EXCLUIDAS (con motivo).
// Ya pasó: fx_historico (migración 0053) quedó sin declarar hasta la auditoría del módulo de Impuestos.
const DIR = join(process.cwd(), 'supabase', 'migrations');
const CREATE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;

function tablasMigradas(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(DIR).filter(x => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(DIR, f), 'utf8').replace(/--[^\n]*/g, '');   // sin comentarios
    for (const m of sql.matchAll(CREATE)) if (!out.has(m[1])) out.set(m[1], f);
  }
  return out;
}

describe('el registro de backup cubre todas las tablas de las migraciones', () => {
  const migradas = tablasMigradas();
  const declaradas = new Set([...BACKUP_TABLAS.map(t => t.table), ...Object.keys(TABLAS_EXCLUIDAS)]);

  it('encuentra las migraciones (si esto falla el test no está leyendo nada)', () => {
    expect(migradas.size).toBeGreaterThan(30);
    expect(migradas.get('patrimonio_otros')).toMatch(/^0059/);
  });

  it('toda tabla creada por una migración está respaldada o excluida a propósito', () => {
    const sinDeclarar = [...migradas].filter(([t]) => !declaradas.has(t)).map(([t, f]) => `${t} (${f})`);
    expect(sinDeclarar, 'tablas sin decidir: agregarlas a BACKUP_TABLAS o a TABLAS_EXCLUIDAS en lib/backupTablas.ts').toEqual([]);
  });

  it('toda tabla respaldada existe en alguna migración (sin entradas fantasma que fallen al exportar)', () => {
    const fantasma = BACKUP_TABLAS.map(t => t.table).filter(t => !migradas.has(t));
    expect(fantasma).toEqual([]);
  });
});
