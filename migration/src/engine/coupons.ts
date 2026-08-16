// =============================================================================
// Flujo de cupones de bonos/ONs: calendario mensual de lo que cobrás + YTM.
// Puro y determinista. Cupón por período = nominal × tasaAnual / frecuencia.
// Los meses de pago se derivan de un mes de referencia + espaciado 12/frecuencia.
// =============================================================================

import { xirr } from './irr';

// Cuota de amortización FUTURA cargada a mano (ver 0028_amortizaciones_programadas.sql) — no un
// cronograma completo garantizado, solo lo que el usuario fue cargando. `porcentaje` es la fracción
// (0..1] del nominal ORIGINAL que se espera amortizar en esa fecha (no un acumulado).
export interface CuotaAmortizacion {
  fecha: string;         // ISO 'YYYY-MM-DD'
  porcentaje: number;
}

// Agrupa filas de amortizaciones_programadas (tal como vienen de useAmortizaciones — todo el
// portfolio junto) por posición — un solo lugar para no reimplementar este group-by en cada pantalla
// que arma un CouponBond[]/CapitalBond[] (CuponesPage, el resumen de Cobros del Dashboard).
export function agruparCuotasPorPosicion(
  amortizaciones: { posicion_id: string; fecha: string; porcentaje: number }[],
): Map<string, CuotaAmortizacion[]> {
  const m = new Map<string, CuotaAmortizacion[]>();
  for (const a of amortizaciones) {
    const arr = m.get(a.posicion_id) ?? [];
    arr.push({ fecha: a.fecha, porcentaje: a.porcentaje });
    m.set(a.posicion_id, arr);
  }
  return m;
}

export interface CouponBond {
  ticker: string;
  faceValue: number;        // nominal total tenido (cantidad de nominales)
  tasaAnual: number;        // 0.07 = 7%
  frecuencia: number;       // pagos por año (1/2/4)
  mesRef: number;           // 1-12: mes de un pago de referencia
  vencimiento?: string | null; // ISO date; corta el calendario
  valorResidual?: number;      // fracción 0..1 del nominal vigente HOY — default 1 (bullet/sin amortizar)
  amortizaciones?: CuotaAmortizacion[]; // cuotas futuras cargadas — el cupón baja después de cada una
}

export interface CouponEvent {
  ym: string;               // 'YYYY-MM'
  year: number;
  month: number;            // 1-12
  ticker: string;
  monto: number;            // USD del cupón
}

export interface MonthBucket {
  ym: string;
  year: number;
  month: number;
  total: number;
  detalle: { ticker: string; monto: number }[];
}

const clampFreq = (f: number): number => (f === 1 || f === 2 || f === 4 || f === 12 ? f : 2);

// ¿El mes calendario `mon` (1-12) es un mes de pago para este bono?
function esMesDePago(mon: number, mesRef: number, frecuencia: number): boolean {
  const step = 12 / clampFreq(frecuencia);
  return (((mon - mesRef) % step) + step) % step === 0;
}

