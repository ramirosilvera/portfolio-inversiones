-- 0055 — Costos de los cobros (retención de dividendos del exterior, comisión del bróker sobre el pago).
-- `monto` pasa a significar lo que EFECTIVAMENTE se acredita (neto) cuando hay costos cargados; así el P&L, la Liquidez, el saldo y el
-- rendimiento (que leen `monto`) ya usan el neto sin tocarse. El detalle queda en las columnas nuevas. Las filas existentes quedan
-- con costos en null: su `monto` es lo declarado por el proveedor (bruto) y no se reinterpreta.
alter table public.cobros add column if not exists monto_bruto double precision;
alter table public.cobros add column if not exists retencion_usd double precision;
alter table public.cobros add column if not exists comision_usd double precision;
alter table public.cobros add column if not exists costos_estimados boolean not null default false;
