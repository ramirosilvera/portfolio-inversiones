import { describe, it, expect } from 'vitest';
import {
  indiceTwr, twrAcumulado, anualizar, maxDrawdown, calidadSerie, cierreAl, benchmarkConMismosFlujos, indiceBenchmark,
  resumenCostos, calcularDesempeno, MIN_DIAS_ANUALIZAR,
} from './desempeno';

const v = (fecha: string, valor: number) => ({ fecha, valor });
const f = (fecha: string, monto: number) => ({ fecha, monto });

describe('indiceTwr — neutraliza aportes y retiros', () => {
  it('sin flujos: encadena los cambios de valor', () => {
    const { serie } = indiceTwr([v('2026-01-01', 100), v('2026-01-02', 110), v('2026-01-03', 99)], []);
    expect(serie.map(s => +s.indice.toFixed(4))).toEqual([1, 1.1, 0.99]);
  });
  it('un aporte NO es rendimiento: 100 → 160 con 50 aportados = +10 %, no +60 %', () => {
    const { serie } = indiceTwr([v('2026-01-01', 100), v('2026-01-02', 160)], [f('2026-01-02', 50)]);
    expect(serie[1].indice).toBeCloseTo(1.1, 10);
  });
  it('un retiro NO es una caída: 100 → 40 con 50 retirados = −10 %, no −60 %', () => {
    const { serie } = indiceTwr([v('2026-01-01', 100), v('2026-01-02', 40)], [f('2026-01-02', -50)]);
    expect(serie[1].indice).toBeCloseTo(0.9, 10);
  });
  it('los flujos anteriores o iguales al primer punto ya están en su valor', () => {
    const { serie } = indiceTwr([v('2026-01-05', 100), v('2026-01-06', 105)], [f('2026-01-05', 100), f('2026-01-01', 50)]);
    expect(serie[1].indice).toBeCloseTo(1.05, 10);
  });
  it('un aporte registrado mayor al valor final no define rendimiento: se saltea y se cuenta como anomalía', () => {
    const r = indiceTwr([v('2026-01-01', 100), v('2026-01-02', 10)], [f('2026-01-02', 50)]);
    expect(r.anomalias).toBe(1);
    expect(r.serie).toHaveLength(1);
  });
  it('ignora puntos inválidos o sin valor', () => {
    const { serie } = indiceTwr([v('2026-01-01', 100), v('xx', 5), v('2026-01-02', 0), v('2026-01-03', 120)], []);
    expect(serie).toHaveLength(2);
    expect(serie[1].indice).toBeCloseTo(1.2, 10);
  });
});

describe('twrAcumulado / anualizar', () => {
  it('acumulado = último índice / primero − 1', () => {
    expect(twrAcumulado([{ fecha: 'a', indice: 1 }, { fecha: 'b', indice: 1.21 }])).toBeCloseTo(0.21, 10);
    expect(twrAcumulado([{ fecha: 'a', indice: 1 }])).toBeNull();
  });
  it('no anualiza por debajo de un año (sería extrapolar)', () => {
    expect(anualizar(0.05, 200)).toBeNull();
    expect(anualizar(0.05, MIN_DIAS_ANUALIZAR - 1)).toBeNull();
  });
  it('con 2 años, +21 % acumulado = +10 % anual', () => {
    expect(anualizar(0.21, 730)).toBeCloseTo(0.1, 3);
  });
  it('un retorno ≤ −100 % no se anualiza', () => {
    expect(anualizar(-1, 800)).toBeNull();
  });
});

describe('maxDrawdown', () => {
  const s = (vals: number[]) => vals.map((x, i) => ({ fecha: `2026-01-${String(i + 1).padStart(2, '0')}`, indice: x }));
  it('mayor caída de pico a mínimo posterior, con fechas', () => {
    const r = maxDrawdown(s([1, 1.2, 0.9, 1.0, 1.1]))!;
    expect(r.mdd).toBeCloseTo(0.9 / 1.2 - 1, 10);   // −25 %
    expect(r.fechaPico).toBe('2026-01-02');
    expect(r.fechaMinimo).toBe('2026-01-03');
    expect(r.fechaRecuperacion).toBeNull();          // no volvió a 1,2
    expect(r.enCurso).toBe(true);
  });
  it('registra la recuperación cuando el índice vuelve al pico', () => {
    const r = maxDrawdown(s([1, 1.2, 0.9, 1.25]))!;
    expect(r.fechaRecuperacion).toBe('2026-01-04');
    expect(r.enCurso).toBe(false);
  });
  it('serie siempre creciente: caída 0 y sin fechas', () => {
    const r = maxDrawdown(s([1, 1.1, 1.2]))!;
    expect(r.mdd).toBe(0);
    expect(r.fechaPico).toBeNull();
  });
  it('menos de dos puntos → null', () => {
    expect(maxDrawdown(s([1]))).toBeNull();
  });
  it('toma la PEOR caída, no la primera', () => {
    const r = maxDrawdown(s([1, 0.95, 1.1, 0.77, 1]))!;
    expect(r.mdd).toBeCloseTo(0.77 / 1.1 - 1, 10);
  });
});

