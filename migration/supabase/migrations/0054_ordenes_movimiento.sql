-- 0054 — Órdenes cargadas desde la app (pantalla "Órdenes y costos" y alta de posición): cada orden puede quedar vinculada al
-- movimiento de compra que generó, para conciliar órdenes contra movimientos. Nullable: las órdenes históricas (cargadas desde IOL
-- por sesión) se concilian por (fecha, ticker, cantidad) y no tienen vínculo directo.
alter table public.ordenes_ejecutadas
  add column if not exists movimiento_id uuid references public.movimientos(id) on delete set null;
create index if not exists ordenes_ejecutadas_portfolio_fecha on public.ordenes_ejecutadas (portfolio_id, fecha);
