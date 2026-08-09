// Panel admin — acciones sobre un usuario puntual: banear/reactivar, otorgar/revocar admin
// (PATCH), eliminar definitivamente (DELETE). Mismo guard que users.ts: requireAdmin() en cada
// request. Ningún admin puede aplicarse estas acciones a sí mismo — evita quedarse afuera por
// error (auto-banearse) o dejar la cuenta sin ningún admin (auto-revocarse/auto-eliminarse).
import { type Env, json, preflight, guard, sbHeaders, sbSelect } from '../../_shared';
import { requireAdmin, logAudit } from '../_guard';

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

const BAN_LARGO = '876000h'; // ~100 años — "baneado" en la práctica, reversible con ban_duration: 'none'

type Accion = 'ban' | 'unban' | 'grant_admin' | 'revoke_admin' | 'approve' | 'revoke_approval';
const ACCIONES: Accion[] = ['ban', 'unban', 'grant_admin', 'revoke_admin', 'approve', 'revoke_approval'];
const SOLO_A_OTROS: Accion[] = ['ban', 'revoke_admin', 'revoke_approval']; // no te las podés aplicar a vos mismo

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// targetId sale de la URL (params.id) y se interpola sin escapar en un filtro PostgREST
// (?user_id=eq.${targetId}) y en un path de la Admin Auth API (/admin/users/${targetId}). Un id
// que no sea un UUID bien formado (ej. con "&" u otro separador de PostgREST, o "/"/".." que
// reescriba el path de la Admin API a otro endpoint) podría manipular la llamada — validar ACÁ,
// antes de construir cualquier URL, lo descarta de raíz. Normalizado a minúsculas: Postgres/GoTrue
// comparan uuid sin distinguir mayúsculas, así que el chequeo "no podés aplicártelo a vos mismo"
// de más abajo tiene que comparar en el mismo case o un id en MAYÚSCULAS lo esquiva.
function idInvalido(targetId: string): boolean { return !UUID_RE.test(targetId); }

