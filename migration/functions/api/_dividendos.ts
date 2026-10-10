// Calendario de dividendos de acciones/CEDEARs — a diferencia de EDGAR (solo da el total ANUAL
// histórico, ver fundamentals.dividendPerShare), esto trae eventos individuales con fecha real
// (o, si el último pago conocido ya quedó viejo, una fecha ESTIMADA por la cadencia histórica —
// nunca se confunden: `estado` distingue 'declarado' de 'estimado').

import type { Env } from './_shared';
import { fetchJson } from './_shared';

export interface DividendEvent {
  date: string;                    // ex-dividend date
  adjDividend: number | null;
  dividend: number | null;
  paymentDate: string | null;
  recordDate: string | null;
  declarationDate: string | null;
}

export interface DividendoInfo {
  proximaFecha: string | null;     // ISO date del próximo pago (declarado o estimado)
  montoPorAccion: number | null;   // USD por acción del SUBYACENTE, bruto (sin ratio CEDEAR ni retención)
  estado: 'declarado' | 'estimado' | 'sin-dato';
  frecuenciaAnual: number | null;  // pagos/año, inferido de los últimos ~370 días de historial
  // Ex-dividend date del pago DECLARADO: quien no tenía la acción antes de esta fecha no cobra. null si el pago es estimado
  // (no hay fecha de corte conocida todavía). La usa el cron para contar solo lo que se tenía al corte.
  fechaCorte?: string | null;
}

// Puro y testeado: recibe `hoy` como parámetro (nunca Date.now() adentro) para poder testear
// determinísticamente, igual criterio que engine/coupons.ts y el resto del motor.
export function proyectarDividendo(historical: DividendEvent[], hoy: string): DividendoInfo {
  const sinDato: DividendoInfo = { proximaFecha: null, montoPorAccion: null, estado: 'sin-dato', frecuenciaAnual: null };
  const ordenados = (historical ?? [])
    .filter(h => h.date)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // más reciente primero
  if (!ordenados.length) return sinDato;

  const ultimo = ordenados[0];
  const montoUltimo = ultimo.adjDividend ?? ultimo.dividend ?? null;

  // Frecuencia: cuántos pagos hubo en los últimos ~370 días (30 de margen por calendario irregular).
  const corte = new Date(hoy); corte.setDate(corte.getDate() - 370);
  const corteStr = corte.toISOString().slice(0, 10);
  const enUltimoAnio = ordenados.filter(h => h.date >= corteStr).length;
  const frecuenciaAnual = enUltimoAnio > 0 ? enUltimoAnio : null;

  // Si el pago (o ex-date, si no hay paymentDate) más reciente conocido es futuro o de hasta hace
  // 7 días, lo tomamos tal cual — es un dato DECLARADO por el proveedor, no una proyección nuestra.
  const fechaRef = ultimo.paymentDate || ultimo.date;
  const margen = new Date(hoy); margen.setDate(margen.getDate() - 7);
  const margenStr = margen.toISOString().slice(0, 10);
  if (fechaRef && fechaRef >= margenStr) {
    return { proximaFecha: fechaRef, montoPorAccion: montoUltimo, estado: 'declarado', frecuenciaAnual, fechaCorte: ultimo.date };
  }

  // Si no, ESTIMAMOS el próximo por la cadencia histórica (intervalo típico entre pagos), sumando
  // desde el último conocido hasta pasar "hoy" — necesario si el historial quedó desactualizado.
  if (frecuenciaAnual) {
    const diasEntrePagos = Math.round(365 / frecuenciaAnual);
    const base = new Date(fechaRef || ultimo.date);
    base.setDate(base.getDate() + diasEntrePagos);
    const hoyDate = new Date(hoy);
    for (let i = 0; base < hoyDate && i < 24; i++) base.setDate(base.getDate() + diasEntrePagos);
    return { proximaFecha: base.toISOString().slice(0, 10), montoPorAccion: montoUltimo, estado: 'estimado', frecuenciaAnual };
  }

  return { proximaFecha: null, montoPorAccion: montoUltimo, estado: 'sin-dato', frecuenciaAnual: null };
}

