import { type Env, json, preflight, guardAuth, sbSelect } from '../_shared';

// GET /api/market/status → última actualización de cada cache (para mostrarle al usuario cuándo
// se refrescaron los datos por última vez). No trae datos, solo timestamps — exige sesión.
//
// `?tickers=A,B,C` (opcional, los tickers TENIDOS): además devuelve la frescura de ESOS precios.
// Antes solo se informaba el `max(updated_at)` de toda la tabla: con un solo ticker refrescado hace
// 1 minuto el usuario veía "datos al hh:mm de hoy" aunque la mitad de SU cartera llevara días con el
// último precio conocido (fuente caída → fallback a cache viejo, sin marca).
export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// 3 días: cubre un fin de semana largo sin rueda (bonos/CEDEARs no cotizan) sin falsas alarmas.
export const HORAS_PRECIO_VIEJO = 72;
const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;

export function frescuraPrecios(
  tickers: string[], filas: { ticker: string; updated_at: string }[], ahoraMs: number, maxHoras = HORAS_PRECIO_VIEJO,
): { masViejo: string | null; viejos: string[] } {
  const porTicker = new Map(filas.map(f => [f.ticker, f.updated_at]));
  let masViejo: string | null = null;
  const viejos: string[] = [];
  for (const t of tickers) {
    const u = porTicker.get(t);
    if (!u) { viejos.push(t); continue; }                       // nunca se cacheó: sin precio
    if (masViejo == null || u < masViejo) masViejo = u;
    if (ahoraMs - Date.parse(u) > maxHoras * 3_600_000) viejos.push(t);
  }
  return { masViejo, viejos };
}

export const onRequestGet = guardAuth(async ({ env, request }) => {
  const latest = async (table: string): Promise<string | null> => {
    const rows = await sbSelect<{ updated_at: string }>(env, table, 'select=updated_at&order=updated_at.desc&limit=1');
    return rows[0]?.updated_at ?? null;
  };
  const tickers = [...new Set((new URL(request.url).searchParams.get('tickers') ?? '')
    .split(',').map(t => t.trim().toUpperCase()).filter(t => TICKER_RE.test(t)))].slice(0, 200);
  const [precios, macro, fundamentals, filas] = await Promise.all([
    latest('precios_cache'), latest('macro_cache'), latest('fundamentals_cache'),
    tickers.length
      ? sbSelect<{ ticker: string; updated_at: string }>(env, 'precios_cache', `select=ticker,updated_at&ticker=in.(${tickers.map(encodeURIComponent).join(',')})`)
      : Promise.resolve([]),
  ]);
  const all = [precios, macro, fundamentals].filter(Boolean) as string[];
  const last = all.length ? all.sort().at(-1) ?? null : null;
  const cartera = tickers.length ? frescuraPrecios(tickers, filas, Date.now()) : null;
  return json({ precios, macro, fundamentals, last, cartera });
});
