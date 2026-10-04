# Auditoría QA — modificaciones recientes (2026-10-04)

Alcance: presupuesto/Forecast (motor, página, tarjeta del Inicio), backup v11, scroll de diálogos y CSS de
fechas, resumen de textos. Lentes: QA funcional + datos (subagente), datos/seguridad del backup (subagente),
UX/textos y CSS (propia). Cada hallazgo se verificó releyendo el código; los de permisos, además, contra la base.

| ID | Sev. | Dónde | Hallazgo | Estado |
|---|---|---|---|---|
| B1 | ALTA | backup.ts | Paginación de a 1000 sin `order`: filas repetidas/salteadas y el checksum salía "verificado" | Corregido: orden por la clave de cada tabla + test |
| B2 | ALTA | backupTablas.ts | `analisis_ia` es SELECT-only para el cliente (RLS 0022) pero figuraba restaurable: toda restauración fallaba lote a lote y reintentaba fila por fila | Corregido: solo exportable (verificado en pg_policies) |
| B3 | MEDIA | restore.ts | Fallback fila por fila sin tope ni corte ante error de toda la tabla (backup viejo con `broker_id`, RLS) | Corregido: corta por código sistémico y por 5 fallos seguidos; descarta `broker_id`; cuenta total |
| B4 | MEDIA | restore.ts | Verificación por conteo sobre toda la tabla (falsos negativos) y "verificado ✓" aunque el conteo fallara | Corregido: conteo acotado a portfolios/posiciones del backup; `verificacionCompleta`; texto "conteos coinciden" |
| B5 | MEDIA | ConfigPage.tsx | Checksum distinto solo avisaba | Corregido: segundo check explícito |
| B6 | MEDIA | restore.ts / ConfigPage | Backup de otra cuenta en la misma base: todo rechazado fila por fila | Corregido: corta por RLS + aviso en el preview |
| B7 | BAJA | backupParse.ts | Huérfanos repetían el aviso de backup incompleto | Corregido |
| F1 | MEDIA | presupuesto.ts | Modo "ritmo" contaba el mes en curso como entero | Corregido: fracción del mes; <1 mes → presupuestado |
| F2 | MEDIA | presupuesto.ts | Mes en curso comparado contra el presupuesto de fin de mes completo (desvío artificialmente negativo a principios de mes) y reproyección que perdía el resto del mes | Corregido: presupuesto prorrateado, cierre de mes proyectado + tests |
| F3 | MEDIA | ForecastPage / PresupuestoVsReal | Mientras cargaba (o si fallaba la lectura) se ofrecía "Fijar presupuesto": podía pisar el existente | Corregido: estados cargando/error |
| F4 | MEDIA | ForecastPage / DashboardPage | Cifras con patrimonio 0 y "sin datos" engañoso durante la carga | Corregido |
| F7 | BAJA | PresupuestoVsReal | Se congelaban supuestos inválidos (retorno ≤ −100%, 0 años) | Corregido: validación |
| F8 | BAJA | Forecast | Signo sobre valor sin redondear ("−US$0") | Corregido (`signo`, `signoK`, `fmtPctSigno`) |
| F6 | BAJA | useProyeccionInputs | Invalidación sin await: se veía el estado viejo tras guardar | Corregido |
| T1 | MEDIA | DashboardPage | Resumen de textos dejó sin espacio "no es renta):US$…" | Corregido |
| T2 | BAJA | AnalisisPage | El resumen perdió que la tasa libre de riesgo del Ke es real | Corregido |
| U1 | BAJA | PresupuestoVsReal | "Rehacer" no precargaba el presupuesto existente | Corregido |
| X1 | BAJA | gráfico/tarjeta | Efecto de mi arreglo F2: la línea de presupuesto bajaba en el mes parcial y el tile decía "a oct 26" con valor prorrateado | Corregido en la segunda pasada |

## Pendiente / aceptado
- F5 (BAJA): leer-mezclar-escribir de `proyeccion_inputs` no es atómico (dos pestañas escribiendo en la misma fracción de segundo).
- F9 (BAJA): "hoy" es UTC en toda la app; entre las 21:00 y las 24:00 (UTC−3) del último día del mes ya cuenta como mes siguiente.
- La verificación posterior del restore sigue siendo un conteo (no compara fila a fila).

Verificación: tsc app + functions sin errores; 683 tests (todos pasan; 17 nuevos: motor mes parcial, restore, backup);
build OK. Sin fallos preexistentes.
