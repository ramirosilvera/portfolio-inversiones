import { describe, it, expect } from 'vitest';
import { calcularBonoReferencia, comparables, tirPromedioComparables, type BonoReferencia, type BonoReferenciaCalc } from './rentaFija';
import type { CronogramaItem } from './coupons';
import type { GradoCredito } from './rating';

const cronograma: CronogramaItem[] = [
  { fecha: '2027-01-24', interes: 0.03, amortizacion: 0, saldo_residual: 1 },
  { fecha: '2027-07-24', interes: 0.03, amortizacion: 1, saldo_residual: 0 },
];

const ref: BonoReferencia = {
  ticker: 'TEST30',
  tipo: 'soberano',
  instrumento: 'BOND',
  moneda: 'USD',
  nombre: 'Test bond',
  emisor: 'Test Corp',
  emision: '2020-01-01',
  vencimiento: '2027-07-24',
  amortizable: false,
  valor_residual: 1,
  cronograma,
  fuente: 'IOL',
  actualizado_en: '2026-08-01T00:00:00Z',
  calificadora: 'S&P',
  calificacion: 'BB+',
};

describe('calcularBonoReferencia', () => {
  it('sin precio de mercado: paridad/tir/duracion null, pero conserva la referencia', () => {
    const r = calcularBonoReferencia(ref, null, '2026-07-24');
    expect(r.ref).toBe(ref);
    expect(r.px).toBeNull();
    expect(r.paridad).toBeNull();
    expect(r.tir).toBeNull();
    expect(r.duracion).toBeNull();
  });

  it('con precio: paridad = px*100, tir y duración calculadas', () => {
    const r = calcularBonoReferencia(ref, 0.9, '2026-07-24');
    expect(r.paridad).toBeCloseTo(90, 6);
    expect(r.tir).not.toBeNull();
    expect(r.tir!).toBeGreaterThan(0);
    expect(r.duracion).not.toBeNull();
    expect(r.duracion!.macaulay).toBeGreaterThan(0);
    expect(r.duracion!.modified).toBeLessThan(r.duracion!.macaulay);
  });

  it('bono ya vencido (cronograma sin flujos futuros): tir/duracion/rendCorriente null, no rompe', () => {
    const r = calcularBonoReferencia(ref, 0.9, '2030-01-01');
    expect(r.tir).toBeNull();
    expect(r.duracion).toBeNull();
    expect(r.rendCorriente).toBeNull();
  });

  it('rendCorriente: cupón anualizado (frecuencia inferida de los 2 próximos flujos) / precio', () => {
    // 2 pagos semestrales de 0.03 (frecuencia ≈ 2/año) → cupón anualizado ≈ 0.06. A precio 0.9,
    // rendCorriente ≈ 0.06/0.9 ≈ 0.0667.
    const r = calcularBonoReferencia(ref, 0.9, '2026-07-24');
    expect(r.rendCorriente).not.toBeNull();
    expect(r.rendCorriente!).toBeCloseTo(0.0667, 2);
  });

  it('sin precio de mercado: rendCorriente null', () => {
    const r = calcularBonoReferencia(ref, null, '2026-07-24');
    expect(r.rendCorriente).toBeNull();
  });

  it('reusa clasificarRating: BB+ (S&P) es especulativo, escala global', () => {
    const r = calcularBonoReferencia(ref, 0.9, '2026-07-24');
    expect(r.grado).toBe('especulativo');
    expect(r.escalaGrado).toBe('global');
  });

  it('sin calificadora/calificación cargada: grado/escala null, nunca inventa un grado', () => {
    const sinRating: BonoReferencia = { ...ref, calificadora: null, calificacion: null };
    const r = calcularBonoReferencia(sinRating, 0.9, '2026-07-24');
    expect(r.grado).toBeNull();
    expect(r.escalaGrado).toBeNull();
  });
});

