-- 0052 — Pasar el "saldo disponible para invertir" de Cobros a la posición LIQUIDEZ del portfolio.
--
-- Hasta ahora el saldo (cobros 'disponible' − inversiones marcadas) era solo una anotación: la plata no existía como posición.
-- Esta función la convierte en efectivo de la cartera (LIQUIDEZ) y deja el pase registrado en el mismo ledger de
-- `cobros_inversiones` (una "inversión" del saldo = pasarlo a Liquidez), vinculado al movimiento de efectivo para poder deshacerlo.
-- Todo en UNA transacción: o se mueve la Liquidez Y se anota el pase, o no pasa nada.
--
-- Qué NO cuenta como saldo pasable: los cobros ya acreditados en Liquidez (`cobros.liquidez_mov_id`, migración 0050) — esa plata
-- ya está en el efectivo; pasarla de nuevo la duplicaría. Mismo criterio que engine/cobros.ts (saldoInvertible).

alter table public.cobros_inversiones
  add column if not exists liquidez_mov_id uuid references public.movimientos(id) on delete set null;

create or replace function public.pasar_saldo_a_liquidez(
  p_portfolio uuid, p_monto double precision, p_fecha date, p_nota text default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_disp double precision;
  v_acred double precision;
  v_inv double precision;
  v_mov uuid;
  v_id uuid;
begin
  if not public.owns_portfolio(p_portfolio) then raise exception 'No tenés ese portfolio'; end if;
  if p_monto is null or not (p_monto > 0) then raise exception 'El monto tiene que ser mayor a 0'; end if;

  select coalesce(sum(monto) filter (where estado = 'disponible'), 0),
         coalesce(sum(monto) filter (where estado = 'disponible' and liquidez_mov_id is not null), 0)
    into v_disp, v_acred
    from public.cobros where portfolio_id = p_portfolio;
  select coalesce(sum(monto), 0) into v_inv from public.cobros_inversiones where portfolio_id = p_portfolio;

  if p_monto > (v_disp - v_acred - v_inv) + 0.005 then
    raise exception 'El monto supera el saldo disponible para pasar a Liquidez (USD %)', round(greatest(0, v_disp - v_acred - v_inv)::numeric, 2);
  end if;

  v_mov := public.mover_liquidez(p_portfolio, p_monto, p_fecha, coalesce(p_nota, 'Saldo de cobros pasado a Liquidez'));
  insert into public.cobros_inversiones (portfolio_id, fecha, monto, nota, liquidez_mov_id)
    values (p_portfolio, p_fecha, p_monto, coalesce(p_nota, 'Pasado a Liquidez'), v_mov)
    returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.pasar_saldo_a_liquidez(uuid, double precision, date, text) from public, anon;
grant execute on function public.pasar_saldo_a_liquidez(uuid, double precision, date, text) to authenticated;
