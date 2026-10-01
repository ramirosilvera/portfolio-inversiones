import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { useAuth } from './useAuth';
import { consolidarCompra, reconstruirTenencia, movimientoConciliacion } from '../engine/tenencia';
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

// Deja el historial de movimientos de una posición CUADRADO con su estado actual (cantidad + costo),
// agregando el movimiento de conciliación que calcule engine/tenencia#movimientoConciliacion. Se
// llama ANTES de cualquier escritura que dependa del historial (comprar más, vender, borrar un
// movimiento, amortizar) y DESPUÉS de una edición manual de cantidad: sin esto, una posición cargada
// antes de que existieran los movimientos (o editada a mano, o transferida) tenía un historial
// incompleto, y el siguiente borrado de un movimiento la reconstruía con unidades de menos — y el
// P&L realizado se calculaba contra una base de costo equivocada. Exportada: useCobros (amortización)
// también la necesita. Lanza si no puede verificar el historial (mejor abortar que escribir a ciegas).
export async function asegurarHistorial(posicionId: string): Promise<void> {
  const { data: pos, error: posErr } = await supabase.from('posiciones')
    .select('id, portfolio_id, ticker, cantidad, precio_compra, fecha_compra').eq('id', posicionId).single();
  if (posErr) throw new Error(`No se pudo leer la posición: ${posErr.message}`);
  const { data: movs, error: movErr } = await supabase.from('movimientos')
    .select('tipo, cantidad, precio, fecha').eq('posicion_id', posicionId)
    .order('fecha', { ascending: true }).order('created_at', { ascending: true });
  if (movErr) throw new Error(`No se pudo verificar el historial de ${pos.ticker}: ${movErr.message}`);
  const hoy = new Date().toISOString().slice(0, 10);
  const conc = movimientoConciliacion(
    { cantidad: Number(pos.cantidad) || 0, costoPromedio: Number(pos.precio_compra) || 0 },
    (movs ?? []).map(m => ({ tipo: m.tipo, cantidad: Number(m.cantidad), precio: Number(m.precio), fecha: m.fecha })),
    pos.fecha_compra, hoy);
  if (!conc) return;
  const { error: insErr } = await supabase.from('movimientos').insert({
    portfolio_id: pos.portfolio_id, posicion_id: pos.id, ticker: pos.ticker,
    tipo: conc.tipo, cantidad: conc.cantidad, precio: conc.precio, fecha: conc.fecha,
    nota: conc.tipo === 'compra'
      ? 'saldo previo sin historial (conciliación automática)'
      : 'ajuste de conciliación: la posición tenía menos que su historial (conciliación automática)',
  });
  if (insErr) throw new Error(`No se pudo conciliar el historial de ${pos.ticker}: ${insErr.message}`);
}

// Borra un movimiento y reconstruye su posición desde el historial restante (motor puro, ver
// engine/tenencia). Si el movimiento había generado un movimiento de LIQUIDEZ (venta/amortización
// acreditada, compra pagada con liquidez — columna liquidez_mov_id, migración 0050), lo borra también:
// si no, deshacer una venta acreditada dejaba la posición restaurada Y el efectivo (capital doble).
// Exportada para que borrar un cobro (useCobros.remove) revierta su crédito por el mismo camino.
export async function borrarMovimiento(movId: string): Promise<void> {
  const { data: mov, error: selMovErr } = await supabase.from('movimientos').select('*').eq('id', movId).maybeSingle();
  if (selMovErr) throw selMovErr;
  if (!mov) return;   // ya no existe (p.ej. se borró antes por otro camino)
  // Conciliar ANTES de borrar: si el historial no cuadraba con la posición (saldo previo sin
  // movimiento, transferencia, edición manual), reconstruir desde "lo que queda" perdía unidades.
  if (mov.posicion_id) await asegurarHistorial(mov.posicion_id);
  const { error } = await supabase.from('movimientos').delete().eq('id', mov.id);
  if (error) throw error;
  // Deshacer una amortización por valor residual: el VR vuelve al previo (VR / factor). El costo
  // base vuelve solo, por la reconstrucción de abajo.
  if (mov.posicion_id && mov.tipo === 'amortizacion_vr' && Number(mov.precio) > 0 && Number(mov.precio) <= 1) {
    const { data: p } = await supabase.from('posiciones').select('valor_residual').eq('id', mov.posicion_id).single();
    const previo = Math.min(1, (Number(p?.valor_residual) || 1) / Number(mov.precio));
    const { error: vrErr } = await supabase.from('posiciones').update({ valor_residual: previo }).eq('id', mov.posicion_id);
    if (vrErr) throw new Error(`Movimiento borrado, pero no se pudo restaurar el valor residual: ${vrErr.message}`);
  }
  if (mov.posicion_id) {
    const { data: resto, error: selErr } = await supabase.from('movimientos')
      .select('*').eq('posicion_id', mov.posicion_id)
      .order('fecha', { ascending: true }).order('created_at', { ascending: true });
    if (selErr) throw selErr;
    const t = reconstruirTenencia((resto ?? []) as Movimiento[]);
    // Brokers: si la cantidad baja, el trigger posiciones_ajusta_brokers los escala (0050).
    const { error: updErr } = await supabase.from('posiciones')
      .update({ cantidad: t.cantidad, precio_compra: t.costoPromedio }).eq('id', mov.posicion_id);
    if (updErr) throw updErr;
  }
  if (mov.liquidez_mov_id) {
    try { await borrarMovimiento(mov.liquidez_mov_id); }
    catch (e) { throw new Error(`Movimiento borrado, pero no se pudo revertir su liquidez: ${e instanceof Error ? e.message : e}`); }
  }
}

