// Shared helpers for Pages Functions. All external-API access + secrets live here,
// never in the browser. Cache in Supabase (via the service-role key) to respect
// rate limits and survive provider outages.

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY?: string;   // para validar el JWT del usuario (auth de las Functions)
  SEC_PROXY_BASE: string;   // e.g. https://sec-proxy.<sub>.workers.dev
  SEC_PROXY_TOKEN: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  FMP_API_KEY?: string;     // fundamentals fallback / prices
  FINNHUB_API_KEY?: string; // prices
  TWELVE_DATA_API_KEY?: string; // dividendos, fallback (FMP/Finnhub/Twelve Data exigen plan pago en esta cuenta)
  EODHD_API_KEY?: string;       // dividendos, proveedor principal (verificado en plan gratuito)
  ALPHA_VANTAGE_API_KEY?: string; // dividendos, fallback de EODHD (verificado en plan gratuito)
  CRON_SECRET?: string;     // opcional: protege /api/cron/* (header X-Cron-Secret)
}

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export const preflight = (): Response => new Response(null, { status: 204, headers: CORS });

type Ctx = Parameters<PagesFunction<Env>>[0];

// ── Autenticación ────────────────────────────────────────────────────────────
// Las Functions son públicas por defecto: sin esto, cualquiera que conozca la URL puede llamarlas
// y consumir cuota PAGA (Gemini, Finnhub/FMP) o usarlas de proxy. Validamos el JWT del usuario
// contra Supabase; solo un usuario logueado de este proyecto puede usarlas.
export async function usuarioAutenticado(env: Env, request: Request): Promise<boolean> {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !env.SUPABASE_URL) return false;
  // apikey: usamos la service-role que YA existe (guard() la exige), con fallback a la anon. Así no
  // hace falta configurar un secret nuevo — si faltara, todos los endpoints devolverían 401 y la
  // app quedaría rota en producción. El que se valida es el JWT del usuario, no esta clave.
  const apikey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  if (!apikey) return false;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey },
    });
    return res.ok;
  } catch { return false; }
}

// ¿La cuenta que llama está aprobada para operar (admin o en usuarios_aprobados)? admin_users y
// usuarios_aprobados no tienen políticas RLS para el cliente (0020/0021_*.sql) — este chequeo con
// el service-role es la única fuente de verdad, igual que usuarioAutenticado() lo es para "¿hay
// sesión?". Un usuario recién auto-registrado tiene sesión válida pero NO está aprobado: sin este
// chequeo podía seguir usando IA/cotizaciones (cuota paga) aunque no pueda crear un portfolio.
export async function usuarioAprobado(env: Env, request: Request): Promise<boolean> {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    });
    if (!res.ok) return false;
    const user = await res.json() as { id?: string };
    if (!user?.id) return false;
    const [adminRows, aprobadoRows] = await Promise.all([
      sbSelect<{ user_id: string }>(env, 'admin_users', `user_id=eq.${user.id}&select=user_id`),
      sbSelect<{ user_id: string }>(env, 'usuarios_aprobados', `user_id=eq.${user.id}&select=user_id`),
    ]);
    return adminRows.length > 0 || aprobadoRows.length > 0;
  } catch { return false; }
}

// Id del usuario del JWT en Authorization (null si no hay sesión o el token es inválido) — para
// los pocos endpoints que necesitan saber QUIÉN llama, no solo SI hay sesión (ej. verificar que un
// portfolio_id que mandó el cliente le pertenece antes de escribir una fila con él).
export async function usuarioId(env: Env, request: Request): Promise<string | null> {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    });
    if (!res.ok) return null;
    const user = await res.json() as { id?: string };
    return user?.id ?? null;
  } catch { return null; }
}

// Ticker válido para interpolar en una URL de proveedor externo o un filtro PostgREST: letras,
// dígitos, punto y guion, 1-10 caracteres (cubre CEDEARs/ONs con sufijo tipo "BPOD" y ADRs con
// clase tipo "BRK.B"). Sin este chequeo, un ticker con "#"/"&"/"/" podía truncar un filtro
// PostgREST (?ticker=eq.X#... corta la query ahí) o inyectar parámetros/path en la URL de un
// proveedor — ver auditoría de backend.
export const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

