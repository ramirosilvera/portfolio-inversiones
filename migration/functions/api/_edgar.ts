// SEC EDGAR fundamentals via the existing Cloudflare proxy (data.sec.gov blocks
// datacenter IPs / requires a compliant User-Agent — the proxy handles that).
// Proxy shape: {BASE}/api/xbrl/companyconcept/CIK{cik10}/{taxonomy}/{Concept}.json?k={TOKEN}

import type { Env } from './_shared';

// Default ticker→CIK (EDGAR blocks the ticker lookup file from datacenter IPs, so
// these are hardcoded; the user can add more via the cik_map table).
// Set estándar: mayores empresas del S&P que reportan a la SEC (us-gaap). MANTENER EN SYNC con
// src/lib/defaultCik.ts (espejo del frontend). El usuario puede añadir/sobrescribir vía cik_map.
export const DEFAULT_CIK: Record<string, string> = {
  UNH: '0000731766', MA: '0001141391', MSFT: '0000789019', GOOGL: '0001652044',
  MRK: '0000310158', MELI: '0001099590', LAC: '0001966983', ADBE: '0000796343',
  AMZN: '0001018724', ACN: '0001467373', NKE: '0000320187', AAPL: '0000320193',
  ASML: '0000937966', KO: '0000021344', V: '0001403161', WMT: '0000104169',
  NVDA: '0001045810', META: '0001326801', JNJ: '0000200406', PG: '0000080424',
  PEP: '0000077476', COST: '0000909832', LLY: '0000059478', JPM: '0000019617',
  TSLA: '0001318605', ORCL: '0001341439', CRM: '0001108524', ADP: '0000008670',
  IBM: '0000051143', INTC: '0000050863', CSCO: '0000858877', AMD: '0000002488',
  QCOM: '0000804328', TXN: '0000097476', AVGO: '0001730168', NFLX: '0001065280',
  PYPL: '0001633917', NOW: '0001373715', INTU: '0000896878', PLTR: '0001321655',
  ABT: '0000001800', ABBV: '0001551152', TMO: '0000097745', PFE: '0000078003',
  AMGN: '0000318154', GILD: '0000882095', BMY: '0000014272', CVS: '0000064803',
  ISRG: '0001035267', DHR: '0000313616',
  BRKB: '0001067983', 'BRK.B': '0001067983', BAC: '0000070858', WFC: '0000072971',
  C: '0000831001', GS: '0000886982', MS: '0000895421', AXP: '0000004962',
  BLK: '0001364742', SPGI: '0000064040', SCHW: '0000316709',
  HD: '0000354950', LOW: '0000060667', MCD: '0000063908', SBUX: '0000829224',
  BKNG: '0001075531', MDLZ: '0001103982', MO: '0000764180', CL: '0000021665',
  PM: '0001413329', DIS: '0001744489',
  XOM: '0000034088', CVX: '0000093410', CAT: '0000018230', DE: '0000315189',
  BA: '0000012927', MMM: '0000066740', HON: '0000773840', GE: '0000040545',
  UPS: '0001090727', F: '0000037996', GM: '0001467858',
  VZ: '0000732712', T: '0000732717',
};

// Concept alias lists (probamos en orden hasta que una devuelva datos).
export const CONCEPTS = {
  ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  netIncome: ['NetIncomeLoss'],
  dna: ['DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'DepreciationAndAmortization', 'Depreciation'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements'],
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'],
  operatingIncome: ['OperatingIncomeLoss'],
  epsDiluted: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'],
  dividendPerShare: ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  totalDebtLong: ['LongTermDebtNoncurrent', 'LongTermDebt'],
  totalDebtShort: ['LongTermDebtCurrent', 'DebtCurrent'],
  // El segundo alias es el tag que reemplazó al primero para muchas empresas grandes desde la ASU
  // 2016-18 (~2018 en adelante): reporta caja + caja restringida en una sola línea. Sin este alias,
  // cualquier empresa que haya migrado a ese tag (caso real: V) queda con `cash` vacío entero, aunque
  // sí reporte caja — solo bajo un nombre XBRL más nuevo que el único que se probaba antes.
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  shortTermInvestments: ['ShortTermInvestments', 'AvailableForSaleSecuritiesCurrent'],
  taxes: ['IncomeTaxExpenseBenefit'],
  pretaxIncome: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
  interestExpense: ['InterestExpense', 'InterestExpenseDebt', 'InterestAndDebtExpense', 'InterestExpenseNonoperating'],
} as const;

