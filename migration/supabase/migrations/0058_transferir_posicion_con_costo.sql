-- 0058 — Transferir una posición Y trasladar el costo de sus órdenes en UNA transacción (todo o nada).
-- `p_plan` lo calcula el motor (src/engine/trasladoCosto.ts) con las comisiones de las órdenes de compra de la posición; esta función solo lo
-- aplica: transferir_posicion (0050) + registro de costo en el destino (origen 'transferida') + comisiones del origen reducidas + retiro en el
-- origen y aporte en el destino por el mismo monto. SECURITY INVOKER: las escrituras pasan por RLS como el usuario, y transferir_posicion ya
-- valida que ambos portfolios sean suyos.
-- p_plan = { "total_usd": n, "ars_sin_mep": n, "fraccion": 0..1, "origen_nombre": "...", "destino_nombre": "...", "ordenes": [{ "id": uuid, "comision_usd": n|null, "comision_ars": n|null }] }
create or replace function public.transferir_posicion_con_costo(
  p_posicion_id uuid, p_portfolio_destino uuid, p_cantidad double precision, p_nota text default null,
  p_valor_mercado double precision default null, p_plan jsonb default null
) returns uuid
language plpgsql
set search_path to 'public'
as $fn$
declare
  v_origen uuid; v_ticker text; v_id uuid; v_total double precision; v_ars double precision; v_frac double precision; v_pct text; o jsonb;
begin
  select portfolio_id, ticker into v_origen, v_ticker from public.posiciones where id = p_posicion_id;
  if v_origen is null then raise exception 'Posición no encontrada'; end if;
  if not public.owns_portfolio(v_origen) or not public.owns_portfolio(p_portfolio_destino) then raise exception 'No tenés ese portfolio'; end if;

  v_id := public.transferir_posicion(p_posicion_id, p_portfolio_destino, p_cantidad, p_nota, p_valor_mercado);

  if p_plan is not null then
    v_total := coalesce((p_plan->>'total_usd')::double precision, 0);
    v_ars := coalesce((p_plan->>'ars_sin_mep')::double precision, 0);
    v_frac := coalesce((p_plan->>'fraccion')::double precision, 0);
    v_pct := round(v_frac * 100)::text || ' % de la posición';
    if v_total < 0 or v_ars < 0 then raise exception 'El costo a trasladar no puede ser negativo'; end if;
    if v_total > 0 or v_ars > 0 then
      insert into public.ordenes_ejecutadas (portfolio_id, fecha, ticker, broker, nominales, precio_ejecutado, monto_usd, comision_usd, comision_ars, mep, estado, origen, lado, nota)
      values (p_portfolio_destino, current_date, v_ticker, 'Traslado', p_cantidad, null, 0, nullif(v_total, 0), nullif(v_ars, 0), null, 'terminada', 'transferida', 'compra',
        'Costo de las órdenes trasladado desde ' || coalesce(p_plan->>'origen_nombre', 'otro portfolio') || ' (' || v_pct || '). Solo registra la comisión: la compra original queda en el origen.');
      for o in select * from jsonb_array_elements(coalesce(p_plan->'ordenes', '[]'::jsonb)) loop
        update public.ordenes_ejecutadas
           set comision_usd = (o->>'comision_usd')::numeric, comision_ars = (o->>'comision_ars')::numeric
         where id = (o->>'id')::uuid and portfolio_id = v_origen;
      end loop;
      if v_total > 0 then
        insert into public.aportes (portfolio_id, fecha, monto, tipo, descripcion) values
          (v_origen, current_date, v_total, 'retiro', 'Costo de las órdenes de ' || v_ticker || ' trasladado a ' || coalesce(p_plan->>'destino_nombre', 'otro portfolio') || ' (' || v_pct || '); no es un retiro de efectivo real.'),
          (p_portfolio_destino, current_date, v_total, 'inicial', 'Costo de las órdenes de ' || v_ticker || ' trasladado desde ' || coalesce(p_plan->>'origen_nombre', 'otro portfolio') || ' (' || v_pct || '); no es capital externo real.');
      end if;
    end if;
  end if;
  return v_id;
end $fn$;

revoke execute on function public.transferir_posicion_con_costo(uuid, uuid, double precision, text, double precision, jsonb) from public, anon;
grant execute on function public.transferir_posicion_con_costo(uuid, uuid, double precision, text, double precision, jsonb) to authenticated, service_role;
