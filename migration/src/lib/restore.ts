import { supabase } from './supabase';
import { RESTORE_ORDER, type BackupFile } from './backupParse';
import { REFERENCIAS } from './backupTablas';

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
  errores: string[];              // primer mensaje de error de cada tabla que tuvo alguno
  fallidas: FilaFallida[];        // MUESTRA de las filas que no entraron (máx. 30)
  fallidasTotal: number;          // cuántas filas no entraron en total (la muestra se corta en 30)
  faltantes: Faltante[];          // verificación posterior: tablas con menos filas en la base que en el backup
  verificacionCompleta: boolean;  // false si alguna tabla no se pudo contar: no se puede afirmar que todo coincide
  total: number;
}

const LOTE = 400;
const MAX_FALLIDAS = 30;
// Tras este nº de reintentos fila por fila SEGUIDOS sin una sola exitosa, el problema no es de una fila
// sino de la tabla: se corta en vez de seguir miles de requests.
const MAX_FALLOS_SEGUIDOS = 5;
// Errores que afectan a TODA la tabla (columna/tabla inexistente, sin permiso/RLS): reintentar fila por
// fila es inútil — falla cada una (ej. backup viejo con posiciones.broker_id, columna que ya no existe;
// backup de otra cuenta, cuyas filas la RLS rechaza).
const CODIGOS_SISTEMICOS = new Set(['PGRST204', 'PGRST205', '42703', '42P01', '42501']);
const claveFila = (r: Record<string, unknown>) => String(r.id ?? r.ticker ?? r.fecha ?? r.portfolio_id ?? r.user_id ?? '?');

export async function restoreBackup(backup: BackupFile, userId: string): Promise<RestoreResult> {
  const restaurados: Record<string, number> = {};
  const errores: string[] = [];
  const fallidas: FilaFallida[] = [];
  let fallidasTotal = 0;
  for (const { table, onConflict, userScoped } of RESTORE_ORDER) {
    const rows = Array.isArray(backup.tables?.[table]) ? backup.tables![table] : [];
    if (!rows.length) { restaurados[table] = 0; continue; }
    // user_id → usuario actual (RLS lo exige y hace que un backup de otra cuenta entre en la tuya).
    let prepared: Record<string, unknown>[] = userScoped ? rows.map(r => ({ ...r, user_id: userId })) : rows;
    // Backups v1-v3 traen posiciones.broker_id, columna que ya no existe (0018): PostgREST rechazaría
    // el lote entero. El reparto por broker vuelve por posicion_brokers (v4+).
    if (table === 'posiciones') prepared = prepared.map(({ broker_id: _legacy, ...resto }) => resto);
    // movimientos.liquidez_mov_id apunta a OTRO movimiento (el de LIQUIDEZ, que nunca tiene link
    // propio — migración 0050): subir primero los que no tienen link, para que la FK no falle cuando
    // el referenciado cae en un lote posterior.
    if (table === 'movimientos') prepared = [...prepared].sort((a, b) => Number(!!a.liquidez_mov_id) - Number(!!b.liquidez_mov_id));
    let done = 0; let tableErr: string | null = null; let abortada = false;
    for (let i = 0; i < prepared.length && !abortada; i += LOTE) {
      const chunk = prepared.slice(i, i + LOTE);
      const { error } = await supabase.from(table).upsert(chunk, { onConflict });
      if (!error) { done += chunk.length; continue; }
      if (!tableErr) tableErr = error.message;
      if (error.code && CODIGOS_SISTEMICOS.has(error.code)) {
        // Falla toda la tabla: no se reintenta fila por fila ni se siguen mandando lotes.
        fallidasTotal += prepared.length - i;
        if (fallidas.length < MAX_FALLIDAS) fallidas.push({ table, fila: `${prepared.length - i} fila(s)`, error: error.message });
        abortada = true; break;
      }
      // Un lote falla por UNA fila mala (FK, check, dato corrupto): reintentar fila por fila para salvar
      // el resto y saber exactamente cuáles no entraron.
      let seguidos = 0;
      for (let k = 0; k < chunk.length; k++) {
        const fila = chunk[k];
        const { error: e1 } = await supabase.from(table).upsert(fila, { onConflict });
        if (!e1) { done++; seguidos = 0; continue; }
        fallidasTotal++; seguidos++;
        if (fallidas.length < MAX_FALLIDAS) fallidas.push({ table, fila: claveFila(fila), error: e1.message });
        if (seguidos >= MAX_FALLOS_SEGUIDOS && done === 0) {
          // Nada entró y ya fallaron varias seguidas: el problema es de la tabla, no de filas sueltas.
          fallidasTotal += chunk.length - k - 1 + (prepared.length - i - chunk.length);
          abortada = true; break;
        }
      }
    }
    if (tableErr) errores.push(`${table}: ${tableErr}`);
    restaurados[table] = done;
  }
  const { faltantes, completa } = await verificarRestauracion(backup);
  return { restaurados, errores, fallidas, fallidasTotal, faltantes, verificacionCompleta: completa, total: Object.values(restaurados).reduce((a, b) => a + b, 0) };
}

// Filtro de alcance para contar: solo las filas de los portfolios (o posiciones) DEL BACKUP. Contar la
// tabla entera (todo lo que ve el usuario por RLS) tapaba faltantes cuando la cuenta ya tenía datos.
// Sin padres en el backup o con demasiados ids (la URL no entra) se cuenta toda la tabla.
function alcance(backup: BackupFile, table: string): { campo: string; ids: string[] } | null {
  const ref = REFERENCIAS.find(r => r.tabla === table && !r.nullable && (r.campo === 'portfolio_id' || r.campo === 'posicion_id'));
  if (!ref) return null;
  const ids = (backup.tables?.[ref.padre] ?? []).map(r => r[ref.campoPadre]).filter((v): v is string => typeof v === 'string');
  return ids.length > 0 && ids.length <= 200 ? { campo: ref.campo, ids } : null;
}

// Verificación posterior: cuenta las filas de cada tabla restaurada (con RLS, solo las del usuario;
// acotado a los portfolios/posiciones del backup) y las compara con el backup. Sigue siendo un conteo,
// no una comparación fila a fila: si la cuenta tenía filas extra en esos mismos portfolios, podría
// tapar un faltante — por eso el mensaje dice "los conteos coinciden", no "datos idénticos".
// `completa` = false si alguna tabla no se pudo contar (entonces NO se afirma que todo coincide).
export async function verificarRestauracion(backup: BackupFile): Promise<{ faltantes: Faltante[]; completa: boolean }> {
  const faltantes: Faltante[] = [];
  let completa = true;
  for (const { table } of RESTORE_ORDER) {
    const esperado = Array.isArray(backup.tables?.[table]) ? backup.tables![table].length : 0;
    if (esperado === 0) continue;
    let q = supabase.from(table).select('*', { count: 'exact', head: true });
    const a = alcance(backup, table);
    if (a) q = q.in(a.campo, a.ids);
    const { count, error } = await q;
    if (error || count == null) { completa = false; continue; }
    if (count < esperado) faltantes.push({ table, esperado, enBase: count });
  }
  return { faltantes, completa };
}
