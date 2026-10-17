-- 0057 — Las órdenes registradas pueden ser de compra o de venta (antes solo compras). Las existentes son compras.
alter table public.ordenes_ejecutadas add column if not exists lado text not null default 'compra' check (lado in ('compra', 'venta'));
