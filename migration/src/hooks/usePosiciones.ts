import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { useAuth } from './useAuth';
import { consolidarCompra, reconstruirTenencia } from '../engine/tenencia';
import type { DividendoInfo } from '../engine/dividendProjection';
import type { Posicion, Movimiento } from '../types/domain';

// Historial de movimientos de un portfolio (opcionalmente filtrado por ticker).
export function useMovimientos(portfolioId: string | null | undefined, ticker?: string) {
  return useQuery({
    queryKey: ['movimientos', portfolioId, ticker ?? 'all'],
    enabled: !!portfolioId,
    queryFn: async (): Promise<Movimiento[]> => {
      let q = supabase.from('movimientos').select('*')
        .eq('portfolio_id', portfolioId)
        .order('fecha', { ascending: false }).order('created_at', { ascending: false });
      if (ticker) q = q.eq('ticker', ticker);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePosiciones(portfolioId: string | null | undefined) {
  return useQuery({
    queryKey: ['posiciones', portfolioId],
    enabled: !!portfolioId,
    queryFn: async (): Promise<Posicion[]> => {
      const { data, error } = await supabase.from('posiciones')
        .select('*').eq('portfolio_id', portfolioId).order('peso_objetivo', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// All positions across the user's active portfolios (for the consolidated view).
// La key incluye el user_id: sin eso, la cache persistida podría rehidratar datos de otra
// cuenta que usó el mismo navegador.
export function useAllPosiciones(enabled: boolean) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['posiciones', 'all', session?.user.id ?? 'anon'],
    enabled: enabled && !!session,
    queryFn: async (): Promise<Posicion[]> => {
      const { data, error } = await supabase.from('posiciones').select('*');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePosicionMutations(portfolioId: string | null | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['posiciones'] });
    qc.invalidateQueries({ queryKey: ['movimientos'] });
  };
  return {
    // Alta con CONSOLIDACIÓN: si el activo ya existe en el portfolio, suma la cantidad y
    // recalcula el precio con costo promedio ponderado; si no, crea la posición. Siempre
    // registra el movimiento (compra) para dejar el historial completo.
    add: async (p: Partial<Posicion>) => {
      const ticker = (p.ticker ?? '').toUpperCase().trim();
      const addQty = Number(p.cantidad) || 0;
      const addPrice = Number(p.precio_compra) || 0;
      if (!p.tipo) throw new Error('Elegí el tipo de activo.'); // sin tipo, .eq('tipo','') nunca consolida
      // Sin esto, una cantidad negativa RESTABA de la posición sin registrar movimiento (el insert
      // del movimiento está bajo `addQty > 0`), dejando cantidad y costo promedio inconsistentes.
      if (!(addQty > 0)) throw new Error('La cantidad debe ser mayor a 0.');
      if (addPrice < 0) throw new Error('El precio no puede ser negativo.');

      const { data: existing, error: selErr } = await supabase.from('posiciones')
        .select('*').eq('portfolio_id', portfolioId).eq('ticker', ticker).eq('tipo', p.tipo)
        .limit(1).maybeSingle();
      if (selErr) throw selErr;

      let posId: string;
      if (existing) {
        // Motor puro y testeado (engine/tenencia): costo promedio ponderado.
        const t = consolidarCompra(
          { cantidad: Number(existing.cantidad) || 0, costoPromedio: Number(existing.precio_compra) || 0 },
          addQty, addPrice);
        const patch: Partial<Posicion> = { cantidad: t.cantidad, precio_compra: t.costoPromedio };
        // completar campos que faltaban en la posición existente
        if (existing.ratio_cedear == null && p.ratio_cedear != null) patch.ratio_cedear = p.ratio_cedear;
        if (!existing.sector && p.sector) patch.sector = p.sector;
        if (existing.peso_objetivo == null && p.peso_objetivo != null) patch.peso_objetivo = p.peso_objetivo;
        // datos de cupón: si el activo es bono y no los tenía, tomarlos
        if (existing.cupon_tasa == null && p.cupon_tasa != null) patch.cupon_tasa = p.cupon_tasa;
        if (existing.cupon_frecuencia == null && p.cupon_frecuencia != null) patch.cupon_frecuencia = p.cupon_frecuencia;
        if (existing.cupon_mes == null && p.cupon_mes != null) patch.cupon_mes = p.cupon_mes;
        if (existing.vencimiento == null && p.vencimiento != null) patch.vencimiento = p.vencimiento;
        const { error: updErr } = await supabase.from('posiciones').update(patch).eq('id', existing.id);
        if (updErr) throw updErr;
        posId = existing.id;
      } else {
        const { data: created, error: insErr } = await supabase.from('posiciones')
          // fecha_compra por defecto = hoy: el form no la pedía y quedaba NULL, lo que dejaba sin
          // base a la TIR por costos y al año de inicio del rendimiento.
          .insert({ ...p, ticker, portfolio_id: portfolioId, fecha_compra: p.fecha_compra ?? new Date().toISOString().slice(0, 10) })
          .select('id').single();
        if (insErr) throw insErr;
        posId = created.id;
      }

      if (addQty > 0) {
        // Chequear el error: si el movimiento no se registra, el P&L realizado quedaría mal y
        // el usuario no se enteraría. La posición ya se actualizó, así que lo hacemos visible.
        const { error: movErr } = await supabase.from('movimientos').insert({
          portfolio_id: portfolioId, posicion_id: posId, ticker,
          tipo: 'compra', cantidad: addQty, precio: addPrice,
          fecha: p.fecha_compra ?? new Date().toISOString().slice(0, 10),
          nota: p.notas ?? null,
        });
        if (movErr) { invalidate(); throw new Error(`Posición guardada, pero no se pudo registrar el movimiento: ${movErr.message}`); }
      }
      invalidate();
    },
    // Venta: descuenta cantidad y registra el movimiento. El costo promedio (precio_compra) NO
    // cambia al vender. Si la cantidad llega a 0, la posición queda "cerrada" (cantidad 0) pero
    // no se borra, para conservar el historial y poder reabrirla con una compra futura.
    sell: async (pos: Posicion, sellQty: number, sellPrice: number, fecha?: string) => {
      const qty = Math.min(Number(sellQty) || 0, Number(pos.cantidad) || 0);
      if (qty <= 0) throw new Error('Cantidad de venta inválida');
      // Si la posición no tiene historial (fue cargada antes de que existieran los movimientos),
      // registramos su compra base con la cantidad y costo actuales, para que el P&L realizado
      // se calcule sobre una base de costo correcta.
      // Chequear el error: si esta query falla (red), `count` queda undefined y se insertaría una
      // "compra base" duplicada que infla el costo y rompe el P&L realizado. Mejor abortar.
      const { count, error: cntErr } = await supabase.from('movimientos')
        .select('id', { count: 'exact', head: true }).eq('posicion_id', pos.id);
      if (cntErr) throw new Error(`No se pudo verificar el historial de ${pos.ticker}: ${cntErr.message}`);
      if (!count) {
        const { error: baseErr } = await supabase.from('movimientos').insert({
          portfolio_id: portfolioId, posicion_id: pos.id, ticker: pos.ticker,
          tipo: 'compra', cantidad: pos.cantidad, precio: pos.precio_compra,
          fecha: pos.fecha_compra ?? new Date().toISOString().slice(0, 10), nota: 'carga inicial',
        });
        if (baseErr) throw new Error(`No se pudo registrar la compra base: ${baseErr.message}`);
      }
      // Registrar la venta ANTES de descontar: si falla, abortamos y la cantidad no cambia
      // (nunca puede quedar una cantidad descontada sin su movimiento en el historial).
      const { error: ventaErr } = await supabase.from('movimientos').insert({
        portfolio_id: portfolioId, posicion_id: pos.id, ticker: pos.ticker,
        tipo: 'venta', cantidad: qty, precio: Number(sellPrice) || 0,
        fecha: fecha ?? new Date().toISOString().slice(0, 10), nota: null,
      });
      if (ventaErr) throw new Error(`No se pudo registrar la venta: ${ventaErr.message}`);
      const newQty = (Number(pos.cantidad) || 0) - qty;
      const { error } = await supabase.from('posiciones').update({ cantidad: newQty }).eq('id', pos.id);
      if (error) throw error; invalidate();
    },
    update: async (id: string, patch: Partial<Posicion>) => {
      // Solo el ticker puede colisionar con otra fila (cantidad/precio/etc. no tienen ese riesgo).
      // Sin este chequeo, renombrar un bono licitado al ticker de una posición ya existente del
      // mismo tipo crea un duplicado silencioso (no hay unique constraint en la tabla) — mismo
      // criterio que transferir_posicion(): rechazar en vez de mezclar costos en silencio.
      if (patch.ticker) {
        const ticker = patch.ticker.toUpperCase().trim();
        const { data: current, error: curErr } = await supabase.from('posiciones')
          .select('tipo').eq('id', id).single();
        if (curErr) throw curErr;
        const { data: dup, error: dupErr } = await supabase.from('posiciones')
          .select('id').eq('portfolio_id', portfolioId).eq('ticker', ticker).eq('tipo', current.tipo)
          .neq('id', id).limit(1).maybeSingle();
        if (dupErr) throw dupErr;
        if (dup) throw new Error(`Ya existe una posición de ${ticker} en este portfolio — no se puede renombrar (crearía un duplicado).`);
      }
      const { error } = await supabase.from('posiciones').update(patch).eq('id', id);
      if (error) throw error; invalidate();
    },
    // Escribe varios objetivos de una (para sincronizar el plan a 100%) e invalida una sola vez.
    setObjetivos: async (list: { id: string; peso_objetivo: number | null }[]) => {
      const changed = list.filter(x => x.peso_objetivo == null || Number.isFinite(x.peso_objetivo));
      const results = await Promise.all(changed.map(x =>
        supabase.from('posiciones').update({ peso_objetivo: x.peso_objetivo }).eq('id', x.id)));
      const failed = results.find(r => r.error);
      if (failed?.error) throw failed.error;
      invalidate();
    },
    // Borrar un movimiento mal cargado y RECALCULAR la posición desde los que quedan. Sin esto,
    // `movimientos` era la única tabla append-only: una venta con precio 0 (o un dedo gordo)
    // envenenaba el P&L realizado para siempre, y la única salida era borrar toda la posición.
    removeMovimiento: async (mov: Movimiento) => {
      const { error } = await supabase.from('movimientos').delete().eq('id', mov.id);
      if (error) throw error;
      if (mov.posicion_id) {
        const { data: resto, error: selErr } = await supabase.from('movimientos')
          .select('*').eq('posicion_id', mov.posicion_id)
          .order('fecha', { ascending: true }).order('created_at', { ascending: true });
        if (selErr) throw selErr;
        // Motor puro y testeado (engine/tenencia): reconstruye desde el historial restante.
        const t = reconstruirTenencia((resto ?? []) as Movimiento[]);
        const { error: updErr } = await supabase.from('posiciones')
          .update({ cantidad: t.cantidad, precio_compra: t.costoPromedio }).eq('id', mov.posicion_id);
        if (updErr) throw updErr;
      }
      invalidate();
    },
    remove: async (id: string) => {
      const { error } = await supabase.from('posiciones').delete().eq('id', id);
      if (error) throw error; invalidate();
    },
  };
}

// Live prices (US equities via Finnhub/FMP, bonds via data912, AR stocks via data912+MEP).
export function useQuotes(tickers: string[], bondTickers: string[] = [], arTickers: string[] = []) {
  // Dedupe: una posición partida entre brokers (misma posición, dos filas) repite el ticker acá.
  // Pedirlo/escribirlo dos veces en el mismo request rompía el batch entero del lado del server
  // (ver dedupeByConflictKey en functions/api/_shared.ts) — se corrige en las dos puntas.
  const eqTickers = [...new Set(tickers)];
  const bondTicks = [...new Set(bondTickers)];
  const arTicks = [...new Set(arTickers)];
  return useQuery({
    queryKey: ['quotes', [...eqTickers].sort().join(','), [...bondTicks].sort().join(','), [...arTicks].sort().join(',')],
    enabled: eqTickers.length > 0 || bondTicks.length > 0 || arTicks.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, number | null>> => {
      const [eq, bo, ar] = await Promise.allSettled([
        eqTickers.length ? api.quotes(eqTickers) : Promise.resolve({}),
        bondTicks.length ? api.bonos() : Promise.resolve({}),
        arTicks.length ? api.accionesAr(arTicks) : Promise.resolve({ precios: {} }),
      ]);
      const out: Record<string, number | null> = {};
      if (eq.status === 'fulfilled') Object.assign(out, eq.value);
      if (bo.status === 'fulfilled') for (const t of bondTicks) out[t] = (bo.value as Record<string, number>)[t] ?? null;
      if (ar.status === 'fulfilled') for (const t of arTicks) out[t] = (ar.value as { precios: Record<string, number | null> }).precios?.[t] ?? null;
      return out;
    },
  });
}

// Calendario de dividendos (declarado o estimado por cadencia histórica) por ticker — insumo de
// engine/dividendProjection.ts para proyectar los cobros futuros de CEDEARs/acciones/ETFs, igual
// que useQuotes alimenta las cotizaciones. TTL largo (24h, igual que el cache del server): un
// calendario de dividendos no cambia minuto a minuto.
export function useDividendosProyectados(tickers: string[]) {
  const eqTickers = [...new Set(tickers.map(t => t.toUpperCase()))];
  return useQuery({
    queryKey: ['dividendos-proyectados', [...eqTickers].sort().join(',')],
    enabled: eqTickers.length > 0,
    staleTime: 60 * 60_000,
    queryFn: (): Promise<Record<string, DividendoInfo | null>> => api.dividendos(eqTickers),
  });
}

// Última actualización de los caches de mercado (para mostrarle al usuario).
export function useDataStatus() {
  return useQuery({
    queryKey: ['data-status'],
    staleTime: 5 * 60_000,
    queryFn: () => api.status(),
  });
}

// Distancia al máximo de 52 semanas (drawdown) de S&P 500, oro y Merval.
export function useDrawdowns() {
  return useQuery({
    queryKey: ['drawdowns'],
    staleTime: 20 * 60_000,
    queryFn: () => api.drawdowns(),
  });
}

export function useMacro() {
  return useQuery({
    queryKey: ['macro'],
    staleTime: 15 * 60_000,
    queryFn: async () => {
      // allSettled: si una fuente cae (ej. riesgo-país 502), las demás igual se muestran.
      const [fx, rp, fred, ind] = await Promise.allSettled([api.fx(), api.riesgoPais(), api.fred(), api.indicadores()]);
      const out: Record<string, number | null> = {};
      if (fx.status === 'fulfilled') Object.assign(out, fx.value);
      if (rp.status === 'fulfilled') out.riesgo_pais = rp.value.riesgo_pais;
      if (fred.status === 'fulfilled') Object.assign(out, fred.value);
      if (ind.status === 'fulfilled') Object.assign(out, ind.value);
      return out;
    },
  });
}

// Precios de TODO el universo de bonos/ONs de BYMA (data912, ya en USD) — a diferencia de
// useQuotes(), que solo pide los tickers en cartera, esto trae el mapa completo. Lo usa el Radar de
// renta fija (useBonosReferencia) para valuar el catálogo de referencia, no solo lo que tenés.
export function useBonosPrecios() {
  return useQuery({
    queryKey: ['bonos_precios_universo'],
    staleTime: 5 * 60_000,
    queryFn: () => api.bonos(),
  });
}
