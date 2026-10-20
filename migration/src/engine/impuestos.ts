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

export function paramsBP(anio: number): ParamsBPResueltos | null {
  const exacto = BIENES_PERSONALES[anio];
  if (exacto) return { ...exacto, anioParams: anio, estimado: false };
  const previos = Object.keys(BIENES_PERSONALES).map(Number).filter(a => a < anio).sort((a, b) => b - a);
  if (previos.length === 0) return null;
  return { ...BIENES_PERSONALES[previos[0]], anioParams: previos[0], estimado: true };
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

export function evaluarBienesPersonales(patrimonioUsd: number, mep: number, params: ParamsBP): EvaluacionBP | null {
  if (!(mep > 0) || !(params.minimoNoImponible > 0)) return null;
  const patrimonioArs = patrimonioUsd * mep;
  const ratio = patrimonioArs / params.minimoNoImponible;
  const nivel: NivelBP = ratio >= 1 ? 'neg' : ratio >= BP_UMBRAL_WARN ? 'warn' : ratio >= BP_UMBRAL_INFO ? 'info' : 'ok';
  return {
    patrimonioArs,
    minimoArs: params.minimoNoImponible,
    ratio,
    margenUsd: params.minimoNoImponible / mep - patrimonioUsd,
    nivel,
  };
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
