-- 0056 — Costos configurables por broker. Todas las columnas son FRACCIONES (0,0072 = 0,72 %) y null = usar el valor por defecto de la app
-- (engine/costosCobros.ts). Qué depende de qué:
--   · retencion_dividendo   : retención de Estados Unidos sobre dividendos de CEDEARs (30 % para argentinos, sin convenio): es universal.
--   · comision_depositaria  : comisión del BANCO DEPOSITARIO del CEDEAR (la fija cada anuncio de Caja de Valores), no del broker; se
--                             deja acá para poder editarla sin otra pantalla.
--   · comision_cobro_dividendo / comision_cobro_interes : lo que el BROKER cobra sobre cada pago.
--   · comision_operacion    : costo todo incluido (comisión + derechos + IVA) por comprar/vender, referencia para estimar compras.
alter table public.brokers add column if not exists retencion_dividendo double precision;
alter table public.brokers add column if not exists comision_depositaria double precision;
alter table public.brokers add column if not exists comision_cobro_dividendo double precision;
alter table public.brokers add column if not exists comision_cobro_interes double precision;
alter table public.brokers add column if not exists comision_operacion double precision;
alter table public.brokers add column if not exists notas_costos text;
