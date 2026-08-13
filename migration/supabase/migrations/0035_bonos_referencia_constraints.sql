-- ===========================================================================
-- Hallazgos de la revisión adversarial de bonos_referencia (0034): la tabla no tenía ninguna
-- restricción de forma sobre `cronograma` — un jsonb `NOT NULL` acepta perfectamente el valor JSON
-- `null` (no lo mismo que SQL NULL) o un objeto en vez de un array, y eso hace explotar
-- ytmFromCronograma/bondDurationFromCronograma con un TypeError que tira abajo el Radar entero (el
-- catálogo es GLOBAL, así que una sola fila mal cargada afecta a todos los usuarios). También se
-- restringe `moneda` a solo USD: valuar en USD una especie que en los hechos paga en PESOS
-- requeriría un supuesto de tipo de cambio futuro que engine/rentaFija.ts no modela.
-- ===========================================================================

alter table public.bonos_referencia
  add constraint bonos_referencia_cronograma_array check (jsonb_typeof(cronograma) = 'array' and jsonb_array_length(cronograma) > 0);

alter table public.bonos_referencia
  add constraint bonos_referencia_valor_residual_rango check (valor_residual >= 0 and valor_residual <= 1);

alter table public.bonos_referencia
  drop constraint if exists bonos_referencia_moneda_check;
alter table public.bonos_referencia
  add constraint bonos_referencia_moneda_check check (moneda = 'USD');
