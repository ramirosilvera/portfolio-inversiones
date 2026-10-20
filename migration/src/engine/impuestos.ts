// =============================================================================
// Impuestos de referencia (Argentina, persona humana residente) — puro y testeado.
//
// ALCANCE (a propósito acotado): la app solo conoce el patrimonio de tus portfolios y los cobros
// que registraste. NO conoce el resto de tus bienes ni de tus ingresos (sueldo, alquileres,
// deducciones), así que acá NO se calcula cuánto pagás: se avisa CUÁNDO conviene mirar y se da el
// dato para el contador. Los montos a pagar dependen de tu situación completa.
//
// Los parámetros oficiales (mínimo no imponible, vencimientos) los publica ARCA cada año: viven
// en las tablas de abajo con su fuente. Cuando no hay uno para el año pedido se usa el último
// conocido y se marca `estimado` (el mínimo se actualiza por IPC cada año, así que el viejo es
// siempre MÁS BAJO que el real: la estimación es conservadora).
// =============================================================================

import type { AssetType, Cobro } from '../types/domain';
import type { Alerta } from './alertas';

// ── Bienes Personales ────────────────────────────────────────────────────────
export interface ParamsBP {
  minimoNoImponible: number;   // ARS — por debajo de esto no se paga
  casaHabitacion: number;      // ARS — umbral de exención de la vivienda (no aplica a los portfolios)
  fuente: string;
}

export const BIENES_PERSONALES: Record<number, ParamsBP> = {
  2025: {
    minimoNoImponible: 384_728_044.57,
    casaHabitacion: 1_346_548_155.99,
    fuente: 'ARCA — mínimos y escalas del período fiscal 2025 (varias fuentes profesionales coinciden)',
  },
};

export interface ParamsBPResueltos extends ParamsBP { anioParams: number; estimado: boolean }

// Fila de parámetros que viene de la base (tabla impuestos_parametros, la mantiene el servidor): `estimado` = calculada con el IPC
// mientras ARCA no publica la oficial. Una fila oficial (estimado = false) pisa a la del código; una estimada nunca pisa a la del código.
export type Fila<T> = T & { estimado?: boolean };

function resolver<T extends object>(codigo: Record<number, T>, extra: Record<number, Fila<T>>, anio: number): { fila: T; anio: number; estimado: boolean } | null {
  const candidato = (a: number): { fila: T; estimado: boolean } | null => {
    const e = extra[a];
    if (e && !e.estimado) return { fila: e, estimado: false };
    if (codigo[a]) return { fila: codigo[a], estimado: false };
    if (e) return { fila: e, estimado: true };
    return null;
  };
  const exacto = candidato(anio);
  if (exacto) return { ...exacto, anio };
  // Sin dato del año: el último conocido, siempre marcado estimado (el mínimo sube por IPC, así que el viejo es más bajo: cota conservadora).
  const previos = [...new Set([...Object.keys(codigo), ...Object.keys(extra)].map(Number))].filter(a => a < anio).sort((a, b) => b - a);
  for (const a of previos) {
    const c = candidato(a);
    if (c) return { fila: c.fila, anio: a, estimado: true };
  }
  return null;
}

export function paramsBP(anio: number, extra: Record<number, Fila<ParamsBP>> = {}): ParamsBPResueltos | null {
  const r = resolver(BIENES_PERSONALES, extra, anio);
  return r ? { ...r.fila, anioParams: r.anio, estimado: r.estimado } : null;
}

export interface ItemPatrimonio { tipo: AssetType; valorUsd: number }

export interface PatrimonioImponible {
  /** Todo lo que está en los portfolios (incluye liquidez y bonos). Es el que dispara las alertas: no depende de ninguna exención. */
  total: number;
  /** Sin bonos/ONs (suelen estar exentos de Bienes Personales) ni acciones locales (tributan por la sociedad). Hipótesis a confirmar con tu contador. */
  probable: number;
  bonos: number;
  accionesLocales: number;
  liquidez: number;
}

export function patrimonioImponible(items: ItemPatrimonio[]): PatrimonioImponible {
  let total = 0, bonos = 0, accionesLocales = 0, liquidez = 0;
  for (const it of items) {
    if (!(it.valorUsd > 0)) continue;
    total += it.valorUsd;
    if (it.tipo === 'bono') bonos += it.valorUsd;
    else if (it.tipo === 'accion_ar') accionesLocales += it.valorUsd;
    else if (it.tipo === 'cash') liquidez += it.valorUsd;
  }
  return { total, probable: total - bonos - accionesLocales, bonos, accionesLocales, liquidez };
}

export type NivelBP = 'ok' | 'info' | 'warn' | 'neg';

