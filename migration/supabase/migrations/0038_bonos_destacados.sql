-- ===========================================================================
-- Tickers de renta fija marcados como "destacados" por el usuario, para que aparezcan primero en
-- el catálogo del Radar. PER-USER (no en bonos_referencia, que es el catálogo global compartido y
-- de solo-lectura para el cliente salvo calificadora/calificación — ver 0034/0036): usuarios
-- distintos pueden querer destacar bonos distintos. Mismo patrón que dcf_inputs (0007): PK
-- compuesta (user_id, ticker), sin id propio, RLS de una sola política ALL por auth.uid().
-- ===========================================================================

create table if not exists public.bonos_destacados (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

alter table public.bonos_destacados enable row level security;

drop policy if exists bonos_destacados_own on public.bonos_destacados;
create policy bonos_destacados_own on public.bonos_destacados for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
