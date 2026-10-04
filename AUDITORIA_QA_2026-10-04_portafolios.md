# Auditoría QA de datos — portfolios Ahorros y Herencia (2026-10-04)

Alcance: consistencia interna de la base (posiciones, movimientos, brokers, aportes, cobros, snapshots,
órdenes) y conciliación con IOL en vivo (get_portfolio, get_balance, get_activities; solo lectura).
Las correcciones de datos guardaron los valores previos (reversibles). No hubo cambios de código.

## Verificado y correcto
- **IOL ↔ app, cantidades:** coinciden los 17 instrumentos en IOL. Ej.: MELI 219 = 150 (Herencia) + 69 (Ahorros en IOL),
  MA 211 = 163 + 48, LAC 239 = 176 + 63, UNH 44, CS51O 1.914, COC4O 2.000 y todos los bonos de Herencia.
- **Órdenes ↔ movimientos (Herencia, 28 y 29/09):** nominales y montos iguales por ticker (diferencias de centavos por redondeo
  de precio en MELI y MRK).
- **Plan v31/v32 ↔ posiciones:** las 15 posiciones de Herencia coinciden con las cantidades del plan.
- **Precios y ratios:** CEDEARs de la app vs. pesos de IOL convertidos a CCL, dentro de ±0,5%. Sin precios viejos (<36 h).
- **Integridad:** sin posiciones duplicadas ni negativas, sin costo faltante, sin ratio CEDEAR faltante, sin movimientos huérfanos
  ni de otro portfolio; suma por broker = cantidad en todas las posiciones de Herencia; `aportado` de los snapshots = aportes.
- **Metadatos de bonos:** cupón, frecuencia, mes, vencimiento, ley y calificación cargados en los 11 bonos abiertos.

## Hallazgos corregidos
| ID | Sev. | Hallazgo | Corrección |
|---|---|---|---|
| P1 | MEDIA | LIQUIDEZ de Herencia 8.232,10 vs IOL 8.233,39: faltaba un crédito de US$1,29 del 01/10 (ticket 75846270) | Saldo, asignación IOL y movimientos (saldo base + crédito) → 8.233,39 |
| P2 | BAJA | `ordenes_ejecutadas`: 5 órdenes del 29/09 sin comisión (MIC3D/TLCUD) y 7 sin comisión en USD | Completadas desde IOL; totales idénticos a Drive (28/09: US$71,74 + ARS 10.012,38; 29/09: US$13,74 + ARS 707,41) |
| P3 | BAJA | Compras manuales PLC4D y RC1CD sin número de orden; faltaba una cancelada (190495362) | Números reales (190495051, 190498016, 190499704) y la orden cancelada agregados |

Valores previos: LIQUIDEZ 8232,10 (asignación IOL 8232,10; sin movimientos); órdenes con `numero_orden`/comisiones en null.

## Pendiente / para decidir
- **Ahorros, LIQUIDEZ US$650 sin broker asignado** (no está en IOL): falta saber dónde está para asignarla.
- **Ahorros, historial incompleto** en GOOGL, LAC, MRK y UNH (sin movimientos) y MA y MELI (parcial): se concilia solo antes de la
  próxima escritura (asegurarHistorial); no se inventaron fechas.
- **No verificable:** lo que Ahorros tiene en Santander y BBVA (GOOGL 518, MRK 71, LAC 202, UNH 113, MELI 11, AEC3D 2.000, MA 100…).
- **IOL tiene efectivo que la app no lleva:** ARS 55.619 (≈US$36) y US$0,40 en la cuenta EE.UU.
- **Herencia, posición RESERVA** (efectivo 0/0) vacía: ¿borrarla?
- **Herencia, rendimiento 2026 = −10,6% (Dietz)**: señalado con asterisco; ver AUDITORIA_QA_2026-10-04.md y la decisión de método.
- **Cobros pendientes de octubre:** YM43D 96 (14/10), DNC7D 107,80 (24/10) y CS51D 66,99 (20/10, Ahorros); al cobrarlos,
  confirmar con "Acreditar en Liquidez".