export interface EvaluacionBP {
  patrimonioArs: number;
  minimoArs: number;
  ratio: number;             // patrimonio / mínimo
  margenUsd: number;         // cuánto falta (o sobra, si negativo) para el mínimo
  nivel: NivelBP;
}

export const BP_UMBRAL_INFO = 0.5;
export const BP_UMBRAL_WARN = 0.8;

/** `otrosArs`: bienes fuera de los portfolios ya en pesos (ver patrimonioOtrosArs). El margen se expresa en USD al mismo MEP. */
export function evaluarBienesPersonales(patrimonioUsd: number, mep: number, params: ParamsBP, otrosArs = 0): EvaluacionBP | null {
  if (!(mep > 0) || !(params.minimoNoImponible > 0)) return null;
  const patrimonioArs = patrimonioUsd * mep + (otrosArs > 0 ? otrosArs : 0);
  const ratio = patrimonioArs / params.minimoNoImponible;
  const nivel: NivelBP = ratio >= 1 ? 'neg' : ratio >= BP_UMBRAL_WARN ? 'warn' : ratio >= BP_UMBRAL_INFO ? 'info' : 'ok';
  return {
    patrimonioArs,
    minimoArs: params.minimoNoImponible,
    ratio,
    margenUsd: (params.minimoNoImponible - patrimonioArs) / mep,
    nivel,
  };
}

// ── Parámetros que mantiene el servidor (tabla impuestos_parametros) ─────────
export interface FilaParametroDB { anio: number; clave: string; valor: unknown; estimado: boolean; verificado: boolean; fuente: string }
export interface ParametrosImpuestos {
  params: Record<number, Fila<ParamsBP>>;
  escalas: Record<number, Fila<EscalaBP>>;
  verificado: Record<number, boolean>;   // el año tiene ambas filas contrastadas con ARCA
}

const esNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const esTramo = (t: unknown): t is TramoBP => {
  const x = t as TramoBP;
  return !!x && esNum(x.fijo) && esNum(x.alicuota) && (x.hasta === null || esNum(x.hasta));
};

/** Filas de la base → mapas por año. Una fila mal formada se descarta (no rompe el cálculo: se cae a las constantes del código). */
export function parametrosDesdeFilas(rows: FilaParametroDB[]): ParametrosImpuestos {
  const params: ParametrosImpuestos['params'] = {};
  const escalas: ParametrosImpuestos['escalas'] = {};
  const ver: Record<number, { p: boolean; e: boolean }> = {};
  for (const r of rows) {
    const v = r.valor as Record<string, unknown> | null;
    if (r.clave === 'bp_params' && v && esNum(v.minimoNoImponible) && esNum(v.casaHabitacion) && v.minimoNoImponible > 0) {
      params[r.anio] = { minimoNoImponible: v.minimoNoImponible, casaHabitacion: v.casaHabitacion, fuente: r.fuente, estimado: !!r.estimado };
      (ver[r.anio] ??= { p: false, e: false }).p = !!r.verificado;
    } else if (r.clave === 'bp_escala' && v && Array.isArray(v.tramos) && v.tramos.length > 0 && v.tramos.every(esTramo)) {
      escalas[r.anio] = { tramos: v.tramos as TramoBP[], fuente: r.fuente, estimado: !!r.estimado };
      (ver[r.anio] ??= { p: false, e: false }).e = !!r.verificado;
    }
  }
  return { params, escalas, verificado: Object.fromEntries(Object.entries(ver).map(([a, x]) => [a, x.p && x.e])) };
}

// ── Otros bienes (fuera de los portfolios) ───────────────────────────────────
export type TipoOtroBien = 'vehiculo' | 'inmueble' | 'casa_habitacion' | 'efectivo' | 'exterior' | 'otro';
export type BaseValuacion = 'valuacion_arca' | 'seguro' | 'mercado' | 'costo';

export const TIPO_OTRO_LABEL: Record<TipoOtroBien, string> = {
  vehiculo: 'Vehículo', inmueble: 'Inmueble', casa_habitacion: 'Casa-habitación', efectivo: 'Efectivo / cuentas',
  exterior: 'Exterior', otro: 'Otro',
};
export const BASE_LABEL: Record<BaseValuacion, string> = {
  valuacion_arca: 'Valuación ARCA', seguro: 'Valor del seguro', mercado: 'Valor de mercado', costo: 'Costo de compra',
};
/** Solo la tabla oficial de ARCA al 31/12 es el valor que cuenta para el impuesto; las demás son provisorias. */
export const esProvisoria = (base: BaseValuacion) => base !== 'valuacion_arca';

export interface OtroBien { tipo: TipoOtroBien; valor_ars: number; base: BaseValuacion }

