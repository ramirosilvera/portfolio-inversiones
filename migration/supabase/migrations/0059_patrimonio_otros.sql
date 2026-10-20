-- ===========================================================================
-- 0059 — Otros bienes del usuario (fuera de los portfolios) para el módulo de Impuestos.
-- Bienes Personales se mide sobre TODO el patrimonio de la persona, no solo sobre lo que está en la app: vehículo, inmuebles,
-- efectivo, cuentas en el exterior. PER-USER (no cuelga de un portfolio: es de la persona), mismo patrón que flujo_items:
-- id propio, user_id por defecto auth.uid(), una sola política ALL por auth.uid().
--   valor_ars        valor en pesos que se usa para el impuesto
--   base             de dónde sale ese valor: 'valuacion_arca' (tabla oficial al 31/12, la que cuenta para el impuesto) o un valor
--                    provisorio ('seguro', 'mercado', 'costo') hasta cargar el oficial — la pantalla los marca como provisorios
--   casa_habitacion  está exenta (hasta el umbral que fija ARCA cada año), por eso es un tipo aparte
-- ===========================================================================

create table if not exists public.patrimonio_otros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null check (length(btrim(nombre)) > 0),
  tipo text not null check (tipo in ('vehiculo', 'inmueble', 'casa_habitacion', 'efectivo', 'exterior', 'otro')),
  valor_ars numeric not null check (valor_ars >= 0),
  base text not null default 'seguro' check (base in ('valuacion_arca', 'seguro', 'mercado', 'costo')),
  fecha_valuacion date not null default current_date,
  nota text,
  created_at timestamptz not null default now()
);

create index if not exists patrimonio_otros_user on public.patrimonio_otros (user_id);

alter table public.patrimonio_otros enable row level security;

drop policy if exists patrimonio_otros_own on public.patrimonio_otros;
create policy patrimonio_otros_own on public.patrimonio_otros for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
