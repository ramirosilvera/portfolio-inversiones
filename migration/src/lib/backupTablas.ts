// =============================================================================
// REGISTRO ÚNICO de qué tablas entran en un backup, en qué orden se restauran y qué avisar cuando un
// backup viejo no las trae. Puro (sin Supabase): lo usan backup.ts (exportar), restore.ts (restaurar),
// backupParse.ts (preview, avisos, validaciones) y la UI (etiquetas) — antes eran DOS listas
// manuales (TABLAS y RESTORE_ORDER) más avisos de versión escritos a mano, y se desincronizaban:
// se olvidaron avisos de v7→v9 y dcf_analisis nunca entró. Ahora agregar una tabla es UNA entrada
// acá; los tests (backupTablas.test.ts) fallan si el orden rompe una FK o si una tabla no declara
// desde qué versión existe.
//
// Al agregar una tabla: (1) entrada nueva al FINAL de la sección que corresponda respetando FKs,
// (2) `desde` = BACKUP_VERSION nueva (subirla), (3) `avisoSiFalta` si el usuario pierde algo
// recreable a mano al restaurar un backup anterior.
// =============================================================================

// v11: registro único de tablas, checksum SHA-256 de `tables` (detecta archivo truncado/editado) y
// lectura en orden hijos→padres (un registro creado mientras se exporta nunca queda huérfano);
// agrega dcf_analisis.
export const BACKUP_VERSION = 11;

export interface TablaBackup {
  table: string;
  label: string;                // para la UI (preview del restore)
  onConflict: string | null;    // clave natural del upsert; null si la tabla no se restaura
  userScoped: boolean;          // lleva user_id → se re-mapea al usuario actual al restaurar
  restaurable: boolean;         // false = solo se exporta (ej. transferencias: se escribe por RPC)
  desde: number;                // versión de backup en la que apareció la tabla
  avisoSiFalta?: string;        // aviso para backups con backup_version < desde
  soloPersonal?: boolean;       // exportar solo filas con portfolio_id no nulo (analisis_ia)
}

