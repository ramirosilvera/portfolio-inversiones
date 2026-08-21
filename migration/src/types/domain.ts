// =============================================================================
// Domain types — mirror the Supabase schema (see supabase/migrations).
// =============================================================================

// bono cubre bonos soberanos y ONs (obligaciones negociables). accion = acción US directa;
// accion_ar = acción argentina (BYMA).
export type AssetType = 'cedear' | 'accion' | 'accion_ar' | 'etf' | 'bono' | 'cash';
export type AssetRole =
  | 'compounder' | 'stalwart' | 'fast_grower' | 'asset_play' | 'slow_grower' | 'turnaround' | 'cyclical';
export type PortfolioState = 'active' | 'archived';
export type AporteTipo = 'inicial' | 'adelanto' | 'recurrente' | 'retiro';

export interface Portfolio {
  id: string;
  user_id: string;
  nombre: string;
  descripcion: string | null;
  capital_objetivo: number | null;
  moneda_ref: string;            // 'USD' | 'ARS'
  estrategia: string | null;
  estado: PortfolioState;
  created_at: string;
}

export interface Posicion {
  id: string;
  portfolio_id: string;
  tipo: AssetType;
  ticker: string;
  empresa: string | null;
  sector: string | null;
  rol: AssetRole | null;
  cantidad: number;
  precio_compra: number;
  fecha_compra: string | null;
  peso_objetivo: number | null;  // 0..1
  ratio_cedear: number | null;   // subyacentes por CEDEAR
  tir_esperada: number | null;
  beta: number | null;
  // Cupones (bonos/ONs) — usados por el flujo de cupones:
  cupon_tasa: number | null;         // tasa nominal anual (0.07 = 7%)
  cupon_frecuencia: number | null;   // pagos por año (1/2/4)
  cupon_mes: number | null;          // mes (1-12) de un pago de referencia
  vencimiento: string | null;        // ISO date
  // Calificación crediticia (bonos/ONs) — cargada a mano, ver engine/rating.ts para la clasificación:
  calificadora: string | null;   // 'S&P' | 'Moody's' | 'Fitch' | 'FIX SCR' | 'Moody's Local' | 'Otra'
  calificacion: string | null;   // nota tal cual (ej. 'BB-', 'Ba3', 'AAA(arg)')
  // Ley aplicable (bonos/ONs) — cargada a mano (se pre-llena sola desde bonos_referencia si el
  // ticker matchea, ver enrichBono en PosicionesPage.tsx), igual criterio que calificadora/
  // calificacion: ninguna API gratuita la da.
  ley: 'local' | 'extranjera' | null;
  // Estructura de repago (bonos/ONs) — cargada a mano, ver engine/coupons.ts:
  amortizable: boolean;           // false = bullet (100% del capital al vencimiento)
  valor_residual: number | null;  // fracción 0..1 del nominal original que queda por cobrar (foto manual, no cronograma); solo aplica si amortizable
  notas: string | null;
  created_at: string;
}

// Broker: dónde está físicamente cada posición — GLOBAL por usuario (no por portfolio), el mismo
// broker puede tener posiciones en varios portfolios. Ver 0016_brokers.sql.
export interface Broker {
  id: string;
  user_id: string;
  nombre: string;
  created_at: string;
}

// Reparto de una posición entre brokers — reemplaza posiciones.broker_id (0016/0017): una posición
// es 1 fila en `posiciones` (ticker unificado), pero puede tener 0, 1 o varias filas acá si está
// repartida entre brokers (ej. mitad en IOL, mitad en Santander). Ver 0018_posicion_brokers.sql.
export interface PosicionBroker {
  id: string;
  posicion_id: string;
  broker_id: string;
  cantidad: number;
  created_at: string;
}

// Cronograma MANUAL de cuotas de amortización futuras de un bono (0028_amortizaciones_programadas.sql)
// — solo para la proyección de Cupones (engine/coupons.ts: couponEvents/capitalEvents), no para la
// valuación actual (esa usa posiciones.valor_residual). `porcentaje` es la fracción (0..1] del
// nominal ORIGINAL que se espera amortizar en esa fecha — un valor por cuota, no un acumulado.
export interface AmortizacionProgramada {
  id: string;
  posicion_id: string;
  fecha: string;
  porcentaje: number;
  created_at: string;
}

