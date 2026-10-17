// Costos de un cobro (dividendo / cupón). Puro y testeado (regla de oro #1). Tres capas, que NO dependen de lo mismo:
//   1. RETENCIÓN de Estados Unidos sobre dividendos de CEDEARs: 30 % para argentinos (no hay convenio). Universal, no depende del broker.
//   2. COMISIÓN DEL BANCO DEPOSITARIO del CEDEAR (la fija cada anuncio de Caja de Valores sobre el dividendo bruto; Caterpillar 2022: 8,4 %).
//      Tampoco es del broker: depende del CEDEAR/banco emisor. En tus pagos de IOL salió ≈ 5,5 % del bruto (UNH, MSFT, MA acreditados al 64,7 %,
//      64,7 % y 63,8 %: 1 − 0,30 − 0,055 ≈ 0,645).
//   3. COMISIÓN DEL BROKER sobre el pago: la única que cambia de broker. IOL debita en pesos ≈ 0,72 % de lo acreditado en dividendos y
//      ≈ 0,45 % en cupones de ON. BBVA y Santander: sin dato (no se encontró su tarifario del plan Black) → se usa la general hasta que
//      cargues la tuya en Brokers.
// Los cupones de ON locales no tienen retención ni comisión depositaria. Sirve para proyectar y registrar cuando no hay el dato real; el
// dato real (lo que acreditó el bróker) siempre lo pisa. Todo cobro con costos estimados se marca `costos_estimados`.

export const TASA_RETENCION_EEUU = 0.30;
export const TASA_COMISION_DEPOSITARIA = 0.055;
export const TASA_COMISION_BROKER_DIVIDENDO = 0.0072;   // sobre lo que queda después de retención y comisión depositaria
export const TASA_COMISION_BROKER_INTERES = 0.0045;     // sobre el cupón

export type TipoCobroCosto = 'dividendo' | 'interes' | 'amortizacion';

export interface TasasCobro { retencion: number; depositaria: number; comision: number }

// Tasas por defecto según el tipo de cobro (cuando no hay configuración del broker).
export function tasasPorDefecto(tipo: TipoCobroCosto): TasasCobro {
  if (tipo === 'dividendo') return { retencion: TASA_RETENCION_EEUU, depositaria: TASA_COMISION_DEPOSITARIA, comision: TASA_COMISION_BROKER_DIVIDENDO };
  if (tipo === 'interes') return { retencion: 0, depositaria: 0, comision: TASA_COMISION_BROKER_INTERES };
  return { retencion: 0, depositaria: 0, comision: 0 };
}

// Configuración de costos de un broker (fracciones; null/undefined = usar la general). Ver tabla brokers (migración 0056).
export interface BrokerTasas {
  retencion_dividendo?: number | null; comision_depositaria?: number | null;
  comision_cobro_dividendo?: number | null; comision_cobro_interes?: number | null;
}

// Tasas para un cobro de una posición repartida entre brokers: promedio ponderado por cantidad en cada broker. Sin reparto (o sin
// configuración) → las generales. La amortización nunca lleva costos estimados.
export function tasasParaCobro(tipo: TipoCobroCosto, reparto: { cantidad: number; broker: BrokerTasas | null }[]): TasasCobro {
  const base = tasasPorDefecto(tipo);
  if (tipo === 'amortizacion') return base;
  const pesos = reparto.filter(r => Number(r.cantidad) > 0);
  const total = pesos.reduce((s, r) => s + Number(r.cantidad), 0);
  if (!(total > 0)) return base;
  const pick = (f: (b: BrokerTasas) => number | null | undefined, def: number) =>
    pesos.reduce((s, r) => { const v = r.broker ? f(r.broker) : null; return s + (Number(r.cantidad) / total) * (v != null && Number.isFinite(Number(v)) ? Number(v) : def); }, 0);
  return {
    retencion: tipo === 'dividendo' ? pick(b => b.retencion_dividendo, base.retencion) : 0,
    depositaria: tipo === 'dividendo' ? pick(b => b.comision_depositaria, base.depositaria) : 0,
    comision: pick(tipo === 'dividendo' ? (b => b.comision_cobro_dividendo) : (b => b.comision_cobro_interes), base.comision),
  };
}

export interface CostosCobro {
  bruto: number; retencion: number; depositaria: number; comision: number; neto: number;   // USD
  comisiones: number;        // depositaria + broker: lo que se guarda en cobros.comision_usd
  tasas: TasasCobro;
}

const r2 = (x: number) => +x.toFixed(2);
const acotar = (x: number) => Math.min(Math.max(Number(x) || 0, 0), 0.99);

// bruto → retención (bruto × tasa) → depositaria (bruto × tasa) → comisión del broker ((lo que queda) × tasa) → neto.
export function calcularCostosCobro(bruto: number, tasas: TasasCobro): CostosCobro {
  const b = Number.isFinite(bruto) && bruto > 0 ? bruto : 0;
  let tr = acotar(tasas.retencion), td = acotar(tasas.depositaria);
  if (tr + td > 0.99) td = Math.max(0, 0.99 - tr);
  const tc = acotar(tasas.comision);
  const retencion = r2(b * tr), depositaria = r2(b * td);
  const comision = r2((b - retencion - depositaria) * tc);
  return {
    bruto: r2(b), retencion, depositaria, comision, neto: r2(b - retencion - depositaria - comision),
    comisiones: r2(depositaria + comision), tasas: { retencion: tr, depositaria: td, comision: tc },
  };
}

export const estimarCostosCobro = (tipo: TipoCobroCosto, bruto: number): CostosCobro => calcularCostosCobro(bruto, tasasPorDefecto(tipo));

// Neto estimado de un conjunto de cobros proyectados (para mostrar al lado del bruto).
export function netoEstimado(items: { tipo: TipoCobroCosto; monto: number; tasas?: TasasCobro }[]): { bruto: number; costos: number; neto: number } {
  let b = 0, c = 0, n = 0;
  for (const it of items) { const x = it.tasas ? calcularCostosCobro(it.monto, it.tasas) : estimarCostosCobro(it.tipo, it.monto); b += x.bruto; c += x.retencion + x.comisiones; n += x.neto; }
  return { bruto: r2(b), costos: r2(c), neto: r2(n) };
}

// Costos YA registrados en un cobro (si los hay): para mostrar el detalle en el historial. `comision` = depositaria + broker.
export interface CostosRegistrados { bruto: number; retencion: number; comision: number; estimados: boolean }
export function costosRegistrados(c: { monto: number; monto_bruto?: number | null; retencion_usd?: number | null; comision_usd?: number | null; costos_estimados?: boolean | null }): CostosRegistrados | null {
  const bruto = Number(c.monto_bruto);
  if (!Number.isFinite(bruto) || !(bruto > 0)) return null;
  const retencion = Number(c.retencion_usd) || 0, comision = Number(c.comision_usd) || 0;
  if (retencion === 0 && comision === 0) return null;
  return { bruto, retencion, comision, estimados: !!c.costos_estimados };
}
