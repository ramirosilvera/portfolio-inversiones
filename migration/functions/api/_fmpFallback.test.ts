import { describe, it, expect } from 'vitest';
import { serieDeFmp, mapearFmpAFundamentals, type FilaFmp } from './_fmpFallback';

describe('serieDeFmp', () => {
  it('arma AnnualPoint[] desde calendarYear + el campo pedido', () => {
    const filas: FilaFmp[] = [
      { calendarYear: '2024', revenue: 1000 },
      { calendarYear: '2023', revenue: 900 },
    ];
    expect(serieDeFmp(filas, 'revenue')).toEqual([
      { fy: 2023, end: '2023-12-31', val: 900 },
      { fy: 2024, end: '2024-12-31', val: 1000 },
    ]);
  });

  it('sin calendarYear, deriva el año de "date"', () => {
    expect(serieDeFmp([{ date: '2025-09-30', revenue: 500 }], 'revenue'))
      .toEqual([{ fy: 2025, end: '2025-12-31', val: 500 }]);
  });

  it('fila sin año, o con el campo pedido faltante/no numérico → se descarta, no rellena con 0', () => {
    const filas: FilaFmp[] = [
      { calendarYear: '2024' }, // sin revenue
      { calendarYear: '2023', revenue: 'N/A' }, // revenue no numérico
      { revenue: 100 }, // sin año
      { calendarYear: '2022', revenue: 100 }, // válida
    ];
    expect(serieDeFmp(filas, 'revenue')).toEqual([{ fy: 2022, end: '2022-12-31', val: 100 }]);
  });

  it('array vacío o undefined → serie vacía', () => {
    expect(serieDeFmp([], 'revenue')).toEqual([]);
    expect(serieDeFmp(undefined as unknown as FilaFmp[], 'revenue')).toEqual([]);
  });
});

describe('mapearFmpAFundamentals', () => {
  const income: FilaFmp[] = [
    { calendarYear: '2024', revenue: 1000, operatingIncome: 200, netIncome: 150, epsdiluted: 5.5,
      depreciationAndAmortization: 30, incomeTaxExpense: 40, incomeBeforeTax: 190, interestExpense: 10,
      weightedAverageShsOutDil: 27 },
  ];
  const balance: FilaFmp[] = [
    { calendarYear: '2024', totalStockholdersEquity: 800, cashAndCashEquivalents: 300,
      shortTermInvestments: 50, totalDebt: 250 },
  ];
  const cashflow: FilaFmp[] = [
    { calendarYear: '2024', operatingCashFlow: 220, capitalExpenditure: -60, depreciationAndAmortization: 32 },
  ];

  it('mapea los 3 estados a la forma de Fundamentals, un campo de cada endpoint correcto', () => {
    const r = mapearFmpAFundamentals(income, balance, cashflow);
    expect(r.revenue).toEqual([{ fy: 2024, end: '2024-12-31', val: 1000 }]);
    expect(r.ocf).toEqual([{ fy: 2024, end: '2024-12-31', val: 220 }]);
    expect(r.equity).toEqual([{ fy: 2024, end: '2024-12-31', val: 800 }]);
    expect(r.epsDiluted).toEqual([{ fy: 2024, end: '2024-12-31', val: 5.5 }]);
    expect(r.shares).toBe(27);
  });

  it('capex conserva el signo tal cual lo da FMP (negativo = salida de caja) — dcf.ts ya aplica Math.abs()', () => {
    const r = mapearFmpAFundamentals(income, balance, cashflow);
    expect(r.capex).toEqual([{ fy: 2024, end: '2024-12-31', val: -60 }]);
  });

  it('dna prioriza el del estado de flujo de efectivo sobre el de resultados', () => {
    const r = mapearFmpAFundamentals(income, balance, cashflow);
    expect(r.dna[0].val).toBe(32); // el de cashflow (32), no el de income (30)
  });

  it('sin dna en cashflow, cae al de income statement', () => {
    const cfSinDna: FilaFmp[] = [{ calendarYear: '2024', operatingCashFlow: 220, capitalExpenditure: -60 }];
    const r = mapearFmpAFundamentals(income, balance, cfSinDna);
    expect(r.dna).toEqual([{ fy: 2024, end: '2024-12-31', val: 30 }]);
  });

  it('totalDebt usa el campo directo de FMP si está, sin sumar largo+corto de nuevo', () => {
    const r = mapearFmpAFundamentals(income, balance, cashflow);
    expect(r.totalDebt).toEqual([{ fy: 2024, end: '2024-12-31', val: 250 }]);
  });

  it('sin totalDebt directo, lo arma sumando longTermDebt + shortTermDebt', () => {
    const balanceSinTotal: FilaFmp[] = [{ calendarYear: '2024', totalStockholdersEquity: 800, cashAndCashEquivalents: 300, longTermDebt: 180, shortTermDebt: 70 }];
    const r = mapearFmpAFundamentals(income, balanceSinTotal, cashflow);
    expect(r.totalDebt).toEqual([{ fy: 2024, end: '2024-12-31', val: 250 }]);
  });

  it('epsdiluted ausente cae a "eps" básico', () => {
    const sinEpsDiluted: FilaFmp[] = [{ calendarYear: '2024', revenue: 1000, eps: 5.7 }];
    const r = mapearFmpAFundamentals(sinEpsDiluted, balance, cashflow);
    expect(r.epsDiluted).toEqual([{ fy: 2024, end: '2024-12-31', val: 5.7 }]);
  });

  it('campos sin equivalente en FMP (dividendPerShare) quedan vacíos, no inventados', () => {
    const r = mapearFmpAFundamentals(income, balance, cashflow);
    expect(r.dividendPerShare).toEqual([]);
  });

  it('estados vacíos (ticker sin cobertura de FMP tampoco) → todo vacío, shares null, no rompe', () => {
    const r = mapearFmpAFundamentals([], [], []);
    expect(r.revenue).toEqual([]);
    expect(r.ocf).toEqual([]);
    expect(r.shares).toBeNull();
  });
});
