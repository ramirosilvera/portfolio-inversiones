-- ===========================================================================
-- cedear_ratios_write (0002_cedear_ratios.sql) era "for all to authenticated using(true) with
-- check(true)": CUALQUIER cuenta con sesión —incluida una recién auto-registrada, todavía sin
-- aprobar por un admin (0021_aprobacion_cuentas.sql)— podía escribir O BORRAR cualquier fila,
-- no solo agregar un ratio nuevo. A diferencia de posiciones/aportes (aislados por portfolio_id),
-- esta es una tabla COMPARTIDA que alimenta la valuación de CEDEARs de TODOS los portfolios: una
-- cuenta sin aprobar podía sobrescribir el ratio de un ticker existente y desviar la valuación de
-- otro usuario (hallazgo de la auditoría de backend). Se restringe a cuentas APROBADAS (mismo
-- criterio que crear un portfolio) y se saca DELETE del cliente — src/hooks/useCedearRatios.ts
-- solo hace upsert (insert/update), nunca borra.
-- ===========================================================================

drop policy if exists cedear_ratios_write on public.cedear_ratios;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='cedear_ratios' and policyname='cedear_ratios_insert') then
    create policy cedear_ratios_insert on public.cedear_ratios for insert to authenticated
      with check (public.is_approved(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='cedear_ratios' and policyname='cedear_ratios_update') then
    create policy cedear_ratios_update on public.cedear_ratios for update to authenticated
      using (public.is_approved(auth.uid())) with check (public.is_approved(auth.uid()));
  end if;
end $$;
