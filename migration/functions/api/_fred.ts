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
