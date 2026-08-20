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

export interface RestoreResult { restaurados: Record<string, number>; errores: string[]; total: number; }

export async function restoreBackup(backup: BackupFile, userId: string): Promise<RestoreResult> {
  const restaurados: Record<string, number> = {};
  const errores: string[] = [];
  for (const { table, onConflict, userScoped } of RESTORE_ORDER) {
    const rows = Array.isArray(backup.tables?.[table]) ? backup.tables![table] : [];
    if (!rows.length) { restaurados[table] = 0; continue; }
    // user_id → usuario actual (RLS lo exige y hace que un backup de otra cuenta entre en la tuya).
    const prepared = userScoped ? rows.map(r => ({ ...r, user_id: userId })) : rows;
    let done = 0; let tableErr: string | null = null;
    for (let i = 0; i < prepared.length; i += 400) {
      const chunk = prepared.slice(i, i + 400);
      const { error } = await supabase.from(table).upsert(chunk, { onConflict });
      // Si un chunk falla, seguimos con los demás (no cortamos): maximiza lo recuperado. Guardamos
      // el primer error de la tabla para reportarlo una vez.
      if (error) { if (!tableErr) tableErr = error.message; continue; }
      done += chunk.length;
    }
    if (tableErr) errores.push(`${table}: ${tableErr}`);
    restaurados[table] = done;
  }
  return { restaurados, errores, total: Object.values(restaurados).reduce((a, b) => a + b, 0) };
}
