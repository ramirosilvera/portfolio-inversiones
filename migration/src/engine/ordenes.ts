// Órdenes ejecutadas: resumen de costos, desglose por mes y CONTROLES de coherencia. Puro y testeado (regla de oro #1). La app no
// ejecuta órdenes (regla #4): esto es solo el registro de lo que se operó en el broker y su conciliación con los movimientos.

export interface OrdenFila {
  id: string; fecha: string; ticker: string; broker: string; numero_orden: string | null;
  nominales: number; precio_limite: number | null; precio_ejecutado: number | null; monto_usd: number;
  comision_usd: number | null; comision_ars: number | null; mep: number | null;
  estado: string; origen: string; nota: string | null; movimiento_id: string | null;
}
export interface MovCompra { fecha: string; ticker: string; cantidad: number }

const n = (x: unknown) => (x == null ? 0 : Number(x) || 0);
export const esEjecutada = (o: Pick<OrdenFila, 'estado'>) => o.estado === 'terminada';

// ── Resumen de costos ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface ResumenOrdenes {
  ejecutadas: number; canceladas: number; rechazadas: number; pendientes: number;
  operadoUsd: number; comisionUsd: number; comisionArsPesos: number;
  comisionArsEnUsd: number;          // la parte en pesos que tiene tipo de cambio REGISTRADO, convertida
  comisionArsSinMepPesos: number;    // la parte sin tipo de cambio: no se estima, queda en pesos
  totalUsdConocido: number; pctSobreOperado: number | null;
}

export function resumenOrdenes(ordenes: OrdenFila[]): ResumenOrdenes {
  let op = 0, cu = 0, ca = 0, caUsd = 0, caSin = 0, eje = 0, can = 0, rec = 0, pen = 0;
  for (const o of ordenes) {
    if (o.estado === 'cancelada') { can++; continue; }
    if (o.estado === 'rechazada') { rec++; continue; }
    if (!esEjecutada(o)) { pen++; continue; }
    eje++;
    op += n(o.monto_usd); cu += n(o.comision_usd);
    const ars = n(o.comision_ars); ca += ars;
    if (ars > 0) { if (n(o.mep) > 0) caUsd += ars / n(o.mep); else caSin += ars; }
  }
  const total = cu + caUsd;
  return {
    ejecutadas: eje, canceladas: can, rechazadas: rec, pendientes: pen,
    operadoUsd: +op.toFixed(2), comisionUsd: +cu.toFixed(2), comisionArsPesos: +ca.toFixed(2),
    comisionArsEnUsd: +caUsd.toFixed(2), comisionArsSinMepPesos: +caSin.toFixed(2),
    totalUsdConocido: +total.toFixed(2), pctSobreOperado: op > 0 ? total / op : null,
  };
}

export interface FilaMes { mes: string; ordenes: number; operadoUsd: number; comisionUsd: number; comisionArsEnUsd: number; comisionArsSinMepPesos: number; totalUsd: number }

// Una fila por mes (AAAA-MM) con órdenes ejecutadas, ascendente.
export function resumenPorMes(ordenes: OrdenFila[]): FilaMes[] {
  const m = new Map<string, OrdenFila[]>();
  for (const o of ordenes) if (esEjecutada(o) && o.fecha) (m.get(o.fecha.slice(0, 7)) ?? m.set(o.fecha.slice(0, 7), []).get(o.fecha.slice(0, 7))!).push(o);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, os]) => {
    const r = resumenOrdenes(os);
    return { mes, ordenes: r.ejecutadas, operadoUsd: r.operadoUsd, comisionUsd: r.comisionUsd, comisionArsEnUsd: r.comisionArsEnUsd,
      comisionArsSinMepPesos: r.comisionArsSinMepPesos, totalUsd: r.totalUsdConocido };
  });
}

// ── Controles ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type TipoControl =
  | 'sin_comision' | 'sin_mep' | 'monto_incoherente' | 'comision_alta'
  | 'sin_movimiento' | 'movimiento_distinto' | 'compra_sin_orden';

export interface Control { tipo: TipoControl; severidad: 'error' | 'aviso' | 'info'; texto: string; ordenId?: string }

// Comisión total (USD) sobre lo operado por encima de esto es sospechosa: IOL cobra ~0,3–0,6 % en bonos/CEDEARs.
export const MAX_PCT_COMISION = 0.01;

// El CEDEAR en dólares ("MAD", "MELID") se asienta en la cartera con el ticker del CEDEAR ("MA", "MELI").
export function tickerDePosicion(tickerOrden: string, tickersPosicion: Set<string>): string {
  const t = tickerOrden.toUpperCase();
  if (tickersPosicion.has(t)) return t;
  if (t.endsWith('D') && tickersPosicion.has(t.slice(0, -1))) return t.slice(0, -1);
  return t;
}

