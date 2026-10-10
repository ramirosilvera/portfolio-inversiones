-- 0051 — Protege las filas de bonos_referencia corregidas a mano.
--
-- La actualización mensual (Routine) vuelve a leer el cronograma de IOL, que NO es una fuente confiable (2026-10-10: 11
-- cronogramas equivocados —otra emisión, cupón a la mitad, frecuencia errada—). Las filas corregidas con el aviso de
-- resultados quedan con `fuente` que empieza con 'IOL | corregido'. Este trigger hace que esa corrección no se pueda pisar
-- por accidente: si una fila corregida se actualiza SIN cambiar la marca de `fuente` (o volviendo a 'IOL'), se conservan
-- los valores corregidos de las columnas protegidas. Para corregir de nuevo a propósito hay que escribir una `fuente`
-- NUEVA que también empiece con 'IOL | corregido' (la nota distinta es la señal de "esto es una corrección deliberada").
-- Las demás columnas (emisor, calificación, ley, volumen, actualizado_en) siguen actualizándose con normalidad.

create or replace function public.bonos_referencia_proteger_corregidos()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.fuente like 'IOL | corregido%'
     and (new.fuente is not distinct from old.fuente or new.fuente not like 'IOL | corregido%') then
    new.cronograma     := old.cronograma;
    new.emision        := old.emision;
    new.vencimiento    := old.vencimiento;
    new.amortizable    := old.amortizable;
    new.valor_residual := old.valor_residual;
    new.fuente         := old.fuente;
  end if;
  return new;
end $$;

drop trigger if exists bonos_referencia_proteger_corregidos on public.bonos_referencia;
create trigger bonos_referencia_proteger_corregidos
  before update on public.bonos_referencia
  for each row execute function public.bonos_referencia_proteger_corregidos();