// Mock liviano: comparables()/tirPromedioComparables() solo leen ref.ticker, tir, duracion.macaulay
// y grado — no hace falta un cronograma real ni pasar por calcularBonoReferencia() para testearlos.
function mockCalc(ticker: string, tir: number | null, macaulay: number | null, grado: GradoCredito | null): BonoReferenciaCalc {
  return {
    ref: { ...ref, ticker }, px: 0.9, paridad: 90, tir,
    duracion: macaulay != null ? { macaulay, modified: macaulay / 1.1 } : null,
    rendCorriente: null, grado, escalaGrado: grado != null ? 'global' : null,
  };
}

describe('comparables', () => {
  const target = mockCalc('TARGET', 0.08, 5, 'especulativo');

  it('excluye al propio ticker y a los que no tienen TIR', () => {
    const universo = [target, mockCalc('SINTIR', null, 5, 'especulativo')];
    expect(comparables(target, universo)).toHaveLength(0);
  });

  it('prioriza mismo grado, ordenado por duración más cercana al target', () => {
    const lejos = mockCalc('LEJOS', 0.09, 12, 'especulativo');      // mismo grado, duración lejana
    const cerca = mockCalc('CERCA', 0.07, 5.5, 'especulativo');     // mismo grado, duración muy cercana
    const otroGrado = mockCalc('OTRO', 0.20, 5, 'default');         // duración idéntica pero grado distinto
    const r = comparables(target, [lejos, cerca, otroGrado]);
    expect(r.map(c => c.ref.ticker)).toEqual(['CERCA', 'LEJOS', 'OTRO']);
    expect(r.find(c => c.ref.ticker === 'CERCA')!.mismoGrado).toBe(true);
    expect(r.find(c => c.ref.ticker === 'OTRO')!.mismoGrado).toBe(false);
  });

  it('si no hay suficientes del mismo grado, completa con el grado MÁS CERCANO (no cualquiera)', () => {
    const unico = mockCalc('UNICO', 0.09, 5, 'especulativo');           // mismo grado — el único
    const inversion = mockCalc('INVERSION', 0.06, 5, 'grado_inversion'); // 1 escalón de distancia
    const enDefault = mockCalc('DEFAULT', 0.30, 5, 'default');           // 1 escalón de distancia (para abajo)
    const r = comparables(target, [unico, inversion, enDefault], 2);
    expect(r).toHaveLength(2);
    expect(r[0].ref.ticker).toBe('UNICO');
    expect(r[0].mismoGrado).toBe(true);
    expect(r[1].mismoGrado).toBe(false);
  });

  it('bono sin calificar se compara contra otros sin calificar, nunca contra un grado conocido como si fueran iguales', () => {
    const sinCalificar = mockCalc('SC1', 0.10, 5, null);
    const target2 = mockCalc('TARGET2', 0.08, 5, null);
    const conRating = mockCalc('CR1', 0.10, 5, 'grado_inversion');
    const r = comparables(target2, [sinCalificar, conRating]);
    expect(r[0].ref.ticker).toBe('SC1');
    expect(r[0].mismoGrado).toBe(true);
    expect(r[1].mismoGrado).toBe(false);
  });
});

describe('tirPromedioComparables', () => {
  it('promedia solo los del mismo grado (ignora el relleno)', () => {
    const comps = comparables(mockCalc('T', 0.08, 5, 'especulativo'), [
      mockCalc('A', 0.10, 5, 'especulativo'),
      mockCalc('B', 0.06, 5, 'especulativo'),
      mockCalc('C', 0.50, 5, 'default'),
    ]);
    expect(tirPromedioComparables(comps)).toBeCloseTo(0.08, 6); // (0.10+0.06)/2, sin contar 'C'
  });

  it('sin comparables del mismo grado: null', () => {
    const comps = comparables(mockCalc('T', 0.08, 5, 'especulativo'), [mockCalc('C', 0.50, 5, 'default')]);
    expect(tirPromedioComparables(comps)).toBeNull();
  });
});
