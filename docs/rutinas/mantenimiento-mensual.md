# Mantenimiento mensual — procedimiento de la tarea programada

**Una sola tarea programada** (día 20 de cada mes, 12:00 UTC = 9:00 ART) que corre DENTRO de la sesión del proyecto: es la única que
tiene los conectores `Supabase` e `IOL_inversiones` (una sesión nueva o una rutina creada con `create_trigger` NO los trae). El mensaje
del disparo es corto a propósito: "ejecutá `docs/rutinas/mantenimiento-mensual.md`". Todo el procedimiento vive acá, versionado; se cambia
con un commit, no recreando la tarea.

Supabase: proyecto `wyedmgxngqdgnxmbencl`. Si faltan los conectores **Supabase** o **IOL_inversiones**, parar y avisar en UNA línea.
Si falta WebSearch, seguir solo con los controles de IOL y decirlo.

## Reglas de ejecución (ahorran tokens y errores)

1. **Primero lo barato**: correr las consultas de chequeo (más abajo). Si una parte no tiene trabajo, se saltea y se anota "sin trabajo".
2. **Subagentes para lo masivo** (Parte A, C y D: decenas de llamadas a IOL/WebSearch): lotes de 10–12 tickers por agente; cada agente
   devuelve SOLO un resumen compacto (`ticker → resultado`, máx. 1 línea por ticker). Nunca volcar al contexto principal el JSON crudo
   de IOL ni los resultados de búsqueda.
3. **Los números los calcula el código**: cronogramas y estadísticas por script Node, nunca a mano ni de memoria.
4. **Escrituras a Supabase**: una sentencia CORTA por fila (las largas o con texto largo agotan el tiempo del conector); notas de
   ≤ 80 caracteres, sin comillas dobles (escapar `'` como `''`). Si una escritura sale `cancelled` o con timeout: NO rodearla por otra vía,
   anotarla en el reporte y seguir.
5. **Un solo reporte** al final (≤ 40 líneas, por parte). No leer CLAUDE.md de nuevo: lo relevante está acá.

## Calendario: qué corre cada mes

| Parte | Cuándo | Qué hace |
|---|---|---|
| A. Refresco del catálogo | todos los meses | poda de flujos cobrados y detección de cambios de cronograma |
| B. Completar emisor/rating/ley | todos los meses, **solo si hay filas incompletas** | WebSearch por ticker |
| C. Volumen operado | todos los meses | `vol_*` del catálogo |
| D. Revisión de verificación | todos los meses | re-evalúa hasta 25 bonos no confiables |
| E. Altas de tickers nuevos | enero, abril, julio y octubre | agrega bonos que faltan, verificados |
| F. Parámetros de Bienes Personales | enero a abril | carga la tabla oficial de ARCA |
| G. Control del cron de INDEC | noviembre | confirma que el cron creó la fila estimada del año |

Orden de ejecución: chequeos → A → B → C → D → (E) → (F) → (G) → reporte.

## Chequeos previos (SQL)

```sql
-- conteo por nivel de verificación (se repite al final)
select verificacion, count(*) from public.bonos_referencia group by 1 order by 1;
-- ¿hay filas incompletas para la Parte B?
select count(*) from public.bonos_referencia where emisor is null or calificadora is null or calificacion is null or ley is null;
-- bonos en cartera fuera del catálogo (solo mencionarlos en el reporte)
select distinct ticker from public.posiciones where tipo='bono' and cantidad>0 and ticker not in (select ticker from public.bonos_referencia);
```

## Reglas del catálogo (valen para A, D y E)

- `bonos_referencia` se alimenta de IOL, que **no es fuente primaria** (ON en pesos cargadas como USD, cupones a la mitad o a ¼,
  vencimientos de otra emisión). Nunca inventar tasa, frecuencia, fechas, emisor, rating o ley.
