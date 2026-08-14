import { describe, it, expect } from 'vitest';
import type { Fundamentals, AnnualPoint } from '../types/domain';
import { computeRatios, eg5y } from './ratios';
import { computeDcf, ownerEarningsByYear, sensitivityTable, dcfDefaultsFor, normalizarOwnerEarnings, DEFAULT_DCF_INPUTS, OE_METHOD_DEFAULT, G_MAX, esCompraAgresiva, MARGEN_COMPRA_AGRESIVA } from './dcf';

const P = (vals: [number, number][]): AnnualPoint[] =>
  vals.map(([fy, val]) => ({ fy, end: `${fy}-06-30`, val }));

// Fixture tipo MSFT (montos en millones USD, FY2020–2024 aprox).
const MSFT: Fundamentals = {
  ticker: 'MSFT', cik: '0000789019', entityName: 'MICROSOFT CORP', shares: 7430,
  ocf:            P([[2020,60675],[2021,76740],[2022,89035],[2023,87582],[2024,118548]]),
  netIncome:      P([[2020,44281],[2021,61271],[2022,72738],[2023,72361],[2024,88136]]),
  dna:            P([[2020,12796],[2021,11686],[2022,14460],[2023,13861],[2024,22287]]),
  capex:          P([[2020,15441],[2021,20622],[2022,23886],[2023,28107],[2024,44477]]),
  revenue:        P([[2020,143015],[2021,168088],[2022,198270],[2023,211915],[2024,245122]]),
  operatingIncome:P([[2020,52959],[2021,69916],[2022,83383],[2023,88523],[2024,109433]]),
  epsDiluted:     P([[2020,5.76],[2021,8.05],[2022,9.65],[2023,9.68],[2024,11.80]]),
  dividendPerShare:P([[2024,3.00]]),
  equity:         P([[2024,268477]]),
  totalDebt:      P([[2024,97000]]),
  cash:           P([[2024,18315]]),
  shortTermInvestments: P([[2024,57228]]),
  taxes:          P([[2024,19651]]),
  pretaxIncome:   P([[2024,107700]]),
};

describe('ratios', () => {
  const r = computeRatios(MSFT, 420, 0.9, 0.043);
  it('EG5Y = CAGR real del EPS, positivo', () => {
    expect(r.eg5y).toBeGreaterThan(0.1);   // eps 5.76→11.80 en 4 años ≈ 19%/año
    expect(r.eg5y).toBeCloseTo((11.80 / 5.76) ** (1 / 4) - 1, 5);
  });
  it('P/E, ROIC, márgenes razonables', () => {
    expect(r.pe).toBeCloseTo(420 / 11.80, 4);
    expect(r.roic!).toBeGreaterThan(0.15);
    expect(r.roic!).toBeLessThan(0.6);
    expect(r.operatingMargin!).toBeCloseTo(109433 / 245122, 4);
    expect(r.payout!).toBeCloseTo(3.0 / 11.80, 4);
  });
  it('tasa impositiva efectiva dentro de guarda [0,0.6]', () => {
    expect(r.effectiveTaxRate).toBeCloseTo(19651 / 107700, 4);
  });
  it('Ke (costOfEquity) = rf + beta*0.05; WACC real ≤ Ke (ponderado con deuda más barata)', () => {
    expect(r.costOfEquity).toBeCloseTo(0.043 + 0.9 * 0.05, 6);
    expect(r.wacc).not.toBeNull();
    expect(r.wacc!).toBeLessThanOrEqual(r.costOfEquity! + 1e-9);
    expect(r.wacc!).toBeGreaterThan(0);
  });
  it('dcfDefaultsFor: g = EG5Y − 1pto ACOTADO (≤ G_MAX y < d), d = Ke, gt 3%, N 20, MoS 20%', () => {
    const def = dcfDefaultsFor(r);  // redondea a 4 decimales
    // MSFT: EG5Y ≈ 19,6% y WACC ≈ 8,7%. Sin tope, g=18,6% > d → 20 años de composición hacia
    // arriba → valor intrínseco inflado y COMPRAR falso. El default se acota por debajo de d.
    expect(def.g).toBeCloseTo(Math.min(Math.max(0, (r.eg5y ?? 0) - 0.01), G_MAX, def.d - 0.01), 4);
    expect(def.g).toBeLessThan(def.d);
    // d = Ke (CAPM), NO WACC: los owner earnings son flujo del accionista y no se resta deuda
    // neta, así que descontar al WACC (más bajo) sobrevaluaría a las empresas apalancadas.
    expect(def.d).toBeCloseTo(Math.max(0.06, r.costOfEquity!), 4);
    expect(def.d).toBeGreaterThanOrEqual(r.wacc!);   // Ke ≥ WACC cuando hay deuda
    expect(def.gt).toBe(0.03);
    expect(def.N).toBe(20);
    expect(def.mosRequired).toBe(0.20);
  });
});

