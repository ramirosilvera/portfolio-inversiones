-- ===========================================================================
-- Cache de precio histórico (5 años, semanal) para el gráfico de tendencia en Análisis de renta
-- variable — fuente: Yahoo Finance (ver functions/api/_market.ts, mismo proveedor que ya usa
-- market/drawdowns.ts para S&P500/oro/Merval). Cache COMPARTIDO entre usuarios (dato de mercado, no
-- personal) — mismo patrón que fundamentals_cache/precios_cache: PK simple, solo la Function
-- (service-role) escribe, lectura pública para cualquier usuario autenticado.
-- ===========================================================================

create table if not exists public.precio_historico_cache (
  ticker     text primary key,
  data_json  jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.precio_historico_cache enable row level security;

drop policy if exists precio_historico_read on public.precio_historico_cache;
create policy precio_historico_read on public.precio_historico_cache for select to authenticated using (true);
