-- ===========================================================================
-- Auditoría QA — fase 2 (2026-10-01). Cierra los pendientes de 0049:
--
-- 1) posicion_brokers se ajusta SOLO cuando baja la cantidad de una posición (trigger). Antes cada
--    camino (vender, amortizar, borrar un movimiento, editar a mano, transferir) tenía que acordarse
--    de repartir la baja entre brokers; removeMovimiento y la edición manual no lo hacían y la suma
--    por broker quedaba por encima de la posición. Regla única: si la suma asignada supera la nueva
--    cantidad, se escala proporcionalmente (cantidad 0 → se borran las filas, CHECK > 0). Una suba
--    (compra) no toca nada: la diferencia queda "sin asignar" hasta que se elija el broker.
--    transferir_posicion se reescribe moviendo los brokers ANTES de bajar la cantidad del origen
--    (si no, el trigger escalaba primero y la transferencia movía de menos).
--
-- 2) portfolio_snapshots.aportado se recalcula cuando cambia `aportes` (trigger). El snapshot solo se
--    graba para HOY desde el Dashboard: un aporte cargado con fecha atrasada dejaba el histórico con
--    el aportado viejo (caso real: Herencia 28-30/09).
--
-- 3) Movimientos de efectivo: mover_liquidez() acredita/debita la posición 'cash' LIQUIDEZ del
--    portfolio (la crea si hace falta) dejando el movimiento compra/venta a precio 1. Lo usan vender,
--    amortizar, cobrar y comprar "con liquidez": sin esto, una venta o un cobro sacaban valor del
--    patrimonio sin que entrara la plata, y el rendimiento por año lo contaba como pérdida.
--
-- 4) Operaciones atómicas (una función = una transacción): vender_posicion, registrar_amortizacion
--    (convención "baja el nominal"), registrar_amortizacion_vr (convención "baja el valor residual")
--    y registrar_cobro. Antes eran 3-5 escrituras sueltas desde el browser: si fallaba una a la mitad
--    quedaba, p.ej., la venta registrada sin descontar la cantidad.
--
-- 5) Amortización por valor residual: el capital devuelto ahora BAJA EL COSTO BASE en la misma
--    proporción (movimiento 'amortizacion_vr', cantidad 0, precio = factor nuevoVR/viejoVR). Antes el
--    costo quedaba igual mientras el precio (por nominal original) caía → el capital ya cobrado se
--    veía como pérdida no realizada, y una venta posterior realizaba esa pérdida falsa. El motor
--    (engine/tenencia.ts, engine/pnl.ts) aplica el factor al costo promedio en orden cronológico.
--
-- 6) Tablas de la app vieja del Mundial: tenían policies abiertas (anon podía leer/escribir). No las
--    usa ningún código de este repo. Se cierran (sin policies + revoke a anon/authenticated) en vez
--    de borrarlas: mismo efecto de seguridad, reversible, y los datos quedan por si se quieren.
-- ===========================================================================

-- (5) tipo de movimiento nuevo + check (antes `tipo` era text libre).
alter table public.movimientos drop constraint if exists movimientos_tipo_check;
alter table public.movimientos add constraint movimientos_tipo_check
  check (tipo in ('compra', 'venta', 'ajuste', 'amortizacion_vr'));

-- (3) Vínculo con el movimiento de liquidez que generó una operación (venta, amortización, cobro,
-- compra pagada con liquidez): borrar la operación revierte también el efectivo. Sin esto, deshacer
-- una venta acreditada dejaba la posición restaurada Y el efectivo — el capital contado dos veces.
alter table public.movimientos add column if not exists liquidez_mov_id uuid references public.movimientos(id) on delete set null;
alter table public.cobros add column if not exists liquidez_mov_id uuid references public.movimientos(id) on delete set null;

-- (1) brokers ---------------------------------------------------------------------------------
create or replace function public.posicion_brokers_ajustar() returns trigger
language plpgsql set search_path to 'public' as $$
declare v_sum double precision;
begin
  if new.cantidad >= old.cantidad then return new; end if;
  select coalesce(sum(cantidad), 0) into v_sum from public.posicion_brokers where posicion_id = new.id;
  if v_sum <= new.cantidad * (1 + 1e-9) + 1e-9 then return new; end if;
  if new.cantidad <= 1e-9 then
    delete from public.posicion_brokers where posicion_id = new.id;
  else
    update public.posicion_brokers set cantidad = cantidad * (new.cantidad / v_sum) where posicion_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists posiciones_ajusta_brokers on public.posiciones;