describe('ratios — deuda rezagada respecto del balance (caso KO)', () => {
  // Fixture: equity/caja/EPS ya en FY2025 pero totalDebt clavado en FY2023 (etiqueta XBRL que EDGAR
  // dejó de encontrar). Sin la guarda, ratios.ts mezclaría un balance de 2025 con deuda de 2023.
  const base: Fundamentals = {
    ticker: 'KO', cik: '0000021344', entityName: 'THE COCA-COLA CO', shares: 4302,
    ocf: P([[2023, 11201], [2024, 11602], [2025, 12000]]),
    netIncome: P([[2023, 10714], [2024, 10631], [2025, 11000]]),
    dna: P([[2023, 1602], [2024, 1600], [2025, 1650]]),
    capex: P([[2023, 2247], [2024, 2331], [2025, 2400]]),
    revenue: P([[2023, 45754], [2024, 47061], [2025, 47941]]),
    operatingIncome: P([[2023, 11311], [2024, 11311], [2025, 11500]]),
    epsDiluted: P([[2023, 2.47], [2024, 2.46], [2025, 2.55]]),
    dividendPerShare: P([[2025, 1.94]]),
    equity: P([[2023, 24846], [2024, 25332], [2025, 26000]]),
    totalDebt: P([[2021, 38116], [2022, 36377], [2023, 37507]]),   // congelado en FY2023
    cash: P([[2023, 10707], [2024, 10794], [2025, 11000]]),
    shortTermInvestments: P([]),
    taxes: P([[2025, 2400]]),
    pretaxIncome: P([[2025, 13400]]),
    interestExpense: P([[2025, 1900]]),
  };
  const r = computeRatios(base, 70, 0.6, 0.043);

  it('debtToEquity, netDebtToEbitda y ROIC quedan en null (no mezclan FY2025 con deuda de FY2023)', () => {
    expect(r.debtToEquity).toBeNull();
    expect(r.netDebtToEbitda).toBeNull();
    expect(r.roic).toBeNull();
  });
  it('WACC degrada con gracia a Ke (solo equity), no explota ni usa deuda vieja', () => {
    expect(r.wacc).toBeCloseTo(r.costOfEquity!, 6);
  });
  it('el resto de los ratios (que no dependen de deuda) sigue calculándose normal', () => {
    expect(r.pe).not.toBeNull();
    expect(r.operatingMargin).not.toBeNull();
    expect(r.eg5y).not.toBeNull();
  });
  it('si equity también está rezagado (mismo año que la deuda), no es "stale" — se usa la deuda igual', () => {
    const alineado: Fundamentals = { ...base, equity: P([[2021, 22138], [2022, 25941], [2023, 24846]]) };
    const r2 = computeRatios(alineado, 70, 0.6, 0.043);
    expect(r2.debtToEquity).not.toBeNull();
    expect(r2.debtToEquity).toBeCloseTo(37507 / 24846, 6);
  });
});

