import { type Env, json, preflight, guardAuth, cacheFresh, cacheLast, sbSelect, sbUpsert, usuarioId, fetchJson, TICKER_RE, CIK_RE } from '../_shared';
import { DEFAULT_CIK, fetchFundamentals, calcularUngradeable, type EdgarFundamentals } from '../_edgar';
import { extraerCikDeFmpProfile } from '../_cikResolve';
import { mapearFmpAFundamentals, type FilaFmp } from '../_fmpFallback';

const TTL = 12 * 60 * 60 * 1000; // 12h
// CIK es una asignación PERMANENTE de la SEC — no hace falta un TTL corto, un valor de hace meses
// sigue siendo válido. TTL largo solo para no re-consultar edgar_ticker_cik en cada request.
const CIK_CACHE_TTL = 90 * 24 * 60 * 60 * 1000; // 90 días

// Resuelve el CIK "oficial" (confiable, cacheable en fundamentals_cache) de un ticker que NO está
// en el DEFAULT_CIK hardcodeado — antes, esto era SIEMPRE un callejón sin salida: cualquier ticker
// fuera de esas ~70 empresas quedaba "sin CIK" hasta que el usuario lo buscara a mano en el sitio de
// la SEC y lo cargara en Configuración. Prueba, en orden, 3 fuentes verificables por el SERVIDOR
// (nunca confía en el ?cik= que manda el cliente para esto — ver `cacheable` más abajo):
//   1. edgar_ticker_cik: cache GLOBAL de resoluciones automáticas previas (de cualquier ticker, de
//      cualquier corrida) — así un ticker resuelto una vez no vuelve a pagar el costo del paso 3.
//   2. cik_map del USUARIO AUTENTICADO (verificado server-side contra su propio user_id, no un
//      parámetro de URL que cualquiera podría falsificar) — lo que ya cargó a mano en Configuración.
//   3. FMP /api/v3/profile/{ticker}: mismo secret (FMP_API_KEY) y mismo endpoint que ya usa
//      beta.ts, que expone `cik` en su respuesta (confirmado: FMP devuelve "0000320193" para AAPL,
//      igual al DEFAULT_CIK hardcodeado de este proyecto). Se probó ANTES que el archivo bulk de
//      ticker→CIK de la SEC (company_tickers.json) porque ese archivo vive en www.sec.gov, un host
//      distinto al que ya prueba alcanzable el proxy actual (data.sec.gov) — hubiera sido apostar a
//      algo sin verificar, cuando FMP ya es una vía probada en este mismo proyecto.
// Si resuelve por 1 o 3, lo persiste en edgar_ticker_cik para que el próximo ticker (de cualquier
// corrida futura) no vuelva a pagar el costo. Devuelve null si ninguna fuente lo tiene — ahí sí cae
// al flujo manual de siempre (Configuración).
async function resolverCikAutomatico(env: Env, ticker: string, uid: string | null): Promise<string | null> {
  const cacheado = await cacheFresh<{ cik: string }>(env, 'edgar_ticker_cik', 'ticker', ticker, CIK_CACHE_TTL);
  if (cacheado?.cik) return cacheado.cik;

  if (uid) {
    const propio = await sbSelect<{ cik: string }>(env, 'cik_map', `user_id=eq.${uid}&ticker=eq.${encodeURIComponent(ticker)}&select=cik&limit=1`);
    if (propio[0]?.cik && CIK_RE.test(propio[0].cik)) return propio[0].cik;
  }

  if (env.FMP_API_KEY) {
    try {
      const profile = await fetchJson<unknown>(`https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${env.FMP_API_KEY}`);
      const cik = extraerCikDeFmpProfile(profile);
      if (cik) {
        await sbUpsert(env, 'edgar_ticker_cik', [{ ticker, cik, fuente: 'fmp', updated_at: new Date().toISOString() }], 'ticker');
        return cik;
      }
    } catch { /* FMP caído o sin cobertura de este ticker — cae al flujo manual */ }
  }
  return null;
}