- **R1 — filas protegidas**: si `fuente` empieza con `IOL | corregido`, NO tocar `cronograma`, `emision`, `vencimiento`, `amortizable`,
  `valor_residual` ni `fuente` (además lo impide el trigger 0051). Sí se pueden actualizar emisor/rating/ley, `vol_*` y las columnas de
  verificación. Comparar con IOL (tolerancia 0,0005) y solo reportar si difiere.
- **R2 — cambio de cronograma de IOL**: antes de pisar un cronograma, verificar con WebSearch (aviso de resultados, suplemento,
  calificadora, nota de Bruchou & Funes / Pagbam / Marval / abogados.com.ar): cupón por período ≈ tasa ÷ frecuencia (el error conocido es
  tasa/4 sobre fechas semestrales), último flujo = vencimiento, fechas coherentes, y `get_asset_info` (la descripción trae clase, tasa y
  vencimiento; **«$» = ON en pesos, no corresponde al catálogo**). Coincide → actualizar con `fuente='IOL'`. Difiere y la fuente es clara →
  generar el cronograma por script y cargar con `fuente = 'IOL | corregido AAAA-MM-DD: <emisor y clase>, <tasa>% <frecuencia>, vto <fecha>'`
  (ese prefijo activa la protección). Sin fuente → dejar la fila y reportar. El trigger 0062 baja la marca a `sin_verificar` cuando cambian
  los flujos futuros sin que cambie la marca: escribir la marca nueva en el MISMO UPDATE si se corrige con evidencia.
- **R3 — coherencia de todo el catálogo (SQL, sin web, solo reportar)**: hueco > 200 días entre flujos; último flujo ≠ vencimiento; tasa del
  nombre vs. interés implícito (> 0,3 pp); cupón ≈ tasa/4 con fechas semestrales; suma de amortizaciones futuras ≠ `valor_residual` (> 0,001).
  La fecha de emisión de IOL suele estar mal y no entra en ningún cálculo: no alarmar.
- Constraints: `tipo` ∈ soberano/on/subsoberano; `instrumento` ∈ BOND/NOTE; `moneda` = 'USD'; `valor_residual` entre 0 y 1; `cronograma` jsonb
  no vacío; formato `[{fecha, interes, amortizacion, saldo_residual}]` en FRACCIÓN 0..1 del nominal ORIGINAL, solo flujos futuros.

## Parte A — Refresco

Para cada ticker del catálogo (en lotes por subagentes): `get_fixed_income_analytics`. Igual a lo guardado (0,0005) → solo
`actualizado_en = now()`. Cambió → R2. Fila no protegida con flujos de fecha < hoy → podarlos (el trigger 0062 no baja la marca por
eso). Si un ticker falla los filtros (último flujo ≠ vencimiento, TIR fuera de −5 %…60 %, moneda no USD, BILL) → NO tocar la fila, reportarla.

## Parte B — Emisor, rating y ley (solo si el chequeo dio filas incompletas)

Completar `emisor`, `tipo`, `calificadora`/`calificacion`, `ley` (`local` / `extranjera`) solo con fuente que nombre el **ticker exacto**; si no
hay, dejar `null` (cobertura parcial y honesta). `ley`: ISIN `AR0…` = local, `USP…` = extranjera; cita del prospecto; asesores de una
colocación 144A/Reg S (Bruchou + un estudio de Nueva York). "Inferir por programa" solo dentro de la misma clase numerada. Rating soberano:
el de la República (a nivel país). BOPREAL: sin rating de agencia es lo esperado (ley local). Subsoberanos: revisar provincia/CABA antes de asumir ON.

## Parte C — Volumen operado

1. `select br.ticker, pc.precio from public.bonos_referencia br join public.precios_cache pc on pc.ticker = br.ticker order by 1;`
   (sin precio → excluido y reportado). **TXS8D**: excluir si su `precio` es anómalo (el esperado ronda 0,3–1,3).