// Genera los eventos de cupón de los próximos `meses` a partir de (fromYear, fromMonth) inclusive.
// Si el bono trae `amortizaciones`, el cupón de cada mes de pago sale sobre el saldo VIGENTE hasta
// ese momento (arranca en `valorResidual`, default 1) — cada cuota programada reduce el saldo para
// los pagos siguientes, nunca para el que está cayendo justo ese mes (cobrás cupón sobre lo que
// tuviste ADEMÁS de la cuota, no sobre lo que queda después). Sin `amortizaciones`/`valorResidual`
// se comporta exactamente igual que antes (saldo fijo en 1) — retrocompatible.
// Solo se aplican cuotas del mes de inicio (fromYear/fromMonth) en adelante: `valorResidual` ya
// refleja lo que se pagó hasta HOY (se actualiza vía useCobros.ts#registrarAmortizacionVR), así que
// una cuota vieja que quedó cargada en el cronograma sin borrar NO se descuenta una segunda vez.
export function couponEvents(
  bonds: CouponBond[], fromYear: number, fromMonth: number, meses = 12,
): CouponEvent[] {
  const events: CouponEvent[] = [];
  const ymInicio = `${fromYear}-${String(fromMonth).padStart(2, '0')}`;
  for (const b of bonds) {
    if (!(b.tasaAnual > 0) || !(b.faceValue > 0) || !b.mesRef) continue;
    const freq = clampFreq(b.frecuencia);
    const vto = b.vencimiento ? new Date(b.vencimiento + 'T00:00:00Z') : null;
    const schedule = [...(b.amortizaciones ?? [])].filter(c => c.fecha.slice(0, 7) >= ymInicio).sort((x, y) => x.fecha.localeCompare(y.fecha));
    let balance = b.valorResidual ?? 1;
    let schedIdx = 0;
    for (let i = 0; i < meses; i++) {
      const abs = (fromYear * 12 + (fromMonth - 1)) + i;
      const year = Math.floor(abs / 12);
      const month = (abs % 12) + 1;
      if (vto && (year > vto.getUTCFullYear() || (year === vto.getUTCFullYear() && month > vto.getUTCMonth() + 1))) continue;
      const ym = `${year}-${String(month).padStart(2, '0')}`;
      if (esMesDePago(month, b.mesRef, freq) && balance > 0) {
        const monto = +(b.faceValue * (b.tasaAnual / freq) * balance).toFixed(2);
        if (monto > 0) events.push({ ym, year, month, ticker: b.ticker, monto });
      }
      while (schedIdx < schedule.length && schedule[schedIdx].fecha.slice(0, 7) <= ym) {
        balance = Math.max(0, balance - schedule[schedIdx].porcentaje);
        schedIdx++;
      }
    }
  }
  return events;
}

// Agrupa los eventos por mes (calendario continuo de `meses` a partir del inicio).
export function couponCalendar(
  bonds: CouponBond[], fromYear: number, fromMonth: number, meses = 12,
): MonthBucket[] {
  const events = couponEvents(bonds, fromYear, fromMonth, meses);
  const buckets: MonthBucket[] = [];
  for (let i = 0; i < meses; i++) {
    const abs = (fromYear * 12 + (fromMonth - 1)) + i;
    const year = Math.floor(abs / 12);
    const month = (abs % 12) + 1;
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const detalle = events.filter(e => e.ym === ym).map(e => ({ ticker: e.ticker, monto: e.monto }));
    buckets.push({ ym, year, month, total: +detalle.reduce((s, d) => s + d.monto, 0).toFixed(2), detalle });
  }
  return buckets;
}

export interface CapitalBond {
  ticker: string;
  faceValue: number;             // nominal total tenido (mismo criterio que CouponBond)
  vencimiento: string | null;
  valorResidual?: number;        // fracción 0..1 vigente HOY — default 1 (bullet)
  amortizaciones?: CuotaAmortizacion[]; // cuotas futuras cargadas
}

export interface CapitalEvent {
  ym: string; year: number; month: number; ticker: string; monto: number;
  tipo: 'cuota' | 'rescate';   // 'cuota' = amortización programada; 'rescate' = lo NO cubierto por
                                // el cronograma, asumido pagado entero al vencimiento
}

export interface CapitalMonthBucket {
  ym: string; year: number; month: number; total: number;
  detalle: { ticker: string; monto: number; tipo: 'cuota' | 'rescate' }[];
}

