-- 0062 — La marca de verificación (0061) se invalida sola cuando cambian los datos que verificó.
--
-- Sin esto, un bono marcado «consistente» o «verificado» seguía con esa marca aunque la Routine mensual (o quien sea) le pisara el
-- cronograma con otra cosa de IOL: la marca decía «confiable» sobre datos que nadie había mirado. Regla: si una actualización
-- cambia los flujos FUTUROS, el vencimiento o la amortizabilidad y NO cambia a la vez la marca, la fila vuelve a `sin_verificar`.
--   · Se comparan solo los flujos con fecha >= hoy: podar los pagos ya cobrados (lo que hace la rutina mensual) no cambia lo que se
--     verificó y no debe bajar la marca de todo el catálogo cada mes.
--   · `valor_residual` no cuenta: baja solo cuando se paga una amortización y se deduce de los flujos.
--   · Quien corrige o re-verifica a propósito escribe la marca nueva en el mismo UPDATE y el trigger no interviene.
-- Corre DESPUÉS de bonos_referencia_proteger_corregidos (0051): los triggers BEFORE se ejecutan por orden alfabético y 'p' < 'r', así
-- que si ese trigger revirtió un cambio sobre una fila protegida, acá ya no hay cambio que detectar.

create or replace function public.bonos_referencia_resetear_verificacion()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  futuros_nuevos jsonb;
  futuros_viejos jsonb;
begin
  if new.verificacion is distinct from old.verificacion then
    return new;
  end if;

  select coalesce(jsonb_agg(e order by e->>'fecha'), '[]'::jsonb) into futuros_nuevos
    from jsonb_array_elements(new.cronograma) e where (e->>'fecha')::date >= current_date;
  select coalesce(jsonb_agg(e order by e->>'fecha'), '[]'::jsonb) into futuros_viejos
    from jsonb_array_elements(old.cronograma) e where (e->>'fecha')::date >= current_date;

  if futuros_nuevos is distinct from futuros_viejos
     or new.vencimiento is distinct from old.vencimiento
     or new.amortizable is distinct from old.amortizable then
    new.verificacion      := 'sin_verificar';
    new.verificacion_nota := 'Los datos cambiaron el ' || to_char(current_date, 'DD/MM/YYYY') || ' y no se volvieron a verificar.';
    new.verificado_en     := null;
  end if;
  return new;
end $$;

drop trigger if exists bonos_referencia_resetear_verificacion on public.bonos_referencia;
create trigger bonos_referencia_resetear_verificacion
  before update on public.bonos_referencia
  for each row execute function public.bonos_referencia_resetear_verificacion();
