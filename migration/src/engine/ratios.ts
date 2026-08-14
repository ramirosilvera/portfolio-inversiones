// =============================================================================
// Ratios fundamentales — puros, calculados desde EDGAR + precio. (sección 9)
// EG5Y usa el CAGR REAL del EPS (no estimaciones de analistas — decisión Munger).
// =============================================================================

import type { Fundamentals, AnnualPoint, Ratios } from '../types/domain';

const latest = (a: AnnualPoint[]): number | null => (a.length ? a[a.length - 1].val : null);
const sortedByFy = (a: AnnualPoint[]) => [...a].sort((x, y) => x.fy - y.fy);

// CAGR real del EPS diluido de los últimos 5 años: (eps_hoy/eps_hace_5a)^(1/(n-1)) − 1
export function eg5y(epsDiluted: AnnualPoint[]): number | null {
  const s = sortedByFy(epsDiluted).slice(-5);
  if (s.length < 2) return null;
  const first = s[0].val, last = s[s.length - 1].val;
  if (first <= 0 || last <= 0) return null;
  return (last / first) ** (1 / (s.length - 1)) - 1;
}

export function computeRatios(f: Fundamentals, price: number | null, beta: number, riskFreeRate: number): Ratios {
  const eps = latest(f.epsDiluted);
  const equity = latest(f.equity);
  const shares = f.shares ?? null;
  const dps = latest(f.dividendPerShare) ?? 0;
  const revenue = latest(f.revenue);
  const opInc = latest(f.operatingIncome);
  // Equity, deuda y caja salen del MISMO balance (mismo 10-K) → deben quedar en el mismo año fiscal.
  // Si la deuda quedó rezagada uno o más años respecto del equity (ej. EDGAR dejó de encontrar la
  // etiqueta XBRL vigente y la serie se congeló en un año viejo — caso KO: totalDebt clavado en
  // FY2023 con equity/caja ya en FY2025), usarla igual mezclaría años distintos y daría un ratio
  // silenciosamente falso. Mejor tratarla como desconocida (null) que fabricar un número cruzado.
  const equityPoint = f.equity.length ? f.equity[f.equity.length - 1] : null;
  const debtPoint = f.totalDebt.length ? f.totalDebt[f.totalDebt.length - 1] : null;
  const debtStale = debtPoint != null && equityPoint != null && debtPoint.fy < equityPoint.fy;
  const debt = debtStale ? null : latest(f.totalDebt);
  const debtSafe = debt ?? 0; // para ponderaciones que degradan con gracia a "sin deuda" (WACC)
  const cash = latest(f.cash) ?? 0;
  const sti = latest(f.shortTermInvestments) ?? 0;
  const dna = latest(f.dna) ?? 0;
  const taxes = latest(f.taxes);
  const pretax = latest(f.pretaxIncome);

  // Tasa impositiva efectiva con guarda: fuera de [0, 0.6] → 0.21
  let effTax = 0.21;
  if (taxes != null && pretax && pretax !== 0) {
    const t = taxes / pretax;
    effTax = t >= 0 && t <= 0.6 ? t : 0.21;
  }

  const bookPerShare = equity != null && shares ? equity / shares : null;
  const eg = eg5y(f.epsDiluted);
  const pe = price != null && eps ? price / eps : null;

  // Capital invertido = equity + deuda − caja. Con denominador ≤ 0 (cash-rich o equity
  // negativo por recompras) el ROIC explota o cambia de signo → null (no crear el falso
  // chequeo Munger "ROIC>WACC ✓"). Con deuda rezagada (debt === null) tampoco: asumirla en
  // 0 subestimaría el capital invertido e infla el ROIC de forma engañosa.
  const investedCapital = (equity ?? 0) + debtSafe - cash;
  const roic = opInc != null && equity != null && debt != null && investedCapital > 0
    ? (opInc * (1 - effTax)) / investedCapital
    : null;

  const ebitda = opInc != null ? opInc + Math.abs(dna) : null;

  // WACC real ponderado.
  // Ke (costo de equity) por CAPM: rf + β · ERP (prima de riesgo de mercado 5%).
  const costOfEquity = riskFreeRate + beta * 0.05;
  // Kd (costo de deuda) después de impuestos. Tasa implícita = gasto por intereses / deuda total
  // (dato real de EDGAR); si no está o da fuera de un rango sensato [0.5%, 20%], usamos rf + 200bps.
  const intExp = Math.abs(latest(f.interestExpense ?? []) ?? 0);
  let kdPretax = riskFreeRate + 0.02;
  if (debtSafe > 0 && intExp > 0) {
    const implied = intExp / debtSafe;
    if (implied >= 0.005 && implied <= 0.20) kdPretax = implied;
  }
  const costOfDebt = debtSafe > 0 ? kdPretax * (1 - effTax) : null;
  // Pesos por VALOR DE MERCADO: E = precio·acciones, D = deuda total. Si no hay market cap
  // (falta precio o acciones) o la deuda es desconocida (rezagada), no podemos ponderar →
  // WACC = Ke (solo equity) — degrada igual que "sin deuda", nunca finge D/E falso.
  const marketCap = price != null && shares ? price * shares : null;
  let wacc = costOfEquity;
  if (marketCap != null && marketCap > 0 && debtSafe > 0 && costOfDebt != null) {
    const V = marketCap + debtSafe;
    wacc = costOfEquity * (marketCap / V) + costOfDebt * (debtSafe / V);
  }

  return {
    price,
    eps,
    pe,
    pb: price != null && bookPerShare ? price / bookPerShare : null,
    divYield: price ? dps / price : null,
    // payout con EPS ≤ 0 daría un número negativo engañoso (dividendo pagado con pérdidas) → null.
    payout: eps && eps > 0 ? dps / eps : null,
    operatingMargin: opInc != null && revenue ? opInc / revenue : null,
    // Equity NEGATIVO (habitual por recompras: MCD, SBUX, PM…) daría D/E negativo, que el score
    // interpretaba como solidez perfecta (100/100). Igual criterio que roic/netDebtToEbitda → null.
    // Deuda rezagada (debt === null) → null también, no 0 (ver comentario más arriba).
    debtToEquity: equity != null && equity > 0 && debt != null ? debt / equity : null,
    // EBITDA ≤ 0 con deuda neta positiva daría un ratio negativo que "parece" sano → null.
    netDebtToEbitda: ebitda && ebitda > 0 && debt != null ? (debt - cash - sti) / ebitda : null,
    roic,
    effectiveTaxRate: effTax,
    eg5y: eg,
    peForward: pe != null && eg != null ? pe / (1 + eg) : null,
    costOfEquity,
    costOfDebt,
    wacc,
  };
}
