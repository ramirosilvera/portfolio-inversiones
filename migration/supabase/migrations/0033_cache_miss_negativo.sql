-- ===========================================================================
-- quotes.ts y beta.ts no tenían caché NEGATIVO: si un proveedor no tenía dato para un ticker (ADR
-- chico, sin cobertura), la próxima request para ese mismo ticker volvía a pegarle a la API paga —
-- sin límite, cada vez que alguien pedía ese ticker. _dividendos.ts ya tenía este problema
-- documentado y resuelto (distinción null vs []); acá faltaba (hallazgo de la auditoría de backend).
--
-- `miss_at` es una columna NUEVA y separada de `updated_at`/`precio`/`beta` — a propósito: un
-- "miss" (el proveedor no tiene el dato) no debe pisar el ÚLTIMO valor bueno conocido, que sigue
-- sirviendo de fallback (cacheLast) aunque esté vencido. Se actualiza sola vía upsert parcial
-- (solo ticker + miss_at en el payload), así el resto de la fila queda intacta.
-- ===========================================================================

alter table public.precios_cache add column if not exists miss_at timestamptz;
alter table public.beta_cache add column if not exists miss_at timestamptz;
