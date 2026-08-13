-- ===========================================================================
-- Catálogo de referencia de renta fija (bonos soberanos + ONs) para Radar/Análisis: cronograma de
-- flujos REAL (fecha + interés + amortización, fracción 0..1 del nominal ORIGINAL) por ticker, para
-- que el motor (engine/coupons.ts) calcule TIR/duración sin depender de que el usuario cargue cupón
-- a mano. Es un catálogo GLOBAL compartido (no por portfolio, no por usuario) — mismo criterio que
-- cedear_ratios: lectura para cualquier autenticado, pero SIN política de escritura para
-- `authenticated` (a diferencia de cedear_ratios, que sí es editable a mano). Esta tabla la puebla
-- únicamente el service-role (proceso de investigación/actualización mensual vía IOL), nunca el
-- cliente — cargar mal un cronograma de bono corrompería la TIR/duración de cualquier usuario que lo
-- siga, no solo del que lo cargó.
-- ===========================================================================

create table if not exists public.bonos_referencia (
  ticker         text primary key,
  tipo           text not null check (tipo in ('soberano','on')),
  instrumento    text not null check (instrumento in ('BOND','NOTE')),
  moneda         text not null check (moneda in ('USD','ARS')),
  nombre         text,
  emision        date,
  vencimiento    date not null,
  -- true si el cronograma tiene más de un pago de amortización (capital se devuelve en varias
  -- cuotas) — false = bullet (100% del capital recién al vencimiento, un solo pago de amortización).
  amortizable    boolean not null default false,
  -- Fracción 0..1 del nominal ORIGINAL que queda por cobrar HOY (ya neto de amortizaciones pasadas).
  valor_residual double precision not null default 1,
  -- [{fecha:'YYYY-MM-DD', interes: number, amortizacion: number, saldo_residual: number}], todos en
  -- fracción 0..1 del nominal ORIGINAL (misma base que valor_residual) — ver CronogramaItem en
  -- src/types/domain.ts. Fuente: IOL get_fixed_income_analytics (campo cashflow).
  cronograma     jsonb not null,
  fuente         text not null default 'IOL',
  actualizado_en timestamptz not null default now()
);

alter table public.bonos_referencia enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='bonos_referencia' and policyname='bonos_referencia_read') then
    create policy bonos_referencia_read on public.bonos_referencia for select to authenticated using (true);
  end if;
end $$;
