import { type Env, json, preflight, guardAuth, cacheFresh, cacheLast, sbUpsert, fetchJson, parseTickers } from '../_shared';

const TTL = 15 * 60 * 1000; // 15 min

async function fetchPrice(env: Env, symbol: string): Promise<number | null> {
  // Finnhub primero (free tier generoso), FMP como fallback.
  if (env.FINNHUB_API_KEY) {
    try {
      const q = await fetchJson<{ c?: number }>(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${env.FINNHUB_API_KEY}`);
      if (q.c && q.c > 0) return q.c;
    } catch { /* fallthrough */ }
  }
  if (env.FMP_API_KEY) {
    try {
      const q = await fetchJson<{ price?: number }[]>(`https://financialmodelingprep.com/api/v3/quote-short/${symbol}?apikey=${env.FMP_API_KEY}`);
      if (q[0]?.price) return q[0].price;
    } catch { /* none */ }
  }
  return null;
}

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/quotes?tickers=MSFT,MA,KO  → { MSFT: 420.1, MA: ..., ... }
export const onRequestGet = guardAuth(async ({ request, env }) => {
  const url = new URL(request.url);
  // Dedupe: una posición partida entre brokers repite el ticker en la lista del frontend (dos filas,
  // mismo ticker). Sin esto se pedía/escribía el precio dos veces por nada — y si el batch de
  // sbUpsert llegaba a tener el mismo ticker repetido, Postgres rechazaba TODO el lote (ver
  // dedupeByConflictKey en _shared.ts, ya blindado ahí también — esto es la segunda capa).
  // parseTickers también descarta cualquier valor con formato inválido (ver TICKER_RE).
  const tickers = parseTickers(url, 'tickers', 'ticker');
  if (!tickers.length) return json({ error: 'tickers requerido' }, 400);
  // Tope defensivo: sin esto, una lista arbitrariamente larga dispara un fetch a un proveedor PAGO
  // por cada ticker (Promise.all sin límite) — una cartera real nunca tiene tantos activos.
  if (tickers.length > 60) return json({ error: 'demasiados tickers (máx 60)' }, 413);

  const out: Record<string, number | null> = {};
  const rows: unknown[] = [];
  await Promise.all(tickers.map(async (t) => {
    const cached = await cacheFresh<{ precio: number }>(env, 'precios_cache', 'ticker', t, TTL);
    if (cached) { out[t] = cached.precio; return; }
    const p = await fetchPrice(env, t);
    if (p != null) { out[t] = p; rows.push({ ticker: t, precio: p, moneda: 'USD', updated_at: new Date().toISOString() }); }
    // Proveedor caído: último precio conocido (aunque vencido) antes que vaciar la cotización.
    else out[t] = (await cacheLast<{ precio: number }>(env, 'precios_cache', 'ticker', t))?.precio ?? null;
  }));
  if (rows.length) await sbUpsert(env, 'precios_cache', rows, 'ticker');
  return json(out);
});
