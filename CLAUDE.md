# Portfolio de Inversiones — CLAUDE.md

Instrucciones persistentes para Claude Code en este proyecto.

## Proyecto

App web personal (un usuario) de seguimiento y análisis de un portfolio de inversiones:
CEDEARs, bonos/ONs, ETFs. Valuación DCF por Owner Earnings (Buffett/Munger), fundamentals
desde SEC EDGAR, contexto macro con semáforos, análisis cualitativo con Gemini. Multi-portfolio
con aislamiento total por usuario.

La app vive en `migration/` (React+Vite+Tailwind+react-query). Deploy: Cloudflare Pages
(proyecto `portfolio-inversiones`) + Pages Functions. Backend: Supabase (proyecto
`wyedmgxngqdgnxmbencl`), Auth + RLS por `auth.uid()`. Rama de desarrollo:
`claude/github-pages-compatibility-b6bdl6`.

> El historial anterior a este proyecto corresponde a una app del Mundial que fue reemplazada.
> Queda en el historial de git.

## Reglas de oro

1. **Los NÚMEROS los calcula el código; la IA (Gemini) solo interpreta lo cualitativo.** Nunca
   dejar que un LLM calcule un ratio o un DCF — alucina aritmética.
2. **Ningún secreto en el repo ni en el browser.** Claves de mercado/IA en Pages Functions
   (`wrangler pages secret put`). Frontend solo con `VITE_*` públicas (protegidas por RLS).