// ¿monto = nominales × precio? Los bonos cotizan cada 100 nominales, los CEDEARs por unidad: se acepta cualquiera de las dos.
export function montoCoherente(o: Pick<OrdenFila, 'nominales' | 'precio_ejecutado' | 'monto_usd'>): boolean | null {
  const px = n(o.precio_ejecutado);
  if (!(px > 0) || !(n(o.nominales) > 0)) return null;           // sin precio no se puede verificar
  const tol = Math.max(0.5, 0.001 * n(o.monto_usd));
  const exp = n(o.nominales) * px;
  return Math.abs(n(o.monto_usd) - exp) <= tol || Math.abs(n(o.monto_usd) - exp / 100) <= tol;
}

const fmtF = (iso: string) => iso.split('-').reverse().join('/');

export function controlarOrdenes(ordenes: OrdenFila[], compras: MovCompra[], tickersPosicion: string[], tickersCash: string[] = ['LIQUIDEZ']): Control[] {
  const out: Control[] = [];
  const set = new Set(tickersPosicion.map(t => t.toUpperCase()));
  const cash = new Set(tickersCash.map(t => t.toUpperCase()));
  const ejecutadas = ordenes.filter(esEjecutada);

  for (const o of ejecutadas) {
    const etiqueta = `${o.ticker} · ${fmtF(o.fecha)}${o.numero_orden ? ` · orden ${o.numero_orden}` : ''}`;
    if (o.comision_usd == null && o.comision_ars == null) {
      out.push({ tipo: 'sin_comision', severidad: 'aviso', ordenId: o.id, texto: `${etiqueta}: sin comisiones registradas (el costo de esta orden no se descuenta).` });
    }
    if (n(o.comision_ars) > 0 && !(n(o.mep) > 0)) {
      out.push({ tipo: 'sin_mep', severidad: 'aviso', ordenId: o.id, texto: `${etiqueta}: comisión en pesos sin tipo de cambio MEP (no entra en la TIR neta).` });
    }
    if (montoCoherente(o) === false) {
      out.push({ tipo: 'monto_incoherente', severidad: 'error', ordenId: o.id, texto: `${etiqueta}: el monto (US$ ${n(o.monto_usd).toFixed(2)}) no coincide con nominales × precio.` });
    }
    if (n(o.monto_usd) > 0 && n(o.comision_usd) / n(o.monto_usd) > MAX_PCT_COMISION) {
      out.push({ tipo: 'comision_alta', severidad: 'aviso', ordenId: o.id, texto: `${etiqueta}: la comisión en USD es ${(100 * n(o.comision_usd) / n(o.monto_usd)).toFixed(2)} % de lo operado (revisá si está bien cargada).` });
    }
  }

  // Conciliación contra los movimientos de compra: por (fecha, ticker de la posición), nominales de las órdenes ejecutadas vs cantidad comprada.
  const clave = (f: string, t: string) => `${f}|${t}`;
  const ordenPorDia = new Map<string, number>();
  for (const o of ejecutadas) { const k = clave(o.fecha, tickerDePosicion(o.ticker, set)); ordenPorDia.set(k, (ordenPorDia.get(k) ?? 0) + n(o.nominales)); }
  const movPorDia = new Map<string, number>();
  for (const m of compras) {
    const t = m.ticker.toUpperCase();
    if (cash.has(t)) continue;
    const k = clave(m.fecha, t); movPorDia.set(k, (movPorDia.get(k) ?? 0) + n(m.cantidad));
  }
  for (const [k, nom] of ordenPorDia) {
    const [f, t] = k.split('|');
    const mov = movPorDia.get(k);
    if (mov == null) out.push({ tipo: 'sin_movimiento', severidad: 'error', texto: `${t} · ${fmtF(f)}: hay órdenes ejecutadas por ${nom} nominales pero ninguna compra registrada en Movimientos.` });
    else if (Math.abs(mov - nom) > 1e-6) out.push({ tipo: 'movimiento_distinto', severidad: 'error', texto: `${t} · ${fmtF(f)}: las órdenes suman ${nom} nominales y la compra registrada es de ${mov}.` });
  }
  // Compras sin orden: solo desde la primera orden registrada (antes de eso el portfolio no llevaba este registro).
  const primera = ejecutadas.map(o => o.fecha).sort()[0];
  if (primera) {
    for (const [k, cant] of movPorDia) {
      const [f, t] = k.split('|');
      if (f >= primera && !ordenPorDia.has(k)) out.push({ tipo: 'compra_sin_orden', severidad: 'info', texto: `${t} · ${fmtF(f)}: compra de ${cant} sin orden registrada (¿suscripción OTC o falta cargar la orden?).` });
    }
  }
  const orden = { error: 0, aviso: 1, info: 2 } as const;
  return out.sort((a, b) => orden[a.severidad] - orden[b.severidad]);
}
