import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle } from 'lucide-react';
import type { Alerta } from '../engine/alertas';
import { CALIFICADORAS_CLASIFICABLES, ETIQUETA_GRADO, ETIQUETA_ESCALA, type GradoCredito, type EscalaRating } from '../engine/rating';

// Paleta categórica para gráficos de torta/donut — estable, funciona en claro y oscuro. Un solo
// lugar para que Dashboard/Brokers/Consolidado (o cualquier otro donut futuro) usen los mismos
// colores en el mismo orden, en vez de cada uno definir su propia copia.
export const PIE_COLORS = ['#4F97D4', '#F4C752', '#5FB49C', '#B08BD6', '#E08E6D', '#9BCFEF', '#7A8CA5', '#D45F7A', '#63B7C9', '#C7A15A'];

// "Sin asignar" (en los donuts de broker) es un recordatorio de pendiente, no un broker real —
// gris apagado en vez de un tono de PIE_COLORS, para que no compita visualmente con los brokers de
// verdad. Un solo lugar para que BrokersPage y el resumen del Dashboard usen el mismo criterio.
const SIN_ASIGNAR_COLOR = '#8B96A5';
export const colorDeBroker = (i: number, brokerId: string | null): string =>
  brokerId == null ? SIN_ASIGNAR_COLOR : PIE_COLORS[i % PIE_COLORS.length];

// Clase base para inputs/selects/textarea — usala para que todos los controles se vean igual.
export const inputCls =
  'w-full bg-surface border border-line rounded-xl px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-celeste-300 focus:border-celeste-300';

// Campo de formulario con micro-label arriba (mejor que placeholder solo).
export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] font-semibold text-ink-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-ink-500 mt-1">{hint}</span>}
    </label>
  );
}

