// Costos de un cobro (dividendo / cupón): retención de impuestos y comisión del bróker. Puro y testeado (regla de oro #1).
//
// TASAS ESTIMADAS — observadas en los pagos reales de IOL (get_activities, 2025-2026), NO son un dato fiscal oficial:
//   · Dividendo de CEDEAR: IOL acreditó el 64,7 % (UNH), 64,7 % (MSFT) y 63,8 % (MA) de lo declarado por el emisor → retención ≈ 35,5 %.
//   · Comisión del bróker: cada pago trae un débito en pesos de ≈ 0,72 % de lo acreditado en dividendos y ≈ 0,45 % en cupones de ON.
//   · Cupones de ON locales: sin retención (el neto acreditado coincide con el cupón).
// Sirven para proyectar y para registrar un cobro cuando todavía no hay el dato real; el dato real (lo que figura en el bróker) siempre
// lo pisa. Todo cobro con costos estimados se marca `costos_estimados` para no confundirlo con un neto verificado.

export const TASA_RETENCION_DIVIDENDO = 0.355;
export const TASA_COMISION_DIVIDENDO = 0.0072;     // sobre lo que queda después de la retención
export const TASA_COMISION_INTERES = 0.0045;       // sobre el cupón
export const TASA_COMISION_AMORTIZACION = 0;       // sin datos observados: no se estima

export type TipoCobroCosto = 'dividendo' | 'interes' | 'amortizacion';

export interface TasasCobro { retencion: number; comision: number }

// Tasas por defecto según el tipo de cobro.
export function tasasPorDefecto(tipo: TipoCobroCosto): TasasCobro {
  if (tipo === 'dividendo') return { retencion: TASA_RETENCION_DIVIDENDO, comision: TASA_COMISION_DIVIDENDO };
  if (tipo === 'interes') return { retencion: 0, comision: TASA_COMISION_INTERES };
  return { retencion: 0, comision: TASA_COMISION_AMORTIZACION };
}

export interface CostosCobro {
  bruto: number; retencion: number; comision: number; neto: number;   // USD
  tasas: TasasCobro;
}

const r2 = (x: number) => +x.toFixed(2);

// bruto → retención (bruto × tasa) → comisión ((bruto − retención) × tasa) → neto. Tasas acotadas a [0, 1).
export function calcularCostosCobro(bruto: number, tasas: TasasCobro): CostosCobro {
  const b = Number.isFinite(bruto) && bruto > 0 ? bruto : 0;
  const tr = Math.min(Math.max(Number(tasas.retencion) || 0, 0), 0.99);
  const tc = Math.min(Math.max(Number(tasas.comision) || 0, 0), 0.99);
  const retencion = r2(b * tr);
  const comision = r2((b - retencion) * tc);
  return { bruto: r2(b), retencion, comision, neto: r2(b - retencion - comision), tasas: { retencion: tr, comision: tc } };
}

export const estimarCostosCobro = (tipo: TipoCobroCosto, bruto: number): CostosCobro => calcularCostosCobro(bruto, tasasPorDefecto(tipo));

// Neto estimado de un conjunto de cobros proyectados (para mostrar al lado del bruto). Cada item trae su tipo y su monto bruto.
export function netoEstimado(items: { tipo: TipoCobroCosto; monto: number }[]): { bruto: number; costos: number; neto: number } {
  let b = 0, c = 0, n = 0;
  for (const it of items) { const x = estimarCostosCobro(it.tipo, it.monto); b += x.bruto; c += x.retencion + x.comision; n += x.neto; }
  return { bruto: r2(b), costos: r2(c), neto: r2(n) };
}

// Costos YA registrados en un cobro (si los hay): para mostrar el detalle en el historial.
export interface CostosRegistrados { bruto: number; retencion: number; comision: number; estimados: boolean }
export function costosRegistrados(c: { monto: number; monto_bruto?: number | null; retencion_usd?: number | null; comision_usd?: number | null; costos_estimados?: boolean | null }): CostosRegistrados | null {
  const bruto = Number(c.monto_bruto);
  if (!Number.isFinite(bruto) || !(bruto > 0)) return null;
  const retencion = Number(c.retencion_usd) || 0, comision = Number(c.comision_usd) || 0;
  if (retencion === 0 && comision === 0) return null;
  return { bruto, retencion, comision, estimados: !!c.costos_estimados };
}
