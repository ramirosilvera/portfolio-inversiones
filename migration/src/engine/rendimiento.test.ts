import { describe, it, expect } from 'vitest';
import { rendimientoPorAnio, type Punto } from './rendimiento';

const p = (fecha: string, valor: number, aportado: number): Punto => ({ fecha, valor, aportado });

describe('rendimientoPorAnio — corte por año calendario (pasado, no anualizado)', () => {
  it('año de creación: rendimiento = total sobre lo aportado ese año', () => {
    // Aporté 3000 (neto) en 2026, hoy vale 3245 → +8,17% en 2026 (no anualizado).
    const r = rendimientoPorAnio([p('2026-07-24', 3245, 3000)], 2026, '2026-07-24');
    expect(r).toHaveLength(1);
    expect(r[0].anio).toBe(2026);
    expect(r[0].rendimiento!).toBeCloseTo((3245 - 3000) / 3000, 6);
  });

  it('dos años con snapshots de cierre: cada uno sobre su propia base', () => {
    const pts = [
      p('2025-12-31', 11000, 10000),   // cierre 2025 (nació en 2025 con 10000)
      p('2026-12-31', 14300, 12000),   // cierre 2026 (aportó 2000 más en el año)
    ];
    const r = rendimientoPorAnio(pts, 2025, '2026-12-31');
    expect(r.map(x => x.anio)).toEqual([2025, 2026]);
    expect(r[0].rendimiento!).toBeCloseTo((11000 - 10000) / 10000, 6);                 // +10%
    expect(r[1].rendimiento!).toBeCloseTo((14300 - 11000 - 2000) / (11000 + 2000), 6); // 1300/13000 = +10%
  });

  it('portfolio de años previos SIN snapshots históricos → esos años null (no se inventa)', () => {
    // Nació en 2025, pero solo tenemos el punto de hoy (2026). No podemos partir 2025 vs 2026.
    const r = rendimientoPorAnio([p('2026-07-24', 5500, 4000)], 2025, '2026-07-24');
    expect(r.map(x => x.anio)).toEqual([2025, 2026]);
    expect(r[0].rendimiento).toBeNull();   // 2025: sin cierre real
    expect(r[1].rendimiento).toBeNull();   // 2026: sin apertura (cierre 2025 desconocido)
  });

  it('retiro dentro del año: cuenta como aporte neto negativo', () => {
    const r = rendimientoPorAnio([p('2026-12-31', 4400, 4000)], 2026, '2026-12-31'); // nació 2026, aportó neto 4000
    expect(r[0].rendimiento!).toBeCloseTo((4400 - 4000) / 4000, 6);
  });

  it('sin puntos → todos los años null (rendimiento, aportadoNeto y pnl)', () => {
    const r = rendimientoPorAnio([], 2026, '2026-01-01');
    expect(r).toEqual([{ anio: 2026, rendimiento: null, aportadoNeto: null, pnl: null }]);
  });
});

