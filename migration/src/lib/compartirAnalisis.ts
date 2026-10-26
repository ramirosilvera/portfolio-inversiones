// =============================================================================
// Resumen COMPARTIBLE de un análisis (CEDEAR o bono): los mismos números que ya muestra la pantalla, ordenados para una imagen vertical
// y un texto de WhatsApp. Puro y testeado. Nunca lleva datos de la cartera del usuario (nominales, monto, P&L): solo el análisis del activo.
// Los números los calcula el código (regla de oro #1); acá solo se formatean.
// =============================================================================

import { fmtUsd, fmtPct, fmtNum } from '../components/ui';
import type { DcfResult } from '../engine/dcf';
import type { Ratios } from '../types/domain';
import type { BonoReferencia, BonoReferenciaCalc } from '../engine/rentaFija';
import { VERIFICACION, esConfiable, nivelDe } from '../engine/verificacion';

export type TonoCompartir = 'pos' | 'neg' | 'warn' | 'neutral';

export interface ResumenCompartible {
  tipo: 'cedear' | 'bono';
  titulo: string;                       // ticker
  subtitulo: string;                    // nombre / emisor
  veredicto: { texto: string; tono: TonoCompartir } | null;
  metricas: { etiqueta: string; valor: string; tono?: TonoCompartir }[];
  avisos: string[];                     // advertencias que NO pueden perderse al compartir (datos sin verificar, supuestos frágiles)
  fuente: string;
  fecha: string;                        // AAAA-MM-DD del cálculo
}

export const PIE_LEGAL = 'Estimación basada en supuestos propios, no es una recomendación de inversión.';

export function resumenCedear(p: {
  ticker: string; nombre?: string | null; precio: number | null; dcf: DcfResult; ratios: Ratios; d: number; g: number; mosRequerido: number;
  fuente: string; fecha: string;
}): ResumenCompartible {
  const { dcf, ratios: r } = p;
  const tono: TonoCompartir = dcf.verdict === 'COMPRAR' ? 'pos' : dcf.verdict === 'CARO' ? 'neg' : 'warn';
  const roicOk = r.roic != null && r.wacc != null && r.roic > r.wacc;
  return {
    tipo: 'cedear', titulo: p.ticker, subtitulo: p.nombre ?? '',
    veredicto: { texto: dcf.verdict === 'SIN_DATOS' ? 'SIN DATOS' : dcf.verdict, tono },
    metricas: [
      { etiqueta: 'Precio', valor: fmtUsd(p.precio) },
      { etiqueta: 'Valor intrínseco', valor: fmtUsd(dcf.intrinsicPerShare) },
      { etiqueta: 'Margen de seguridad', valor: fmtPct(dcf.marginOfSafety, 0), tono: dcf.marginOfSafety == null ? undefined : dcf.marginOfSafety >= 0 ? 'pos' : 'neg' },
      { etiqueta: 'Exigido', valor: fmtPct(p.mosRequerido, 0) },
      { etiqueta: 'Tasa de descuento', valor: fmtPct(p.d, 1) },
      { etiqueta: 'Crecimiento (g)', valor: fmtPct(p.g, 1) },
      { etiqueta: 'P/E', valor: fmtNum(r.pe, 1) },
      { etiqueta: 'ROIC vs WACC', valor: `${fmtPct(r.roic, 0)} / ${fmtPct(r.wacc, 0)}`, tono: roicOk ? 'pos' : 'warn' },
      { etiqueta: 'Margen operativo', valor: fmtPct(r.operatingMargin, 0) },
      { etiqueta: 'Deuda / Patrimonio', valor: fmtNum(r.debtToEquity, 2) },
    ],
    avisos: dcf.motivoInestable ? [`El veredicto no puede ser COMPRAR: ${dcf.motivoInestable}.`] : [],
    fuente: p.fuente, fecha: p.fecha,
  };
}

export function resumenBono(p: {
  ref: BonoReferencia; calc: BonoReferenciaCalc; spreadUst: number | null; fecha: string;
}): ResumenCompartible {
  const { ref, calc } = p;
  const nivel = nivelDe(ref);
  const avisos: string[] = [];
  // Una imagen sin contexto se reenvía sola: si los flujos no son confiables, el aviso viaja pegado a los números.
  if (!esConfiable(ref)) avisos.push(`Datos del cronograma — ${VERIFICACION[nivel].label}. No decidas con estos números sin revisarlos.`);
  if (calc.px == null) avisos.push('Sin cotización: no hay TIR ni duración.');
  const calif = ref.calificacion ? `${ref.calificadora ?? ''} ${ref.calificacion}`.trim() : 'sin calificar';
  return {
    tipo: 'bono', titulo: ref.ticker, subtitulo: `${ref.nombre || ref.ticker}${ref.emisor ? ` · ${ref.emisor}` : ''}`,
    veredicto: { texto: VERIFICACION[nivel].label, tono: esConfiable(ref) ? 'pos' : nivel === 'inconsistente' ? 'neg' : 'warn' },
    metricas: [
      { etiqueta: 'Precio', valor: fmtUsd(calc.px) },
      { etiqueta: 'TIR', valor: calc.tir != null ? fmtPct(calc.tir) : '—' },
      { etiqueta: 'Rend. corriente', valor: calc.rendCorriente != null ? fmtPct(calc.rendCorriente) : '—' },
      { etiqueta: 'Paridad', valor: calc.paridad != null ? `${calc.paridadAprox ? '≈' : ''}${fmtNum(calc.paridad, 1)}%` : '—' },
      { etiqueta: 'Duración', valor: calc.duracion ? `${fmtNum(calc.duracion.macaulay, 1)} años` : '—' },
      { etiqueta: 'Spread vs UST 10Y', valor: p.spreadUst != null ? fmtPct(p.spreadUst) : '—' },
      { etiqueta: 'Vencimiento', valor: ref.vencimiento },
      { etiqueta: 'Calificación', valor: calif },
    ],
    avisos, fuente: `Catálogo de referencia (${ref.fuente.split('|')[0].trim()}) y cotización de mercado`, fecha: p.fecha,
  };
}

// Texto para WhatsApp (negritas con *…*): mismo contenido que la imagen, en lectura corrida.
export function textoWhatsApp(r: ResumenCompartible): string {
  const l: string[] = [];
  l.push(`*${r.titulo}*${r.subtitulo ? ` — ${r.subtitulo}` : ''}`);
  if (r.veredicto) l.push(`*${r.veredicto.texto}*`);
  for (const m of r.metricas) l.push(`• ${m.etiqueta}: ${m.valor}`);
  for (const a of r.avisos) l.push(`⚠ ${a}`);
  l.push('', `_${PIE_LEGAL}_`, `Fuente: ${r.fuente} · ${r.fecha}`);
  return l.join('\n');
}

export function urlWhatsApp(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

export function nombreArchivo(r: ResumenCompartible): string {
  return `analisis-${r.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${r.fecha}.png`;
}
