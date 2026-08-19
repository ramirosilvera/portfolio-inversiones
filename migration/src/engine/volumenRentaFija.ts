// =============================================================================
// Volumen operado / operabilidad de renta fija — puro, testeado. Complementa el catálogo de
// referencia (rentaFija.ts): mientras TIR/paridad dicen "cuánto rinde", esto dice "¿hay
// suficiente contraparte real para que MI operación se ejecute a un precio razonable?".
//
// Deliberadamente NO usa la heurística institucional de "no superar el 10-20% del volumen
// promedio diario (ADV)" — esa regla existe para evitar que UNA MISMA orden grande mueva el
// precio en contra de quien la coloca, y no aplica a un inversor minorista con tickets de
// US$500-5.000: a esa escala, ni el peor día de la ON más chica del catálogo alcanza para que el
// propio operador mueva el mercado. La pregunta relevante para ese perfil es otra: ¿existió,
// incluso en un día flojo reciente, suficiente operatoria real como para conseguir una
// contraparte a precio razonable? Por eso se compara el monto contra el PEOR día y la MEDIANA de
// una ventana reciente, no contra un promedio pensado para órdenes institucionales.
// =============================================================================

export interface BarraVolumen { fecha: string; volumenNominal: number }

export interface VolumenStats {
  mediaUsd: number;
  medianaUsd: number;
  minimoUsd: number;
  diasConDatos: number;
}

const mediana = (valores: number[]): number => {
  const s = [...valores].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// `barras` son SIEMPRE la ventana ya recortada por quien llama (mismo criterio que tendenciaPrecio:
// la función no decide cuántas ruedas mirar, solo calcula sobre lo que recibe) — típicamente las
// últimas ~20 ruedas con dato (get_price_history de IOL, ver bonos_referencia). `precioActual` es
// el mismo `px` (fracción del nominal) que ya usa calcularBonoReferencia() para paridad/TIR — el
// volumen nominal reportado por IOL se convierte a plata operada con la MISMA fórmula
// (nominal × precio), no una conversión nueva e inconsistente con el resto del motor.
export function statsVolumen(barras: BarraVolumen[], precioActual: number | null): VolumenStats | null {
  if (barras.length === 0 || precioActual == null || precioActual <= 0) return null;
  const usd = barras.map(b => b.volumenNominal * precioActual);
  const mediaUsd = usd.reduce((a, b) => a + b, 0) / usd.length;
  return { mediaUsd, medianaUsd: mediana(usd), minimoUsd: Math.min(...usd), diasConDatos: usd.length };
}

export type OperabilidadNivel = 'verde' | 'amarillo' | 'rojo';

// Umbrales para un inversor MINORISTA (no institucional, ver comentario de arriba):
// verde:    el monto entra holgado incluso en el peor día reciente (≤ 20% de ese mínimo) — margen
//           amplio de sobra para variaciones día a día.
// amarillo: el monto ya iguala o supera el peor día reciente, pero sigue por debajo de un día
//           típico (mediana) — probablemente ejecutable, pero con más chance de spread ancho o de
//           no llenarse en un solo día si justo cae un día flojo.
// rojo:     el monto supera incluso la mediana — en un día TÍPICO ya representa una porción grande
//           de lo que realmente se opera; alto riesgo de mal precio de entrada/salida.
export function evaluarOperabilidad(montoUsd: number, stats: VolumenStats): OperabilidadNivel {
  if (montoUsd <= 0.2 * stats.minimoUsd) return 'verde';
  if (montoUsd <= stats.medianaUsd) return 'amarillo';
  return 'rojo';
}

// bonos_referencia guarda los 4 números YA REDUCIDOS (statsVolumen se corre una sola vez, al
// refrescar el catálogo desde IOL — ver migración 0040), no las barras diarias crudas: acá no se
// recalcula nada, solo se arma el mismo VolumenStats a partir de las columnas de la fila, o null si
// todavía no se refrescó (catálogo poblado antes de esta feature, o ticker nuevo sin volumen aún).
export function volumenStatsFromRef(fila: {
  vol_media_usd: number | null; vol_mediana_usd: number | null;
  vol_minimo_usd: number | null; vol_dias_con_datos: number | null;
}): VolumenStats | null {
  const { vol_media_usd, vol_mediana_usd, vol_minimo_usd, vol_dias_con_datos } = fila;
  if (vol_media_usd == null || vol_mediana_usd == null || vol_minimo_usd == null || vol_dias_con_datos == null) return null;
  return { mediaUsd: vol_media_usd, medianaUsd: vol_mediana_usd, minimoUsd: vol_minimo_usd, diasConDatos: vol_dias_con_datos };
}
