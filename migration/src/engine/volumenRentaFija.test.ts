import { describe, it, expect } from 'vitest';
import { statsVolumen, evaluarOperabilidad, volumenStatsFromRef, type BarraVolumen } from './volumenRentaFija';

// Subconjunto real de las barras de MIC3D (20/jul–19/ago/2026, IOL get_price_history) — verificado
// en vivo, no inventado: rango de volumen nominal 675–322.295 en 21 ruedas.
const MIC3D: BarraVolumen[] = [
  { fecha: '2026-07-31', volumenNominal: 675 },
  { fecha: '2026-08-06', volumenNominal: 2339 },
  { fecha: '2026-08-12', volumenNominal: 9910 },
  { fecha: '2026-08-13', volumenNominal: 322295 },
  { fecha: '2026-08-19', volumenNominal: 18151 },
];
const PX_MIC3D = 1.003; // precioActual = px (fracción del nominal), no paridad (que ya es ×100)

describe('statsVolumen', () => {
  it('convierte volumen nominal a USD con la MISMA fórmula que paridad (nominal × precio)', () => {
    const s = statsVolumen([{ fecha: '2026-08-19', volumenNominal: 18151 }], PX_MIC3D);
    expect(s?.mediaUsd).toBeCloseTo(18151 * 1.003, 2);
  });

  it('mediana y mínimo se calculan sobre USD, no sobre el nominal crudo', () => {
    const s = statsVolumen(MIC3D, PX_MIC3D)!;
    const usd = MIC3D.map(b => b.volumenNominal * PX_MIC3D).sort((a, b) => a - b);
    expect(s.minimoUsd).toBeCloseTo(usd[0], 2);
    expect(s.medianaUsd).toBeCloseTo(usd[2], 2); // 5 valores → el del medio
    expect(s.diasConDatos).toBe(5);
  });

  it('sin barras, o sin precio válido → null (no inventa un cero)', () => {
    expect(statsVolumen([], PX_MIC3D)).toBeNull();
    expect(statsVolumen(MIC3D, null)).toBeNull();
    expect(statsVolumen(MIC3D, 0)).toBeNull();
    expect(statsVolumen(MIC3D, -1)).toBeNull();
  });
});

describe('evaluarOperabilidad — calibrado para un inversor minorista (tickets US$500-5.000), no institucional', () => {
  const stats = statsVolumen(MIC3D, PX_MIC3D)!; // minimo ≈ US$677, mediana ≈ US$9.940

  it('verde: el monto entra holgado incluso en el peor día reciente (≤20% del mínimo)', () => {
    expect(evaluarOperabilidad(100, stats)).toBe('verde'); // 100 ≤ 0.2×677 ≈ 135
  });

  it('amarillo: supera el peor día, pero sigue por debajo de un día típico (mediana)', () => {
    expect(evaluarOperabilidad(2000, stats)).toBe('amarillo'); // 677 < 2000 ≤ 9940
  });

  it('rojo: supera incluso la mediana — porción grande de un día típico', () => {
    expect(evaluarOperabilidad(20000, stats)).toBe('rojo');
  });

  it('caso real: un ticket minorista de US$5.000 en el peor día reciente de MIC3D supera TODO lo operado ese día', () => {
    // El hallazgo que motivó el umbral: el peor día (675 nominal × 1.003 ≈ US$677) es MENOR a un
    // ticket típico de este inversor (US$5.000) — la regla institucional de %ADV nunca hubiera
    // detectado esto, porque un ticket de $5.000 es minúsculo frente al PROMEDIO (~US$27.700).
    expect(stats.minimoUsd).toBeLessThan(5000);
    expect(evaluarOperabilidad(5000, stats)).not.toBe('verde');
  });

  it('un bono líquido (GD30D-like: mínimo ~US$847k) es verde hasta para montos institucionales, no solo minoristas', () => {
    const liquido = statsVolumen(
      [{ fecha: '2026-08-13', volumenNominal: 847255 }, { fecha: '2026-08-18', volumenNominal: 6003979 }],
      0.5741,
    )!;
    expect(evaluarOperabilidad(5000, liquido)).toBe('verde');
    expect(evaluarOperabilidad(50000, liquido)).toBe('verde');
  });

  it('mínimo en 0 (día registrado sin operatoria real dentro de la ventana) nunca da verde para un monto positivo', () => {
    const conDiaEnCero = statsVolumen([{ fecha: '2026-08-01', volumenNominal: 0 }, { fecha: '2026-08-02', volumenNominal: 1000 }], 1);
    expect(evaluarOperabilidad(1, conDiaEnCero!)).not.toBe('verde');
  });
});

describe('volumenStatsFromRef — arma VolumenStats desde las columnas ya reducidas de bonos_referencia', () => {
  it('con las 4 columnas presentes, arma el mismo objeto que statsVolumen (sin recalcular nada)', () => {
    expect(volumenStatsFromRef({ vol_media_usd: 100, vol_mediana_usd: 90, vol_minimo_usd: 50, vol_dias_con_datos: 20 }))
      .toEqual({ mediaUsd: 100, medianaUsd: 90, minimoUsd: 50, diasConDatos: 20 });
  });

  it('catálogo todavía no refrescado con esta feature (columnas null) → null, no inventa ceros', () => {
    expect(volumenStatsFromRef({ vol_media_usd: null, vol_mediana_usd: null, vol_minimo_usd: null, vol_dias_con_datos: null })).toBeNull();
  });

  it('falta una sola columna → null igual (no arma un stats a medias)', () => {
    expect(volumenStatsFromRef({ vol_media_usd: 100, vol_mediana_usd: 90, vol_minimo_usd: 50, vol_dias_con_datos: null })).toBeNull();
  });
});
