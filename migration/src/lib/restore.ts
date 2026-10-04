import { supabase } from './supabase';
import { RESTORE_ORDER, type BackupFile } from './backupParse';

// Restaura un backup (JSON de backup.ts) EN ESTA cuenta. Todo pasa por el cliente con RLS, así que
// solo se escribe en los datos del usuario actual. Es un MERGE (upsert): agrega lo nuevo y sobrescribe
// lo que coincida por clave; NO borra lo que no esté en el backup. Pensado sobre todo para recuperar
// en una cuenta vacía (ej. Supabase nuevo). El user_id se re-mapea al usuario actual: por eso un
// backup de otra cuenta también se puede restaurar en la tuya.
//
// El parseo/preview (parseBackup, sin I/O) vive en backupParse.ts — separado justamente para poder
// testearlo sin el cliente de Supabase (ver el comentario ahí). Se re-exporta acá para no romper a
// quien ya importaba parseBackup/BackupFile/Preview desde este archivo.
export { parseBackup, type BackupFile, type Preview } from './backupParse';

export interface FilaFallida { table: string; fila: string; error: string }
export interface Faltante { table: string; esperado: number; enBase: number }
export interface RestoreResult {
  restaurados: Record<string, number>;
  errores: string[];
  fallidas: FilaFallida[];        // filas que no entraron ni una por una (máx. 30 en total, para el reporte)
  faltantes: Faltante[];          // verificación posterior: tablas donde la base quedó con menos filas que el backup
  total: number;
}

const LOTE = 400;
const MAX_FALLIDAS = 30;
const claveFila = (r: Record<string, unknown>) => String(r.id ?? r.ticker ?? r.fecha ?? r.portfolio_id ?? r.user_id ?? '?');

export async function restoreBackup(backup: BackupFile, userId: string): Promise<RestoreResult> {
  const restaurados: Record<string, number> = {};
  const errores: string[] = [];
  const fallidas: FilaFallida[] = [];
  for (const { table, onConflict, userScoped } of RESTORE_ORDER) {
    const rows = Array.isArray(backup.tables?.[table]) ? backup.tables![table] : [];
    if (!rows.length) { restaurados[table] = 0; continue; }
    // user_id → usuario actual (RLS lo exige y hace que un backup de otra cuenta entre en la tuya).
    let prepared: Record<string, unknown>[] = userScoped ? rows.map(r => ({ ...r, user_id: userId })) : rows;
    // movimientos.liquidez_mov_id apunta a OTRO movimiento (el de LIQUIDEZ, que nunca tiene link
    // propio — migración 0050): subir primero los que no tienen link, para que la FK no falle cuando
    // el referenciado cae en un lote posterior.
    if (table === 'movimientos') prepared = [...prepared].sort((a, b) => Number(!!a.liquidez_mov_id) - Number(!!b.liquidez_mov_id));
    let done = 0; let tableErr: string | null = null;
    for (let i = 0; i < prepared.length; i += LOTE) {
      const chunk = prepared.slice(i, i + LOTE);
      const { error } = await supabase.from(table).upsert(chunk, { onConflict });
      if (!error) { done += chunk.length; continue; }
      if (!tableErr) tableErr = error.message;
      // Un lote entero falla por UNA fila mala (FK, check, dato corrupto): reintentar fila por fila
      // para salvar el resto y saber exactamente cuáles no entraron (antes se perdían hasta 400 filas
      // sin decir cuáles).
      for (const fila of chunk) {
        const { error: e1 } = await supabase.from(table).upsert(fila, { onConflict });
        if (!e1) { done++; continue; }
        if (fallidas.length < MAX_FALLIDAS) fallidas.push({ table, fila: claveFila(fila), error: e1.message });
      }
    }
    if (tableErr) errores.push(`${table}: ${tableErr}`);
    restaurados[table] = done;
  }
  const faltantes = await verificarRestauracion(backup);
  return { restaurados, errores, fallidas, faltantes, total: Object.values(restaurados).reduce((a, b) => a + b, 0) };
}

// Verificación posterior: cuenta las filas de cada tabla restaurada en la base (con RLS: solo las del
// usuario) y las compara con el backup. En cuenta vacía debe haber ≥ lo del backup; si hay menos, algo
// no entró aunque el upsert no haya devuelto error.
export async function verificarRestauracion(backup: BackupFile): Promise<Faltante[]> {
  const out: Faltante[] = [];
  for (const { table } of RESTORE_ORDER) {
    const esperado = Array.isArray(backup.tables?.[table]) ? backup.tables![table].length : 0;
    if (esperado === 0) continue;
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) continue;   // no se pudo contar: no se afirma nada
    if ((count ?? 0) < esperado) out.push({ table, esperado, enBase: count ?? 0 });
  }
  return out;
}
