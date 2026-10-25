import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { api } from '../lib/api';
import { computeRatios } from '../engine/ratios';
import { computeDcf } from '../engine/dcf';
import { margenSeguridadCedears, type MargenCartera } from '../engine/margenSeguridad';
import { useCikMap } from './useCikMap';
import type { Fundamentals } from '../types/domain';
import { usePosiciones, useQuotes, useDividendosProyectados, useMacro } from './usePosiciones';
import { calcularCedear, type CedearCalc } from '../engine/cedears';
import { rendimientoDividendos, tickersConCobroReciente, type RendDividendos } from '../engine/dividendYield';
import { useCobros } from './useCobros';
import { useDcfInputs } from './useDcfInputs';
import { tasaDescuentoCedears, type TasaDescuentoCartera } from '../engine/tasaDescuento';

export type { CedearCalc } from '../engine/cedears';
export { resumenCedears, type ResumenCedears, alertasCedears } from '../engine/cedears';
export type { RendDividendos, RendDividendosPosicion } from '../engine/dividendYield';
export type { MargenCartera, MargenPosicion } from '../engine/margenSeguridad';
export type { TasaDescuentoCartera, TasaDescuentoPosicion } from '../engine/tasaDescuento';

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

// Rendimiento por dividendos de los CEDEARs (dividendo anualizado ÷ valor de mercado): mismo cálculo en Inicio y en /cedears.
// `data` es null mientras llega el calendario de dividendos (no se muestra un 0 % provisorio); `error` si el proveedor falló.
export function useRendimientoDividendos(cedearsCalc: CedearCalc[]): { data: RendDividendos | null; isLoading: boolean; isError: boolean } {
  const { data: info, isLoading, isError } = useDividendosProyectados(cedearsCalc.map(c => c.pos.ticker));
  // Los cobros reales de dividendos contradicen un «no paga» del proveedor (mismo query que la tarjeta de Cobros: sin pedido extra).
  const { data: cobros } = useCobros(cedearsCalc[0]?.pos.portfolio_id);
  if (!info) return { data: null, isLoading, isError };
  const conCobro = tickersConCobroReciente(cobros, new Date().toISOString().slice(0, 10));
  return { data: rendimientoDividendos(cedearsCalc, info, conCobro), isLoading: false, isError: false };
}

// Tasa de descuento (d) guardada en el Radar para cada CEDEAR y ponderada por capital: mismo cálculo en Inicio, /cedears y la tarjeta suelta.
export function useTasaDescuentoCedears(cedearsCalc: CedearCalc[]): { data: TasaDescuentoCartera; isLoading: boolean } {
  const { map, isLoading } = useDcfInputs();
  return { data: tasaDescuentoCedears(cedearsCalc, map), isLoading };
}

// Margen de seguridad del DCF de cada CEDEAR con los supuestos que GUARDASTE en el Radar, ponderado por capital. Mismas queries
// (fundamentals, beta, cotización) y mismo cálculo que useRadarTicker, así el margen coincide con el del Radar/Análisis y no
// se vuelve a pedir nada si ya está en caché. Solo entran los tickers con supuestos guardados (su valuación, no una base en silencio).
export function useMargenSeguridadCedears(cedearsCalc: CedearCalc[]): { data: MargenCartera; isLoading: boolean } {
  const { map: dcfMap, isLoading: dcfLoading } = useDcfInputs();
  const { map: cikMap, isLoading: cikLoading } = useCikMap();
  const { data: macro = {} } = useMacro();
  const riskFree = ((macro as Record<string, number | null>).dgs10 ?? 4.3) / 100;
  const tickers = [...new Set(cedearsCalc.map(c => c.pos.ticker.toUpperCase()))].filter(t => dcfMap.has(t));
  const { data: quotes = {} } = useQuotes(tickers);

  const fund = useQueries({
    queries: tickers.map(T => {
      const cik = cikMap.get(T)?.cik;
      return {
        queryKey: ['fundamentals', T, cik ?? ''],
        enabled: !cikLoading,
        queryFn: () => api.fundamentals(T, cik),
        staleTime: 12 * 60 * 60_000,
        retry: 2,
      };
    }),
  });
  const betas = useQueries({
    queries: tickers.map(T => ({
      queryKey: ['beta', T],
      enabled: dcfMap.get(T)?.beta == null,
      queryFn: () => api.beta(T),
      staleTime: 24 * 60 * 60_000,
    })),
  });

  const enVuelo = dcfLoading || cikLoading || fund.some(q => q.isLoading) || betas.some(q => q.isLoading);
  const huella = fund.map(q => q.dataUpdatedAt).join(',') + '|' + betas.map(q => q.dataUpdatedAt).join(',');
  const margenes = useMemo(() => {
    const m = new Map<string, number | null>();
    tickers.forEach((T, i) => {
      const f = fund[i]?.data as (Fundamentals & { error?: string }) | undefined;
      const saved = dcfMap.get(T);
      const price = quotes[T] ?? null;
      if (!f || f.error || !saved || price == null) { m.set(T, null); return; }
      const beta = saved.beta ?? (betas[i]?.data as { beta?: number } | undefined)?.beta ?? 1.0;
      const r = computeRatios(f, price, beta, riskFree);
      m.set(T, computeDcf(f, price, r.wacc, saved, r.roic).marginOfSafety);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(','), huella, dcfMap, quotes, riskFree]);

  return { data: margenSeguridadCedears(cedearsCalc, margenes), isLoading: enVuelo };
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
