import { type Env, json, preflight, guardAuth, cacheFresh, cacheLast, missReciente, sbUpsert, fetchJson, TICKER_RE } from '../_shared';

// Beta cambia poco — TTL largo. Y si el proveedor falla, un beta de hace meses sigue siendo mucho
// mejor que el default fijo de 1.0 (que no dice nada de la volatilidad REAL de la empresa).
const TTL = 30 * 24 * 60 * 60 * 1000;       // 30 días
const MAX_STALE = 180 * 24 * 60 * 60 * 1000; // 180 días de fallback ante fallo del proveedor
// Caché negativo: un ticker sin beta en ninguno de los dos proveedores (small-cap sin cobertura de
// analistas) no va a tener beta mañana tampoco — TTL negativo largo, mismo orden que TTL positivo
// dividido, para no seguir gastando cuota en algo que ya sabemos que no está (hallazgo de auditoría).
const NEG_TTL = 24 * 60 * 60 * 1000; // 1 día

interface BetaRow { beta: number; fuente: string }

// Mismo orden que quotes.ts (Finnhub primero, FMP como fallback) — así reusa los mismos secrets ya
// configurados, sin pedir uno nuevo.
async function fetchBeta(env: Env, symbol: string): Promise<BetaRow | null> {
  if (env.FINNHUB_API_KEY) {
    try {
      const q = await fetchJson<{ metric?: { beta?: number } }>(
        `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${env.FINNHUB_API_KEY}`);
      const b = q.metric?.beta;
      if (b != null && Number.isFinite(b) && b > 0) return { beta: b, fuente: 'finnhub' };
    } catch { /* fallthrough */ }
  }
  if (env.FMP_API_KEY) {
    try {
      const q = await fetchJson<{ beta?: number }[]>(
        `https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${env.FMP_API_KEY}`);
      const b = q[0]?.beta;
      if (b != null && Number.isFinite(b) && b > 0) return { beta: b, fuente: 'fmp' };
    } catch { /* none */ }
  }
  return null;
}

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/beta?ticker=MSFT → { beta: 0.9, fuente: 'finnhub', cached?: true }
// beta:null si ningún proveedor lo tiene (ticker chico, ADR raro, etc.) — el caller decide el
// default (hoy 1.0), esta Function nunca inventa un número.
export const onRequestGet = guardAuth(async ({ request, env }) => {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  if (!ticker) return json({ error: 'ticker requerido' }, 400);
  if (!TICKER_RE.test(ticker)) return json({ error: 'ticker-invalido' }, 400);

  const cached = await cacheFresh<BetaRow>(env, 'beta_cache', 'ticker', ticker, TTL);
  if (cached) return json({ beta: cached.beta, fuente: cached.fuente, cached: true });

  // Miss reciente: ya sabemos que ningún proveedor tiene beta de este ticker — no gastamos cuota
  // de nuevo, vamos directo al último valor conocido (si hay).
  if (await missReciente(env, 'beta_cache', 'ticker', ticker, NEG_TTL)) {
    const last = await cacheLast<BetaRow>(env, 'beta_cache', 'ticker', ticker, MAX_STALE);
    return json(last ? { beta: last.beta, fuente: last.fuente, cached: true, stale: true } : { beta: null });
  }

  const fetched = await fetchBeta(env, ticker);
  if (fetched) {
    await sbUpsert(env, 'beta_cache', [{ ticker, beta: fetched.beta, fuente: fetched.fuente, updated_at: new Date().toISOString() }], 'ticker');
    return json(fetched);
  }
  await sbUpsert(env, 'beta_cache', [{ ticker, miss_at: new Date().toISOString() }], 'ticker');
  const last = await cacheLast<BetaRow>(env, 'beta_cache', 'ticker', ticker, MAX_STALE);
  if (last) return json({ beta: last.beta, fuente: last.fuente, cached: true, stale: true });
  return json({ beta: null });
});