export interface Movimiento {
  id: string;
  portfolio_id: string;
  posicion_id: string | null;
  ticker: string;
  tipo: 'compra' | 'venta' | 'ajuste';
  cantidad: number;
  precio: number;                // precio por unidad (USD)
  fecha: string;
  nota: string | null;
  created_at: string;
}

// Cobro de dividendo/interés/amortización de una posición. 'amortizacion' es devolución de
// capital, no renta — ver 0011_cobros.sql. Se registra de 2 formas excluyentes según lo que haga el
// bróker con la tenencia (ver useCobros.ts registrarAmortizacion/registrarAmortizacionVR): reduce
// el nominal vía un movimiento 'ajuste', O deja el nominal igual y actualiza posiciones.valor_residual
// (0027_bond_amortizable.sql) — nunca las dos para el mismo pago.
// estado='pendiente': lo generó el cron (dividendo/cupón proyectado que llegó a su fecha) y TODAVÍA
// no es plata confirmada por el usuario. estado='descartado': el usuario lo rechazó — la fila se
// conserva (no se borra) para que el cron no lo vuelva a sugerir (índice cobros_cron_dedupe).
// engine/cobros.ts usa ALLOWLIST (solo disponible/reinvertido suman) — nunca tratar ningún otro
// estado como sinónimo de "plata confirmada". Ver 0012/0015_cobros_pendientes*.sql.
export type CobroTipo = 'dividendo' | 'interes' | 'amortizacion';
export type CobroEstado = 'disponible' | 'reinvertido' | 'pendiente' | 'descartado';
export type CobroOrigen = 'manual' | 'cron';

export interface Cobro {
  id: string;
  portfolio_id: string;
  posicion_id: string | null;
  ticker: string;
  tipo: CobroTipo;
  fecha: string;
  monto: number;
  estado: CobroEstado;
  origen: CobroOrigen;
  movimiento_id: string | null;
  nota: string | null;
  created_at: string;
}

// Una vez que el usuario dice "invertí $X del saldo disponible" — ledger aparte, no apunta a
// ningún cobro puntual. Ver 0019_cobros_inversiones.sql y engine/cobros.ts (saldoInvertible).
export interface CobroInversion {
  id: string;
  portfolio_id: string;
  fecha: string;
  monto: number;
  nota: string | null;
  created_at: string;
}

// ── Dashboard personalizable (0029_dashboard_layout.sql) ──────────────────────
// Layout = 1 fila JSONB por usuario (dashboard_layout.widgets), no 1 fila por tarjeta — ver
// engine/dashboardCatalog.ts para el catálogo de secciones/métricas y el layout default.
// 'aportes' (sección propia) se fusionó con 'rendimiento_por_anio' en una sola tarjeta configurable
// — ver ALIASES en engine/dashboardCatalog.ts. No queda en este union (nadie debería poder
// SELECCIONARLA de nuevo), pero un layout guardado con esa key vieja sigue resolviendo bien: los
// widgets se leen como `unknown` y se castean en normalizarWidget (useDashboardLayout.ts), así que
// la ausencia acá no rompe datos existentes.
export type SeccionKey =
  | 'objetivo_capital' | 'rendimiento_por_anio' | 'distribucion' | 'cedears' | 'bonos' | 'radar'
  | 'patrimonio_broker' | 'cobros' | 'liquidez_fci' | 'macro';

export type MetricKey =
  | 'distribucion_categoria' | 'distribucion_tipo_activo'
  | 'cedears_capital' | 'cedears_mayor_posicion' | 'cedears_por_sector'
  | 'bonos_capital' | 'bonos_tir_promedio' | 'bonos_duracion_promedio' | 'bonos_grado_inversion' | 'bonos_proximo_capital'
  | 'bonos_distribucion_ley'
  | 'radar_compra_agresiva'
  | 'cobros_total' | 'cobros_disponible'
  | 'macro_semaforos'
  | 'liquidez_fci' | 'liquidez_disponible' | 'liquidez_sin_asignar'
  | 'liquidez_ingresos' | 'liquidez_egresos' | 'liquidez_reserva';

