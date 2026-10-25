// =============================================================================
// Rendimiento por dividendos de los CEDEARs en cartera — el equivalente al «Rend. corriente» de los bonos
// (cupón anualizado ÷ precio, ponderado por capital): dividendo ANUALIZADO VIGENTE ÷ valor de mercado.
// Puro y testeado (regla de oro #1: el código calcula, no un LLM).
//
// Dividendo anualizado = último monto por acción (el declarado, o el último pagado) × pagos por año (cadencia histórica del
// proveedor, ver functions/api/_dividendos.ts). NO es la suma de «los próximos 12 meses de calendario» de Proyectado: esa ventana
// empieza en el mes en curso y a un pagador cuyo próximo pago cae a 3 meses le deja un pago afuera (WMT salía 25 % bajo).
// Es una estimación hacia adelante, no un cobro. Es BRUTO (sin la retención de EE.UU. ni las comisiones); el neto estimado se
// informa aparte con las tasas generales.
// =============================================================================

import type { CedearCalc } from './cedears';
import type { DividendoInfo } from './dividendProjection';
import { netoSobreBruto } from './impuestos';

// declarado: el próximo pago ya lo anunció el proveedor · estimado: se proyecta por cadencia histórica ·
// sin-pago: el proveedor no tiene dividendos en el último año (LAC, MELI hoy): cuenta como 0 % ·
// sin-info: no se pudo calcular (no llegó el dato del proveedor o falta el ratio del CEDEAR): queda FUERA del promedio.
export type EstadoDividendo = 'declarado' | 'estimado' | 'sin-pago' | 'sin-info';

export interface RendDividendosPosicion {
  id: string;
  ticker: string;
  estado: EstadoDividendo;
  dividendoAnualUsd: number;        // bruto, anualizado, de la posición entera
  yieldMercado: number | null;      // dividendoAnualUsd ÷ valor de mercado (o costo si no hay cotización); null si sin-info
  yieldCosto: number | null;        // dividendoAnualUsd ÷ costo
}

export interface RendDividendos {
  porPosicion: Record<string, RendDividendosPosicion>;   // por id de posición
  dividendoAnualUsd: number;
  yieldMercado: number | null;      // ponderado por capital, INCLUYE a los que no pagan
  yieldCosto: number | null;
  yieldNeto: number | null;         // yieldMercado × neto estimado con las tasas generales (retención + depositaria + broker)
  pagadores: number;
  sinPago: number;
  sinInfo: number;
}

export function rendimientoDividendos(
  cedears: CedearCalc[],
  infoPorTicker: Record<string, DividendoInfo | null | undefined>,
): RendDividendos {
  const porPosicion: Record<string, RendDividendosPosicion> = {};
  let divTotal = 0, mktBase = 0, costoBase = 0, pagadores = 0, sinPago = 0, sinInfo = 0;

  for (const c of cedears) {
    const p = c.pos;
    const info = infoPorTicker[p.ticker.toUpperCase()];
    const base: Pick<RendDividendosPosicion, 'id' | 'ticker'> = { id: p.id, ticker: p.ticker };

    if (info == null) {   // sin respuesta del proveedor: no es lo mismo que «no paga»
      sinInfo++;
      porPosicion[p.id] = { ...base, estado: 'sin-info', dividendoAnualUsd: 0, yieldMercado: null, yieldCosto: null };
      continue;
    }

    let dividendoAnualUsd = 0;
    let estado: EstadoDividendo;
    if (info.estado === 'sin-dato') {
      estado = 'sin-pago';
    } else {
      // Anualizar exige las tres cosas: monto, cadencia y ratio (un CEDEAR sin ratio confiable no se convierte a dividendo por CEDEAR).
      const monto = info.montoPorAccion, frec = info.frecuenciaAnual, ratio = p.ratio_cedear;
      const cantidad = Number(p.cantidad) || 0;
      if (monto == null || !(monto > 0) || !frec || !(frec > 0) || !(ratio != null && ratio > 0) || !(cantidad > 0)) {
        sinInfo++;
        porPosicion[p.id] = { ...base, estado: 'sin-info', dividendoAnualUsd: 0, yieldMercado: null, yieldCosto: null };
        continue;
      }
      dividendoAnualUsd = (monto * frec * cantidad) / ratio;
      estado = info.estado === 'declarado' ? 'declarado' : 'estimado';
    }

    const mkt = c.capitalUsado;
    porPosicion[p.id] = {
      ...base, estado, dividendoAnualUsd,
      yieldMercado: mkt > 0 ? dividendoAnualUsd / mkt : null,
      yieldCosto: c.capital > 0 ? dividendoAnualUsd / c.capital : null,
    };
    divTotal += dividendoAnualUsd; mktBase += mkt; costoBase += c.capital;
    if (estado === 'sin-pago') sinPago++; else pagadores++;
  }

  const yieldMercado = mktBase > 0 ? divTotal / mktBase : null;
  return {
    porPosicion,
    dividendoAnualUsd: +divTotal.toFixed(2),
    yieldMercado,
    yieldCosto: costoBase > 0 ? divTotal / costoBase : null,
    yieldNeto: yieldMercado != null ? yieldMercado * netoSobreBruto() : null,
    pagadores, sinPago, sinInfo,
  };
}