describe('owner earnings + DCF', () => {
  it('owner earnings = OCF − capex mantenimiento; growth capex separado', () => {
    const oe = ownerEarningsByYear(MSFT, 'dna');
    expect(oe).toHaveLength(5);
    const y2024 = oe.find(y => y.fy === 2024)!;
    expect(y2024.maintenanceCapex).toBe(22287);           // método D&A
    expect(y2024.growthCapex).toBe(44477 - 22287);        // capex total − mantenimiento
    expect(y2024.ownerEarnings).toBe(118548 - 22287);
  });

  it('DCF da valor intrínseco positivo y terminal < 100%', () => {
    const d = computeDcf(MSFT, 420, 0.088, DEFAULT_DCF_INPUTS);
    expect(d.intrinsicPerShare!).toBeGreaterThan(0);
    expect(d.terminalShare).toBeGreaterThan(0);
    expect(d.terminalShare).toBeLessThan(1);
    expect(['COMPRAR', 'ESPERAR', 'CARO']).toContain(d.verdict);
  });

  it('mayor g → mayor valor (monotonicidad)', () => {
    const low = computeDcf(MSFT, null, null, { ...DEFAULT_DCF_INPUTS, g: 0.04 }).intrinsicPerShare!;
    const high = computeDcf(MSFT, null, null, { ...DEFAULT_DCF_INPUTS, g: 0.12 }).intrinsicPerShare!;
    expect(high).toBeGreaterThan(low);
  });

  it('mayor tasa de descuento → menor valor', () => {
    const cheap = computeDcf(MSFT, null, null, { ...DEFAULT_DCF_INPUTS, d: 0.08 }).intrinsicPerShare!;
    const strict = computeDcf(MSFT, null, null, { ...DEFAULT_DCF_INPUTS, d: 0.14 }).intrinsicPerShare!;
    expect(strict).toBeLessThan(cheap);
  });

  it('chequeo Munger: g ≤ CAGR histórico', () => {
    const d = computeDcf(MSFT, 420, 0.088, { ...DEFAULT_DCF_INPUTS, g: 0.30 });
    const check = d.mungerChecks.find(c => c.label.includes('CAGR histórico'))!;
    expect(check.ok).toBe(false);   // g 30% > CAGR histórico de OE
  });

  it('owner earnings negativos → SIN_DATOS, no COMPRAR', () => {
    const bad: Fundamentals = {
      ...MSFT,
      // OCF < capex de mantenimiento (D&A) todos los años → owner earnings negativos
      ocf:   P([[2020,5000],[2021,4000],[2022,3000],[2023,2000],[2024,1000]]),
      dna:   P([[2020,12000],[2021,12000],[2022,12000],[2023,12000],[2024,12000]]),
      capex: P([[2020,15000],[2021,15000],[2022,15000],[2023,15000],[2024,15000]]),
    };
    const d = computeDcf(bad, 100, 0.088, DEFAULT_DCF_INPUTS);
    expect(d.ownerEarningsNorm).toBeLessThan(0);
    expect(d.verdict).toBe('SIN_DATOS');
    expect(d.intrinsicPerShare).toBeNull();
    expect(d.marginOfSafety).toBeNull();
  });

  it('ROIC null si el capital invertido es ≤ 0 (cash-rich)', () => {
    const cashRich: Fundamentals = {
      ...MSFT,
      equity:    P([[2024,10000]]),
      totalDebt: P([[2024,0]]),
      cash:      P([[2024,50000]]),  // cash > equity+deuda → invested capital negativo
    };
    const r = computeRatios(cashRich, 420, 0.9, 0.043);
    expect(r.roic).toBeNull();
  });

  it('sensibilidad: monótona en g y d', () => {
    const t = sensitivityTable(MSFT, 0.088, DEFAULT_DCF_INPUTS, [0.04, 0.08, 0.12], [0.08, 0.10, 0.12]);
    expect(t).toHaveLength(3);
    // subiendo g (filas) sube el valor para una misma d
    expect(t[2].cells[0]!).toBeGreaterThan(t[0].cells[0]!);
    // subiendo d (columnas) baja el valor para una misma g
    expect(t[0].cells[2]!).toBeLessThan(t[0].cells[0]!);
  });
});

