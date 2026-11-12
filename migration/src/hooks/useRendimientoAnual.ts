import { useMemo } from 'react';
import { usePosiciones, useQuotes, useFactorCedear } from './usePosiciones';
import { useAportes } from './useAportes';
import { useSnapshots } from './useSnapshots';
import { unitValueUSD as unitUSD } from '../lib/valuation';
import { rendimientoPorAnio } from '../engine/rendimiento';
import { flujosFirmados } from '../engine/aportes';
import type { AssetType } from '../types/domain';

export interface AllocItem { ticker: string; mkt: number; target: number | null; tipo: AssetType }

// Patrimonio/costo/alloc a valor de mercado — extraído TAL CUAL (mismo cálculo, mismas deps del
// useMemo) de lo que antes vivía inline en DashboardPage.tsx, para que cualquier pantalla que
// necesite el patrimonio actual lo pida ACÁ, nunca con su propia copia del cálculo (regla de oro #1).
export function usePortfolioPatrimonio(portfolioId: string | undefined) {
  const qPos = usePosiciones(portfolioId);
  const posiciones = qPos.data ?? [];
  const equity = posiciones.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker);
  const bonds = posiciones.filter(p => p.tipo === 'bono').map(p => p.ticker);
  const arStocks = posiciones.filter(p => p.tipo === 'accion_ar').map(p => p.ticker);
  const qQuotes = useQuotes(equity, bonds, arStocks);
  const quotes = qQuotes.data ?? {};
  const factor = useFactorCedear();
  const sinTickers = equity.length + bonds.length + arStocks.length === 0;

  const { patrimonio, costo, pnl, alloc, sinPrecio } = useMemo(() => {
    let patrimonio = 0, costo = 0;
    const parts: AllocItem[] = [];
    // Posiciones ABIERTAS con ticker cotizable que quedaron sin precio: se valúan a costo, así que
    // el patrimonio no es "de mercado". Hay que decirlo (y no grabar ese valor en el histórico).
    const sinPrecio: string[] = [];
    for (const p of posiciones) {
      const u = unitUSD(p, quotes[p.ticker] ?? null, factor);
      const mkt = u != null ? u * p.cantidad : p.precio_compra * p.cantidad;
      if (u == null && p.cantidad > 0 && p.tipo !== 'cash') sinPrecio.push(p.ticker);
      patrimonio += mkt;
      costo += p.precio_compra * p.cantidad;
      if (mkt > 0) parts.push({ ticker: p.ticker, mkt, target: p.peso_objetivo, tipo: p.tipo });
    }
    parts.sort((a, b) => b.mkt - a.mkt);
    return { patrimonio, costo, pnl: patrimonio - costo, alloc: parts, sinPrecio };
  }, [posiciones, quotes, factor]);

  // Separado en dos señales a propósito — "todavía no sabemos" (preciosPendientes) NO es lo mismo
  // que "sabemos que falta un precio" (sinPrecio.length > 0): mientras las cotizaciones están en
  // vuelo, `quotes` es `{}` y CADA posición cotizable cae en `sinPrecio` — sin distinguir esto, un
  // consumidor (ver AportesPage) mostraría "sin cotización de mercado" en TODA carga fría, aunque
  // después de un instante resuelva bien. `valuacionDeMercado` conserva el mismo valor de verdad que
  // antes (se usa para `datosListos` en DashboardPage.tsx, que no cambia).
  const preciosPendientes = !sinTickers && !(qQuotes.isSuccess && !qQuotes.isFetching);
  const valuacionDeMercado = !preciosPendientes && sinPrecio.length === 0;

  return { qPos, qQuotes, posiciones, quotes, sinTickers, preciosPendientes, valuacionDeMercado, patrimonio, costo, pnl, alloc, sinPrecio };
}

