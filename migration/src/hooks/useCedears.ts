import { useEffect, useState } from 'react';
import { usePosiciones, useQuotes } from './usePosiciones';
import { calcularCedear, type CedearCalc } from '../engine/cedears';

export type { CedearCalc } from '../engine/cedears';
export { resumenCedears, type ResumenCedears, alertasCedears } from '../engine/cedears';

// Cálculo compartido por CEDEAR (valor de mercado, sector, rol) — mismo criterio que
// useBonosCalc/useRadarTicker: el fetch vive acá, el cálculo puro vive en engine/cedears.ts.
export function useCedearsCalc(portfolioId: string | undefined) {
  const { data: posiciones = [], isLoading } = usePosiciones(portfolioId);
  // Mismo fix que useBonosCalc: al vender todo, la fila queda en cantidad 0 pero no se borra sola —
  // sin este filtro un CEDEAR totalmente vendido seguía apareciendo para siempre acá y en el resumen
  // del Dashboard. Se puede borrar de verdad desde /posiciones (mostrar cerradas → Borrar).
  const cedears = posiciones.filter(p => p.tipo === 'cedear' && (Number(p.cantidad) || 0) > 0);
  const { data: quotes = {} } = useQuotes(cedears.map(c => c.ticker), [], []);

  const cedearsCalc: CedearCalc[] = cedears.map(c => calcularCedear(c, quotes[c.ticker] ?? null));

  return { cedears, cedearsCalc, isLoading };
}

// Umbrales PERSONALES de alerta de concentración (sector / estilo Peter Lynch), persistidos en
// localStorage por portfolio — mismo patrón que useObjetivoDuracion (Bonos). Compartido entre
// CedearsPage y el resumen del Dashboard para que nunca muestren un umbral distinto.
export const DEFAULT_CONCENTRACION_SECTOR_PCT = 40;
export const DEFAULT_CONCENTRACION_ESTILO_PCT = 40;

export function useObjetivoConcentracion(portfolioId: string | undefined) {
  const key = portfolioId ? `cedears.objetivoConcentracion.${portfolioId}` : null;
  const [sectorPct, setSectorState] = useState(DEFAULT_CONCENTRACION_SECTOR_PCT);
  const [estiloPct, setEstiloState] = useState(DEFAULT_CONCENTRACION_ESTILO_PCT);

  useEffect(() => {
    let s = DEFAULT_CONCENTRACION_SECTOR_PCT, e = DEFAULT_CONCENTRACION_ESTILO_PCT;
    try {
      const raw = key ? localStorage.getItem(key) : null;
      if (raw) {
        const o = JSON.parse(raw);
        if (Number.isFinite(o.sectorPct) && o.sectorPct >= 0 && o.sectorPct <= 100) s = o.sectorPct;
        if (Number.isFinite(o.estiloPct) && o.estiloPct >= 0 && o.estiloPct <= 100) e = o.estiloPct;
      }
    } catch { /* */ }
    setSectorState(s); setEstiloState(e);
  }, [key]);

  const persist = (s: number, e: number) => {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ sectorPct: s, estiloPct: e })); } catch { /* */ }
  };
  return {
    sectorPct, estiloPct,
    setSectorPct: (s: number) => { setSectorState(s); persist(s, estiloPct); },
    setEstiloPct: (e: number) => { setEstiloState(e); persist(sectorPct, e); },
  };
}
