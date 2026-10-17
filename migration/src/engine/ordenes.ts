// Órdenes ejecutadas: resumen de costos, desglose por mes y CONTROLES de coherencia. Puro y testeado (regla de oro #1). La app no
// ejecuta órdenes (regla #4): esto es solo el registro de lo que se operó en el broker y su conciliación con los movimientos.

export interface OrdenFila {
  id: string; fecha: string; ticker: string; broker: string; numero_orden: string | null;
  nominales: number; precio_limite: number | null; precio_ejecutado: number | null; monto_usd: number;
  comision_usd: number | null; comision_ars: number | null; mep: number | null;
  estado: string; origen: string; nota: string | null; movimiento_id: string | null;
  lado?: 'compra' | 'venta';          // 0057; ausente = compra
}
export interface MovCompra { fecha: string; ticker: string; cantidad: number; transferencia?: boolean }   // transferencia: la entrada vino de otro portfolio (la orden vive en el de origen)

const n = (x: unknown) => (x == null ? 0 : Number(x) || 0);
export const esEjecutada = (o: Pick<OrdenFila, 'estado'>) => o.estado === 'terminada';

// ── Resumen de costos ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface ResumenOrdenes {
  ejecutadas: number; canceladas: number; rechazadas: number; pendientes: number;
  operadoUsd: number; comisionUsd: number; comisionArsPesos: number;
  comisionArsEnUsd: number;          // la parte en pesos que tiene tipo de cambio REGISTRADO, convertida
  comisionArsSinMepPesos: number;    // la parte sin tipo de cambio: no se estima, queda en pesos
  totalUsdConocido: number; pctSobreOperado: number | null;
  estimadas: number;                 // órdenes ejecutadas cuyo origen es 'estimada' (sin boleto ni dato del broker)
  comisionEstimadaUsd: number;       // comisión (USD) de esas órdenes: parte del total que NO es un dato real
}