2. Por ticker: `get_price_history(symbol, market:'BCBA', from_date: hoy−30 días, to_date: hoy)`; guardar `volume` (nominal) de cada barra. Timeout:
   reintentar UNA vez; si falla, no tocar sus `vol_*`.
3. **Control**: dos tickers distintos con `bars` idénticas = bug de la fuente → no cargar ninguno de los dos y reportarlos (pasó con JNC6D/GN49D).
4. Calcular con el motor del repo (`migration/src/engine/volumenRentaFija.ts`, `statsVolumen`) en un script Node; el precio que se le pasa es
   `precios_cache.precio` (fracción del nominal), NUNCA el `close` de IOL (base 100).
5. Cargar en bloques de ~25 filas: `update bonos_referencia as br set vol_media_usd=v.media, vol_mediana_usd=v.mediana, vol_minimo_usd=v.minimo,
   vol_dias_con_datos=v.dias, vol_actualizado_en=now() from (values (...)) as v(ticker,media,mediana,minimo,dias) where br.ticker=v.ticker;`
   Solo esas 5 columnas.

## Parte D — Revisión de verificación (hasta 25 bonos por mes)

Niveles de `bonos_referencia.verificacion` (de más a menos confiable): **primaria** (aviso de resultados / suplemento / flujo de fondos del
broker), **secundaria** (≥ 2 fuentes externas independientes de IOL que nombran la emisión puntual), **consistente** (ficha de IOL coincide en
vencimiento/tasa y la TIR con el precio de mercado es plausible: ~4–12 % en ON, hasta ~14 % en soberanos; a menos de 3 meses, precio dentro de ~4 %
del pago restante), **revisar** (TIR atípica sin contradicción directa), **inconsistente** (evidencia en contra), **sin_verificar** (default).
NUNCA subir a `primaria` sin leer el aviso/suplemento/flujo; NUNCA a `secundaria` con una sola fuente. El maestro de IOL solo detecta
discrepancias: corregir exige una segunda fuente.

Prioridad: (1) bonos en cartera (`posiciones.tipo='bono' and cantidad>0`), (2) `inconsistente`, (3) `revisar`, (4) `sin_verificar`; dentro de cada
grupo, `verificado_en` más viejo o null primero. Lo que no entra queda para el mes siguiente (reportarlo). Por ticker: `get_asset_info`
(clase, tasa, vencimiento, «$» = pesos) → `get_fixed_income_analytics` (`dirty_price`, `yields.tir`; `not_found` = sin precio) → WebSearch del emisor + clase +
tasa + vencimiento. Sin evidencia nueva, no cambiar el nivel. Escribir:
`update public.bonos_referencia set verificacion='<nivel>', verificacion_nota='<nota>', verificado_en=date '<hoy>' where ticker='<T>';`
(`sin_verificar` → `verificado_en = null`). Una ON en pesos o que no corresponde NO se borra (el DELETE se cuelga): queda `inconsistente` con nota.
Pendientes de notas: reintentar UNA vez las filas con `verificacion_nota is null` (las 21 `secundaria`) y las de TY37D, TY38D, BNCXD, TLCTD, MGCRD, YM42D, YM41D, MGC1D.

## Parte E — Altas (enero, abril, julio, octubre; máx. 15 tickers)

