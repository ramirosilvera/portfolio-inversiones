import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, Table2, Landmark, Wallet, Settings, Layers, TrendingUp, Percent,
  CalendarClock, Radar, Sparkles, LogOut, ChevronDown, Sun, Moon, Rows3, MoreHorizontal, PiggyBank,
  Building2, Globe, ShieldCheck, ArrowRightLeft, PieChart,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePrefs } from '../hooks/usePrefs';
import { useEstadoCuenta } from '../hooks/useAdmin';
import { Wordmark } from './ui';
import { UpdatedAt } from './UpdatedAt';
import { ErrorBoundary } from './ErrorBoundary';

// ── Navegación ────────────────────────────────────────────────────────────────
interface NavItem { to: string; label: string; mobileLabel?: string; icon: LucideIcon; end?: boolean }

const NAV_MAIN: NavItem[] = [
  { to: '/', label: 'Dashboard', mobileLabel: 'Inicio', icon: LayoutDashboard, end: true },
  { to: '/posiciones', label: 'Posiciones', icon: Table2 },
  { to: '/finanzas', label: 'Finanzas', icon: PiggyBank },
  { to: '/radar', label: 'Radar', icon: Radar },
  { to: '/bonos', label: 'Renta fija', mobileLabel: 'Bonos', icon: Landmark },
  { to: '/cupones', label: 'Cobros', icon: CalendarClock },
];

const NAV_MORE: NavItem[] = [
  { to: '/analisis', label: 'Análisis', icon: Sparkles },
  { to: '/tasas', label: 'Tasas', icon: Percent },
  { to: '/aportes', label: 'Aportes', icon: Wallet },
  { to: '/forecast', label: 'Forecast', icon: TrendingUp },
  { to: '/consolidado', label: 'Consolidado', icon: Layers },
  { to: '/brokers', label: 'Brokers', icon: Building2 },
  { to: '/cedears', label: 'CEDEARs', icon: PieChart },
  { to: '/transferencias', label: 'Transferencias', icon: ArrowRightLeft },
  { to: '/macro', label: 'Macro', icon: Globe },
  { to: '/config', label: 'Config', icon: Settings },
];

const MOBILE_TABS = NAV_MAIN.slice(0, 5);
// "Admin" no vive en NAV_MORE (constante estática): se agrega condicionalmente en el render según
// useEstadoCuenta(), así el link solo aparece para quien realmente tiene permiso.
const ADMIN_ITEM: NavItem = { to: '/admin', label: 'Admin', icon: ShieldCheck };

const pill = (isActive: boolean) =>
  `flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
    isActive ? 'bg-celeste-500 text-white shadow-glow' : 'text-ink-600 hover:bg-canvas hover:text-ink-800'}`;

function isMoreRoute(pathname: string, items: NavItem[]) {
  return items.some(n => pathname === n.to || pathname.startsWith(n.to + '/'));
}