describe('computeDcf — gate de estabilidad (no afirmar COMPRAR con supuestos frágiles)', () => {
  it('g >= d: NO devuelve COMPRAR aunque el MoS sea altísimo, y explica por qué', () => {
    // g 25% > d 10% a 20 años infla el valor intrínseco → antes daba COMPRAR falso.
    const r = computeDcf(MSFT, 420, 0.10, { ...DEFAULT_DCF_INPUTS, g: 0.25, d: 0.10, N: 20 });
    expect(r.marginOfSafety!).toBeGreaterThan(0.20);   // el MoS "da" para comprar…
    expect(r.verdict).not.toBe('COMPRAR');             // …pero el gate lo degrada
    expect(r.verdict).toBe('ESPERAR');
    expect(r.motivoInestable).toMatch(/g .* ≥ d/);
  });

  it('g < d y terminal razonable: el veredicto normal sigue funcionando', () => {
    const r = computeDcf(MSFT, 1, 0.09, { ...DEFAULT_DCF_INPUTS, g: 0.06, d: 0.09, N: 10 });
    expect(r.motivoInestable).toBeNull();
    expect(r.verdict).toBe('COMPRAR');   // precio irrisorio → MoS enorme, sin inestabilidad
  });

  it('dcfDefaultsFor acota g: nunca por encima de G_MAX ni de d', () => {
    const base = computeRatios(MSFT, 420, 0.9, 0.043);
    const growth = dcfDefaultsFor({ ...base, eg5y: 0.45, costOfEquity: 0.09 });  // EPS CAGR 45%
    expect(growth.g).toBeLessThanOrEqual(G_MAX);
    expect(growth.g).toBeLessThan(growth.d);
  });
});

describe('computeDcf — robustez ante supuestos corruptos (no debe colgar ni dar NaN)', () => {
  it('N enorme se acota (no cuelga el render) y devuelve valor finito', () => {
    const r = computeDcf(MSFT, 420, 0.088, { ...DEFAULT_DCF_INPUTS, N: 1e9 });
    expect(Number.isFinite(r.intrinsicValue)).toBe(true);
    expect(r.intrinsicPerShare == null || Number.isFinite(r.intrinsicPerShare)).toBe(true);
  });
  it('N/g/d no finitos caen a defaults y no propagan NaN', () => {
    const r = computeDcf(MSFT, 420, 0.088, { ...DEFAULT_DCF_INPUTS, N: NaN, g: Infinity, d: NaN });
    expect(Number.isFinite(r.intrinsicValue)).toBe(true);
  });
});

