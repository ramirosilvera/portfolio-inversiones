-- ===========================================================================
-- Volumen operado (USD) de cada instrumento del catálogo, para el chequeo de operabilidad minorista
-- (engine/volumenRentaFija.ts): ¿hay suficiente contraparte real, incluso en un día flojo, para que
-- MI ticket se ejecute a precio razonable? Media/mediana/mínimo sobre una ventana de ~20 ruedas —
-- fuente: IOL get_price_history (mismo proceso de actualización con service-role que ya puebla
-- cronograma, ver 0034; nunca el cliente, mismo criterio que el resto de la fila salvo
-- emisor/calificadora/calificacion, ver 0036).
-- ===========================================================================

alter table public.bonos_referencia
  add column if not exists vol_media_usd double precision,
  add column if not exists vol_mediana_usd double precision,
  add column if not exists vol_minimo_usd double precision,
  add column if not exists vol_dias_con_datos integer,
  add column if not exists vol_actualizado_en timestamptz;
