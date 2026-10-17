// Traslado del costo de las órdenes cuando se transfiere una posición entre portfolios. Puro y testeado (regla de oro #1).
//
// Una transferencia es una reasignación del lote (conserva costo y fecha de compra), no una venta a mercado: el costo de adquirirlo
// (comisiones, derechos, IVA) viaja con él. Se traslada la fracción de las comisiones de las órdenes de COMPRA de esa posición igual a
// la fracción transferida (cantidad ÷ cantidad que tenía la posición): transferir todo mueve todo el costo; transferir la mitad, la mitad.
// El origen queda sin ese costo y el destino lo asume (retiro en el origen y aporte en el destino por el mismo monto, aporte bruto).

export interface OrdenParaTraslado {
  id: string; ticker: string; estado: string; origen?: string | null; lado?: string | null;
  comision_usd: number | null; comision_ars: number | null; mep: number | null;
}

// El CEDEAR en dólares ("MAD") y la ON en pesos ("CS51O") son la misma posición que "MA" / "CS51D".
export function mismaPosicion(tickerOrden: string, tickerPosicion: string): boolean {
  const o = tickerOrden.toUpperCase(), p = tickerPosicion.toUpperCase();
  if (o === p) return true;
  if (o === `${p}D`) return true;
  if (p.endsWith('D') && o === `${p.slice(0, -1)}O`) return true;
  return false;
}

const n = (x: unknown) => (x == null ? 0 : Number(x) || 0);
const r2 = (x: number) => +x.toFixed(2);

export interface PlanTraslado {
  fraccion: number;                                   // 0..1
  totalUsd: number;                                   // costo que viaja (USD; los $ con MEP convertidos)
  arsSinMep: number;                                  // parte en pesos sin MEP: viaja pero no se puede convertir
  origen: { id: string; comision_usd: number | null; comision_ars: number | null }[];   // valores NUEVOS de cada orden del origen
}

export function planTrasladoCosto(ordenes: OrdenParaTraslado[], tickerPosicion: string, cantidad: number, cantidadPosicion: number): PlanTraslado {
  const f = cantidadPosicion > 0 ? Math.min(Math.max(cantidad / cantidadPosicion, 0), 1) : 0;
  const origen: PlanTraslado['origen'] = [];
  let total = 0, arsSin = 0;
  for (const o of ordenes) {
    if (o.estado !== 'terminada' || (o.lado ?? 'compra') !== 'compra' || !mismaPosicion(o.ticker, tickerPosicion)) continue;
    const cu = n(o.comision_usd), ca = n(o.comision_ars), mep = n(o.mep);
    if (cu === 0 && ca === 0) continue;
    total += (cu + (mep > 0 ? ca / mep : 0)) * f;
    if (ca > 0 && !(mep > 0)) arsSin += ca * f;
    origen.push({ id: o.id, comision_usd: o.comision_usd == null ? null : r2(cu * (1 - f)), comision_ars: o.comision_ars == null ? null : r2(ca * (1 - f)) });
  }
  return { fraccion: f, totalUsd: r2(total), arsSinMep: r2(arsSin), origen };
}