// ORDEN = orden de restauración (padres antes que hijos). Ver REFERENCIAS más abajo.
export const BACKUP_TABLAS: TablaBackup[] = [
  { table: 'profiles', label: 'perfil', onConflict: 'user_id', userScoped: true, restaurable: true, desde: 1 },
  // 1 fila por usuario, sin FKs a otras tablas del backup: va junto a profiles (singleton por usuario).
  { table: 'dashboard_layout', label: 'layout Dashboard', onConflict: 'user_id', userScoped: true, restaurable: true, desde: 8,
    avisoSiFalta: 'Backup anterior al Dashboard personalizable (dashboard_layout): no va a traer tu layout de tarjetas guardado — la página va a mostrar el layout predeterminado hasta que lo vuelvas a personalizar.' },
  { table: 'portfolios', label: 'portfolios', onConflict: 'id', userScoped: true, restaurable: true, desde: 1 },
  { table: 'brokers', label: 'brokers', onConflict: 'id', userScoped: true, restaurable: true, desde: 3,
    avisoSiFalta: 'Backup anterior a Brokers: las posiciones van a quedar "Sin asignar" (no había ningún broker cargado todavía).' },
  { table: 'posiciones', label: 'posiciones', onConflict: 'id', userScoped: false, restaurable: true, desde: 1 },
  // Después de brokers Y posiciones: posicion_brokers referencia a ambas.
  { table: 'posicion_brokers', label: 'asignación de brokers', onConflict: 'posicion_id,broker_id', userScoped: false, restaurable: true, desde: 4,
    avisoSiFalta: 'Backup anterior al reparto por broker (posicion_brokers): la asignación de brokers no se va a poder restaurar (la versión vieja guardaba un solo broker por posición, en un campo que ya no existe) — reasignalos desde la sección Brokers después de restaurar.' },
  { table: 'amortizaciones_programadas', label: 'cronograma amortización', onConflict: 'posicion_id,fecha', userScoped: false, restaurable: true, desde: 7,
    avisoSiFalta: 'Backup anterior al cronograma de amortización manual (amortizaciones_programadas): no va a traer las cuotas futuras que hayas cargado a mano para bonos amortizables — cargalas de nuevo si las necesitás para la proyección de Cupones.' },
  // movimientos apunta a sí misma (liquidez_mov_id): restore.ts sube primero los que no tienen link.
  { table: 'movimientos', label: 'movimientos', onConflict: 'id', userScoped: false, restaurable: true, desde: 1 },
  // Depende de posiciones Y movimientos (movimiento_id, liquidez_mov_id).
  { table: 'cobros', label: 'cobros', onConflict: 'id', userScoped: false, restaurable: true, desde: 2,
    avisoSiFalta: 'Backup v1 (anterior a Cobros y Forecast): no va a traer el historial de dividendos/intereses/amortizaciones ni los supuestos de Forecast guardados, porque todavía no existían.' },
  { table: 'aportes', label: 'aportes', onConflict: 'id', userScoped: false, restaurable: true, desde: 1 },
  // Ledger independiente de cobros: alcanza con que exista el portfolio.
  { table: 'cobros_inversiones', label: 'saldo invertido', onConflict: 'id', userScoped: false, restaurable: true, desde: 5,
    avisoSiFalta: 'Backup anterior al saldo invertible (cobros_inversiones): no va a traer el historial de "cuánto del saldo disponible ya invertiste" — el saldo mostrado después de restaurar va a ser el bruto completo hasta que lo vuelvas a marcar.' },
  { table: 'portfolio_snapshots', label: 'histórico', onConflict: 'portfolio_id,fecha', userScoped: false, restaurable: true, desde: 1 },
  // Incluye el presupuesto congelado del Forecast (jsonb `presupuesto`).
  { table: 'proyeccion_inputs', label: 'supuestos forecast', onConflict: 'portfolio_id', userScoped: false, restaurable: true, desde: 2 },
  // Legacy (hoy sin uso en la UI), per-portfolio: se respalda por completitud.
  { table: 'dcf_analisis', label: 'DCF por portfolio', onConflict: 'portfolio_id,ticker', userScoped: false, restaurable: true, desde: 11 },
  // Análisis macro con portfolio_id NULL = cache del server legible por todos: no es personal.
  { table: 'analisis_ia', label: 'análisis IA', onConflict: 'id', userScoped: false, restaurable: true, desde: 1, soloPersonal: true },
  { table: 'cik_map', label: 'CIK', onConflict: 'user_id,ticker', userScoped: true, restaurable: true, desde: 1 },
  { table: 'flujo_items', label: 'flujo', onConflict: 'id', userScoped: true, restaurable: true, desde: 1 },
  { table: 'dcf_inputs', label: 'DCF', onConflict: 'user_id,ticker', userScoped: true, restaurable: true, desde: 1 },
  { table: 'watchlist', label: 'watchlist', onConflict: 'user_id,ticker', userScoped: true, restaurable: true, desde: 1 },
  { table: 'bonos_destacados', label: 'destacados renta fija', onConflict: 'user_id,ticker', userScoped: true, restaurable: true, desde: 9,
    avisoSiFalta: 'Backup anterior a Destacados de renta fija (bonos_destacados): no va a traer los tickers que hayas marcado como destacados en el Radar — volvé a marcarlos si querés.' },
  { table: 'ordenes_ejecutadas', label: 'órdenes ejecutadas', onConflict: 'id', userScoped: false, restaurable: true, desde: 10,
    avisoSiFalta: 'Backup anterior al registro de órdenes ejecutadas (ordenes_ejecutadas): no va a traer el detalle de órdenes cargadas en IOL — las posiciones y movimientos sí vuelven.' },
  // Solo exportable: sin política de insert para el cliente a propósito (se escribe por la RPC
  // transferir_posicion, atómica). El estado de las posiciones sí vuelve por `posiciones`.
  { table: 'transferencias', label: 'transferencias', onConflict: null, userScoped: false, restaurable: false, desde: 6 },
];