export const onRequestPatch = guard(async ({ request, env, params }) => {
  const admin = await requireAdmin(env, request);
  if (!admin) return json({ error: 'no-autorizado', detail: 'Necesitás ser administrador.' }, 403);

  const targetIdRaw = String(params.id);
  if (idInvalido(targetIdRaw)) return json({ error: 'id-invalido' }, 400);
  const targetId = targetIdRaw.toLowerCase();
  const miId = admin.userId.toLowerCase();
  // Para que la auditoría registre A QUIÉN se le aplicó la acción (antes solo guardaba el uuid
  // crudo — "X hizo ban" sin sujeto legible, ver auditoría de backend). Best-effort: si GoTrue no
  // responde, seguimos igual (el email queda null en el log, no bloquea la acción real).
  const targetEmail = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${targetId}`, { headers: sbHeaders(env) })
    .then(r => r.ok ? r.json() as Promise<{ email?: string }> : null).then(u => u?.email ?? null).catch(() => null);
  let body: { action?: string };
  try { body = await request.json(); } catch { return json({ error: 'body-invalido' }, 400); }
  const accion = body.action as Accion;
  if (!ACCIONES.includes(accion)) return json({ error: 'accion-invalida', detail: `action debe ser una de: ${ACCIONES.join(', ')}` }, 400);
  if (SOLO_A_OTROS.includes(accion) && targetId === miId) {
    return json({ error: 'no-permitido', detail: 'No podés aplicarte esta acción a vos mismo.' }, 400);
  }

  // Si la acción le puede sacar la autoridad de admin a `target` (ban o revoke_admin), y ese target
  // hoy ES admin, hay que verificar ANTES de tocar nada que no sea el último — sin esto, banear o
  // revocarle el admin a la única otra cuenta admin deja la app sin ningún admin usable (nadie
  // puede volver a otorgar admin desde el panel, porque el panel exige serlo).
  if (accion === 'ban' || accion === 'revoke_admin') {
    const [adminRows, targetEsAdmin] = await Promise.all([
      sbSelect<{ user_id: string }>(env, 'admin_users', 'select=user_id'),
      sbSelect<{ user_id: string }>(env, 'admin_users', `user_id=eq.${targetId}&select=user_id`),
    ]);
    if (targetEsAdmin.length > 0 && adminRows.length <= 1) {
      return json({ error: 'ultimo-admin', detail: 'No podés sacarle el admin a la única cuenta administradora — la app quedaría sin nadie que pueda volver a otorgarlo.' }, 400);
    }
  }

  if (accion === 'ban' || accion === 'unban') {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${targetId}`, {
      method: 'PUT', headers: sbHeaders(env),
      body: JSON.stringify({ ban_duration: accion === 'ban' ? BAN_LARGO : 'none' }),
    });
    if (!res.ok) return json({ error: 'gotrue-error', detail: `No se pudo ${accion === 'ban' ? 'banear' : 'reactivar'} (HTTP ${res.status})` }, 502);
    // Banear a un admin dejaba `admin_users` intacto: desbanearlo (o el JWT vigente hasta que
    // expire) le restauraba la autoridad completa sin que nadie la haya vuelto a otorgar. El ban
    // ahora también revoca el admin — reactivar (`unban`) no lo devuelve solo, hace falta un
    // grant_admin explícito después.
    if (accion === 'ban') {
      await fetch(`${env.SUPABASE_URL}/rest/v1/admin_users?user_id=eq.${targetId}`, {
        method: 'DELETE', headers: sbHeaders(env, { Prefer: 'return=minimal' }),
      });
    }
  } else if (accion === 'grant_admin') {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/admin_users`, {
      method: 'POST', headers: sbHeaders(env, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ user_id: targetId, granted_by: admin.userId }),
    });
    if (!res.ok) return json({ error: 'db-error', detail: `No se pudo otorgar admin (HTTP ${res.status})` }, 502);
  } else if (accion === 'revoke_admin') {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/admin_users?user_id=eq.${targetId}`, {
      method: 'DELETE', headers: sbHeaders(env, { Prefer: 'return=minimal' }),
    });
    if (!res.ok) return json({ error: 'db-error', detail: `No se pudo revocar admin (HTTP ${res.status})` }, 502);
  } else if (accion === 'approve') {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios_aprobados`, {
      method: 'POST', headers: sbHeaders(env, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ user_id: targetId, aprobado_por: admin.userId }),
    });
    if (!res.ok) return json({ error: 'db-error', detail: `No se pudo aprobar (HTTP ${res.status})` }, 502);
  } else {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios_aprobados?user_id=eq.${targetId}`, {
      method: 'DELETE', headers: sbHeaders(env, { Prefer: 'return=minimal' }),
    });
    if (!res.ok) return json({ error: 'db-error', detail: `No se pudo quitar la aprobación (HTTP ${res.status})` }, 502);
  }

  const ACCION_LOG: Record<Accion, string> = {
    ban: 'banear', unban: 'reactivar', grant_admin: 'otorgar_admin', revoke_admin: 'revocar_admin',
    approve: 'aprobar', revoke_approval: 'revocar_aprobacion',
  };
  await logAudit(env, { actorId: admin.userId, actorEmail: admin.email, action: ACCION_LOG[accion], targetId, targetEmail });
  return json({ ok: true });
});

// Eliminación definitiva: borra el usuario de auth.users. Cascada por FK on delete cascade a
// profiles/portfolios/posiciones/aportes/dcf_analisis/cik_map/admin_users/usuarios_aprobados (ver
// 0001/0020/0021) — no queda nada huérfano. No tiene deshacer; el frontend exige confirmación
// explícita antes de llamar.
export const onRequestDelete = guard(async ({ request, env, params }) => {
  const admin = await requireAdmin(env, request);
  if (!admin) return json({ error: 'no-autorizado', detail: 'Necesitás ser administrador.' }, 403);

  const targetIdRaw = String(params.id);
  if (idInvalido(targetIdRaw)) return json({ error: 'id-invalido' }, 400);
  const targetId = targetIdRaw.toLowerCase();
  if (targetId === admin.userId.toLowerCase()) return json({ error: 'no-permitido', detail: 'No podés eliminar tu propia cuenta desde acá.' }, 400);

  // El email hay que capturarlo ANTES de borrar — una vez eliminada la fila de auth.users, ese id
  // no se puede volver a resolver a un email nunca más y el log de auditoría queda sin sujeto.
  const targetEmail = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${targetId}`, { headers: sbHeaders(env) })
    .then(r => r.ok ? r.json() as Promise<{ email?: string }> : null).then(u => u?.email ?? null).catch(() => null);

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${targetId}`, { method: 'DELETE', headers: sbHeaders(env) });
  if (!res.ok && res.status !== 404) return json({ error: 'gotrue-error', detail: `No se pudo eliminar (HTTP ${res.status})` }, 502);

  await logAudit(env, { actorId: admin.userId, actorEmail: admin.email, action: 'eliminar', targetId, targetEmail });
  return json({ ok: true });
});
