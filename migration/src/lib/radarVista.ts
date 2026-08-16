// Toggle renta variable/fija de Radar — compartido entre RadarPage.tsx (la página completa) y el
// resumen de Radar en el Dashboard (DashboardPage.tsx → RadarResumenCombinado), para que cambiar de
// vista en un lugar se recuerde en el otro (misma key de localStorage).
export type Vista = 'variable' | 'fija';
export const VISTA_KEY = 'radar_vista';

export function vistaInicial(): Vista {
  try { return localStorage.getItem(VISTA_KEY) === 'fija' ? 'fija' : 'variable'; } catch { return 'variable'; }
}

export function guardarVista(v: Vista): void {
  try { localStorage.setItem(VISTA_KEY, v); } catch { /* localStorage puede fallar en privado/cuota — no es crítico */ }
}
