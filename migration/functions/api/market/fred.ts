import { type Env, json, preflight, guardAuth, cacheFresh, cacheLast, sbUpsert } from '../_shared';
import { parsearFredCsv, pedirFred, resumenDiag, SERIES_FRED as SERIES } from '../_fred';
import { valorPlausible } from '../../../src/engine/macroRangos';

// Las series las trae un workflow de GitHub (cron/fred-ingest, cada 6 h) porque FRED responde 520 desde los Workers. Este endpoint solo intenta bajarlas
// él mismo si la ingesta lleva más de 13 h sin renovar el dato (el scheduler de GitHub se retrasa de a horas): normalmente sirve la cache.
const TTL = 13 * 60 * 60 * 1000; // 13h

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/fred → { dgs10, dgs3mo, hy_spread, vix, dollar_index }  (tasas en %). Solo valores validados (ver _fred.ts).
export const onRequestGet = guardAuth(async ({ env, request }) => {
  const out: Record<string, unknown> = {};
  const diag: string[] = [];
  const rows: unknown[] = [];
  await Promise.all(Object.entries(SERIES).map(async ([serie, clave]) => {
    // Un valor cacheado fuera de rango plausible (dato corrupto de una corrida anterior) NO se sirve ni cuenta como fresco: se vuelve a pedir.
    const cached = await cacheFresh<{ valor: number }>(env, 'macro_cache', 'clave', clave, TTL);
    if (cached && valorPlausible(clave, cached.valor)) { out[clave] = cached.valor; return; }
    // Último valor bueno conocido (aunque esté vencido), pero solo si es plausible: mejor «sin dato» que un número imposible.
    const ultimoBueno = async () => {
      const last = await cacheLast<{ valor: number }>(env, 'macro_cache', 'clave', clave);
      return last && valorPlausible(clave, last.valor) ? last.valor : null;
    };
    try {
      const resp = await pedirFred(serie);
      const val = resp.status >= 200 && resp.status < 300 ? parsearFredCsv(resp.texto, serie, clave) : null;
      if (val != null) { out[clave] = val; rows.push({ clave, valor: val, updated_at: new Date().toISOString() }); }
      else {
        const d = resumenDiag(serie, resp);
        console.warn(`FRED respuesta inválida (no es el CSV esperado o valor imposible): ${d}`);
        diag.push(d);
        out[clave] = await ultimoBueno();
      }
    } catch (e) {
      // Proveedor caído: servimos el último valor bueno conocido en vez de vaciar.
      diag.push(`${serie} error de red: ${String(e).slice(0, 80)}`);
      out[clave] = await ultimoBueno();
    }
  }));
  if (rows.length) await sbUpsert(env, 'macro_cache', rows, 'clave');
  // Diagnóstico SOLO para el cron (lleva su secret): lo que devolvió FRED cuando no era el CSV. La app no lo recibe.
  const esCron = !!env.CRON_SECRET && request.headers.get('X-Cron-Secret') === env.CRON_SECRET;
  return json(esCron && diag.length ? { ...out, _diag: diag.slice(0, 2) } : out);
});
