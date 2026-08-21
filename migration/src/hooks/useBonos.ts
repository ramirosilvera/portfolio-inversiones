import { useEffect, useState } from 'react';
import { usePosiciones, useQuotes } from './usePosiciones';
import { calcularBono, type BonoCalc } from '../engine/bonos';

export type { BonoCalc } from '../engine/bonos';
export { resumenBonos, alertasBonos, type ResumenBonos } from '../engine/bonos';

// Cálculo compartido por bono (capital, mercado, TIR, duración, rating) — usado tanto por la
// tabla+gráfico de BonosPage como por el resumen del Dashboard, así nunca se desincronizan entre sí
// (mismo criterio que useRadarTicker para Radar/Dashboard). El cálculo en sí (calcularBono) es puro
// y vive en engine/bonos.ts — acá solo se resuelve el fetch (posiciones + cotizaciones).
export function useBonosCalc(portfolioId: string | undefined) {
  const { data: posiciones = [], isLoading } = usePosiciones(portfolioId);
  const bonos = posiciones.filter(p => p.tipo === 'bono');
  const { data: quotes = {} } = useQuotes([], bonos.map(b => b.ticker));
  const hoy = new Date().toISOString().slice(0, 10);

  const bonosCalc: BonoCalc[] = bonos.map(b => calcularBono(b, quotes[b.ticker] ?? null, hoy));

  return { bonos, bonosCalc, isLoading };
}

// Umbrales personales de alerta de bonos (no afectan cálculos, solo cuándo avisar) — persistidos
// en localStorage por portfolio, igual que el patrón de usePrefs.ts. Compartido entre BonosPage y
// el resumen del Dashboard para que muestren siempre el mismo umbral.
export const DEFAULT_MIN_GRADO_INVERSION_PCT = 50;  // % mínimo del capital en bonos que querés en grado de inversión
export const DEFAULT_MAX_DURACION_ANIOS = 4;        // duración promedio máxima aceptable (años)
// % MÍNIMO del capital en bonos que querés bajo ley extranjera (no máximo): ley extranjera es más
// segura (jurisdicción de cobro fuera de Argentina) pero rinde menos que ley local — el umbral avisa
// si te quedaste con MUY POCA cobertura "segura", no si tenés demasiada. Ver alertasBonos().
export const DEFAULT_MIN_LEY_EXTRANJERA_PCT = 60;

export function useObjetivoDuracion(portfolioId: string | undefined) {
  const key = portfolioId ? `bonos.objetivoDuracion.${portfolioId}` : null;
  const [minGradoInversionPct, setMinGradoState] = useState(DEFAULT_MIN_GRADO_INVERSION_PCT);
  const [maxDuracionAnios, setMaxDuracionState] = useState(DEFAULT_MAX_DURACION_ANIOS);
  const [minLeyExtranjeraPct, setMinLeyExtranjeraState] = useState(DEFAULT_MIN_LEY_EXTRANJERA_PCT);

  useEffect(() => {
    let g = DEFAULT_MIN_GRADO_INVERSION_PCT, d = DEFAULT_MAX_DURACION_ANIOS, l = DEFAULT_MIN_LEY_EXTRANJERA_PCT;
    try {
      const raw = key ? localStorage.getItem(key) : null;
      if (raw) {
        const o = JSON.parse(raw);
        if (Number.isFinite(o.minGradoInversionPct) && o.minGradoInversionPct >= 0 && o.minGradoInversionPct <= 100) g = o.minGradoInversionPct;
        if (Number.isFinite(o.maxDuracionAnios) && o.maxDuracionAnios > 0) d = o.maxDuracionAnios;
        // "minLeyExtranjeraPct" es la key nueva (umbral MÍNIMO, ver comentario arriba) — la key vieja
        // "maxLeyExtranjeraPct" (umbral MÁXIMO, alertaba en sentido contrario) se ignora a propósito:
        // no tiene el mismo significado, así que no corresponde migrarla, solo dejarla obsoleta.
        if (Number.isFinite(o.minLeyExtranjeraPct) && o.minLeyExtranjeraPct >= 0 && o.minLeyExtranjeraPct <= 100) l = o.minLeyExtranjeraPct;
      }
    } catch { /* */ }
    setMinGradoState(g); setMaxDuracionState(d); setMinLeyExtranjeraState(l);
  }, [key]);

  const persist = (g: number, d: number, l: number) => {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ minGradoInversionPct: g, maxDuracionAnios: d, minLeyExtranjeraPct: l })); } catch { /* */ }
  };
  return {
    minGradoInversionPct, maxDuracionAnios, minLeyExtranjeraPct,
    setMinGradoInversionPct: (g: number) => { setMinGradoState(g); persist(g, maxDuracionAnios, minLeyExtranjeraPct); },
    setMaxDuracionAnios: (d: number) => { setMaxDuracionState(d); persist(minGradoInversionPct, d, minLeyExtranjeraPct); },
    setMinLeyExtranjeraPct: (l: number) => { setMinLeyExtranjeraState(l); persist(minGradoInversionPct, maxDuracionAnios, l); },
  };
}