// Input numérico "seguro" para editar — `value` sigue siendo un number (para que el padre pueda
// calcular con él normalmente), pero el <input> en sí mantiene su propio string en edición
// (`draft`), y solo empuja un número al padre cuando lo tipeado parsea a uno finito. Se resincroniza
// desde `value` solo cuando cambia por una razón EXTERNA (ej. "Restablecer", cambiar de portfolio) —
// nunca en cada tecla propia.
//
// Por qué existe: un <input type="number"> atado directo a un state numérico (value={n},
// onChange={e => setN(Number(e.target.value))}) sufre un bug clásico — cada tecla coacciona con
// Number() y re-renderiza con un valor normalizado, lo que le pisa el cursor al usuario y hace
// carísimo borrar/reemplazar justo el primer carácter (hay que seleccionar todo el campo o borrar
// de atrás para adelante). Mismo patrón ya probado en ProyeccionesPage.tsx#Num (ahí documentado con
// el caso concreto: escribir "8." para un decimal se volvía "8" en cada tecla, borrando el punto) —
// esto lo generaliza para reusarlo en cualquier campo numérico de la app.
//
// Vacío mientras se edita: no empuja nada al padre (el valor sigue siendo el último válido) hasta
// que se tipee un número real de nuevo — mismo criterio que todo otro campo numérico "seguro" ya
// existente en la app (filtroDuracionMin, montoOperarStr, etc.), no un modo especial de este
// componente.
//
// `value` acepta `null` para campos genuinamente OPCIONALES (ej. ratio_cedear antes de que el
// usuario lo cargue) — se muestra vacío. `onEmptyBlur` (opcional) es lo único que reacciona a un
// campo VACÍO — se dispara solo al perder el foco, nunca en cada tecla — para los casos que
// necesitan garantizar "nunca queda en un estado ambiguo" (ej. un umbral de alerta que vuelve a su
// default en vez de quedar visualmente vacío con el valor viejo todavía aplicando por detrás; o un
// campo obligatorio que vuelve a `null` explícito). Sin `onEmptyBlur`, vaciar el campo simplemente
// no empuja nada — el valor sigue siendo el último válido hasta que se tipee uno nuevo.
export function NumField({ value, onChange, onEmptyBlur, className, ...rest }: {
  value: number | null; onChange: (n: number) => void; onEmptyBlur?: () => void; className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type' | 'className'>) {
  const [draft, setDraft] = useState(value != null ? String(value) : '');
  useEffect(() => { setDraft(value != null ? String(value) : ''); }, [value]);
  return (
    <input type="number" {...rest} value={draft}
      onBlur={() => { if (draft === '') onEmptyBlur?.(); }}
      onChange={e => {
        setDraft(e.target.value);
        if (e.target.value === '') return;
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      className={className ?? inputCls} />
  );
}

// Estado vacío con ícono + microcopy.
export function Empty({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      {Icon && <div className="mx-auto w-11 h-11 rounded-2xl bg-canvas grid place-items-center text-ink-500 mb-3"><Icon className="w-5 h-5" /></div>}
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      {children && <p className="text-xs text-ink-600 mt-1 max-w-sm mx-auto leading-relaxed">{children}</p>}
    </div>
  );
}

// ── Marca ─────────────────────────────────────────────────────────────────────
// Isotipo: mosaico celeste con un mini gráfico ascendente (crecimiento) y el sol.
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9BCFEF" /><stop offset="1" stopColor="#4F97D4" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#lg)" />
      <circle cx="29.5" cy="11" r="3.2" fill="#F4C752" />
      <path d="M9 27.5 L17 20.5 L22.5 24.5 L31 15" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="27.5" r="1.9" fill="#fff" />
    </svg>
  );
}

export function Wordmark({ size = 32, hideTextOnMobile = false }: { size?: number; hideTextOnMobile?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 shrink-0">
      <Logo size={size} />
      <span className={`font-display font-extrabold tracking-tight text-ink-900 text-lg leading-none ${hideTextOnMobile ? 'hidden sm:inline' : ''}`}>
        Porta<span className="text-celeste-600">folio</span>
      </span>
    </span>
  );
}

// ── Superficies ───────────────────────────────────────────────────────────────
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface shadow-card ${className}`}>{children}</div>;
}

export function CardHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    // flex-wrap: en mobile, título + right (badge/botón) no siempre entran en una fila — sin esto
    // se apretujaban entre sí (título partido en 2 líneas angostas, badge rompiendo su propio texto).
    // Con wrap, right baja a su propia fila si no entra, en vez de comprimirse.
    <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line flex-wrap">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-ink-900 font-display">{title}</h3>
        {sub && <p className="text-[11px] text-ink-600 mt-0.5 leading-snug">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

// Lista de alertas de riesgo/calidad de datos — mismo look que ya usaba el aviso de "sin cotización"
// del Dashboard, generalizado para CedearsPage/BonosPage/Dashboard. Severidad 'neg' (rojo) para
// riesgos serios (default, spread negativo); 'warn' (ámbar) para el resto. No renderiza nada si la
// lista viene vacía — así el caller puede pasarla siempre sin envolverla en un `if` propio.
export function AlertasBanner({ alertas }: { alertas: Alerta[] }) {
  if (alertas.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {alertas.map((a, i) => (
        <div key={i} className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11px] ring-1 ring-inset ${a.severidad === 'neg' ? 'bg-neg/10 ring-neg/25 text-ink-800' : 'bg-warn/10 ring-warn/25 text-ink-700'}`}>
          <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${a.severidad === 'neg' ? 'text-neg' : 'text-warn'}`} />
          <p>{a.texto}</p>
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, delta, hint }: { label: string; value: ReactNode; delta?: number; hint?: string }) {
  return (
    // min-w-0: sin esto, un grid item NO se achica más allá del ancho natural de su contenido — un
    // valor largo (ej. "US$13,031") empuja el ancho de la columna entera y se sale del borde
    // redondeado de la tarjeta, en vez de truncarse. `truncate` recién puede hacer algo con min-w-0
    // puesto. title en el valor: fallback para ver el número completo si quedó cortado.
    <div className="rounded-2xl border border-line bg-surface shadow-soft px-4 py-3 min-w-0" title={hint}>
      <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold truncate">{label}</p>
      <p className="text-xl font-bold text-ink-900 tnum mt-1 font-display truncate" title={typeof value === 'string' ? value : undefined}>{value}</p>
      {delta != null && (
        <p className={`text-xs font-semibold tnum mt-0.5 ${delta >= 0 ? 'text-pos' : 'text-neg'}`}>
          {delta >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(delta))}
        </p>
      )}
    </div>
  );
}

// `wrap`: por default los Badge son de una sola línea (pill, texto corto — tickers, estados) — para
// texto largo que puede necesitar más de una línea (ej. las alertas de Macro, "Riesgo país: riesgo
// país alto: financiamiento caro...") un pill nowrap se sale del borde de la Card en mobile (no
// puede achicarse ni cortar palabras). `wrap` cambia a `whitespace-normal` + esquinas menos
// redondeadas (rounded-full en una caja multilínea se ve como una cápsula rara, no un pill).
export function Badge({ children, tone = 'gray', wrap = false }: { children: ReactNode; tone?: 'gray' | 'pos' | 'neg' | 'warn' | 'accent' | 'celeste' | 'sol'; wrap?: boolean }) {
  const m: Record<string, string> = {
    gray: 'bg-canvas text-ink-700 ring-1 ring-line',
    pos: 'bg-pos/10 text-pos ring-1 ring-pos/20',
    neg: 'bg-neg/10 text-neg ring-1 ring-neg/20',
    warn: 'bg-warn/10 text-warn ring-1 ring-warn/20',
    accent: 'bg-celeste-100 text-celeste-700 ring-1 ring-celeste-200 dark:bg-celeste-500/20 dark:text-celeste-300 dark:ring-celeste-500/30',
    celeste: 'bg-celeste-100 text-celeste-700 ring-1 ring-celeste-200 dark:bg-celeste-500/20 dark:text-celeste-300 dark:ring-celeste-500/30',
    sol: 'bg-sol-soft text-sol-deep ring-1 ring-sol/30 dark:bg-sol/15 dark:text-sol',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold ${wrap ? 'whitespace-normal text-left rounded-xl' : 'whitespace-nowrap rounded-full'} ${m[tone]}`}>
      {children}
    </span>
  );
}

