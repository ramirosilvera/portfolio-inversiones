# Auditoría QA — implementación de dividendos (2026-10-25)

**Alcance:** de punta a punta, del proveedor a la pantalla: `functions/api/_dividendos.ts` (proyección y proveedores), `market/dividendos.ts`
(endpoint y caché), `engine/dividendProjection.ts` (calendario), `engine/dividendYield.ts` (rendimiento nuevo), hooks, tarjeta de CEDEARs de Inicio,
`/cedears`, `/cupones` (Dividendos anual) y la sugerencia de cobros del cron (`sugerirDividendoPendiente`).
**Método:** lectura del código + corrida del motor con los datos REALES de la cartera (historial cacheado en `dividendos_cache`, precios de `precios_cache`,
posiciones de Ahorros y Herencia). Modo sin subagentes (lentes: datos/lógica de negocio, testing, seguridad, UX).

## Hallazgos

| ID | Sev. | Dónde | Descripción y escenario | Estado |
|---|---|---|---|---|
| DIV-01 | **ALTA** | `CuponesPage` + `dividendoAnualEstimado` | La misma app mostraba DOS «dividendos anuales»: Cupones sumaba 12 meses de calendario desde el mes en curso y dejaba un pago afuera si el próximo cae a ~3 meses (WMT, MRK). Con los datos de hoy: Ahorros US$ 103,81 vs 115,90 en la tarjeta (−10 %), Herencia US$ 82,29 vs 94,74 (−13 %). Arrastraba «Total renta 12m» y los netos estimados. | **Corregido**: función única `dividendoAnualizado`; diferencia 0 %. Test de regresión. |
| DIV-02 | **ALTA** | `_dividendos.ts` `proyectarDividendo` | `frecuenciaAnual` contaba el próximo pago YA declarado como un pago más del ritmo histórico: 5 en vez de 4 en todo pagador trimestral con un pago declarado (MSFT, WMT). Inflaba ~25 % cualquier proyección. | **Corregido** (commit anterior): cuenta solo pagos ya ocurridos. Test de regresión. |
| DIV-03 | MEDIA | `dividendYield.ts` (1.ª versión) | Usaba la misma ventana de calendario: WMT 0,62 % en vez de 0,83 %. Detectado al contrastar con datos reales antes de entregar. | **Corregido**: dividendo anualizado, independiente del calendario. |
| DIV-04 | MEDIA | `proyectarDividendo` | Un dividendo ESPECIAL como último pago se anualizaba como si fuera regular (monto × frecuencia) y además contaba como un pago más de la cadencia. Nada en cartera lo dispara hoy. | **Corregido**: un pago > 2× la mediana de la ventana (con ≥ 3 pagos) es extraordinario: se cobra (monto declarado) pero no se anualiza ni cuenta en la frecuencia; el calendario lo cobra UNA vez y repite el regular. Nuevo campo `montoRegularPorAccion`. 5 tests + verificado que fallan sin el fix. |
| DIV-05 | MEDIA | `fetchDividendos` / endpoint / UI | «No paga» no distinguía un `[]` erróneo del proveedor de «no paga»: un `[]` es truthy, no probaba otro proveedor y se cacheaba 24 h; con punto en el ticker (BRK.B) EODHD/FMP devolvían vacío. | **Corregido en 3 capas**: (1) un `[]` solo no frena la cadena, recién DOS proveedores que coinciden en vacío lo confirman (si solo uno respondió, se acepta); (2) tickers con punto se consultan con guion en EODHD y FMP; (3) en pantalla, un ticker del que ya cobraste un dividendo en los últimos 400 días nunca figura «no paga»: queda «sin dato» y fuera del promedio. 13 tests + mutación verificada. |
| DIV-06 | BAJA | `proyectarDividendo` | Si el último pago fue hace < 7 días queda `declarado` con `proximaFecha` pasada: el tooltip dice «próximo pago declarado» siendo el último ya pagado. No afecta el monto ni el %. | Pendiente (cosmético). |
| DIV-07 | BAJA | modelo | Un recorte o suspensión del dividendo se refleja recién cuando el proveedor lo publica; hasta entonces el % queda alto. Es estimación hacia adelante, rotulada así. | Aceptado. |
| DIV-08 | BAJA | UX | Las explicaciones están en `title` (tooltip): en el celular no hay hover. Es el patrón de toda la app. | Aceptado. |

## Verificado sin bugs

- **Ratio de cada CEDEAR:** los 8 tickers distintos (12 posiciones) tienen `ratio_cedear` cargado y coincide con el catálogo `cedear_ratios`
  (GOOGL 58, LAC 1, MA 33, MELI 120, MRK 5, MSFT 30, UNH 33, WMT 18). Un CEDEAR sin ratio no se convierte: queda «sin dato», no se inventa un dividendo ×N.
- **Rendimientos con datos reales** (bruto): UNH 2,22 %, MRK 2,34 %, MSFT 0,75 %, WMT 0,83 %, MA 0,56 %, GOOGL 0,27 %; LAC y MELI «no pagan».
  Cartera: Ahorros 0,95 %, Herencia 0,69 %. Coherentes con el rendimiento real de cada acción.
- Sugerencia de cobros del cron: divide por el ratio, respeta la fecha de corte (ex-dividend) y excluye `accion_ar`/bono/cash.
- Endpoint: sesión obligatoria, tickers validados por regex, máx. 60 por pedido; sin riesgo de inyectar en las URLs de los proveedores.
- Hooks en orden correcto (ninguno después de un `return` temprano); claves en mayúscula consistentes cliente/servidor.

## Verificación

`npm test`: 58 archivos / 1011 tests en verde (DIV-01 a DIV-05 con tests de regresión); `tsc` (app y Functions) sin errores;
`npm run build` ok. No se abrió la pantalla en un navegador: el layout del 5.º dato (ancho completo en el celular) está sin verificar visualmente.

## Qué hacer primero / después

1. Abrir Inicio, `/cedears` y `/cupones` y confirmar que los US$/año coinciden entre pantallas.
2. Pendientes menores: DIV-06 a DIV-08 (cosméticos).

## Límites de la corrección (DIV-04 y DIV-05)

- El umbral de «especial» (2× la mediana) es un criterio del código, no un dato del proveedor: un especial menor a 2× el regular no se detecta; un salto regular de más de 2× se tomaría por especial (no ocurre con aumentos normales de dividendo).
- La convención `BRK-B` de EODHD y FMP es la documentada por esos proveedores, pero NO se probó en vivo desde el sandbox (sin acceso a sus APIs): conviene mirar la primera vez que se cargue un ticker con punto.
- Costo en cuota: un no-pagador confirmado (LAC, MELI) ahora consulta 2 proveedores en lugar de 1 por refresco de 24 h (+1 llamada diaria a Alpha Vantage por ticker; su tope gratuito es de 25 por día).
