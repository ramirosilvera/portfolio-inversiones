import { describe, it, expect } from 'vitest';
import { parseAnnual, ultimoAnio, deudaRezagada, serieRezagada, calcularUngradeable, CONCEPTS, IFRS_CONCEPTS, SUBREQUEST_BUDGET_FETCH_FUNDAMENTALS, type Raw } from './_edgar';
import type { AnnualPoint } from './_edgar';

const A = (vals: [number, number][]): AnnualPoint[] => vals.map(([fy, val]) => ({ fy, end: `${fy}-12-31`, val }));

// Forma real de la SEC: `fy`/`fp` son del INFORME donde se publicó el dato, `start`/`end` son el
// período real del dato. Un 10-K trae los comparativos de los años anteriores con el MISMO fy.
const r = (start: string, end: string, val: number, fy: number, filed: string, form = '10-K'): Raw =>
  ({ start, end, val, fy, fp: 'FY', form, filed });

describe('parseAnnual — el año sale del CIERRE del período, no de `fy`', () => {
  it('un 10-K con comparativos: cada año queda con su valor real (no todos como el del informe)', () => {
    // 10-K de 2025 de MELI: OCF 2023/2024/2025, los tres con fy=2025.
    const serie = parseAnnual([
      r('2023-01-01', '2023-12-31', 5140, 2025, '2026-02-20'),
      r('2024-01-01', '2024-12-31', 7918, 2025, '2026-02-20'),
      r('2025-01-01', '2025-12-31', 12116, 2025, '2026-02-20'),
    ]);
    expect(serie.map(p => p.fy)).toEqual([2023, 2024, 2025]);
    expect(serie.map(p => p.val)).toEqual([5140, 7918, 12116]);
  });

  it('descarta trimestres que terminan el mismo día del cierre anual', () => {
    const serie = parseAnnual([
      r('2025-10-01', '2025-12-31', 3000, 2025, '2026-02-20'),   // Q4 (92 días) → fuera
      r('2025-01-01', '2025-12-31', 12116, 2025, '2026-02-20'),  // año completo → queda
    ]);
    expect(serie).toHaveLength(1);
    expect(serie[0].val).toBe(12116);
  });

  it('mismo período en dos presentaciones (restatement): gana la más reciente', () => {
    const serie = parseAnnual([
      r('2024-01-01', '2024-12-31', 100, 2024, '2025-02-20'),
      r('2024-01-01', '2024-12-31', 111, 2025, '2026-02-20'),   // reexpresado
    ]);
    expect(serie).toHaveLength(1);
    expect(serie[0].val).toBe(111);
  });

  it('solo 10-K (ignora 10-Q) y ordena de más viejo a más nuevo', () => {
    const serie = parseAnnual([
      r('2025-01-01', '2025-12-31', 999, 2025, '2026-05-01', '10-Q'),
      r('2024-01-01', '2024-12-31', 200, 2025, '2026-02-20'),
      r('2023-01-01', '2023-12-31', 100, 2025, '2026-02-20'),
    ]);
    expect(serie.map(p => p.fy)).toEqual([2023, 2024]);
  });

  it('conceptos instantáneos (sin `start`, ej. balance) no se filtran por duración', () => {
    const serie = parseAnnual([{ end: '2025-12-31', val: 500, fy: 2025, fp: 'FY', form: '10-K', filed: '2026-02-20' }]);
    expect(serie).toHaveLength(1);
  });

  it('entrada nula o vacía → serie vacía', () => {
    expect(parseAnnual(null)).toEqual([]);
    expect(parseAnnual([])).toEqual([]);
  });
});

describe('parseAnnual — 20-F (emisor privado extranjero, caso real TSM/ASML) cuenta como anual', () => {
  it('un 20-F con datos us-gaap taggeados ya NO se descarta entero (antes solo se aceptaba 10-K)', () => {
    const serie = parseAnnual([
      r('2023-01-01', '2023-12-31', 5000, 2025, '2026-02-20', '20-F'),
      r('2024-01-01', '2024-12-31', 6000, 2025, '2026-02-20', '20-F'),
    ]);
    expect(serie.map(p => p.fy)).toEqual([2023, 2024]);
    expect(serie.map(p => p.val)).toEqual([5000, 6000]);
  });

  it('20-F/A (enmienda) también cuenta, mismo criterio que 10-K/A', () => {
    const serie = parseAnnual([r('2024-01-01', '2024-12-31', 100, 2024, '2025-02-20', '20-F/A')]);
    expect(serie).toHaveLength(1);
  });

  it('6-K (el equivalente a un 10-Q para un emisor extranjero) sigue excluido — no es un informe anual', () => {
    const serie = parseAnnual([r('2025-10-01', '2025-12-31', 999, 2025, '2026-05-01', '6-K')]);
    expect(serie).toHaveLength(0);
  });
});

