// Utilidades de precio de mercado compartidas entre endpoints (histórico de precio, drawdowns).
// Yahoo Finance chart API: no oficial, sin API key — usada en producción desde hace tiempo para
// S&P500/oro/Merval (ver market/drawdowns.ts). Acá se extiende a tickers individuales para el
// gráfico de precio de Análisis (ver market/historico.ts) — mismo proveedor, misma forma de fetch.

import { fetchJson } from './_shared';

export interface YahooChartResult {
  timestamp?: number[];
  meta?: { regularMarketPrice?: number };
  indicators?: {
    quote?: { close?: (number | null)[]; high?: (number | null)[] }[];
    // adjclose (precio ajustado por dividendos/splits): sin esto, una empresa con dividendo alto
    // muestra una caída de precio que en parte es solo el dividendo saliendo de la cotización, no
    // pérdida de valor real — la "Var. 5 años" quedaría estructuralmente sesgada para abajo.
    adjclose?: { adjclose?: (number | null)[] }[];
  };
}

// BRK.B → BRK-B: Yahoo usa guión donde el resto de los proveedores (y la SEC) usan punto para
// acciones de clases múltiples — ver DEFAULT_CIK en _edgar.ts, que ya reconoce ambas grafías. Sin
// este mapeo, pedirle a Yahoo un ticker con punto devuelve un chart vacío en silencio (no un error).
export function yahooSymbol(ticker: string): string {
  return ticker.replace(/\./g, '-');
}

export async function yahooHist(symbol: string, opts: { interval: string; range: string }): Promise<YahooChartResult | undefined> {
  const j = await fetchJson<{ chart?: { result?: YahooChartResult[] } }>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${opts.interval}&range=${opts.range}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return j.chart?.result?.[0];
}