// Rendimiento por año calendario — mismo cálculo (mismas deps) que antes vivía inline en
// DashboardPage.tsx. Usado por el resumen del Dashboard Y por el detalle completo en Aportes: los
// dos consumen ESTE hook, nunca recalculan porAnio por su cuenta.
export function useRendimientoAnual(portfolioId: string | undefined) {
  const val = usePortfolioPatrimonio(portfolioId);
  const { qPos, posiciones, patrimonio, costo } = val;

  const qAportes = useAportes(portfolioId);
  const aportes = qAportes.data ?? [];
  const qSnaps = useSnapshots(portfolioId);
  const snaps = qSnaps.data ?? [];

  const hoy = new Date().toISOString().slice(0, 10);
  const anioActual = Number(hoy.slice(0, 4));

  // Capital aportado neto: aportes (aportes − retiros) si están cargados; si no, el costo de las
  // posiciones (mismo criterio que portfolioTir) para que el rendimiento se pueda calcular igual.
  // NO reemplazar por resumenAportes(aportes).neto (engine/aportes.ts, usado por la tarjeta "Aportes"
  // del Dashboard personalizable y por AportesPage): ese helper da 0 con la lista vacía a propósito —
  // acá el fallback a `costo` es necesario, porque el registro diario de snapshots (DashboardPage.tsx)
  // y la TIR no pueden calcularse con 0 aportado en un portfolio que sí tiene posiciones cargadas.
  const aportadoNeto = aportes.length ? flujosFirmados(aportes).reduce((s, f) => s + f.monto, 0) : costo;

  // Año de creación real (primer aporte o primera compra), para no atribuir mal el rendimiento.
  const inceptionYear = useMemo(() => {
    const fechas = [
      ...aportes.map(a => a.fecha),
      ...posiciones.map(p => p.fecha_compra).filter((f): f is string => !!f),
    ].filter(f => f && !Number.isNaN(Date.parse(f))).sort();
    return fechas.length ? Number(fechas[0].slice(0, 4)) : anioActual;
  }, [aportes, posiciones, anioActual]);

  // Serie de puntos = snapshots históricos + el valor de HOY en vivo (fresco).
  const porAnio = useMemo(() => {
    const puntos = [...snaps.filter(s => s.fecha !== hoy), { fecha: hoy, valor: patrimonio, aportado: aportadoNeto }];
    // Flujos fechados → el rendimiento del año usa Modified Dietz (pondera por tiempo invertido),
    // así un aporte grande a fin de año no distorsiona el %.
    const flujos = flujosFirmados(aportes.filter(a => a.fecha && !Number.isNaN(Date.parse(a.fecha))));
    return rendimientoPorAnio(puntos, inceptionYear, hoy, flujos);
  }, [snaps, hoy, patrimonio, aportadoNeto, inceptionYear, aportes]);

  // "Hay algo real para mostrar" — deliberadamente NO es "porAnio tiene algún año con rendimiento
  // no-nulo": ese criterio esconde el caso legítimo de un portfolio con posiciones/aportes viejos
  // pero sin snapshots todavía (todos los años dan null, y con ellos desaparecería también el
  // texto que explica por qué) — acá alcanza con que el portfolio haya tenido actividad alguna vez.
  // Un criterio ÚNICO, usado tanto por el resumen del Dashboard como por el detalle en Aportes, así
  // las dos pantallas ocultan/muestran la sección exactamente igual.
  const hayDatos = aportes.length > 0 || posiciones.length > 0;

  // Los inputs del cálculo (no la cotización de mercado, eso es `valuacionDeMercado`) todavía no
  // resolvieron — mientras tanto `aportadoNeto` puede estar usando su fallback a `costo` aunque el
  // portfolio SÍ tenga aportes reales cargados (todavía no llegaron), lo que da un "0.0%" transitorio
  // para el año en curso. Un consumidor que muestra el número como definitivo (ver AportesPage) debe
  // esperar a esto, no alcanza con que `porAnio` ya tenga algo.
  const cargando = !(qPos.isSuccess && qAportes.isSuccess && qSnaps.isSuccess);

  return { ...val, qAportes, qSnaps, aportes, snaps, hoy, anioActual, inceptionYear, aportadoNeto, porAnio, hayDatos, cargando };
}