3. **Aislamiento entre portfolios** (requisito #1): todo cuelga de `portfolio_id` vía
   `owns_portfolio()`. Verificar con datos de prueba que no se contamina entre portfolios.
4. **Solo lectura de mercado — dentro de la app.** La app web (Cloudflare Pages) y sus Pages
   Functions nunca ejecutan órdenes; solo leen precios/fundamentals de mercado. **Excepción
   intencional y acotada** (vigente desde 2026-09, Plan Maestro Herencia): fuera de la app, en
   sesiones de Claude Code con el conector MCP de IOL conectado, sí se preparan y ejecutan órdenes
   de compra reales sobre la cuenta de IOL — siempre con el usuario confirmando cada orden antes de
   cargarla (nunca 100% desatendido). Esto incluye una Routine semanal (Plan Maestro Herencia,
   cuotas de CEDEARs) que prepara y valida órdenes con datos reales del día y espera confirmación
   humana antes de ejecutar cualquier cosa. La regla de "solo lectura" sigue aplicando estrictamente
   a lo que la APP EN SÍ (el código de este repo desplegado) puede hacer — no cambia el objetivo #4
   de solo-lectura del producto, es un workflow externo de operación manual/supervisada.
5. Priorizar corrección de cálculos sobre features vistosos.

## Decisiones del usuario (vigentes — no cambiar sin pedido explícito)

- **Retorno presupuestado: 8% anual en TODOS los portfolios, mandatorio.** Es una estimación conservadora del S&P 500 y
  una meta deliberadamente conservadora: el usuario no quiere fijarse una meta que supere al índice porque eso lo empuja a
  tomar riesgos de inversión que luego lamentaría. No subirlo (ni en el presupuesto ni en los supuestos de Forecast) aunque
  el rendimiento histórico o los `tir_esperada` por posición sean mayores; la palanca para llegar a una meta es el aporte, el
  plazo o la meta misma, no el retorno.
- **Ahorros: aporte obligatorio de US$200/mes (US$2.400/año)** = el aporte presupuestado. Lo aportado por encima es extra
  voluntario; el forecast nunca asume menos que lo comprometido.
- **8% de presupuesto ≠ retorno esperado por posición (margen de seguridad, Graham).** El 8% es la vara conservadora de
  planificación; al armar el portfolio el usuario apunta algo más alto (`tir_esperada` por posición, "TIR objetivo" de la
  estrategia) para tener margen de error, y luego compara el resultado real contra el 8%. No es una incoherencia: no
  "alinear" los `tir_esperada` al 8% ni el 8% a ellos.
- **Horizonte de Ahorros: 45 años** (2026-01 a 2070-12), decisión del usuario: la meta de US$1.000.000 llega en 2068 con
  US$200/mes y 8% (mínimo 43 años), y los 2 años extra son margen. Herencia: 30 años (meta US$300.000, llega en 2053).
- El presupuesto de cada portfolio debe tener el mismo período que "Rendimiento por año" (año calendario) para que los %
  coincidan: Ahorros desde 2026-01 con el valor de cierre de 2025.

## Notas de datos (catálogo de renta fija)

- `bonos_referencia` se alimenta de IOL y **no es fuente primaria**: el 2026-10-10 se encontraron 11 cronogramas equivocados
  (TLCUD era otra emisión; MIC3D y CS51D con cupón/frecuencia errados; 8 ON de 2026 —BF48D, RC5CD, TLCWD, OLC6D, SIC2D,
  NPCED, TTCED, IRCQD— con **cupón a la mitad: IOL calcula tasa/4 sobre fechas semestrales**). Se corrigieron a mano con el
  aviso de resultados / suplemento y quedaron marcados en `fuente` ("IOL | corregido …"). Sin corregir por falta de fuente:
  YM40D, YM41D y TLCMD (flujos faltantes), TLCTD (nombre y datos no coinciden), MGC1D (el Eurobond Pampa 7,5% 2027 fue rescatado). TTCAD (Tecpetrol 7,625% 2033) quedó SIN cargar: IOL lo muestra amortizable (33/33/34% desde 2031) y las fuentes públicas lo describen bullet; verificar antes de cargarlo. Esas filas están **protegidas en dos niveles**:
  (1) el trigger `bonos_referencia_proteger_corregidos` (migración 0051) conserva cronograma/emisión/vencimiento/amortizable/
  valor_residual/fuente si alguien las actualiza sin cambiar la marca — para corregir de nuevo a propósito hay que escribir
  una `fuente` nueva que también empiece con "IOL | corregido"; (2) la Routine mensual ("Actualización mensual integral
  bonos_referencia") tiene las reglas R1–R4: saltea las filas corregidas, verifica cada emisión nueva contra el aviso de
  resultados/suplemento antes de cargarla y reporta anomalías de coherencia del catálogo.
- **Altas al catálogo (3 caminos):** (1) Routine "Alta de tickers nuevos…" (trimestral: día 8 de ene/abr/jul/oct, máx. 15 por corrida; el 2026-10-10 se sondearon los 135 candidatos de mercado y solo 1 pasó los filtros de IOL, así que no hace falta más frecuencia; solo INSERT
  `on conflict do nothing`, verificada contra el aviso de resultados; prioriza bonos que algún portfolio tiene y no están en el
  catálogo); (2) la Routine "Actualización mensual integral…" (cada 4 semanas) **ya no agrega tickers**, solo mantiene los
  existentes; (3) **alta a demanda**: si se quiere un bono puntual (o IOL no tiene analytics, como COC4D/AEC3D), pedirlo en una
  sesión → buscar el aviso de resultados/suplemento, generar el cronograma por script (cupón = tasa ÷ frecuencia) y cargarlo con
  `fuente` = "IOL | corregido AAAA-MM-DD: …" para que quede protegido. Un bono que se compra y no está en el catálogo debería
  cargarse en el momento.
- El cron (`refresh-all`) sugiere los cupones con la **fecha exacta del cronograma** cuando está vigente; si no hay cronograma,
  cae al cálculo por mes (día 1) con los campos cargados en la posición.

## Medición de desempeño a 10 años (migración 0053)

Objetivo: poder responder con datos reales (1) rentabilidad anualizada en USD con dividendos y neta de costos, (2) comparación contra
el S&P 500 con los mismos flujos y moneda, (3) máxima caída vs. benchmark. Lo que no se registra hoy no se recupera mañana.

- **Snapshot diario en el servidor**: el cron `refresh-all` (paso 4b, `functions/api/_snapshots.ts`) graba `portfolio_snapshots`
  todos los días (`fuente='cron'`, `detalle` con ticker/cantidad/valor). Solo si TODAS las posiciones abiertas tienen precio fresco
  (≤ 5 días); un valor a medias nunca se graba. `accion_ar` no se valúa en el servidor (carteras con acciones locales quedan sin snapshot del cron).
- **Dólar diario**: el cron guarda MEP/CCL en `fx_historico`. Al cargar ejecuciones, completar `ordenes_ejecutadas.mep` con el MEP
  del día de ejecución (de `macro_cache` `dolar_mep` / `fx_historico`); sin MEP la comisión en pesos se muestra sin convertir (nunca estimada).
- **Motor** `engine/desempeno.ts` (puro, testeado): índice TWR que neutraliza aportes/retiros, anualiza solo con ≥ 365 días, máxima
  caída con fechas de pico/mínimo/recuperación (con huecos > 7 días es un "mínimo conocido", rotulado "≥"), benchmark SPY (adjclose =
  retorno total) con los mismos flujos, TIR neta de comisiones convertibles. **Ventana única**: todo se mide desde el primer valor diario (ese valor es el capital inicial; solo cuentan aportes/retiros posteriores); el primer aporte importado de la planilla no entra si es anterior. Tramos donde el snapshot quedó desfasado de un aporte se
  difieren y se resuelven contra el valor siguiente (juntos suelen dar un retorno normal); solo los que nunca se resuelven se cuentan como anomalía. UI: página `Desempeño` (`/desempeno`, `pages/DesempenoPage.tsx` + hook `useDesempeno`) con las 3 preguntas; alerta en el Dashboard si el cron deja de grabar (`engine/snapshotServidor.ts`). SPY: `/api/market/sp500-anual?desde=` (no se guarda: el adjclose se reajusta retroactivamente).
- **Simplificación del rendimiento (2026-10-18)**: el rendimiento se ve en UN solo lugar, `/desempeno`, con UN % de cabecera: la **ganancia sobre el capital aportado** (coincide con el P&L en USD; el S&P 500 se compara en la misma base con tus mismos flujos). Tablero clásico: 4 números (patrimonio, ganancia, contra el S&P 500, máxima caída) + gráfico «Evolución» (cartera vs capital aportado vs el S&P 500 con tus mismos aportes, `evolucion()` en `engine/desempeno.ts`) + «Vs S&P 500» por año calendario + «Más indicadores» plegado (ponderado por tiempo, anualizado, TIR, TIR neta, costos). **Aportes** (`/aportes` y su tarjeta de Inicio) ya NO muestran rendimiento: solo movimientos de capital (aportado/retirado/neto). Forecast conserva «Presupuesto vs real» (necesita el % por año calendario, `useRendimientoAnual`/`porAnio`); la tabla «Vs S&P 500» pasó de Forecast a Desempeño.
- **Ganancia desde el inicio (decisión del usuario, 2026-10-18)**: la «Ganancia» (Inicio y Desempeño) se mide DESDE EL PRIMER APORTE: valor + retiros − aportes brutos (`desdeInicio` en `engine/desempeno.ts`, no depende de la serie diaria). Ahorros: +US$ 2.453,64 (+12,0 % sobre lo aportado) desde 2025-06-02, de los cuales −508,54 son desde el primer valor diario (2025-12-31) y +2.962,18 vienen del tramo previo (dato de la planilla, sin valores diarios). Lo que necesita serie diaria (contra el S&P 500, máxima caída, gráfico, ponderado/TIR) se mide desde el primer valor diario y la pantalla lo dice (nota «ventanas distintas»). Herencia: ambas ventanas coinciden (+172,83).
- **Una sola «Ganancia» (2026-10-18)**: Inicio (hero) y Desempeño muestran la MISMA ganancia = valor + retiros − capital puesto (aportes brutos, con comisiones; incluye dividendos y ventas), medida desde el primer valor diario (`tir.gananciaUsd`; sin serie diaria, Inicio cae a valor − aportado desde el inicio). El antiguo «P&L total» de Inicio (contra el COSTO de las posiciones: sin comisiones y sumando renta que no está en el valor) se eliminó del hero; en Posiciones queda como «P&L de posiciones» (no realizado + realizado + renta, por activo, contra el precio de compra) solo para comparar activos entre sí. Si alguien pregunta por qué difieren: ganancia desde el inicio vs desde el primer valor diario + comisiones + renta no acreditada (Ahorros: −508,54 vs +2.730,54; Herencia: +172,83 vs +261,55).
- **Coherencia Aportes ↔ Desempeño (2026-10-18)**: son DOS lecturas del mismo dinero. «Rendimiento por año» (Aportes, y su resumen en Inicio) = Modified Dietz sobre el capital de cada año calendario; «Desempeño» = ventana desde el primer valor diario con TWR, TIR, S&P 500 y máxima caída. Los % pueden diferir por el método (Ahorros 2026: −4,0 % Dietz, −5,5 % ponderado, −2,2 % sobre el capital aportado), pero la **ganancia en dólares es la misma** cuando el período coincide (Ahorros −508,54; Herencia +172,83) — Desempeño la muestra como «Ganancia en USD» (`tir.gananciaUsd`). Regla de ventana: si el primer aporte es ≤ 14 días anterior al primer valor diario (cartera recién creada: Herencia) los aportes son el capital inicial; con una brecha grande (Ahorros: 06/2025 vs 12/2025) el primer valor reemplaza a los aportes previos. Inicio tiene la tarjeta «Desempeño» (sección `desempeno`: ganancia, vs S&P 500 y máxima caída, con `useDesempeno`) además de «Rendimiento por año / Aportes».
- **Órdenes y costos** (migración 0054): página `/ordenes` (`pages/OrdenesPage.tsx`, motor `engine/ordenes.ts`): lista las órdenes (`ordenes_ejecutadas`), costos por mes y CONTROLES (sin comisión, sin MEP, monto ≠ nominales × precio, comisión > 1 %, y conciliación contra los movimientos de compra por (fecha, ticker) — el CEDEAR "MAD" concilia con la posición "MA"). Se cargan a mano ahí, o al agregar una posición (bloque opcional «Costos de la orden» en `AgregarModal`: crea la orden vinculada al movimiento y puede descontar la comisión USD de la Liquidez). Las órdenes de IOL siguen cargándose por sesión (SQL) con `mep` del día. Solo cuentan las órdenes `terminada`. La app no ejecuta órdenes (regla #4).
- **Costos de los cobros** (migraciones 0055 y 0056, `engine/costosCobros.ts`, `components/CostosCobroEditor.tsx`, tarjeta «Costos por broker» en `/brokers`): el cron sugiere dividendos/cupones BRUTOS y IOL acredita el neto. **Tres capas, no todas dependen del broker:** (1) retención de EE.UU. 30 % (universal, sin convenio); (2) comisión del banco depositario del CEDEAR (la fija Caja de Valores en cada anuncio de dividendo, no el broker; ≈ 5,5 % del bruto en tus pagos de IOL: UNH/MSFT/MA acreditados al 64–65 %); (3) comisión del BROKER sobre el pago (la única que cambia de broker; IOL tiene dato propio cargado: ≈ 0,72 % en dividendos y ≈ 0,45 % en cupones; un broker SIN dato —Santander, BBVA, posición sin broker— usa 1 % por decisión del usuario hasta que cargue la suya; no se encontró el tarifario del plan Black). Los cupones de ON locales no tienen retención ni depositaria. Las tasas se editan por broker (`brokers.retencion_dividendo/comision_depositaria/comision_cobro_dividendo/comision_cobro_interes/comision_operacion`, null = general) y una posición repartida entre brokers usa el promedio ponderado por cantidad. Al confirmar un cobro pendiente o registrar uno manual el neto estimado queda tildado y editable: `cobros.monto` = lo acreditado (neto; lo leen el P&L, la Liquidez y el rendimiento) y `monto_bruto`/`retencion_usd`/`comision_usd` (depositaria + broker)/`costos_estimados` guardan el detalle. Las filas anteriores a 0055 quedan con costos null (monto = declarado). El dato real (`get_activities` de IOL: neto en US$ + débito en $) siempre pisa la estimación. La pestaña Proyectado muestra el neto estimado con las tasas generales. `comision_operacion` es referencia (BBVA 1,148 % real de tus boletos: gastos 0,0605 % + comisión 0,8985 % + IVA sobre la comisión).
- **Costo estimado de comprar y vender** (migración 0057 `ordenes_ejecutadas.lado`, `engine/costosOperacion.ts`, `components/ComisionOperacion.tsx`): al agregar una posición, ejecutar una simulación de compra o vender, la comisión se calcula sola (monto × `brokers.comision_operacion` del broker principal de la posición; sin dato = 1 % general por decisión del usuario; IOL 0,67 % observado en tus órdenes en pesos; BBVA 1,148 % real de tus boletos) y queda a la vista y editable ANTES de guardar; nada se registra hasta confirmar. Tildado por defecto «Registrar la orden con su comisión»: deja la orden en `ordenes_ejecutadas` (`lado` compra/venta, nota «Comisión estimada (x %)» o «cargada a mano») y, si se pide, descuenta la comisión de la Liquidez (en compras junto con el costo; en ventas, de lo acreditado) — destildar si el saldo ya la descontó para no contarla dos veces. Las ventas se concilian contra los movimientos de venta. El boleto real siempre pisa la estimación.
- **Órdenes estimadas y aportes brutos (2026-10-18)**: las operaciones sin boleto ni dato del broker (saldo de Santander de Ahorros: GOOGL, MRK, UNH 113, LAC 202, MELI 11; compras/ventas de YM41D) se cargaron como órdenes con `origen='estimada'` (comisión 1 % general (brokers sin dato), fecha aproximada, marcadas «estimada» en `/ordenes` y con un aviso informativo); se reemplazan por datos reales cuando existan. Los aportes de Ahorros se llevaron a BRUTO con dos filas «Ajuste a bruto…» (US$ 79,67 el 2025-06-02: comisiones del saldo inicial; US$ 18,48 el 2026-06-01: YM41D). Conciliación de Ahorros: aportado − costo de las posiciones = comisiones incluidas en los aportes − ganancia retirada (YM41D) − dividendos acreditados en Liquidez (14.532,78 − 14.401,04 = 194,70 − 36,96 − 26,01). Herencia: aportes = depósitos reales de IOL (40.000 con el traspaso de COC4D) y la Liquidez coincide con el saldo en USD de IOL. Ventas de YM41D: retirado US$ 3.838 de US$ 4.488 (US$ 650 quedaron en Liquidez).
- **Traspasos entre portfolios llevan el costo de la orden** (decisión 2026-10-18, caso COC4D Ahorros → Herencia): una transferencia es una reasignación del lote, no una venta a mercado, así que viaja con su historia completa. El portfolio de origen registra el retiro por el costo BRUTO del lote (precio + comisión) y el destino el aporte por el mismo monto (la comisión queda como costo del destino: aporte bruto, posición al precio sin comisión); la orden original (`ordenes_ejecutadas`) pasa al portfolio destino. COC4D: retiro en Ahorros y aporte en Herencia de US$ 2.010 (2.000 + 10 de comisión) y la orden 183829050 en Herencia. Los controles ignoran las entradas por transferencia y las compras de posiciones que salieron por traspaso. **Automatizado** (Transferencias → «Llevar también el costo de las órdenes», tildado por defecto; `engine/trasladoCosto.ts`, `useTransferirPosicion`): después de `transferir_posicion` se traslada la fracción de las comisiones de las órdenes de compra de esa posición (cantidad ÷ cantidad que tenía): las órdenes del origen bajan, el destino recibe una orden `origen='transferida'` (solo registra el costo; no se concilia), y se anotan un retiro en el origen y un aporte en el destino por ese monto. Es ATÓMICO: `transferir_posicion_con_costo` (migración 0058) hace la transferencia y aplica el plan que calcula el motor en una sola transacción (todo o nada). Destildarlo si la transferencia es una venta entre carteras a valor de mercado.
- **Impuestos (2026-10-20)**: página `/impuestos` (`pages/ImpuestosPage.tsx`, hooks `useImpuestos` y `usePatrimonioOtros`, componentes `OtrosBienes` y `SimuladorBP`, motor puro `engine/impuestos.ts` testeado) + aviso en el Dashboard (`AlertaImpuestos`). Mide los DOS portfolios JUNTOS más los «Otros bienes» (la persona es una). Perfil del usuario (2026-10-20): relación de dependencia, nunca presentó DDJJ, sin inmuebles ni otros activos, solo el auto; se prepara para cuando el patrimonio crezca. (1) **Bienes Personales (calcula)**: patrimonio total (portfolios con liquidez y bonos, así la alerta no depende de ninguna exención, + `patrimonio_otros`) en pesos al MEP de hoy vs. el mínimo no imponible de ARCA ($ 384.728.044,57 para 2025, `BIENES_PERSONALES`) y el impuesto estimado con la escala sobre el excedente (`ESCALA_BP`, 2025: 0,5 % hasta $ 52.664.283,73 de excedente; 0,75 % hasta $ 114.105.948,16 con fijo $ 263.321,42; 1 % más allá con fijo $ 724.133,89 — la tabla sale de fuentes profesionales que coinciden y cierra aritméticamente, no del PDF de ARCA). Agregar la fila del año nuevo de ambas tablas cuando ARCA la publique (enero-febrero); sin fila usa la última conocida y lo marca estimado, que es conservador (el mínimo sube por IPC; la ley baja las alícuotas a 0,5–0,75 % en 2026 y 0,25 % en 2027, tramos aún sin publicar). Escala de «cumplidores» NO cargada: no presentó nunca. Alertas: ≥ 80 % del mínimo warn, ≥ 100 % neg. El simulador «¿Y si tu patrimonio fuera…?» sirve para planificar. «Probable gravable» (sin bonos/ONs ni acciones locales) es una hipótesis informativa. (2) **Otros bienes** (`patrimonio_otros`, migración 0059, RLS por `auth.uid()`): cada uno con su base de valuación; solo `valuacion_arca` (tabla oficial de ARCA al 31/12, «valor mínimo de automotores») es el valor que cuenta para el impuesto, el resto se marca provisorio. La casa-habitación entra solo si supera el umbral de exención (y completa). Auto cargado: Volkswagen T-Cross 2021 Comfortline AT, $ 27.000.000 por el seguro (PROVISORIO: falta el valor de la tabla de ARCA). (3) **Ganancias (solo informa)**: dividendos del exterior por año (bruto, retención de EE.UU., acreditado) de los cobros confirmados; los 15 cobros de 2026 están sin bruto/retención cargados (monto = neto), así que el «bruto» está subestimado; la compraventa de CEDEARs se toma como exenta (mayoría de las fuentes, sin confirmar) y por eso la app no descuenta impuesto al vender. (4) Calendario de DDJJ (`VENCIMIENTO_DDJJ`: 2025 → 2026-07-27, RG 5851/2026; años sin fila = fines de junio estimado). **Sin confirmar con contador**: alícuota de dividendos (escala vs. 15 %), crédito por el 30 % de EE.UU., si los CEDEARs integran Bienes Personales, trato de bonos/ONs. **Parámetros automáticos (Fase 3, migración 0060 `impuestos_parametros`)**: no existe API pública de ARCA para mínimos/escalas, pero esos valores se actualizan por el IPC de octubre contra octubre (control con datos reales: período 2024 $ 292.994.964,89 × 1,3131 ≈ período 2025 $ 384.728.044,57). El cron `refresh-all` (paso 4c, `functions/api/_impuestosParametros.ts`) pide a INDEC (API de series de tiempo de datos.gob.ar, serie `148.3_INIVELNAL_DICI_M_26`) el IPC cuando ya salió octubre (mediados de noviembre), escala la fila OFICIAL del año anterior y guarda el año en curso con `estimado=true`; nunca pisa una fila oficial ni acumula estimaciones, y no toca las alícuotas. Para cargar la oficial cuando ARCA publique (enero-febrero): `upsert` en `impuestos_parametros` con `estimado=false` (y `verificado=true` si se contrastó con la tabla de ARCA) para `bp_params` y `bp_escala`, o agregar la fila a `BIENES_PERSONALES`/`ESCALA_BP`; la oficial de la base pisa a la del código. Las dos filas 2025 sembradas quedan `verificado=false` (salen de fuentes profesionales). La app muestra si el mínimo es oficial, estimado por IPC o el último conocido. **El paso 4c no se probó contra INDEC real** (desde el sandbox de Claude no se pueden abrir esos sitios): la primera prueba real es la corrida del cron de mediados de noviembre de 2026; si falla, la app sigue con el último conocido. Pendiente: rutina anual de enero para cargar la tabla oficial de ARCA (incluida la valuación de autos al 31/12). Hoy: patrimonio ≈ US$ 54 mil en portfolios + $ 27 M del auto ≈ 29 % del mínimo; Bienes Personales estimado $ 0.
- **Límites honestos**: la historia previa a 2026 no está registrada (huecos de hasta 205 días en Ahorros); no se reconstruye ni se estima.
- **Hoja de ruta**: (a) registrar todos los eventos (aportes, retiros, trades, cobros, comisiones) y acreditar los cobros a Liquidez de
  forma consistente; (b) conciliación mensual contra el resumen del broker; (c) export/backup anual de snapshots y eventos; (d)
  registrar comisiones de Ahorros; (e) si hace falta, reconstruir el pasado desde extractos del broker.

## Backup / Restore (arquitectura)

Todo sale de UN registro: `migration/src/lib/backupTablas.ts` (`BACKUP_TABLAS`, `TABLAS_EXCLUIDAS`, `REFERENCIAS`, `BACKUP_VERSION`, hoy **v12**). `backup.ts` (exportar), `restore.ts` (restaurar), `backupParse.ts` (preview, avisos, checksum, huérfanos) y la UI de Config leen de ahí; no hay listas propias.

- **Exportar** (`buildBackup`): JSON con `select('*')` por cliente (la RLS limita a los datos del usuario), paginado de a 1000 con orden estable, leyendo de HIJOS a PADRES (un registro creado durante la exportación nunca queda huérfano) y con checksum SHA-256 de `tables`. `partial` + `errores` quedan en el archivo.
- **Restaurar** (`restoreBackup`): MERGE por `upsert(onConflict)` en orden PADRES → HIJOS; `user_id` se re-mapea al usuario actual (por eso un backup de otra cuenta entra en la tuya); lotes de 400 con reintento fila por fila; errores sistémicos (RLS/columna inexistente) cortan la tabla; verificación posterior por conteo. Las tablas `restaurable: false` solo se exportan (se escriben por RPC o servidor: `transferencias`, `analisis_ia`).
- **Agregar una tabla**: (1) entrada al final de su sección respetando FKs, (2) `desde` = `BACKUP_VERSION` nueva (subirla), (3) `avisoSiFalta` si el usuario pierde algo recreable a mano, (4) FKs en `REFERENCIAS`, (5) actualizar los tests (`backupTablas.test.ts` falla si el orden rompe una FK, si falta `desde` o si cambia el set de tablas por usuario). Si la tabla es de mercado/global, va a `TABLAS_EXCLUIDAS` con el motivo.
- **Módulo de Órdenes**: `ordenes_ejecutadas` (v10) con todos sus orígenes (`api`/`manual`/`estimada`/`transferida`), `lado`, `mep` y la comisión en USD/ARS. Se restaura DESPUÉS de `portfolios` y `movimientos`; su vínculo opcional `movimiento_id` está en `REFERENCIAS` (v12), así un archivo con una orden cuyo movimiento falta se informa antes de restaurar. Las operaciones que crean órdenes por RPC (`transferir_posicion_con_costo`) no necesitan tabla propia.
- **Módulo de Impuestos**: `patrimonio_otros` (v12), de la PERSONA (`user_id`, sin `portfolio_id`), restaurable y re-mapeada al usuario actual. NO se respalda lo calculado (Bienes Personales, dividendos por año: salen de portfolios + cobros + estas filas) ni los parámetros de ARCA (viven en el código, `engine/impuestos.ts`). La tabla global de parámetros que escribe el servidor (`impuestos_parametros`) está en `TABLAS_EXCLUIDAS`.
- **Excluidas a propósito**: caches de mercado, catálogos globales (`bonos_referencia`, `cedear_ratios`, `edgar_ticker_cik`), `fx_historico` (el MEP que importa queda copiado en `ordenes_ejecutadas.mep`), `impuestos_parametros` (los regenera el servidor), administración y las tablas de la app vieja del Mundial.
- El backup se descarga a mano desde Config (no hay automático); hoja de ruta (c) cubre el export anual.

## Archivos clave

| Archivo | Descripción |
|---|---|
| `migration/src/engine/dcf.ts` | Owner Earnings + DCF + sensibilidad + chequeos Munger (puro, testeado) |
| `migration/src/engine/ratios.ts` | Ratios fundamentales (P/E, ROIC, EG5Y real, WACC) |
| `migration/src/engine/semaforos.ts` | Umbrales macro del dashboard |
| `migration/functions/api/_edgar.ts` | EDGAR: CIK, conceptos XBRL, parseo (vía proxy SEC) |
| `migration/functions/api/_shared.ts` | CORS + cache Supabase (service-role) |
| `migration/supabase/migrations/0001_portfolio_schema.sql` | Schema + RLS |

## Test / build

`cd migration && npm test` (motor) · `npm run build` (app) · `npx tsc -p functions/tsconfig.json` (Functions).
