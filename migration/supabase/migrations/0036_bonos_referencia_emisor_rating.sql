-- ===========================================================================
-- Agrega emisor + calificación crediticia a bonos_referencia, para poder categorizar/filtrar el
-- Radar de renta fija. A diferencia del resto de la fila (cronograma, vencimiento, etc. — cargados
-- por el proceso de actualización desde IOL, nunca por el cliente, ver 0034), la calificación
-- crediticia SÍ es editable a mano por el usuario: no hay API gratuita que la dé (ver
-- engine/rating.ts), así que el criterio es el mismo que cedear_ratios — una cuenta APROBADA puede
-- cargarla. Se restringe a nivel de COLUMNA (grant column-level), no de fila entera: una cuenta
-- aprobada puede corregir la calificación de un bono, pero NUNCA tocar su cronograma/vencimiento/
-- moneda desde el cliente (eso seguiría exigiendo pasar por el proceso con service-role).
-- ===========================================================================

alter table public.bonos_referencia
  add column if not exists emisor text,
  add column if not exists calificadora text,
  add column if not exists calificacion text;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='bonos_referencia' and policyname='bonos_referencia_update_rating') then
    create policy bonos_referencia_update_rating on public.bonos_referencia for update to authenticated
      using (public.is_approved(auth.uid())) with check (public.is_approved(auth.uid()));
  end if;
end $$;

-- authenticated puede tener UPDATE de tabla completa por default de Supabase (la app depende de RLS,
-- no de GRANT, como gate normal) — acá SÍ nos importa el grant además de la policy, para que el
-- alcance del UPDATE quede limitado a estas 2 columnas por más que la policy de arriba autorice la
-- fila entera.
revoke update on public.bonos_referencia from authenticated;
grant update (calificadora, calificacion) on public.bonos_referencia to authenticated;