export type DashboardViz = 'stat' | 'donut' | 'bar' | 'table';

// `kind:'seccion'` envuelve un componente YA EXISTENTE tal cual (mismos hooks, mismo cálculo, sin
// cambios) — agregar/quitar/reordenar. `kind:'metrica'` es la tarjeta atómica libre: una o más
// métricas del catálogo (`metricas.length > 1` = tarjeta combinada, solo entre métricas `scalar` —
// se renderizan como una grilla de números dentro de una sola Card, no hay selección de
// visualización) + una visualización compatible cuando es una sola, con título opcional (default =
// el del catálogo, o la unión de títulos si es una combinación sin título propio).
export type DashboardWidget =
  | { id: string; kind: 'seccion'; seccion: SeccionKey }
  | { id: string; kind: 'metrica'; metricas: MetricKey[]; viz: DashboardViz; titulo?: string };

export interface DashboardLayout {
  user_id: string;
  widgets: DashboardWidget[];
  updated_at: string;
}

export interface Aporte {
  id: string;
  portfolio_id: string;
  monto: number;
  fecha: string;
  tipo: AporteTipo;
  descripcion: string | null;
}

// ── Flujo de caja personal (por usuario, no por portfolio) ────────────────────
export type FlujoCategoria = 'ingreso' | 'egreso' | 'inversion';
export type FlujoDestino = 'fci' | 'mercadopago' | 'cedears' | 'bonos' | 'efectivo' | 'otro';

export interface FlujoItem {
  id: string;
  user_id: string;
  categoria: FlujoCategoria;
  concepto: string;
  monto: number;
  moneda: 'ARS' | 'USD';
  destino: FlujoDestino | null;
  orden: number;
  activo: boolean;
  nota: string | null;
  updated_at: string;
  created_at: string;
}

// ── Fundamentals derived from EDGAR (computed, not stored hardcoded) ──────────
export interface AnnualPoint { fy: number; end: string; val: number; }

export interface Fundamentals {
  ticker: string;
  cik: string;
  entityName: string | null;
  shares: number | null;                 // dei EntityCommonStockSharesOutstanding (latest)
  ocf: AnnualPoint[];
  netIncome: AnnualPoint[];
  dna: AnnualPoint[];
  capex: AnnualPoint[];                   // magnitude (positive)
  revenue: AnnualPoint[];
  operatingIncome: AnnualPoint[];
  epsDiluted: AnnualPoint[];
  dividendPerShare: AnnualPoint[];
  equity: AnnualPoint[];
  totalDebt: AnnualPoint[];
  cash: AnnualPoint[];
  shortTermInvestments: AnnualPoint[];
  taxes: AnnualPoint[];
  pretaxIncome: AnnualPoint[];
  interestExpense?: AnnualPoint[];        // opcional: para Kd real (interés/deuda). Ausente en cache viejo.
  ungradeable?: string[];                 // concepts EDGAR didn't return (e.g. 20-F/IFRS filers)
  updated_at?: string;
}

export interface Ratios {
  price: number | null;
  eps: number | null;
  pe: number | null;
  pb: number | null;
  divYield: number | null;
  payout: number | null;
  operatingMargin: number | null;
  debtToEquity: number | null;
  netDebtToEbitda: number | null;
  roic: number | null;
  effectiveTaxRate: number | null;
  eg5y: number | null;                    // real historical EPS CAGR (5y)
  peForward: number | null;
  costOfEquity: number | null;            // Ke por CAPM (rf + β·ERP)
  costOfDebt: number | null;              // Kd después de impuestos
  wacc: number | null;                    // WACC real ponderado (Ke·E/V + Kd·D/V); Ke si no hay market cap
}
