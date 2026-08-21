-- ===========================================================================
-- Agrega `ley` (jurisdicción aplicable: local/extranjera) a `posiciones`, mismo campo y mismo
-- criterio que bonos_referencia.ley (0042): ninguna API gratuita la da, se carga a mano — acá
-- además se pre-llena sola cuando el ticker matchea el catálogo de referencia (ver enrichBono en
-- PosicionesPage.tsx), igual que ya pasa con calificadora/calificacion/amortizable/valor_residual.
--
-- Sin grant especial (a diferencia de bonos_referencia.ley): `posiciones` es dato 100% personal del
-- usuario, la policy `posiciones_own` (owns_portfolio) ya le da CRUD completo sobre CUALQUIER
-- columna de sus propias filas — no hace falta restringir a nivel de columna como en el catálogo
-- global compartido.
-- ===========================================================================

alter table public.posiciones
  add column if not exists ley text check (ley in ('local','extranjera'));
