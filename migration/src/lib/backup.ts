import { supabase } from './supabase';
import { descargarTexto } from './download';

// Backup completo de los datos del usuario. Todo pasa por el cliente con RLS (user_id = auth.uid()),
// así que cada select('*') devuelve SOLO los datos del usuario. Se excluyen los caches de mercado
// (precios/fundamentos/macro) porque son datos compartidos y re-descargables, no personales.
// v3: agrega brokers (tabla nueva — sin esto, restaurar en una cuenta nueva perdía la lista de
// brokers y las posiciones volvían a quedar todas "Sin asignar").
// v4: posiciones vuelve a ser 1 fila por ticker; el reparto entre brokers pasa a posicion_brokers
// (reemplaza posiciones.broker_id, que ya no existe). Ver 0018_posicion_brokers.sql.
// v5: agrega cobros_inversiones (ledger de "cuánto del saldo disponible ya se invirtió"). Ver
// 0019_cobros_inversiones.sql.
// v6: agrega transferencias (historial de reasignaciones entre portfolios propios). Es SOLO
// exportable, no restaurable: la tabla no tiene política de insert para el cliente a propósito
// (solo se escribe vía transferir_posicion(), atómica — ver 0024_transferencias.sql) — restaurar
// filas sueltas ahí, sin la posición exacta que originaron, podría dejar el historial inconsistente.
// El estado de las posiciones en sí (cantidades post-transferencia) sí se restaura normal, vía la
// tabla posiciones.
// calificadora/calificacion (0026_bond_rating.sql) NO requirieron bump de versión ni cambios acá:
// son 2 columnas nuevas en `posiciones`, tabla ya incluida — el select('*') de fetchAll() y el
// upsert genérico de restore.ts las traen/restauran solas, igual que cupon_tasa/vencimiento en v1.
// amortizable/valor_residual (0027_bond_amortizable.sql) tampoco: mismo caso — 2 columnas nuevas en
// `posiciones`, cubiertas por el mismo select('*')/upsert genérico. El registro del EVENTO de
// amortización (cobro + el ajuste de nominal o de valor_residual que haga, ver useCobros.ts) también
// viaja solo: son filas normales en `cobros`/`movimientos`, tablas ya incluidas.
// v7: agrega amortizaciones_programadas (cronograma manual de cuotas FUTURAS, solo para la
// proyección de Cupones — ver 0028_amortizaciones_programadas.sql). Tabla nueva (no columnas sobre
// una ya incluida, como los 2 casos de arriba), así que SÍ hace falta sumarla a TABLAS.
// v8: agrega dashboard_layout (layout del Dashboard personalizable — qué tarjetas, en qué orden. Ver
// 0029_dashboard_layout.sql). Tabla nueva, 1 fila JSONB por usuario (no por portfolio, mismo criterio
// que flujo_items) — mismo motivo que v7, hace falta sumarla a TABLAS explícitamente.
// v9: agrega bonos_destacados (tickers de renta fija marcados como destacados en el Radar — ver
// 0038_bonos_destacados.sql). Tabla nueva, per-user (no forma parte de bonos_referencia, que es el
// catálogo global y no se exporta) — mismo motivo que v7/v8, hace falta sumarla a TABLAS.
// posiciones.ley (0044_posiciones_ley.sql) tampoco requirió bump: mismo caso que calificadora/
// calificacion/amortizable/valor_residual arriba — 1 columna nueva en `posiciones`, tabla ya
// incluida, cubierta sola por select('*')/upsert genérico. bonos_referencia.ley (0042) ni entra en
// esta discusión: esa tabla es el catálogo global, nunca se exporta (mismo motivo que
// cedear_ratios/fundamentals_cache).
// Al sumar una tabla nueva acá (bump de versión): agregar también el aviso correspondiente en
// parseBackup() (restore.ts) para backups <= la versión anterior — si no, un backup viejo restaura
// esa tabla vacía EN SILENCIO, sin que el usuario sepa que ese pedazo no volvió (bug real
// encontrado en revisión de Consejo: a v7→v9 les faltaban esos 2 avisos).
export const BACKUP_VERSION = 9;

const TABLAS = [
  'portfolios', 'brokers', 'posiciones', 'posicion_brokers', 'movimientos', 'aportes', 'portfolio_snapshots',
  'flujo_items', 'dcf_inputs', 'proyeccion_inputs', 'cobros', 'cobros_inversiones', 'transferencias',
  'amortizaciones_programadas', 'dashboard_layout', 'cik_map', 'watchlist', 'bonos_destacados', 'analisis_ia', 'profiles',
] as const;

export interface BackupResult {
  json: string;
  filename: string;
  counts: Record<string, number>;
  total: number;
  errores: string[];
}

// Filtros por tabla: en analisis_ia excluimos las filas con portfolio_id NULL (análisis macro
// escritos por el server, legibles por cualquier usuario y re-generables) para que el backup sea
// ESTRICTAMENTE personal, no cache compartido.
type Filtro = (q: ReturnType<ReturnType<typeof supabase.from>['select']>) => typeof q;
const FILTROS: Record<string, Filtro> = {
  analisis_ia: q => q.not('portfolio_id', 'is', null),
};

// Trae TODAS las filas de una tabla paginando de a 1000 (el default de PostgREST) para que un
// backup nunca quede truncado silenciosamente.
async function fetchAll(table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    let q = supabase.from(table).select('*').range(from, from + size - 1);
    const filtro = FILTROS[table];
    if (filtro) q = filtro(q);
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

  await Promise.all(TABLAS.map(async (t) => {
    try {
      const rows = await fetchAll(t);
      tables[t] = rows;
      counts[t] = rows.length;
    } catch (e) {
      // Si una tabla falla (p.ej. no existe en este proyecto), la marcamos pero seguimos con el resto.
      errores.push(`${t}: ${e instanceof Error ? e.message : 'error'}`);
      tables[t] = [];
      counts[t] = 0;
    }
  }));

  const now = new Date();
  const payload = {
    app: 'portfolio-inversiones',
    backup_version: BACKUP_VERSION,
    exported_at: now.toISOString(),
    user_email: email,
    // partial + errores quedan EN el archivo: así, al restaurar meses después, un backup incompleto
    // no se confunde con uno completo (una tabla vacía por fallo vs. vacía de verdad).
    partial: errores.length > 0,
    errores,
    counts,
    tables,
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
