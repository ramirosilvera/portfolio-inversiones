-- ===========================================================================
-- Registro de órdenes ejecutadas (o intentadas) vía el conector MCP de IOL — workflow externo
-- de operación real supervisada (Plan Maestro Herencia, ver excepción documentada en CLAUDE.md
-- regla de oro #4). La app en sí sigue siendo de solo lectura de mercado; esta tabla es
-- solamente un registro/auditoría de lo que se cargó o intentó cargar fuera de la app.
-- ===========================================================================

create table if not exists public.ordenes_ejecutadas (
  id                uuid primary key default gen_random_uuid(),
  portfolio_id      uuid references public.portfolios(id),
  fecha             date not null,
  ticker            text not null,
  broker            text not null default 'IOL',
  numero_orden      text,              -- null si fue carga manual (sin API) o si fue rechazada
  nominales         numeric not null,
  precio_limite     numeric,
  precio_ejecutado  numeric,
  monto_usd         numeric not null,
  comision_usd      numeric,
  comision_ars      numeric,
  estado            text not null,    -- 'terminada' | 'cancelada' | 'pendiente' | 'rechazada'
  origen            text not null,    -- 'api' | 'manual'
  nota              text,
  created_at        timestamptz not null default now()
);

alter table public.ordenes_ejecutadas enable row level security;

drop policy if exists ordenes_ejecutadas_own on public.ordenes_ejecutadas;
create policy ordenes_ejecutadas_own on public.ordenes_ejecutadas for all to authenticated
  using (public.owns_portfolio(portfolio_id)) with check (public.owns_portfolio(portfolio_id));
