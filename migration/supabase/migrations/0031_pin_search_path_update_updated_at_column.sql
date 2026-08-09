-- ===========================================================================
-- update_updated_at_column() tenía search_path mutable (hallazgo del advisor de seguridad de
-- Supabase). No es SECURITY DEFINER y no referencia ningún objeto sin calificar (solo asigna
-- NEW.updated_at = NOW(), un campo de la fila, no una tabla/función por nombre) — la explotabilidad
-- real es nula, pero fijar el search_path es gratis y cierra el warning igual.
-- ===========================================================================
alter function public.update_updated_at_column() set search_path = pg_catalog, public;