describe('ownerEarningsByYear — no descartar años por falta de capex (caso MELI)', () => {
  // MELI real: EDGAR trae OCF y D&A hasta 2025 pero el capex se corta en 2023. Con el método 'dna'
  // (default) el capex NO se usa, así que 2024/2025 deben entrar igual.
  const MELI: Fundamentals = {
    ...MSFT, ticker: 'MELI',
    ocf:   P([[2021, 965], [2022, 2940], [2023, 5140], [2024, 7918], [2025, 12116]]),
    dna:   P([[2021, 204], [2022, 403], [2023, 524], [2024, 617], [2025, 818]]),
    capex: P([[2021, 573], [2022, 454], [2023, 509]]),   // sin 2024/2025
  };

  it("método 'dna': incluye los años sin capex y normaliza sobre el nivel real", () => {
    const oe = ownerEarningsByYear(MELI, 'dna');
    expect(oe.map(y => y.fy)).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(oe.at(-1)!.ownerEarnings).toBe(12116 - 818);   // 2025 entra
    const d = computeDcf(MELI, 2000, 0.10, DEFAULT_DCF_INPUTS);
    // Antes, al caerse 2024/2025, normalizaba sobre años viejos y chicos (~2.000); ahora refleja el nivel actual.
    expect(d.ownerEarningsNorm).toBeGreaterThan(4000);
  });

  it("método 'capex': sí exige capex, así que solo usa los años que lo tienen", () => {
    const oe = ownerEarningsByYear(MELI, 'capex');
    expect(oe.map(y => y.fy)).toEqual([2021, 2022, 2023]);
  });

  it('growthCapex es 0 cuando no se conoce el capex del año (no se inventa)', () => {
    const oe = ownerEarningsByYear(MELI, 'dna');
    expect(oe.find(y => y.fy === 2025)!.growthCapex).toBe(0);
    expect(oe.find(y => y.fy === 2023)!.growthCapex).toBe(509 - 524);
  });
});

describe('normalizarOwnerEarnings — ponderado por recencia', () => {
  it('serie plana: igual al promedio simple', () => {
    expect(normalizarOwnerEarnings([100, 100, 100, 100, 100], 'ponderado')).toBeCloseTo(100, 9);
  });

  it('serie creciente: queda por ENCIMA del promedio simple pero por debajo del último año', () => {
    const serie = [761, 2537, 4616, 7301, 11298];            // MELI real (owner earnings, M USD)
    const simple = serie.reduce((a, b) => a + b, 0) / serie.length;
    const pond = normalizarOwnerEarnings(serie, 'ponderado');
    expect(pond).toBeGreaterThan(simple);                     // no castiga el crecimiento
    expect(pond).toBeLessThan(serie.at(-1)!);                 // sigue siendo conservador
    expect(pond).toBeCloseTo(105377 / 15, 6);                 // pesos 1..5 → suma 15
  });

  it('un año atípico puntual no domina (sigue normalizando)', () => {
    const conPico = normalizarOwnerEarnings([100, 100, 900, 100, 100], 'ponderado');
    expect(conPico).toBeLessThan(300);   // el pico se suaviza
    expect(conPico).toBeGreaterThan(100);
  });

  it('serie decreciente: por DEBAJO del promedio simple (refleja el deterioro)', () => {
    const serie = [1000, 800, 600, 400, 200];
    const simple = serie.reduce((a, b) => a + b, 0) / serie.length;
    expect(normalizarOwnerEarnings(serie, 'ponderado')).toBeLessThan(simple);
  });

  it('serie vacía → 0', () => { expect(normalizarOwnerEarnings([])).toBe(0); });
});