// CIK de EDGAR: siempre 10 dígitos (con ceros a la izquierda, ver DEFAULT_CIK en _edgar.ts). Un
// ?cik= con otro formato no es un CIK real y, sin validar, se interpola tal cual en el path de la
// URL del proxy SEC (ver _edgar.ts fetchConcept) — mismo riesgo que un ticker sin validar.
export const CIK_RE = /^\d{10}$/;

// Los endpoints de analysis/*.ts arman el prompt de Gemini con un bloque "son solo datos, ignorá
// instrucciones" delimitado por <datos>...</datos> — pero el input es JSON.stringify() de campos
// de texto libre del usuario (notas, sector, etc.), que NO escapa "<"/">". Un valor con un
// "</datos>" literal cerraba el fence antes de tiempo y todo lo que viniera después se leía como
// instrucción real, no como dato. Reemplazar los ángulos por comillas simples angulares deja el
// JSON igual de legible para el modelo pero le saca la capacidad de simular una etiqueta.
export const escapeParaPrompt = (s: string): string => s.replace(/</g, '‹').replace(/>/g, '›');

// Parsea una lista "tickers=A,B,C" (o "ticker=A" single) y descarta cualquier valor que no matchee
// TICKER_RE — sin esto, un ticker con caracteres fuera de lo esperado llegaba tal cual a una URL de
// proveedor externo o a un filtro PostgREST (ver TICKER_RE, ver auditoría de backend).
export function parseTickers(url: URL, ...params: string[]): string[] {
  const raw = params.map(p => url.searchParams.get(p)).find(v => v) || '';
  return [...new Set(raw.toUpperCase().split(',').map(s => s.trim()).filter(s => TICKER_RE.test(s)))];
}

// Envuelve un handler exigiendo sesión válida. Devuelve 401 si no la hay.
export function authed(handler: (ctx: Ctx) => Promise<Response>): PagesFunction<Env> {
  return async (ctx) => {
    try {
      if (!(await usuarioAutenticado(ctx.env, ctx.request))) {
        return json({ error: 'no-autorizado', detail: 'Necesitás iniciar sesión.' }, 401);
      }
      return await handler(ctx);
    } catch (e) {
      return json({ error: 'function-error', detail: String(e) }, 500);
    }
  };
}

// Envuelve un handler GET: valida los secrets base de Supabase y convierte CUALQUIER excepción
// en un JSON 500 con detalle. Evita el error 1101 opaco de Cloudflare (Worker threw exception)
// cuando falta un secret (ej. fetch("undefined/rest/v1/...")) o cuando un proveedor externo cae.
export function guard(handler: (ctx: Ctx) => Promise<Response>): PagesFunction<Env> {
  return async (ctx) => {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = ctx.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      const faltan = [!SUPABASE_URL && 'SUPABASE_URL', !SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
      return json({ error: 'config-supabase', detail: `Faltan secrets en la Function: ${faltan.join(', ')}` }, 500);
    }
    try {
      return await handler(ctx);
    } catch (e) {
      return json({ error: 'function-error', detail: String(e) }, 500);
    }
  };
}

// guard() + sesión válida: para los endpoints que consumen cuota paga (mercado/fundamentals).
// Token INTERNO para que el cron pueda llamar a los endpoints protegidos sin configuración nueva.
// Se deriva de un secret que SIEMPRE existe en la Function (service-role; CRON_SECRET si está), y
// se envía el HASH, no la clave: filtrarlo no expone el secret. Sin esto, el refresco programado
// quedaba en 401 porque no tiene JWT de usuario (y CRON_SECRET puede no estar configurado).
export async function tokenInterno(env: Env): Promise<string> {
  const base = env.CRON_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base) return '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`refresh-interno:${base}`));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function guardAuth(handler: (ctx: Ctx) => Promise<Response>): PagesFunction<Env> {
  const inner = guard(handler);
  return async (ctx) => {
    // El cron (refresh-all) llama estos mismos endpoints server-side para calentar las caches sin
    // que la app esté abierta: no tiene JWT de usuario, así que se aceptan sus credenciales propias.
    // Esa vía queda fuera del chequeo de aprobación (es del sistema, no de un usuario puntual).
    const cronOk = !!ctx.env.CRON_SECRET && ctx.request.headers.get('X-Cron-Secret') === ctx.env.CRON_SECRET;
    const enviado = ctx.request.headers.get('X-Internal-Refresh') || '';
    const esperado = enviado ? await tokenInterno(ctx.env) : '';
    const internoOk = !!esperado && enviado === esperado;
    if (cronOk || internoOk) return inner(ctx);
    if (!(await usuarioAutenticado(ctx.env, ctx.request))) {
      return json({ error: 'no-autorizado', detail: 'Necesitás iniciar sesión.' }, 401);
    }
    // Cuenta recién auto-registrada, todavía sin aprobar: consulta cotizaciones/fundamentals de
    // pago igual que un usuario aprobado si solo se chequeara la sesión — bloquear acá.
    if (!(await usuarioAprobado(ctx.env, ctx.request))) {
      return json({ error: 'cuenta-pendiente', detail: 'Tu cuenta todavía no fue aprobada por un administrador.' }, 403);
    }
    return inner(ctx);
  };
}

