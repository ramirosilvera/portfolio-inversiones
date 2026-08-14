import { type Env, json, preflight, guardAuth, cacheFresh, cacheLast, sbUpsert, TICKER_RE, CIK_RE } from '../_shared';
import { DEFAULT_CIK, fetchFundamentals } from '../_edgar';

const TTL = 12 * 60 * 60 * 1000; // 12h

// A diferencia de un precio de mercado (que "miente" si se muestra viejo), un balance/10-K sigue
// siendo el dato correcto durante meses — recién se reemplaza con la próxima presentación trimestral
// o anual. Usar el MAX_STALE_MS de _shared (7 días, pensado para precios) hacía que, apenas la SEC
// fallaba un par de veces seguidas para un ticker poco visitado, el fallback dejara de servir datos
// perfectamente válidos y la pantalla mostrara "EDGAR no devolvió datos" en vez de la última foto real
// (caso KO: cache de 16 días, con series completas hasta FY2025, descartada solo por la edad).
const FUNDAMENTALS_STALE_MS = 120 * 24 * 60 * 60 * 1000; // 120 días

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/fundamentals?ticker=MSFT[&cik=...][&fresh=1]
export const onRequestGet = guardAuth(async ({ request, env }) => {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  // Para tickers conocidos usamos SIEMPRE el CIK oficial (ignoramos el ?cik del query) para que
  // nadie pueda envenenar fundamentals_cache[ticker] con el CIK de otra empresa.
  const cikOficial = DEFAULT_CIK[ticker] || '';
  const cik = cikOficial || url.searchParams.get('cik') || '';
  // Solo se persiste en el cache COMPARTIDO si el CIK es el oficial: con un ?cik= arbitrario
  // cualquiera podía envenenar fundamentals_cache[ticker] con los datos de otra empresa.
  const cacheable = !!cikOficial;
  const force = url.searchParams.get('fresh') === '1';

  if (!ticker) return json({ error: 'ticker requerido' }, 400);
  if (!TICKER_RE.test(ticker)) return json({ error: 'ticker-invalido' }, 400);
  if (!cik) return json({ error: `sin CIK para ${ticker} — cargá el par ticker/CIK en Configuración` }, 400);
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
    // la pantalla. Solo devolvemos 502 si nunca tuvimos fundamentals de este ticker.
    const last = await cacheLast<{ data_json: object }>(env, 'fundamentals_cache', 'ticker', ticker, FUNDAMENTALS_STALE_MS);
    if (last?.data_json) return json({ ...(last.data_json as object), cached: true, stale: true });
    return json({ error: 'edgar-fetch-failed', detail: String(e) }, 502);
  }
});
