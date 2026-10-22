import { valorPlausible } from '../../src/engine/macroRangos';

// Último valor de un CSV de FRED (fredgraph.csv?id=SERIE), validando que SEA ese CSV. Antes se tomaba la segunda columna de la última línea
// de cualquier cosa que respondiera con HTTP 200: una página de error/bloqueo leída así dejó las cinco series en 400 (parseFloat('400px')).
// Formato esperado: encabezado `observation_date,SERIE` (o `DATE,SERIE`) y filas `AAAA-MM-DD,valor`, con `.` como dato faltante.
// Cualquier línea que no cumpla, o un valor fuera de rango plausible (ver engine/macroRangos.ts), invalida TODO: devuelve null.
export function parsearFredCsv(csv: string, serie: string, clave: string): number | null {
  const lineas = csv.trim().split(/\r?\n/);
  if (lineas.length < 2) return null;
  const cab = lineas[0].trim().split(',');
  if (cab.length !== 2 || !/^(observation_date|date)$/i.test(cab[0]) || cab[1].trim().toUpperCase() !== serie.toUpperCase()) return null;
  let ultimo: number | null = null;
  for (let i = 1; i < lineas.length; i++) {
    const m = /^(\d{4}-\d{2}-\d{2}),\s*(-?\d+(?:\.\d+)?|\.)?\s*$/.exec(lineas[i]);
    if (!m) return null;                               // una línea que no es dato de FRED: no es el CSV
    if (m[2] && m[2] !== '.') ultimo = parseFloat(m[2]);
  }
  return ultimo != null && valorPlausible(clave, ultimo) ? ultimo : null;
}

export interface RespuestaFred { status: number; contentType: string; texto: string }

// Pide el CSV de una serie. Se identifica con un User-Agent (el fetch por defecto de un Worker no manda uno propio y varios sitios sirven una página
// de bloqueo/verificación a los clientes sin identificar). A diferencia de fetchText NO descarta las respuestas no-2xx: el diagnóstico necesita verlas.
export async function pedirFred(serie: string, timeoutMs = 20_000): Promise<RespuestaFred> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(serie)}`, {
      signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; portfolio-inversiones)', Accept: 'text/csv,*/*;q=0.8' },
    });
    return { status: res.status, contentType: res.headers.get('content-type') ?? '', texto: await res.text() };
  } finally { clearTimeout(t); }
}

/** Resumen corto y sin saltos de línea de una respuesta que no era el CSV, para dejarlo en el log / en el JSON del cron. */
export function resumenDiag(serie: string, r: RespuestaFred, maxCaracteres = 140): string {
  return `${serie} http ${r.status} ${r.contentType.split(';')[0] || 's/ct'} len ${r.texto.length}: ${r.texto.replace(/\s+/g, ' ').trim().slice(0, maxCaracteres)}`;
}
