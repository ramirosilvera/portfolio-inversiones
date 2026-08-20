// Resolución automática de CIK de EDGAR para tickers fuera de DEFAULT_CIK (ver fundamentals.ts).
// Puro y testeado — la parte con I/O (fetch a FMP, lectura/escritura de edgar_ticker_cik) vive en
// fundamentals.ts, que no tiene tests directos (mismo criterio que el resto de las Functions: la
// lógica que vale la pena testear se extrae acá, el glue de red/Supabase no).

import { CIK_RE } from './_shared';

// CIK de EDGAR: siempre 10 dígitos, con ceros a la izquierda — mismo formato que CIK_RE ya exige
// para el ?cik= manual (Configuración). Cualquier otra cosa (null, string vacío, formato raro) se
// descarta acá: preferimos "no se pudo resolver" (y caer al flujo manual) antes que guardar en el
// cache GLOBAL algo que no es un CIK real.
export function validarCik(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return CIK_RE.test(s) ? s : null;
}

// La respuesta de FMP /api/v3/profile/{symbol} es un array (0 o 1 elementos) con, entre otros
// campos, `cik` — mismo endpoint que ya usa beta.ts para el beta (mismo secret FMP_API_KEY, sin
// pedir uno nuevo). Confirmado con AAPL: FMP devuelve cik "0000320193", igual al DEFAULT_CIK
// hardcodeado de este proyecto para AAPL — mismo formato, mismo valor real.
export function extraerCikDeFmpProfile(profile: unknown): string | null {
  if (!Array.isArray(profile) || profile.length === 0) return null;
  const row = profile[0] as { cik?: unknown } | undefined;
  return validarCik(row?.cik);
}
