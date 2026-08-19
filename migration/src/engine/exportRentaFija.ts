// =============================================================================
// Exportar el catálogo de renta fija (completo o filtrado, según lo que reciba) a CSV — puro y
// testeado, igual criterio que el resto de engine/. La UI (RadarPage) pasa exactamente `ordenados`
// (ya filtrado + ordenado + con destacados arriba), así el CSV siempre coincide con lo que se ve
// en pantalla, sin un modo "completo" separado del "filtrado".
//
// Separador ';' (no ','): en Excel configurado en español, la coma es el separador decimal — un
// CSV separado por comas con números tipo "14.56" puede terminar todo en una sola columna al
// abrirlo. ';' no colisiona con eso sin importar el locale.
// =============================================================================

import type { BonoReferenciaCalc } from './rentaFija';
import { TIPO_LABEL } from './rentaFija';
import { ETIQUETA_GRADO } from './rating';

const SEP = ';';

// RFC 4180: si el campo contiene el separador, una comilla o un salto de línea, envolver en
// comillas y duplicar las comillas internas. Sin esto, un emisor con "S.A., Inc." o una comilla en
// el nombre correría todo el resto de la fila a la columna siguiente.
function csvField(v: string | number | null): string {
  if (v == null) return '';
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADERS = [
  'Ticker', 'Tipo', 'Emisor', 'Nombre', 'Moneda', 'Vencimiento',
  'Calificadora', 'Calificación', 'Grado', 'Escala',
  'Paridad (%)', 'TIR (%)', 'Duración Macaulay (años)', 'Rendimiento corriente (%)',
  'Volumen promedio (USD)', 'Volumen mediana (USD)', 'Volumen mínimo reciente (USD)', 'Ruedas con dato',
];

// Porcentajes se exportan YA multiplicados por 100 (con el header aclarándolo) — exportar la
// fracción cruda (0.0842) sin aclarar es la fuente más común de un CSV mal leído después. Fechas en
// ISO (YYYY-MM-DD): ordenan bien como texto y no dependen de si Excel interpreta día/mes a la
// argentina o al revés.
export function bonosACSV(calcs: BonoReferenciaCalc[]): string {
  const filas = calcs.map(c => [
    c.ref.ticker,
    TIPO_LABEL[c.ref.tipo],
    c.ref.emisor ?? '',
    c.ref.nombre ?? '',
    c.ref.moneda,
    c.ref.vencimiento,
    c.ref.calificadora ?? '',
    c.ref.calificacion ?? '',
    c.grado ? ETIQUETA_GRADO[c.grado] : '',
    c.escalaGrado === 'global' ? 'Global' : c.escalaGrado === 'local' ? 'Nacional (Arg.)' : '',
    c.paridad != null ? c.paridad.toFixed(2) : '',
    c.tir != null ? (c.tir * 100).toFixed(2) : '',
    c.duracion != null ? c.duracion.macaulay.toFixed(2) : '',
    c.rendCorriente != null ? (c.rendCorriente * 100).toFixed(2) : '',
    c.volumen != null ? c.volumen.mediaUsd.toFixed(0) : '',
    c.volumen != null ? c.volumen.medianaUsd.toFixed(0) : '',
    c.volumen != null ? c.volumen.minimoUsd.toFixed(0) : '',
    c.volumen != null ? String(c.volumen.diasConDatos) : '',
  ].map(csvField).join(SEP));

  // BOM UTF-8: sin esto, Excel muestra mal los tildes/ñ de nombres de emisores/instrumentos al
  // abrir el archivo directamente (no es un problema del navegador ni del CSV en sí, es cómo Excel
  // adivina la codificación cuando no hay BOM).
  return '﻿' + [HEADERS.join(SEP), ...filas].join('\r\n');
}

export function nombreArchivoCsv(hoy: string): string {
  return `renta-fija-${hoy}.csv`;
}
