import { type Env, json, preflight, guard, sbSelect, sbRpc, cacheFresh, cacheLast, sbUpsert, requireCronSecret } from '../_shared';
import { fetchDividendos, type DividendEvent } from '../_dividendos';
import { sugerirDividendosHistoricos, sugerirCuponesHistoricos, type PosicionParaCobro } from '../_cobros_pendientes';

// GET /api/cron/backfill-cobros?desde=2026-01-01&hasta=2026-07-30
// Carga HISTÓRICA (una sola vez / a demanda, no cada 30 min como refresh-all): recorre TODO el
// rango [desde,hasta] en vez de solo "hoy", para posiciones que ya existían antes de que el cron
// empezara a sugerir cobros — sin esto, los pagos que cayeron en fechas pasadas quedan sin
// sugerir para siempre (el cron normal solo mira si el evento llegó a HOY en cada corrida).
// Mismas garantías que refresh-all: SIEMPRE 'pendiente' (nunca confirma solo), mismo índice de
// dedupe (correrlo dos veces sobre el mismo rango no duplica nada).
const TTL = 24 * 60 * 60 * 1000; // 24h, igual que /api/market/dividendos

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

export const onRequestGet = guard(async ({ request, env }) => {
  // Mismo criterio que refresh-all.ts (ver requireCronSecret en _shared.ts): sin CRON_SECRET
  // configurado, el endpoint se niega a correr en vez de quedar abierto a cualquiera.
  const authErr = requireCronSecret(env, request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = url.searchParams.get('desde') || `${hoy.slice(0, 4)}-01-01`;
  const hasta = url.searchParams.get('hasta') || hoy;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) {
    return json({ error: 'rango inválido', detail: 'desde/hasta deben ser YYYY-MM-DD con desde <= hasta' }, 400);
  }

  const pos = await sbSelect<PosicionParaCobro>(env, 'posiciones',
    'select=id,portfolio_id,ticker,tipo,cantidad,ratio_cedear,cupon_tasa,cupon_frecuencia,cupon_mes,vencimiento&cantidad=gt.0');

  // Ya cobrados/sugeridos CERCA de la fecha del evento (±10 días) para las mismas posición+tipo:
  // el índice de dedupe de la RPC solo detecta fecha EXACTA, pero un dividendo que el cron ya
  // sugirió con una fecha ESTIMADA (cadencia histórica, sin declaración del proveedor todavía)
  // puede diferir en unos días de la fecha REAL que trae el historial acá — sin este filtro,
  // ambas sugerencias conviven como dos filas 'pendiente' del mismo pago, y confirmar las dos
  // duplica el ingreso. Se compara contra CUALQUIER estado (no solo confirmado): una ya
  // descartada/pendiente para esas fechas también cuenta como "ya cubierta".
  const posIds = pos.map(p => p.id);
  const existentes = posIds.length
    ? await sbSelect<{ posicion_id: string; tipo: string; fecha: string }>(env, 'cobros',
        `select=posicion_id,tipo,fecha&posicion_id=in.(${posIds.join(',')})`)
    : [];
  const DIEZ_DIAS_MS = 10 * 24 * 60 * 60 * 1000;
  const yaCubierto = (posicionId: string, tipo: string, fecha: string) => {
    const t = Date.parse(fecha);
    return existentes.some(e => e.posicion_id === posicionId && e.tipo === tipo && Math.abs(Date.parse(e.fecha) - t) <= DIEZ_DIAS_MS);
  };

  let cupones = 0, dividendos = 0, sinHistorial = 0;

  // Bonos: 100% sintético (tasa/frecuencia/mes cargados a mano), sin dependencia externa.
  for (const p of pos.filter(p => p.tipo === 'bono')) {
    for (const sug of sugerirCuponesHistoricos(p, desde, hasta)) {
      if (yaCubierto(sug.posicion_id, sug.tipo, sug.fecha)) continue;
      try {
        await sbRpc(env, 'insertar_cobro_pendiente_cron', {
          p_portfolio_id: sug.portfolio_id, p_posicion_id: sug.posicion_id, p_ticker: sug.ticker,
          p_tipo: sug.tipo, p_fecha: sug.fecha, p_monto: sug.monto, p_nota: sug.nota,
        });
        cupones++;
      } catch { /* una sugerencia fallida no frena las demás */ }
    }
  }

  // Equities: un fetch por TICKER único (no por posición — varios portfolios pueden compartir
  // ticker), cacheado en dividendos_cache igual que /api/market/dividendos.
  const equities = pos.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf');
  const tickersUnicos = [...new Set(equities.map(p => p.ticker.toUpperCase()))];
  const historicoPorTicker: Record<string, DividendEvent[] | null> = {};
  await Promise.all(tickersUnicos.map(async (t) => {
    const cached = await cacheFresh<{ data_json: { historical: DividendEvent[] } }>(env, 'dividendos_cache', 'ticker', t, TTL);
    if (cached?.data_json?.historical) { historicoPorTicker[t] = cached.data_json.historical; return; }
    const historical = await fetchDividendos(env, t);
    if (historical) {
      historicoPorTicker[t] = historical;
      await sbUpsert(env, 'dividendos_cache', [{ ticker: t, data_json: { historical }, updated_at: new Date().toISOString() }], 'ticker');
      return;
    }
    const last = await cacheLast<{ data_json: { historical: DividendEvent[] } }>(env, 'dividendos_cache', 'ticker', t);
    historicoPorTicker[t] = last?.data_json?.historical ?? null;
    if (!historicoPorTicker[t]) sinHistorial++;
  }));

  for (const p of equities) {
    const historical = historicoPorTicker[p.ticker.toUpperCase()] ?? null;
    for (const sug of sugerirDividendosHistoricos(p, historical, desde, hasta)) {
      if (yaCubierto(sug.posicion_id, sug.tipo, sug.fecha)) continue;
      try {
        await sbRpc(env, 'insertar_cobro_pendiente_cron', {
          p_portfolio_id: sug.portfolio_id, p_posicion_id: sug.posicion_id, p_ticker: sug.ticker,
          p_tipo: sug.tipo, p_fecha: sug.fecha, p_monto: sug.monto, p_nota: sug.nota,
        });
        dividendos++;
      } catch { /* una sugerencia fallida no frena las demás */ }
    }
  }

  // Sin tickers en la respuesta (evita filtrar la composición del portfolio) — mismo criterio que
  // refresh-all.ts, solo conteos agregados.
  return json({ ok: true, desde, hasta, cupones, dividendos, tickersUnicos: tickersUnicos.length, sinHistorial });
});
