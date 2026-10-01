-- ===========================================================================
-- Correcciones de la auditoría QA (2026-10-01):
--
-- 1) transferir_posicion() ahora deja MOVIMIENTOS: un 'ajuste' negativo en el origen y una 'compra'
--    al costo preservado en el destino. Sin eso, el historial de movimientos de las dos posiciones no
--    reflejaba la transferencia, y borrar cualquier movimiento después (removeMovimiento reconstruye
--    la tenencia desde el historial) "deshacía" la transferencia en el origen — las unidades quedaban
--    duplicadas en los dos portfolios. Caso real: COC4D, Ahorros → Herencia (ver data fix abajo).
--
-- 2) El flujo en `aportes` (agregado en 0048) pasa a registrarse a VALOR DE MERCADO si el cliente lo
--    manda (p_valor_mercado), con fallback al costo. El patrimonio de cada portfolio se mueve a
--    mercado; a costo, una posición con ganancia no realizada dejaba en el origen una "pérdida" de
--    rendimiento igual a (mercado − costo) y la misma "ganancia" en el destino.
--    Cambia la firma → hay que DROPear la vieja: con las dos versiones, una llamada por nombre con 4
--    argumentos sería ambigua para PostgREST.
--
-- 3) ordenes_ejecutadas.portfolio_id sin ON DELETE (0047): bloqueaba borrar el portfolio/usuario
--    (todas las demás tablas hijas cascadean).
--
-- 4) is_approved(uuid) ejecutable por anon (vía PUBLIC): oráculo para preguntar si un uuid está
--    aprobado. Solo lo usan policies de `authenticated`. transferir_posicion idem (ya validaba
--    owns_portfolio, pero no tiene sentido exponerla a anon).
-- ===========================================================================

drop function if exists public.transferir_posicion(uuid, uuid, double precision, text);

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

  update public.posiciones set cantidad = cantidad - p_cantidad where id = p_posicion_id;

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

  insert into public.amortizaciones_programadas (posicion_id, fecha, porcentaje)
    select v_nueva_id, fecha, porcentaje from public.amortizaciones_programadas where posicion_id = p_posicion_id
    on conflict (posicion_id, fecha) do nothing;

  insert into public.transferencias (portfolio_origen_id, portfolio_destino_id, posicion_origen_id,
    posicion_destino_id, ticker, tipo, cantidad, precio_compra, fecha_compra, nota)
  values (v_pos.portfolio_id, p_portfolio_destino, p_posicion_id, v_nueva_id, v_pos.ticker, v_pos.tipo,
    p_cantidad, v_pos.precio_compra, v_pos.fecha_compra, p_nota)
  returning id into v_transferencia_id;

  -- Movimientos (1): no es una venta en el origen (no realiza P&L → 'ajuste', igual que una
  -- amortización) ni una compra a precio de hoy en el destino (preserva el costo y la fecha original).
  v_etiqueta := 'transferencia ' || p_cantidad || ' ' || v_pos.ticker || coalesce(' — ' || p_nota, '');
  insert into public.movimientos (portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota)
  values (v_pos.portfolio_id, p_posicion_id, v_pos.ticker, 'ajuste', -p_cantidad, 0, current_date,
    v_etiqueta || ' (salida a otro portfolio)');
  insert into public.movimientos (portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota)
  values (p_portfolio_destino, v_nueva_id, v_pos.ticker, 'compra', p_cantidad, v_pos.precio_compra,
    coalesce(v_pos.fecha_compra, current_date), v_etiqueta || ' (entrada desde otro portfolio, al costo original)');

  -- Flujo de caja externo para el rendimiento por año (2): a mercado si vino, si no a costo.
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

revoke execute on function public.transferir_posicion(uuid, uuid, double precision, text, double precision) from public, anon;
grant execute on function public.transferir_posicion(uuid, uuid, double precision, text, double precision) to authenticated, service_role;

-- (3) ordenes_ejecutadas: cascade como el resto de las tablas hijas de portfolios.
alter table public.ordenes_ejecutadas drop constraint if exists ordenes_ejecutadas_portfolio_id_fkey;
alter table public.ordenes_ejecutadas
  add constraint ordenes_ejecutadas_portfolio_id_fkey foreign key (portfolio_id) references public.portfolios(id) on delete cascade;

-- (4) is_approved solo para quien lo necesita.
revoke execute on function public.is_approved(uuid) from public, anon;
grant execute on function public.is_approved(uuid) to authenticated, service_role;
