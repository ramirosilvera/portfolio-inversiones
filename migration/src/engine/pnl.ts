// =============================================================================
// P&L realizado a partir del historial de movimientos. Puro y determinista.
// Recorre los movimientos en orden cronológico manteniendo cantidad y COSTO PROMEDIO
// corriente; en cada venta realiza (precioVenta − costoPromedio) × cantidad.
// =============================================================================

import type { Movimiento } from '../types/domain';
import { factorValido } from './tenencia';

export interface RealizedResult {
  porTicker: Record<string, number>;
  total: number;
}

const crono = (a: Movimiento, b: Movimiento): number =>
  a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);

export function realizedPnl(movs: Movimiento[]): RealizedResult {
  const byTicker: Record<string, Movimiento[]> = {};
  for (const m of movs) (byTicker[m.ticker] ??= []).push(m);

  const porTicker: Record<string, number> = {};
  let total = 0;

  for (const [ticker, list] of Object.entries(byTicker)) {
    const ordered = [...list].sort(crono);
    let qty = 0, avg = 0, realized = 0;
    for (const m of ordered) {
      if (m.tipo === 'venta') {
        const q = Math.min(m.cantidad, qty);      // no vender más de lo que hay
        realized += (m.precio - avg) * q;
        qty -= q;
      } else if (m.tipo === 'ajuste') {
        // Ajuste de cantidad (split, corrección): cambia la cantidad SIN tocar el costo promedio.
        // Si entrara al promedio con precio 0 diluiría el costo real e inflaría el realizado.
        qty = Math.max(0, qty + m.cantidad);
      } else if (m.tipo === 'amortizacion_vr') {
        // Amortización por valor residual: devolvió capital → el costo base baja en esa proporción
        // (mismo criterio que reconstruirTenencia). Sin esto, vender después de amortizar realizaba
        // como pérdida el capital que ya se había cobrado.
        avg *= factorValido(Number(m.precio));
      } else {                                     // compra → entra al promedio ponderado
        const nueva = qty + m.cantidad;
        avg = nueva > 0 ? (qty * avg + m.cantidad * m.precio) / nueva : avg;
        qty = nueva;
      }
    }
    porTicker[ticker] = +realized.toFixed(2);
    total += realized;
  }
  return { porTicker, total: +total.toFixed(2) };
}

// ── P&L TOTAL = no realizado + realizado + renta cobrada ─────────────────────────────────────────────────────────────
// "Patrimonio − costo" (y el P&L por posición) es SOLO no realizado: el efectivo que entra a la LIQUIDEZ (venta, dividendo,
// cupón) suma igual al patrimonio y al costo, así que no mueve ese número. Por eso el resultado de las ventas se mira aparte
// (realizedPnl) y la RENTA (dividendos + intereses) no aparecía en ningún P&L. Se suman las tres partes y no se cuenta dos
// veces: lo no realizado es sobre lo que hoy se tiene; lo realizado, sobre lo vendido; la renta, sobre lo cobrado.
// La AMORTIZACIÓN es devolución de capital, no renta: no suma (el costo de la posición ya baja con ella). Solo cuentan los cobros
// CONFIRMADOS ('disponible'/'reinvertido'); 'pendiente' y 'descartado' quedan afuera.
export interface CobroMin { tipo: string; estado: string; monto: number }

export interface PnlTotal { noRealizado: number; realizado: number; renta: number; total: number }

export function rentaCobrada(cobros: CobroMin[]): number {
  let t = 0;
  for (const c of cobros) {
    if (c.estado !== 'disponible' && c.estado !== 'reinvertido') continue;
    if (c.tipo !== 'dividendo' && c.tipo !== 'interes') continue;
    t += Number(c.monto) || 0;
  }
  return +t.toFixed(2);
}

export function pnlTotal(noRealizado: number, realizado: number, cobros: CobroMin[]): PnlTotal {
  const renta = rentaCobrada(cobros);
  return { noRealizado, realizado, renta, total: +(noRealizado + realizado + renta).toFixed(2) };
}

// Renta confirmada como EFECTIVO DISPONIBLE que NO se acreditó en LIQUIDEZ: ese efectivo solo está en el patrimonio (y, por lo
// tanto, en el rendimiento por año) si ya figura en el saldo de Liquidez por otra vía (p. ej. una conciliación con el broker).
// Los 'reinvertido' no entran: su efectivo ya se convirtió en posiciones.
export function cobrosSinAcreditar(cobros: (CobroMin & { liquidez_mov_id?: string | null })[]): number {
  let t = 0;
  for (const c of cobros) {
    if (c.estado !== 'disponible') continue;
    if (c.tipo !== 'dividendo' && c.tipo !== 'interes') continue;
    if (!c.liquidez_mov_id) t += Number(c.monto) || 0;
  }
  return +t.toFixed(2);
}