// Calendario de CAPITAL (distinto de couponEvents/couponCalendar, que son solo interés): las cuotas
// de amortización cargadas a mano que caen dentro de la ventana, más un "rescate" en el mes de
// vencimiento con lo que el cronograma NO cubre. Un bono bullet sin cuotas cargadas (o amortizable
// sin cronograma, solo con valor_residual) devuelve directamente ese remanente entero al vencimiento
// — mismo criterio y misma simplificación deliberada que ytm()/bondDuration() (ver su comentario):
// se asume que lo no programado se repaga TODO junto al final, no es un cronograma garantizado.
// Cuotas ANTERIORES al mes de inicio (fromYear/fromMonth) se ignoran del todo — ni generan evento
// ni descuentan de `cubierto` — porque se presume que ya están reflejadas en `valorResidual` (mismo
// criterio que couponEvents). Cuotas FUTURAS más allá de la ventana de `meses` SÍ siguen restando de
// `cubierto` (así el rescate final no las vuelve a contar), aunque no tengan evento propio acá.
export function capitalEvents(
  bonds: CapitalBond[], fromYear: number, fromMonth: number, meses = 12,
): CapitalEvent[] {
  const events: CapitalEvent[] = [];
  const inicio = fromYear * 12 + (fromMonth - 1);
  const fin = inicio + meses - 1;
  for (const b of bonds) {
    if (!(b.faceValue > 0)) continue;
    const schedule = [...(b.amortizaciones ?? [])].sort((x, y) => x.fecha.localeCompare(y.fecha));
    let cubierto = 0;
    for (const c of schedule) {
      const d = new Date(c.fecha + 'T00:00:00Z');
      if (Number.isNaN(d.getTime()) || !(c.porcentaje > 0)) continue;
      const abs = d.getUTCFullYear() * 12 + d.getUTCMonth();
      if (abs < inicio) continue; // ya pasó — se presume reflejada en valorResidual, no se cuenta de nuevo
      cubierto += c.porcentaje;
      if (abs > fin) continue; // futura pero fuera de la ventana: resta de `cubierto`, sin evento propio
      const monto = +(b.faceValue * c.porcentaje).toFixed(2);
      if (monto > 0) events.push({ ym: c.fecha.slice(0, 7), year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, ticker: b.ticker, monto, tipo: 'cuota' });
    }
    const restante = (b.valorResidual ?? 1) - cubierto;
    if (restante > 1e-9 && b.vencimiento) {
      const vto = new Date(b.vencimiento + 'T00:00:00Z');
      if (!Number.isNaN(vto.getTime())) {
        const abs = vto.getUTCFullYear() * 12 + vto.getUTCMonth();
        if (abs >= inicio && abs <= fin) {
          const monto = +(b.faceValue * restante).toFixed(2);
          if (monto > 0) events.push({ ym: b.vencimiento.slice(0, 7), year: vto.getUTCFullYear(), month: vto.getUTCMonth() + 1, ticker: b.ticker, monto, tipo: 'rescate' });
        }
      }
    }
  }
  return events;
}

// Agrupa capitalEvents por mes — mismo criterio que couponCalendar.
export function capitalCalendar(
  bonds: CapitalBond[], fromYear: number, fromMonth: number, meses = 12,
): CapitalMonthBucket[] {
  const events = capitalEvents(bonds, fromYear, fromMonth, meses);
  const buckets: CapitalMonthBucket[] = [];
  for (let i = 0; i < meses; i++) {
    const abs = (fromYear * 12 + (fromMonth - 1)) + i;
    const year = Math.floor(abs / 12);
    const month = (abs % 12) + 1;
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const detalle = events.filter(e => e.ym === ym).map(e => ({ ticker: e.ticker, monto: e.monto, tipo: e.tipo }));
    buckets.push({ ym, year, month, total: +detalle.reduce((s, d) => s + d.monto, 0).toFixed(2), detalle });
  }
  return buckets;
}

// Cupón anual total (suma de todos los pagos de un año completo) — para el yield del flujo.
export function cuponAnualTotal(bonds: CouponBond[]): number {
  return +bonds.reduce((s, b) => s + (b.tasaAnual > 0 && b.faceValue > 0 ? b.faceValue * b.tasaAnual : 0), 0).toFixed(2);
}

// Rendimiento corriente (current yield) = cupón anual / precio hoy. A diferencia de la YTM, ignora
// la ganancia/pérdida de capital hasta el rescate (pull-to-par) — mide solo el ingreso por cupón
// sobre lo que cuesta HOY. Complementa la YTM: un bono puede tener alto rendimiento corriente y baja
// YTM (comprado sobre la par) o viceversa (comprado muy bajo la par). `valorResidual` (0..1, default
// 1) escala el cupón: un bono amortizable paga cupón sobre el capital que TODAVÍA le queda, no sobre
// el nominal original — ver el comentario de ytm() más abajo para el porqué de esta corrección.
export function rendimientoCorriente(tasaAnual: number, precio: number, valorResidual = 1): number | null {
  if (!(tasaAnual >= 0) || !(precio > 0)) return null;
  return (tasaAnual * valorResidual) / precio;
}

