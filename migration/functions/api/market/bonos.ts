import { type Env, json, preflight, guardAuth, cacheFresh, cacheLast, sbSelect, sbUpsert, fetchJson, MAX_STALE_MS } from '../_shared';

const TTL = 30 * 60 * 1000; // 30 min
const LISTS = ['arg_corp', 'arg_bonds', 'arg_notes'] as const;

// data912 devuelve precio por cada 100 nominales (paridad) → dividir por 100 = precio por nominal.
// OJO con la MONEDA: las listas traen especies hard-dollar Y especies en PESOS. Si una especie en
// pesos se guarda como USD, la posición queda sobrevaluada ~1000× y contamina patrimonio, TIR y
// pesos objetivo. Por eso se distingue por sufijo (convención BYMA: D = MEP/hard dollar, C = CCL)
// y las especies en pesos se convierten con el MEP; si no hay MEP, se devuelve null (no se inventa).
function rawPrice(x: Record<string, unknown>): number | null {
  for (const k of ['c', 'close', 'last', 'px', 'price', 'ultimo']) {
    const v = x[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v / 100;
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

// Convención de especies argentinas: el sufijo D (dólar MEP) o C (CCL) indica liquidación en USD;
// sin sufijo, la especie liquida en PESOS. Cubre soberanos (AL30D/GD30C) y ONs (YM41D, XMC1D…).
export function esHardDollar(ticker: string): boolean {
  return ticker.length >= 3 && (ticker.endsWith('D') || ticker.endsWith('C'));
}

// Completa el mapa de precios VIVOS con el último precio cacheado para los tickers que data912 no
// devolvió en este request (proveedor caído, o simplemente no lista esa especie puntual) — nunca pisa
// un precio que sí vino vivo. Extraída como función pura (separada del handler HTTP) para poder
// testearla sin mockear fetch/Supabase, mismo criterio que parseTwelveData/parseEodhd en _dividendos.ts.
export function mergeFallback(map: Record<string, number>, cacheados: { ticker: string; precio: number }[]): Record<string, number> {
  const out = { ...map };
  for (const c of cacheados) if (!(c.ticker in out)) out[c.ticker] = c.precio;
  return out;
}

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/bonos            → { YM41D: 0.982, ... }  (precio por nominal, en USD)
// GET /api/market/bonos?ticker=X   → { ticker: 'X', precio: n }
export const onRequestGet = guardAuth(async ({ request, env }) => {
  const url = new URL(request.url);
  const one = (url.searchParams.get('ticker') || '').toUpperCase().trim();

  if (one) {
    const cached = await cacheFresh<{ precio: number }>(env, 'precios_cache', 'ticker', one, TTL);
    if (cached) return json({ ticker: one, precio: cached.precio });
  }

  // MEP para pasar a USD las especies en pesos (mismo criterio que acciones-ar.ts).
  const mepRow = await cacheFresh<{ valor: number }>(env, 'macro_cache', 'clave', 'dolar_mep', 30 * 60 * 1000);
  let mep = mepRow?.valor ?? null;
  if (!mep) {
    try { const d = await fetchJson<{ venta?: number }>('https://dolarapi.com/v1/dolares/bolsa'); mep = d.venta ?? null; } catch { /* */ }
  }
  if (!mep) mep = (await cacheLast<{ valor: number }>(env, 'macro_cache', 'clave', 'dolar_mep'))?.valor ?? null;

  const map: Record<string, number> = {};
  await Promise.all(LISTS.map(async (l) => {
    try {
      const arr = await fetchJson<Record<string, unknown>[]>(`https://data912.com/live/${l}`);
      for (const it of arr ?? []) {
        const s = symbolOf(it), p = rawPrice(it);
        if (!s || p == null) continue;
        if (esHardDollar(s)) { map[s] = p; continue; }      // ya está en USD
        if (mep && mep > 0) map[s] = +(p / mep).toFixed(6);  // especie en pesos → USD
        // sin MEP: no publicamos la especie en pesos (mejor "—" que un valor 1000× inflado)
      }
    } catch { /* proveedor caído → seguimos con lo que haya */ }
  }));

  const rows = Object.entries(map).map(([ticker, precio]) => ({ ticker, precio, moneda: 'USD', updated_at: new Date().toISOString() }));
  if (rows.length) await sbUpsert(env, 'precios_cache', rows, 'ticker');

  // Fuente caída: último precio conocido por ticker (evita que el front valúe a costo en silencio).
  if (one) {
    const px = map[one] ?? (await cacheLast<{ precio: number }>(env, 'precios_cache', 'ticker', one))?.precio ?? null;
    return json({ ticker: one, precio: px });
  }

  // Mismo fallback que el path de un solo ticker, pero para el mapa completo: las 3 listas pueden
  // fallar (data912 caído) o simplemente no listar TODAS las especies del catálogo/cartera en un
  // request puntual — sin esto, esos tickers quedaban directamente ausentes del mapa (Radar/BonosPage
  // los mostraba con Precio/Paridad/TIR/Duración en "—" aunque hubiera un precio de ayer perfectamente
  // usable). Un solo SELECT para todo el cache (no uno por ticker).
  const cacheados = await sbSelect<{ ticker: string; precio: number }>(
    env, 'precios_cache', `updated_at=gte.${encodeURIComponent(new Date(Date.now() - MAX_STALE_MS).toISOString())}&select=ticker,precio`,
  );
  return json(mergeFallback(map, cacheados));
});
