import { useMemo } from 'react';
import { useBrokers } from './useBrokers';
import { usePosicionBrokers } from './usePosicionBrokers';
import { tasasParaCobro, type TasasCobro, type TipoCobroCosto } from '../engine/costosCobros';

// Tasas de costos (retención, comisión depositaria, comisión del broker) para un cobro de una posición, según en qué brokers está
// repartida y lo que cada uno tiene configurado en Brokers. Sin reparto o sin configuración: las generales.
export function useTasasCobro() {
  const { data: brokers } = useBrokers();
  const { data: asignaciones } = usePosicionBrokers();
  return useMemo(() => (posicionId: string | null | undefined, tipo: TipoCobroCosto): TasasCobro => {
    const reparto = (posicionId ? asignaciones.filter(a => a.posicion_id === posicionId) : [])
      .map(a => ({ cantidad: a.cantidad, broker: brokers.find(b => b.id === a.broker_id) ?? null }));
    return tasasParaCobro(tipo, reparto);
  }, [brokers, asignaciones]);
}
