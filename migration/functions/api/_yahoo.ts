import { fetchJson } from './_shared';

interface YahooChart { chart?: { result?: { meta?: { regularMarketPrice?: number } }[] } }

/** Último precio de la respuesta del chart de Yahoo (meta.regularMarketPrice), o null si no es un número positivo. */
export function parsearYahooChart(j: unknown): number | null {
  const p = (j as YahooChart | null)?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null;
}

// Precio actual de un símbolo vía el chart de Yahoo Finance (gratis, sin auth). Server-side no hay CORS. Se manda User-Agent porque Yahoo rechaza
// requests sin él. Funciona desde un Worker de Cloudflare (lo usa indicadores.ts para ^MERV, SPY y GLD).
export async function yahooPrice(symbol: string): Promise<number | null> {
  try {
    const j = await fetchJson<unknown>(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } });
    return parsearYahooChart(j);
  } catch { return null; }
}
