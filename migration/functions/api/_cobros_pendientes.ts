// Decide si una posición tiene un cobro (dividendo o cupón) que ya llegó a su fecha proyectada, y
// con qué monto sugerirlo — puro y testeado, separado de la orquestación de red/DB (cron/refresh-all.ts).
// NUNCA decide "confirmar": esto solo arma la SUGERENCIA que después entra a `cobros` en estado
// 'pendiente' — el usuario la revisa y confirma a mano (ver 0012_cobros_pendientes.sql).

import type { DividendoInfo, DividendEvent } from './_dividendos';

export interface PosicionParaCobro {
  id: string;
  portfolio_id: string;
  ticker: string;
  tipo: 'cedear' | 'accion' | 'accion_ar' | 'etf' | 'bono' | 'cash';
  cantidad: number;
  ratio_cedear: number | null;
  cupon_tasa: number | null;
  cupon_frecuencia: number | null;
  cupon_mes: number | null;
  vencimiento: string | null;
  fecha_compra?: string | null;
}

export interface CobroPendienteSugerido {
  portfolio_id: string;
  posicion_id: string;
  ticker: string;
  tipo: 'dividendo' | 'interes';
  fecha: string;
  monto: number;
  nota: string;
}

// Dividendo de CEDEAR/acción/ETF, a partir de la proyección de _dividendos.ts (FMP/Finnhub). El
// monto que da el proveedor es del SUBYACENTE, bruto: para un CEDEAR hay que dividir por el ratio
// de conversión (ej. 20:1) — es el error más grande posible acá (un orden de magnitud), mucho mayor
// que la retención de impuestos, que queda a criterio del usuario al confirmar.
export function sugerirDividendoPendiente(pos: PosicionParaCobro, div: DividendoInfo | null, hoy: string): CobroPendienteSugerido | null {
  // accion_ar (BYMA, ej. GGAL local) es un instrumento DISTINTO del ADR/CEDEAR que pueda tener el
  // mismo ticker en otro portfolio — sin relación de conversión conocida ni fuente de datos para
  // acciones locales. Si no se excluye acá, un ticker compartido (ej. GGAL como 'accion' en un
  // portfolio y como 'accion_ar' en otro) hace que la acción local reciba el dividendo del ADR en
  // USD sin ningún ratio, un error de un orden de magnitud y en la moneda equivocada.
  if (pos.tipo === 'bono' || pos.tipo === 'cash' || pos.tipo === 'accion_ar' || !(pos.cantidad > 0)) return null;
  if (!div || div.estado === 'sin-dato' || div.proximaFecha == null || div.montoPorAccion == null) return null;
  if (div.proximaFecha > hoy) return null; // todavía no llegó

  let divisor = 1;
  if (pos.tipo === 'cedear') {
    // Sin ratio confiable, mejor no sugerir nada que sugerir un monto 10-30x mal.
    if (!(pos.ratio_cedear! > 0)) return null;
    divisor = pos.ratio_cedear!;
  }
  // El chequeo `> 0` se hace DESPUÉS de redondear a centavos: un monto sub-centavo (posición muy
  // chica) pasa el `>0` en crudo pero redondea a 0.00, y la tabla lo rechaza (`monto > 0` en la
  // constraint) — sin este orden, la RPC fallaba en silencio (atrapado por el catch del cron) por
  // una sugerencia que de entrada no valía la pena insertar.
  const montoBruto = (div.montoPorAccion * pos.cantidad) / divisor;
  const monto = +montoBruto.toFixed(2);
  if (!(monto > 0)) return null;

  const fuente = div.estado === 'declarado' ? 'declarado por el proveedor' : 'estimado por cadencia histórica (sin fecha confirmada por el proveedor)';
  const calculo = `US$${div.montoPorAccion} por acción del subyacente × ${pos.cantidad}` + (pos.tipo === 'cedear' ? ` ÷ ratio ${pos.ratio_cedear}` : '');
  return {
    portfolio_id: pos.portfolio_id, posicion_id: pos.id, ticker: pos.ticker, tipo: 'dividendo',
    fecha: div.proximaFecha, monto,
    nota: `Sugerido por el cron — ${fuente}. ${calculo}. Bruto: revisá retención de impuestos y tipo de cambio antes de confirmar.`,
  };
}

// Mismo criterio de "mes de pago" que src/engine/coupons.ts (esMesDePago), duplicado A PROPÓSITO:
// las Functions de Cloudflare Pages se buildean aparte de src/ (límite ya existente en este repo —
// ningún archivo de functions/ importa desde ../../src/ hoy) y esto corre en un cron de producción
// donde un import cruzado sin probar es un riesgo que no vale la pena para esta poca lógica.
function esMesDePago(mes: number, mesRef: number, frecuencia: number): boolean {
  if (!(frecuencia > 0)) return false;
  const paso = 12 / frecuencia; // la UI solo ofrece 1/2/4/12, siempre divide 12 exacto
  const diff = ((mes - mesRef) % 12 + 12) % 12;
  return diff % paso === 0;
}

