-- ===========================================================================
-- 0060 — Parámetros impositivos (Bienes Personales) mantenidos por el SERVIDOR, no por el usuario.
-- Dato de referencia compartido (como fx_historico): lo escribe el cron (service-role) y cualquier usuario autenticado lo lee; el
-- cliente no tiene política de escritura. Una fila por (año, clave):
--   bp_params  { minimoNoImponible, casaHabitacion }  en ARS
--   bp_escala  { tramos: [{ hasta, fijo, alicuota }] }
--   estimado   true = calculada con el IPC de INDEC mientras ARCA no publica; NUNCA pisa una fila oficial (estimado = false)
--   verificado true = contrastada contra la publicación oficial de ARCA (las cargadas desde fuentes profesionales quedan en false)
-- La app usa estas filas para el año en curso y cae a las constantes del código (engine/impuestos.ts) si no hay.
-- ===========================================================================

create table if not exists public.impuestos_parametros (
  anio int not null,
  clave text not null check (clave in ('bp_params', 'bp_escala')),
  valor jsonb not null,
  estimado boolean not null default false,
  verificado boolean not null default false,
  fuente text not null,
  actualizado timestamptz not null default now(),
  primary key (anio, clave)
);

alter table public.impuestos_parametros enable row level security;

drop policy if exists impuestos_parametros_lectura on public.impuestos_parametros;
create policy impuestos_parametros_lectura on public.impuestos_parametros for select to authenticated using (true);

-- Período 2025 (oficial de ARCA según fuentes profesionales que coinciden; verificado = false hasta contrastarlo con la tabla de ARCA).
insert into public.impuestos_parametros (anio, clave, valor, estimado, verificado, fuente) values
  (2025, 'bp_params', '{"minimoNoImponible": 384728044.57, "casaHabitacion": 1346548155.99}'::jsonb, false, false,
   'ARCA período fiscal 2025 (iProfesional, Blog del Contador y otras fuentes coinciden)'),
  (2025, 'bp_escala', '{"tramos": [{"hasta": 52664283.73, "fijo": 0, "alicuota": 0.005}, {"hasta": 114105948.16, "fijo": 263321.42, "alicuota": 0.0075}, {"hasta": null, "fijo": 724133.89, "alicuota": 0.01}]}'::jsonb, false, false,
   'ARCA escala general del período fiscal 2025 (iProfesional, Blog del Contador y otras fuentes coinciden)')
on conflict (anio, clave) do nothing;
