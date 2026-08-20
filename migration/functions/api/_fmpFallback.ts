// Fallback cuando EDGAR no devuelve absolutamente NADA del núcleo (ocf/epsDiluted/revenue vacíos) Y
// no hay ninguna foto cacheada previa a la que volver (ver fundamentals.ts) — el último recurso antes
// de dejar al usuario con la pantalla vacía. Usa los 3 endpoints de estados contables YA
// consolidados de FMP (mismo FMP_API_KEY que ya usan beta.ts/quotes.ts/_cikResolve.ts, sin pedir un
// secret nuevo) en vez del XBRL crudo de EDGAR.
//
// Regla de oro del proyecto (CLAUDE.md): "los NÚMEROS los calcula el código". Esto sigue siendo
// cierto acá — el código no INVENTA ningún valor, los toma tal cual de la respuesta de FMP — pero la
// FUENTE cambia: FMP es un agregador de terceros que reprocesa los mismos filings de la SEC, no la
// fuente primaria auditada. Por eso el resultado SIEMPRE se marca con fuente:'fmp' y un warning
// propio (ver fundamentals.ts) — nunca se mezcla en silencio como si fuera EDGAR.
//
// Campos que FMP no tiene un equivalente directo y quedan [] (no se inventa un mapeo que no existe):
// dividendPerShare, shortTermInvestments.

import type { AnnualPoint } from './_edgar';
import { sumByFy } from './_edgar';

export interface FilaFmp { [k: string]: unknown }

const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;

// FMP da el año como "calendarYear" (string, ej. "2025") o, si falta, se puede derivar de "date"
// (ej. "2025-12-31"). Preferimos calendarYear porque es el campo pensado para esto — `date` puede
// no coincidir exactamente con el cierre fiscal en casos raros (año fiscal no calendario).
function anioDe(row: FilaFmp): number | null {
  const y = typeof row.calendarYear === 'string' ? Number(row.calendarYear) : null;
  if (y != null && Number.isFinite(y)) return y;
  const d = typeof row.date === 'string' ? Number(row.date.slice(0, 4)) : null;
  return d != null && Number.isFinite(d) ? d : null;
}

// Arma una AnnualPoint[] a partir del array de filas (una por año) que devuelve cada endpoint de
// FMP y el nombre del campo — fila sin año o sin valor numérico válido en ese campo se descarta
// (nunca se rellena con 0 ni se adivina).
export function serieDeFmp(filas: FilaFmp[], campo: string): AnnualPoint[] {
  const out: AnnualPoint[] = [];
  for (const row of filas ?? []) {
    const fy = anioDe(row);
    const val = num(row[campo]);
    if (fy != null && val != null) out.push({ fy, end: `${fy}-12-31`, val });
  }
  return out.sort((a, b) => a.fy - b.fy);
}

export interface FundamentalsFmp {
  ocf: AnnualPoint[]; netIncome: AnnualPoint[]; dna: AnnualPoint[]; capex: AnnualPoint[];
  revenue: AnnualPoint[]; operatingIncome: AnnualPoint[]; epsDiluted: AnnualPoint[];
  dividendPerShare: AnnualPoint[]; equity: AnnualPoint[]; totalDebt: AnnualPoint[];
  cash: AnnualPoint[]; shortTermInvestments: AnnualPoint[]; taxes: AnnualPoint[];
  pretaxIncome: AnnualPoint[]; interestExpense: AnnualPoint[]; shares: number | null;
}

// Puro y testeado — separado de la llamada HTTP real (que vive en fundamentals.ts) para poder
// probar el mapeo con respuestas de ejemplo, sin depender de la red.
export function mapearFmpAFundamentals(income: FilaFmp[], balance: FilaFmp[], cashflow: FilaFmp[]): FundamentalsFmp {
  // eps: FMP usa la clave en minúscula "epsdiluted" (no "epsDiluted") — si esa no trae nada, "eps"
  // (básico) es mejor que nada para no descartar el ticker entero por un solo campo.
  const epsDiluted = serieDeFmp(income, 'epsdiluted');
  const dnaCashflow = serieDeFmp(cashflow, 'depreciationAndAmortization');
  const totalDebtDirecto = serieDeFmp(balance, 'totalDebt');
  const sharesSerie = serieDeFmp(income, 'weightedAverageShsOutDil');

  return {
    ocf: serieDeFmp(cashflow, 'operatingCashFlow'),
    netIncome: serieDeFmp(income, 'netIncome'),
    // El estado de flujo de efectivo suele traer D&A más fiel al gasto real que el de resultados
    // (que a veces solo desglosa una porción) — se prioriza, con el de resultados como respaldo.
    dna: dnaCashflow.length ? dnaCashflow : serieDeFmp(income, 'depreciationAndAmortization'),
    capex: serieDeFmp(cashflow, 'capitalExpenditure'),
    revenue: serieDeFmp(income, 'revenue'),
    operatingIncome: serieDeFmp(income, 'operatingIncome'),
    epsDiluted: epsDiluted.length ? epsDiluted : serieDeFmp(income, 'eps'),
    dividendPerShare: [],
    equity: serieDeFmp(balance, 'totalStockholdersEquity'),
    // Preferimos el totalDebt ya sumado de FMP si lo trae; si no, lo armamos igual que EDGAR
    // (largo + corto plazo, sumByFy — mismo criterio, no uno nuevo).
    totalDebt: totalDebtDirecto.length ? totalDebtDirecto : sumByFy(serieDeFmp(balance, 'longTermDebt'), serieDeFmp(balance, 'shortTermDebt')),
    cash: serieDeFmp(balance, 'cashAndCashEquivalents'),
    shortTermInvestments: serieDeFmp(balance, 'shortTermInvestments'),
    taxes: serieDeFmp(income, 'incomeTaxExpense'),
    pretaxIncome: serieDeFmp(income, 'incomeBeforeTax'),
    interestExpense: serieDeFmp(income, 'interestExpense'),
    shares: sharesSerie.length ? sharesSerie[sharesSerie.length - 1].val : null,
  };
}
