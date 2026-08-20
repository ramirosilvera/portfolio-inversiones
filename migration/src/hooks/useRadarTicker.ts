import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useQuotes } from './usePosiciones';
import { computeRatios } from '../engine/ratios';
import { computeDcf, dcfDefaultsFor, esCompraAgresiva, type DcfResult } from '../engine/dcf';
import { computeScore, type ScoreResult } from '../engine/score';
import type { StoredDcf } from './useDcfInputs';
import type { Fundamentals, Ratios } from '../types/domain';

export interface RadarTickerData {
  price: number | null;
  ratios: Ratios | null;
  dcf: DcfResult | null;
  score: ScoreResult | null;
  agresiva: boolean;
  isFetching: boolean;  // fundamentals en vuelo
  isError: boolean;     // fundamentals falló y ya se agotaron los reintentos
}

// Cálculo por ticker compartido entre RadarPage (una fila por ticker) y el resumen del Dashboard —
// un solo lugar para que el criterio de "compra agresiva" y el fetch de fundamentals/cotización no
// se desincronicen entre las dos pantallas.
export function useRadarTicker(
  ticker: string, cik: string | undefined, cikLoading: boolean, riskFree: number, saved?: StoredDcf,
): RadarTickerData {
  const T = ticker.toUpperCase();
  const { data: fund, isFetching, isError } = useQuery({
    queryKey: ['fundamentals', T, cik ?? ''],
    // Se pide igual sin CIK local: el servidor intenta resolverlo solo (cache global, cik_map propio,
    // FMP) antes de rendirse — ver resolverCikAutomatico en fundamentals.ts. Antes esto se cortaba
    // acá mismo para cualquier ticker fuera de las ~70 empresas hardcodeadas, sin darle chance al
    // servidor de resolverlo.
    enabled: !cikLoading,
    queryFn: () => api.fundamentals(T, cik),
    staleTime: 12 * 60 * 60_000,
    // Un 502/503 transitorio del proxy de EDGAR (o de Finnhub/FMP) no debe quedar "atascado" hasta
    // que el usuario recargue la página a mano — antes era retry:false, así que UN solo fallo de
    // red podía tardar horas en autocorregirse (caso real: NVDA). Reintenta con backoff acá mismo.
    retry: 2,
  });
  const { data: quotes = {} } = useQuotes([T]);
  const price = quotes[T] ?? null;

  // Beta real de mercado (Finnhub/FMP) si no hay un override manual guardado en Análisis — antes
  // WACC siempre usaba 1.0 fijo acá, que no dice nada de la volatilidad real de la empresa.
  const { data: betaFetched } = useQuery({
    queryKey: ['beta', T],
    enabled: saved?.beta == null,
    queryFn: () => api.beta(T),
    staleTime: 24 * 60 * 60_000,
  });

  const { ratios, dcf, score } = useMemo(() => {
    if (!fund || (fund as { error?: string }).error) return { ratios: null, dcf: null, score: null };
    const f = fund as Fundamentals;
    // Prioridad: override manual del usuario (Análisis) > beta real de mercado > 1.0 como último
    // recurso (ticker que ningún proveedor cubre). Si el usuario guardó supuestos completos para
    // este ticker, se usan íntegros — así el score refleja SU valuación, no otra base en silencio.
    const beta = saved?.beta ?? betaFetched?.beta ?? 1.0;
    const r = computeRatios(f, price, beta, riskFree);
    const inputs = saved ?? dcfDefaultsFor(r);
    const d = computeDcf(f, price, r.wacc, inputs, r.roic);
    const s = computeScore({
      marginOfSafety: d.marginOfSafety, roic: r.roic, wacc: r.wacc,
      operatingMargin: r.operatingMargin, debtToEquity: r.debtToEquity, eg5y: r.eg5y,
    });
    return { ratios: r, dcf: d, score: s };
  }, [fund, price, riskFree, saved, betaFetched]);

  return { price, ratios, dcf, score, agresiva: dcf ? esCompraAgresiva(dcf) : false, isFetching, isError };
}
