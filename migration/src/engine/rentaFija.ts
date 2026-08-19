// =============================================================================
// Renta fija "de referencia": bonos/ONs del catálogo compartido (bonos_referencia, poblado desde
// IOL — ver migración 0034), no necesariamente en cartera. Combina el cronograma real con el precio
// de mercado (data912, mismo `api.bonos()` que ya usa BonosPage) para dar TIR/duración/paridad sin
// que el usuario cargue cupón a mano. Puro y testeado — igual criterio que engine/bonos.ts, pero para
// el universo de seguimiento (Radar) en vez de la cartera.
// =============================================================================

import { ytmFromCronograma, bondDurationFromCronograma, rendimientoCorrienteFromCronograma, type CronogramaItem } from './coupons';
import { clasificarRating, type GradoCredito, type EscalaRating } from './rating';
import { volumenStatsFromRef, type VolumenStats } from './volumenRentaFija';

// Mismo criterio que Posicion en types/domain.ts: los campos mirror 1:1 las columnas de
// bonos_referencia (snake_case) — sin capa de mapeo entre la fila de Supabase y el tipo de TS.
export interface BonoReferencia {
  ticker: string;
  tipo: 'soberano' | 'on' | 'subsoberano';
  instrumento: 'BOND' | 'NOTE';
  // Solo USD por ahora (ver CHECK de la migración 0034): el cronograma es una fracción 0..1
  // currency-agnostic del nominal, pero valuarlo en USD para una especie que en los hechos paga en
  // PESOS requeriría un supuesto de tipo de cambio futuro que este motor no modela — mejor no
  // ofrecer el catálogo para esas especies que dar una TIR en USD que asume un MEP constante.
  moneda: 'USD';
  nombre: string | null;
  // Emisor estructurado (ej. "YPF", "República Argentina", "BCRA") — derivado de `nombre` al
  // cargar, no texto libre a mostrar. Puede faltar: notas cortas de emisores chicos que la carga
  // automática todavía no identificó.
  emisor: string | null;
  emision: string | null;
  vencimiento: string;
  amortizable: boolean;
  valor_residual: number;
  cronograma: CronogramaItem[];
  fuente: string;
  actualizado_en: string;
  // Cargada A MANO por el usuario (no hay API gratuita que la dé, ver engine/rating.ts) — a
  // diferencia del resto de la fila, que solo puebla el proceso de actualización desde IOL. Mismos
  // dos campos y mismo criterio de clasificación que Posicion.calificadora/calificacion — reusar
  // clasificarRating() de engine/rating.ts, no reinventar la escala acá.
  calificadora: string | null;
  calificacion: string | null;
  // Volumen operado (USD, últimas ~20 ruedas) — mismo criterio que cronograma: lo puebla el proceso
  // de actualización con service-role (IOL get_price_history, ver migración 0040), nunca el
  // cliente. null en las 4 columnas = catálogo todavía no refrescado con esta feature, o ticker sin
  // historial de precio suficiente — ver volumenStatsFromRef (engine/volumenRentaFija.ts).
  vol_media_usd: number | null;
  vol_mediana_usd: number | null;
  vol_minimo_usd: number | null;
  vol_dias_con_datos: number | null;
}

export const TIPO_LABEL: Record<BonoReferencia['tipo'], string> = {
  soberano: 'Soberano',
  subsoberano: 'Subsoberano',
  on: 'ON',
};

export interface BonoReferenciaCalc {
  ref: BonoReferencia;
  px: number | null;        // precio por nominal, USD (data912/api.bonos())
  paridad: number | null;   // px * 100
  tir: number | null;
  duracion: { macaulay: number; modified: number } | null;
  // Cupón anualizado / precio (ignora pull-to-par, a diferencia de la TIR) — ver
  // rendimientoCorrienteFromCronograma(). null si no hay 2 flujos futuros de dónde inferir la
  // frecuencia (último período del bono), igual límite que tir/duracion en ese caso puntual.
  rendCorriente: number | null;
  // null = sin calificar, calificadora 'Otra' (notación desconocida), o nota que no matchea
  // ninguna escala conocida — nunca "adivina" un grado (ver clasificarRating).
  grado: GradoCredito | null;
  escalaGrado: EscalaRating | null;
  // null = catálogo todavía no refrescado con volumen para este ticker (ver BonoReferencia arriba).
  volumen: VolumenStats | null;
}

