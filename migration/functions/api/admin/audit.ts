// Panel admin — actividad reciente (admin_audit_log). Solo lectura; se escribe desde
// _guard.ts#logAudit en cada acción de users.ts/[id].ts.
import { type Env, json, preflight, guard, sbSelect } from '../_shared';
import { requireAdmin } from './_guard';

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

interface AuditRow {
  id: string; action: string; actor_email: string | null; target_id: string | null; target_email: string | null;
  detalle: unknown; created_at: string;
}

export const onRequestGet = guard(async ({ request, env }) => {
  const admin = await requireAdmin(env, request);
  if (!admin) return json({ error: 'no-autorizado', detail: 'Necesitás ser administrador.' }, 403);

  const rows = await sbSelect<AuditRow>(env, 'admin_audit_log',
    'select=id,action,actor_email,target_id,target_email,detalle,created_at&order=created_at.desc&limit=100');
  return json({ entries: rows });
});
