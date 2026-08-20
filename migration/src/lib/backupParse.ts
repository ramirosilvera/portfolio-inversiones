// Parseo puro del JSON de backup (backup.ts) — separado de restore.ts a propósito: restore.ts
// importa el cliente de Supabase (createClient(...) se ejecuta al importar el módulo, ver
// lib/supabase.ts), lo que rompe en un entorno sin las env VITE_SUPABASE_* (como vitest, sin un
// navegador real) con "supabaseUrl is required". parseBackup() no hace NINGÚN I/O — solo lee el
// texto del archivo que el usuario ya eligió — así que puede (y debe) testearse sin esa dependencia.

export interface BackupFile {
  app?: string;
  backup_version?: number;
  exported_at?: string;
  user_email?: string | null;
  partial?: boolean;          // el export marcó que quedó incompleto (alguna tabla falló al generarse)
  errores?: string[];
  tables?: Record<string, Record<string, unknown>[]>;
}

// Orden que respeta las FKs (portfolios antes que sus posiciones, etc.). onConflict = clave natural.
// Usado tanto para restaurar (restore.ts, con supabase) como para contar filas en el preview (acá,
// sin supabase) — es una sola fuente de verdad de "qué tablas trae un backup y en qué orden".
export const RESTORE_ORDER: { table: string; onConflict: string; userScoped: boolean }[] = [
  { table: 'profiles',    onConflict: 'user_id',      userScoped: true },
  // Layout del Dashboard personalizable — 1 fila por usuario, sin FKs (no depende de portfolios ni
  // de ninguna otra tabla), así que puede restaurarse en cualquier orden; va acá por prolijidad,
  // junto a profiles (mismo patrón de "singleton por usuario").
  { table: 'dashboard_layout', onConflict: 'user_id', userScoped: true },
  { table: 'portfolios',  onConflict: 'id',           userScoped: true },
  { table: 'brokers',     onConflict: 'id',           userScoped: true },
  { table: 'posiciones',  onConflict: 'id',           userScoped: false },
  // Después de brokers Y posiciones: posicion_brokers referencia (FK) a ambas.
  { table: 'posicion_brokers', onConflict: 'posicion_id,broker_id', userScoped: false },
  // Cronograma manual de amortización — depende solo de posiciones (FK posicion_id).
  { table: 'amortizaciones_programadas', onConflict: 'posicion_id,fecha', userScoped: false },
  { table: 'movimientos', onConflict: 'id',           userScoped: false },
  // Depende de posiciones Y movimientos (movimiento_id del ajuste de una amortización): tiene
  // que restaurarse después de ambas o la FK rechaza el insert.
  { table: 'cobros',      onConflict: 'id',           userScoped: false },
  { table: 'aportes',     onConflict: 'id',           userScoped: false },
  // Ledger independiente de cobros (no referencia filas puntuales): alcanza con que exista el
  // portfolio, no depende de cobros ni de posiciones.
  { table: 'cobros_inversiones', onConflict: 'id',    userScoped: false },
  { table: 'portfolio_snapshots', onConflict: 'portfolio_id,fecha', userScoped: false },
  { table: 'proyeccion_inputs', onConflict: 'portfolio_id', userScoped: false },
  { table: 'analisis_ia', onConflict: 'id',           userScoped: false },
  { table: 'cik_map',     onConflict: 'user_id,ticker', userScoped: true },
  { table: 'flujo_items', onConflict: 'id',           userScoped: true },
  { table: 'dcf_inputs',  onConflict: 'user_id,ticker', userScoped: true },
  { table: 'watchlist',   onConflict: 'user_id,ticker', userScoped: true }, // tiene unique(user_id,ticker)
  { table: 'bonos_destacados', onConflict: 'user_id,ticker', userScoped: true }, // PK (user_id, ticker)
];

export interface Preview {
  ok: boolean;
  error?: string;
  backup?: BackupFile;
  exportedAt?: string;
  fromEmail?: string | null;
  counts: Record<string, number>;
  total: number;
  avisos: string[];
}