Solo INSERT con `on conflict (ticker) do nothing`; nunca modificar filas existentes. Candidatos, en este orden: (1) bonos en cartera que faltan en el catálogo;
(2) `with t as (select ticker from public.precios_cache), bases as (select left(ticker,length(ticker)-1) base from t where ticker ~ '^[A-Z0-9]{3,6}D$'
intersect select left(ticker,length(ticker)-1) from t where ticker ~ '^[A-Z0-9]{3,6}C$') select base||'D' from bases where base||'D' not in
(select ticker from public.bonos_referencia) order by 1;` (muchos dan 404 en IOL: es normal). Filtros: cashflow cierra en 0 exactamente en `maturity_date`; vence a
> 30 días; BOND o NOTE; TIR entre −5 % y 60 %; moneda USD (`get_asset_info`, sin «$»); la descripción de `get_asset_info` coincide con el vencimiento
de las analytics (si no, IOL mapeó OTRA emisión, como TLCUD). **Verificación obligatoria** contra una fuente que nombre la emisión puntual (tasa,
frecuencia, emisión, vencimiento, amortización); si IOL coincide → cronograma de IOL, `fuente='IOL'`, `verificacion='consistente'` o `secundaria` según
la evidencia; si difiere o IOL no tiene analytics pero la fuente es clara → cronograma por script con `fuente='IOL | corregido …'`; sin fuente → NO cargar,
reportar como pendiente. Bono de cartera que falta: avisar con prioridad. No tocar `vol_*` (los llena la Parte C del mes siguiente).

## Parte F — Bienes Personales (enero a abril)

Tabla `public.impuestos_parametros` (anio, clave, valor, estimado, verificado, fuente): `bp_params` = `{"minimoNoImponible": ARS, "casaHabitacion": ARS}`, `bp_escala` =
`{"tramos":[{"hasta": tope del excedente o null, "fijo": ARS, "alicuota": fracción}]}`. A = año actual − 1. Si ya existen las dos claves de A con
`estimado=false` y `verificado=true` → "sin cambios" y pasar al recordatorio. Si no: WebSearch de la tabla de ARCA del período A (arca.gob.ar / afip.gob.ar
primaria; blogdelcontador, errepar, cpba, iprofesional como secundarias; exigir que sea el período A, no el anterior). **Validar**: ≥ 2 fuentes coinciden en cada
cifra; escala continua (fijo₂ = alícuota₁×tope₁; fijo₃ = fijo₂ + alícuota₂×(tope₂−tope₁), ±0,05); el mínimo de A entre 1,0× y 2,5× el de A−1 (cuentas con SQL/Node).
Si falla algo, NO cargar y explicar. Cargar con upsert (una sentencia por fila): `insert into public.impuestos_parametros (anio,clave,valor,estimado,verificado,fuente,actualizado)
values (A,'bp_params','<json>'::jsonb,false,<V>,'<fuente>',now()) on conflict (anio,clave) do update set valor=excluded.valor, estimado=false,
verificado=excluded.verificado, fuente=excluded.fuente, actualizado=now();` y lo mismo para `bp_escala`. `verificado=true` SOLO si se leyó la publicación de ARCA
misma. Nunca tocar años distintos de A. Reportar la diferencia contra la fila estimada por IPC (> 3 % es anomalía). Recordatorio (solo lectura): `select nombre,tipo,valor_ars,base,
fecha_valuacion from public.patrimonio_otros order by nombre;` — si un vehículo no tiene base `valuacion_arca` o su fecha es anterior al 31/12 de A, recordar actualizar con la tabla de
automotores de ARCA. Si en enero ARCA aún no publicó: decirlo y no cargar nada (se reintenta al mes siguiente).

## Parte G — Control del cron de INDEC (solo noviembre)

El paso 4c de `refresh-all` (`functions/api/_impuestosParametros.ts`) pide el IPC de octubre a INDEC (sale a mediados de noviembre) y guarda la fila **estimada** del año.
`select anio, clave, estimado, left(fuente,60) from public.impuestos_parametros order by anio, clave;` Debe existir `anio = año actual`, `estimado = true`, para `bp_params`
y `bp_escala`. Si no existe: reportar (y revisar el log del cron). Nunca crear la fila a mano.

## Reporte

Un solo mensaje en español: por parte (qué se hizo, qué se saltó por falta de trabajo), cambios de datos con su fuente, filas protegidas salteadas y si IOL sigue
difiriendo, anomalías R3, escrituras canceladas, bonos de cartera no confiables o faltantes (primero), pendientes por topes, y el conteo final por nivel.