/**
 * Suma en pesos de los bienes fuera de los portfolios que entran al impuesto. La casa-habitación queda afuera mientras no supere el
 * umbral de exención; si lo supera, el umbral no es una deducción: la ley la deja de considerar exenta y entra completa.
 */
export function patrimonioOtrosArs(otros: OtroBien[], params: Pick<ParamsBP, 'casaHabitacion'>): number {
  let total = 0;
  for (const b of otros) {
    const v = Number(b.valor_ars);
    if (!(v > 0)) continue;
    if (b.tipo === 'casa_habitacion' && v <= params.casaHabitacion) continue;
    total += v;
  }
  return total;
}

// ── Cálculo del impuesto de Bienes Personales ────────────────────────────────
// Escala sobre el EXCEDENTE del mínimo no imponible: cuota fija + alícuota × (excedente − piso del tramo). `hasta` es el tope del
// excedente de cada tramo (null = sin tope). Período 2025: tres tramos (0,5 / 0,75 / 1 %); el 1,25 % de 2024 se eliminó. Las cifras
// salen de la tabla de ARCA tal como la reproducen varias fuentes profesionales; cierran entre sí (263.321,42 = 0,5 % × 52.664.283,73).
// Los tramos 2026 todavía no se publicaron: usar los de 2025 es CONSERVADOR (la ley baja las alícuotas a 0,5–0,75 % en 2026 y 0,25 % en 2027).
export interface TramoBP { hasta: number | null; fijo: number; alicuota: number }
export interface EscalaBP { tramos: TramoBP[]; fuente: string }

export const ESCALA_BP: Record<number, EscalaBP> = {
  2025: {
    tramos: [
      { hasta: 52_664_283.73, fijo: 0, alicuota: 0.005 },
      { hasta: 114_105_948.16, fijo: 263_321.42, alicuota: 0.0075 },
      { hasta: null, fijo: 724_133.89, alicuota: 0.01 },
    ],
    fuente: 'ARCA — escala general del período fiscal 2025 (iProfesional, Blog del Contador y otras fuentes coinciden)',
  },
};

export interface EscalaBPResuelta extends EscalaBP { anioEscala: number; estimado: boolean }

export function escalaBP(anio: number, extra: Record<number, Fila<EscalaBP>> = {}): EscalaBPResuelta | null {
  const r = resolver(ESCALA_BP, extra, anio);
  return r ? { ...r.fila, anioEscala: r.anio, estimado: r.estimado } : null;
}

export interface ImpuestoBP {
  excedente: number;             // patrimonio − mínimo no imponible (0 si no lo supera)
  impuesto: number;              // ARS
  alicuotaMarginal: number | null;   // alícuota del tramo en que cae el excedente (null si no paga)
  alicuotaEfectiva: number;      // impuesto / patrimonio
}

export function calcularBienesPersonales(patrimonioArs: number, params: Pick<ParamsBP, 'minimoNoImponible'>, escala: Pick<EscalaBP, 'tramos'>): ImpuestoBP {
  const excedente = Math.max(0, patrimonioArs - params.minimoNoImponible);
  if (!(excedente > 0)) return { excedente: 0, impuesto: 0, alicuotaMarginal: null, alicuotaEfectiva: 0 };
  let piso = 0;
  for (const t of escala.tramos) {
    if (t.hasta == null || excedente <= t.hasta) {
      const impuesto = t.fijo + t.alicuota * (excedente - piso);
      return { excedente, impuesto, alicuotaMarginal: t.alicuota, alicuotaEfectiva: patrimonioArs > 0 ? impuesto / patrimonioArs : 0 };
    }
    piso = t.hasta;
  }
  return { excedente, impuesto: 0, alicuotaMarginal: null, alicuotaEfectiva: 0 };   // escala sin tramo final: no pasa con las tablas cargadas
}

// ── Ganancias: renta del exterior (dividendos de CEDEARs/ETFs) ───────────────
export interface GananciasAnio {
  anio: number;
  dividendosBruto: number;     // USD, antes de retención y comisiones
  retencionExterior: number;   // USD retenidos en el exterior (EE.UU. 30 %)
  dividendosNeto: number;      // USD acreditados
  cobros: number;
  sinDetalle: number;          // cobros sin bruto cargado (el bruto mostrado es el monto declarado)
  intereses: number;           // USD de cupones (ON/bonos): informativo
}