// Alias IFRS (taxonomía ifrs-full) — SOLO como fallback si ninguna alias us-gaap devolvió datos (ver
// fetchFirstConTaxonomia más abajo). Un emisor privado extranjero (Foreign Private Issuer, Form 20-F
// — ver parseAnnual) puede reportar en IFRS sin ninguna reconciliación a us-gaap: antes de esto, un
// caso así (ej. TSM) quedaba con el núcleo entero vacío (ocf/epsDiluted/revenue) y el ticker fallaba
// con "EDGAR no respondió" aunque la causa fuera permanente. Nombres de la IFRS Taxonomy (IASB) — no
// se pudieron verificar en vivo contra un 20-F real (sin acceso de red a SEC desde este entorno), así
// que puede hacer falta ajustar alguno si un ticker sigue sin resolver con esto puesto. Antes había un
// intento a medias de esto: 'ProfitLoss' colado en la lista de netIncome de us-gaap (arriba) — nunca
// podía funcionar, porque se consultaba bajo la taxonomía us-gaap, donde ese elemento no existe.
export const IFRS_CONCEPTS = {
  ocf: ['CashFlowsFromUsedInOperatingActivities'],
  netIncome: ['ProfitLoss'],
  revenue: ['Revenue'],
  epsDiluted: ['DilutedEarningsLossPerShare'],
  equity: ['Equity'],
  cash: ['CashAndCashEquivalents'],
  operatingIncome: ['ProfitLossFromOperatingActivities'],
  pretaxIncome: ['ProfitLossBeforeTax'],
  taxes: ['IncomeTaxExpenseContinuingOperations'],
  interestExpense: ['InterestExpense'],
} as const;

