-- ===========================================================================
-- Cache GLOBAL de ticker → CIK de EDGAR, resuelto automáticamente (ver functions/api/market/
-- fundamentals.ts) para cualquier ticker que no esté en el DEFAULT_CIK hardcodeado (~70 empresas).
-- Antes, cargar un ticker nuevo fuera de esa lista significaba SIEMPRE ir a mano a Configuración a
-- buscar el CIK en el sitio de la SEC — esta tabla es el resultado de resolverlo una vez (vía FMP,
-- que ya expone `cik` en su endpoint de perfil, mismo secret que ya usa beta.ts/quotes.ts — no
-- depende del archivo bulk de EDGAR, que el proxy actual no tiene probado que pueda alcanzar) y no
-- tener que volver a hacerlo nunca más para ese ticker. CIK es una asignación PERMANENTE de la SEC a
-- una entidad legal — no cambia salvo un caso extremadamente raro (fusión/reestructuración), así que
-- no hace falta un TTL corto para esta tabla.
-- ===========================================================================

create table if not exists public.edgar_ticker_cik (
  ticker      text primary key,
  cik         text not null,
  fuente      text not null default 'fmp',
  updated_at  timestamptz not null default now()
);

alter table public.edgar_ticker_cik enable row level security;

-- Mismo criterio que fundamentals_cache/bonos_referencia: dato de mercado compartido, no personal —
-- lectura para cualquier autenticado, escritura solo vía service-role (la Function).
do $$ begin
  if not exists (select 1 from pg_policies where tablename='edgar_ticker_cik' and policyname='edgar_ticker_cik_read') then
    create policy edgar_ticker_cik_read on public.edgar_ticker_cik for select to authenticated using (true);
  end if;
end $$;