export function gananciasPorAnio(cobros: Cobro[]): GananciasAnio[] {
  const m = new Map<number, GananciasAnio>();
  const get = (anio: number) => {
    let g = m.get(anio);
    if (!g) { g = { anio, dividendosBruto: 0, retencionExterior: 0, dividendosNeto: 0, cobros: 0, sinDetalle: 0, intereses: 0 }; m.set(anio, g); }
    return g;
  };
  for (const c of cobros) {
    // Solo plata confirmada (mismo criterio que engine/cobros.ts): pendientes y descartados no cuentan.
    if (c.estado !== 'disponible' && c.estado !== 'reinvertido') continue;
    const anio = Number(c.fecha?.slice(0, 4));
    if (!Number.isFinite(anio)) continue;
    if (c.tipo === 'interes') { get(anio).intereses += Number(c.monto) || 0; continue; }
    if (c.tipo !== 'dividendo') continue;
    const g = get(anio);
    const neto = Number(c.monto) || 0;
    const bruto = c.monto_bruto != null ? Number(c.monto_bruto) : neto;
    g.cobros += 1;
    g.dividendosBruto += bruto;
    g.dividendosNeto += neto;
    g.retencionExterior += Number(c.retencion_usd) || 0;
    if (c.monto_bruto == null) g.sinDetalle += 1;
  }
  return [...m.values()].sort((a, b) => b.anio - a.anio);
}

// ── Calendario de declaraciones juradas ──────────────────────────────────────
// Vencimientos YA publicados por ARCA. Los años sin fila se estiman a fin de junio del año
// siguiente (el calendario habitual) y se marcan como tales; ARCA suele prorrogar.
export const VENCIMIENTO_DDJJ: Record<number, { fecha: string; fuente: string }> = {
  2025: { fecha: '2026-07-27', fuente: 'RG 5851/2026 (prórroga de Ganancias, Bienes Personales y Cedular)' },
};

export interface ProximaDDJJ {
  anioFiscal: number;
  fecha: string;
  estimado: boolean;
  dias: number;
  fuente: string | null;
}

const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000);

export function proximaDDJJ(hoy: string): ProximaDDJJ {
  const anioHoy = Number(hoy.slice(0, 4));
  // El período abierto es el último cuyo vencimiento todavía no pasó.
  for (const anioFiscal of [anioHoy - 1, anioHoy]) {
    const pub = VENCIMIENTO_DDJJ[anioFiscal];
    const fecha = pub?.fecha ?? `${anioFiscal + 1}-06-30`;
    if (fecha >= hoy) return { anioFiscal, fecha, estimado: !pub, dias: diasEntre(hoy, fecha), fuente: pub?.fuente ?? null };
  }
  // Inalcanzable (anioHoy siempre vence después de hoy) — por las dudas.
  const anioFiscal = anioHoy;
  return { anioFiscal, fecha: `${anioFiscal + 1}-06-30`, estimado: true, dias: diasEntre(hoy, `${anioFiscal + 1}-06-30`), fuente: null };
}

// ── Alertas ──────────────────────────────────────────────────────────────────
export const DDJJ_AVISO_DIAS = 60;

const fmtMillones = (n: number) => `$${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 0 })} M`;

export function alertasImpuestos(input: {
  bp: EvaluacionBP | null;
  bpEstimado: boolean;
  ddjj: ProximaDDJJ;
  dividendosAnioFiscal: number;   // USD brutos cobrados en el período fiscal abierto
}): Alerta[] {
  const out: Alerta[] = [];
  const { bp, ddjj } = input;
  if (bp && bp.nivel === 'neg') {
    out.push({ severidad: 'neg', texto: `Impuestos: tu patrimonio en los portfolios (≈ ${fmtMillones(bp.patrimonioArs)}) supera el mínimo no imponible de Bienes Personales (${fmtMillones(bp.minimoArs)}${input.bpEstimado ? ', el último publicado' : ''}). Probablemente corresponda presentar y pagar: consultalo con tu contador.` });
  } else if (bp && bp.nivel === 'warn') {
    out.push({ severidad: 'warn', texto: `Impuestos: tu patrimonio en los portfolios ya está al ${Math.round(bp.ratio * 100)} % del mínimo no imponible de Bienes Personales (${fmtMillones(bp.minimoArs)}). Te quedan ≈ US$ ${Math.round(bp.margenUsd).toLocaleString('es-AR')} de margen.` });
  }
  if (ddjj.dias <= DDJJ_AVISO_DIAS && input.dividendosAnioFiscal > 0) {
    out.push({ severidad: 'warn', texto: `Impuestos: la declaración jurada ${ddjj.anioFiscal} vence ${ddjj.estimado ? 'hacia ' : 'el '}${ddjj.fecha} (en ${ddjj.dias} días) y cobraste US$ ${Math.round(input.dividendosAnioFiscal).toLocaleString('es-AR')} brutos en dividendos del exterior que se declaran en Ganancias.` });
  }
  return out;
}
