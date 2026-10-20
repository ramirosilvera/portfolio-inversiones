// =============================================================================
// Parámetros de Bienes Personales del año en curso, ESTIMADOS con el IPC de INDEC — puro (el fetch se inyecta) y testeado.
//
// ARCA actualiza cada año el mínimo no imponible, el umbral de casa-habitación y los tramos de la escala por la variación del IPC de
// octubre contra octubre (ley 27.667). El resultado oficial recién sale en enero-febrero del año siguiente, pero el IPC de octubre lo
// publica INDEC a mediados de noviembre: ya se puede calcular con exactitud casi total. Control de la fórmula con datos reales:
// período 2024 $ 292.994.964,89 × 1,3131 (IPC oct-25/oct-24 = 31,31 %) ≈ período 2025 $ 384.728.044,57.
//
// Estas filas se guardan con estimado = true y NUNCA pisan una fila oficial (estimado = false), que se carga a mano o por la rutina
// anual cuando ARCA publica. Las alícuotas no se tocan (la ley las baja en 2026 y 2027 pero los tramos todavía no están publicados:
// dejarlas como están es la cota alta).
// =============================================================================

export const INDEC_IPC_SERIE = '148.3_INIVELNAL_DICI_M_26';   // IPC nacional, nivel general, base dic-2016, mensual
export const urlIPC = (desde: string) =>
  `https://apis.datos.gob.ar/series/api/series?ids=${INDEC_IPC_SERIE}&start_date=${desde}&format=json`;

export type SerieIPC = Map<string, number>;   // 'YYYY-MM' → índice

/** Respuesta de la API de series de tiempo: { data: [['2025-10-01', 6612.3], ...] }. Ignora filas inválidas. */
export function parsearIPC(body: unknown): SerieIPC {
  const out: SerieIPC = new Map();
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return out;
  for (const fila of data) {
    if (!Array.isArray(fila)) continue;
    const [fecha, valor] = fila as [unknown, unknown];
    const v = typeof valor === 'number' ? valor : Number.NaN;
    if (typeof fecha !== 'string' || !/^\d{4}-\d{2}/.test(fecha) || !(v > 0) || !Number.isFinite(v)) continue;
    out.set(fecha.slice(0, 7), v);
  }
  return out;
}

/** Variación del IPC de octubre del año contra octubre del anterior (1,3131 = +31,31 %); null si falta alguno de los dos meses. */
export function factorIPC(serie: SerieIPC, anio: number): number | null {
  const act = serie.get(`${anio}-10`), ant = serie.get(`${anio - 1}-10`);
  return act != null && ant != null ? act / ant : null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ParamsBase { minimoNoImponible: number; casaHabitacion: number }
export interface TramoBase { hasta: number | null; fijo: number; alicuota: number }

export function escalarParams(b: ParamsBase, factor: number): ParamsBase {
  return { minimoNoImponible: r2(b.minimoNoImponible * factor), casaHabitacion: r2(b.casaHabitacion * factor) };
}
export function escalarTramos(t: TramoBase[], factor: number): TramoBase[] {
  return t.map(x => ({ hasta: x.hasta == null ? null : r2(x.hasta * factor), fijo: r2(x.fijo * factor), alicuota: x.alicuota }));
}

export interface FilaParametro {
  anio: number; clave: 'bp_params' | 'bp_escala'; valor: unknown; estimado: boolean; verificado: boolean; fuente: string;
}
interface FilaDB { anio: number; clave: string; valor: unknown; estimado: boolean }

const esParams = (v: unknown): v is ParamsBase =>
  !!v && typeof (v as ParamsBase).minimoNoImponible === 'number' && typeof (v as ParamsBase).casaHabitacion === 'number';
const esEscala = (v: unknown): v is { tramos: TramoBase[] } => {
  const t = (v as { tramos?: unknown })?.tramos;
  return Array.isArray(t) && t.length > 0 && t.every(x => typeof x?.fijo === 'number' && typeof x?.alicuota === 'number');
};

/**
 * Qué filas escribir para `anio` (vacío = nada que hacer). Reglas: (1) si ya hay una fila de ese año —oficial o estimada— no se vuelve
 * a pedir nada (el IPC de octubre no cambia una vez publicado); (2) la base es SIEMPRE la fila oficial del año anterior, nunca una
 * estimada (no se acumulan estimaciones); (3) si INDEC todavía no publicó octubre, no se escribe nada.
 * `obtenerIPC` se llama como mucho una vez y solo si hace falta (a partir del 1/11, cuando INDEC está por publicar octubre).
 */
export async function filasEstimadas(anio: number, existentes: FilaDB[], obtenerIPC: (desde: string) => Promise<unknown>, hoy: string): Promise<FilaParametro[]> {
  // Antes de noviembre el IPC de octubre no existe: no se le pide nada a INDEC (sin esto el cron lo consultaba todos los días del año).
  if (hoy < `${anio}-11-01`) return [];
  if (existentes.some(f => f.anio === anio)) return [];
  const base = (clave: string) => existentes.find(f => f.anio === anio - 1 && f.clave === clave && !f.estimado)?.valor;
  const params = base('bp_params'), escala = base('bp_escala');
  if (!esParams(params) || !esEscala(escala)) return [];
  const factor = factorIPC(parsearIPC(await obtenerIPC(`${anio - 1}-10`)), anio);
  if (factor == null || !(factor > 0.5 && factor < 5)) return [];   // el segundo chequeo corta un dato roto (factor absurdo) antes de guardarlo
  const fuente = `Estimado con el IPC de INDEC (oct-${anio}/oct-${anio - 1} = ${((factor - 1) * 100).toFixed(2)} %) sobre el período ${anio - 1}; pendiente de la publicación de ARCA`;
  return [
    { anio, clave: 'bp_params', valor: escalarParams(params, factor), estimado: true, verificado: false, fuente },
    { anio, clave: 'bp_escala', valor: { tramos: escalarTramos(escala.tramos, factor) }, estimado: true, verificado: false, fuente },
  ];
}