export function usePosicionMutations(portfolioId: string | null | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['posiciones'] });
    qc.invalidateQueries({ queryKey: ['movimientos'] });
    qc.invalidateQueries({ queryKey: ['posicion_brokers'] });
  };
  return {
    // Alta con CONSOLIDACIÓN: si el activo ya existe en el portfolio, suma la cantidad y
    // recalcula el precio con costo promedio ponderado; si no, crea la posición. Siempre
    // registra el movimiento (compra) para dejar el historial completo.
    // `pagarConLiquidez`: el costo de la compra sale de la LIQUIDEZ del portfolio (si no, comprar con
    // plata que ya estaba en la cuenta duplicaba ese valor en el patrimonio sin ningún aporte nuevo).
    add: async (p: Partial<Posicion>, pagarConLiquidez = false) => {
      const ticker = (p.ticker ?? '').toUpperCase().trim();
      const addQty = Number(p.cantidad) || 0;
      const addPrice = Number(p.precio_compra) || 0;
      if (!p.tipo) throw new Error('Elegí el tipo de activo.'); // sin tipo, .eq('tipo','') nunca consolida
      // Sin esto, una cantidad negativa RESTABA de la posición sin registrar movimiento (el insert
      // del movimiento está bajo `addQty > 0`), dejando cantidad y costo promedio inconsistentes.
      if (!(addQty > 0)) throw new Error('La cantidad debe ser mayor a 0.');
      if (addPrice < 0) throw new Error('El precio no puede ser negativo.');
      if (pagarConLiquidez && p.tipo === 'cash') throw new Error('La liquidez no se paga con liquidez.');
      if (pagarConLiquidez) {
        // Chequeo previo (el débito real valida de nuevo, atómico): no dejar la compra registrada y
        // recién después descubrir que no alcanzaba.
        const { data: liq } = await supabase.from('posiciones').select('cantidad')
          .eq('portfolio_id', portfolioId).eq('tipo', 'cash').eq('ticker', 'LIQUIDEZ').limit(1).maybeSingle();
        const saldo = Number(liq?.cantidad) || 0;
        if (saldo + 0.005 < addQty * addPrice) throw new Error(`Liquidez insuficiente: hay USD ${saldo.toFixed(2)} y la compra cuesta USD ${(addQty * addPrice).toFixed(2)}.`);
      }

      const { data: existing, error: selErr } = await supabase.from('posiciones')
        .select('*').eq('portfolio_id', portfolioId).eq('ticker', ticker).eq('tipo', p.tipo)
        .limit(1).maybeSingle();
      if (selErr) throw selErr;

      let posId: string;
      if (existing) {
        // Antes de sumar: si la posición tenía historial incompleto (cargada antes de que existieran
        // los movimientos), registrar su saldo previo — si no, la compra nueva quedaba como el único
        // movimiento y un borrado posterior reconstruía la posición con solo esas unidades.
        await asegurarHistorial(existing.id);
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
        // Bono amortizable NUEVO: precargar sus cuotas futuras desde el catálogo (bonos_referencia,
        // mismo cronograma que ya usa el Radar). Sin esto, la proyección de Cupones (engine/coupons.ts,
        // que solo mira amortizaciones_programadas) calculaba el cupón sobre el 100% del nominal hasta el
        // vencimiento y devolvía todo el capital al final — caso real: DNC7D/RC1CD/YM34D de Herencia.
        // Best-effort: si falla, la posición igual quedó bien guardada (las cuotas se cargan a mano).
        if (p.tipo === 'bono' && p.amortizable) {
          const { data: ref } = await supabase.from('bonos_referencia').select('cronograma').eq('ticker', ticker).maybeSingle();
          const hoy = new Date().toISOString().slice(0, 10);
          const cuotas = ((ref?.cronograma ?? []) as { fecha: string; amortizacion: number }[])
            .filter(c => c.amortizacion > 0 && c.amortizacion <= 1 && c.fecha.slice(0, 10) > hoy)
            .map(c => ({ posicion_id: posId, fecha: c.fecha.slice(0, 10), porcentaje: c.amortizacion }));
          if (cuotas.length) {
            await supabase.from('amortizaciones_programadas').upsert(cuotas, { onConflict: 'posicion_id,fecha', ignoreDuplicates: true });
            qc.invalidateQueries({ queryKey: ['amortizaciones_programadas'] });
          }
        }
      }

      let compraMovId: string | null = null;
      if (addQty > 0) {
        // Chequear el error: si el movimiento no se registra, el P&L realizado quedaría mal y
        // el usuario no se enteraría. La posición ya se actualizó, así que lo hacemos visible.
        const { data: movIns, error: movErr } = await supabase.from('movimientos').insert({
          portfolio_id: portfolioId, posicion_id: posId, ticker,
          tipo: 'compra', cantidad: addQty, precio: addPrice,
          fecha: p.fecha_compra ?? new Date().toISOString().slice(0, 10),
          nota: p.notas ?? null,
        }).select('id').single();
        compraMovId = movIns?.id ?? null;
        if (movErr) { invalidate(); throw new Error(`Posición guardada, pero no se pudo registrar el movimiento: ${movErr.message}`); }
      }
      if (pagarConLiquidez && addQty * addPrice > 0) {
        const { data: liqMovId, error: liqErr } = await supabase.rpc('mover_liquidez', {
          p_portfolio: portfolioId, p_monto: -(addQty * addPrice),
          p_fecha: p.fecha_compra ?? new Date().toISOString().slice(0, 10), p_nota: `compra de ${addQty} ${ticker}`,
        });
        if (liqErr) { invalidate(); throw new Error(`Compra registrada, pero no se pudo debitar la liquidez: ${liqErr.message}`); }
        // Vínculo: borrar esta compra del historial devuelve la plata a la liquidez.
        if (compraMovId && liqMovId) await supabase.from('movimientos').update({ liquidez_mov_id: liqMovId }).eq('id', compraMovId);
      }
      invalidate();
    },
    // Venta: descuenta cantidad y registra el movimiento. El costo promedio (precio_compra) NO
    // cambia al vender. Si la cantidad llega a 0, la posición queda "cerrada" (cantidad 0) pero
    // no se borra, para conservar el historial y poder reabrirla con una compra futura.
    // `acreditar`: el producto (cantidad × precio) entra a la LIQUIDEZ del portfolio — sin eso, la
    // venta sacaba valor del patrimonio sin que entrara la plata y el rendimiento lo leía como pérdida.
    sell: async (pos: Posicion, sellQty: number, sellPrice: number, fecha?: string, acreditar = false) => {
      const qty = Math.min(Number(sellQty) || 0, Number(pos.cantidad) || 0);
      if (qty <= 0) throw new Error('Cantidad de venta inválida');
      // Historial cuadrado antes de vender: una posición con historial PARCIAL (saldo viejo + una
      // compra nueva registrada) calculaba el P&L realizado contra el costo de esa sola compra. Lanza
      // si no puede verificar: mejor abortar que registrar una base duplicada.
      await asegurarHistorial(pos.id);
      // Una sola transacción (migración 0050): movimiento + cantidad + liquidez. La asignación por
      // broker baja sola, proporcional (trigger posiciones_ajusta_brokers).
      const { error } = await supabase.rpc('vender_posicion', {
        p_posicion_id: pos.id, p_cantidad: qty, p_precio: Number(sellPrice) || 0,
        p_fecha: fecha ?? new Date().toISOString().slice(0, 10), p_acreditar: acreditar,
      });
      invalidate();
      if (error) throw new Error(`No se pudo registrar la venta: ${error.message}`);
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
      if (error) { invalidate(); throw error; }
      // Renombrar el ticker: el historial y los cobros se agrupan/filtran por ticker (MovimientosModal,
      // realizedPnl), así que quedaban huérfanos con el nombre viejo (caso real: BCO4D → COC4D).
      if (patch.ticker) {
        const ticker = patch.ticker.toUpperCase().trim();
        const [r1, r2] = await Promise.all([
          supabase.from('movimientos').update({ ticker }).eq('posicion_id', id),
          supabase.from('cobros').update({ ticker }).eq('posicion_id', id),
        ]);
        const e = r1.error ?? r2.error;
        if (e) { invalidate(); throw new Error(`Posición renombrada, pero no se pudo actualizar su historial: ${e.message}`); }
      }
      // Edición manual de cantidad/costo: sin movimiento, el próximo borrado de un movimiento la
      // pisaba reconstruyendo desde el historial viejo. Se concilia después de guardar.
      if (patch.cantidad != null || patch.precio_compra != null) {
        try { await asegurarHistorial(id); }
        catch (e) { invalidate(); throw new Error(`Posición guardada, pero no se pudo conciliar el historial: ${e instanceof Error ? e.message : e}`); }
      }
      invalidate();
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
      try { await borrarMovimiento(mov.id); }
      finally { invalidate(); qc.invalidateQueries({ queryKey: ['cobros'] }); }
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
export function useDataStatus(tickers: string[] = []) {
  const ts = [...new Set(tickers)].sort();
  return useQuery({
    queryKey: ['data-status', ts.join(',')],
    staleTime: 5 * 60_000,
    queryFn: () => api.status(ts),
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
