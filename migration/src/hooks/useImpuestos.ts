import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { usePortfolios } from './usePortfolios';
import { useAllPosiciones, useQuotes, useMacro } from './usePosiciones';
import { unitValueUSD } from '../lib/valuation';
import {
  paramsBP, patrimonioImponible, evaluarBienesPersonales, gananciasPorAnio, proximaDDJJ, alertasImpuestos,
} from '../engine/impuestos';
import type { Cobro } from '../types/domain';

// Impuestos de los portfolios activos, JUNTOS (la persona es una sola: Bienes Personales y Ganancias se miden sobre el total, no por portfolio).
// Solo lectura; todo el cálculo vive en engine/impuestos.ts (regla de oro #1).
export function useImpuestos() {
  const { session } = useAuth();
  const { portfolios } = usePortfolios();
  const { data: allPos = [], isLoading: cargandoPos } = useAllPosiciones(true);
  const { data: macro = {} } = useMacro();

  // RLS aísla por usuario, no por estado: se filtran los portfolios archivados (igual que Consolidado).
  const activeIds = useMemo(() => new Set(portfolios.map(p => p.id)), [portfolios]);
  const posiciones = useMemo(() => allPos.filter(p => activeIds.has(p.portfolio_id)), [allPos, activeIds]);

  const equity = [...new Set(posiciones.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker))];
  const bonds = [...new Set(posiciones.filter(p => p.tipo === 'bono').map(p => p.ticker))];
  const arStocks = [...new Set(posiciones.filter(p => p.tipo === 'accion_ar').map(p => p.ticker))];
  const qQuotes = useQuotes(equity, bonds, arStocks);
  const quotes = qQuotes.data ?? {};

  const { data: cobrosAll = [], isLoading: cargandoCobros } = useQuery({
    queryKey: ['cobros', 'all', session?.user.id ?? 'anon'],
    enabled: !!session,
    queryFn: async (): Promise<Cobro[]> => {
      const { data, error } = await supabase.from('cobros').select('*').order('fecha', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const cobros = useMemo(() => cobrosAll.filter(c => activeIds.has(c.portfolio_id)), [cobrosAll, activeIds]);

  const hoy = new Date().toISOString().slice(0, 10);
  const anioActual = Number(hoy.slice(0, 4));
  const m = macro as Record<string, number | null>;
  const mep = m.dolar_mep ?? m.dolar_ccl ?? null;

  return useMemo(() => {
    // Mismo criterio de valuación que Consolidado/Patrimonio: mercado si hay precio, costo si no (y se avisa).
    const porPortfolio = new Map<string, number>();
    const sinPrecio: string[] = [];
    const items = posiciones.map(p => {
      const u = unitValueUSD(p, quotes[p.ticker] ?? null);
      if (u == null && p.cantidad > 0 && p.tipo !== 'cash') sinPrecio.push(p.ticker);
      const valorUsd = u != null ? u * p.cantidad : p.precio_compra * p.cantidad;
      porPortfolio.set(p.portfolio_id, (porPortfolio.get(p.portfolio_id) ?? 0) + valorUsd);
      return { tipo: p.tipo, valorUsd };
    });
    const patrimonio = patrimonioImponible(items);
    const params = paramsBP(anioActual);
    const bp = params && mep ? evaluarBienesPersonales(patrimonio.total, mep, params) : null;
    const bpProbable = params && mep ? evaluarBienesPersonales(patrimonio.probable, mep, params) : null;
    const ganancias = gananciasPorAnio(cobros);
    const ddjj = proximaDDJJ(hoy);
    const dividendosAnioFiscal = ganancias.find(g => g.anio === ddjj.anioFiscal)?.dividendosBruto ?? 0;
    const alertas = alertasImpuestos({ bp, bpEstimado: params?.estimado ?? false, ddjj, dividendosAnioFiscal });
    return {
      portfolios, porPortfolio, patrimonio, params, bp, bpProbable, ganancias, ddjj, dividendosAnioFiscal, alertas,
      mep, hoy, anioActual, sinPrecio,
      cargando: cargandoPos || cargandoCobros || qQuotes.isLoading,
      preciosPendientes: qQuotes.isFetching && Object.keys(quotes).length === 0,
    };
  }, [posiciones, quotes, cobros, mep, hoy, anioActual, portfolios, cargandoPos, cargandoCobros, qQuotes.isLoading, qQuotes.isFetching]);
}
