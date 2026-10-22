import { type Env, json, preflight, guard, sbSelect, sbRpc, sbUpsert, tokenInterno, requireCronSecret } from '../_shared';
import { DEFAULT_CIK } from '../_edgar';
import {
  sugerirDividendoPendiente, sugerirCuponPendiente, sugerirCuponesDeCronograma, cronogramaVigente,
  type PosicionParaCobro, type FlujoCronograma, type CobroPendienteSugerido, type MovCantidad,
} from '../_cobros_pendientes';
import type { DividendoInfo } from '../_dividendos';
import { armarSnapshots, type PosicionValuable, type PrecioCache, type AporteMin } from '../_snapshots';
import { filasEstimadas, urlIPC } from '../_impuestosParametros';

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
  // Diagnóstico de FRED: si el endpoint no pudo leer el CSV devuelve (solo al cron) qué recibió; queda en la respuesta de este cron, que el workflow imprime.
  let fredDiag: string | null = null;
  const hit = async (path: string) => {
    try {
      const r = await fetch(`${origin}${path}`, { headers });
      if (path === '/api/market/fred' && r.ok) {
        const j = await r.clone().json().catch(() => null) as { _diag?: string[] } | null;
        if (j?._diag?.length) fredDiag = j._diag.join(' | ').slice(0, 260);
      }
      return r.ok;
    } catch { return false; }
  };

  // 1) Macro + renta fija (no dependen de posiciones)
  const base = ['/api/market/fx', '/api/market/bonos', '/api/market/riesgo-pais', '/api/market/fred', '/api/market/indicadores'];

  // 2) Posiciones reales (service-role → ve todos los portfolios). Selección amplia: además de
  // refrescar cotizaciones, estos mismos campos alimentan la sugerencia de cobros pendientes
  // (paso 4) — una sola consulta para ambos usos.
  const pos = await sbSelect<PosicionParaCobro>(env, 'posiciones',
    'select=id,portfolio_id,ticker,tipo,cantidad,ratio_cedear,cupon_tasa,cupon_frecuencia,cupon_mes,vencimiento,fecha_compra,precio_compra');
  const uniq = (a: string[]) => [...new Set(a.map(s => s.toUpperCase()).filter(Boolean))];
  // Solo posiciones ABIERTAS: las cerradas (cantidad 0) no necesitan cotización ni fundamentals, y
  // cada una gastaba subrequests del techo de 50 por invocación de Cloudflare.
  const abiertas = pos.filter(p => Number(p.cantidad) > 0);
  const equity = uniq(abiertas.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker));
  const ar = uniq(abiertas.filter(p => p.tipo === 'accion_ar').map(p => p.ticker));
  // (los bonos se refrescan enteros en /api/market/bonos; el cash no cotiza)

  // 3) CIKs conocidos: DEFAULT_CIK + cik_map. Solo pedimos fundamentals de lo que tiene CIK.
  const mapRows = await sbSelect<{ ticker: string; cik: string }>(env, 'cik_map', 'select=ticker,cik');
  const cikOf: Record<string, string> = { ...DEFAULT_CIK };
  for (const r of mapRows) if (r.ticker && r.cik) cikOf[r.ticker.toUpperCase()] = r.cik;

  const precios: string[] = [];
  if (equity.length) precios.push(`/api/market/quotes?tickers=${equity.join(',')}`);
  if (ar.length) precios.push(`/api/market/acciones-ar?tickers=${ar.join(',')}`);
  const fund: string[] = [];
  for (const t of equity) {
    const cik = cikOf[t];
    if (cik) fund.push(`/api/market/fundamentals?ticker=${t}&cik=${cik}`);
  }

  // Además de lo tenido en cartera, calentamos de a poco el universo completo de renta variable
  // hardcodeado del Radar (DEFAULT_CIK, ~84 tickers) — así el usuario ve datos ya cargados la
  // primera vez que abre un análisis, en vez de depender de haberlo visitado antes (fundamentals_cache
  // es reactivo por naturaleza: sin esto, una empresa que nadie miró nunca queda sin fila indefinidamente).
  // Se limita a un lote chico por corrida (no todas las ~84 juntas) para no arrastrar el timeout de
  // 120s del workflow (ver refresh-market.yml) ni el techo de subrequests de la Function (los cobros
  // pendientes ya corren ANTES que los fundamentals, ver el orden más abajo) — el TTL de 12h de fundamentals.ts
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
    for (const t of faltantes) fund.push(`/api/market/fundamentals?ticker=${t}&cik=${DEFAULT_CIK[t]}`);
  }

  // Secuencial para no reventar los rate limits de EDGAR/Finnhub. ORDEN: precios → cobros pendientes →
  // fundamentals. Cloudflare corta la invocación en ~50 subrequests: antes los fundamentals (lo más
  // numeroso y lo menos urgente — tienen TTL de 12h) iban primero, y al crecer la cartera podían agotar
  // el cupo antes de llegar a los cobros pendientes, que dejaban de generarse sin ningún aviso.
  let ok = 0;
  const prioritarios = [...base, ...precios];
  for (const p of prioritarios) if (await hit(p)) ok++;

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

  // Cupones de bonos con FECHA EXACTA: cronograma de la emisión (bonos_referencia) cuando está vigente; si el bono no está en
  // el catálogo o su cronograma ya venció, cae al cálculo sintético por mes (día 1) de siempre.
  const bonosTickers = [...new Set(pos.filter(p => p.tipo === 'bono' && p.cantidad > 0).map(p => p.ticker.toUpperCase()))];
  const cronoPorTicker = new Map<string, FlujoCronograma[]>();
  if (bonosTickers.length) {
    try {
      const filas = await sbSelect<{ ticker: string; cronograma: FlujoCronograma[] | null }>(env, 'bonos_referencia',
        `select=ticker,cronograma&ticker=in.(${bonosTickers.join(',')})`);
      for (const f of filas) if (cronogramaVigente(f.cronograma, hoy)) cronoPorTicker.set(f.ticker.toUpperCase(), f.cronograma);
    } catch { /* sin catálogo: todos los bonos van por el cálculo sintético */ }
  }
  // Ventana de 35 días hacia atrás: si el cron no corrió un día no se pierde un cupón, y `fecha_compra` descarta los anteriores
  // a la compra. Los cupones de un bono son semestrales/trimestrales: con una fila ya cargada en el MISMO MES (p. ej. la que el
  // cálculo por mes dejó el día 1) no se suma otra — el guard de ±10 días solo no alcanza entre el 1 y el 14 o el 24.
  const desdeCupon = new Date(Date.parse(hoy) - 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const yaCubiertoMes = (posicionId: string, tipo: string, fecha: string) =>
    existentes.some(e => e.posicion_id === posicionId && e.tipo === tipo && e.fecha.slice(0, 7) === fecha.slice(0, 7));

  // Movimientos recientes de las posiciones de renta variable: sirven para contar solo las unidades que se tenían al ex-dividendo
  // (ver cantidadAlCorte). 150 días cubren el hueco ex-dividendo → pago de cualquier calendario trimestral.
  const movsPorPos = new Map<string, MovCantidad[]>();
  const eqIds = pos.filter(p => p.tipo !== 'bono' && p.tipo !== 'cash' && p.cantidad > 0).map(p => p.id);
  if (eqIds.length) {
    try {
      const desdeMov = new Date(Date.parse(hoy) - 150 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const filas = await sbSelect<MovCantidad & { posicion_id: string }>(env, 'movimientos',
        `select=posicion_id,tipo,cantidad,fecha&fecha=gte.${desdeMov}&posicion_id=in.(${eqIds.join(',')})`);
      for (const f of filas) (movsPorPos.get(f.posicion_id) ?? movsPorPos.set(f.posicion_id, []).get(f.posicion_id)!).push(f);
    } catch { /* sin movimientos: se usa la cantidad actual (comportamiento anterior) */ }
  }

  const sugerencias: CobroPendienteSugerido[] = [];
  for (const p of pos) {
    if (p.tipo === 'bono') {
      const crono = cronoPorTicker.get(p.ticker.toUpperCase());
      if (crono) {
        for (const s of sugerirCuponesDeCronograma(p, crono, desdeCupon, hoy)) {
          if (!yaCubierto(s.posicion_id, s.tipo, s.fecha) && !yaCubiertoMes(s.posicion_id, s.tipo, s.fecha)) sugerencias.push(s);
        }
        continue;
      }
      const s = sugerirCuponPendiente(p, hoy);
      if (s && !yaCubierto(s.posicion_id, s.tipo, s.fecha)) sugerencias.push(s);
      continue;
    }
    const s = sugerirDividendoPendiente(p, divPorTicker[p.ticker.toUpperCase()] ?? null, hoy, movsPorPos.get(p.id));
    if (s && !yaCubierto(s.posicion_id, s.tipo, s.fecha)) sugerencias.push(s);
  }
  for (const sug of sugerencias) {
    try {
      await sbRpc(env, 'insertar_cobro_pendiente_cron', {
        p_portfolio_id: sug.portfolio_id, p_posicion_id: sug.posicion_id, p_ticker: sug.ticker,
        p_tipo: sug.tipo, p_fecha: sug.fecha, p_monto: sug.monto, p_nota: sug.nota,
      });
      pendientes++;
    } catch { /* una sugerencia fallida no frena las demás */ }
  }

  // 4b) Valor diario de cada cartera (portfolio_snapshots) y dólar diario (fx_historico), grabados por el SERVIDOR: el histórico de
  // rendimiento, benchmark y máxima caída no puede depender de que se abra la app (hubo un hueco de 205 días). Solo se graba una
  // cartera si TODAS sus posiciones abiertas tienen precio fresco (ver functions/api/_snapshots.ts). Falla aislada: no afecta ok/total.
  let snapshots = 0;
  try {
    const abiertasSnap = pos.filter(p => Number(p.cantidad) > 0) as unknown as PosicionValuable[];
    const tickersSnap = uniq(abiertasSnap.filter(p => p.tipo !== 'cash' && p.tipo !== 'accion_ar').map(p => p.ticker));
    const precios = new Map<string, PrecioCache>();
    if (tickersSnap.length) {
      const filas = await sbSelect<PrecioCache>(env, 'precios_cache', `select=ticker,precio,updated_at&ticker=in.(${tickersSnap.join(',')})`);
      for (const f of filas) precios.set(f.ticker.toUpperCase(), f);
    }
    const aportesSnap = await sbSelect<AporteMin>(env, 'aportes', 'select=portfolio_id,fecha,monto,tipo');
    const { filas: filasSnap } = armarSnapshots(hoy, abiertasSnap, precios, aportesSnap, Date.now());
    if (filasSnap.length) { await sbUpsert(env, 'portfolio_snapshots', filasSnap, 'portfolio_id,fecha'); snapshots = filasSnap.length; }

    const fx = await sbSelect<{ clave: string; valor: number }>(env, 'macro_cache', 'select=clave,valor&clave=in.(dolar_mep,dolar_ccl)');
    const mep = fx.find(f => f.clave === 'dolar_mep')?.valor ?? null, ccl = fx.find(f => f.clave === 'dolar_ccl')?.valor ?? null;
    if (mep != null || ccl != null) await sbUpsert(env, 'fx_historico', [{ fecha: hoy, mep, ccl, fuente: 'cron' }], 'fecha');
  } catch { /* sin snapshot hoy: la app lo graba al abrirse y mañana el cron reintenta */ }

  // 4c) Parámetros de Bienes Personales del año en curso, estimados con el IPC de INDEC cuando ya publicó octubre (mediados de noviembre),
  // antes de que ARCA publique la oficial. Solo escribe si NO hay fila de ese año (nunca pisa una oficial) y como mucho un fetch por
  // corrida; falla aislada: la app cae a los parámetros del código (ver functions/api/_impuestosParametros.ts).
  try {
    const existentes = await sbSelect<{ anio: number; clave: string; valor: unknown; estimado: boolean }>(env, 'impuestos_parametros', 'select=anio,clave,valor,estimado');
    const filasParam = await filasEstimadas(Number(hoy.slice(0, 4)), existentes, async desde => {
      const r = await fetch(urlIPC(desde), { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`INDEC ${r.status}`);
      return r.json();
    }, hoy);
    if (filasParam.length) await sbUpsert(env, 'impuestos_parametros', filasParam.map(f => ({ ...f, actualizado: new Date().toISOString() })), 'anio,clave');
  } catch { /* sin parámetros estimados hoy: mañana el cron reintenta */ }

  // 5) Fundamentals al final (ver orden arriba).
  for (const p of fund) if (await hit(p)) ok++;

  // Solo conteos agregados — sin tickers ni montos (no filtrar composición del portfolio).
  return json({ ok, total: prioritarios.length + fund.length, pendientes, snapshots, ...(fredDiag ? { fredDiag } : {}) });
});