describe('normalizarOwnerEarnings — métodos elegibles', () => {
  const meli = [761, 2537, 4616, 7301, 11298];   // creciente (MELI real)
  const ciclica = [1000, 200, 1500, 300, 1400];  // cíclica: el último año no representa el ciclo
  const conCargo = [1000, 1050, 100, 1100, 1150]; // un año con cargo puntual

  it("'ultimo' toma el año más reciente", () => {
    expect(normalizarOwnerEarnings(meli, 'ultimo')).toBe(11298);
  });

  it("en una creciente: ultimo > ponderado > prom5 (el orden esperado)", () => {
    const u = normalizarOwnerEarnings(meli, 'ultimo');
    const p = normalizarOwnerEarnings(meli, 'ponderado');
    const c = normalizarOwnerEarnings(meli, 'prom5');
    expect(u).toBeGreaterThan(p);
    expect(p).toBeGreaterThan(c);
  });

  it("'prom5' en una cíclica promedia el ciclo (no capitaliza el pico)", () => {
    expect(normalizarOwnerEarnings(ciclica, 'prom5')).toBeCloseTo(880, 6);
    expect(normalizarOwnerEarnings(ciclica, 'ultimo')).toBe(1400);   // capitalizar esto sería un error
  });

  it("'mediana5' ignora el año atípico; el promedio no", () => {
    expect(normalizarOwnerEarnings(conCargo, 'mediana5')).toBe(1050);
    expect(normalizarOwnerEarnings(conCargo, 'prom5')).toBeLessThan(1000);   // el cargo lo arrastra
  });

  it("'prom3' usa solo los últimos 3", () => {
    expect(normalizarOwnerEarnings(meli, 'prom3')).toBeCloseTo((4616 + 7301 + 11298) / 3, 6);
  });

  it('sin método explícito (guardados viejos) sigue el DEFAULT actual, no un valor fijo', () => {
    expect(OE_METHOD_DEFAULT).toBe('ultimo');
    expect(normalizarOwnerEarnings(meli)).toBeCloseTo(normalizarOwnerEarnings(meli, OE_METHOD_DEFAULT), 9);
  });

  it('los defaults del DCF traen el método por defecto (una sola fuente de verdad)', () => {
    expect(DEFAULT_DCF_INPUTS.oeMethod).toBe(OE_METHOD_DEFAULT);
    const base = computeRatios(MSFT, 420, 0.9, 0.043);
    expect(dcfDefaultsFor(base).oeMethod).toBe(OE_METHOD_DEFAULT);
  });

  it('computeDcf respeta el método elegido: ultimo da mayor valor que prom5', () => {
    const conUltimo = computeDcf(MSFT, 420, 0.09, { ...DEFAULT_DCF_INPUTS, oeMethod: 'ultimo' });
    const conProm5 = computeDcf(MSFT, 420, 0.09, { ...DEFAULT_DCF_INPUTS, oeMethod: 'prom5' });
    expect(conUltimo.ownerEarningsNorm).toBeGreaterThan(conProm5.ownerEarningsNorm);
    expect(conUltimo.intrinsicPerShare!).toBeGreaterThan(conProm5.intrinsicPerShare!);
  });
});

describe("guard de BASE: 'ultimo' inflado no puede dar COMPRAR", () => {
  // El valor intrínseco es LINEAL en la base, así que un año atípico se come el margen de seguridad
  // y ninguno de los otros chequeos lo ve (todos son invariantes de escala).
  const pico: Fundamentals = {
    ...MSFT,
    ocf: P([[2020, 10000], [2021, 10000], [2022, 10000], [2023, 10000], [2024, 30000]]),
    dna: P([[2020, 1000], [2021, 1000], [2022, 1000], [2023, 1000], [2024, 1000]]),
    capex: P([[2020, 1000], [2021, 1000], [2022, 1000], [2023, 1000], [2024, 1000]]),
  };

  it("con 'ultimo' y un año 3x sobre la mediana: bloquea COMPRAR y explica", () => {
    const r = computeDcf(pico, 1, 0.09, { ...DEFAULT_DCF_INPUTS, g: 0.05, d: 0.09, oeMethod: 'ultimo' });
    expect(r.verdict).not.toBe('COMPRAR');
    expect(r.motivoInestable).toMatch(/último año/);
  });

  it("el mismo caso con 'mediana5' no se bloquea (la base ya está normalizada)", () => {
    const r = computeDcf(pico, 1, 0.09, { ...DEFAULT_DCF_INPUTS, g: 0.05, d: 0.09, oeMethod: 'mediana5' });
    expect(r.motivoInestable).toBeNull();
    expect(r.verdict).toBe('COMPRAR');
  });

  it("'ultimo' en una empresa que CRECE SANO no se bloquea (evita el falso positivo)", () => {
    // MSFT real: el último año está 31% sobre la mediana solo porque viene creciendo. Comparar
    // contra la mediana lo marcaría mal; lo que importa es si el salto se sale de su tendencia.
    const r = computeDcf(MSFT, 1, 0.09, { ...DEFAULT_DCF_INPUTS, g: 0.05, d: 0.09, oeMethod: 'ultimo' });
    expect(r.motivoInestable).toBeNull();
    expect(r.verdict).toBe('COMPRAR');
  });
});