export function parseBackup(text: string): Preview {
  let data: BackupFile;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'El archivo no es un JSON válido.', counts: {}, total: 0, avisos: [] }; }
  const avisos: string[] = [];
  if (!data || typeof data !== 'object' || !data.tables || typeof data.tables !== 'object') {
    return { ok: false, error: 'El archivo no tiene la estructura de un backup (falta "tables").', counts: {}, total: 0, avisos };
  }
  if (data.app && data.app !== 'portfolio-inversiones') avisos.push(`El backup dice ser de otra app ("${data.app}").`);
  // v1/v2/v3 igual se pueden restaurar (solo les faltan tablas que no existían todavía, o traen
  // posiciones.broker_id que ya no se usa) — el aviso es solo para versiones FUTURAS que este
  // código todavía no sepa interpretar.
  if (data.backup_version && data.backup_version > 9) avisos.push(`El backup es de una versión más nueva (v${data.backup_version}) que la soportada (v9).`);
  if (data.backup_version === 1) avisos.push('Backup v1 (anterior a Cobros y Proyección): no va a traer el historial de dividendos/intereses/amortizaciones ni los supuestos de Proyección guardados, porque todavía no existían.');
  if (data.backup_version === 1 || data.backup_version === 2) avisos.push('Backup anterior a Brokers: las posiciones van a quedar "Sin asignar" (no había ningún broker cargado todavía).');
  if (data.backup_version != null && data.backup_version <= 3) avisos.push('Backup anterior al reparto por broker (posicion_brokers): la asignación de brokers no se va a poder restaurar (la versión vieja guardaba un solo broker por posición, en un campo que ya no existe) — reasignalos desde la sección Brokers después de restaurar.');
  if (data.backup_version != null && data.backup_version <= 4) avisos.push('Backup anterior al saldo invertible (cobros_inversiones): no va a traer el historial de "cuánto del saldo disponible ya invertiste" — el saldo mostrado después de restaurar va a ser el bruto completo hasta que lo vuelvas a marcar.');
  // v6→v7: amortizaciones_programadas. v8→v9: bonos_destacados. Estos 2 avisos faltaban (encontrado
  // en revisión de Consejo) — todo bump de versión que agrega una tabla nueva tiene que avisar acá,
  // igual que dashboard_layout/cobros_inversiones/posicion_brokers de arriba, o un backup viejo
  // restaura en silencio sin que el usuario sepa que ese pedazo no volvió.
  if (data.backup_version != null && data.backup_version <= 6) avisos.push('Backup anterior al cronograma de amortización manual (amortizaciones_programadas): no va a traer las cuotas futuras que hayas cargado a mano para bonos amortizables — cargalas de nuevo si las necesitás para la proyección de Cupones.');
  if (data.backup_version != null && data.backup_version <= 7) avisos.push('Backup anterior al Dashboard personalizable (dashboard_layout): no va a traer tu layout de tarjetas guardado — la página va a mostrar el layout predeterminado hasta que lo vuelvas a personalizar.');
  if (data.backup_version != null && data.backup_version <= 8) avisos.push('Backup anterior a Destacados de renta fija (bonos_destacados): no va a traer los tickers que hayas marcado como destacados en el Radar — volvé a marcarlos si querés.');
  // El propio backup avisa si se generó incompleto (ver backup.ts): lo mostramos antes de restaurar.
  if (data.partial) avisos.push(`El backup se generó INCOMPLETO${data.errores?.length ? ` (falló: ${data.errores.join('; ')})` : ''}: puede faltar información.`);
  // transferencias es de solo lectura para el cliente (ver 0024_transferencias.sql) — se exporta
  // pero nunca se restaura; el estado de las posiciones en sí sí vuelve, vía la tabla posiciones.
  if (Array.isArray(data.tables.transferencias) && data.tables.transferencias.length > 0) {
    avisos.push('El historial de Transferencias no se restaura (solo se exporta) — las posiciones en sí vuelven con normalidad.');
  }
  const counts: Record<string, number> = {};
  let total = 0;
  for (const { table } of RESTORE_ORDER) {
    const n = Array.isArray(data.tables[table]) ? data.tables[table].length : 0;
    counts[table] = n; total += n;
  }
  return {
    ok: total > 0,
    error: total === 0 ? 'El backup no tiene registros para restaurar.' : undefined,
    backup: data, exportedAt: data.exported_at, fromEmail: data.user_email ?? null,
    counts, total, avisos,
  };
}
