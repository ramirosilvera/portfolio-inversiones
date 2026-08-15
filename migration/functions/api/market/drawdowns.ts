import { type Env, json, preflight, guardAuth, cacheFresh, cacheLast, sbUpsert, fetchJson } from '../_shared';
import { yahooHist as yahooHistBase } from '../_market';

const TTL = 30 * 60 * 1000; // 30 min

// Indicadores clave: distancia al MÁXIMO HISTÓRICO (all-time high). Fuente: Yahoo Finance con datos
// SEMANALES sobre toda la historia (interval=1wk&range=max) — captura el ATH (está en el high de
// alguna semana) con payload chico. ^GSPC = S&P 500 (USD), GC=F = oro COMEX (USD). El Merval se mide
// en USD: ^MERV (pesos) de cada semana ÷ CCL de esa fecha (histórico argentinadatos), así el máximo y
// el actual quedan en dólares y la inflación no lo distorsiona. Todo es dato real, nada inventado.
interface DD { actual: number; max: number; dd: number }

// yahooHist(symbol, {interval, range}) ahora vive en _market.ts (compartida con market/historico.ts,
// que la usa para el gráfico de precio de Análisis) — acá se fija el mismo interval/range de siempre.
const yahooHist = (symbol: string) => yahooHistBase(symbol, { interval: '1wk', range: 'max' });

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);
// Máximo con un loop (no spread): la historia completa puede tener miles de puntos.
const maxOf = (arr: number[]): number => { let m = 0; for (const v of arr) if (v > m) m = v; return m; };

// S&P 500 / oro: ya están en USD. Máximo histórico con los highs semanales.
async function drawdownUsd(symbol: string): Promise<DD | null> {
  const r = await yahooHist(symbol);
  const q = r?.indicators?.quote?.[0];
  const highs = (q?.high ?? []).map(num).filter((x): x is number => x != null);
  const closes = (q?.close ?? []).map(num).filter((x): x is number => x != null);
  if (!closes.length) return null;
  const actual = num(r?.meta?.regularMarketPrice) ?? closes[closes.length - 1];
  const max = Math.max(maxOf(highs.length ? highs : closes), actual);
  if (!(max > 0)) return null;
  return { actual, max, dd: actual / max - 1 };
}

// CCL histórico diario (argentinadatos), ascendente por fecha. venta = precio de venta.
async function cclHistory(): Promise<{ fecha: string; venta: number }[]> {
  const arr = await fetchJson<{ fecha?: string; venta?: number; compra?: number }[]>(
    'https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoconliqui');
  return (arr ?? [])
    .map(x => ({ fecha: x.fecha ?? '', venta: (x.venta ?? x.compra ?? 0) }))
    .filter(x => x.fecha && x.venta > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// Merval en USD: ^MERV (pesos) de cada semana ÷ CCL de esa fecha. Máximo histórico y actual en USD.
async function drawdownMervalUsd(): Promise<DD | null> {
  const r = await yahooHist('^MERV');
  const ts = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0];
  const highs = q?.high ?? [];
  const closes = q?.close ?? [];
  if (!ts.length) return null;

  const hist = await cclHistory();
  if (!hist.length) return null; // sin CCL histórico no hay serie en USD → el handler cae al stale
  // Búsqueda binaria: CCL de la última fecha <= date (nearest-previous; tolera finde/feriados).
  const cclOn = (date: string): number | null => {
    let lo = 0, hi = hist.length - 1, ans: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (hist[mid].fecha <= date) { ans = hist[mid].venta; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  };
  const currentCcl = hist[hist.length - 1].venta;

  let maxUsd = 0;
  for (let i = 0; i < ts.length; i++) {
    const px = num(highs[i]) ?? num(closes[i]);
    if (px == null) continue;
    // El CCL histórico arranca ~2011: semanas anteriores del Merval quedan sin CCL y se saltean.
    const ccl = cclOn(new Date(ts[i] * 1000).toISOString().slice(0, 10));
    if (!ccl) continue;
    const usd = px / ccl;
    if (usd > maxUsd) maxUsd = usd;
  }
  const mervalNow = num(r?.meta?.regularMarketPrice) ?? (closes.map(num).filter((x): x is number => x != null).at(-1) ?? null);
  if (mervalNow == null || !currentCcl) return null;
  const actual = mervalNow / currentCcl;
  const max = Math.max(maxUsd, actual);
  if (!(max > 0)) return null;
  return { actual, max, dd: actual / max - 1 };
}

const CALCS: Record<string, () => Promise<DD | null>> = {
  sp500: () => drawdownUsd('^GSPC'),
  oro: () => drawdownUsd('GC=F'),
  merval: () => drawdownMervalUsd(),
};

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/drawdowns → { sp500: {actual,max,dd}, oro: {...}, merval: {...} }  (dd vs máx histórico, ≤ 0)
export const onRequestGet = guardAuth(async ({ env }) => {
  const out: Record<string, DD | null> = {};
  const rows: unknown[] = [];
  await Promise.all(Object.entries(CALCS).map(async ([key, calc]) => {
    const clave = `dd_${key}`;
    const cached = await cacheFresh<{ valor: number; data_json: { actual: number; max: number } }>(env, 'macro_cache', 'clave', clave, TTL);
    if (cached?.data_json) { out[key] = { dd: cached.valor, actual: cached.data_json.actual, max: cached.data_json.max }; return; }
    try {
      const d = await calc();
      if (d) { out[key] = d; rows.push({ clave, valor: d.dd, data_json: { actual: d.actual, max: d.max }, updated_at: new Date().toISOString() }); return; }
    } catch { /* cae al último conocido abajo */ }
    // Fuente caída o sin datos: último valor conocido (aunque vencido) antes que vaciar.
    const last = await cacheLast<{ valor: number; data_json: { actual: number; max: number } }>(env, 'macro_cache', 'clave', clave);
    out[key] = last?.data_json ? { dd: last.valor, actual: last.data_json.actual, max: last.data_json.max } : null;
  }));
  if (rows.length) await sbUpsert(env, 'macro_cache', rows, 'clave');
  return json(out);
});
