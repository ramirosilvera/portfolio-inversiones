import { type Env, json, preflight, guardAuth, cacheFresh, cacheLast, sbUpsert, fetchJson, parseTickers, TICKER_RE } from '../_shared';

const TTL = 20 * 60 * 1000; // 20 min

// Acciones argentinas (BYMA) desde data912, precio en ARS. Se convierte a USD con el MEP
// (macro_cache.dolar_mep, que puebla /api/market/fx) para valuar en la moneda de la app.
function priceOf(x: Record<string, unknown>): number | null {
  for (const k of ['c', 'close', 'last', 'px', 'price', 'ultimo']) {
    const v = x[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v; // ARS, sin /100 (no es bono)
  }
  return null;
}
function symbolOf(x: Record<string, unknown>): string | null {
  for (const k of ['symbol', 'ticker', 'especie', 'simbolo']) {
    const v = x[k];
    if (typeof v === 'string' && v) return v.toUpperCase();
  }
  return null;
}

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/acciones-ar?tickers=YPFD,GGAL,PAMP  → { YPFD: <usd>, ... }
export const onRequestGet = guardAuth(async ({ request, env }) => {
  const url = new URL(request.url);
  const tickers = parseTickers(url, 'tickers');
  if (tickers.length > 60) return json({ error: 'demasiados tickers (máx 60)' }, 413);

  // MEP para pasar ARS → USD. TTL 30 min (igual que fx.ts): con 6h, en días volátiles la
  // conversión podía usar un MEP viejo y desviar la valuación.
  const mepRow = await cacheFresh<{ valor: number }>(env, 'macro_cache', 'clave', 'dolar_mep', 30 * 60 * 1000);
  let mep = mepRow?.valor ?? null;
  if (!mep) {
    try { const d = await fetchJson<{ venta?: number }>('https://dolarapi.com/v1/dolares/bolsa'); mep = d.venta ?? null; } catch { /* */ }
  }

  const arsMap: Record<string, number> = {};
  try {
    const arr = await fetchJson<Record<string, unknown>[]>('https://data912.com/live/arg_stocks');
    for (const it of arr ?? []) {
      const s = symbolOf(it), p = priceOf(it);
      if (s && p != null) arsMap[s] = p;
    }
  } catch { /* proveedor caído */ }

  const out: Record<string, number | null> = {};
  const rows: unknown[] = [];
  const wanted = tickers.length ? tickers : Object.keys(arsMap);
  for (const t of wanted) {
    const ars = arsMap[t];
    const usdFresco = ars != null && mep ? +(ars / mep).toFixed(4) : null;
    if (usdFresco != null) {
      out[t] = usdFresco;
      rows.push({ ticker: t, precio: usdFresco, moneda: 'USD', updated_at: new Date().toISOString() });
      continue;
    }
    // data912 caído (o sin MEP) devolvía 200 con el mapa vacío → el front valuaba a COSTO sin
    // ninguna señal. Servimos el último precio conocido, como ya hace quotes.ts — pero SIN volver a
    // subirlo a la cache: antes esto re-upseteaba el precio viejo con `updated_at: ahora`, lo que
    // "lavaba" un precio de hasta 7 días (MAX_STALE_MS) como si fuera fresco — cada llamada más
    // renovaba el timestamp de nuevo, así que un precio viejo nunca volvía a marcarse como stale ni
    // se reintentaba de verdad. Sin re-upsert, el `updated_at` real queda intacto y cacheFresh/
    // cacheLast lo siguen viendo como lo que es: un dato viejo, no uno nuevo.
    out[t] = (await cacheLast<{ precio: number }>(env, 'precios_cache', 'ticker', t))?.precio ?? null;
  }
  if (rows.length) await sbUpsert(env, 'precios_cache', rows, 'ticker');
  return json({ mep, precios: out });
});
