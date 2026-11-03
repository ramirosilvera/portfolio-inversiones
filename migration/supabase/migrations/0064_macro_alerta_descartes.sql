-- «Descartar por hoy» de la alerta de estrés macro (Inicio), POR USUARIO: así celular y compu comparten el descarte. `clave` = «AAAA-MM-DD|keys»
-- (fecha local + indicadores en alerta; ver claveAlertaDia en engine/alertaMacro.ts): si cambia el día o el conjunto, la alerta reaparece.
-- Es estado efímero: no se respalda (backupTablas.TABLAS_EXCLUIDAS).
create table if not exists public.macro_alerta_descartes (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  clave      text not null,
  updated_at timestamptz not null default now()
);

alter table public.macro_alerta_descartes enable row level security;

drop policy if exists macro_alerta_descartes_own on public.macro_alerta_descartes;
create policy macro_alerta_descartes_own on public.macro_alerta_descartes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
