// Costo estimado de COMPRAR o VENDER (comisión + derechos de mercado + IVA, todo incluido), a partir de la tasa configurada en el broker.
// Puro y testeado (regla de oro #1). Sirve para tener el número ya calculado al registrar una operación; el dato real del boleto siempre lo pisa.
//
// Tasa general (cuando el broker NO tiene la suya cargada): 1 %, por decisión del usuario (conservadora: ningún tarifario encontrado para
// Santander/BBVA plan Black). Los brokers con dato propio la pisan: IOL 0,67 % (observado en tus órdenes en pesos, 2025-2026; la línea en
// dólares "D" sale ≈ 0,4 %) y BBVA 1,148 % (real de tus boletos del 14/08/2026: gastos de mercado 0,0605 % + comisión 0,8985 % + IVA 21 % sobre
// la comisión). Todas se editan por broker (Brokers → Costos por broker).

export const TASA_OPERACION_GENERAL = 0.01;

export interface BrokerOperacion { id: string; nombre: string; comision_operacion?: number | null }

export function tasaOperacion(broker: { comision_operacion?: number | null } | null | undefined): number {
  const t = Number(broker?.comision_operacion);
  return broker?.comision_operacion != null && Number.isFinite(t) && t >= 0 && t < 1 ? t : TASA_OPERACION_GENERAL;
}

// Comisión en USD de operar `monto` USD. Monto inválido o negativo → 0.
export function estimarComisionOperacion(monto: number, tasa: number): number {
  const m = Number.isFinite(monto) && monto > 0 ? monto : 0;
  const t = Number.isFinite(tasa) && tasa >= 0 ? tasa : TASA_OPERACION_GENERAL;
  return +(m * t).toFixed(2);
}

// Broker "principal" de una posición repartida: el que más cantidad tiene (null si no hay reparto).
export function brokerPrincipal(reparto: { brokerId: string; cantidad: number }[]): string | null {
  let mejor: { brokerId: string; cantidad: number } | null = null;
  for (const r of reparto) if (Number(r.cantidad) > 0 && (!mejor || Number(r.cantidad) > mejor.cantidad)) mejor = { brokerId: r.brokerId, cantidad: Number(r.cantidad) };
  return mejor?.brokerId ?? null;
}
