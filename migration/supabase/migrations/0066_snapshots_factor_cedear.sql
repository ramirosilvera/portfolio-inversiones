-- Factor CCL ÷ MEP con el que se valuaron los CEDEARs de cada snapshot (2026-11-12): desde esa fecha el valor de un CEDEAR es subyacente ÷ ratio × (CCL ÷ MEP).
-- NULL = snapshot anterior al cambio, valuado por paridad (al CCL, factor implícito 1). Permite que el motor de desempeño neutralice el escalón de método
-- (engine/desempeno.ts, `puente`) y detectar cualquier día que se haya grabado sin el factor real.
alter table public.portfolio_snapshots add column if not exists factor_cedear double precision;
