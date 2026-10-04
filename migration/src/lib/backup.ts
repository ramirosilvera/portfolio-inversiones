import { supabase } from './supabase';
import { descargarTexto } from './download';
import { BACKUP_TABLAS, BACKUP_VERSION } from './backupTablas';
import { checksumTablas } from './backupParse';

// Backup completo de los datos del usuario. Todo pasa por el cliente con RLS, así que cada select('*')
// devuelve SOLO los datos del usuario. Qué tablas entran, su orden y la versión en que apareció cada
// una viven en el registro único (backupTablas.ts) — acá no hay listas propias. Se excluyen a
// propósito los caches de mercado, catálogos globales y tablas de administración (TABLAS_EXCLUIDAS).
// `partial` + `errores` quedan EN el archivo: un backup incompleto no se confunde con uno completo.
export { BACKUP_VERSION };

export interface BackupResult {
  json: string;
  filename: string;
  counts: Record<string, number>;
  total: number;
  errores: string[];
}

// Trae TODAS las filas de una tabla paginando de a 1000 (el default de PostgREST), con orden estable
// por la clave de la tabla (sin order, dos páginas pueden repetir o saltear filas si algo cambia).
async function fetchAll(table: string, soloPersonal: boolean, orden: string[]): Promise<unknown[]> {
  const rows: unknown[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    let q = supabase.from(table).select('*');
    // Orden por la clave única de la tabla: sin él, si algo cambia entre dos páginas Postgres puede
    // devolver filas repetidas o saltear alguna — y el checksum se calcularía sobre lo ya leído, o sea
    // que el backup saldría "verificado" con filas de menos.
    for (const col of orden) q = q.order(col, { ascending: true });
    q = q.range(from, from + size - 1);
    if (soloPersonal) q = q.not('portfolio_id', 'is', null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return rows;
}

export async function buildBackup(email: string | null): Promise<BackupResult> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const errores: string[] = [];

  // Secuencial y de HIJOS a PADRES (orden inverso al de restauración). Se leen en momentos distintos:
  // si el usuario crea algo mientras se exporta, un padre leído DESPUÉS que su hijo nunca queda
  // faltando (un hijo leído después del padre sí podía quedar huérfano en el archivo).
  for (const t of [...BACKUP_TABLAS].reverse()) {
    try {
      const rows = await fetchAll(t.table, !!t.soloPersonal, (t.onConflict ?? 'id').split(','));
      tables[t.table] = rows;
      counts[t.table] = rows.length;
    } catch (e) {
      // Si una tabla falla (p.ej. no existe en este proyecto), la marcamos pero seguimos con el resto.
      errores.push(`${t.table}: ${e instanceof Error ? e.message : 'error'}`);
      tables[t.table] = [];
      counts[t.table] = 0;
    }
  }
  // Orden de restauración en el archivo (más legible y estable entre backups).
  const ordenadas = Object.fromEntries(BACKUP_TABLAS.map(t => [t.table, tables[t.table]]));

  const now = new Date();
  const hash = await checksumTablas(ordenadas);
  const payload = {
    app: 'portfolio-inversiones',
    backup_version: BACKUP_VERSION,
    exported_at: now.toISOString(),
    user_email: email,
    partial: errores.length > 0,
    errores,
    counts,
    // Detecta archivo truncado/editado al restaurar (ver backupParse.verificarChecksum).
    ...(hash ? { checksum: { alg: 'SHA-256', value: hash } } : {}),
    tables: ordenadas,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    json: JSON.stringify(payload, null, 2),
    filename: `backup-portfolios-${now.toISOString().slice(0, 10)}.json`,
    counts, total, errores,
  };
}

// Dispara la descarga del archivo en el navegador (sin subir nada a ningún lado).
export function descargarBackup(r: BackupResult) {
  descargarTexto(r.json, r.filename, 'application/json');
}