describe('rendimientoPorAnio — aportadoNeto y pnl (por año, no acumulado histórico)', () => {
  it('año de creación: aportadoNeto = lo aportado ese año, pnl = ganancia en dólares', () => {
    const r = rendimientoPorAnio([p('2026-07-24', 3245, 3000)], 2026, '2026-07-24')[0];
    expect(r.aportadoNeto).toBe(3000);
    expect(r.pnl).toBe(245); // 3245 - 0 - 3000
  });

  it('segundo año: aportadoNeto es SOLO lo que se movió ESE año, no el acumulado histórico', () => {
    const pts = [
      p('2025-12-31', 11000, 10000),
      p('2026-12-31', 14300, 12000), // aportado acumulado pasa de 10000 a 12000 → 2000 netos en 2026
    ];
    const r = rendimientoPorAnio(pts, 2025, '2026-12-31');
    expect(r[1].aportadoNeto).toBe(2000);           // no 12000 (el acumulado)
    expect(r[1].pnl).toBe(14300 - 11000 - 2000);     // 1300
  });

  it('retiro: aportadoNeto negativo', () => {
    const r = rendimientoPorAnio([p('2026-12-31', 4400, 4000)], 2026, '2026-12-31')[0];
    expect(r.aportadoNeto).toBe(4000);
  });

  it('base ≤ 0 invalida el %, pero pnl (dólares) sigue siendo un número real', () => {
    // Vini 100, retiro neto de 150 en el año (base = 100 - 150 = -50 ≤ 0) → rendimiento null,
    // pero la ganancia en dólares (Vfin - Vini - aportadoNeto) sigue teniendo sentido.
    const pts = [p('2025-12-31', 100, 1000), p('2026-06-30', 5, 850)]; // aportadoNeto del año = 850-1000 = -150
    const r = rendimientoPorAnio(pts, 2025, '2026-06-30')[1];
    expect(r.rendimiento).toBeNull();
    expect(r.aportadoNeto).toBe(-150);
    expect(r.pnl).toBe(5 - 100 - (-150)); // 55
  });

  it('con flujos (rama Dietz), snapshot y flujos de acuerdo: aportadoNeto/pnl coinciden con el delta de snapshots', () => {
    const pts = [p('2025-12-31', 100, 100), p('2026-12-31', 1015, 1000)];
    const flujos = [{ fecha: '2026-12-20', monto: 900 }];
    const r = rendimientoPorAnio(pts, 2025, '2026-12-31', flujos)[1];
    expect(r.aportadoNeto).toBe(900); // sumF de los flujos del año — acá coincide con 1000-100 (fNeto)
    expect(r.pnl).toBe(1015 - 100 - 900); // 15 — ganancia real en dólares, sea cual sea el % (Dietz)
  });

  // Caso real que motivó separar aportadoNeto/pnl de fNeto: un snapshot es una FOTO del día que se
  // grabó (whenever el usuario abrió el Dashboard) — si después se carga (o edita, o borra) un
  // aporte con fecha pasada, el snapshot NUNCA se reescribe retroactivamente. `fin.aportado - aIni`
  // (el delta entre snapshots) queda desactualizado, pero la tabla `aportes` (de donde salen los
  // `flujos`) siempre está al día — por eso aportadoNeto/pnl usan `sumF` (los flujos), no el delta.
  it('aporte cargado DESPUÉS de grabarse el snapshot: aportadoNeto/pnl usan los flujos, no el delta de snapshots (que lo "perdería")', () => {
    // El snapshot de cierre 2026 no refleja el aporte (fin.aportado === aIni → fNeto sería 0), pero
    // el aporte SÍ está en la tabla de aportes.
    const pts = [p('2025-12-31', 10000, 10000), p('2026-12-31', 12000, 10000)];
    const flujos = [{ fecha: '2026-06-01', monto: 1500 }];
    const r = rendimientoPorAnio(pts, 2025, '2026-12-31', flujos)[1];
    expect(r.aportadoNeto).toBe(1500); // NO 0 (lo que daría el delta de snapshots)
    expect(r.pnl).toBe(12000 - 10000 - 1500); // 500, no 2000
  });
});

describe('rendimientoPorAnio — Modified Dietz (flujos ponderados por tiempo)', () => {
  it('aporte grande en diciembre NO hunde el rendimiento del año', () => {
    // Vini 100 el 1-ene, aporte de 900 el 20-dic, cierra en 1015.
    // Método simple: (1015−100−900)/1000 = 1,5% (absurdo: el capital real trabajó ~100).
    // Dietz: el aporte pesa solo ~11 días de 364 → base mucho menor → rendimiento realista.
    const pts = [p('2025-12-31', 100, 100), p('2026-12-31', 1015, 1000)];
    const flujos = [{ fecha: '2026-12-20', monto: 900 }];
    const simple = rendimientoPorAnio(pts, 2025, '2026-12-31')[1].rendimiento!;
    const dz = rendimientoPorAnio(pts, 2025, '2026-12-31', flujos)[1].rendimiento!;
    expect(simple).toBeCloseTo(0.015, 3);
    expect(dz).toBeGreaterThan(0.08);
  });

  it('sin flujos dentro del año, Dietz y simple coinciden', () => {
    const pts = [p('2025-12-31', 1000, 1000), p('2026-12-31', 1100, 1000)];
    const sinF = rendimientoPorAnio(pts, 2025, '2026-12-31')[1].rendimiento!;
    const conF = rendimientoPorAnio(pts, 2025, '2026-12-31', [{ fecha: '2025-06-01', monto: 1000 }])[1].rendimiento!;
    expect(sinF).toBeCloseTo(0.10, 6);
    expect(conF).toBeCloseTo(0.10, 6);   // el flujo es de otro año → no afecta 2026
  });

  it('aporte entre el último snapshot del año previo y el 31-dic NO se cuenta como ganancia del año siguiente', () => {
    // Snapshot de apertura 15-oct (no se abrió la app a fin de año), aporte de 500 en noviembre, aporte
    // de 100 en febrero, hoy vale 1700 → ganancia real 100 sobre ~1600 trabajando (~6%), no 600.
    const pts = [p('2025-01-10', 1000, 1000), p('2025-10-15', 1000, 1000), p('2026-10-01', 1700, 1600)];
    const flujos = [{ fecha: '2025-01-10', monto: 1000 }, { fecha: '2025-11-01', monto: 500 }, { fecha: '2026-02-01', monto: 100 }];
    const r2026 = rendimientoPorAnio(pts, 2025, '2026-10-01', flujos)[1];
    expect(r2026.pnl).toBeCloseTo(100, 6);
    expect(r2026.aportadoNeto).toBeCloseTo(600, 6);
    expect(r2026.rendimiento!).toBeGreaterThan(0.05);
    expect(r2026.rendimiento!).toBeLessThan(0.08);
  });

  it('retiro ponderado: rendimiento positivo y razonable', () => {
    const pts = [p('2025-12-31', 1000, 1000), p('2026-12-31', 560, 500)];
    const r = rendimientoPorAnio(pts, 2025, '2026-12-31', [{ fecha: '2026-06-30', monto: -500 }])[1].rendimiento!;
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(0.15);
  });
});

