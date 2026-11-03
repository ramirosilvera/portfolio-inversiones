-- Serie diaria de los indicadores macro (la graba el cron): hasta ahora macro_cache solo guarda el ÚLTIMO valor, así que no se podía medir la
-- volatilidad real de cada indicador para calibrar la banda de la alerta de estrés (engine/volatilidadMacro.ts). Dato de mercado compartido
-- (sin usuario): lectura para cualquier usuario autenticado, escritura solo del servidor (service-role). No se respalda (TABLAS_EXCLUIDAS).
create table if not exists public.macro_historico (
  fecha  date not null,
  clave  text not null,
  valor  double precision not null,
  primary key (fecha, clave)
);

alter table public.macro_historico enable row level security;

drop policy if exists macro_historico_read on public.macro_historico;
create policy macro_historico_read on public.macro_historico for select to authenticated using (true);