describe("método 'margen': normaliza rentabilidad sin perder escala", () => {
  it('sin rezago: usa las ventas del último año', () => {
    // margen OE/ventas estable 20%; ventas crecen. La base debe ser ~20% de las ventas de HOY.
    const crece: Fundamentals = {
      ...MSFT,
      revenue: P([[2020, 1000], [2021, 2000], [2022, 4000], [2023, 8000], [2024, 16000]]),
      ocf:     P([[2020, 300], [2021, 600], [2022, 1200], [2023, 2400], [2024, 4800]]),
      dna:     P([[2020, 100], [2021, 200], [2022, 400], [2023, 800], [2024, 1600]]),
      capex:   P([[2020, 100], [2021, 200], [2022, 400], [2023, 800], [2024, 1600]]),
    };
    const r = computeDcf(crece, 100, 0.09, { ...DEFAULT_DCF_INPUTS, oeMethod: 'margen' });
    expect(r.ownerEarningsNorm).toBeCloseTo(0.20 * 16000, 6);   // margen 20% × ventas de hoy
    // El ponderado, en cambio, arrastra los años chicos:
    const pond = computeDcf(crece, 100, 0.09, { ...DEFAULT_DCF_INPUTS, oeMethod: 'ponderado' });
    expect(pond.ownerEarningsNorm).toBeLessThan(r.ownerEarningsNorm);
  });

  it('sin ventas para emparejar cae al ponderado (no inventa)', () => {
    const sinVentas: Fundamentals = { ...MSFT, revenue: [] };
    const r = computeDcf(sinVentas, 420, 0.09, { ...DEFAULT_DCF_INPUTS, oeMethod: 'margen' });
    const pond = computeDcf(sinVentas, 420, 0.09, { ...DEFAULT_DCF_INPUTS, oeMethod: 'ponderado' });
    expect(r.ownerEarningsNorm).toBeCloseTo(pond.ownerEarningsNorm, 9);
  });
});

describe('esCompraAgresiva — estándar Buffett de margen de seguridad amplio', () => {
  it('COMPRAR con margen ≥50% (default) → true', () => {
    expect(esCompraAgresiva({ verdict: 'COMPRAR', marginOfSafety: 0.5 })).toBe(true);
    expect(esCompraAgresiva({ verdict: 'COMPRAR', marginOfSafety: 0.62 })).toBe(true);
  });

  it('COMPRAR pero margen por debajo del umbral → false (barato no alcanza, tiene que ser AMPLIO)', () => {
    expect(esCompraAgresiva({ verdict: 'COMPRAR', marginOfSafety: 0.21 })).toBe(false);
  });

  it('margen amplio pero verdict no es COMPRAR (ej. base inestable) → false', () => {
    expect(esCompraAgresiva({ verdict: 'ESPERAR', marginOfSafety: 0.6 })).toBe(false);
    expect(esCompraAgresiva({ verdict: 'CARO', marginOfSafety: 0.6 })).toBe(false);
  });

  it('sin dato de margen → false, nunca true por defecto', () => {
    expect(esCompraAgresiva({ verdict: 'SIN_DATOS', marginOfSafety: null })).toBe(false);
  });

  it('umbral personalizado', () => {
    expect(esCompraAgresiva({ verdict: 'COMPRAR', marginOfSafety: 0.35 }, 0.3)).toBe(true);
    expect(esCompraAgresiva({ verdict: 'COMPRAR', marginOfSafety: 0.25 }, 0.3)).toBe(false);
  });

  it('MARGEN_COMPRA_AGRESIVA es 50%', () => {
    expect(MARGEN_COMPRA_AGRESIVA).toBe(0.5);
  });
});