// Cupón de bono: el modelo de datos actual (4 campos manuales) solo tiene granularidad de MES, no
// de día — así que la fecha del evento se fija al día 1 del mes de pago (arbitrario pero estable:
// es lo que permite deduplicar contra reintentos del cron dentro del mismo mes).
export function sugerirCuponPendiente(pos: PosicionParaCobro, hoy: string): CobroPendienteSugerido | null {
  if (pos.tipo !== 'bono' || !(pos.cantidad > 0)) return null;
  const { cupon_tasa, cupon_frecuencia, cupon_mes, vencimiento } = pos;
  if (!cupon_tasa || !cupon_frecuencia || !cupon_mes) return null;
  if (vencimiento && hoy > vencimiento) return null; // ya venció

  const [anioStr, mesStr] = hoy.split('-');
  const mesHoy = Number(mesStr);
  if (!esMesDePago(mesHoy, cupon_mes, cupon_frecuencia)) return null;

  const monto = +((cupon_tasa / cupon_frecuencia) * pos.cantidad).toFixed(2);
  if (!(monto > 0)) return null;

  return {
    portfolio_id: pos.portfolio_id, posicion_id: pos.id, ticker: pos.ticker, tipo: 'interes',
    fecha: `${anioStr}-${mesStr}-01`, monto,
    nota: `Sugerido por el cron — cupón proyectado (tasa ${(cupon_tasa * 100).toFixed(2)}% anual ÷ ${cupon_frecuencia} pagos/año × ${pos.cantidad} nominales). Calendario sintético desde los datos cargados a mano, NO verificado contra la emisión real.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Carga histórica (primera carga / reconciliación): a diferencia de sugerirDividendoPendiente y
// sugerirCuponPendiente (que solo miran si el PRÓXIMO evento ya llegó a "hoy"), esto recorre un
// RANGO de fechas completo y devuelve UNA sugerencia por cada pago que cayó dentro — pensado para
// posiciones que ya existían antes de que este mecanismo empezara a correr, donde varios pagos
// reales quedaron sin sugerir porque el cron nunca los vio "llegar" (solo mira el día de hoy en
// cada corrida). Van al mismo lugar que las del cron ('pendiente', origen 'cron') y respetan el
// mismo índice de dedupe — correrlo dos veces sobre el mismo rango no duplica nada.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Dividendos reales de CEDEAR/acción/ETF dentro de [desde,hasta] — a diferencia de la sugerencia
// del cron (que puede ser una fecha ESTIMADA por cadencia si el proveedor no tiene el próximo pago
// declarado), acá cada evento es un pago DECLARADO real del historial del proveedor: no hay
// estimación posible para una fecha que ya pasó.
export function sugerirDividendosHistoricos(
  pos: PosicionParaCobro, historical: DividendEvent[] | null, desde: string, hasta: string,
): CobroPendienteSugerido[] {
  if (pos.tipo === 'bono' || pos.tipo === 'cash' || pos.tipo === 'accion_ar' || !(pos.cantidad > 0)) return [];
  if (!historical?.length) return [];
  let divisor = 1;
  if (pos.tipo === 'cedear') {
    if (!(pos.ratio_cedear! > 0)) return [];
    divisor = pos.ratio_cedear!;
  }
  const out: CobroPendienteSugerido[] = [];
  for (const ev of historical) {
    const fecha = ev.paymentDate || ev.date;
    if (!fecha || fecha < desde || fecha > hasta) continue;
    const montoPorAccion = ev.adjDividend ?? ev.dividend ?? null;
    if (montoPorAccion == null) continue;
    const monto = +((montoPorAccion * pos.cantidad) / divisor).toFixed(2);
    if (!(monto > 0)) continue;
    const calculo = `US$${montoPorAccion} por acción del subyacente × ${pos.cantidad}` + (pos.tipo === 'cedear' ? ` ÷ ratio ${pos.ratio_cedear}` : '');
    out.push({
      portfolio_id: pos.portfolio_id, posicion_id: pos.id, ticker: pos.ticker, tipo: 'dividendo',
      fecha, monto,
      nota: `Carga histórica — pago real declarado por el proveedor. ${calculo}. Bruto: revisá retención de impuestos y tipo de cambio antes de confirmar.`,
    });
  }
  return out;
}

// Cupones de bono ya pagados dentro de [desde,hasta] (sintéticos, mismo criterio de "mes de pago"
// que sugerirCuponPendiente, pero recorriendo mes a mes en vez de solo "hoy").
export function sugerirCuponesHistoricos(pos: PosicionParaCobro, desde: string, hasta: string): CobroPendienteSugerido[] {
  if (pos.tipo !== 'bono' || !(pos.cantidad > 0)) return [];
  const { cupon_tasa, cupon_frecuencia, cupon_mes, vencimiento } = pos;
  if (!cupon_tasa || !cupon_frecuencia || !cupon_mes) return [];

  const out: CobroPendienteSugerido[] = [];
  const [anioDesde, mesDesde] = desde.split('-').map(Number);
  const [anioHasta, mesHasta] = hasta.split('-').map(Number);
  let anio = anioDesde, mes = mesDesde;
  // Tope defensivo (600 iteraciones = 50 años): un rango invalido (desde > hasta, o al revés) no
  // debe colgar el loop en vez de simplemente no devolver nada.
  for (let i = 0; i < 600 && (anio < anioHasta || (anio === anioHasta && mes <= mesHasta)); i++) {
    const fecha = `${anio}-${String(mes).padStart(2, '0')}-01`;
    // fecha siempre cae en el día 1: si `desde` es un día intermedio del mes de arranque (ej.
    // "2026-03-15"), el mes de `desde` ya matcheado por año/mes NO debe colarse con fecha 03-01,
    // que es anterior al `desde` pedido.
    if (fecha >= desde && !(vencimiento && fecha > vencimiento) && esMesDePago(mes, cupon_mes, cupon_frecuencia)) {
      const monto = +((cupon_tasa / cupon_frecuencia) * pos.cantidad).toFixed(2);
      if (monto > 0) {
        out.push({
          portfolio_id: pos.portfolio_id, posicion_id: pos.id, ticker: pos.ticker, tipo: 'interes',
          fecha, monto,
          nota: `Carga histórica — cupón proyectado (tasa ${(cupon_tasa * 100).toFixed(2)}% anual ÷ ${cupon_frecuencia} pagos/año × ${pos.cantidad} nominales). Calendario sintético desde los datos cargados a mano, NO verificado contra la emisión real.`,
        });
      }
    }
    mes++; if (mes > 12) { mes = 1; anio++; }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Cupones con FECHA EXACTA, desde el cronograma de la emisión (bonos_referencia.cronograma). A diferencia del cálculo
// sintético de arriba (mes de pago → día 1), acá cada cupón cae en su día real de pago: no aparece como "pendiente" semanas
// antes de cobrarse. `interes` del cronograma es la fracción del nominal ORIGINAL de ese período (ya escalada por el saldo
// vigente), así que monto = nominales × interes. El cronograma NO modela amortización parcial a nivel cobro: eso va por
// registrar_amortizacion. Devuelve una sugerencia por cada flujo con fecha dentro de [desde, hasta].
// ─────────────────────────────────────────────────────────────────────────────────────────────
export interface FlujoCronograma { fecha: string; interes: number; amortizacion?: number }

const soloFecha = (f: string) => String(f).slice(0, 10);

// ¿El cronograma sirve para sugerir? Con flujos válidos Y alguno hoy o a futuro. Un catálogo viejo (todos los flujos ya
// pasaron) no debe tapar el cálculo sintético: sin esto, un bono con catálogo sin refrescar dejaría de sugerir cupones.
export function cronogramaVigente(crono: FlujoCronograma[] | null | undefined, hoy: string): crono is FlujoCronograma[] {
  return Array.isArray(crono) && crono.length > 0
    && crono.every(f => f && typeof f.fecha === 'string' && !Number.isNaN(Date.parse(f.fecha)) && Number.isFinite(f.interes))
    && crono.some(f => soloFecha(f.fecha) >= hoy);
}

export function sugerirCuponesDeCronograma(
  pos: PosicionParaCobro, crono: FlujoCronograma[], desde: string, hasta: string,
): CobroPendienteSugerido[] {
  if (pos.tipo !== 'bono' || !(pos.cantidad > 0)) return [];
  const out: CobroPendienteSugerido[] = [];
  for (const f of crono) {
    const fecha = soloFecha(f.fecha);
    if (fecha < desde || fecha > hasta || !(f.interes > 0)) continue;
    if (pos.fecha_compra && fecha < pos.fecha_compra) continue;   // cupón anterior a la compra: no es tuyo
    if (pos.vencimiento && fecha > pos.vencimiento) continue;
    const monto = +(pos.cantidad * f.interes).toFixed(2);
    if (!(monto > 0)) continue;
    out.push({
      portfolio_id: pos.portfolio_id, posicion_id: pos.id, ticker: pos.ticker, tipo: 'interes', fecha, monto,
      nota: `Sugerido por el cron — cupón del cronograma de la emisión, fecha exacta de pago (${pos.cantidad} nominales × ${(f.interes * 100).toFixed(4)}%).`,
    });
  }
  return out;
}