describe('calidadSerie', () => {
  it('serie diaria sin huecos es confiable', () => {
    const c = calidadSerie([v('2026-01-01', 1), v('2026-01-02', 1), v('2026-01-05', 1)]);
    expect(c.confiable).toBe(true);
    expect(c.maxHueco).toBe(3);
  });
  it('un hueco de más de una semana la vuelve no confiable y lo lista (caso real: 205 días)', () => {
    const c = calidadSerie([v('2025-12-31', 1), v('2026-07-24', 1)]);
    expect(c.confiable).toBe(false);
    expect(c.huecos).toEqual([{ desde: '2025-12-31', hasta: '2026-07-24', dias: 205 }]);
  });
  it('un solo punto no alcanza', () => {
    expect(calidadSerie([v('2026-01-01', 1)]).confiable).toBe(false);
  });
});

describe('benchmark con tus mismos flujos', () => {
  const sp = [{ f: '2026-01-01', c: 100 }, { f: '2026-07-01', c: 150 }, { f: '2027-01-01', c: 200 }];
  it('cierreAl usa el último cierre ≤ fecha y no inventa fuera de cobertura', () => {
    expect(cierreAl(sp, '2026-03-01')).toBe(100);
    expect(cierreAl(sp, '2026-07-01')).toBe(150);
    expect(cierreAl(sp, '2025-06-01')).toBeNull();          // la serie empieza después
  });
  it('un aporte único se duplica si el índice se duplica', () => {
    const r = benchmarkConMismosFlujos(sp, [f('2026-01-01', 1000)], '2027-01-01')!;
    expect(r.valorFinal).toBeCloseTo(2000, 6);
    expect(r.rendimientoPeriodo).toBeCloseTo(1, 6);
    expect(r.tir).toBeCloseTo(1, 1);                         // un año exacto: ~100 %
  });
  it('dos aportes: el segundo entra más caro', () => {
    const r = benchmarkConMismosFlujos(sp, [f('2026-01-01', 1000), f('2026-07-01', 1500)], '2027-01-01')!;
    expect(r.valorFinal).toBeCloseTo(10 * 200 + 10 * 200, 6);    // 10 unidades a 100 + 10 a 150 = 20 u × 200
    expect(r.valorFinal).toBeCloseTo(4000, 6);
  });
  it('un retiro vende unidades', () => {
    const r = benchmarkConMismosFlujos(sp, [f('2026-01-01', 1000), f('2026-07-01', -750)], '2027-01-01')!;
    expect(r.valorFinal).toBeCloseTo(5 * 200, 6);                // 10 u − 5 u
  });
  it('sin cobertura en la fecha de un flujo → null (no se estima)', () => {
    expect(benchmarkConMismosFlujos(sp, [f('2025-01-01', 1000)], '2027-01-01')).toBeNull();
  });
  it('indiceBenchmark: diario y en fechas puntuales', () => {
    expect(indiceBenchmark(sp, '2026-01-01', '2027-01-01').map(p => p.indice)).toEqual([1, 1.5, 2]);
    expect(indiceBenchmark(sp, '2026-01-01', '2027-01-01', ['2026-07-01', '2027-01-01']).map(p => p.indice)).toEqual([1.5, 2]);
  });
});

describe('resumenCostos', () => {
  it('suma USD, y convierte los pesos SOLO si hay tipo de cambio registrado', () => {
    const r = resumenCostos([
      { monto_usd: 1000, comision_usd: 3, comision_ars: 1500, mep: 1500 },   // 1 USD
      { monto_usd: 500, comision_usd: 1.5, comision_ars: 750, mep: null },   // sin tipo de cambio
    ]);
    expect(r.comisionUsd).toBe(4.5);
    expect(r.comisionArsConvertidaUsd).toBe(1);
    expect(r.comisionArsSinConvertirPesos).toBe(750);
    expect(r.totalUsdConocido).toBe(5.5);
    expect(r.pctSobreOperado).toBeCloseTo(5.5 / 1500, 8);
  });
  it('vacío', () => {
    expect(resumenCostos([]).pctSobreOperado).toBeNull();
  });
});