describe('IFRS_CONCEPTS — fallback para emisores 20-F sin ningún dato us-gaap (caso TSM)', () => {
  it('cada clave de IFRS_CONCEPTS existe también en CONCEPTS (mismo campo, taxonomía distinta)', () => {
    for (const key of Object.keys(IFRS_CONCEPTS)) {
      expect(Object.keys(CONCEPTS)).toContain(key);
    }
  });

  it('los conceptos núcleo que bloqueaban a TSM (ocf/epsDiluted/revenue) tienen fallback IFRS', () => {
    expect(IFRS_CONCEPTS.ocf.length).toBeGreaterThan(0);
    expect(IFRS_CONCEPTS.epsDiluted.length).toBeGreaterThan(0);
    expect(IFRS_CONCEPTS.revenue.length).toBeGreaterThan(0);
  });

  it('netIncome ya no depende de un alias IFRS colado en la lista us-gaap (bug previo: "ProfitLoss" ahí nunca podía resolver)', () => {
    expect(CONCEPTS.netIncome).not.toContain('ProfitLoss');
    expect(IFRS_CONCEPTS.netIncome).toContain('ProfitLoss');
  });

  it('dna tiene fallback IFRS — es el que bloqueaba a TSM con SIN_DATOS incluso con ocf/epsDiluted/revenue ya resueltos (capexMethod:\'dna\' es el default, ver ownerEarningsByYear en dcf.ts)', () => {
    expect(IFRS_CONCEPTS.dna.length).toBeGreaterThan(0);
  });

  it('capex y totalDebt (long/short) también tienen fallback IFRS', () => {
    expect(IFRS_CONCEPTS.capex.length).toBeGreaterThan(0);
    expect(IFRS_CONCEPTS.totalDebtLong.length).toBeGreaterThan(0);
    expect(IFRS_CONCEPTS.totalDebtShort.length).toBeGreaterThan(0);
  });
});

describe('SUBREQUEST_BUDGET_FETCH_FUNDAMENTALS — margen contra el límite de Cloudflare (caso real KO)', () => {
  it('queda bien por debajo de 50 (el límite de subrequests por invocación en Pages Functions), dejando margen para cacheFresh/cacheLast/sbUpsert alrededor', () => {
    // Cloudflare cortó la invocación ENTERA de KO con "Too many subrequests" — con ~17 conceptos ×
    // hasta 4 alias × reintentos (+ el fallback IFRS), el peor caso se acercaba o pasaba ese techo.
    // Si algún día se agregan más conceptos/alias, este test avisa si el presupuesto quedó sin
    // ajustar y el margen de seguridad se perdió.
    expect(SUBREQUEST_BUDGET_FETCH_FUNDAMENTALS).toBeLessThanOrEqual(40);
  });
});

describe('deudaRezagada — detectar totalDebt congelado vs. el balance (caso KO)', () => {
  it('totalDebt más de un año atrás del equity (mismo balance) → rezagada', () => {
    expect(deudaRezagada(A([[2023, 24846], [2024, 25332], [2025, 26000]]), A([[2021, 38116], [2022, 36377], [2023, 37507]]))).toBe(true);
  });
  it('totalDebt y equity en el mismo último año → no rezagada', () => {
    expect(deudaRezagada(A([[2023, 24846]]), A([[2023, 37507]]))).toBe(false);
  });
  it('totalDebt MÁS reciente que equity (caso raro, ej. equity atrasado) → no rezagada', () => {
    expect(deudaRezagada(A([[2023, 24846]]), A([[2024, 37507]]))).toBe(false);
  });
  it('cualquiera de las dos series vacía → no se puede comparar, no rezagada', () => {
    expect(deudaRezagada([], A([[2023, 37507]]))).toBe(false);
    expect(deudaRezagada(A([[2023, 24846]]), [])).toBe(false);
    expect(deudaRezagada([], [])).toBe(false);
  });
});

