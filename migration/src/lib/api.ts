// Typed fetchers for the Pages Functions (all external data goes through them).
import type { Fundamentals } from '../types/domain';
import type { DividendoInfo } from '../engine/dividendProjection';
import { supabase } from './supabase';

// Las Functions exigen sesión (si no, cualquiera podría llamarlas y quemar cuota paga de
// Gemini/Finnhub). Adjuntamos el JWT del usuario en cada request.
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

// Para mutaciones del panel admin: igual que get(), pero con verbo/body y mensaje de error tomado
// del JSON de la Function ({detail} o {error}) en vez de un HTTP genérico — mismo criterio que
// useBrokers/usePosicionBrokers (throw con .message legible, el caller lo muestra tal cual).
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init?.headers as Record<string, string> | undefined) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string; error?: string }).detail ?? (data as { error?: string }).error ?? `${path} → HTTP ${res.status}`);
  return data as T;
}

export interface AdminUsuario {
  id: string; email: string; createdAt: string; lastSignInAt: string | null;
  banned: boolean; bannedUntil: string | null; emailConfirmed: boolean;
  isAdmin: boolean; isApproved: boolean; displayName: string | null; portfolioCount: number;
}
export interface AdminAuditEntry {
  id: string; action: string; actor_email: string | null; target_email: string | null;
  detalle: unknown; created_at: string;
}
export type AdminAccion = 'ban' | 'unban' | 'grant_admin' | 'revoke_admin' | 'approve' | 'revoke_approval';

export const api = {
  fundamentals: (ticker: string, cik?: string, fresh?: boolean) =>
    get<Fundamentals & { warning?: string; cached?: boolean }>(
      `/api/market/fundamentals?ticker=${encodeURIComponent(ticker)}${cik ? `&cik=${cik}` : ''}${fresh ? '&fresh=1' : ''}`),

  // Beta real de mercado (Finnhub/FMP, cacheado) — reemplaza el default fijo de 1.0 en WACC cuando
  // el usuario no cargó un beta manual en Análisis. beta:null si ningún proveedor lo tiene.
  beta: (ticker: string) => get<{ beta: number | null; fuente?: string; cached?: boolean }>(`/api/market/beta?ticker=${encodeURIComponent(ticker)}`),

  quotes: (tickers: string[]) =>
    get<Record<string, number | null>>(`/api/market/quotes?tickers=${tickers.map(encodeURIComponent).join(',')}`),

  fx: () => get<Record<string, number | null>>('/api/market/fx'),
  riesgoPais: () => get<{ riesgo_pais: number | null }>('/api/market/riesgo-pais'),
  fred: () => get<Record<string, number | null>>('/api/market/fred'),
  indicadores: () => get<Record<string, number | null>>('/api/market/indicadores'),
  // Distancia al máximo de 52s (drawdown) de S&P 500, oro y Merval.
  drawdowns: () => get<Record<string, { actual: number; max: number; dd: number } | null>>('/api/market/drawdowns'),
  status: () => get<{ precios: string | null; macro: string | null; fundamentals: string | null; last: string | null }>('/api/market/status'),
  bonos: () => get<Record<string, number>>('/api/market/bonos'),
  dividendos: (tickers: string[]) =>
    get<Record<string, DividendoInfo | null>>(`/api/market/dividendos?tickers=${tickers.map(encodeURIComponent).join(',')}`),
  accionesAr: (tickers: string[]) =>
    get<{ mep: number | null; precios: Record<string, number | null> }>(
      `/api/market/acciones-ar?tickers=${tickers.map(encodeURIComponent).join(',')}`),

  analisisEmpresa: (body: unknown) => postAnalisis('/api/analysis/empresa', body),
  analisisBono: (body: unknown) => postAnalisis('/api/analysis/bono', body),
  analisisPortfolio: (body: unknown) => postAnalisis('/api/analysis/portfolio', body),
  analisisMacro: (body: unknown) => postAnalisis('/api/analysis/macro', body),

  // ── Admin (requiere ser admin — la Function re-verifica siempre, esto no es la seguridad real) ──
  adminWhoAmI: () => get<{ isAdmin: boolean; isApproved: boolean }>('/api/admin/whoami'),
  adminUsers: () => get<{ users: AdminUsuario[]; total: number }>('/api/admin/users'),
  adminCrearUsuario: (body: { email: string; password: string; displayName?: string }) =>
    req<{ user: { id: string; email: string; displayName: string | null } }>('/api/admin/users', { method: 'POST', body: JSON.stringify(body) }),
  adminAccionUsuario: (id: string, action: AdminAccion) =>
    req<{ ok: true }>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) }),
  adminEliminarUsuario: (id: string) => req<{ ok: true }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
  adminAuditoria: () => get<{ entries: AdminAuditEntry[] }>('/api/admin/audit'),
};

// Nunca rechaza: devuelve {error} ante fallo de red/HTTP para que el botón no quede colgado.
async function postAnalisis(path: string, body: unknown): Promise<{ analisis?: string; error?: string; cached?: boolean }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (data as { error?: string }).error ?? `HTTP ${res.status}` };
    return data;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'red' };
  }
}