// Badge de rating: tono por grado (pos=grado de inversión, warn=especulativo, neg=default,
// gris=sin calificar o 'Otra' calificadora). Nunca inventa un grado que el motor no dio.
// `grado === null` puede ser por 3 motivos DISTINTOS — mezclarlos en un solo mensaje genérico le
// mentiría al usuario en 2 de los 3 casos (ej. decirle "notación desconocida" a un S&P sin nota
// cargada). Cuando SÍ hay grado, el hint siempre aclara la escala (global vs. nacional Arg.) —
// nunca deja que un "grado de inversión" nacional se lea como si fuera comparable al global.
// Extraído de BonosPage (que la usaba solo para bonos en cartera) para reusarla también en el
// Radar de renta fija (catálogo de referencia, no solo lo que tenés).
export function RatingBadge({ calificadora, calificacion, grado, escala }: {
  calificadora: string | null; calificacion: string | null; grado: GradoCredito | null; escala: EscalaRating | null;
}) {
  if (!calificadora && !calificacion) return <span className="text-ink-500 text-[11px]">—</span>;
  const tone = grado === 'grado_inversion' ? 'pos' : grado === 'especulativo' ? 'warn' : grado === 'default' ? 'neg' : 'gray';
  const clasificable = calificadora != null && (CALIFICADORAS_CLASIFICABLES as readonly string[]).includes(calificadora);
  const hint = grado != null && escala != null
    ? `${calificadora}: ${ETIQUETA_GRADO[grado]} (${ETIQUETA_ESCALA[escala]})`
    : !calificadora ? 'Sin calificadora cargada'
    : !clasificable ? `${calificadora} — notación desconocida, no se clasifica automático`
    : !calificacion ? `${calificadora} — falta cargar la nota`
    : `${calificadora} — "${calificacion}" no matchea ninguna nota conocida de esta escala (¿typo?)`;
  return (
    <span title={hint}>
      <Badge tone={tone}>{calificacion || '—'}{calificadora && <span className="ml-1 text-[9px] opacity-70">{calificadora}</span>}</Badge>
    </span>
  );
}