// A diferencia de un precio de mercado (que "miente" si se muestra viejo), un balance/10-K sigue
// siendo el dato correcto durante meses — recién se reemplaza con la próxima presentación trimestral
// o anual. Usar el MAX_STALE_MS de _shared (7 días, pensado para precios) hacía que, apenas la SEC
// fallaba un par de veces seguidas para un ticker poco visitado, el fallback dejara de servir datos
// perfectamente válidos y la pantalla mostrara "EDGAR no devolvió datos" en vez de la última foto real
// (caso KO: cache de 16 días, con series completas hasta FY2025, descartada solo por la edad).
const FUNDAMENTALS_STALE_MS = 120 * 24 * 60 * 60 * 1000; // 120 días

// Último recurso: EDGAR no devolvió NADA del núcleo (ni ahora, ni en ningún cache previo — ver los
// 2 lugares donde se llama). Antes, acá terminaba todo: pantalla vacía con "EDGAR no devolvió
// datos" hasta que el usuario reintentara a mano. FMP (mismo secret, mismo proveedor que ya usa
// beta.ts/quotes.ts/_cikResolve.ts) tiene los 3 estados contables ya consolidados — no es el XBRL
// crudo de la SEC, es un agregador de terceros, así que el resultado SIEMPRE queda marcado con
// fuente:'fmp' y su propio warning (nunca se hace pasar por un dato de EDGAR). Devuelve null si FMP
// tampoco tiene nada (ticker sin cobertura en ningún proveedor, o sin FMP_API_KEY configurado) —
// ahí sí no queda otra que el error de siempre.
async function intentarFallbackFmp(env: Env, ticker: string, cik: string): Promise<(EdgarFundamentals & { fuente: string; warning: string }) | null> {
  if (!env.FMP_API_KEY) return null;
  try {
    const k = env.FMP_API_KEY;
    const [income, balance, cashflow] = await Promise.all([
      fetchJson<FilaFmp[]>(`https://financialmodelingprep.com/api/v3/income-statement/${ticker}?limit=6&apikey=${k}`),
      fetchJson<FilaFmp[]>(`https://financialmodelingprep.com/api/v3/balance-sheet-statement/${ticker}?limit=6&apikey=${k}`),
      fetchJson<FilaFmp[]>(`https://financialmodelingprep.com/api/v3/cash-flow-statement/${ticker}?limit=6&apikey=${k}`),
    ]);
    const P = mapearFmpAFundamentals(income ?? [], balance ?? [], cashflow ?? []);
    if (!P.ocf.length && !P.epsDiluted.length && !P.revenue.length) return null; // FMP tampoco cubre este ticker
    return {
      ticker, cik, entityName: null, ...P,
      ungradeable: calcularUngradeable(P),
      fuente: 'fmp',
      warning: `EDGAR no devolvió datos de ${ticker} en este intento — mostrando estados contables de FMP (un agregador de terceros, no la fuente primaria de la SEC). Pueden diferir levemente del filing oficial; probá "Actualizar datos" más tarde para reintentar EDGAR.`,
    };
  } catch { return null; }
}

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/fundamentals?ticker=MSFT[&cik=...][&fresh=1]
export const onRequestGet = guardAuth(async ({ request, env }) => {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  const force = url.searchParams.get('fresh') === '1';

  if (!ticker) return json({ error: 'ticker requerido' }, 400);
  if (!TICKER_RE.test(ticker)) return json({ error: 'ticker-invalido' }, 400);

  // Para tickers conocidos usamos SIEMPRE un CIK verificado por el SERVIDOR (ignoramos el ?cik del
  // query para esto) para que nadie pueda envenenar fundamentals_cache[ticker] con el CIK de otra
  // empresa — ver resolverCikAutomatico arriba para las 3 fuentes que prueba antes de rendirse.
  const uid = await usuarioId(env, request);
  const cikOficial = DEFAULT_CIK[ticker] || (await resolverCikAutomatico(env, ticker, uid)) || '';
  const cik = cikOficial || url.searchParams.get('cik') || '';
  // Solo se persiste en el cache COMPARTIDO si el CIK es el oficial (verificado server-side): con un
  // ?cik= arbitrario sin verificar, cualquiera podía envenenar fundamentals_cache[ticker] con los
  // datos de otra empresa.
  const cacheable = !!cikOficial;

  if (!cik) return json({ error: `No pudimos identificar el CIK de ${ticker} automáticamente — cargalo a mano en Configuración.` }, 400);
  if (!CIK_RE.test(cik)) return json({ error: 'cik-invalido', detail: 'El CIK debe ser 10 dígitos.' }, 400);
  // (El modo debug que probaba variantes contra el proxy se eliminó tras encontrar la causa raíz:
  // era un amplificador de requests públicos sin autenticación.)

  // Cache válida solo si tiene el núcleo (OCF/EPS/Revenue). Una entrada vieja vacía (de un fallo
  // transitorio previo) se ignora y se vuelve a consultar → auto-sana.
  if (!force) {
    const cached = await cacheFresh<{ data_json: { ocf?: unknown[]; epsDiluted?: unknown[]; revenue?: unknown[] } }>(
      env, 'fundamentals_cache', 'ticker', ticker, TTL);
    const dj = cached?.data_json;
    const nucleoOk = dj && (dj.ocf?.length || dj.epsDiluted?.length || dj.revenue?.length);
    if (cached && nucleoOk) return json({ ...(dj as object), cached: true });
  }

  try {
    const data = await fetchFundamentals(env, ticker, cik);
    const nucleoIncompleto = !data.ocf.length || !data.epsDiluted.length || !data.revenue.length;
    if (!nucleoIncompleto && cacheable) {
      await sbUpsert(env, 'fundamentals_cache', [{
        ticker, cik, data_json: data, updated_at: new Date().toISOString(),
      }], 'ticker');
    }
    // Si NO vino nada del núcleo, no es que la empresa no se pueda valuar: EDGAR no respondió
    // (rate-limit del proxy o caída). Hay que decirlo explícito — mostrarlo como "SIN_DATOS" se lee
    // como "esta empresa no aplica", que es un diagnóstico equivocado. Antes de rendirnos, servimos
    // lo último cacheado si existe.
    if (!data.ocf.length && !data.epsDiluted.length && !data.revenue.length) {
      const last = await cacheLast<{ data_json: object }>(env, 'fundamentals_cache', 'ticker', ticker, FUNDAMENTALS_STALE_MS);
      if (last?.data_json) return json({ ...(last.data_json as object), cached: true, stale: true });
      const fmp = await intentarFallbackFmp(env, ticker, cik);
      if (fmp) {
        if (cacheable) await sbUpsert(env, 'fundamentals_cache', [{ ticker, cik, data_json: fmp, updated_at: new Date().toISOString() }], 'ticker');
        return json(fmp);
      }
      return json({
        error: 'edgar-sin-datos',
        detail: `EDGAR no devolvió datos de ${ticker} en este intento (suele ser rate-limit). Probá "Actualizar datos" en unos segundos.`,
        reintentable: true,
      }, 503);
    }
    if (data.ungradeable.length) {
      return json({ ...data, warning: `datos incompletos vía EDGAR: falta ${data.ungradeable.join(', ')} (posible 20-F/IFRS o rate-limit)` });
    }
    return json(data);
  } catch (e) {
    // EDGAR caído: si hay algo cacheado (aunque vencido), lo servimos en vez de un error que vacía
    // la pantalla. Antes de rendirnos del todo, probamos FMP — mismo criterio que la rama de arriba.
    const last = await cacheLast<{ data_json: object }>(env, 'fundamentals_cache', 'ticker', ticker, FUNDAMENTALS_STALE_MS);
    if (last?.data_json) return json({ ...(last.data_json as object), cached: true, stale: true });
    const fmp = await intentarFallbackFmp(env, ticker, cik);
    if (fmp) {
      if (cacheable) await sbUpsert(env, 'fundamentals_cache', [{ ticker, cik, data_json: fmp, updated_at: new Date().toISOString() }], 'ticker');
      return json(fmp);
    }
    return json({ error: 'edgar-fetch-failed', detail: String(e) }, 502);
  }
});