interface FmpDividendRow { date?: string; adjDividend?: number; dividend?: number; paymentDate?: string; recordDate?: string; declarationDate?: string }
interface FinnhubDividendRow { date?: string; amount?: number; adjustedAmount?: number; payDate?: string; recordDate?: string; declarationDate?: string }
interface TwelveDataDividendRow { ex_date?: string; amount?: number; payment_date?: string; record_date?: string; declaration_date?: string }
interface TwelveDataDividendsResponse { dividends?: TwelveDataDividendRow[]; status?: string }
interface EodhdDividendRow { date?: string; value?: number; unadjustedValue?: number; paymentDate?: string; recordDate?: string; declarationDate?: string }
interface AlphaVantageDividendRow { ex_dividend_date?: string; amount?: string; declaration_date?: string; record_date?: string; payment_date?: string }
interface AlphaVantageDividendsResponse { data?: AlphaVantageDividendRow[] }

// Puro (sin fetch), verificado contra la respuesta real de EODHD (probada en vivo, jul-2026): un
// array directo, sin envoltorio. `value` es el monto AJUSTADO por splits, `unadjustedValue` el
// monto real que se declaró en su momento — mismo criterio adjDividend/dividend que FMP (preferir
// el ajustado, caer al real si falta).
//
// null vs [] es DELIBERADO, no un detalle de implementación: null = "no se pudo responder" (probá
// el siguiente proveedor); [] = "SÍ respondió, no tiene dividendos" (es una respuesta válida que
// hay que cachear como tal). Antes ambos casos devolvían null por igual — un ticker que
// confirmadamente no paga dividendo (ej. LAC) nunca lograba escribir su cache, así que quedaba
// SIEMPRE vencido y el cron lo reintentaba en TODAS las corridas (cada 30 min = 48/día), agotando
// solo con ese ticker casi todo el cupo diario de EODHD (20 req/día) antes de llegar a los tickers
// que sí tienen datos.
export function parseEodhd(data: unknown): DividendEvent[] | null {
  if (!Array.isArray(data)) return null; // no vino un array → error/respuesta inesperada
  const eventos = (data as EodhdDividendRow[])
    .filter(d => d.date && (d.value != null || d.unadjustedValue != null))
    .map(d => ({
      date: d.date!, adjDividend: d.value ?? d.unadjustedValue ?? null, dividend: d.unadjustedValue ?? d.value ?? null,
      paymentDate: d.paymentDate ?? null, recordDate: d.recordDate ?? null, declarationDate: d.declarationDate ?? null,
    }));
  return eventos;
}

// Puro (sin fetch), verificado contra la respuesta real de Alpha Vantage (jul-2026). `amount`
// viene como STRING ("1.69"), no número — hay que parsearlo y descartar valores no numéricos (ej.
// "None", que Alpha Vantage devuelve para algunos eventos sin monto confirmado). Mismo criterio
// null vs [] que parseEodhd (ver comentario ahí).
export function parseAlphaVantage(data: AlphaVantageDividendsResponse): DividendEvent[] | null {
  if (!Array.isArray(data.data)) return null;
  const eventos = data.data
    .filter(d => d.ex_dividend_date && d.amount != null)
    .map(d => ({ ...d, monto: Number(d.amount) }))
    .filter(d => Number.isFinite(d.monto))
    .map(d => ({
      date: d.ex_dividend_date!, adjDividend: d.monto, dividend: d.monto,
      paymentDate: d.payment_date ?? null, recordDate: d.record_date ?? null, declarationDate: d.declaration_date ?? null,
    }));
  return eventos;
}

