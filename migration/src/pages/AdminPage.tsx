import { useState, type ReactNode } from 'react';
import { ShieldCheck, UserPlus, Trash2, Ban, RotateCcw, Crown, UserCheck, UserX } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useEstadoCuenta, useAdminUsers, useAdminAuditoria } from '../hooks/useAdmin';
import { Card, CardHeader, Button, Badge, Field, Empty, inputCls } from '../components/ui';
import type { AdminUsuario, AdminAccion, AdminAuditEntry } from '../lib/api';

const ACCION_LABEL: Record<string, string> = {
  crear_usuario: 'creó a', banear: 'baneó a', reactivar: 'reactivó a',
  eliminar: 'eliminó a', otorgar_admin: 'le dio admin a', revocar_admin: 'le sacó admin a',
  aprobar: 'aprobó a', revocar_aprobacion: 'le revocó la aprobación a',
};

// Contraseña inicial sugerida: al azar, con crypto (no Math.random) — el admin la puede editar o
// regenerar antes de crear la cuenta.
function generarPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 14);
}

// Sección de administración: alta/baja de usuarios, banear/reactivar, otorgar/revocar admin.
// Todo pasa por /api/admin/* con el service-role del lado del servidor — este componente solo
// muestra y dispara acciones, nunca decide privilegios por su cuenta (ver useAdmin.ts).
export function AdminPage() {
  const { isAdmin, isLoading: chequeandoAdmin } = useEstadoCuenta();
  const { session } = useAuth();
  const misId = session?.user.id;
  const { users, isLoading, isError, crear, accion, eliminar } = useAdminUsers();
  const { entries, isLoading: auditLoading } = useAdminAuditoria();
  const pendientes = users.filter(u => !u.isApproved).length;

  if (chequeandoAdmin) return <p className="p-4 text-sm text-ink-600">Verificando…</p>;
  if (!isAdmin) {
    return <Card><Empty icon={ShieldCheck} title="Acceso restringido">Esta sección es solo para administradores.</Empty></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-accent" />
        <h1 className="text-2xl font-bold text-ink-900 font-display">Administración</h1>
        <Badge tone="accent">solo admins</Badge>
      </div>

      <CrearUsuario onCrear={crear} />

      <Card>
        <CardHeader title="Usuarios" sub={`${users.length} en total.`}
          right={pendientes > 0 ? <Badge tone="warn">{pendientes} pendiente{pendientes > 1 ? 's' : ''} de aprobación</Badge> : undefined} />
        {isLoading ? (
          <p className="p-4 text-sm text-ink-600">Cargando…</p>
        ) : isError ? (
          <p className="p-4 text-sm text-neg">No se pudo cargar la lista de usuarios.</p>
        ) : users.length === 0 ? (
          <Empty icon={ShieldCheck} title="Sin usuarios" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-[11px] text-ink-600 border-b border-line">
                <tr>
                  <th className="text-left px-4 py-2">Usuario</th>
                  <th className="text-left px-3">Estado</th>
                  <th className="text-right px-3">Portfolios</th>
                  <th className="text-left px-3">Creado</th>
                  <th className="text-left px-3">Último acceso</th>
                  <th className="text-right px-4">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map(u => (
                  <FilaUsuario key={u.id} u={u} esYo={u.id === misId} onAccion={accion} onEliminar={eliminar} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Actividad reciente" sub="Últimas acciones de administración." />
        {auditLoading ? (
          <p className="p-4 text-sm text-ink-600">Cargando…</p>
        ) : entries.length === 0 ? (
          <Empty icon={ShieldCheck} title="Sin actividad todavía" />
        ) : (
          <div className="divide-y divide-line">
            {entries.map(e => <FilaAuditoria key={e.id} e={e} />)}
          </div>
        )}
      </Card>
    </div>
  );
}

function CrearUsuario({ onCrear }: { onCrear: (b: { email: string; password: string; displayName?: string }) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(generarPassword);
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const crear = async () => {
    setErr(null); setOk(null);
    const correo = email.trim();
    if (!correo || !correo.includes('@')) { setErr('Ingresá un email válido.'); return; }
    if (password.length < 8) { setErr('La contraseña necesita al menos 8 caracteres.'); return; }
    setBusy(true);
    try {
      await onCrear({ email: correo, password, displayName: displayName.trim() || undefined });
      setOk(`Cuenta creada. Pasale a ${correo} el email y esta contraseña por un canal seguro: ${password}`);
      setEmail(''); setDisplayName(''); setPassword(generarPassword());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo crear la cuenta');
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader title="Crear usuario" sub="Elegís la contraseña inicial y se la pasás por fuera de la app." />
      <div className="p-4 flex flex-wrap items-end gap-2">
        <Field label="Email" className="flex-1 min-w-[200px]">
          <input value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="usuario@ejemplo.com" type="email" />
        </Field>
        <Field label="Nombre (opcional)" className="flex-1 min-w-[160px]">
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} className={inputCls} placeholder="Nombre" />
        </Field>
        <Field label="Contraseña inicial" className="flex-1 min-w-[190px]">
          <div className="flex gap-1.5">
            <input value={password} onChange={e => setPassword(e.target.value)} className={inputCls} />
            <Button variant="ghost" onClick={() => setPassword(generarPassword())} type="button">
              <RotateCcw className="w-4 h-4" />
            </Button>
          </div>
        </Field>
        <Button onClick={crear} disabled={busy}><UserPlus className="w-4 h-4" /> {busy ? 'Creando…' : 'Crear'}</Button>
      </div>
      {err && <p className="px-4 pb-3 text-xs text-warn">{err}</p>}
      {ok && <p className="px-4 pb-3 text-xs text-pos">{ok}</p>}
    </Card>
  );
}

function FilaUsuario({ u, esYo, onAccion, onEliminar }: {
  u: AdminUsuario; esYo: boolean;
  onAccion: (id: string, action: AdminAccion) => Promise<void>;
  onEliminar: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ejecutar = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo completar la acción'); }
    finally { setBusy(false); }
  };

  const banear = () => {
    if (window.confirm(`¿Banear a ${u.email}? No va a poder iniciar sesión hasta que lo reactives.`)) void ejecutar(() => onAccion(u.id, 'ban'));
  };
  const reactivar = () => void ejecutar(() => onAccion(u.id, 'unban'));
  const otorgarAdmin = () => {
    if (window.confirm(`¿Dar permisos de administrador a ${u.email}?`)) void ejecutar(() => onAccion(u.id, 'grant_admin'));
  };
  const revocarAdmin = () => {
    if (window.confirm(`¿Quitarle permisos de administrador a ${u.email}?`)) void ejecutar(() => onAccion(u.id, 'revoke_admin'));
  };
  const aprobar = () => void ejecutar(() => onAccion(u.id, 'approve'));
  const revocarAprobacion = () => {
    if (window.confirm(`¿Quitarle la aprobación a ${u.email}? No va a poder crear portfolios hasta que lo apruebes de nuevo.`)) void ejecutar(() => onAccion(u.id, 'revoke_approval'));
  };
  const eliminar = () => {
    if (window.confirm(`¿Eliminar DEFINITIVAMENTE a ${u.email}? Se borran todos sus portfolios, posiciones y aportes. No se puede deshacer.`)) void ejecutar(() => onEliminar(u.id));
  };

  return (
    <tr className="hover:bg-canvas align-top">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-ink-900">{u.email}</span>
          {esYo && <Badge tone="gray">vos</Badge>}
          {u.isAdmin && <Badge tone="celeste">admin</Badge>}
          {!u.isApproved && <Badge tone="warn">pendiente</Badge>}
          {!u.emailConfirmed && <Badge tone="warn">sin confirmar</Badge>}
        </div>
        {u.displayName && <p className="text-[11px] text-ink-500 mt-0.5">{u.displayName}</p>}
        {err && <p className="text-[11px] text-neg mt-1">{err}</p>}
      </td>
      <td className="px-3 py-2.5"><Badge tone={u.banned ? 'neg' : 'pos'}>{u.banned ? 'Baneado' : 'Activo'}</Badge></td>
      <td className="text-right px-3 py-2.5 tnum text-ink-700">{u.portfolioCount}</td>
      <td className="px-3 py-2.5 text-[11px] text-ink-600 whitespace-nowrap">{new Date(u.createdAt).toLocaleDateString('es-AR')}</td>
      <td className="px-3 py-2.5 text-[11px] text-ink-600 whitespace-nowrap">{u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString('es-AR') : '—'}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1 flex-wrap">
          {u.isApproved
            ? <IconAction title="Quitar aprobación" onClick={revocarAprobacion} disabled={busy || esYo || u.isAdmin}><UserX className="w-3.5 h-3.5" /></IconAction>
            : <IconAction title="Aprobar" onClick={aprobar} disabled={busy}><UserCheck className="w-3.5 h-3.5" /></IconAction>}
          {u.banned
            ? <IconAction title="Reactivar" onClick={reactivar} disabled={busy}><RotateCcw className="w-3.5 h-3.5" /></IconAction>
            : <IconAction title="Banear" onClick={banear} disabled={busy || esYo}><Ban className="w-3.5 h-3.5" /></IconAction>}
          {u.isAdmin
            ? <IconAction title="Quitar admin" onClick={revocarAdmin} disabled={busy || esYo}><Crown className="w-3.5 h-3.5" /></IconAction>
            : <IconAction title="Dar admin" onClick={otorgarAdmin} disabled={busy}><Crown className="w-3.5 h-3.5" /></IconAction>}
          <IconAction title="Eliminar" onClick={eliminar} disabled={busy || esYo} danger><Trash2 className="w-3.5 h-3.5" /></IconAction>
        </div>
      </td>
    </tr>
  );
}

function IconAction({ children, onClick, title, disabled, danger }: {
  children: ReactNode; onClick: () => void; title: string; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} aria-label={title}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        danger ? 'text-ink-600 hover:text-neg hover:bg-neg/5' : 'text-ink-600 hover:text-ink-900 hover:bg-canvas'}`}>
      {children}
    </button>
  );
}

function FilaAuditoria({ e }: { e: AdminAuditEntry }) {
  return (
    <div className="px-4 py-2.5 text-sm flex items-center justify-between gap-2 flex-wrap">
      <span className="text-ink-800">
        <b className="text-ink-900">{e.actor_email ?? '—'}</b> {ACCION_LABEL[e.action] ?? e.action}
        {e.target_email && <> · <span className="text-ink-600">{e.target_email}</span></>}
      </span>
      <span className="text-[11px] text-ink-500 tnum shrink-0">{new Date(e.created_at).toLocaleString('es-AR')}</span>
    </div>
  );
}
