// =============================================================================
// Tendencia de precio — puro, calculado a partir del histórico semanal (Yahoo Finance, ver
// functions/api/market/historico.ts). Complementa el DCF: mientras el DCF dice "cuánto vale",
// esto dice "cómo llegó el mercado hasta el precio de hoy" — subiendo, cayendo o estancado.
// =============================================================================

import { distanciaMaximo } from './semaforos';

export interface PuntoPrecio { fecha: string; close: number }

const SEMANAS_1A = 53;  // ~52 semanas atrás + hoy
const SEMANAS_5A = 261; // ~5*52 semanas atrás + hoy — mismo horizonte que dcf.histCagrOE (last5)

export interface TendenciaPrecio {
  actual: number | null;
  var52sem: number | null;      // variación % en las últimas ~52 semanas (null si hay <1 año de historia)
  var5y: number | null;         // variación % en los últimos ~5 años EXACTOS — mismo horizonte que
                                 // dcf.histCagrOE, para poder cruzarlos sin importar cuánta historia
                                 // haya de más (ver contrastarConNegocio). Si hay <5 años de historia,
                                 // cae al primer punto disponible (igual que antes).
  varVentana: number | null;    // variación % en TODA la ventana de histórico recibida (hasta 10 años)
  anios: number | null;         // años de historia real en la ventana recibida (redondeado)
  distanciaMax: number | null;  // distancia % al máximo de TODA la ventana recibida (0 = en máximos)
}

// puntos: ordenados por fecha ASCENDENTE (así los devuelve parseWeekly en historico.ts) — no se
// reordena acá a propósito, para no esconder un bug de origen si algún día no vinieran así.
export function tendenciaPrecio(puntos: PuntoPrecio[]): TendenciaPrecio {
  if (!puntos.length) return { actual: null, var52sem: null, var5y: null, varVentana: null, anios: null, distanciaMax: null };
  const actual = puntos[puntos.length - 1].close;
  const inicioVentana = puntos[0].close;

  const idx1y = puntos.length - SEMANAS_1A; // si hay menos de 1 año de historia, no hay var52sem real
  const inicio1y = idx1y >= 0 ? puntos[idx1y].close : null;

  const idx5y = puntos.length - SEMANAS_5A;
  const inicio5y = idx5y >= 0 ? puntos[idx5y].close : inicioVentana; // <5 años de historia: usa todo lo que haya

  const max = puntos.reduce((m, p) => Math.max(m, p.close), 0);
  return {
    actual,
    var52sem: inicio1y != null && inicio1y > 0 ? actual / inicio1y - 1 : null,
    var5y: inicio5y > 0 ? actual / inicio5y - 1 : null,
    varVentana: inicioVentana > 0 ? actual / inicioVentana - 1 : null,
    anios: Math.round((puntos.length - 1) / 52),
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
//
// Recibe siempre var5y (nunca varVentana): histCagrOE se calcula sobre los últimos 5 ejercicios
// (ver dcf.ts, last5) — si la ventana de precio fetcheada creciera a 10 años, comparar contra
// varVentana mezclaría dos horizontes distintos y el cruce dejaría de ser válido.
export type LecturaTendencia = 'posible-panico' | 'posible-deterioro' | 'posible-recalentamiento' | 'sin-señal-clara';

// Umbral 5 PUNTOS ANUALES: por debajo de eso es ruido, no una tendencia real que valga la pena leer.
// Se aplica siempre sobre tasas anualizadas (nunca un acumulado crudo) — ver anualizar() abajo.
const UMBRAL = 0.05;

// Anualiza un retorno acumulado sobre `anios` años (ej. 1.0 acumulado en 5 años → ~14.9% anual, no
// "100%"). Se expone porque tanto contrastarConNegocio() como la UI (tarjeta de precio, Chequeos
// Munger) necesitan la MISMA conversión: comparar (o mostrar) un acumulado de N años contra una tasa
// anual (un CAGR) sin convertir primero es aritmética inválida — confunde "cayó/subió X% en total en
// N años" con "cae/sube X% CADA año", dos magnitudes muy distintas para N > 1.
export function anualizar(varAcumulado: number, anios: number): number {
  return Math.pow(1 + varAcumulado, 1 / anios) - 1;
}

export function contrastarConNegocio(varPrecio: number | null, cagrOwnerEarnings: number | null): LecturaTendencia | null {
  if (varPrecio == null || cagrOwnerEarnings == null) return null;
  // varPrecio es SIEMPRE un acumulado a 5 años exactos (ver arriba) — se anualiza ACÁ, una sola vez,
  // y de ahí en más TODO el cruce compara tasas anuales entre sí (nunca el acumulado crudo contra el
  // CAGR anual del negocio). Antes solo se anualizaba para el chequeo de recalentamiento; pánico y
  // deterioro seguían comparando el acumulado crudo de 5 años contra el mismo umbral de 5 puntos que
  // el CAGR anual — con eso, una caída de precio de apenas 6% ACUMULADA en 5 años (~1,2%/año, ruido)
  // ya disparaba "posible pánico" con la misma vara que una caída del NEGOCIO del 5% POR AÑO, sostenida.
  const priceCagr = anualizar(varPrecio, 5);
  const precioCayo = priceCagr < -UMBRAL;
  const precioSubio = priceCagr > UMBRAL;
  const negocioCayo = cagrOwnerEarnings < -UMBRAL;
  if (precioCayo && !negocioCayo) return 'posible-panico';     // el mercado castigó más de lo que cayó (o sin caer) el negocio
  if (precioCayo && negocioCayo) return 'posible-deterioro';   // cayeron los dos: nada contradice la caída del precio
  if (precioSubio && negocioCayo) return 'posible-deterioro';  // subió el precio pero el negocio no acompaña — euforia sin respaldo
  // Recalentamiento: el precio subió bastante más rápido que el NEGOCIO, aunque el negocio no haya
  // caído — parte de la suba no vino de más Owner Earnings sino de que el mercado le puso un múltiplo
  // mayor a la empresa. No es lo mismo que "cara" (eso ya lo dice el margen de seguridad arriba, con
  // el valor intrínseco de HOY) — es una advertencia distinta: sostener este precio de acá en más
  // depende de que el negocio "alcance" al múltiplo, no de que el múltiplo siga expandiéndose (Munger:
  // no pagues por una revalorización que ya pasó esperando que se repita).
  if (precioSubio && priceCagr - cagrOwnerEarnings > UMBRAL) return 'posible-recalentamiento';
  return 'sin-señal-clara';
}
