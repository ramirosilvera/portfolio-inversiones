import { type Env, json, preflight, guardAuth, cacheFresh, cacheLast, sbUpsert } from '../_shared';
import { yahooHist } from '../_market';

const TTL = 12 * 60 * 60 * 1000; // 12 h — la comparación es anual, no hace falta más fresco
const CLAVE = 'sp500_spy_diario';

// El servidor guarda la serie LARGA (range=max) y el cliente pide solo lo que necesita con `?desde=AAAA-MM-DD` (el inicio de su historia): así
// el payload viaja chico hoy (que el front persiste en localStorage) y dentro de 10 años cubre todo el período sin tocar nada. Sin
// `desde`, devuelve los últimos 5 años.
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
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
function desdeDefault(): string { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 5); return d.toISOString().slice(0, 10); }
// Arranca unos días ANTES de `desde` para que haya un cierre ≤ a esa fecha (el motor busca el último cierre ≤ fecha).
const recortar = (puntos: PuntoSp[], desde: string): PuntoSp[] => {
  const base = new Date(Date.parse(desde) - 10 * 86_400_000).toISOString().slice(0, 10);
  return puntos.filter(p => p.f >= base);
};

export const onRequestGet = guardAuth(async ({ request, env }) => {
  const q = new URL(request.url).searchParams.get('desde') || '';
  const desde = FECHA_RE.test(q) && !Number.isNaN(Date.parse(q)) ? q : desdeDefault();
  const cached = await cacheFresh<{ data_json: PuntoSp[] }>(env, 'macro_cache', 'clave', CLAVE, TTL);
  if (cached?.data_json?.length) return json({ fuente: 'SPY (retorno total)', puntos: recortar(cached.data_json, desde), cached: true });
  try {
    const puntos = parse(await yahooHist('SPY', { interval: '1d', range: 'max' }));
    if (puntos.length < 20) throw new Error('sin-datos');
    await sbUpsert(env, 'macro_cache', [{ clave: CLAVE, valor: puntos[puntos.length - 1].c, data_json: puntos, updated_at: new Date().toISOString() }], 'clave');
    return json({ fuente: 'SPY (retorno total)', puntos: recortar(puntos, desde) });
  } catch {
    const last = await cacheLast<{ data_json: PuntoSp[] }>(env, 'macro_cache', 'clave', CLAVE);
    if (last?.data_json?.length) return json({ fuente: 'SPY (retorno total)', puntos: recortar(last.data_json, desde), cached: true, stale: true });
    return json({ error: 'sp500-sin-datos', detail: 'No se pudo obtener la serie del S&P 500.', reintentable: true }, 503);
  }
});
