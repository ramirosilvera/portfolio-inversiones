-- ===========================================================================
-- Agrega 'subsoberano' al tipo de bonos_referencia (ver 0034/0035). Hasta ahora el catálogo solo
-- distinguía 'soberano' (Nación) de 'on' (privado) — pero hay deuda de provincias/CABA (ej. Buenos
-- Aires, Mendoza) cargada como si fuera una ON corporativa, lo cual mezcla riesgo de crédito
-- subsoberano con el de una empresa privada en el Radar. No afecta el cálculo de TIR/duración
-- (calcularBonoReferencia no lee `tipo`), solo la clasificación/filtro visual.
-- ===========================================================================

alter table public.bonos_referencia
  drop constraint bonos_referencia_tipo_check;

alter table public.bonos_referencia
  add constraint bonos_referencia_tipo_check check (tipo = any (array['soberano', 'on', 'subsoberano']));
