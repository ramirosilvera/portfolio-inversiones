import { type Env, json, preflight, guardAuth, cacheFresh, cacheLast, sbUpsert, TICKER_RE } from '../_shared';
import { yahooHist, yahooSymbol, type YahooChartResult } from '../_market';

const TTL = 24 * 60 * 60 * 1000; // 24h — precio semanal, no hace falta refrescar tan seguido como una cotización
const MAX_STALE = 21 * 24 * 60 * 60 * 1000; // 21 días de tolerancia antes de admitir que no hay dato fresco

export interface PuntoPrecio { fecha: string; close: number }

// Precio ajustado por dividendos (adjclose) si Yahoo lo trae; si no, cae a close sin ajustar — mejor
// un dato aproximado que ninguno, pero preferimos adjclose porque sin ajuste una empresa con
// dividendo alto muestra una caída de precio que en parte es solo el dividendo saliendo de la
// cotización, no pérdida de valor real (distorsiona "Var. 5 años" sistemáticamente para abajo).
function parseWeekly(r: YahooChartResult | undefined): PuntoPrecio[] {
  if (!r?.timestamp?.length) return [];
  const adj = r.indicators?.adjclose?.[0]?.adjclose;
  const close = r.indicators?.quote?.[0]?.close;
  const serie = adj ?? close ?? [];
  const out: PuntoPrecio[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = serie[i];
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    out.push({ fecha: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10), close: +c.toFixed(4) });
  }
  return out;
}

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/historico?ticker=X → hasta 5 años de precio semanal. El toggle 1A/5A del front
// recorta ESTA misma serie (no hay un fetch separado por rango — un solo pedido a Yahoo por ticker).
export const onRequestGet = guardAuth(async ({ request, env }) => {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  if (!ticker) return json({ error: 'ticker requerido' }, 400);
  if (!TICKER_RE.test(ticker)) return json({ error: 'ticker-invalido' }, 400);

  const cached = await cacheFresh<{ data_json: PuntoPrecio[] }>(env, 'precio_historico_cache', 'ticker', ticker, TTL);
  if (cached?.data_json?.length) return json({ ticker, puntos: cached.data_json, cached: true });

  try {
    const r = await yahooHist(yahooSymbol(ticker), { interval: '1wk', range: '5y' });
    const puntos = parseWeekly(r);
    if (!puntos.length) throw new Error('sin-datos');
    await sbUpsert(env, 'precio_historico_cache', [{ ticker, data_json: puntos, updated_at: new Date().toISOString() }], 'ticker');
    // Menos de ~10 semanas: probablemente salió a bolsa hace poco — se avisa (parcial), no se oculta
    // ni se trata como error (sería un diagnóstico equivocado, mismo criterio que fundamentals.ts).
    return json({ ticker, puntos, parcial: puntos.length < 10 });
  } catch {
    // Yahoo caído o el ticker no tiene histórico: servimos lo último cacheado (hasta MAX_STALE) en
    // vez de vaciar el gráfico. Recién sin nada útil devolvemos el error.
    const last = await cacheLast<{ data_json: PuntoPrecio[] }>(env, 'precio_historico_cache', 'ticker', ticker, MAX_STALE);
    if (last?.data_json?.length) return json({ ticker, puntos: last.data_json, cached: true, stale: true });
    return json({ error: 'historico-sin-datos', detail: `No se pudo obtener el histórico de precio de ${ticker}.`, reintentable: true }, 503);
  }
});