// Fechas de pago (ISO, ascendentes) desde `hoy` hasta el vencimiento, generadas HACIA ATRÁS desde
// el vencimiento (así el último pago cae justo con el rescate, que es como funcionan estos bonos).
// Compartida por ytm() y bondDuration() — un solo lugar que decide "cuándo cobra este bono".
function fechasCupon(vencimiento: string, frecuencia: number, hoy: string): string[] | null {
  if (Number.isNaN(Date.parse(vencimiento)) || Number.isNaN(Date.parse(hoy))) return null;
  const vto = new Date(vencimiento + 'T00:00:00Z');
  const hoyDate = new Date(hoy + 'T00:00:00Z');
  if (!(vto.getTime() > hoyDate.getTime())) return null;   // ya venció

  const freq = clampFreq(frecuencia);
  const step = 12 / freq;
  const dia = vto.getUTCDate();
  const fechas: string[] = [];
  let cur = new Date(Date.UTC(vto.getUTCFullYear(), vto.getUTCMonth(), dia));
  // Cortamos en 600 iteraciones (150 años) por seguridad ante datos corruptos.
  for (let i = 0; i < 600 && cur.getTime() > hoyDate.getTime(); i++) {
    fechas.push(cur.toISOString().slice(0, 10));
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - step, dia));
  }
  if (!fechas.length) return null;
  fechas.reverse();
  return fechas;
}

// Interés corrido desde el último cupón (teórico, derivado del mismo step mensual que fechasCupon)
// hasta `hoy`, como fracción del cupón completo del período en curso. `hoy` puede coincidir
// exactamente con `anterior` (recién pagó, 0 corrido) o con `proxima` (a punto de pagar, casi 1
// cupón entero corrido) — el resultado queda siempre en [0,1]. Devuelve 0 (no NaN) si por algún
// motivo el período calculado tiene longitud cero, para que el llamador nunca tenga que filtrar.
function fraccionCorrida(proxima: string, frecuencia: number, hoy: string): number {
  const freq = clampFreq(frecuencia);
  const step = 12 / freq;
  const prox = new Date(proxima + 'T00:00:00Z');
  const dia = prox.getUTCDate();
  const anterior = new Date(Date.UTC(prox.getUTCFullYear(), prox.getUTCMonth() - step, dia));
  const diasPeriodo = (prox.getTime() - anterior.getTime()) / 86_400_000;
  if (!(diasPeriodo > 0)) return 0;
  const diasCorridos = (new Date(hoy + 'T00:00:00Z').getTime() - anterior.getTime()) / 86_400_000;
  return Math.min(1, Math.max(0, diasCorridos / diasPeriodo));
}

