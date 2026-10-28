-- Ajustar la Liquidez a mano (sacar o sumar efectivo) y dejar el aporte/retiro de capital registrado EN LA MISMA TRANSACCIÓN.
-- Antes, editar la cantidad de LIQUIDEZ dejaba un movimiento 'ajuste' sin flujo de capital: el valor de la cartera bajaba (o subía)
-- pero los aportes/retiros no, y la ganancia (valor + retiros − aportes) se distorsionaba por exactamente ese monto.
-- Retirar efectivo → fila 'retiro' en aportes; sumar efectivo → fila 'recurrente'. p_registrar = false es una corrección pura
-- (el saldo estaba mal cargado: no hubo movimiento de plata real) y no toca aportes.

create or replace function public.ajustar_liquidez_con_flujo(
  p_portfolio uuid, p_nueva double precision, p_fecha date, p_registrar boolean default true, p_nota text default null
) returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_actual double precision; v_delta double precision; v_mov uuid; v_desc text;
begin
  if not public.owns_portfolio(p_portfolio) then raise exception 'No tenés ese portfolio'; end if;
  if p_nueva is null or p_nueva < 0 then raise exception 'La Liquidez no puede ser negativa'; end if;
  select cantidad into v_actual from public.posiciones
   where portfolio_id = p_portfolio and tipo = 'cash' and ticker = 'LIQUIDEZ' order by created_at limit 1 for update;
  v_actual := coalesce(v_actual, 0);
  v_delta := round((p_nueva - v_actual)::numeric, 2);
  if v_delta = 0 then return null; end if;
  v_desc := coalesce(p_nota, case when v_delta < 0 then 'Retiro de Liquidez' else 'Aporte a Liquidez' end)
            || ' (ajuste manual: de US$ ' || round(v_actual::numeric, 2) || ' a US$ ' || round(p_nueva::numeric, 2) || ')';
  v_mov := public.mover_liquidez(p_portfolio, v_delta, p_fecha, v_desc);
  if p_registrar then
    insert into public.aportes (portfolio_id, monto, fecha, tipo, descripcion)
    values (p_portfolio, abs(v_delta), p_fecha, case when v_delta < 0 then 'retiro' else 'recurrente' end, v_desc);
  end if;
  return v_mov;
end $$;

grant execute on function public.ajustar_liquidez_con_flujo(uuid, double precision, date, boolean, text) to authenticated;