create trigger posiciones_ajusta_brokers after update of cantidad on public.posiciones
  for each row execute function public.posicion_brokers_ajustar();

-- (2) snapshots ---------------------------------------------------------------------------------
create or replace function public.snapshots_recalcular_aportado(p_portfolio uuid, p_desde date) returns void
language sql set search_path to 'public' as $$
  update public.portfolio_snapshots s
     set aportado = coalesce((select sum(case when a.tipo = 'retiro' then -a.monto else a.monto end)
                                from public.aportes a
                               where a.portfolio_id = p_portfolio and a.fecha <= s.fecha), 0)
   where s.portfolio_id = p_portfolio and s.fecha >= p_desde
     -- sin ningún aporte el Dashboard usa el costo como aportado (useRendimientoAnual): no pisarlo con 0
     and exists (select 1 from public.aportes a where a.portfolio_id = p_portfolio);
$$;

create or replace function public.aportes_sync_snapshots() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.snapshots_recalcular_aportado(old.portfolio_id, old.fecha); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform public.snapshots_recalcular_aportado(new.portfolio_id, new.fecha); end if;
  return null;
end $$;

drop trigger if exists aportes_sync_snapshots on public.aportes;
create trigger aportes_sync_snapshots after insert or update or delete on public.aportes
  for each row execute function public.aportes_sync_snapshots();

-- (3) liquidez ----------------------------------------------------------------------------------
-- p_monto > 0 acredita, < 0 debita. Devuelve el id del MOVIMIENTO de liquidez (para vincularlo).
create or replace function public.mover_liquidez(p_portfolio uuid, p_monto double precision, p_fecha date, p_nota text default null)
returns uuid language plpgsql set search_path to 'public' as $$
declare
  v_pos public.posiciones%rowtype;
  v_n int;
  v_mov uuid;
begin
  if not public.owns_portfolio(p_portfolio) then raise exception 'No tenés ese portfolio'; end if;
  if p_monto is null or p_monto = 0 then raise exception 'El monto de liquidez no puede ser 0'; end if;
  select * into v_pos from public.posiciones
   where portfolio_id = p_portfolio and tipo = 'cash' and ticker = 'LIQUIDEZ' order by created_at limit 1 for update;
  if not found then
    if p_monto < 0 then raise exception 'El portfolio no tiene Liquidez para debitar'; end if;
    insert into public.posiciones (portfolio_id, tipo, ticker, empresa, cantidad, precio_compra, fecha_compra)
    values (p_portfolio, 'cash', 'LIQUIDEZ', 'Efectivo en USD', 0, 1, coalesce(p_fecha, current_date))
    returning * into v_pos;
  end if;
  if p_monto < 0 and v_pos.cantidad + p_monto < -0.005 then
    raise exception 'Liquidez insuficiente: hay USD % y se necesitan USD %',
      round(v_pos.cantidad::numeric, 2), round((-p_monto)::numeric, 2);
  end if;
  update public.posiciones
     set cantidad = greatest(0, cantidad + p_monto),
         -- crédito a precio 1 entra al promedio (efectivo: precio_compra = 1 por convención)
         precio_compra = case when p_monto > 0 then (cantidad * precio_compra + p_monto) / (cantidad + p_monto) else precio_compra end
   where id = v_pos.id;
  insert into public.movimientos (portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota)
  values (p_portfolio, v_pos.id, v_pos.ticker, case when p_monto > 0 then 'compra' else 'venta' end,
          abs(p_monto), 1, coalesce(p_fecha, current_date), p_nota)
  returning id into v_mov;
  -- Liquidez en un solo broker: el crédito va a ese broker (el débito lo escala el trigger).
  select count(*) into v_n from public.posicion_brokers where posicion_id = v_pos.id;
  if v_n = 1 and p_monto > 0 then
    update public.posicion_brokers set cantidad = cantidad + p_monto where posicion_id = v_pos.id;
  end if;
  return v_mov;
end $$;

-- (4) venta ---------------------------------------------------------------------------------------
create or replace function public.vender_posicion(p_posicion_id uuid, p_cantidad double precision, p_precio double precision,
  p_fecha date default null, p_acreditar boolean default false) returns void