export interface Raw { start?: string; end: string; val: number; fy?: number; fp?: string; form?: string; filed?: string; }
export interface AnnualPoint { fy: number; end: string; val: number; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Devuelve la serie de un concepto. Distingue "no existe" (404/403 → null definitivo) de errores
// transitorios (429/5xx/red → reintenta con backoff), para no confundir un rate-limit del proxy
// con ausencia real de dato. Elige la unidad correcta (USD / USD/shares / shares) explícitamente.
async function fetchConcept(env: Env, cik: string, taxonomy: string, concept: string): Promise<Raw[] | null> {
  // Normalizar la base: si el secret SEC_PROXY_BASE termina en "/", la doble barra resultante
  // hacía que el worker respondiera 400 "Ruta no permitida" para TODOS los conceptos.
  const base = (env.SEC_PROXY_BASE || '').replace(/\/+$/, '');
  const url = `${base}/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${concept}.json?k=${env.SEC_PROXY_TOKEN}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      await sleep(300 * (attempt + 1));   // error de red → reintento
      continue;
    }
    if (res.status === 404 || res.status === 403) return null;              // concepto inexistente
    if (res.status === 429 || res.status >= 500) { await sleep(400 * (attempt + 1)); continue; } // transitorio
    if (!res.ok) return null;
    const data = await res.json() as { units?: Record<string, Raw[]> };
    const units = data.units ?? {};
    const keys = Object.keys(units);
    // Antes, si ninguna de las 3 unidades esperadas estaba, caía a keys[0] — la PRIMERA unidad que
    // haya, sea cual sea (ej. EUR/JPY en un 20-F/IFRS). Ese valor terminaba mezclado en el DCF como
    // si fuera USD, sin ninguna señal — un número mal etiquetado que el código trata como confiable
    // (viola la regla de oro). Mejor "sin dato" (null, mismo criterio que 404/403 más arriba) que un
    // número en la moneda equivocada disfrazado de bueno.
    const key = keys.find(k => k === 'USD') ?? keys.find(k => k === 'USD/shares') ?? keys.find(k => k === 'shares');
    return key ? units[key] : null;
  }
  return null; // reintentos agotados
}

// Año del dato más reciente de una serie (por el CIERRE del período, que es el año real).
export function ultimoAnio(raw: Raw[]): number {
  let max = -Infinity;
  for (const x of raw) {
    const a = Number((x.end ?? '').slice(0, 4));
    if (Number.isFinite(a) && a > max) max = a;
  }
  return max;
}

// Elige, entre los alias del concepto, el que tenga los datos MÁS RECIENTES (desempate: el de
// historia más larga). Antes devolvía el PRIMER alias con datos: si una empresa cambió de etiqueta
// XBRL —algo muy común— quedaba clavada en la etiqueta vieja y la serie terminaba años atrás
// (caso WMT: owner earnings de 2015-2019 cuando ya había datos hasta hoy).
// NO se mezclan alias entre sí: son conceptos con definiciones distintas (p. ej. "Depreciation" vs
// "DepreciationDepletionAndAmortization") y combinarlos crearía saltos falsos en la serie.
async function fetchFirst(env: Env, cik: string, taxonomy: string, aliases: readonly string[]): Promise<Raw[] | null> {
  const anioActual = new Date().getUTCFullYear();
  let mejor: Raw[] | null = null;
  let mejorAnio = -Infinity;
  for (const a of aliases) {
    const r = await fetchConcept(env, cik, taxonomy, a);
    if (!r || !r.length) continue;
    const anio = ultimoAnio(r);
    if (anio > mejorAnio || (anio === mejorAnio && mejor && r.length > mejor.length)) {
      mejor = r; mejorAnio = anio;
    }
    // Ya tenemos datos actuales: no seguimos pidiendo (cada alias es otro request al proxy).
    if (mejorAnio >= anioActual - 1) break;
  }
  return mejor;
}

// Formularios ANUALES reales: 10-K (emisor doméstico) y 20-F (emisor privado extranjero — ej. TSM,
// ASML — Form 20-F es su equivalente al 10-K, la SEC lo marca así en `form` sea cual sea la
// taxonomía usada). Antes solo se aceptaba 10-K: un 20-F que SÍ tenía us-gaap taggeado (algunos
// emisores extranjeros lo hacen, no es exclusivo de IFRS) quedaba descartado ENTERO por esto — no
// "faltaban algunos conceptos" (eso ya lo cubre `ungradeable`), la serie completa quedaba vacía y
// el ticker fallaba con "EDGAR no respondió" aunque la causa fuera permanente, no un rate-limit.
const FORM_ANUAL_RE = /^(10-K|20-F)/;

// Annual flow series: only 10-K/20-F FY points; when a period repeats across filings,
// keep the latest-filed value; sorted oldest→newest.
export function parseAnnual(raw: Raw[] | null): AnnualPoint[] {
  if (!raw) return [];
  const tenK = raw.filter(x => FORM_ANUAL_RE.test(x.form ?? '') && (x.fp === 'FY' || x.fp == null));
  // Conceptos de FLUJO (traen `start`): quedarnos solo con períodos ANUALES (~12 meses). Un 10-K
  // también publica trimestres que terminan el mismo día del cierre; sin este filtro, un Q4 podía
  // colarse como si fuera el año entero y subestimar el flujo.
  const anuales = tenK.filter(x => {
    if (!x.start) return true;               // concepto instantáneo (balance) → no aplica
    const dias = (Date.parse(x.end) - Date.parse(x.start)) / 86_400_000;
    return dias >= 300 && dias <= 400;
  });
  // EL AÑO DEL DATO ES EL DE SU CIERRE (`end`), NO `x.fy`: en la SEC `fy` es el año fiscal del
  // INFORME en que se publicó, así que un 10-K de 2025 trae los comparativos de 2024 y 2023 TODOS
  // con fy=2025. Usar x.fy desalineaba las series entre sí (OCF de un año contra capex de otro) y
  // hacía que los años recientes se descartaran por no encontrar pareja → owner earnings muy
  // subestimados (caso MELI: normalizaba ~US$500M en vez de miles de millones).
  const byFy = new Map<number, Raw>();
  for (const x of anuales) {
    const fy = Number(x.end.slice(0, 4));
    if (!Number.isFinite(fy)) continue;
    const prev = byFy.get(fy);
    if (!prev || (x.filed ?? '') > (prev.filed ?? '')) byFy.set(fy, x);   // ante restatements, el último presentado
  }
  return [...byFy.entries()]
    .map(([fy, x]) => ({ fy, end: x.end, val: x.val }))
    .sort((a, b) => a.fy - b.fy);
}

// Latest instant value (balance-sheet / share count): max by (end, filed).
function parseLatest(raw: Raw[] | null): number | null {
  if (!raw || !raw.length) return null;
  const sorted = [...raw].sort((a, b) => (a.end + (a.filed ?? '')).localeCompare(b.end + (b.filed ?? '')));
  return sorted[sorted.length - 1].val;
}

// Acciones diluidas ≈ netIncome / EPS diluido del último año común. Fallback robusto para empresas
// MULTI-CLASE (ej. GOOGL: clases A/B/C) que no reportan un total único de acciones en
// dei:EntityCommonStockSharesOutstanding → sin esto no hay valor por acción y el DCF queda SIN_DATOS.
function sharesFromEps(ni: AnnualPoint[], eps: AnnualPoint[]): number | null {
  const epsBy = new Map(eps.map(p => [p.fy, p.val]));
  const cand = [...ni]
    .filter(p => { const e = epsBy.get(p.fy); return e != null && Math.abs(e) > 1e-9; })
    .sort((a, b) => b.fy - a.fy)[0];
  if (!cand) return null;
  const s = cand.val / epsBy.get(cand.fy)!;
  return Number.isFinite(s) && s > 0 ? Math.round(s) : null;
}

// Sum two annual series by fiscal year (long + short debt → total debt).
function sumByFy(a: AnnualPoint[], b: AnnualPoint[]): AnnualPoint[] {
  const m = new Map<number, AnnualPoint>();
  for (const p of a) m.set(p.fy, { ...p });
  for (const p of b) { const e = m.get(p.fy); if (e) e.val += p.val; else m.set(p.fy, { ...p }); }
  return [...m.values()].sort((x, y) => x.fy - y.fy);
}

// totalDebt sale de sumar dos aliases (deuda LP + CP) que la empresa puede haber dejado de reportar
// bajo esas etiquetas XBRL específicas — la serie no queda vacía, queda CONGELADA en un año viejo
// mientras equity (MISMO balance, mismo 10-K) sigue avanzando (caso KO: totalDebt en FY2023 con
// equity ya en FY2025). No es lo mismo que "sin datos": el usuario necesita verlo para no confiar en
// un ratio de deuda que ratios.ts descarta en silencio por este mismo motivo (ver computeRatios).
// Generalizada: mismo criterio aplica a cualquier par de series que deberían venir del mismo estado
// contable — revenue vs. operatingIncome (mismo estado de resultados, caso real GOOGL: revenue
// clavado en FY2024), interestExpense vs. totalDebt (el interés se anualiza sobre la deuda del MISMO
// año, caso real MELI: interestExpense clavado en FY2017). ratios.ts aplica el mismo descarte a estos
// 3 pares (ver computeRatios) — esto es lo que hace que el usuario lo VEA (badge "datos incompletos
// EDGAR"), no solo que el ratio se calle en silencio.
export function serieRezagada(ancla: AnnualPoint[], serie: AnnualPoint[]): boolean {
  const ultimoAncla = ancla.length ? ancla[ancla.length - 1].fy : null;
  const ultimoSerie = serie.length ? serie[serie.length - 1].fy : null;
  return ultimoAncla != null && ultimoSerie != null && ultimoSerie < ultimoAncla;
}
export const deudaRezagada = serieRezagada;

export interface EdgarFundamentals {
  ticker: string; cik: string; entityName: string | null; shares: number | null;
  ocf: AnnualPoint[]; netIncome: AnnualPoint[]; dna: AnnualPoint[]; capex: AnnualPoint[];
  revenue: AnnualPoint[]; operatingIncome: AnnualPoint[]; epsDiluted: AnnualPoint[];
  dividendPerShare: AnnualPoint[]; equity: AnnualPoint[]; totalDebt: AnnualPoint[];
  cash: AnnualPoint[]; shortTermInvestments: AnnualPoint[]; taxes: AnnualPoint[];
  pretaxIncome: AnnualPoint[]; interestExpense: AnnualPoint[]; ungradeable: string[];
}

// Ejecuta las tareas de a `limite` en simultáneo. EDGAR/el proxy limitan por tasa: disparar los ~17
// conceptos (más sus alias) todos juntos provocaba 429 y devolvía series vacías, que la app mostraba
// como "SIN_DATOS" (diagnóstico equivocado: el dato existe, no se pudo traer).
async function enTandas<T>(tareas: (() => Promise<T>)[], limite = 4): Promise<T[]> {
  const out: T[] = new Array(tareas.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limite, tareas.length) }, async () => {
    while (i < tareas.length) { const idx = i++; out[idx] = await tareas[idx](); }
  });
  await Promise.all(workers);
  return out;
}

export async function fetchFundamentals(env: Env, ticker: string, cik: string): Promise<EdgarFundamentals> {
  const g = (aliases: readonly string[]) => fetchFirst(env, cik, 'us-gaap', aliases);
  // us-gaap primero siempre (así se comporta hoy para el 99% de los tickers, domésticos); ifrs-full
  // SOLO si us-gaap no devolvió absolutamente nada para ese concepto — ver IFRS_CONCEPTS arriba.
  const gConIfrs = async (usGaap: readonly string[], ifrs?: readonly string[]) =>
    (await g(usGaap)) ?? (ifrs ? await fetchFirst(env, cik, 'ifrs-full', ifrs) : null);
  const [ocf, ni, dna, capex, rev, opInc, eps, dps, eq, dl, ds, cash, sti, tax, pre, intExp, sharesRaw] = await enTandas([
    () => gConIfrs(CONCEPTS.ocf, IFRS_CONCEPTS.ocf), () => gConIfrs(CONCEPTS.netIncome, IFRS_CONCEPTS.netIncome),
    () => g(CONCEPTS.dna), () => g(CONCEPTS.capex),
    () => gConIfrs(CONCEPTS.revenue, IFRS_CONCEPTS.revenue), () => gConIfrs(CONCEPTS.operatingIncome, IFRS_CONCEPTS.operatingIncome),
    () => gConIfrs(CONCEPTS.epsDiluted, IFRS_CONCEPTS.epsDiluted), () => g(CONCEPTS.dividendPerShare),
    () => gConIfrs(CONCEPTS.equity, IFRS_CONCEPTS.equity), () => g(CONCEPTS.totalDebtLong), () => g(CONCEPTS.totalDebtShort),
    () => gConIfrs(CONCEPTS.cash, IFRS_CONCEPTS.cash),
    () => g(CONCEPTS.shortTermInvestments), () => gConIfrs(CONCEPTS.taxes, IFRS_CONCEPTS.taxes),
    () => gConIfrs(CONCEPTS.pretaxIncome, IFRS_CONCEPTS.pretaxIncome), () => gConIfrs(CONCEPTS.interestExpense, IFRS_CONCEPTS.interestExpense),
    () => fetchConcept(env, cik, 'dei', 'EntityCommonStockSharesOutstanding'),
  ]);

  const P = {
    ocf: parseAnnual(ocf), netIncome: parseAnnual(ni), dna: parseAnnual(dna), capex: parseAnnual(capex),
    revenue: parseAnnual(rev), operatingIncome: parseAnnual(opInc), epsDiluted: parseAnnual(eps),
    dividendPerShare: parseAnnual(dps), equity: parseAnnual(eq), totalDebt: sumByFy(parseAnnual(dl), parseAnnual(ds)),
    cash: parseAnnual(cash), shortTermInvestments: parseAnnual(sti), taxes: parseAnnual(tax),
    pretaxIncome: parseAnnual(pre), interestExpense: parseAnnual(intExp),
  };

  // Marcamos como "ungradeable" TODO campo crítico que alimenta el DCF (owner earnings) o los
  // ratios (ROIC, P/B) — no solo ocf/eps/revenue — para poder avisar cuando falta algo clave.
  const criticos: [string, AnnualPoint[]][] = [
    ['ocf', P.ocf], ['epsDiluted', P.epsDiluted], ['revenue', P.revenue],
    ['dna', P.dna], ['capex', P.capex], ['equity', P.equity], ['totalDebt', P.totalDebt], ['cash', P.cash],
  ];
  const ungradeable = criticos.filter(([, v]) => v.length === 0).map(([k]) => k);
  // Mismos 3 pares que ratios.ts descarta por año cruzado (ver computeRatios): equity/totalDebt
  // (balance), operatingIncome/revenue (resultados), totalDebt/interestExpense (deuda vs. su interés).
  const rezagados: [AnnualPoint[], AnnualPoint[], string][] = [
    [P.equity, P.totalDebt, 'totalDebt'],
    [P.operatingIncome, P.revenue, 'revenue'],
    [P.totalDebt, P.interestExpense, 'interestExpense'],
  ];
  for (const [ancla, serie, campo] of rezagados) {
    if (serieRezagada(ancla, serie) && !ungradeable.includes(campo)) ungradeable.push(campo);
  }

  // Acciones: total de dei; si falta (multi-clase), se deriva de netIncome / EPS diluido.
  const sharesDei = parseLatest(sharesRaw);
  const shares = sharesDei && sharesDei > 0 ? sharesDei : sharesFromEps(P.netIncome, P.epsDiluted);

  return { ticker, cik, entityName: null, shares, ...P, ungradeable };
}