// Tablas de la base que a propósito NO entran (con el motivo): el test de consistencia exige que toda
// tabla pública esté en BACKUP_TABLAS o acá.
export const TABLAS_EXCLUIDAS: Record<string, string> = {
  precios_cache: 'cache de mercado compartido y re-descargable',
  fundamentals_cache: 'cache de mercado compartido y re-descargable',
  macro_cache: 'cache de mercado compartido y re-descargable',
  dividendos_cache: 'cache de mercado compartido y re-descargable',
  beta_cache: 'cache de mercado compartido y re-descargable',
  precio_historico_cache: 'cache de mercado compartido y re-descargable',
  edgar_ticker_cik: 'catálogo global (SEC), re-descargable',
  cedear_ratios: 'catálogo global',
  bonos_referencia: 'catálogo global de renta fija (lo mantiene la rutina mensual)',
  admin_users: 'administración de la plataforma, no son datos del usuario',
  admin_audit_log: 'administración de la plataforma, no son datos del usuario',
  usuarios_aprobados: 'administración de la plataforma, no son datos del usuario',
  // App vieja del Mundial (cerradas al acceso en 0050; sin uso en este código).
  fixture_contexts: 'app del Mundial (obsoleta)', prediction_snapshots: 'app del Mundial (obsoleta)',
  prediction_evaluations: 'app del Mundial (obsoleta)', wc_actual_results: 'app del Mundial (obsoleta)',
  wc_fixtures: 'app del Mundial (obsoleta)', app_events: 'app del Mundial (obsoleta)', match_goals: 'app del Mundial (obsoleta)',
  scf_heuristics: 'app del Mundial (obsoleta)', scf_match_examples: 'app del Mundial (obsoleta)',
  scf_match_predictions: 'app del Mundial (obsoleta)', ai_match_predictions: 'app del Mundial (obsoleta)',
};

export const TABLA_LABEL: Record<string, string> = Object.fromEntries(BACKUP_TABLAS.map(t => [t.table, t.label]));

// Claves foráneas ENTRE tablas del backup. Sirven para (1) el test que verifica el orden de restauración
// y (2) detectar registros huérfanos en el archivo antes de restaurar (backupParse.referenciasHuerfanas).
// `nullable`: la columna puede ser null (no se exige padre).
export interface Referencia { tabla: string; campo: string; padre: string; campoPadre: string; nullable?: boolean }
export const REFERENCIAS: Referencia[] = [
  { tabla: 'posiciones', campo: 'portfolio_id', padre: 'portfolios', campoPadre: 'id' },
  { tabla: 'posicion_brokers', campo: 'posicion_id', padre: 'posiciones', campoPadre: 'id' },
  { tabla: 'posicion_brokers', campo: 'broker_id', padre: 'brokers', campoPadre: 'id' },
  { tabla: 'amortizaciones_programadas', campo: 'posicion_id', padre: 'posiciones', campoPadre: 'id' },
  { tabla: 'movimientos', campo: 'portfolio_id', padre: 'portfolios', campoPadre: 'id' },
  { tabla: 'movimientos', campo: 'posicion_id', padre: 'posiciones', campoPadre: 'id', nullable: true },
  { tabla: 'movimientos', campo: 'liquidez_mov_id', padre: 'movimientos', campoPadre: 'id', nullable: true },
  { tabla: 'cobros', campo: 'portfolio_id', padre: 'portfolios', campoPadre: 'id' },
  { tabla: 'cobros', campo: 'posicion_id', padre: 'posiciones', campoPadre: 'id', nullable: true },
  { tabla: 'cobros', campo: 'movimiento_id', padre: 'movimientos', campoPadre: 'id', nullable: true },
  { tabla: 'cobros', campo: 'liquidez_mov_id', padre: 'movimientos', campoPadre: 'id', nullable: true },
  { tabla: 'aportes', campo: 'portfolio_id', padre: 'portfolios', campoPadre: 'id' },
  { tabla: 'cobros_inversiones', campo: 'portfolio_id', padre: 'portfolios', campoPadre: 'id' },
  { tabla: 'portfolio_snapshots', campo: 'portfolio_id', padre: 'portfolios', campoPadre: 'id' },
  { tabla: 'proyeccion_inputs', campo: 'portfolio_id', padre: 'portfolios', campoPadre: 'id' },
  { tabla: 'dcf_analisis', campo: 'portfolio_id', padre: 'portfolios', campoPadre: 'id' },
  { tabla: 'analisis_ia', campo: 'portfolio_id', padre: 'portfolios', campoPadre: 'id', nullable: true },
  { tabla: 'ordenes_ejecutadas', campo: 'portfolio_id', padre: 'portfolios', campoPadre: 'id' },
];