export function resumenOrdenes(ordenes: OrdenFila[]): ResumenOrdenes {
  let op = 0, cu = 0, ca = 0, caUsd = 0, caSin = 0, eje = 0, can = 0, rec = 0, pen = 0, est = 0, comEst = 0;
  for (const o of ordenes) {
    if (o.estado === 'cancelada') { can++; continue; }
    if (o.estado === 'rechazada') { rec++; continue; }
    if (!esEjecutada(o)) { pen++; continue; }
    eje++;
    op += n(o.monto_usd); cu += n(o.comision_usd);
    if (o.origen === 'estimada') { est++; comEst += n(o.comision_usd) + (n(o.mep) > 0 ? n(o.comision_ars) / n(o.mep) : 0); }
    const ars = n(o.comision_ars); ca += ars;
    if (ars > 0) { if (n(o.mep) > 0) caUsd += ars / n(o.mep); else caSin += ars; }
  }
  const total = cu + caUsd;
  return {
    ejecutadas: eje, canceladas: can, rechazadas: rec, pendientes: pen,
    operadoUsd: +op.toFixed(2), comisionUsd: +cu.toFixed(2), comisionArsPesos: +ca.toFixed(2),
    comisionArsEnUsd: +caUsd.toFixed(2), comisionArsSinMepPesos: +caSin.toFixed(2),
    totalUsdConocido: +total.toFixed(2), pctSobreOperado: op > 0 ? total / op : null,
    estimadas: est, comisionEstimadaUsd: +comEst.toFixed(2),
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
  | 'sin_movimiento' | 'movimiento_distinto' | 'compra_sin_orden' | 'anterior_al_historial' | 'ordenes_estimadas';

export interface Control { tipo: TipoControl; severidad: 'error' | 'aviso' | 'info'; texto: string; ordenId?: string }

// Comisión total (USD) sobre lo operado por encima de esto es sospechosa: IOL cobra ~0,3–0,6 % en bonos/CEDEARs.
export const MAX_PCT_COMISION = 0.01;

// El CEDEAR en dólares ("MAD", "MELID") se asienta en la cartera con el ticker del CEDEAR ("MA", "MELI"); la ON en pesos con
// cobertura en dólares ("CS51O") es la misma emisión que la línea en dólares de la cartera ("CS51D").
export function tickerDePosicion(tickerOrden: string, tickersPosicion: Set<string>): string {
  const t = tickerOrden.toUpperCase();
  if (tickersPosicion.has(t)) return t;
  if (t.endsWith('D') && tickersPosicion.has(t.slice(0, -1))) return t.slice(0, -1);
  if (t.endsWith('O') && tickersPosicion.has(`${t.slice(0, -1)}D`)) return `${t.slice(0, -1)}D`;
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

export function controlarOrdenes(ordenes: OrdenFila[], compras: MovCompra[], tickersPosicion: string[], tickersCash: string[] = ['LIQUIDEZ'], ventas?: MovCompra[]): Control[] {
  const out: Control[] = [];
  const set = new Set(tickersPosicion.map(t => t.toUpperCase()));
  const cash = new Set(tickersCash.map(t => t.toUpperCase()));
  const ejecutadas = ordenes.filter(esEjecutada);
  const ejecutadasCompra = ejecutadas.filter(o => (o.lado ?? 'compra') === 'compra');
  const ejecutadasVenta = ejecutadas.filter(o => o.lado === 'venta');

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
    // Las ESTIMADAS salen de una tasa (típicamente 1 %): marcarlas "comisión alta" por un redondeo de centavos sería ruido.
    if (o.origen !== 'estimada' && n(o.monto_usd) > 0 && n(o.comision_usd) / n(o.monto_usd) > MAX_PCT_COMISION) {
      out.push({ tipo: 'comision_alta', severidad: 'aviso', ordenId: o.id, texto: `${etiqueta}: la comisión en USD es ${(100 * n(o.comision_usd) / n(o.monto_usd)).toFixed(2)} % de lo operado (revisá si está bien cargada).` });
    }
  }

  // Conciliación contra los movimientos de compra: por (fecha, ticker de la posición), nominales de las órdenes ejecutadas vs cantidad comprada.
  const clave = (f: string, t: string) => `${f}|${t}`;
  const ordenPorDia = new Map<string, number>();
  for (const o of ejecutadasCompra) { const k = clave(o.fecha, tickerDePosicion(o.ticker, set)); ordenPorDia.set(k, (ordenPorDia.get(k) ?? 0) + n(o.nominales)); }
  const movPorDia = new Map<string, number>();
  for (const m of compras) {
    const t = m.ticker.toUpperCase();
    if (cash.has(t)) continue;
    const k = clave(m.fecha, t); movPorDia.set(k, (movPorDia.get(k) ?? 0) + n(m.cantidad));
  }
  // Antes del primer movimiento de compra registrado la cartera se cargó como saldo (sin historial): esas órdenes no se pueden conciliar.
  const desdeHistorial = [...movPorDia.keys()].map(k => k.split('|')[0]).sort()[0] ?? '9999-12-31';
  let anteriores = 0;
  for (const [k, nom] of ordenPorDia) {
    const [f, t] = k.split('|');
    const mov = movPorDia.get(k);
    if (mov == null && f < desdeHistorial) { anteriores++; continue; }
    if (mov == null) out.push({ tipo: 'sin_movimiento', severidad: 'error', texto: `${t} · ${fmtF(f)}: hay órdenes ejecutadas por ${nom} nominales pero ninguna compra registrada en Movimientos.` });
    else if (Math.abs(mov - nom) > 1e-6) out.push({ tipo: 'movimiento_distinto', severidad: 'error', texto: `${t} · ${fmtF(f)}: las órdenes suman ${nom} nominales y la compra registrada es de ${mov}.` });
  }
  if (anteriores > 0) {
    out.push({ tipo: 'anterior_al_historial', severidad: 'info', texto: `${anteriores} ${anteriores === 1 ? 'orden anterior' : 'órdenes anteriores'} al historial de movimientos de la cartera (que arranca el ${desdeHistorial === '9999-12-31' ? 'sin fecha' : fmtF(desdeHistorial)}): no se concilian con compras.` });
  }
  // Compras sin orden: solo desde la primera orden registrada (antes de eso el portfolio no llevaba este registro).
  const primera = ejecutadasCompra.map(o => o.fecha).sort()[0];
  if (primera) {
    // Una entrada por TRANSFERENCIA desde otro portfolio no es una compra de este: su orden está en el portfolio de origen.
    const soloTransferencia = new Set<string>();
    const noTransf = new Set<string>();
    for (const m of compras) { const k = clave(m.fecha, m.ticker.toUpperCase()); (m.transferencia ? soloTransferencia : noTransf).add(k); }
    for (const [k, cant] of movPorDia) {
      const [f, t] = k.split('|');
      if (soloTransferencia.has(k) && !noTransf.has(k)) continue;
      if (f >= primera && !ordenPorDia.has(k)) out.push({ tipo: 'compra_sin_orden', severidad: 'info', texto: `${t} · ${fmtF(f)}: compra de ${cant} sin orden registrada (¿suscripción OTC o falta cargar la orden?).` });
    }
  }
  // Ventas: se concilian contra los movimientos de venta (solo si se pasaron; sin ellos no hay contra qué comparar).
  if (ventas) {
    const ordV = new Map<string, number>(), movV = new Map<string, number>();
    for (const o of ejecutadasVenta) { const k = clave(o.fecha, tickerDePosicion(o.ticker, set)); ordV.set(k, (ordV.get(k) ?? 0) + n(o.nominales)); }
    for (const m of ventas) { const t = m.ticker.toUpperCase(); if (cash.has(t)) continue; const k = clave(m.fecha, t); movV.set(k, (movV.get(k) ?? 0) + n(m.cantidad)); }
    for (const [k, nom] of ordV) {
      const [f, t] = k.split('|'); const mov = movV.get(k);
      if (mov == null) out.push({ tipo: 'sin_movimiento', severidad: 'error', texto: `${t} · ${fmtF(f)}: hay órdenes de VENTA por ${nom} nominales pero ninguna venta registrada en Movimientos.` });
      else if (Math.abs(mov - nom) > 1e-6) out.push({ tipo: 'movimiento_distinto', severidad: 'error', texto: `${t} · ${fmtF(f)}: las órdenes de venta suman ${nom} nominales y la venta registrada es de ${mov}.` });
    }
  }
  const estimadas = ejecutadas.filter(o => o.origen === 'estimada');
  if (estimadas.length > 0) {
    const com = estimadas.reduce((x, o) => x + n(o.comision_usd) + (n(o.mep) > 0 ? n(o.comision_ars) / n(o.mep) : 0), 0);
    out.push({ tipo: 'ordenes_estimadas', severidad: 'info', texto: `${estimadas.length} ${estimadas.length === 1 ? 'orden es ESTIMADA' : 'órdenes son ESTIMADAS'} (sin boleto ni dato del broker; comisión ≈ US$ ${com.toFixed(2)} a la tasa general): reemplazalas por los datos reales cuando los tengas.` });
  }
  const orden = { error: 0, aviso: 1, info: 2 } as const;
  return out.sort((a, b) => orden[a.severidad] - orden[b.severidad]);
}
