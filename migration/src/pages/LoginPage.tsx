import { useState } from 'react';
import { TrendingUp, ShieldCheck, LineChart, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button, Logo } from '../components/ui';

type Modo = 'ingresar' | 'registrar';

// El auto-registro sigue abierto (cualquiera puede crear una cuenta), pero no alcanza para operar
// en la app: hasta que un admin la apruebe desde /admin, no puede crear ningún portfolio — la
// pantalla de "cuenta pendiente" (ver App.tsx) se lo explica después de loguearse.
export function LoginPage() {
  const { signInPassword, signUp } = useAuth();
  const [modo, setModo] = useState<Modo>('ingresar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (modo === 'registrar' && password.length < 6) { setMsg({ text: 'La contraseña debe tener al menos 6 caracteres.' }); return; }
    setBusy(true); setMsg(null);
    if (modo === 'ingresar') {
      const { error } = await signInPassword(email, password);
      if (error) setMsg({ text: error });
    } else {
      const { error, needsConfirm } = await signUp(email, password);
      if (error) setMsg({ text: error });
      else setMsg({
        text: needsConfirm
          ? 'Cuenta creada. Revisá tu email para confirmarla — después, un administrador tiene que aprobar el acceso antes de que puedas usar la app.'
          : 'Cuenta creada. Un administrador tiene que aprobar el acceso antes de que puedas usar la app.',
        ok: true,
      });
    }
    setBusy(false);
  };

  return (
    <div className="min-h-full grid lg:grid-cols-2">
      {/* Hero / marketing */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden bg-gradient-to-br from-celeste-500 via-celeste-400 to-celeste-300 text-white">
        <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-white/15 blur-2xl" />
        <div className="absolute bottom-10 -left-10 w-64 h-64 rounded-full bg-sol/25 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <Logo size={40} />
          <span className="font-display font-extrabold text-2xl tracking-tight">Portafolio</span>
        </div>
        <div className="relative space-y-5 max-w-md">
          <h1 className="font-display font-extrabold text-4xl leading-tight">
            Tu portfolio, claro y al día.
          </h1>
          <p className="text-white/85 text-lg leading-relaxed">
            Valuación por Owner Earnings, fundamentos de la SEC, contexto macro y proyecciones a largo plazo. En un solo lugar.
          </p>
          <ul className="space-y-2.5 text-white/90 text-sm">
            <Feat icon={LineChart}>DCF y ratios calculados por el código, sin alucinaciones</Feat>
            <Feat icon={TrendingUp}>Precios, bonos y macro que se actualizan solos</Feat>
            <Feat icon={ShieldCheck}>Multi-portfolio con aislamiento total por usuario</Feat>
            <Feat icon={Sparkles}>Análisis cualitativo con IA sobre datos reales</Feat>
          </ul>
        </div>
        <p className="relative text-white/70 text-xs">Hecho con 💙 en Argentina · Solo lectura de mercado, sin ejecución de órdenes.</p>
      </div>

      {/* Form */}
      <div className="grid place-items-center px-5 py-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5 animate-rise">
          <div className="text-center lg:hidden">
            <div className="inline-flex flex-col items-center gap-2">
              <Logo size={44} />
              <p className="font-display font-extrabold text-xl text-ink-900">Porta<span className="text-celeste-600">folio</span></p>
            </div>
          </div>

          <div className="text-center">
            <h2 className="font-display font-bold text-2xl text-ink-900">
              {modo === 'ingresar' ? 'Bienvenido de nuevo' : 'Creá tu cuenta'}
            </h2>
            <p className="text-sm text-ink-600 mt-1">
              {modo === 'ingresar' ? 'Ingresá para ver tu portfolio' : 'Un admin tiene que aprobar el acceso antes de poder usarla'}
            </p>
          </div>

          {/* Toggle */}
          <div role="radiogroup" aria-label="Modo" className="grid grid-cols-2 gap-1 rounded-full bg-canvas border border-line p-1">
            {(['ingresar', 'registrar'] as Modo[]).map(m => (
              <button key={m} type="button" onClick={() => { setModo(m); setMsg(null); }} role="radio" aria-checked={modo === m}
                className={`py-2 rounded-full text-xs font-semibold transition-all ${modo === m ? 'bg-celeste-500 text-white shadow-glow' : 'text-ink-600 hover:text-ink-800'}`}>
                {m === 'ingresar' ? 'Ingresar' : 'Registrarme'}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <input type="email" placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" aria-label="Email"
              className="w-full bg-surface border border-line rounded-xl px-4 py-2.5 text-sm text-ink-900 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-celeste-300 focus:border-celeste-300" />
            <input type="password" placeholder="contraseña" value={password} onChange={e => setPassword(e.target.value)} required
              autoComplete={modo === 'ingresar' ? 'current-password' : 'new-password'} aria-label="Contraseña"
              className="w-full bg-surface border border-line rounded-xl px-4 py-2.5 text-sm text-ink-900 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-celeste-300 focus:border-celeste-300" />
          </div>

          <Button type="submit" disabled={busy} className="w-full py-2.5">
            {busy ? (modo === 'ingresar' ? 'Ingresando…' : 'Creando cuenta…') : (modo === 'ingresar' ? 'Ingresar' : 'Crear cuenta')}
          </Button>

          {msg && <p className={`text-xs text-center ${msg.ok ? 'text-pos' : 'text-warn'}`}>{msg.text}</p>}
        </form>
      </div>
    </div>
  );
}

function Feat({ icon: Icon, children }: { icon: typeof LineChart; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/20 shrink-0"><Icon className="w-4 h-4" /></span>
      {children}
    </li>
  );
}