describe('calcularDesempeno', () => {
  const sp = [{ f: '2025-01-01', c: 100 }, { f: '2025-07-01', c: 90 }, { f: '2026-07-01', c: 130 }, { f: '2027-01-01', c: 150 }];
  const dias = (n: number, ini = '2025-01-01') => { const d = new Date(Date.parse(ini) + n * 86_400_000); return d.toISOString().slice(0, 10); };

  it('menos de un año: no anualiza (ni TWR ni TIR), pero sí el acumulado', () => {
    const r = calcularDesempeno({
      puntos: [v('2026-01-01', 1000), v('2026-03-01', 1100)], flujos: [f('2026-01-01', 1000)], valorActual: 1100, hoy: '2026-03-01',
      serieSp: null, ordenes: [],
    });
    expect(r.periodo.menorAUnAnio).toBe(true);
    expect(r.twr.acumulado).toBeCloseTo(0.1, 10);
    expect(r.twr.anualizado).toBeNull();
    expect(r.tir.anualizada).toBeNull();
    expect(r.tir.acumulada).toBeCloseTo(0.1, 10);
    expect(r.benchmark).toBeNull();
  });

  it('dos años de historia diaria: anualiza, compara con el índice y mide la máxima caída de ambos', () => {
    // Cartera: aporta 1000 el día 0, vale 1000 → 800 → 1300 (dd −20 %).
    const puntos = [v(dias(0), 1000), v(dias(180), 800), v(dias(540), 1100), v(dias(730), 1300)];
    const hoy = dias(730);
    const r = calcularDesempeno({
      puntos, flujos: [f(dias(0), 1000)], valorActual: 1300, hoy,
      serieSp: [{ f: dias(0), c: 100 }, { f: dias(180), c: 90 }, { f: dias(540), c: 130 }, { f: dias(730), c: 150 }],
      ordenes: [],
    });
    expect(r.twr.acumulado).toBeCloseTo(0.3, 6);
    expect(r.twr.anualizado).toBeCloseTo(Math.pow(1.3, 365 / 730) - 1, 6);
    expect(r.tir.anualizada).toBeCloseTo(Math.pow(1.3, 365 / 730) - 1, 3);
    expect(r.cartera.mdd!.mdd).toBeCloseTo(-0.2, 6);
    expect(r.cartera.mdd!.fechaPico).toBe(dias(0));
    expect(r.cartera.mdd!.fechaMinimo).toBe(dias(180));
    expect(r.calidad.confiable).toBe(false);                   // hay huecos de 360 y 190 días
    expect(r.cartera.rotuloMinimoConocido).toBe(true);
    expect(r.benchmark!.mismosFlujos.valorFinal).toBeCloseTo(1500, 6);
    expect(r.benchmark!.diferenciaValor).toBeCloseTo(1300 - 1500, 6);
    expect(r.benchmark!.mddDiario!.mdd).toBeCloseTo(-0.1, 6);
  });

  it('la TIR neta resta SOLO las comisiones en pesos con tipo de cambio registrado', () => {
    const puntos = [v(dias(0), 1000), v(dias(400), 1200)];
    const base = { puntos, flujos: [f(dias(0), 1000)], valorActual: 1200, hoy: dias(400), serieSp: null };
    const sinCostos = calcularDesempeno({ ...base, ordenes: [] });
    const conCostos = calcularDesempeno({ ...base, ordenes: [{ monto_usd: 1000, comision_usd: 5, comision_ars: 15000, mep: 1500 }] });   // 10 USD no reflejados
    expect(sinCostos.tir.neta).toBeCloseTo(sinCostos.tir.anualizada!, 10);
    expect(conCostos.tir.neta!).toBeLessThan(conCostos.tir.anualizada!);
    expect(conCostos.costos.comisionArsConvertidaUsd).toBe(10);
  });
});