language plpgsql set search_path to 'public' as $$
declare v_pos public.posiciones%rowtype; v_qty double precision; v_fecha date := coalesce(p_fecha, current_date); v_mov uuid;
begin
  select * into v_pos from public.posiciones where id = p_posicion_id for update;
  if not found or not public.owns_portfolio(v_pos.portfolio_id) then raise exception 'Posición no encontrada'; end if;
  if v_pos.tipo = 'cash' then raise exception 'La liquidez no se vende: editá su saldo o registrá un retiro'; end if;
  v_qty := least(coalesce(p_cantidad, 0), v_pos.cantidad);
  if not (v_qty > 0) then raise exception 'Cantidad de venta inválida'; end if;
  if p_precio is null or p_precio < 0 then raise exception 'Precio de venta inválido'; end if;
  insert into public.movimientos (portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha)
  values (v_pos.portfolio_id, v_pos.id, v_pos.ticker, 'venta', v_qty, p_precio, v_fecha)
  returning id into v_mov;
  update public.posiciones set cantidad = cantidad - v_qty where id = v_pos.id;
  if p_acreditar and v_qty * p_precio > 0 then
    update public.movimientos
       set liquidez_mov_id = public.mover_liquidez(v_pos.portfolio_id, v_qty * p_precio, v_fecha, 'venta de ' || v_qty || ' ' || v_pos.ticker)
     where id = v_mov;
  end if;
end $$;

-- (4) amortización, convención "baja el nominal" --------------------------------------------------
create or replace function public.registrar_amortizacion(p_posicion_id uuid, p_fecha date, p_monto double precision,
  p_nominales double precision, p_nota text default null, p_acreditar boolean default false) returns uuid
language plpgsql set search_path to 'public' as $$
declare v_pos public.posiciones%rowtype; v_nom double precision; v_mov uuid; v_cobro uuid; v_liq uuid;
begin
  p_fecha := coalesce(p_fecha, current_date);
  select * into v_pos from public.posiciones where id = p_posicion_id for update;
  if not found or not public.owns_portfolio(v_pos.portfolio_id) then raise exception 'Posición no encontrada'; end if;
  if not (p_monto > 0) then raise exception 'El monto debe ser mayor a 0.'; end if;
  if not (p_nominales > 0) then raise exception 'Los nominales amortizados deben ser mayores a 0.'; end if;
  v_nom := least(p_nominales, v_pos.cantidad);
  if not (v_nom > 0) then raise exception 'La posición no tiene nominales para amortizar'; end if;
  insert into public.movimientos (portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota)
  values (v_pos.portfolio_id, v_pos.id, v_pos.ticker, 'ajuste', -v_nom, 0, p_fecha, 'amortización de capital')
  returning id into v_mov;
  update public.posiciones set cantidad = greatest(0, cantidad - v_nom) where id = v_pos.id;
  insert into public.cobros (portfolio_id, posicion_id, ticker, tipo, fecha, monto, movimiento_id, nota, origen)
  values (v_pos.portfolio_id, v_pos.id, v_pos.ticker, 'amortizacion', p_fecha, p_monto, v_mov, p_nota, 'manual')
  returning id into v_cobro;
  if p_acreditar then
    v_liq := public.mover_liquidez(v_pos.portfolio_id, p_monto, p_fecha, 'amortización ' || v_pos.ticker);
    update public.cobros set liquidez_mov_id = v_liq where id = v_cobro;
    if v_mov is not null then update public.movimientos set liquidez_mov_id = v_liq where id = v_mov; end if;
  end if;
  return v_cobro;
end $$;

-- (4)+(5) amortización, convención "baja el valor residual" ---------------------------------------
-- p_valor_residual: fracción (0,1] NUEVA y absoluta del nominal original que queda por cobrar.
create or replace function public.registrar_amortizacion_vr(p_posicion_id uuid, p_fecha date, p_monto double precision,
  p_valor_residual double precision, p_nota text default null, p_acreditar boolean default false) returns uuid