// ── TIR al vencimiento (YTM) ─────────────────────────────────────────────────
// El "current yield" (cupón/precio) ignora la ganancia de capital hasta el rescate: un bono cupón
// 7% comprado a 60 de paridad rinde MUCHO más que 11,7%. La YTM descuenta los flujos reales:
// hoy −precio, cada cupón hasta el vencimiento, y el capital (1 por nominal) al final.
//
// `precio` es SIEMPRE precio LIMPIO (sin interés corrido) — así cotiza data912/BYMA, y así se
// guarda en toda la app (paridad = precio×100). La TIR, en cambio, se define sobre lo que
// REALMENTE pagás hoy: precio limpio + interés corrido desde el último cupón (precio "sucio").
// Tratar el precio limpio como si ya fuera lo que pagás (como hacía esta función antes) infla la
// TIR calculada, tanto más cuanto más avanzado esté el período de devengamiento actual — verificado
// contra el TIR que reporta IOL para bonos reales del catálogo: para uno con poco interés corrido
// (~4% del precio) el error era de ~1 punto porcentual de TIR; para uno con mucho corrido acumulado
// el precio limpio solo, sin este ajuste, daba una TIR de 53% contra el 4,5% real que reporta IOL.
// Se corrige agregando el interés corrido (cupón del período en curso × fracción transcurrida,
// `fraccionCorrida()`) al precio antes de correr la XIRR — los flujos futuros (cupones + rescate)
// no cambian, siguen siendo los montos COMPLETOS de cada período.
//
// Asume BULLET (100% del capital recién al vencimiento) salvo que se pase `valorResidual` — no
// modela un cronograma de amortización completo, solo una FOTO puntual de cuánto capital queda. El
// sesgo de asumir bullet en un bono que en los hechos amortiza NO es "leve" ni siempre en la misma
// dirección: verificado numéricamente (bono 2 años, semestral, cupón 6%, amortizando 25% del
// capital por período) — comprado bajo la par (85) el bullet da 15,5% pero el amortizable real
// rinde 21,6% (subestima, porque el amortizable te devuelve capital antes, a precio de descuento);
// comprado sobre la par (105) el bullet da 3,4% contra 1,9% real (ahí sí sobrestima). `valorResidual`
// (0..1, default 1) corrige esto de forma inequívoca — no depende de ninguna convención de mercado,
// solo de cuánto capital queda realmente por cobrar: escala CADA cupón (se paga sobre el saldo
// remanente, no sobre el nominal original) y reemplaza el rescate de 1 por `valorResidual` en el
// último flujo. Simplificación deliberada: trata el remanente como si se repagara TODO junto al
// vencimiento (no modela cuotas futuras que todavía no ocurrieron) — mejor que asumir 100%, pero
// sigue siendo una aproximación si al bono le quedan más amortizaciones por delante.
export function ytm(p: {
  precio: number;        // precio LIMPIO por nominal hoy (0.982 = 98,2% de paridad, sin interés corrido)
  tasaAnual: number;     // cupón nominal anual (0.06 = 6%)
  frecuencia: number;    // pagos por año
  vencimiento: string;   // ISO 'YYYY-MM-DD'
  hoy: string;
  valorResidual?: number; // fracción 0..1 del nominal que queda por cobrar — default 1 (bullet)
}): number | null {
  if (!(p.precio > 0) || !(p.tasaAnual >= 0)) return null;
  const fechas = fechasCupon(p.vencimiento, p.frecuencia, p.hoy);
  if (!fechas) return null;

  const vr = p.valorResidual ?? 1;
  const cupon = (p.tasaAnual / clampFreq(p.frecuencia)) * vr;
  const sucio = p.precio + cupon * fraccionCorrida(fechas[0], p.frecuencia, p.hoy);
  const flows = [
    { date: p.hoy, amount: -sucio },
    ...fechas.map(f => ({ date: f, amount: cupon })),
    { date: fechas[fechas.length - 1], amount: vr },   // rescate del capital remanente al vencimiento
  ];
  return xirr(flows);
}

// ── TIR y duración desde un cronograma EXPLÍCITO ─────────────────────────────
// A diferencia de ytm()/bondDuration() (que derivan los flujos de tasaAnual/frecuencia y asumen
// bullet salvo valorResidual), estas dos trabajan directo sobre un cronograma de flujos YA
// CONOCIDO — fecha + interés + amortización por período, en fracción 0..1 del nominal ORIGINAL
// (misma base que `precio`/valorResidual en ytm()). Pensadas para bonos_referencia (poblada desde
// IOL get_fixed_income_analytics): más precisas para instrumentos con cupón escalonado o
// amortización parcial ya en curso, porque no hay que aproximar "cuánto cupón paga" — el cronograma
// YA dice cuánto paga cada fecha futura.
export interface CronogramaItem {
  fecha: string;           // ISO 'YYYY-MM-DD'
  interes: number;         // fracción 0..1 del nominal original
  amortizacion: number;    // fracción 0..1 del nominal original
  saldo_residual: number;  // fracción 0..1 del nominal original, DESPUÉS de este pago
}