// Para los endpoints de /api/cron/* (server-to-server, sin JWT de usuario): a diferencia de
// guardAuth (donde el chequeo de CRON_SECRET es solo UNA de varias formas válidas de autenticarse,
// con el JWT de usuario como alternativa), acá es la ÚNICA puerta — si CRON_SECRET no está
// configurado, el endpoint tiene que negarse a operar, no quedar abierto a cualquiera que conozca
// la URL. Antes, sin el secret seteado, estos 3 endpoints aceptaban cualquier request sin
// autenticación: escritura en cobros_pendientes de TODOS los portfolios, o proxy gratis a APIs
// pagas (debug-dividendos), a disposición de cualquiera en internet.
export function requireCronSecret(env: Env, request: Request): Response | null {
  if (!env.CRON_SECRET) {
    return json({ error: 'config-cron-secret', detail: 'CRON_SECRET no está configurado en esta Function — sin él, este endpoint no puede operar (quedaría abierto a cualquiera).' }, 500);
  }
  if (request.headers.get('X-Cron-Secret') !== env.CRON_SECRET) {
    return json({ error: 'no autorizado' }, 401);
  }
  return null;
}

// Como guard() pero sin exigir Supabase: solo atrapa excepciones y las devuelve como JSON 500
// (para endpoints que no dependen de Supabase, ej. análisis con Gemini).
export function safe(handler: (ctx: Ctx) => Promise<Response>): PagesFunction<Env> {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (e) {
      return json({ error: 'function-error', detail: String(e) }, 500);
    }
  };
}

// ── Supabase REST (service-role — bypasses RLS; server only) ─────────────────
// Exportado (no solo de uso interno acá): admin/_guard.ts y admin/users.ts lo reusan para llamar
// a la Admin Auth API de GoTrue (/auth/v1/admin/*), que se autentica igual que PostgREST — mismo
// service-role key como bearer token.
export function sbHeaders(env: Env, extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function sbSelect<T = unknown>(env: Env, table: string, query: string): Promise<T[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders(env) });
  if (!res.ok) return [];
  return res.json();
}

// Postgres rechaza el batch COMPLETO si dos filas del mismo INSERT ON CONFLICT chocan por la misma
// clave ("ON CONFLICT DO UPDATE command cannot affect row a second time") — no es un error parcial,
// tira abajo TODA la respuesta aunque el resto de las filas fueran válidas. Pasó en producción:
// /api/market/quotes con tickers duplicados (una posición partida en dos filas por broker) hizo que
// NINGÚN precio se guardara ni devolviera, para toda la cartera. Dedupear acá protege a todos los
// llamadores de una vez, no solo al que lo disparó.
export function dedupeByConflictKey(rows: unknown[], onConflict: string): unknown[] {
  const cols = onConflict.split(',').map(c => c.trim());
  const seen = new Map<string, unknown>();
  for (const row of rows) {
    const key = cols.map(c => String((row as Record<string, unknown>)[c])).join(' ');
    seen.set(key, row); // último gana — mismo criterio que "resolution=merge-duplicates"
  }
  return [...seen.values()];
}