describe('indiceTwr — snapshot desfasado del aporte', () => {
  it('un aporte grande sin reflejo en el valor no se lee como caída: se omite y se cuenta', () => {
    const r = indiceTwr(
      [{ fecha: '2026-08-03', valor: 11885 }, { fecha: '2026-08-04', valor: 11885 }, { fecha: '2026-08-20', valor: 22834 }],
      [{ fecha: '2026-08-04', monto: 4000 }],
    );
    expect(r.anomalias).toBe(2);
    expect(Math.min(...r.serie.map(s => s.indice))).toBeGreaterThan(0.9);
  });
});

describe('indiceTwr — tramos diferidos', () => {
  it('dos tramos absurdos por un snapshot desfasado se resuelven juntos y no cuentan como anomalía', () => {
    // El aporte de 4000 (04/08) no estaba en el valor de ese día; el valor del 20/08 sí incluye todo.
    const r = indiceTwr(
      [v('2026-08-03', 11885), v('2026-08-04', 11885), v('2026-08-20', 17700)],
      [f('2026-08-04', 4000), f('2026-08-13', 2000)],
    );
    expect(r.anomalias).toBe(0);
    expect(r.serie[r.serie.length - 1].indice).toBeCloseTo((17700 - 6000) / 11885, 10);
  });
  it('si nunca se resuelve, queda como anomalía', () => {
    expect(indiceTwr([v('2026-01-01', 100), v('2026-01-02', 10)], [f('2026-01-02', 50)]).anomalias).toBe(1);
  });
});

describe('calcularDesempeno — ventana única', () => {
  const dias = (n: number) => new Date(Date.parse('2025-01-01') + n * 86_400_000).toISOString().slice(0, 10);
  it('el primer aporte anterior al primer valor diario NO entra: la TIR y el índice parten del primer valor', () => {
    const r = calcularDesempeno({
      puntos: [v(dias(200), 1500), v(dias(700), 1800)],
      flujos: [f(dias(0), 1000)],                               // aporte importado, sin valores diarios
      valorActual: 1800, hoy: dias(700),
      serieSp: [{ f: dias(0), c: 100 }, { f: dias(200), c: 150 }, { f: dias(700), c: 165 }], ordenes: [],
    });
    expect(r.twr.acumulado).toBeCloseTo(0.2, 10);
    expect(r.tir.anualizada).toBeCloseTo(Math.pow(1.2, 365 / 500) - 1, 3);
    expect(r.benchmark!.mismosFlujos.valorFinal).toBeCloseTo(1500 / 150 * 165, 6);     // 1650: capital inicial = 1500 el día 200
    expect(r.benchmark!.diferenciaValor).toBeCloseTo(150, 6);
    expect(r.benchmark!.twrBenchmark).toBeCloseTo(0.1, 10);                              // mismo período que el TWR de la cartera
  });
});

describe('calcularDesempeno — capital concentrado (caso Herencia)', () => {
  it('un aporte grande reciente marca el % ponderado como no representativo y deja la ganancia sobre el capital', () => {
    const r = calcularDesempeno({
      puntos: [v('2026-07-24', 2836), v('2026-09-20', 3148), v('2026-09-28', 29777), v('2026-09-29', 39523), v('2026-10-17', 40183)],
      flujos: [f('2026-07-17', 3000), f('2026-09-28', 27000), f('2026-09-29', 10000)],
      valorActual: 40183, hoy: '2026-10-17', serieSp: null, ordenes: [],
    });
    expect(r.twr.concentrado).toBe(true);
    expect(r.tir.invertido).toBeCloseTo(2836 + 37000, 6);
    expect(r.tir.acumulada).toBeCloseTo((40183 - 39836) / 39836, 6);
  });
  it('capital estable en el tiempo no es concentrado', () => {
    const r = calcularDesempeno({
      puntos: [v('2026-01-01', 1000), v('2026-07-01', 1100)], flujos: [f('2026-01-01', 1000)], valorActual: 1100, hoy: '2026-07-01', serieSp: null, ordenes: [],
    });
    expect(r.twr.concentrado).toBe(false);
  });
});

describe('indiceTwr — aporte mayor al valor previo', () => {
  it('re-ancla el índice sin inventar una caída por el costo de ejecutar el aporte', () => {
    const r = indiceTwr([v('2026-09-20', 3148), v('2026-09-28', 29777), v('2026-09-29', 29900)], [f('2026-09-28', 27000)]);
    expect(r.anomalias).toBe(1);
    expect(r.serie.map(s => s.indice)[1]).toBe(1);                       // el tramo del aporte no mueve el índice
    expect(r.serie[2].indice).toBeCloseTo(29900 / 29777, 10);            // desde ahí rinde normal
  });
});
