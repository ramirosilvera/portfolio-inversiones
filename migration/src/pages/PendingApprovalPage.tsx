import { Clock } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button, Logo } from '../components/ui';

// Se muestra en vez de la app cuando hay sesión pero la cuenta todavía no fue aprobada por un
// admin (ver App.tsx: gatea con useEstadoCuenta().isApproved). No es la barrera real — esa vive
// en la policy portfolios_insert (exige is_approved() en la base) — esto es solo la explicación.
export function PendingApprovalPage() {
  const { session, signOut } = useAuth();
  return (
    <div className="min-h-full grid place-items-center px-5">
      <div className="w-full max-w-sm text-center space-y-4 animate-rise">
        <div className="inline-flex flex-col items-center gap-2">
          <Logo size={44} />
          <p className="font-display font-extrabold text-xl text-ink-900">Porta<span className="text-celeste-600">folio</span></p>
        </div>
        <div className="rounded-2xl border border-line bg-surface shadow-soft px-5 py-6 space-y-3">
          <div className="mx-auto w-11 h-11 rounded-2xl bg-canvas grid place-items-center text-ink-500">
            <Clock className="w-5 h-5" />
          </div>
          <p className="font-display font-bold text-lg text-ink-900">Cuenta pendiente de aprobación</p>
          <p className="text-sm text-ink-600 leading-relaxed">
            {session?.user.email} ya se registró; un administrador tiene que aprobar el acceso.
          </p>
        </div>
        <Button variant="ghost" onClick={() => void signOut()} className="w-full py-2.5">Salir</Button>
      </div>
    </div>
  );
}