language plpgsql set search_path to 'public' as $$
declare v_pos public.posiciones%rowtype; v_viejo double precision; v_factor double precision; v_mov uuid; v_cobro uuid; v_liq uuid;
begin
  p_fecha := coalesce(p_fecha, current_date);
  select * into v_pos from public.posiciones where id = p_posicion_id for update;
  if not found or not public.owns_portfolio(v_pos.portfolio_id) then raise exception 'Posición no encontrada'; end if;
  if not (p_monto > 0) then raise exception 'El monto debe ser mayor a 0.'; end if;
  if not (p_valor_residual > 0 and p_valor_residual <= 1) then raise exception 'El valor residual debe ser mayor a 0%% y hasta 100%%.'; end if;
  v_viejo := coalesce(v_pos.valor_residual, 1);
  if p_valor_residual > v_viejo + 1e-9 then
    raise exception 'El valor residual no puede subir (hoy % %%). Para corregir una carga, borrá su movimiento en el historial.', round((v_viejo * 100)::numeric, 2);
  end if;
  v_factor := p_valor_residual / v_viejo;
  if v_pos.cantidad > 0 and v_factor < 1 then
    insert into public.movimientos (portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota)
    values (v_pos.portfolio_id, v_pos.id, v_pos.ticker, 'amortizacion_vr', 0, v_factor, p_fecha,
            'amortización (valor residual ' || round((v_viejo * 100)::numeric, 2) || '% → ' || round((p_valor_residual * 100)::numeric, 2) || '%): el costo base baja en la misma proporción')
    returning id into v_mov;
    update public.posiciones set precio_compra = precio_compra * v_factor where id = v_pos.id;
  end if;
  update public.posiciones set amortizable = true, valor_residual = p_valor_residual where id = v_pos.id;
  insert into public.cobros (portfolio_id, posicion_id, ticker, tipo, fecha, monto, movimiento_id, nota, origen)
  values (v_pos.portfolio_id, v_pos.id, v_pos.ticker, 'amortizacion', p_fecha, p_monto, v_mov, p_nota, 'manual')
  returning id into v_cobro;
  if p_acreditar then
    v_liq := public.mover_liquidez(v_pos.portfolio_id, p_monto, p_fecha, 'amortización ' || v_pos.ticker);
    update public.cobros set liquidez_mov_id = v_liq where id = v_cobro;
    if v_mov is not null then update public.movimientos set liquidez_mov_id = v_liq where id = v_mov; end if;
  end if;
  return v_cobro;
end $$;

-- (4) dividendo / interés -------------------------------------------------------------------------
create or replace function public.registrar_cobro(p_portfolio uuid, p_posicion_id uuid, p_ticker text, p_tipo text,
  p_fecha date, p_monto double precision, p_nota text default null, p_acreditar boolean default false) returns uuid
language plpgsql set search_path to 'public' as $$
declare v_cobro uuid;
begin
  p_fecha := coalesce(p_fecha, current_date);
  if not public.owns_portfolio(p_portfolio) then raise exception 'No tenés ese portfolio'; end if;
  if p_tipo not in ('dividendo', 'interes') then raise exception 'Tipo de cobro inválido'; end if;
  if not (p_monto > 0) then raise exception 'El monto debe ser mayor a 0.'; end if;
  insert into public.cobros (portfolio_id, posicion_id, ticker, tipo, fecha, monto, nota, origen)
  values (p_portfolio, p_posicion_id, upper(trim(p_ticker)), p_tipo, p_fecha, p_monto, p_nota, 'manual')
  returning id into v_cobro;
  if p_acreditar then
    update public.cobros
       set liquidez_mov_id = public.mover_liquidez(p_portfolio, p_monto, p_fecha, p_tipo || ' ' || upper(trim(p_ticker)))
     where id = v_cobro;
  end if;
  return v_cobro;
end $$;

