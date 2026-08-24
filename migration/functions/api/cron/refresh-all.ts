import { type Env, json, preflight, guard, sbSelect, sbRpc, tokenInterno, requireCronSecret } from '../_shared';
import { DEFAULT_CIK } from '../_edgar';
import { sugerirDividendoPendiente, sugerirCuponPendiente, type PosicionParaCobro } from '../_cobros_pendientes';
import type { DividendoInfo } from '../_dividendos';

// GET /api/cron/refresh-all
// Calienta TODAS las caches de mercado en una sola pasada server-side, para que la data se
// actualice sola sin depender de que la app esté abierta. Lo llama el workflow programado
// (refresh-market.yml). Reutiliza los endpoints /api/market/* — cada uno escribe su propia
// cache en Supabase, así hay una única fuente de verdad para cada fetch/parseo.
//
// No devuelve la lista de tickers (evita filtrar la composición del portfolio); solo conteos.

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

export const onRequestGet = guard(async ({ request, env }) => {
  // Solo el workflow (que manda X-Cron-Secret) puede dispararlo — sin CRON_SECRET configurado el
  // endpoint se niega a correr (ver requireCronSecret en _shared.ts).
  const authErr = requireCronSecret(env, request);
  if (authErr) return authErr;
  const origin = new URL(request.url).origin;

  const headers: Record<string, string> = { 'X-Internal-Refresh': await tokenInterno(env), 'X-Cron-Secret': env.CRON_SECRET! };
  const hit = async (path: string) => {
    try {
      const r = await fetch(`${origin}${path}`, { headers });
      return r.ok;
    } catch { return false; }
  };

  // 1) Macro + renta fija (no dependen de posiciones)
  const base = ['/api/market/fx', '/api/market/bonos', '/api/market/riesgo-pais', '/api/market/fred', '/api/market/indicadores'];

  // 2) Posiciones reales (service-role → ve todos los portfolios). Selección amplia: además de
  // refrescar cotizaciones, estos mismos campos alimentan la sugerencia de cobros pendientes
  // (paso 4) — una sola consulta para ambos usos.
  const pos = await sbSelect<PosicionParaCobro>(env, 'posiciones',
    'select=id,portfolio_id,ticker,tipo,cantidad,ratio_cedear,cupon_tasa,cupon_frecuencia,cupon_mes,vencimiento');
  const uniq = (a: string[]) => [...new Set(a.map(s => s.toUpperCase()).filter(Boolean))];
  const equity = uniq(pos.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker));
  const ar = uniq(pos.filter(p => p.tipo === 'accion_ar').map(p => p.ticker));
  // (los bonos se refrescan enteros en /api/market/bonos; el cash no cotiza)

  // 3) CIKs conocidos: DEFAULT_CIK + cik_map. Solo pedimos fundamentals de lo que tiene CIK.
  const mapRows = await sbSelect<{ ticker: string; cik: string }>(env, 'cik_map', 'select=ticker,cik');
  const cikOf: Record<string, string> = { ...DEFAULT_CIK };
  for (const r of mapRows) if (r.ticker && r.cik) cikOf[r.ticker.toUpperCase()] = r.cik;

  const dyn: string[] = [];
  if (equity.length) dyn.push(`/api/market/quotes?tickers=${equity.join(',')}`);
  if (ar.length) dyn.push(`/api/market/acciones-ar?tickers=${ar.join(',')}`);
  for (const t of equity) {
    const cik = cikOf[t];
    if (cik) dyn.push(`/api/market/fundamentals?ticker=${t}&cik=${cik}`);
  }

  // Además de lo tenido en cartera, calentamos de a poco el universo completo de renta variable
  // hardcodeado del Radar (DEFAULT_CIK, ~84 tickers) — así el usuario ve datos ya cargados la
  // primera vez que abre un análisis, en vez de depender de haberlo visitado antes (fundamentals_cache
  // es reactivo por naturaleza: sin esto, una empresa que nadie miró nunca queda sin fila indefinidamente).
  // Se limita a un lote chico por corrida (no todas las ~84 juntas) para no arrastrar el timeout de
  // 120s del workflow (ver refresh-market.yml) ni el tiempo de ejecución de la Function, lo que
  // dejaría sin correr la lógica de cobros pendientes más abajo — el TTL de 12h de fundamentals.ts
  // hace que las ya frescas se salteen solas, así que el backfill completo se completa solo en unas
  // pocas corridas (cada 30 min) y de ahí en más mantiene las 84 al día automáticamente.
  // Bajado de 20 a 8: cada fundamentals.ts puede disparar hasta ~35 subrequests al proxy de EDGAR
  // (ver SUBREQUEST_BUDGET_FETCH_FUNDAMENTALS en _edgar.ts) — un lote grande arriesga generar el
  // mismo rate-limit (429) que después deja tickers con datos parciales (ungradeable), el problema
  // que este backfill busca resolver, no empeorar. Con 8 el backfill completo tarda más corridas
  // (~10, cada 30 min) pero no compite por cupo con la propia causa del problema.
  const MAX_FUNDAMENTALS_EXTRA_POR_CORRIDA = 8;
  const yaConsultados = new Set(equity);
  const universoRentaVariable = Object.keys(DEFAULT_CIK).filter(t => !yaConsultados.has(t));
  if (universoRentaVariable.length) {
    const cache = await sbSelect<{ ticker: string; updated_at: string }>(env, 'fundamentals_cache',
      `select=ticker,updated_at&ticker=in.(${universoRentaVariable.join(',')})`);
    const frescoDesde = Date.now() - 12 * 60 * 60 * 1000;
    const frescos = new Set(cache.filter(c => Date.parse(c.updated_at) > frescoDesde).map(c => c.ticker));
    const faltantes = universoRentaVariable.filter(t => !frescos.has(t)).slice(0, MAX_FUNDAMENTALS_EXTRA_POR_CORRIDA);
    for (const t of faltantes) dyn.push(`/api/market/fundamentals?ticker=${t}&cik=${DEFAULT_CIK[t]}`);
  }

  // Secuencial para no reventar los rate limits de EDGAR/Finnhub.
  let ok = 0;
  const paths = [...base, ...dyn];
  for (const p of paths) if (await hit(p)) ok++;

  // 4) Cobros pendientes: dividendos reales (equities, vía FMP/Finnhub) + cupones sintéticos
  // (bonos, desde los 4 campos manuales) que ya llegaron a su fecha proyectada. SIEMPRE quedan en
  // estado 'pendiente' — el cron NUNCA los confirma solo; eso lo decide el usuario a mano (ver
  // 0012_cobros_pendientes.sql y engine/cobros.ts). Falla aislada: si esto se cae, no afecta ok/total.
  let pendientes = 0;
  const hoy = new Date().toISOString().slice(0, 10);
  // Los dividendos de equities dependen de un proveedor externo; los cupones de bonos son 100%
  // sintéticos (datos ya cargados a mano) y NO deberían dejar de sugerirse solo porque el fetch de
  // dividendos falló — antes un try/catch envolvía las DOS cosas y una caída del proveedor externo
  // se llevaba puestos también los cupones de bonos, que no tienen nada que ver.
  let divPorTicker: Record<string, DividendoInfo | null> = {};
  try {
    if (equity.length) {
      const r = await fetch(`${origin}/api/market/dividendos?tickers=${equity.join(',')}`, { headers });
      if (r.ok) divPorTicker = await r.json();
    }
  } catch { /* sin dividendos disponibles (sin key, proveedor caído): los cupones de bonos siguen */ }

  // Mismo guard ±10 días que backfill-cobros.ts (ver su comentario): el índice de dedupe de la RPC
  // solo detecta fecha EXACTA, pero `sugerirDividendoPendiente` puede devolver una fecha ESTIMADA
  // (cadencia histórica, sin declaración del proveedor todavía) que se corre unos días entre
  // corridas del cron (cada 30 min) a medida que el proveedor actualiza su estimación — sin este
  // filtro, cada corrida con una fecha distinta insertaba una fila 'pendiente' nueva del mismo pago.
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

  for (const p of pos) {
    const sug = p.tipo === 'bono'
      ? sugerirCuponPendiente(p, hoy)
      : sugerirDividendoPendiente(p, divPorTicker[p.ticker.toUpperCase()] ?? null, hoy);
    if (!sug || yaCubierto(sug.posicion_id, sug.tipo, sug.fecha)) continue;
    try {
      await sbRpc(env, 'insertar_cobro_pendiente_cron', {
        p_portfolio_id: sug.portfolio_id, p_posicion_id: sug.posicion_id, p_ticker: sug.ticker,
        p_tipo: sug.tipo, p_fecha: sug.fecha, p_monto: sug.monto, p_nota: sug.nota,
      });
      pendientes++;
    } catch { /* una sugerencia fallida no frena las demás */ }
  }

  // Solo conteos agregados — sin tickers ni montos (no filtrar composición del portfolio).
  return json({ ok, total: paths.length, pendientes });
});
