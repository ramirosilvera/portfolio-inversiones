// =============================================================================
// Aritmética de tenencia: costo promedio ponderado al comprar y reconstrucción de la posición
// desde su historial de movimientos. Puro y testeable — antes vivía suelta dentro del hook, que
// es justo la lógica que define el COSTO BASE (y con él el P&L de toda la app).
// Convención: la venta descuenta cantidad pero NO cambia el costo promedio.
// =============================================================================

export interface MovimientoLike {
  tipo: 'compra' | 'venta' | 'ajuste';
  cantidad: number;
  precio: number;
  fecha?: string;
}

export interface Tenencia { cantidad: number; costoPromedio: number }

// Consolidación al comprar: costo promedio ponderado entre lo que había y lo que se agrega.
export function consolidarCompra(actual: Tenencia, addQty: number, addPrice: number): Tenencia {
  const q = Number(addQty) || 0, px = Number(addPrice) || 0;
  const oldQty = Number(actual.cantidad) || 0, oldPx = Number(actual.costoPromedio) || 0;
  if (!(q > 0)) return { cantidad: oldQty, costoPromedio: oldPx };  // una compra no puede restar
  const nueva = oldQty + q;
  return { cantidad: nueva, costoPromedio: nueva > 0 ? (oldQty * oldPx + q * px) / nueva : oldPx };
}

// Reconstruye cantidad y costo promedio desde CERO recorriendo los movimientos en orden. Se usa al
// borrar un movimiento mal cargado: la posición se recalcula desde lo que queda.
export function reconstruirTenencia(movs: MovimientoLike[]): Tenencia {
  let t: Tenencia = { cantidad: 0, costoPromedio: 0 };
  for (const m of movs) {
    const q = Number(m.cantidad) || 0, px = Number(m.precio) || 0;
    if (m.tipo === 'venta') { t = { cantidad: Math.max(0, t.cantidad - q), costoPromedio: t.costoPromedio }; continue; }
    // 'ajuste' (split, amortización de capital, corrección): cambia la cantidad SIN tocar el costo
    // promedio — igual criterio que realizedPnl (engine/pnl.ts). Antes caía en la rama de "compra"
    // de acá abajo y el costo promedio se recalculaba mezclado con el precio del ajuste (a veces 0,
    // por ejemplo en una amortización): un movimiento borrado y reconstruido daba OTRO costo base
    // que el que tenía antes de borrarlo.
    if (m.tipo === 'ajuste') { t = { cantidad: Math.max(0, t.cantidad + q), costoPromedio: t.costoPromedio }; continue; }
    t = consolidarCompra(t, q, px);
  }
  return t;
}

const EPS = 1e-6;
const diaAntes = (iso: string) => new Date(Date.parse(iso + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);

// Movimiento que hay que agregar al historial para que reconstruirTenencia() vuelva a dar la
// posición ACTUAL — o null si ya cuadra. Existe porque varias escrituras cambian `posiciones` sin
// dejar movimiento (posiciones cargadas antes de que existiera el historial, una edición manual de
// cantidad, la transferencia entre portfolios antes de la migración 0049): ahí el historial queda
// "corto" o "largo", y borrar CUALQUIER movimiento después reconstruía la posición desde ese
// historial incompleto — dejaba unidades de menos (o de más), sin aviso.
//  - Historial corto (falta cantidad): una COMPRA base fechada antes del primer movimiento, a un
//    precio despejado para que el costo promedio reconstruido coincida con el actual. Como el costo
//    final es afín en ese precio (las ventas/ajustes no tocan el promedio), alcanza con evaluar dos
//    precios y despejar. Si no se puede despejar (la base se vendió entera antes de la próxima
//    compra, o el despeje da negativo por datos inconsistentes), se usa el costo actual — mismo
//    criterio que la vieja "carga inicial" de sell().
//  - Historial largo (sobra cantidad): un AJUSTE negativo fechado hoy (no realiza P&L, igual que
//    una transferencia: no es una venta).
// `movs` en orden cronológico (fecha, created_at), igual que se usa en removeMovimiento.
export function movimientoConciliacion(
  actual: Tenencia, movs: MovimientoLike[], fechaCompra: string | null | undefined, hoy: string,
): MovimientoLike | null {
  const t = reconstruirTenencia(movs);
  const gap = (Number(actual.cantidad) || 0) - t.cantidad;
  if (Math.abs(gap) < EPS) return null;
  if (gap < 0) return { tipo: 'ajuste', cantidad: gap, precio: 0, fecha: hoy };

  const primera = movs.map(m => m.fecha).filter((f): f is string => !!f).sort()[0];
  // Estrictamente ANTES del primer movimiento: con la misma fecha, el orden lo decide created_at y la
  // base (insertada ahora) quedaría DESPUÉS, reconstruyendo en otro orden.
  let fecha = fechaCompra || hoy;
  if (primera && fecha >= primera) fecha = diaAntes(primera);

  const target = Number(actual.costoPromedio) || 0;
  const costoCon = (px: number) => reconstruirTenencia([{ tipo: 'compra', cantidad: gap, precio: px, fecha }, ...movs]).costoPromedio;
  const f0 = costoCon(0), f1 = costoCon(1);
  const pendiente = f1 - f0;
  let precio = target;
  if (Math.abs(pendiente) > 1e-12) {
    const despejado = (target - f0) / pendiente;
    if (Number.isFinite(despejado) && despejado >= 0) precio = despejado;
  }
  return { tipo: 'compra', cantidad: gap, precio, fecha };
}