-- (1) transferir_posicion: brokers antes de bajar la cantidad (ver arriba). Resto idéntico a 0049.
create or replace function public.transferir_posicion(
  p_posicion_id uuid, p_portfolio_destino uuid, p_cantidad double precision, p_nota text default null,
  p_valor_mercado double precision default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pos public.posiciones%rowtype;
  v_destino_existente uuid;
  v_nueva_id uuid;
  v_transferencia_id uuid;
  v_ratio double precision;
  v_pb record;
  v_mover double precision;
  v_valor double precision;
  v_etiqueta text;
begin
  select * into v_pos from public.posiciones where id = p_posicion_id for update;
  if not found then raise exception 'Posición no encontrada'; end if;
  if not public.owns_portfolio(v_pos.portfolio_id) then raise exception 'No tenés esa posición'; end if;
  if not public.owns_portfolio(p_portfolio_destino) then raise exception 'El portfolio destino no es tuyo'; end if;
  if v_pos.portfolio_id = p_portfolio_destino then raise exception 'El origen y el destino no pueden ser el mismo portfolio'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad tiene que ser mayor a 0'; end if;
  if p_cantidad > v_pos.cantidad then raise exception 'No podés transferir más de lo que tenés (%)', v_pos.cantidad; end if;
  if p_valor_mercado is not null and not (p_valor_mercado > 0) then raise exception 'El valor de mercado tiene que ser mayor a 0'; end if;

  select id into v_destino_existente from public.posiciones
    where portfolio_id = p_portfolio_destino and ticker = v_pos.ticker and tipo = v_pos.tipo and cantidad > 0
    limit 1;
  if v_destino_existente is not null then
    raise exception 'El portfolio destino ya tiene una posición abierta de % — transferí manualmente para no mezclar el costo', v_pos.ticker;
  end if;

  v_ratio := p_cantidad / v_pos.cantidad;

  insert into public.posiciones (portfolio_id, tipo, ticker, empresa, sector, rol, cantidad, precio_compra,
    fecha_compra, peso_objetivo, ratio_cedear, tir_esperada, beta, notas,
    cupon_tasa, cupon_frecuencia, cupon_mes, vencimiento, calificadora, calificacion, amortizable, valor_residual, ley)
  values (p_portfolio_destino, v_pos.tipo, v_pos.ticker, v_pos.empresa, v_pos.sector, v_pos.rol, p_cantidad,
    v_pos.precio_compra, v_pos.fecha_compra, null, v_pos.ratio_cedear, v_pos.tir_esperada, v_pos.beta, v_pos.notas,
    v_pos.cupon_tasa, v_pos.cupon_frecuencia, v_pos.cupon_mes, v_pos.vencimiento,
    v_pos.calificadora, v_pos.calificacion, v_pos.amortizable, v_pos.valor_residual, v_pos.ley)
  returning id into v_nueva_id;

  for v_pb in select * from public.posicion_brokers where posicion_id = p_posicion_id loop
    v_mover := v_pb.cantidad * v_ratio;
    if v_mover > 0 then
      if v_pb.cantidad - v_mover > 1e-9 then
        update public.posicion_brokers set cantidad = cantidad - v_mover where id = v_pb.id;
      else
        delete from public.posicion_brokers where id = v_pb.id;
      end if;
      insert into public.posicion_brokers (posicion_id, broker_id, cantidad)
        values (v_nueva_id, v_pb.broker_id, v_mover)
        on conflict (posicion_id, broker_id) do update set cantidad = public.posicion_brokers.cantidad + excluded.cantidad;
    end if;
  end loop;

  update public.posiciones set cantidad = cantidad - p_cantidad where id = p_posicion_id;

  insert into public.amortizaciones_programadas (posicion_id, fecha, porcentaje)
    select v_nueva_id, fecha, porcentaje from public.amortizaciones_programadas where posicion_id = p_posicion_id
    on conflict (posicion_id, fecha) do nothing;

  insert into public.transferencias (portfolio_origen_id, portfolio_destino_id, posicion_origen_id,
    posicion_destino_id, ticker, tipo, cantidad, precio_compra, fecha_compra, nota)
  values (v_pos.portfolio_id, p_portfolio_destino, p_posicion_id, v_nueva_id, v_pos.ticker, v_pos.tipo,
    p_cantidad, v_pos.precio_compra, v_pos.fecha_compra, p_nota)
  returning id into v_transferencia_id;

  v_etiqueta := 'transferencia ' || p_cantidad || ' ' || v_pos.ticker || coalesce(' — ' || p_nota, '');
  insert into public.movimientos (portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota)
  values (v_pos.portfolio_id, p_posicion_id, v_pos.ticker, 'ajuste', -p_cantidad, 0, current_date,
    v_etiqueta || ' (salida a otro portfolio)');
  insert into public.movimientos (portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota)
  values (p_portfolio_destino, v_nueva_id, v_pos.ticker, 'compra', p_cantidad, v_pos.precio_compra,
    coalesce(v_pos.fecha_compra, current_date), v_etiqueta || ' (entrada desde otro portfolio, al costo original)');

  v_valor := coalesce(p_valor_mercado, p_cantidad * v_pos.precio_compra);
  insert into public.aportes (portfolio_id, fecha, monto, tipo, descripcion)
  values (v_pos.portfolio_id, current_date, v_valor, 'retiro',
    'Transferencia de ' || p_cantidad || ' ' || v_pos.ticker || ' a otro portfolio' ||
    coalesce(' — ' || p_nota, '') || ' (no es un retiro de efectivo real, es solo para que el rendimiento por año no la cuente como pérdida de mercado)');
  insert into public.aportes (portfolio_id, fecha, monto, tipo, descripcion)
  values (p_portfolio_destino, current_date, v_valor, 'inicial',
    'Transferencia de ' || p_cantidad || ' ' || v_pos.ticker || ' desde otro portfolio' ||
    coalesce(' — ' || p_nota, '') || ' (no es capital externo real, es solo para que el rendimiento por año no la cuente como ganancia de mercado)');

  return v_transferencia_id;
end;
$$;

-- Permisos: las funciones nuevas son SECURITY INVOKER (RLS aplica igual) — solo para logueados.
revoke execute on function public.mover_liquidez(uuid, double precision, date, text) from public, anon;
revoke execute on function public.vender_posicion(uuid, double precision, double precision, date, boolean) from public, anon;
revoke execute on function public.registrar_amortizacion(uuid, date, double precision, double precision, text, boolean) from public, anon;
revoke execute on function public.registrar_amortizacion_vr(uuid, date, double precision, double precision, text, boolean) from public, anon;
revoke execute on function public.registrar_cobro(uuid, uuid, text, text, date, double precision, text, boolean) from public, anon;
-- authenticated SÍ necesita EXECUTE: el trigger de aportes (SECURITY INVOKER) la llama como el usuario.
revoke execute on function public.snapshots_recalcular_aportado(uuid, date) from public, anon;
grant execute on function public.snapshots_recalcular_aportado(uuid, date) to authenticated, service_role;
grant execute on function public.mover_liquidez(uuid, double precision, date, text) to authenticated, service_role;
grant execute on function public.vender_posicion(uuid, double precision, double precision, date, boolean) to authenticated, service_role;
grant execute on function public.registrar_amortizacion(uuid, date, double precision, double precision, text, boolean) to authenticated, service_role;
grant execute on function public.registrar_amortizacion_vr(uuid, date, double precision, double precision, text, boolean) to authenticated, service_role;
grant execute on function public.registrar_cobro(uuid, uuid, text, text, date, double precision, text, boolean) to authenticated, service_role;
revoke execute on function public.transferir_posicion(uuid, uuid, double precision, text, double precision) from public, anon;
grant execute on function public.transferir_posicion(uuid, uuid, double precision, text, double precision) to authenticated, service_role;

-- (6) tablas del Mundial: cerradas -----------------------------------------------------------------
do $$
declare t text; p record;
begin
  foreach t in array array['fixture_contexts','prediction_snapshots','prediction_evaluations','wc_actual_results',
    'wc_fixtures','app_events','match_goals','scf_heuristics','scf_match_examples','scf_match_predictions','ai_match_predictions']
  loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- (7) bonos_referencia es solo hard-dollar: una especie que PAGA en pesos (CER, dollar linked,
-- TAMAR/BADLAR, LECAP/BONCAP, duales) entra por su ticker "D" porque el filtro de moneda de la
-- rutina mensual mira la moneda de liquidación (caso real: TXS8D, BONTE CER, borrado en esta
-- auditoría). Se descarta en silencio (return null) para no romper el upsert en lote de la rutina.
-- Mismo patrón que engine/rentaFija.ts#pagaEnPesos.
create or replace function public.bonos_referencia_solo_usd() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.nombre ~* '\m(cer|aj|ajust\w*|tamar|badlar|lecap|boncap|duale?s?|capitalizable)\M'
     or new.nombre ~* 'd[oó]lar ?linked' then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists bonos_referencia_solo_usd on public.bonos_referencia;
create trigger bonos_referencia_solo_usd before insert or update on public.bonos_referencia
  for each row execute function public.bonos_referencia_solo_usd();
