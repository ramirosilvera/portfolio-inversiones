// =============================================================================
// Interés de la cuenta remunerada (saldo en USD parado en el broker): IOL paga una TNA sobre el saldo líquido, la devenga por día y la
// ACREDITA el primer día del mes siguiente (medido: 1,29 el 1/10 y 5,80 el 1/11 de 2026; TNA implícita 1,03 % sobre un saldo medio de
// US$ 6.734, IOL publica ≈ 1 %). Puro y testeado (regla de oro #1: el código calcula).
// La tasa vive en `posiciones.tir_esperada` de la posición LIQUIDEZ (el modal de edición ya la describe como «tasa de la cuenta
// remunerada»). Es una ESTIMACIÓN con el saldo de hoy: el crédito real depende del saldo de cada día; el monto se corrige al confirmar.
// =============================================================================

import type { MonthBucket } from './coupons';

export const diasDelMes = (year: number, month: number): number => new Date(year, month, 0).getDate();

// Interés devengado durante `month` (1-12) sobre un saldo constante: saldo × TNA × días ÷ 365.
export function interesDevengadoMes(saldo: number, tna: number, year: number, month: number): number {
  if (!(saldo > 0) || !(tna > 0)) return 0;
  return +(saldo * tna * diasDelMes(year, month) / 365).toFixed(2);
}

// Calendario de cobros: el interés de un mes se ACREDITA el primer día del mes siguiente, así que el bucket de `month` trae lo
// devengado en el mes anterior. Misma forma que couponCalendar/dividendCalendar para sumarse a «Proyectado».
export function calendarioInteresLiquidez(saldo: number, tna: number, fromYear: number, fromMonth: number, meses = 12, ticker = 'LIQUIDEZ'): MonthBucket[] {
  const out: MonthBucket[] = [];
  for (let i = 0; i < meses; i++) {
    const abs = fromYear * 12 + (fromMonth - 1) + i;
    const year = Math.floor(abs / 12), month = (abs % 12) + 1;
    const prev = abs - 1;
    const monto = interesDevengadoMes(saldo, tna, Math.floor(prev / 12), (prev % 12) + 1);
    out.push({ ym: `${year}-${String(month).padStart(2, '0')}`, year, month, total: monto, detalle: monto > 0 ? [{ ticker, monto }] : [] });
  }
  return out;
}

// Suma calendarios mes a mes (mismo eje, índice a índice).
export function sumarCalendarios(a: MonthBucket[], b: MonthBucket[]): MonthBucket[] {
  return a.map((m, i) => {
    const o = b[i];
    if (!o || o.ym !== m.ym || o.total === 0) return m;
    return { ...m, total: +(m.total + o.total).toFixed(2), detalle: [...m.detalle, ...o.detalle] };
  });
}
