-- 0053 — Infraestructura para poder medir el desempeño de la cartera a 10 años (rentabilidad anualizada, comparación contra
-- S&P 500, máxima caída, costos). Solo agrega columnas/tablas: no toca datos existentes.
--
-- Principio: lo que no se registra hoy no se puede recuperar mañana. Por eso el valor diario de cada cartera pasa a grabarlo
-- también el SERVIDOR (cron), no solo la app cuando se abre, y cada fila guarda de dónde salió y con qué composición.

-- 1) portfolio_snapshots: de dónde viene la fila y con qué composición se calculó.
--    fuente   : 'app' (la grabó el navegador al abrir el Dashboard) | 'cron' (la grabó el servidor, todos los días).
--    completo : true si TODAS las posiciones abiertas tenían precio fresco. Un valor incompleto nunca se graba (ensucia el
--               histórico), pero queda la columna por si en el futuro se decide registrar los parciales.
--    detalle  : [{t: ticker, c: cantidad, v: valor USD}] de ese día — permite auditar el valor, hacer atribución por activo y
--               reconstruir sin depender de que las posiciones de hoy sean las de entonces.
alter table public.portfolio_snapshots add column if not exists fuente text not null default 'app';
alter table public.portfolio_snapshots add column if not exists completo boolean not null default true;
alter table public.portfolio_snapshots add column if not exists detalle jsonb;

-- 2) Dólar diario. Sirve para (a) convertir comisiones/costos en pesos al tipo de cambio REAL de cada día y (b) a futuro, comparar
--    el valor teórico de los CEDEARs (subyacente ÷ ratio) contra su precio en pesos ÷ dólar. Es un dato de mercado compartido
--    (no es del usuario): lo escribe el cron con service-role; cualquier usuario autenticado puede leerlo.
create table if not exists public.fx_historico (
  fecha date primary key,
  mep   numeric,
  ccl   numeric,
  fuente text not null default 'cron',
  created_at timestamptz not null default now()
);
alter table public.fx_historico enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'fx_historico' and policyname = 'fx_historico_lectura') then
    create policy fx_historico_lectura on public.fx_historico for select to authenticated using (true);
  end if;
end $$;

-- 3) Órdenes: tipo de cambio MEP de la fecha de ejecución, para llevar `comision_ars` a USD con un dato real. null = no se
--    conoce → la app muestra esa comisión en pesos, sin convertir (nunca estimada).
alter table public.ordenes_ejecutadas add column if not exists mep numeric;