// Segmented control tipo "pills" para elegir entre 2-4 vistas mutuamente excluyentes (no filtros
// independientes — para eso es un checkbox/Badge toggle, no esto). Extraído del patrón que ya
// usaba CuponesPage (Cobrado/Proyectado) para reusarlo en Radar/Análisis (Renta variable/Renta
// fija) sin duplicar el JSX. `role="radiogroup"`/`role="radio"`: es una selección única entre
// opciones, no varios toggles independientes — mismo criterio que el selector de visualización en
// AddWidgetModal.
export function ViewToggle<T extends string>({ value, onChange, options, label = 'Vista' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1.5">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} role="radio" aria-checked={value === o.value}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${value === o.value ? 'bg-celeste-500 text-white' : 'bg-canvas text-ink-600 hover:text-ink-900'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button', className = '' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean; type?: 'button' | 'submit'; className?: string;
}) {
  const v: Record<string, string> = {
    primary: 'bg-celeste-500 text-white hover:bg-celeste-600 shadow-glow',
    ghost: 'border border-line bg-surface text-ink-800 hover:bg-canvas hover:border-celeste-300',
    danger: 'border border-neg/30 bg-surface text-neg hover:bg-neg/5',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-all disabled:opacity-50 disabled:shadow-none active:scale-[0.98] ${v[variant]} ${className}`}>
      {children}
    </button>
  );
}

// El texto de la IA a veces trae "\n" literal (2 caracteres: barra + n) en vez de un salto de línea
// real — sin normalizar, whitespace-pre-wrap no lo interpreta y se ve el "\n" tal cual en pantalla.
export const normalizeAiText = (s: string): string => s.replace(/\\r\\n|\\n/g, '\n');

// ── formatters ───────────────────────────────────────────────────────────────
// Dólares → prefijo "US$" (idioma AR: distingue de los pesos "$"). Miles con coma (en-US).
export const fmtUsd = (n: number | null | undefined, dp = 2): string =>
  n == null || !Number.isFinite(n) ? '—'
    : `${n < 0 ? '-' : ''}US$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

// Compacto para magnitudes grandes (millones M / miles de millones B / billones T, escala en-US) —
// evita que desborden las cajas. Debajo de 1M muestra el número completo (importes chicos exactos).
// Decimales adaptativos: 2 si el número guía es <10 (US$1,23 M), 1 si <100, 0 si no (conserva cifras).
export const fmtUsdCompact = (n: number | null | undefined, opts?: { k?: boolean }): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n), sign = n < 0 ? '-' : '';
  // Siempre al menos 1 decimal: con 0 decimales, 143,577 M se mostraba "US$144 B" y no se podía
  // cruzar contra la tabla de owner earnings por año (parecía otro número).
  const fmt = (v: number, suf: string) => `${sign}US$${v.toFixed(v < 10 ? 2 : 1)} ${suf}`;
  if (abs >= 1e12) return fmt(abs / 1e12, 'T');
  if (abs >= 1e9) return fmt(abs / 1e9, 'B');
  if (abs >= 1e6) return fmt(abs / 1e6, 'M');
  // opts.k, opcional: compacta también desde 1.000 (US$18K) — pensado para tiles angostos (3
  // columnas dentro de una tarjeta del Dashboard, ~90px cada una) donde un importe de 5 cifras
  // ("US$18,294") desborda a dos líneas. Sin espacio y sin decimal desde 10K (más corto que el
  // formato M/B/T de arriba, que sí tiene espacio — ahí el contexto es más ancho). El resto de los
  // usos de fmtUsdCompact no pasa este flag, así que su comportamiento no cambia.
  if (opts?.k && abs >= 1e3) {
    const v = abs / 1e3;
    return `${sign}US$${v.toFixed(v < 10 ? 1 : 0)}K`;
  }
  return fmtUsd(n, 0);
};
export const fmtNum = (n: number | null | undefined, dp = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtPct = (n: number | null | undefined, dp = 1): string =>
  n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(dp)}%`;

// Pesos argentinos → prefijo "$" (sin decimales, miles con punto es-AR).
export const fmtArs = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : `$${Math.round(n).toLocaleString('es-AR')}`;

// Compacto para montos grandes (millones/miles) — evita que desborden cajas angostas.
export const fmtArsCompact = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: abs >= 1e7 ? 1 : 2 })} M`;
  if (abs >= 1e4) return `$${(n / 1e3).toLocaleString('es-AR', { maximumFractionDigits: 0 })} k`;
  return `$${Math.round(n).toLocaleString('es-AR')}`;
};
