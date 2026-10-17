import { useMemo } from 'react';
import { useRendimientoAnual } from './useRendimientoAnual';
import { useSp500 } from './useSp500';
import { useOrdenesEjecutadas } from './useOrdenesEjecutadas';
import { useCobros } from './useCobros';
import { useMovimientos } from './usePosiciones';
import { flujosFirmados } from '../engine/aportes';
import { cobrosSinAcreditar, pnlTotal as calcularPnlTotal, realizedPnl } from '../engine/pnl';
import { calcularDesempeno, puentePnl } from '../engine/desempeno';

// Desempeño de un portfolio (rentabilidad, contra el S&P 500, máxima caída, costos): junta los datos reales y delega TODO el cálculo
// en engine/desempeno.ts. La pantalla solo presenta lo que devuelve (regla de oro #1).
export function useDesempeno(portfolioId: string | undefined) {
  const r = useRendimientoAnual(portfolioId);
  const { snaps, aportes, patrimonio, hoy, cargando, valuacionDeMercado } = r;
  const { data: ordenes = [] } = useOrdenesEjecutadas(portfolioId);
  const { data: cobros = [] } = useCobros(portfolioId);
  const sinAcreditar = useMemo(() => cobrosSinAcreditar(cobros), [cobros]);

  // El MISMO "P&L total" que muestra Inicio (engine/pnl.ts) y el puente que lo relaciona con la Ganancia de Desempeño.
  const { data: movs = [] } = useMovimientos(portfolioId);
  const pnlInicio = useMemo(() => calcularPnlTotal(r.pnl, realizedPnl(movs).total, cobros).total, [r.pnl, movs, cobros]);

  const flujos = useMemo(() => flujosFirmados(aportes.filter(a => a.fecha && !Number.isNaN(Date.parse(a.fecha)))), [aportes]);
  const listo = !cargando && valuacionDeMercado;

  // Punto de hoy en vivo (si la valuación está completa) + el histórico grabado.
  const puntos = useMemo(() => [
    ...snaps.filter(s => s.fecha !== hoy).map(s => ({ fecha: s.fecha, valor: s.valor })),
    ...(listo && patrimonio > 0 ? [{ fecha: hoy, valor: patrimonio }] : []),
  ], [snaps, hoy, patrimonio, listo]);
  const primero = useMemo(() => [...puntos, ...flujos].map(x => x.fecha).sort()[0] ?? null, [puntos, flujos]);
  const { data: sp, isError: spError } = useSp500(primero ? new Date(Date.parse(primero) - 7 * 86_400_000).toISOString().slice(0, 10) : undefined);

  const d = useMemo(() => calcularDesempeno({
    puntos, flujos, valorActual: patrimonio, hoy, serieSp: sp?.puntos ?? null, ordenes,
  }), [puntos, flujos, patrimonio, hoy, sp, ordenes]);

  const primerFlujo = useMemo(() => flujos.filter(f => f.monto !== 0).map(f => f.fecha).sort()[0] ?? null, [flujos]);

  return { d, listo, primerFlujo, spError, flujos, patrimonio, hoy, snaps, posiciones: r.posiciones, qSnaps: r.qSnaps, qPos: r.qPos, sinAcreditar, hayPuntos: puntos.length >= 2, porAnio: r.porAnio,
    puente: puentePnl({ gananciaVentana: d.tir.gananciaUsd, valor: patrimonio, aportadoNeto: flujos.reduce((s, f) => s + f.monto, 0), pnlTotal: pnlInicio }) };
}