// `px` es SIEMPRE en USD (misma convención que el resto de la app — ver esHardDollar en
// functions/api/market/bonos.ts, que ya convierte las especies en pesos a USD con el MEP antes de
// devolver el mapa). El cronograma también está en la moneda de emisión del bono (USD para los
// soberanos/ONs hard-dollar de este catálogo), así que ambos son consistentes sin conversión extra.
export function calcularBonoReferencia(ref: BonoReferencia, px: number | null, hoy: string): BonoReferenciaCalc {
  const paridad = px != null ? px * 100 : null;
  const tir = px != null ? ytmFromCronograma(px, ref.cronograma, hoy) : null;
  const duracion = tir != null ? bondDurationFromCronograma(ref.cronograma, tir, hoy) : null;
  const rendCorriente = px != null ? rendimientoCorrienteFromCronograma(px, ref.cronograma, hoy) : null;
  const clasif = clasificarRating(ref.calificadora, ref.calificacion);
  const volumen = volumenStatsFromRef(ref);
  return { ref, px, paridad, tir, duracion, rendCorriente, grado: clasif?.grado ?? null, escalaGrado: clasif?.escala ?? null, volumen };
}

export interface Comparable extends BonoReferenciaCalc {
  // true si comparte grado de riesgo con el bono de referencia (o si ninguno de los dos está
  // calificado) — la UI lo usa para separar "de riesgo comparable" de "relleno" cuando no hay
  // suficientes bonos del mismo grado en el catálogo.
  mismoGrado: boolean;
}

const GRADO_RANGO: Record<GradoCredito, number> = { grado_inversion: 0, especulativo: 1, default: 2 };

// Bonos "comparables" a `target`: mismo grado de riesgo crediticio primero (grado de inversión /
// especulativo / default — nunca mezcla escala global con nacional porque el grado ya viene
// normalizado por clasificarRating), ordenados dentro de ese grupo por duración más cercana — así se
// comparan manzanas con manzanas (mismo riesgo, mismo horizonte) en vez de listar la mejor TIR del
// catálogo entero, que puede ser la mejor simplemente porque es más riesgosa o más larga. Si no hay
// suficientes del mismo grado, se completa con el resto del catálogo (también por duración más
// cercana) para no dejar la lista vacía — marcados `mismoGrado: false` para que la UI distinga.
// Un bono sin calificar (grado null) se compara contra otros sin calificar primero, nunca se asume
// que "sin calificar" equivale a un grado conocido.
export function comparables(target: BonoReferenciaCalc, universo: BonoReferenciaCalc[], n = 6): Comparable[] {
  const elegibles = universo.filter(c => c.ref.ticker !== target.ref.ticker && c.tir != null);
  const durTarget = target.duracion?.macaulay ?? null;
  const porDuracion = (lista: BonoReferenciaCalc[]) => [...lista].sort((a, b) => {
    const da = durTarget != null && a.duracion != null ? Math.abs(a.duracion.macaulay - durTarget) : Infinity;
    const db = durTarget != null && b.duracion != null ? Math.abs(b.duracion.macaulay - durTarget) : Infinity;
    return da - db;
  });

  const mismoGradoQ = (c: BonoReferenciaCalc) => target.grado != null ? c.grado === target.grado : c.grado == null;
  const primarios = porDuracion(elegibles.filter(mismoGradoQ));
  if (primarios.length >= n) return primarios.slice(0, n).map(c => ({ ...c, mismoGrado: true }));

  // Relleno: prioriza grado más CERCANO al del target (no cualquiera) y, dentro de esa cercanía,
  // duración más cercana — así "especulativo" completa antes con "grado de inversión" que con
  // "default", aunque este último tenga una duración más parecida.
  const resto = elegibles.filter(c => !mismoGradoQ(c)).sort((a, b) => {
    const ga = a.grado != null && target.grado != null ? Math.abs(GRADO_RANGO[a.grado] - GRADO_RANGO[target.grado]) : 3;
    const gb = b.grado != null && target.grado != null ? Math.abs(GRADO_RANGO[b.grado] - GRADO_RANGO[target.grado]) : 3;
    if (ga !== gb) return ga - gb;
    const da = durTarget != null && a.duracion != null ? Math.abs(a.duracion.macaulay - durTarget) : Infinity;
    const db = durTarget != null && b.duracion != null ? Math.abs(b.duracion.macaulay - durTarget) : Infinity;
    return da - db;
  }).slice(0, n - primarios.length);
  return [...primarios.map(c => ({ ...c, mismoGrado: true })), ...resto.map(c => ({ ...c, mismoGrado: false }))];
}

// Referencia rápida para "cómo se para este bono frente a lo comparable": TIR promedio (simple, no
// ponderada por capital — no hay una cartera acá, es el catálogo entero) de los comparables del MISMO
// grado únicamente (ignora los de relleno) — null si no hay ninguno del mismo grado con TIR.
export function tirPromedioComparables(comps: Comparable[]): number | null {
  const delMismoGrado = comps.filter(c => c.mismoGrado && c.tir != null);
  if (!delMismoGrado.length) return null;
  return delMismoGrado.reduce((s, c) => s + c.tir!, 0) / delMismoGrado.length;
}