// Un solo flujo con `interes`/`amortizacion` no-numérico (NaN, o un string mal cargado que escapó
// al tipo) invalida TODO el cronograma — nunca se descarta en silencio, porque filtrar el flujo
// corrupto (en vez de anular el cálculo entero) da una TIR sesgada que PARECE válida. Mismo criterio
// para una fecha que Date.parse no entiende: mejor `null` (el motor no sabe) que un número armado
// con menos flujos de los que el bono realmente paga.
function cronogramaValido(cronograma: CronogramaItem[] | null | undefined): cronograma is CronogramaItem[] {
  return Array.isArray(cronograma) && cronograma.length > 0
    && cronograma.every(f => Number.isFinite(f.interes) && Number.isFinite(f.amortizacion) && !Number.isNaN(Date.parse(f.fecha)));
}

// `precio` (data912) es precio LIMPIO — mismo problema y misma corrección que en ytm() (ver su
// comentario para el porqué y la verificación empírica contra IOL). Acá no hay `frecuencia`
// explícita (bonos_referencia no la guarda como columna), así que la duración del período en curso
// se infiere de la distancia real entre dos flujos del propio cronograma: los DOS próximos si hay
// (exacto para cualquier momento de la vida del bono salvo el último período), o el ÚLTIMO CUPÓN YA
// PAGADO + el único flujo futuro que queda (el rescate final) — dato real del cronograma, nunca un
// supuesto nuevo. Antes, en el último período (1 solo flujo futuro), no se ajustaba nada y se usaba
// precio limpio = precio sucio — "una aproximación menor", según el comentario viejo. No lo es: caso
// real MIC3D (ON a ~90 días del vencimiento, cupón semestral 3.5%), el interés corrido de casi medio
// cupón que quedaba sin sumar al costo inflaba la TIR calculada a ~14.6% cuando el número correcto
// (con el interés corrido) da ~6-7% — casi el doble, y consistente con "duración muy corta = pull-to-
// par: la TIR de un bono a semanas del vencimiento tiene que rondar su cupón, no doblarlo".
export function ytmFromCronograma(precio: number, cronograma: CronogramaItem[] | null | undefined, hoy: string): number | null {
  if (!(precio > 0) || !cronogramaValido(cronograma)) return null;
  const futuros = cronograma.filter(f => f.fecha > hoy && (f.interes + f.amortizacion) > 0);
  if (!futuros.length) return null;

  let sucio = precio;
  const proxima = Date.parse(futuros[0].fecha);
  let anterior: number | null = null;
  if (futuros.length >= 2) {
    const siguiente = Date.parse(futuros[1].fecha);
    const diasPeriodo = (siguiente - proxima) / 86_400_000;
    if (diasPeriodo > 0) anterior = proxima - diasPeriodo * 86_400_000;
  } else {
    // Último período: no hay un SIGUIENTE flujo futuro del que inferir la duración, pero sí hay un
    // ANTERIOR real en el propio cronograma (el último cupón que el bono ya pagó antes de hoy).
    const pagados = cronograma.filter(f => f.fecha <= hoy && (f.interes + f.amortizacion) > 0);
    if (pagados.length) anterior = Math.max(...pagados.map(f => Date.parse(f.fecha)));
  }
  if (anterior != null) {
    const diasPeriodo = (proxima - anterior) / 86_400_000;
    if (diasPeriodo > 0) {
      const diasCorridos = (Date.parse(hoy + 'T00:00:00Z') - anterior) / 86_400_000;
      const fraccion = Math.min(1, Math.max(0, diasCorridos / diasPeriodo));
      sucio = precio + futuros[0].interes * fraccion;
    }
  }

  const flows = [
    { date: hoy, amount: -sucio },
    ...futuros.map(f => ({ date: f.fecha, amount: f.interes + f.amortizacion })),
  ];
  return xirr(flows);
}