// Puro (sin fetch) a propósito, para poder testear el parseo sin mockear la red. Twelve Data
// devuelve HTTP 200 con `status: "error"` para errores (key inválida, símbolo no encontrado, rate
// limit) en vez de un status code — hay que chequearlo explícitamente. Mismo criterio null vs []
// que parseEodhd (ver comentario ahí): `status:'error'` o sin campo `dividends` → null (no
// respondió); `dividends: []` → [] (respondió, confirmado sin dividendos).
export function parseTwelveData(data: TwelveDataDividendsResponse): DividendEvent[] | null {
  if (data.status === 'error' || !Array.isArray(data.dividends)) return null;
  const eventos = data.dividends
    .filter(d => d.ex_date && d.amount != null)
    .map(d => ({
      date: d.ex_date!, adjDividend: d.amount!, dividend: d.amount!,
      paymentDate: d.payment_date ?? null, recordDate: d.record_date ?? null, declarationDate: d.declaration_date ?? null,
    }));
  return eventos;
}

// Orden verificado en vivo (jul-2026): EODHD y Alpha Vantage SÍ traen dividendos en su plan
// gratuito (probado con sus keys demo — HTTP 200 con datos reales). Twelve Data, FMP y Finnhub
// exigen plan PAGO para este endpoint específico en las cuentas configuradas — se dejan como
// fallback oportunista por si algún día se habilitan, no se sacan.
export async function fetchDividendos(env: Env, symbol: string): Promise<DividendEvent[] | null> {
  if (env.EODHD_API_KEY) {
    try {
      const r = await fetchJson<unknown>(
        `https://eodhd.com/api/div/${symbol}.US?api_token=${env.EODHD_API_KEY}&fmt=json`);
      const eventos = parseEodhd(r);
      if (eventos) return eventos;
    } catch { /* fallthrough a Alpha Vantage */ }
  }
  if (env.ALPHA_VANTAGE_API_KEY) {
    try {
      const r = await fetchJson<AlphaVantageDividendsResponse>(
        `https://www.alphavantage.co/query?function=DIVIDENDS&symbol=${symbol}&apikey=${env.ALPHA_VANTAGE_API_KEY}`);
      const eventos = parseAlphaVantage(r);
      if (eventos) return eventos;
    } catch { /* fallthrough a Twelve Data */ }
  }
  if (env.TWELVE_DATA_API_KEY) {
    try {
      const r = await fetchJson<TwelveDataDividendsResponse>(
        `https://api.twelvedata.com/dividends?symbol=${symbol}&apikey=${env.TWELVE_DATA_API_KEY}&range=5Y`);
      const eventos = parseTwelveData(r);
      if (eventos) return eventos;
    } catch { /* fallthrough a FMP */ }
  }
  if (env.FMP_API_KEY) {
    try {
      const r = await fetchJson<{ historical?: FmpDividendRow[] }>(
        `https://financialmodelingprep.com/api/v3/historical-price-full/stock_dividend/${symbol}?apikey=${env.FMP_API_KEY}`);
      if (r.historical?.length) {
        const eventos = r.historical
          .filter(h => h.date)
          .map(h => ({
            date: h.date!, adjDividend: h.adjDividend ?? null, dividend: h.dividend ?? null,
            paymentDate: h.paymentDate ?? null, recordDate: h.recordDate ?? null, declarationDate: h.declarationDate ?? null,
          }));
        if (eventos.length) return eventos;
      }
    } catch { /* fallthrough a Finnhub */ }
  }
  if (env.FINNHUB_API_KEY) {
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const desde = new Date(); desde.setFullYear(desde.getFullYear() - 3);
      const r = await fetchJson<FinnhubDividendRow[]>(
        `https://finnhub.io/api/v1/stock/dividend?symbol=${symbol}&from=${desde.toISOString().slice(0, 10)}&to=${hoy}&token=${env.FINNHUB_API_KEY}`);
      if (Array.isArray(r) && r.length) {
        const eventos = r
          .filter(h => h.date)
          .map(h => ({
            date: h.date!, adjDividend: h.adjustedAmount ?? h.amount ?? null, dividend: h.amount ?? null,
            paymentDate: h.payDate ?? null, recordDate: h.recordDate ?? null, declarationDate: h.declarationDate ?? null,
          }));
        if (eventos.length) return eventos;
      }
    } catch { /* ninguna fuente disponible */ }
  }
  return null;
}
