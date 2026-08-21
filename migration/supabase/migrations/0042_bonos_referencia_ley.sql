-- ===========================================================================
-- Agrega `ley` (jurisdicción aplicable: local vs. extranjera) a bonos_referencia, para filtrar el
-- Radar de renta fija por este criterio — el eje que separa "Bonares" (ley Argentina) de "Globales"
-- (ley Nueva York) en los soberanos, y que también aplica a subsoberanos y ONs.
--
-- Mismo criterio que calificadora/calificacion (0036): ni IOL get_fixed_income_analytics ni
-- get_asset_info traen este dato (verificado contra la API real), así que es EDITABLE A MANO por
-- una cuenta aprobada, mismo grant column-level restringido.
--
-- Seed: solo los 20 soberanos/subsoberanos del catálogo actual, verificados con 2+ fuentes públicas
-- independientes cada uno (Bloomberg Línea, El Cronista, Rava, Puentenet, Inversoy, BCRA — búsqueda
-- 2026-08-21). Los ~69 ONs quedan `ley = NULL` A PROPÓSITO: a diferencia del soberano (2 familias de
-- ticker conocidas, AL/GD), la ley aplicable de una ON depende de su prospecto de emisión particular
-- y NO se puede inferir de forma confiable en bloque — cargarla mal sería peor que dejarla vacía.
-- Quedan para carga manual desde la app, igual que un bono sin calificadora todavía.
-- ===========================================================================

alter table public.bonos_referencia
  add column if not exists ley text check (ley in ('local','extranjera'));

grant update (ley) on public.bonos_referencia to authenticated;

-- Soberanos — Bonares (ley Argentina): AL29/AL30/AL35/AL41 (reestructuración 2020), AN29/AO27/AO28
-- (Bonar), AE38 (canje 2020, ley Argentina pese al prefijo "A"), BOPREAL Series 1-4 (BPA7/BPA8/BPB7/
-- BPB8/BPC7/BPD7, BCRA, ley Argentina).
update public.bonos_referencia set ley = 'local' where ticker in (
  'AE38D','AL29D','AL30D','AL35D','AL41D','AN29D','AO27D','AO28D',
  'BPA7D','BPA8D','BPB7D','BPB8D','BPC7D','BPD7D'
);

-- Soberanos — Globales (ley Nueva York), reestructuración 2020: GD35/GD38/GD41/GD46.
update public.bonos_referencia set ley = 'extranjera' where ticker in (
  'GD35D','GD38D','GD41D','GD46D'
);

-- Subsoberanos — ambos son emisiones internacionales (Reg S) bajo ley extranjera (Nueva York):
-- Buenos Aires 2037 y Mendoza 2029.
update public.bonos_referencia set ley = 'extranjera' where ticker in ('BA7DD','PM29D');
