-- 0061 — Estado de verificación de los datos del catálogo de renta fija.
--
-- bonos_referencia se alimenta de IOL, que NO es fuente primaria (cronogramas con cupón a la mitad, otra emisión, ON en pesos
-- cargadas como USD). Antes la única señal era un texto en `fuente` ("IOL | corregido …"); ahora hay una columna real, filtrable y
-- ordenable, que dice cuánto se puede confiar en los flujos de cada fila. Ver src/engine/verificacion.ts.
--
--   primaria      contrastado con aviso de resultados / suplemento / flujo de fondos del broker
--   secundaria    tasa y vencimiento coinciden con fuentes externas independientes de IOL (estudios jurídicos, emisor, prensa)
--   consistente   vencimiento (y tasa si figura) coinciden con la ficha de IOL y la TIR de mercado es plausible; sin fuente externa
--   revisar       sin contradicción directa, pero el precio da una TIR atípica
--   inconsistente evidencia en contra (otra moneda, otro vencimiento, flujos faltantes)
--   sin_verificar solo datos de IOL, sin precio ni analytics para contrastar (default de toda fila nueva)
--
-- Solo la escribe el proceso de actualización / una sesión con service-role: el cliente no tiene grant de escritura sobre estas
-- columnas (el grant column-level de 0036/0042 cubre solo calificadora, calificacion y ley). El trigger de 0051 no las protege a
-- propósito: la verificación se re-evalúa cuando cambian los datos.

alter table public.bonos_referencia
  add column if not exists verificacion text not null default 'sin_verificar',
  add column if not exists verificacion_nota text,
  add column if not exists verificado_en date;

alter table public.bonos_referencia
  drop constraint if exists bonos_referencia_verificacion_chk;
alter table public.bonos_referencia
  add constraint bonos_referencia_verificacion_chk
  check (verificacion in ('primaria', 'secundaria', 'consistente', 'revisar', 'inconsistente', 'sin_verificar'));