// ¿La TIR de arriba pudo ajustar el interés corrido en el ÚLTIMO período del bono (1 solo flujo
// futuro restante)? false cuando el cronograma no tiene ningún cupón YA PAGADO del que inferir la
// duración de ese período (caso real: bonos_referencia solo guarda los flujos FUTUROS que trae IOL,
// nunca el historial) — ahí se usa precio limpio sin ajustar, lo que puede inflar bastante la TIR
// cerca del vencimiento (caso real: MIC3D, a ~90 días del vencimiento con cupón semestral: ~14.6%
// calculado vs. ~6-7% con el interés corrido correctamente sumado — casi el doble). Se expone para
// que la UI pueda avisar en vez de mostrar el número sin ninguna salvedad — mismo criterio que el
// aviso "sin cotización" de BonosPage.tsx (superíndice "e").
export function tirUltimoPeriodoSinAjustar(cronograma: CronogramaItem[] | null | undefined, hoy: string): boolean {
  if (!cronogramaValido(cronograma)) return false;
  const futuros = cronograma.filter(f => f.fecha > hoy && (f.interes + f.amortizacion) > 0);
  if (futuros.length !== 1) return false;
  const pagados = cronograma.filter(f => f.fecha <= hoy && (f.interes + f.amortizacion) > 0);
  return pagados.length === 0;
}

// Rendimiento corriente (current yield) para bonos_referencia: mismo concepto que
// rendimientoCorriente() (cupón anual / precio, ignora pull-to-par), pero sin una `tasaAnual` fija
// como parámetro — se anualiza el interés del PRÓXIMO período usando la misma frecuencia inferida
// de la distancia entre los dos próximos flujos que usa ytmFromCronograma() (ver su comentario).
// Con un solo flujo futuro (último período del bono) no hay de dónde inferir la frecuencia → null,
// mismo criterio que el resto de esta sección: mejor "sin dato" que un número armado con un supuesto
// nuevo.
export function rendimientoCorrienteFromCronograma(precio: number, cronograma: CronogramaItem[] | null | undefined, hoy: string): number | null {
  if (!(precio > 0) || !cronogramaValido(cronograma)) return null;
  const futuros = cronograma.filter(f => f.fecha > hoy && (f.interes + f.amortizacion) > 0);
  if (futuros.length < 2) return null;
  const diasPeriodo = (Date.parse(futuros[1].fecha) - Date.parse(futuros[0].fecha)) / 86_400_000;
  if (!(diasPeriodo > 0)) return null;
  const cuponAnualizado = futuros[0].interes * (365 / diasPeriodo);
  return cuponAnualizado / precio;
}

// Infiere los campos "planos" de cupón (tasaAnual/frecuencia/mesRef, el formato que usa Posicion/
// CouponBond) a partir de un cronograma real de bonos_referencia — para precargar el alta de un bono
// en Posiciones (ver PosicionesPage) sin que el usuario tenga que volver a tipear lo que el catálogo
// ya conoce. Misma inferencia de frecuencia por distancia entre los 2 próximos flujos que usan
// ytmFromCronograma()/rendimientoCorrienteFromCronograma() — nunca un supuesto nuevo, y se redondea
// al múltiplo estándar (mensual/trimestral/semestral/anual) más cercano al período real, porque
// CouponBond.frecuencia es un entero (pagos/año), no una duración exacta. null si no hay 2 flujos
// futuros de dónde inferir la frecuencia — mejor no precargar que precargar con un supuesto.
const FRECUENCIAS_ESTANDAR = [1, 2, 4, 12] as const;
export function inferirCuponDeCronograma(
  cronograma: CronogramaItem[] | null | undefined, hoy: string,
): { tasaAnual: number; frecuencia: number; mesRef: number } | null {
  if (!cronogramaValido(cronograma)) return null;
  const futuros = cronograma.filter(f => f.fecha > hoy && (f.interes + f.amortizacion) > 0);
  if (futuros.length < 2) return null;
  const diasPeriodo = (Date.parse(futuros[1].fecha) - Date.parse(futuros[0].fecha)) / 86_400_000;
  if (!(diasPeriodo > 0)) return null;
  const mesesPeriodo = diasPeriodo / 30.44;
  let frecuencia: number = FRECUENCIAS_ESTANDAR[0], mejorDist = Infinity;
  for (const freq of FRECUENCIAS_ESTANDAR) {
    const dist = Math.abs(mesesPeriodo - 12 / freq);
    if (dist < mejorDist) { mejorDist = dist; frecuencia = freq; }
  }
  const mesRef = new Date(Date.parse(futuros[0].fecha)).getUTCMonth() + 1;
  return { tasaAnual: futuros[0].interes * frecuencia, frecuencia, mesRef };
}

