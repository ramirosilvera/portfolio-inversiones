import { type Env, json, preflight, guardAuth, cacheFresh, cacheLast, sbUpsert } from '../_shared';
import { parsearFredCsv, pedirFred, resumenDiag, SERIES_FRED as SERIES } from '../_fred';
import { yahooPrice } from '../_yahoo';
import { valorPlausible } from '../../../src/engine/macroRangos';

const TTL = 6 * 60 * 60 * 1000; // 6h
// FRED no responde (2026-10-22: HTTP 520 desde el Worker y timeouts/INTERNAL_ERROR también desde un runner de GitHub: caída o bloqueo del proveedor, no un cambio
// nuestro). Las tres series que tienen un equivalente gratuito y estable se piden PRIMERO a Yahoo, que sí responde (el mismo proveedor que ya usa
// indicadores.ts): VIX → ^VIX, Treasury 10Y → ^TNX y T-Bills 3M → ^IRX (ambos ya en %). Si Yahoo falla se prueba FRED. El spread HY y el dólar amplio solo
// existen en FRED: quedan «sin dato» mientras FRED no vuelva (no se reemplazan por un índice distinto: los umbrales de los semáforos son de esas series).
const YAHOO: Record<string, string> = { vix: '^VIX', dgs10: '^TNX', dgs3mo: '^IRX' };
const FRED_TIMEOUT_MS = 8_000;   // con el proveedor caído cada intento esperaba 20 s: no demorar la respuesta

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

// GET /api/market/fred → { dgs10, dgs3mo, hy_spread, vix, dollar_index }  (tasas en %). Solo valores validados (ver _fred.ts y macroRangos.ts).
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
    // 1) Yahoo (si la serie tiene equivalente): un valor fuera de rango plausible se descarta igual que uno de FRED.
    const ySym = YAHOO[clave];
    if (ySym) {
      const v = await yahooPrice(ySym);
      if (v != null && valorPlausible(clave, v)) { out[clave] = v; rows.push({ clave, valor: v, updated_at: new Date().toISOString() }); return; }
      diag.push(`${clave}: Yahoo ${ySym} sin dato válido (${v})`);
    }
    // 2) FRED.
    try {
      const resp = await pedirFred(serie, FRED_TIMEOUT_MS);
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
