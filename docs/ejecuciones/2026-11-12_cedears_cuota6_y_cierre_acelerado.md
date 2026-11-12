# Ejecuciones IOL del 2026-11-12 (Herencia) — registradas en la base

Fuente: `get_activities` de IOL (datos reales) + docs del Drive «Plan Maestro - Herencia - Ejecución CEDEARs Cuota 6-12» y «Cierre acelerado CEDEARs con excedente MIC3O».

Dos tandas, todas «Terminada», BCBA, límite, t1 (liquidan el 13/11). Se registró como el 02/11: por orden, un movimiento de Liquidez (`venta` = monto IOL en US$ con la comisión en dólares), la `compra` del CEDEAR a su precio ejecutado (costo promedio ponderado; la comisión NO entra al costo) con `liquidez_mov_id`, y la orden en `ordenes_ejecutadas` (origen `api`, `mep` 1.578,3, comisiones USD y ARS).

| Orden | Ticker | Nominales | Precio US$ | Monto US$ | Comisión US$ | Comisión $ | Total debitado US$ |
|---|---|---|---|---|---|---|---|
| 195713360 | MSFTD | 6 | 18,32 | 109,92 | 0,40 | 104,41 | 110,32 |
| 195713366 | WMTD | 19 | 7,49 | 142,31 | 0,52 | 135,17 | 142,83 |
| 195713378 | MELID | 4 | 13,30 | 53,20 | 0,19 | 50,53 | 53,39 |
| 195713391 | MRKD | 4 | 31,69 | 126,76 | 0,46 | 120,41 | 127,22 |
| 195713401 | LACD | 34 | 1,845 | 62,73 | 0,23 | 59,58 | 62,96 |
| 195725322 | MSFTD | 30 | 18,44 | 553,20 | 2,01 | 525,46 | 555,21 |
| 195725331 | WMTD | 91 | 7,48934 (7,48×6 + 7,49×85) | 681,53 | 2,47 | 647,35 | 684,00 |
| 195725337 | MELID | 23 | 13,22 | 304,06 | 1,10 | 288,81 | 305,16 |
| 195725342 | MRKD | 20 | 31,5605 (31,52×11 + 31,61×9) | 631,21 | 2,29 | 599,55 | 633,50 |
| 195725355 | LACD | 184 | 1,74 | 320,16 | 1,16 | 304,11 | 321,32 |

Total tanda 1 (cuota 6/12): US$ 496,72. Total tanda 2 (excedente de MIC3O): US$ 2.499,19. Total US$ 2.995,91 = lo «comprometido» que muestra `get_balance` hasta la liquidación.

Resultado en Herencia (= cuenta de IOL): MA 245, MSFT 242, WMT 509, MELI 279, MRK 74, LAC 539; Liquidez 5.707,41 − 2.995,91 = **2.711,50** (= saldo disponible de IOL en US$).

Nota de proceso: al descontar la Liquidez por SQL la fila de `posicion_brokers` quedó 684,00 por debajo (el trigger de escalado ya había ajustado una vez); se corrigió a 2.711,50. En futuras cargas por SQL, actualizar `posicion_brokers` de la LIQUIDEZ DESPUÉS de verificar la suma contra `posiciones.cantidad`.

## Ahorros — cuota 2/4 en BBVA (doc del Drive «Plan Maestro - Ahorros - Ejecución Cuota 2-4 BBVA», registrada el 12/11)

Prevista el lunes 09/11 (feriado), ejecutada por Ramiro en BBVA. SIN boleto: precio promedio informado + comisión ESTIMADA 1,148 % (la de los boletos reales de la cuota 1/4). Las posiciones (cantidad y costo promedio con comisión) ya las había actualizado otra sesión; faltaba el resto, que se completó acá:

| Ticker | Nominales | Precio prom. US$ | Bruto US$ | Comisión est. US$ | Con cargo US$ |
|---|---|---|---|---|---|
| GOOGL | 28 | 5,42 | 151,76 | 1,74 | 153,50 |
| MA | 10 | 21,48 | 214,80 | 2,47 | 217,27 |
| MELI | 20 | 13,21 | 264,20 | 3,03 | 267,23 |

Registrado: movimiento de compra por ticker (precio = con cargo ÷ nominales) con su `venta` de Liquidez; Liquidez de Ahorros −638,00 (BBVA 1.921,54 → 1.283,54; total 2.429,37 → 1.791,37); asignación BBVA +28/+10/+20 (GOOGL 58, MA 121, MELI 88); órdenes `origen='estimada'` en `/ordenes`. **Pendiente**: reemplazar por el boleto real de BBVA cuando llegue (comisión/derechos/impuestos exactos; corregir el costo si difiere). Quedan 2 cuotas (16/11 y 23/11).

Nota técnica: bajar `posiciones.cantidad` de la LIQUIDEZ dispara un trigger que reescala `posicion_brokers` proporcionalmente; hay que fijar después las filas por broker al valor correcto y verificar que la suma coincida con la cantidad.
