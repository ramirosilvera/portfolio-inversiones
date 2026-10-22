import { type Env, json, preflight, guard, sbUpsert, requireCronSecret } from '../_shared';
import { procesarIngesta } from '../_fred';

// POST /api/cron/fred-ingest  { series: { DGS10: "<csv>", VIXCLS: "<csv>", ... } }
// Lo llama el workflow «Refrescar series de FRED» (GitHub Actions), que baja los CSV de FRED desde un runner —FRED responde 520 a los Workers— y
// los entrega acá. Solo con X-Cron-Secret. Cada CSV se valida estrictamente antes de guardarse (ver procesarIngesta en _fred.ts).
export const onRequestOptions: PagesFunction<Env> = async () => preflight();

export const onRequestPost = guard(async ({ env, request }) => {
  const authErr = requireCronSecret(env, request);
  if (authErr) return authErr;
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'json-invalido' }, 400); }
  const r = procesarIngesta(body, new Date().toISOString());
  if (r.rows.length) await sbUpsert(env, 'macro_cache', r.rows, 'clave');
  return json({ guardados: r.guardados, rechazados: r.rechazados });
});
