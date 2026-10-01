-- ===========================================================================
-- transferir_posicion() movía la posición (y posicion_brokers/amortizaciones_programadas) entre
-- portfolios, pero NUNCA tocaba `aportes` — un hueco real: el rendimiento por año (engine/rendimiento.ts,
-- vía hooks/useRendimientoAnual.ts#aportadoNeto) usa `aportes` como flujo de caja externo (Modified
-- Dietz). Sin un flujo que marque la transferencia, el valor transferido queda invisible para el
-- cálculo — en el portfolio ORIGEN se ve como una CAÍDA de rendimiento (perdió valor "de la nada"), y
-- en el DESTINO como una SUBA de rendimiento (ganó valor "de la nada"), cuando en realidad no hubo
-- ninguna ganancia/pérdida de mercado, solo una reasignación entre portfolios del mismo usuario.
--
-- Encontrado en revisión de Consejo tras la transferencia real de COC4D (Ahorros → Herencia,
-- 2026-09-28) — ver migración siguiente para la corrección de datos de ESE caso puntual; esta
-- migración corrige la función para que no vuelva a pasar en transferencias futuras.
--
-- Se registra el valor a COSTO (cantidad × precio_compra, misma convención que costUSD() en
-- lib/valuation.ts) como 'retiro' en el origen y 'inicial' en el destino — no hay un AporteTipo
-- específico de "transferencia" (ver types/domain.ts#AporteTipo), y el cálculo de rendimiento solo
-- distingue retiro vs. no-retiro (ver engine/aportes.ts#resumenAportes), así que alcanza con estos
-- dos tipos existentes + una descripción clara para que no se confunda con capital externo real.
-- ===========================================================================

create or replace function public.transferir_posicion(
  p_posicion_id uuid, p_portfolio_destino uuid, p_cantidad double precision, p_nota text default null
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
begin
  select * into v_pos from public.posiciones where id = p_posicion_id for update;
  if not found then raise exception 'Posición no encontrada'; end if;
  if not public.owns_portfolio(v_pos.portfolio_id) then raise exception 'No tenés esa posición'; end if;
  if not public.owns_portfolio(p_portfolio_destino) then raise exception 'El portfolio destino no es tuyo'; end if;
  if v_pos.portfolio_id = p_portfolio_destino then raise exception 'El origen y el destino no pueden ser el mismo portfolio'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad tiene que ser mayor a 0'; end if;
  if p_cantidad > v_pos.cantidad then raise exception 'No podés transferir más de lo que tenés (%)', v_pos.cantidad; end if;

  select id into v_destino_existente from public.posiciones
    where portfolio_id = p_portfolio_destino and ticker = v_pos.ticker and tipo = v_pos.tipo and cantidad > 0
    limit 1;
  if v_destino_existente is not null then
    raise exception 'El portfolio destino ya tiene una posición abierta de % — transferí manualmente para no mezclar el costo', v_pos.ticker;
  end if;

  -- Ratio de la cantidad ORIGINAL (antes de decrementar) — gobierna cuánto de cada asignación por
  -- broker se mueve al destino, igual proporción que la cantidad transferida.
  v_ratio := p_cantidad / v_pos.cantidad;

  update public.posiciones set cantidad = cantidad - p_cantidad where id = p_posicion_id;

  insert into public.posiciones (portfolio_id, tipo, ticker, empresa, sector, rol, cantidad, precio_compra,
    fecha_compra, peso_objetivo, ratio_cedear, tir_esperada, beta, notas,
    cupon_tasa, cupon_frecuencia, cupon_mes, vencimiento, calificadora, calificacion, amortizable, valor_residual)
  values (p_portfolio_destino, v_pos.tipo, v_pos.ticker, v_pos.empresa, v_pos.sector, v_pos.rol, p_cantidad,
    v_pos.precio_compra, v_pos.fecha_compra, null, v_pos.ratio_cedear, v_pos.tir_esperada, v_pos.beta, v_pos.notas,
    v_pos.cupon_tasa, v_pos.cupon_frecuencia, v_pos.cupon_mes, v_pos.vencimiento,
    v_pos.calificadora, v_pos.calificacion, v_pos.amortizable, v_pos.valor_residual)
  returning id into v_nueva_id;

  -- Reparte cada asignación por broker en la misma proporción que la cantidad transferida.
  -- posicion_brokers.cantidad tiene CHECK (cantidad > 0) — con v_ratio = 1 (transferís el 100%),
  -- restar v_mover deja al origen en exactamente 0, que violaría ese check si se hiciera UPDATE;
  -- en ese caso se borra la fila del origen en vez de dejarla en 0 (una asignación de 0 no es una
  -- asignación real, mismo criterio que "cerrar" una posición borra en vez de dejarla en 0 en otras
  -- partes de la app).
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

  -- El cronograma de amortización es una propiedad del bono (% del nominal por fecha), no de la
  -- cantidad que tenés — se copia completo al destino, no se mueve/reparte.
  insert into public.amortizaciones_programadas (posicion_id, fecha, porcentaje)
    select v_nueva_id, fecha, porcentaje from public.amortizaciones_programadas where posicion_id = p_posicion_id
    on conflict (posicion_id, fecha) do nothing;

  insert into public.transferencias (portfolio_origen_id, portfolio_destino_id, posicion_origen_id,
    posicion_destino_id, ticker, tipo, cantidad, precio_compra, fecha_compra, nota)
  values (v_pos.portfolio_id, p_portfolio_destino, p_posicion_id, v_nueva_id, v_pos.ticker, v_pos.tipo,
    p_cantidad, v_pos.precio_compra, v_pos.fecha_compra, p_nota)
  returning id into v_transferencia_id;

  -- Flujo de caja externo para el rendimiento por año (ver comentario de arriba): a COSTO, fechado
  -- HOY (cuándo pasó la transferencia, no cuándo se compró originalmente la posición).
  v_valor := p_cantidad * v_pos.precio_compra;
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