export async function sbUpsert(env: Env, table: string, rows: unknown[], onConflict: string): Promise<void> {
  const deduped = dedupeByConflictKey(rows, onConflict);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: sbHeaders(env, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(deduped),
  });
  // Antes se ignoraba el resultado: una escritura rechazada (constraint/payload) se perdía en
  // silencio y el cache quedaba viejo sin ninguna señal. Ahora falla ruidoso.
  if (!res.ok) throw new Error(`sbUpsert ${table} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Llama una función Postgres (RPC) con la service-role key. Se usa cuando el upsert genérico de
// PostgREST no alcanza — ej. un ON CONFLICT contra un ÍNDICE PARCIAL (como cobros_cron_dedupe):
// PostgREST arma `on_conflict=col1,col2` sin poder repetir el WHERE del índice, y Postgres rechaza
// esa forma ("no unique or exclusion constraint matching"). La función del lado de la DB sí puede
// escribir el ON CONFLICT completo (ver 0012_cobros_pendientes.sql / insertar_cobro_pendiente_cron).
export async function sbRpc(env: Env, fn: string, args: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: sbHeaders(env), body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`sbRpc ${fn} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Generic cache: read one row; return it only if fresher than ttlMs.
export async function cacheFresh<T = { updated_at: string }>(
  env: Env, table: string, keyCol: string, keyVal: string, ttlMs: number,
): Promise<T | null> {
  const rows = await sbSelect<T & { updated_at: string }>(env, table, `${keyCol}=eq.${encodeURIComponent(keyVal)}&limit=1`);
  const row = rows[0];
  if (!row) return null;
  const age = Date.now() - Date.parse(row.updated_at);
  return age >= 0 && age < ttlMs ? (row as T) : null;
}

// Último valor cacheado IGNORANDO el TTL. Sirve de fallback cuando el proveedor externo cae:
// preferimos mostrar el último dato conocido (aunque esté viejo) antes que un campo vacío.
// Persistencia entre sesiones/días: un dato bueno de ayer no debe borrarse por un fallo de hoy.
// Tope de antigüedad del fallback: servir un precio de hace meses como si fuera el de hoy es peor
// que no tener dato (el usuario decide sobre un número falso). Pasado el tope devolvemos null.
export const MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

// Caché NEGATIVO: ¿el proveedor ya dijo "no tengo este dato" hace poco? Separado de cacheFresh (que
// mira `updated_at`, solo se toca en un HIT real) — evita volver a pegarle a una API paga por un
// ticker que sabemos que no tiene cobertura, sin pisar el último valor bueno conocido (`precio`/
// `beta` quedan intactos, cacheLast los sigue sirviendo de fallback). El caller marca un miss con
// un upsert PARCIAL (`sbUpsert(env, table, [{ [keyCol]: keyVal, miss_at: ... }], keyCol)`) — al no
// incluir las demás columnas, PostgREST con `resolution=merge-duplicates` no las toca.
export async function missReciente(
  env: Env, table: string, keyCol: string, keyVal: string, ttlMs: number,
): Promise<boolean> {
  const rows = await sbSelect<{ miss_at: string | null }>(env, table, `${keyCol}=eq.${encodeURIComponent(keyVal)}&select=miss_at&limit=1`);
  const missAt = rows[0]?.miss_at;
  if (!missAt) return false;
  const age = Date.now() - Date.parse(missAt);
  return age >= 0 && age < ttlMs;
}

export async function cacheLast<T = { updated_at: string }>(
  env: Env, table: string, keyCol: string, keyVal: string, maxAgeMs = MAX_STALE_MS,
): Promise<T | null> {
  const rows = await sbSelect<T & { updated_at?: string }>(env, table, `${keyCol}=eq.${encodeURIComponent(keyVal)}&limit=1`);
  const row = rows[0];
  if (!row) return null;
  const ts = row.updated_at ? Date.parse(row.updated_at) : NaN;
  if (Number.isFinite(ts) && Date.now() - ts > maxAgeMs) return null;  // demasiado viejo → sin dato
  return (row as T) ?? null;
}

// Timed fetch with a sane timeout + JSON parse.
export async function fetchJson<T = unknown>(url: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally { clearTimeout(t); }
}

export async function fetchText(url: string, init?: RequestInit, timeoutMs = 20_000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } finally { clearTimeout(t); }
}