describe('serieRezagada — generalizada a otros pares (casos reales GOOGL/MELI)', () => {
  it('revenue rezagado respecto de operatingIncome (mismo estado de resultados, caso GOOGL)', () => {
    expect(serieRezagada(A([[2023, 84293], [2024, 112390], [2025, 125000]]), A([[2023, 307394], [2024, 350018]]))).toBe(true);
  });
  it('interestExpense rezagado respecto de totalDebt (caso MELI, clavado años atrás)', () => {
    expect(serieRezagada(A([[2023, 1961], [2024, 2200], [2025, 2500]]), A([[2015, 20], [2016, 25], [2017, 30]]))).toBe(true);
  });
  it('deudaRezagada sigue siendo el mismo alias de siempre (no un caso especial aparte)', () => {
    expect(deudaRezagada).toBe(serieRezagada);
  });
});

describe('ultimoAnio — detectar un alias XBRL desactualizado (caso WMT)', () => {
  it('la etiqueta vieja termina años atrás y la nueva está al día', () => {
    const vieja = [r('2018-02-01', '2019-01-31', 10, 2019, '2019-03-28')];
    const nueva = [r('2024-02-01', '2025-01-31', 20, 2025, '2025-03-28')];
    expect(ultimoAnio(vieja)).toBe(2019);
    expect(ultimoAnio(nueva)).toBe(2025);
    expect(ultimoAnio(nueva)).toBeGreaterThan(ultimoAnio(vieja));   // se elige la nueva
  });
  it('serie vacía → -Infinity (nunca gana la selección)', () => {
    expect(ultimoAnio([])).toBe(-Infinity);
  });
});

// Empresa "sana": todo con datos hasta el mismo año — el caso base contra el que se comparan los
// 3 casos reales de abajo (ninguno de los 3 debería ensuciar esta base).
const SERIE_SANA = A([[2023, 100], [2024, 110], [2025, 120]]);
const seriesCompletas = () => ({
  ocf: SERIE_SANA, epsDiluted: SERIE_SANA, revenue: SERIE_SANA, dna: SERIE_SANA, capex: SERIE_SANA,
  equity: SERIE_SANA, totalDebt: SERIE_SANA, cash: SERIE_SANA, operatingIncome: SERIE_SANA, interestExpense: SERIE_SANA,
});

describe('calcularUngradeable — 3 patrones reales encontrados en el catálogo (2026-08-20)', () => {
  it('catálogo completo y sano → sin ungradeable', () => {
    expect(calcularUngradeable(seriesCompletas())).toEqual([]);
  });

  it('caso ISRG: totalDebt VACÍO pero todo lo demás completo → NO ungradeable (Intuitive Surgical no tiene deuda, verificado externamente — un balance sin deuda no es un dato incompleto)', () => {
    const isrg = { ...seriesCompletas(), totalDebt: [] };
    expect(calcularUngradeable(isrg)).toEqual([]);
  });

  it('caso KO: totalDebt PRESENTE pero rezagado varios años respecto de equity → SÍ ungradeable (a diferencia de ISRG, acá hay un valor viejo, no ausencia real de deuda)', () => {
    const ko = { ...seriesCompletas(), totalDebt: A([[2023, 100]]) }; // equity/etc siguen hasta 2025
    expect(calcularUngradeable(ko)).toContain('totalDebt');
  });

  it('caso GOOGL: revenue rezagado respecto de operatingIncome → SÍ ungradeable', () => {
    const googl = { ...seriesCompletas(), revenue: A([[2023, 100], [2024, 110]]) }; // operatingIncome sigue hasta 2025
    expect(calcularUngradeable(googl)).toContain('revenue');
  });

  it('caso MELI: interestExpense rezagado respecto de totalDebt → SÍ ungradeable', () => {
    const meli = { ...seriesCompletas(), interestExpense: A([[2017, 10]]) }; // totalDebt sigue hasta 2025
    expect(calcularUngradeable(meli)).toContain('interestExpense');
  });

  it('caso TSM: varios campos genuinamente vacíos a la vez (dna/capex/totalDebt/cash) → SÍ ungradeable en los 4, el fix de ISRG no los tapa', () => {
    const tsm = { ...seriesCompletas(), dna: [], capex: [], totalDebt: [], cash: [] };
    const resultado = calcularUngradeable(tsm);
    expect(resultado).toEqual(expect.arrayContaining(['dna', 'capex', 'cash']));
    // totalDebt NUNCA se flagea solo por estar vacío (ver CRITICOS_SI_VACIOS) — acá igual el warning
    // "datos incompletos EDGAR" sigue disparando porque dna/capex/cash SÍ están en la lista y
    // TAMBIÉN están vacíos: el fix de ISRG no esconde el problema real de TSM, lo siguen
    // detectando los otros 3 campos.
    expect(resultado).not.toContain('totalDebt');
  });
});