// Misma lógica de descuento que bondDuration(): se descuenta a la TIR ya calculada con
// ytmFromCronograma() (consistencia entre ambas cuentas, nunca un supuesto de tasa nuevo).
export function bondDurationFromCronograma(
  cronograma: CronogramaItem[] | null | undefined, ytmAnual: number, hoy: string,
): { macaulay: number; modified: number } | null {
  if (!Number.isFinite(ytmAnual) || ytmAnual <= -1 || !cronogramaValido(cronograma)) return null;
  const futuros = cronograma.filter(f => f.fecha > hoy && (f.interes + f.amortizacion) > 0);
  if (!futuros.length) return null;
  // Date.parse(f.fecha) directo (no concatenar 'T00:00:00Z'): el cronograma de IOL a veces trae
  // timestamp completo ('2027-01-24T00:00:00'), y concatenar un sufijo de zona horaria a ESO da
  // Invalid Date en vez de la fecha esperada — Date.parse ya entiende ambos formatos.
  const hoyMs = Date.parse(hoy + 'T00:00:00Z');
  const DAY = 24 * 60 * 60 * 1000;
  let sumPv = 0, sumTPv = 0;
  for (const f of futuros) {
    const t = (Date.parse(f.fecha) - hoyMs) / (365 * DAY);
    if (!(t > 0)) continue;
    const monto = f.interes + f.amortizacion;
    const pv = monto / Math.pow(1 + ytmAnual, t);
    sumPv += pv; sumTPv += t * pv;
  }
  if (!(sumPv > 0)) return null;
  const macaulay = sumTPv / sumPv;
  return { macaulay, modified: macaulay / (1 + ytmAnual) };
}

// ── Duración (Macaulay y modificada) ─────────────────────────────────────────
// Macaulay: promedio ponderado (por valor presente de cada flujo) del tiempo hasta cobrarlo, en
// años. Mide cuánto tarda en "repagarse" el bono — cuanto más corto, menos sensible es el precio a
// cambios de tasa y menos tiempo queda expuesto. Se descuenta a la YTM (ya calculada por ytm() con
// el precio real de mercado) para que ambas cuentas sean consistentes entre sí — nunca un supuesto
// nuevo. Modificada = Macaulay / (1+YTM): aproxima directamente %ΔPrecio ante ΔTasa de 1pp.
// `valorResidual` (0..1, default 1): mismo criterio que en ytm() — ver ese comentario.
export function bondDuration(p: {
  tasaAnual: number;      // cupón nominal anual (0.06 = 6%)
  frecuencia: number;     // pagos por año
  vencimiento: string;    // ISO 'YYYY-MM-DD'
  hoy: string;
  ytmAnual: number;       // tasa de descuento — usar la YTM ya calculada con ytm()
  valorResidual?: number; // fracción 0..1 del nominal que queda por cobrar — default 1 (bullet)
}): { macaulay: number; modified: number } | null {
  if (!(p.tasaAnual >= 0) || !Number.isFinite(p.ytmAnual) || p.ytmAnual <= -1) return null;
  const fechas = fechasCupon(p.vencimiento, p.frecuencia, p.hoy);
  if (!fechas) return null;

  const vr = p.valorResidual ?? 1;
  const cupon = (p.tasaAnual / clampFreq(p.frecuencia)) * vr;
  const hoyMs = new Date(p.hoy + 'T00:00:00Z').getTime();
  const DAY = 24 * 60 * 60 * 1000;
  let sumPv = 0, sumTPv = 0;
  fechas.forEach((f, i) => {
    const amount = cupon + (i === fechas.length - 1 ? vr : 0);   // el último incluye el rescate
    if (amount <= 0) return;
    const t = (Date.parse(f) - hoyMs) / (365 * DAY);
    if (t <= 0) return;
    const pv = amount / Math.pow(1 + p.ytmAnual, t);
    sumPv += pv;
    sumTPv += t * pv;
  });
  if (sumPv <= 0) return null;

  const macaulay = sumTPv / sumPv;
  return { macaulay, modified: macaulay / (1 + p.ytmAnual) };
}
