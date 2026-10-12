// =============================================================================
// Resumen de cobros REALES (dividendos, intereses, amortizaciones) — puro y testeado. La
// amortización es devolución de CAPITAL, no renta: se suma al total cobrado en USD igual que las
// demás (es plata real que entró), pero se desglosa aparte en `porTipo` para no confundirla con
// renta al leer el desglose.
// =============================================================================

import type { Cobro, CobroTipo } from '../types/domain';

export interface ResumenCobros {
  total: number;
  disponible: number;   // cobrado y todavía sin reinvertir
  reinvertido: number;
  porTipo: Record<CobroTipo, number>;
}

export function resumenCobros(cobros: Cobro[]): ResumenCobros {
  const porTipo: Record<CobroTipo, number> = { dividendo: 0, interes: 0, amortizacion: 0 };
  let total = 0, disponible = 0, reinvertido = 0;
  for (const c of cobros) {
    // ALLOWLIST, no denylist: solo 'disponible'/'reinvertido' son plata CONFIRMADA. Cualquier otro
    // estado (hoy 'pendiente' y 'descartado', o uno que se agregue después) queda afuera de TODOS
    // los totales por default, sin tener que acordarse de excluirlo acá cada vez que se agrega uno
    // nuevo — un `continue` que solo miraba 'pendiente' dejaba que 'descartado' se colara en
    // `total`/`porTipo` sin aparecer en disponible+reinvertido (la suma dejaba de cerrar).
    if (c.estado !== 'disponible' && c.estado !== 'reinvertido') continue;
    const m = Number(c.monto) || 0;
    total += m;
    porTipo[c.tipo] = (porTipo[c.tipo] ?? 0) + m;
    if (c.estado === 'reinvertido') reinvertido += m; else disponible += m;
  }
  return { total: +total.toFixed(2), disponible: +disponible.toFixed(2), reinvertido: +reinvertido.toFixed(2), porTipo };
}

// =============================================================================
// Saldo invertible: cuánto del "disponible" (ver arriba) todavía NO se marcó como puesto a
// trabajar. No apunta a filas puntuales de `cobros` — es un ledger aparte (cobros_inversiones):
// el usuario dice "invertí $X del saldo" sin tener que elegir qué dividendos concretos son esos
// $X (casi nunca coincide con una fila exacta, porque junta varios cobros chicos).
// =============================================================================

export interface SaldoInvertible {
  disponibleBruto: number;
  acreditado: number;   // parte del disponible que YA está en la posición LIQUIDEZ (cobros acreditados): no es saldo "pendiente de pasar"
  pasable: number;      // lo que se puede pasar a Liquidez hoy = neto (nunca negativo)
  invertido: number;
  neto: number;         // nunca negativo (clamp a 0 para mostrar)
  sobregirado: boolean;  // invertido > disponibleBruto — señal de inconsistencia, no se oculta
}

// `acreditado`: los cobros confirmados que ya se acreditaron en LIQUIDEZ (liquidez_mov_id) son plata que YA está en el efectivo de
// la cartera: no son saldo "por invertir" aparte — contarlos acá y en la Liquidez los mostraba dos veces, y pasarlos a Liquidez
// los duplicaba. Pasar el saldo a Liquidez se registra como una inversión más del ledger (con su liquidez_mov_id), así que
// también sale del saldo.
export function saldoInvertible(disponibleBruto: number, inversiones: { monto: number }[], acreditado = 0): SaldoInvertible {
  const invertido = +inversiones.reduce((s, i) => s + (Number(i.monto) || 0), 0).toFixed(2);
  const acred = +(Number(acreditado) || 0).toFixed(2);
  const netoRaw = +(disponibleBruto - acred - invertido).toFixed(2);
  const neto = Math.max(0, netoRaw);
  return { disponibleBruto, acreditado: acred, pasable: neto, invertido, neto, sobregirado: netoRaw < -0.005 };
}

// Suma de los cobros DISPONIBLES que se acreditaron en LIQUIDEZ.
export function acreditadoEnLiquidez(cobros: { estado: string; monto: number; liquidez_mov_id?: string | null }[]): number {
  let t = 0;
  for (const c of cobros) if (c.estado === 'disponible' && c.liquidez_mov_id) t += Number(c.monto) || 0;
  return +t.toFixed(2);
}