export function Layout() {
  const { signOut, session } = useAuth();
  const { portfolios, active, activeId, defaultId, setActiveId, loading } = usePortfolios();
  const orderedPortfolios = defaultId
    ? [...portfolios].sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0))
    : portfolios;
  const { theme, density, toggleTheme, toggleDensity } = usePrefs();
  const { isAdmin } = useEstadoCuenta();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const navMore = isAdmin ? [...NAV_MORE, ADMIN_ITEM] : NAV_MORE;
  const mobileSheet = isAdmin ? [NAV_MAIN[5], ...NAV_MORE, ADMIN_ITEM] : [NAV_MAIN[5], ...NAV_MORE];

  useEffect(() => { setMoreOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [moreOpen]);

  return (
    <div className="min-h-full flex flex-col">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-xl pt-safe">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-3">
          <Link to="/" className="shrink-0"><Wordmark hideTextOnMobile /></Link>

          <div className="relative min-w-0 flex-1 sm:flex-none sm:ml-2 sm:min-w-[10rem]">
            <select
              value={activeId ?? ''}
              onChange={e => { const v = e.target.value; setActiveId(v); if (v === '__all__') navigate('/consolidado'); }}
              className="w-full max-w-full truncate appearance-none bg-canvas border border-line rounded-full pl-4 pr-9 py-2 text-sm font-semibold text-ink-800 focus:outline-none focus:ring-2 focus:ring-celeste-300"
            >
              {orderedPortfolios.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              <option value="__all__">Todos (consolidado)</option>
            </select>
            <ChevronDown className="w-4 h-4 text-ink-600 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <div className="ml-auto flex items-center gap-1 shrink-0">
            <IconBtn onClick={toggleDensity} title={density === 'compact' ? 'Densidad cómoda' : 'Densidad compacta'} active={density === 'compact'}>
              <Rows3 className="w-4 h-4" />
            </IconBtn>
            <IconBtn onClick={toggleTheme} title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}>
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </IconBtn>
            <span className="text-[11px] text-ink-600 hidden md:inline max-w-[150px] truncate ml-1">{session?.user.email}</span>
            <IconBtn onClick={signOut} title="Salir" danger><LogOut className="w-4 h-4" /></IconBtn>
          </div>
        </div>

        {/* Desktop nav — pills + "Más" dropdown */}
        <nav className="mx-auto max-w-6xl px-3 pb-2 hidden md:flex items-center gap-1.5">
          {NAV_MAIN.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => pill(isActive)}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </NavLink>
          ))}
          <div className="relative shrink-0 ml-auto">
            <button onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen}
              className={pill(isMoreRoute(location.pathname, navMore))}>
              <MoreHorizontal className="w-3.5 h-3.5" /> Más
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 mt-1.5 z-50 w-48 rounded-2xl border border-line bg-surface shadow-card p-1.5 animate-fade-in">
                  {navMore.map(({ to, label, icon: Icon }) => (
                    <NavLink key={to} to={to}
                      className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
                        isActive ? 'bg-celeste-100 text-celeste-700 dark:bg-celeste-500/20 dark:text-celeste-300' : 'text-ink-700 hover:bg-canvas'}`}>
                      <Icon className="w-4 h-4" /> {label}
                    </NavLink>
                  ))}
                </div>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* ── Main ──────────────────────────────────────────────── */}
      <main className="mx-auto max-w-6xl w-full min-w-0 px-4 py-6 flex-1 animate-fade-in">
        {loading ? (
          <div className="text-center py-20 text-ink-600">Cargando…</div>
        ) : portfolios.length === 0 ? (
          // Sin portfolios, el "bienvenida + crear" solo va en el home (/) — en cualquier otra
          // ruta (ej. /config, a donde lleva el botón de EmptyState) hay que dejar pasar el Outlet
          // real, si no "Crear mi primer portfolio" cambiaba la URL pero la pantalla nunca se
          // movía de EmptyState (cada página ya maneja sin active portfolio: null o campos ?.).
          location.pathname === '/' ? <EmptyState /> : <ErrorBoundary key={location.pathname}><Outlet /></ErrorBoundary>
        ) : activeId === '__all__' && location.pathname !== '/consolidado' ? (
          <ConsolidadoHint />
        ) : (
          <ErrorBoundary key={location.pathname}><Outlet /></ErrorBoundary>
        )}
      </main>

      <footer className="mx-auto max-w-6xl w-full px-4 pt-6 pb-24 md:pb-6 text-center text-[11px] text-ink-500 space-y-1">
        <div><UpdatedAt /></div>
        <p>Portafolio · los números los calcula el código, la IA solo interpreta lo cualitativo.</p>
      </footer>

      {/* ── Mobile bottom tab bar ─────────────────────────────── */}
      <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden border-t border-line bg-surface/95 backdrop-blur-xl pb-safe">
        <div className="flex items-stretch h-14">
          {MOBILE_TABS.map(({ to, mobileLabel, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isActive ? 'text-celeste-500' : 'text-ink-500 active:text-ink-700'}`}>
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-semibold leading-none">{mobileLabel ?? label}</span>
            </NavLink>
          ))}
          <button onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen} aria-label="Más opciones"
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
              moreOpen || isMoreRoute(location.pathname, mobileSheet) ? 'text-celeste-500' : 'text-ink-500 active:text-ink-700'}`}>
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-semibold leading-none">Más</span>
          </button>
        </div>
      </nav>

      {/* ── Mobile "Más" bottom sheet ─────────────────────────── */}
      {moreOpen && (
        <div className="md:hidden">
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-fade-in"
            onClick={() => setMoreOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Más opciones"
            className="fixed bottom-0 inset-x-0 z-50 rounded-t-3xl bg-surface border-t border-line shadow-card animate-slide-up pb-safe">
            <div className="w-10 h-1 rounded-full bg-ink-400 mx-auto mt-3 mb-4" />
            <div className="grid grid-cols-3 gap-1 px-4 pb-6 max-h-[70vh] overflow-y-auto">
              {mobileSheet.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} onClick={() => setMoreOpen(false)}
                  className={({ isActive }) => `flex flex-col items-center gap-1.5 py-3 rounded-2xl transition-colors ${
                    isActive ? 'bg-celeste-100 text-celeste-700 dark:bg-celeste-500/20 dark:text-celeste-300'
                    : 'text-ink-600 hover:bg-canvas active:bg-canvas'}`}>
                  <Icon className="w-6 h-6" />
                  <span className="text-[11px] font-semibold text-center leading-tight">{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconBtn({ children, onClick, title, active, danger }: {
  children: React.ReactNode; onClick?: () => void; title: string; active?: boolean; danger?: boolean;
}) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className={`inline-flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
        active ? 'bg-celeste-100 text-celeste-700 dark:bg-celeste-500/20 dark:text-celeste-300'
        : danger ? 'text-ink-600 hover:text-neg hover:bg-neg/5'
        : 'text-ink-600 hover:text-ink-900 hover:bg-canvas'}`}>
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20">
      <p className="text-ink-900 font-bold text-lg font-display">No tenés portfolios todavía</p>
      <p className="text-sm text-ink-600 mt-1 mb-5">Creá el primero para empezar a cargar posiciones.</p>
      <Link to="/config" className="inline-flex items-center gap-1.5 rounded-full bg-celeste-500 text-white px-5 py-2.5 text-sm font-semibold shadow-glow hover:bg-celeste-600 transition-colors">
        Crear mi primer portfolio
      </Link>
    </div>
  );
}

function ConsolidadoHint() {
  return (
    <div className="text-center py-20">
      <p className="text-ink-900 font-bold text-lg font-display">Estás en vista consolidada</p>
      <p className="text-sm text-ink-600 mt-1 mb-5">Elegí un portfolio en el selector de arriba, o mirá el total.</p>
      <Link to="/consolidado" className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface text-ink-800 px-5 py-2.5 text-sm font-semibold hover:border-celeste-300 transition-colors">
        Ver Consolidado
      </Link>
    </div>
  );
}
