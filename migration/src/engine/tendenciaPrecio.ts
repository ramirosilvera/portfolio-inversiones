// =============================================================================
// Tendencia de precio — puro, calculado a partir del histórico semanal (Yahoo Finance, ver
// functions/api/market/historico.ts). Complementa el DCF: mientras el DCF dice "cuánto vale",
// esto dice "cómo llegó el mercado hasta el precio de hoy" — subiendo, cayendo o estancado.
// =============================================================================

import { distanciaMaximo } from './semaforos';

export interface PuntoPrecio { fecha: string; close: number }

export interface TendenciaPrecio {
  actual: number | null;
  var52sem: number | null;      // variación % en las últimas ~52 semanas (null si hay <1 año de historia)
  var5y: number | null;         // variación % en toda la ventana disponible (hasta 5 años)
  distanciaMax: number | null;  // distancia % al máximo de la ventana (0 = en máximos, negativo = por debajo)
}

// puntos: ordenados por fecha ASCENDENTE (así los devuelve parseWeekly en historico.ts) — no se
// reordena acá a propósito, para no esconder un bug de origen si algún día no vinieran así.
export function tendenciaPrecio(puntos: PuntoPrecio[]): TendenciaPrecio {
  if (!puntos.length) return { actual: null, var52sem: null, var5y: null, distanciaMax: null };
  const actual = puntos[puntos.length - 1].close;
  const inicio5y = puntos[0].close;
  const idx1y = puntos.length - 53; // ~52 semanas atrás; si hay menos de 1 año de historia, no hay var52sem real
  const inicio1y = idx1y >= 0 ? puntos[idx1y].close : null;
  const max = puntos.reduce((m, p) => Math.max(m, p.close), 0);
  return {
    actual,
    var52sem: inicio1y != null && inicio1y > 0 ? actual / inicio1y - 1 : null,
    var5y: inicio5y > 0 ? actual / inicio5y - 1 : null,
    distanciaMax: distanciaMaximo(actual, max),
  };
}

// El "falsificador de value trap": cruza la variación del PRECIO con la variación del NEGOCIO (CAGR
// histórico de owner earnings, dcf.histCagrOE — nunca margin of safety ni valor intrínseco por
// acción: esos dos ya incorporan el precio de hoy en su fórmula, así que cruzarlos contra el precio
// sería comparar el precio contra sí mismo, una tautología que "confirma" cualquier caída como
// oportunidad). Sin este cruce, una caída de precio se lee como "descuento" aunque el negocio
// también se haya deteriorado — exactamente lo que la regla de oro del proyecto busca evitar: nunca
// una lectura que insinúe algo que el código no verificó con números independientes entre sí.
export type LecturaTendencia = 'posible-panico' | 'posible-deterioro' | 'sin-señal-clara';

// Umbral 5%: por debajo de eso es ruido de corto plazo, no una tendencia real que valga la pena leer.
const UMBRAL = 0.05;

export function contrastarConNegocio(varPrecio: number | null, cagrOwnerEarnings: number | null): LecturaTendencia | null {
  if (varPrecio == null || cagrOwnerEarnings == null) return null;
  const precioCayo = varPrecio < -UMBRAL;
  const precioSubio = varPrecio > UMBRAL;
  const negocioCayo = cagrOwnerEarnings < -UMBRAL;
  if (precioCayo && !negocioCayo) return 'posible-panico';     // el mercado castigó más de lo que cayó (o sin caer) el negocio
  if (precioCayo && negocioCayo) return 'posible-deterioro';   // cayeron los dos: nada contradice la caída del precio
  if (precioSubio && negocioCayo) return 'posible-deterioro';  // subió el precio pero el negocio no acompaña — euforia sin respaldo
  return 'sin-señal-clara';
}
