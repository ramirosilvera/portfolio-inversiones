import { type Env, json, preflight, guardAuth, cacheFresh, cacheLast, sbUpsert, parseTickers } from '../_shared';
import { fetchDividendos, proyectarDividendo, type DividendEvent, type DividendoInfo } from '../_dividendos';

const TTL = 24 * 60 * 60 * 1000; // 24h — calendario de dividendos no cambia minuto a minuto

interface CacheRow { data_json: { historical: DividendEvent[] } }

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/dividendos?tickers=AAPL,MSFT → { AAPL: DividendoInfo | null, ... }
// Nunca rompe si no hay FMP_API_KEY/FINNHUB_API_KEY: devuelve null por ticker y la UI cae a
// "sin dato" (dividendos de CEDEARs/acciones no tienen fuente automática hoy sin esas keys).
export const onRequestGet = guardAuth(async ({ request, env }) => {
  const url = new URL(request.url);
  const tickers = parseTickers(url, 'tickers', 'ticker');
  if (!tickers.length) return json({ error: 'tickers requerido' }, 400);
  if (tickers.length > 60) return json({ error: 'demasiados tickers (máx 60)' }, 413);

  const hoy = new Date().toISOString().slice(0, 10);
  const out: Record<string, DividendoInfo | null> = {};
  const rows: unknown[] = [];

  await Promise.all(tickers.map(async (t) => {
    const cached = await cacheFresh<CacheRow>(env, 'dividendos_cache', 'ticker', t, TTL);
    if (cached?.data_json?.historical) { out[t] = proyectarDividendo(cached.data_json.historical, hoy); return; }

    const historical = await fetchDividendos(env, t);
    if (historical) {
      out[t] = proyectarDividendo(historical, hoy);
      rows.push({ ticker: t, data_json: { historical }, updated_at: new Date().toISOString() });
      return;
    }
    // Proveedor caído o sin key configurada: último historial conocido (aunque vencido) antes que
    // devolver "sin dato" — mismo criterio que quotes.ts/fundamentals.ts.
    const last = await cacheLast<CacheRow>(env, 'dividendos_cache', 'ticker', t);
    out[t] = last?.data_json?.historical ? proyectarDividendo(last.data_json.historical, hoy) : null;
  }));

  if (rows.length) await sbUpsert(env, 'dividendos_cache', rows, 'ticker');
  return json(out);
});
