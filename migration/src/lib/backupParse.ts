// Parseo puro del JSON de backup (backup.ts) — separado de restore.ts a propósito: restore.ts
// importa el cliente de Supabase (createClient(...) se ejecuta al importar el módulo, ver
// lib/supabase.ts), lo que rompe en un entorno sin las env VITE_SUPABASE_* (como vitest, sin un
// navegador real) con "supabaseUrl is required". parseBackup() no hace NINGÚN I/O — solo lee el
// texto del archivo que el usuario ya eligió — así que puede (y debe) testearse sin esa dependencia.

import { BACKUP_TABLAS, BACKUP_VERSION, REFERENCIAS } from './backupTablas';

export interface BackupFile {
  app?: string;
  backup_version?: number;
  exported_at?: string;
  user_email?: string | null;
  partial?: boolean;          // el export marcó que quedó incompleto (alguna tabla falló al generarse)
  errores?: string[];
  checksum?: { alg: string; value: string };   // SHA-256 de JSON.stringify(tables) (v11+)
  tables?: Record<string, Record<string, unknown>[]>;
}

// Tablas que se RESTAURAN, en orden que respeta las FKs. Derivado del registro único
// (backupTablas.ts): una sola fuente de verdad de "qué tablas trae un backup y en qué orden".
export const RESTORE_ORDER: { table: string; onConflict: string; userScoped: boolean }[] =
  BACKUP_TABLAS.filter(t => t.restaurable && t.onConflict)
    .map(t => ({ table: t.table, onConflict: t.onConflict as string, userScoped: t.userScoped }));

// ── integridad ───────────────────────────────────────────────────────────────────────────────────
// SHA-256 (hex) de la serialización de `tables`. Detecta un archivo truncado, editado a mano o
// corrupto al bajarlo/subirlo — no es una firma (quien edite el archivo puede recalcularlo): protege
// de accidentes, no de manipulación deliberada. null si el navegador no expone crypto.subtle.
export async function checksumTablas(tables: unknown): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(tables));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

export type Integridad = 'ok' | 'distinto' | 'sin-checksum' | 'no-verificable';
export async function verificarChecksum(data: BackupFile): Promise<Integridad> {
  if (!data.checksum?.value) return 'sin-checksum';        // backup anterior a v11
  const calculado = await checksumTablas(data.tables ?? {});
  if (calculado == null) return 'no-verificable';
  return calculado === data.checksum.value ? 'ok' : 'distinto';
}

// ── referencias huérfanas ────────────────────────────────────────────────────────────────────────
export interface Huerfano { tabla: string; campo: string; padre: string; n: number }

// Filas del backup cuya clave foránea apunta a algo que NO está en el mismo archivo. Un backup
// consistente no debería tener ninguna; si hay, restaurar fallará (o dejará datos sueltos) en esas
// filas, salvo que los padres ya existan en la cuenta destino.
export function referenciasHuerfanas(tables: Record<string, Record<string, unknown>[]>): Huerfano[] {
  const ids = new Map<string, Set<unknown>>();
  const idsDe = (tabla: string, campo: string) => {
    const k = `${tabla}.${campo}`;
    let set = ids.get(k);
    if (!set) { set = new Set((tables[tabla] ?? []).map(r => r[campo])); ids.set(k, set); }
    return set;
  };
  const out: Huerfano[] = [];
  for (const r of REFERENCIAS) {
    const filas = tables[r.tabla];
    if (!Array.isArray(filas) || filas.length === 0) continue;
    const validos = idsDe(r.padre, r.campoPadre);
    let n = 0;
    for (const f of filas) {
      const v = f[r.campo];
      if (v == null) { if (!r.nullable) n++; continue; }
      if (!validos.has(v)) n++;
    }
    if (n > 0) out.push({ tabla: r.tabla, campo: r.campo, padre: r.padre, n });
  }
  return out;
}

export interface Preview {
  ok: boolean;
  error?: string;
  backup?: BackupFile;
  exportedAt?: string;
  fromEmail?: string | null;
  counts: Record<string, number>;
  total: number;
  avisos: string[];
  integridad?: Integridad;     // lo completa parseBackupVerificado (parseBackup es síncrono)
  huerfanos?: Huerfano[];
}

export function parseBackup(text: string): Preview {
  let data: BackupFile;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'El archivo no es un JSON válido.', counts: {}, total: 0, avisos: [] }; }
  const avisos: string[] = [];
  if (!data || typeof data !== 'object' || !data.tables || typeof data.tables !== 'object') {
    return { ok: false, error: 'El archivo no tiene la estructura de un backup (falta "tables").', counts: {}, total: 0, avisos };
  }
  if (data.app && data.app !== 'portfolio-inversiones') avisos.push(`El backup dice ser de otra app ("${data.app}").`);
  // Versiones anteriores igual se restauran (solo les faltan tablas que no existían todavía); el
  // aviso fuerte es solo para versiones FUTURAS que este código no sepa interpretar.
  const v = data.backup_version;
  if (v && v > BACKUP_VERSION) avisos.push(`El backup es de una versión más nueva (v${v}) que la soportada (v${BACKUP_VERSION}).`);
  if (v != null) {
    // Un aviso por cada tabla que el backup todavía no podía traer, DERIVADO del registro: agregar una
    // tabla con `avisoSiFalta` ya avisa en los backups anteriores (antes se escribía a mano y se olvidaba).
    for (const t of BACKUP_TABLAS) if (t.avisoSiFalta && v < t.desde) avisos.push(t.avisoSiFalta);
  }
  // El propio backup avisa si se generó incompleto (ver backup.ts): lo mostramos antes de restaurar.
  if (data.partial) avisos.push(`El backup se generó INCOMPLETO${data.errores?.length ? ` (falló: ${data.errores.join('; ')})` : ''}: puede faltar información.`);
  for (const t of BACKUP_TABLAS.filter(t => !t.restaurable)) {
    if (Array.isArray(data.tables[t.table]) && data.tables[t.table].length > 0) {
      avisos.push(`El historial de ${t.label[0].toUpperCase()}${t.label.slice(1)} no se restaura (solo se exporta) — las posiciones en sí vuelven con normalidad.`);
    }
  }
  const counts: Record<string, number> = {};
  let total = 0;
  for (const { table } of RESTORE_ORDER) {
    const n = Array.isArray(data.tables[table]) ? data.tables[table].length : 0;
    counts[table] = n; total += n;
  }
  const huerfanos = referenciasHuerfanas(data.tables);
  for (const h of huerfanos) {
    avisos.push(`${h.n} registro(s) de ${h.tabla} apuntan a ${h.padre} (${h.campo}) que no está en el archivo: fallarán al restaurar salvo que ya existan en tu cuenta.`);
  }
  return {
    ok: total > 0,
    error: total === 0 ? 'El backup no tiene registros para restaurar.' : undefined,
    backup: data, exportedAt: data.exported_at, fromEmail: data.user_email ?? null,
    counts, total, avisos, huerfanos,
  };
}

// parseBackup + verificación del checksum (async por crypto.subtle). Es lo que usa la pantalla.
export async function parseBackupVerificado(text: string): Promise<Preview> {
  const p = parseBackup(text);
  if (!p.backup) return p;
  const integridad = await verificarChecksum(p.backup);
  const avisos = [...p.avisos];
  if (integridad === 'distinto') avisos.unshift('El archivo NO coincide con su checksum: está truncado, corrupto o fue editado. Restaurarlo puede cargar datos incompletos.');
  return { ...p, integridad, avisos };
}
