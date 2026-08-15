import { describe, it, expect } from 'vitest';
import { parseAnnual, ultimoAnio, deudaRezagada, serieRezagada, type Raw } from './_edgar';
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
