import { type Env, json, preflight, guardAuth, cacheFresh, cacheLast, sbUpsert } from '../_shared';
import { yahooHist } from '../_market';

const TTL = 12 * 60 * 60 * 1000; // 12 h — la comparación es anual, no hace falta más fresco
const CLAVE = 'sp500_spy_diario';

// 5 años alcanzan (los portfolios arrancan en 2025) y mantienen chico el payload, que el front persiste en localStorage.
// Serie diaria del S&P 500 con RETORNO TOTAL (dividendos reinvertidos): SPY ajustado (adjclose). El índice
// ^GSPC es solo de precio y subestima ~1,3 pp/año; para comparar contra un portfolio que cobra dividendos y
// cupones, la vara justa es el retorno total. Todo dato real de Yahoo, nada inventado. La comparación por
// período la calcula el front (engine/sp500.ts) con las fechas exactas de cada año del portfolio.
export interface PuntoSp { f: string; c: number }

function parse(r: Awaited<ReturnType<typeof yahooHist>>): PuntoSp[] {
  if (!r?.timestamp?.length) return [];
  const serie = r.indicators?.adjclose?.[0]?.adjclose ?? r.indicators?.quote?.[0]?.close ?? [];
  const out: PuntoSp[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = serie[i];
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    out.push({ f: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10), c: +c.toFixed(4) });
  }
  return out;
}

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/sp500-anual → { fuente, puntos: [{f, c}] } ascendente por fecha
export const onRequestGet = guardAuth(async ({ env }) => {
  const cached = await cacheFresh<{ data_json: PuntoSp[] }>(env, 'macro_cache', 'clave', CLAVE, TTL);
  if (cached?.data_json?.length) return json({ fuente: 'SPY (retorno total)', puntos: cached.data_json, cached: true });
  try {
    const puntos = parse(await yahooHist('SPY', { interval: '1d', range: '5y' }));
    if (puntos.length < 20) throw new Error('sin-datos');
    await sbUpsert(env, 'macro_cache', [{ clave: CLAVE, valor: puntos[puntos.length - 1].c, data_json: puntos, updated_at: new Date().toISOString() }], 'clave');
    return json({ fuente: 'SPY (retorno total)', puntos });
  } catch {
    const last = await cacheLast<{ data_json: PuntoSp[] }>(env, 'macro_cache', 'clave', CLAVE);
    if (last?.data_json?.length) return json({ fuente: 'SPY (retorno total)', puntos: last.data_json, cached: true, stale: true });
    return json({ error: 'sp500-sin-datos', detail: 'No se pudo obtener la serie del S&P 500.', reintentable: true }, 503);
  }
});
