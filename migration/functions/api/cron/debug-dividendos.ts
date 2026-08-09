import { type Env, json, preflight, guard, requireCronSecret } from '../_shared';

// GET /api/cron/debug-dividendos?ticker=MSFT — diagnóstico de UNA SOLA VEZ: llama directo a Twelve
// Data (sin pasar por fetchDividendos, que traga errores a propósito para no romper el flujo
// normal) y devuelve el HTTP status + body crudo, para ver EXACTAMENTE por qué no está trayendo
// datos. Nunca expone la key (se recorta del preview por las dudas, algunas APIs la reflejan en
// mensajes de error). Mismo guard que refresh-all/backfill-cobros.

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

export const onRequestGet = guard(async ({ request, env }) => {
  const authErr = requireCronSecret(env, request);
  if (authErr) return authErr;
  const ticker = (new URL(request.url).searchParams.get('ticker') || 'MSFT').toUpperCase();
  const out: Record<string, unknown> = { ticker };

  if (!env.TWELVE_DATA_API_KEY) {
    out.twelveData = { error: 'TWELVE_DATA_API_KEY no está configurada en esta Function' };
  } else {
    const key = env.TWELVE_DATA_API_KEY;
    try {
      const res = await fetch(`https://api.twelvedata.com/dividends?symbol=${ticker}&apikey=${key}&range=5Y`);
      const body = (await res.text()).replaceAll(key, '***').slice(0, 800);
      out.twelveData = { httpStatus: res.status, bodyPreview: body };
    } catch (e) {
      out.twelveData = { error: String(e).replaceAll(key, '***') };
    }
  }

  // Con key real configurada, prueba con el ticker pedido; si no, cae a la key DEMO pública
  // (solo sirve para AAPL/IBM, no para tickers reales del portfolio) para poder seguir probando
  // si el endpoint funciona en el tier gratis mientras no hay key propia todavía.
  if (env.EODHD_API_KEY) {
    try {
      const res = await fetch(`https://eodhd.com/api/div/${ticker}.US?api_token=${env.EODHD_API_KEY}&fmt=json`);
      const body = (await res.text()).replaceAll(env.EODHD_API_KEY, '***').slice(0, 800);
      out.eodhd = { httpStatus: res.status, bodyPreview: body, nota: `probado con ${ticker}.US (key real)` };
    } catch (e) {
      out.eodhd = { error: String(e).replaceAll(env.EODHD_API_KEY, '***') };
    }
  } else {
    try {
      const res = await fetch('https://eodhd.com/api/div/AAPL.US?api_token=demo&fmt=json&from=2025-01-01');
      const body = (await res.text()).slice(0, 800);
      out.eodhd = { httpStatus: res.status, bodyPreview: body, nota: 'sin EODHD_API_KEY — probado con la key demo pública (solo funciona con AAPL.US)' };
    } catch (e) {
      out.eodhd = { error: String(e) };
    }
  }

  if (env.ALPHA_VANTAGE_API_KEY) {
    try {
      const res = await fetch(`https://www.alphavantage.co/query?function=DIVIDENDS&symbol=${ticker}&apikey=${env.ALPHA_VANTAGE_API_KEY}`);
      const body = (await res.text()).replaceAll(env.ALPHA_VANTAGE_API_KEY, '***').slice(0, 800);
      out.alphaVantage = { httpStatus: res.status, bodyPreview: body, nota: `probado con ${ticker} (key real)` };
    } catch (e) {
      out.alphaVantage = { error: String(e).replaceAll(env.ALPHA_VANTAGE_API_KEY, '***') };
    }
  } else {
    try {
      const res = await fetch('https://www.alphavantage.co/query?function=DIVIDENDS&symbol=IBM&apikey=demo');
      const body = (await res.text()).slice(0, 800);
      out.alphaVantage = { httpStatus: res.status, bodyPreview: body, nota: 'sin ALPHA_VANTAGE_API_KEY — probado con la key demo pública (solo funciona con IBM)' };
    } catch (e) {
      out.alphaVantage = { error: String(e) };
    }
  }

  return json(out);
});