describe('rendimientoPorAnio — año con casi todo el capital recién ingresado (señal `concentrado`)', () => {
  const pts = (rows: string) => rows.split(';').map(r => { const [fecha, valor, aportado] = r.split(','); return { fecha, valor: +valor, aportado: +aportado }; });
  const fl = (rows: string) => rows.split(';').map(r => { const [fecha, monto] = r.split(','); return { fecha, monto: +monto }; });

  // Datos reales de Herencia (04/10/2026): adelanto de 3.000 en julio y 37.000 el 28-29/09.
  const herenciaPts = pts('2026-07-24,2836.51,3000;2026-09-20,3148.26,3000;2026-09-28,29777.29,30000;2026-09-29,39523.49,40000;2026-09-30,39378.31,40000;2026-10-04,39395.88,40000');
  const herenciaFl = fl('2026-07-17,3000;2026-09-28,10000;2026-09-28,15000;2026-09-28,2000;2026-09-29,10000');

  it('Herencia: el % de Dietz NO cambia (método validado), pero se marca no representativo y se da el P&L sobre capital', () => {
    const r = rendimientoPorAnio(herenciaPts, 2026, '2026-10-04', herenciaFl)[0];
    expect(r.pnl).toBeCloseTo(39395.88 - 40000, 6);                 // −604,12
    expect(r.rendimiento).toBeCloseTo(-0.1063, 3);                    // Dietz: base ponderada diminuta
    expect(r.concentrado).toBe(true);
    expect(r.pnlSobreCapital).toBeCloseTo(-604.12 / 40000, 6);        // −1,51% del capital aportado
  });

  it('Ahorros 2026 (aportes repartidos en el año): sin señal', () => {
    const ahorrosPts = pts('2025-12-31,9361.76,6319.91;2026-07-24,11312.33,9030.74;2026-08-04,11885.28,13030.74;2026-08-20,22834.83,20262.63;2026-09-07,18548.58,15774.63;2026-09-28,16657.57,14424.63;2026-10-04,16455.42,14424.63');
    const ahorrosFl = fl('2025-06-02,6319.91;2026-03-02,862.83;2026-06-01,1848;2026-08-04,2000;2026-08-04,2000;2026-08-13,2621;2026-08-14,820;2026-08-14,1822;2026-08-19,1968.89;2026-09-07,-1884.96;2026-09-07,-714;2026-09-07,-1889.04;2026-09-25,650;2026-09-28,-2000');
    const r = rendimientoPorAnio(ahorrosPts, 2025, '2026-10-04', ahorrosFl).find(x => x.anio === 2026)!;
    expect(r.concentrado).toBeUndefined();
    expect(r.rendimiento).not.toBeNull();
  });

  it('el caso sintético "aporte grande en diciembre" también se marca (la señal no toca el número)', () => {
    const r = rendimientoPorAnio([{ fecha: '2025-12-31', valor: 100, aportado: 100 }, { fecha: '2026-12-31', valor: 1015, aportado: 1000 }], 2025, '2026-12-31', [{ fecha: '2026-12-20', monto: 900 }])[1];
    expect(r.rendimiento!).toBeGreaterThan(0.08);
    expect(r.concentrado).toBe(true);
  });
});

