import { describe, it, expect } from 'vitest';
import { rendimientoPorAnio } from './rendimiento';
import {
  presupuestoMensual, realMensual, cruzar, reproyectar, valorAlHorizonte, tasaMensual, sumarMeses, finDeMes, calcularForecast, llegadaAMeta, analisisMeta, retornoObjetivo, aporteNecesarioParaMeta,
  type Presupuesto,
} from './presupuesto';

const B: Presupuesto = { inicio: '2026-01', valorInicial: 10_000, aporteAnual: 1_200, tasaAnual: 0.12, anios: 3, edadInicial: 40, fijadoEn: '2026-01-02' };

describe('fechas', () => {
  it('sumarMeses cruza años y finDeMes respeta bisiestos', () => {
    expect(sumarMeses('2026-11', 3)).toBe('2027-02');
    expect(sumarMeses('2026-01', 11)).toBe('2026-12');
    expect(sumarMeses('2026-03', -3)).toBe('2025-12');
    expect(finDeMes('2028-02')).toBe('2028-02-29');
    expect(finDeMes('2026-02')).toBe('2026-02-28');
  });
});

describe('presupuestoMensual', () => {
  it('retorno 0: valor = inicial + aportes', () => {
    const r = presupuestoMensual({ ...B, tasaAnual: 0 });
    expect(r).toHaveLength(12);
    expect(r[0].valor).toBeCloseTo(10_100, 9);
    expect(r[11].valor).toBeCloseTo(11_200, 9);
    expect(r[11].periodo).toBe('2026-12');
  });
  it('la tasa mensual compone a la anual', () => {
    expect(Math.pow(1 + tasaMensual(0.12), 12)).toBeCloseTo(1.12, 12);
  });
  it('sin aportes, el mes 12 es inicial × (1+r)', () => {
    const r = presupuestoMensual({ ...B, aporteAnual: 0 });
    expect(r[11].valor).toBeCloseTo(10_000 * 1.12, 6);
  });
});

describe('realMensual', () => {
  const puntos = [
    { fecha: '2026-01-31', valor: 10_300 }, { fecha: '2026-02-28', valor: 10_450 },
    { fecha: '2026-03-10', valor: 10_600 }, { fecha: '2026-03-20', valor: 10_700 },
  ];
  const flujos = [{ fecha: '2026-01-15', monto: 100 }, { fecha: '2026-02-10', monto: -30 }, { fecha: '2026-03-05', monto: 200 }, { fecha: '2026-03-25', monto: 999 }];
  const real = realMensual(B, puntos, flujos, '2026-03-22');

  it('toma el último snapshot del mes y los flujos firmados; meses futuros quedan vacíos', () => {
    expect(real[0]).toMatchObject({ valor: 10_300, aporte: 100, parcial: false, futuro: false });
    expect(real[1]).toMatchObject({ valor: 10_450, aporte: -30 });
    // marzo es el mes en curso: último snapshot ≤ hoy (20/03) y flujos hasta hoy (el del 25/03 no cuenta)
    expect(real[2]).toMatchObject({ valor: 10_700, aporte: 200, parcial: true });
    expect(real[3]).toMatchObject({ futuro: true, valor: null, aporte: null });
  });
  it('un mes sin snapshot arrastra el último conocido y lo marca estimado; antes del primero no hay dato', () => {
    const r = realMensual(B, [{ fecha: '2026-02-10', valor: 10_500 }], [], '2026-04-15');
    expect(r[0].valor).toBeNull();
    expect(r[1]).toMatchObject({ valor: 10_500, valorEstimado: false });
    expect(r[2]).toMatchObject({ valor: 10_500, valorEstimado: true });
  });
});

describe('cruzar', () => {
  it('el desvío total = desvío por aportes + desvío por mercado, en cada período', () => {
    const ppto = presupuestoMensual(B);
    const puntos = [{ fecha: '2026-01-31', valor: 10_500 }, { fecha: '2026-02-28', valor: 10_300 }, { fecha: '2026-03-31', valor: 11_000 }];
    const flujos = [{ fecha: '2026-01-10', monto: 300 }, { fecha: '2026-03-10', monto: -50 }];
    const c = cruzar(ppto, realMensual(B, puntos, flujos, '2026-03-31'));
    for (const f of c.slice(0, 3)) {
      expect(f.desvio).not.toBeNull();
      expect(f.desvioAportes! + f.desvioMercado!).toBeCloseTo(f.desvio!, 9);
    }
    // enero: aporte real 300 vs 100 presupuestado → +200 por aportes
    expect(c[0].desvioAportes).toBeCloseTo(200, 9);
    // febrero: aportes acumulados 300 vs 200 → +100
    expect(c[1].desvioAportes).toBeCloseTo(100, 9);
    // marzo: acumulado 250 vs 300 → −50
    expect(c[2].desvioAportes).toBeCloseTo(-50, 9);
    expect(c[2].desvioPct).toBeCloseTo((11_000 - ppto[2].valor) / ppto[2].valor, 12);
    // meses sin dato real: sin desvío
    expect(c[3].desvio).toBeNull();
  });
  it('si el real coincide exacto con el presupuesto, todos los desvíos son 0', () => {
    const ppto = presupuestoMensual(B);
    const puntos = ppto.map(p => ({ fecha: `${p.periodo}-28`, valor: p.valor }));
    const flujos = ppto.map(p => ({ fecha: `${p.periodo}-15`, monto: p.aporte }));
    const c = cruzar(ppto, realMensual(B, puntos, flujos, '2026-12-31'));
    for (const f of c) { expect(f.desvio).toBeCloseTo(0, 6); expect(f.desvioAportes).toBeCloseTo(0, 6); expect(f.desvioMercado).toBeCloseTo(0, 6); }
  });
});

describe('reproyectar', () => {
  const ppto = presupuestoMensual(B);
  const puntos = [{ fecha: '2026-01-31', valor: 10_500 }, { fecha: '2026-02-28', valor: 10_700 }];
  const flujos = [{ fecha: '2026-01-10', monto: 300 }, { fecha: '2026-02-10', monto: 100 }];
  const real = realMensual(B, puntos, flujos, '2026-02-28');

  it('modo presupuesto: arranca del último real y aporta A/12 con el retorno presupuestado', () => {
    const r = reproyectar(B, ppto, real, 'presupuesto')!;
    expect(r.ultimoRealK).toBe(2);
    expect(r.aporteMensualUsado).toBeCloseTo(100, 9);
    expect(r.meses[1]).toMatchObject({ valor: 10_700, proyectado: false });
    const rm = tasaMensual(0.12);
    expect(r.meses[2].valor).toBeCloseTo(10_700 * (1 + rm) + 100, 9);
    expect(r.meses[2].proyectado).toBe(true);
    expect(r.meses).toHaveLength(12);
  });
  it('modo ritmo: usa el aporte real promedio (400/2 = 200 por mes)', () => {
    const r = reproyectar(B, ppto, real, 'ritmo')!;
    expect(r.aporteMensualUsado).toBeCloseTo(200, 9);
    const r2 = reproyectar(B, ppto, real, 'presupuesto')!;
    expect(r.valorHorizonte).toBeGreaterThan(r2.valorHorizonte);   // aporta más → llega más alto
  });
  it('si lo real va exactamente según presupuesto, el forecast al horizonte coincide con el presupuesto', () => {
    const pts = ppto.map(p => ({ fecha: `${p.periodo}-28`, valor: p.valor }));
    const fl = ppto.map(p => ({ fecha: `${p.periodo}-15`, monto: p.aporte }));
    const rl = realMensual(B, pts.slice(0, 4), fl.slice(0, 4), '2026-04-30');
    const r = reproyectar(B, ppto, rl, 'presupuesto')!;
    expect(r.difHorizonte).toBeCloseTo(0, 6);
    expect(r.valorMes12).toBeCloseTo(ppto[11].valor, 6);
  });
  it('un mal arranque se arrastra al horizonte: el forecast cae por debajo del presupuesto', () => {
    const rl = realMensual(B, [{ fecha: '2026-03-31', valor: 9_000 }], [], '2026-03-31');
    const r = reproyectar(B, ppto, rl, 'presupuesto')!;
    expect(r.difHorizonte).toBeLessThan(0);
  });
  it('sin ningún dato real no hay reproyección', () => {
    expect(reproyectar(B, ppto, realMensual(B, [], [], '2026-02-28'), 'presupuesto')).toBeNull();
  });
  it('valorAlHorizonte con 1 año es el cierre del mes 12', () => {
    expect(valorAlHorizonte(5_000, 1_200, 0.1, 1)).toBe(5_000);
    expect(valorAlHorizonte(5_000, 1_200, 0.1, 2)).toBeCloseTo(5_000 * 1.1 + 1_200, 9);
  });
});

describe('calcularForecast', () => {
  it('arma presupuesto, cruce, último mes con dato y reproyección con los mismos números que las piezas por separado', () => {
    const puntos = [{ fecha: '2026-01-31', valor: 10_500 }, { fecha: '2026-02-28', valor: 10_700 }];
    const flujos = [{ fecha: '2026-01-10', monto: 300 }];
    const f = calcularForecast(B, puntos, flujos, '2026-02-28');
    expect(f.ppto).toHaveLength(12);
    expect(f.ultimo?.periodo).toBe('2026-02');
    expect(f.ultimo?.valorReal).toBe(10_700);
    const ppto = presupuestoMensual(B);
    const real = realMensual(B, puntos, flujos, '2026-02-28');
    expect(f.cruce).toEqual(cruzar(ppto, real));
    expect(f.repro).toEqual(reproyectar(B, ppto, real, 'presupuesto'));
  });
  it('sin datos reales: ultimo y repro son null (la tarjeta muestra el estado vacío)', () => {
    const f = calcularForecast(B, [], [], '2026-02-28');
    expect(f.ultimo).toBeNull();
    expect(f.repro).toBeNull();
  });
});

describe('mes en curso parcial (hallazgos F1/F2 de la auditoría)', () => {
  it('si el real va exactamente al ritmo presupuestado a mitad de mes, el desvío es 0 (no −1/12 del anual)', () => {
    const hoy = '2026-01-16';                       // 16/31 del mes
    const f = 16 / 31;
    const ppto = presupuestoMensual(B);
    const valorEsperadoHoy = B.valorInicial + (ppto[0].valor - B.valorInicial) * f;
    const c = calcularForecast(B, [{ fecha: hoy, valor: valorEsperadoHoy }], [{ fecha: '2026-01-10', monto: (B.aporteAnual / 12) * f }], hoy);
    const u = c.ultimo!;
    expect(u.parcial).toBe(true);
    expect(u.valorPpto).toBeCloseTo(valorEsperadoHoy, 9);
    expect(u.desvio).toBeCloseTo(0, 9);
    expect(u.desvioAportes).toBeCloseTo(0, 9);
    // sin el prorrateo, el desvío habría sido −(valor del fin de mes − valor de hoy), claramente negativo
    expect(ppto[0].valor - valorEsperadoHoy).toBeGreaterThan(40);
  });

  it("modo ritmo: el mes parcial pesa su fracción (900 en 3 meses + 4/30 de abril sin aportes ≈ 290/mes, no 225)", () => {
    const hoy = '2026-04-04';
    const flujos = [{ fecha: '2026-01-10', monto: 300 }, { fecha: '2026-02-10', monto: 300 }, { fecha: '2026-03-10', monto: 300 }];
    const puntos = [{ fecha: '2026-01-31', valor: 10_300 }, { fecha: '2026-02-28', valor: 10_600 }, { fecha: '2026-03-31', valor: 10_900 }, { fecha: hoy, valor: 10_950 }];
    const r = calcularForecast(B, puntos, flujos, hoy, 'ritmo').repro!;
    expect(r.aporteMensualUsado).toBeCloseTo(900 / (3 + 4 / 30), 9);
    expect(r.aporteMensualUsado).toBeGreaterThan(285);
  });

  it('modo ritmo con menos de 1 mes de historia: no extrapola, usa lo presupuestado', () => {
    const hoy = '2026-01-04';
    const r = calcularForecast(B, [{ fecha: hoy, valor: 10_020 }], [{ fecha: '2026-01-02', monto: 1_000 }], hoy, 'ritmo').repro!;
    expect(r.aporteMensualUsado).toBeCloseTo(B.aporteAnual / 12, 9);
  });

  it('reproyección en mes parcial: el cierre del mes proyecta solo lo que falta del mes', () => {
    const hoy = '2026-01-16';
    const f = 16 / 31, rm = tasaMensual(B.tasaAnual);
    const r = calcularForecast(B, [{ fecha: hoy, valor: 10_200 }], [], hoy, 'presupuesto').repro!;
    const finDeEneroEsperado = 10_200 * Math.pow(1 + rm, 1 - f) + (B.aporteAnual / 12) * (1 - f);
    expect(r.meses[0].proyectado).toBe(true);
    expect(r.meses[0].valor).toBeCloseTo(finDeEneroEsperado, 9);
    expect(r.meses[1].valor).toBeCloseTo(finDeEneroEsperado * (1 + rm) + B.aporteAnual / 12, 9);
  });
});

describe('objetivo de capital: cuándo se llega', () => {
  // Verificación independiente: bucle anual simple (con aporte 0 la composición mensual equivale a la anual).
  const aniosHasta = (v0: number, A: number, r: number, meta: number) => { let v = v0, n = 0; while (v < meta && n < 200) { v = v * (1 + r) + A; n++; } return n; };

  it('Herencia (sin aportes): 8,5% llega a US$300.000 en 25 años (2051); con −2 pp en 33 (2059) y NO dentro del horizonte de 30', () => {
    const b = { inicio: '2026-10', valorInicial: 39_378, aporteAnual: 0, tasaAnual: 0.085, anios: 30 };
    const a = analisisMeta(b, 300_000, 39_396)!;
    expect(aniosHasta(39_378, 0, 0.085, 300_000)).toBe(25);
    expect(a.presupuesto.llegada).toEqual({ meses: 300, anio: 2051 });
    expect(a.presupuesto.dentroDelHorizonte).toBe(true);
    const [menos, base, mas] = a.sensibilidad;
    expect(aniosHasta(39_378, 0, 0.065, 300_000)).toBe(33);
    expect(menos.llegada).toEqual({ meses: 396, anio: 2059 });
    expect(menos.dentroDelHorizonte).toBe(false);          // 33 años > 30: la meta no se cumple en el horizonte
    expect(menos.valorHorizonte).toBeLessThan(300_000);
    expect(base.llegada).toEqual(a.presupuesto.llegada);
    expect(mas.llegada.anio!).toBeLessThan(base.llegada.anio!);
    expect(menos.llegada.anio!).toBeGreaterThan(base.llegada.anio!);   // menos retorno → más tarde
  });

  it('con aportes: Ahorros (10%, US$4.800/año) llega a US$1.000.000 cerca del año 30, consistente con el bucle anual', () => {
    const b = { inicio: '2026-10', valorInicial: 16_507, aporteAnual: 4_800, tasaAnual: 0.10, anios: 40 };
    const a = analisisMeta(b, 1_000_000, 16_455)!;
    const n = aniosHasta(16_507, 4_800, 0.10, 1_000_000);
    // los aportes mensuales rinden dentro del año → el resultado mensual puede adelantarse a lo sumo 1 año al bucle anual
    const anios = a.presupuesto.llegada.meses! / 12;
    expect(anios).toBeLessThanOrEqual(n);
    expect(anios).toBeGreaterThanOrEqual(n - 1);
    expect(a.presupuesto.dentroDelHorizonte).toBe(true);
  });

  it('llegada dentro de los primeros 12 meses, meta ya alcanzada y casos que nunca llegan', () => {
    const b = { inicio: '2026-10', valorInicial: 1_000, aporteAnual: 1_200, tasaAnual: 0, anios: 5 };
    expect(llegadaAMeta('2026-10', presupuestoMensual({ ...b, fijadoEn: 'x', edadInicial: 35 }).map(f => f.valor), 1_200, 0, 1_500)).toEqual({ meses: 5, anio: 2027 });   // oct+4 = feb 2027
    expect(analisisMeta(b, 500, 1_000)!.yaAlcanzada).toBe(true);
    // sin retorno ni aportes nunca llega
    const quieto = { inicio: '2026-10', valorInicial: 1_000, aporteAnual: 0, tasaAnual: 0, anios: 5 };
    expect(analisisMeta(quieto, 5_000, 1_000)!.presupuesto.llegada).toEqual({ meses: null, anio: null });
  });

  it('meta inválida o supuestos inválidos: sin análisis (no NaN)', () => {
    const b = { inicio: '2026-10', valorInicial: 1_000, aporteAnual: 0, tasaAnual: 0.1, anios: 10 };
    expect(analisisMeta(b, 0, 1_000)).toBeNull();
    expect(analisisMeta(b, NaN, 1_000)).toBeNull();
    expect(analisisMeta({ ...b, anios: 0 }, 5_000, 1_000)).toBeNull();
    expect(analisisMeta({ ...b, tasaAnual: -0.99 }, 5_000, 1_000)).toBeNull();
  });

  it('calcularForecast con meta: trae el análisis y la llegada con el forecast actualizado (un mal arranque la posterga)', () => {
    const hoy = '2026-03-31';
    const buen = calcularForecast(B, presupuestoMensual(B).slice(0, 3).map(p => ({ fecha: `${p.periodo}-28`, valor: p.valor })),
      presupuestoMensual(B).slice(0, 3).map(p => ({ fecha: `${p.periodo}-15`, monto: p.aporte })), hoy, 'presupuesto', 20_000);
    expect(buen.meta?.objetivo).toBe(20_000);
    expect(buen.llegadaForecast?.meses).toBe(buen.meta?.presupuesto.llegada.meses);   // real = presupuesto → misma fecha
    const mal = calcularForecast(B, [{ fecha: '2026-03-31', valor: 8_500 }], [], hoy, 'presupuesto', 20_000);
    expect(mal.llegadaForecast!.meses!).toBeGreaterThan(buen.llegadaForecast!.meses!);
    expect(calcularForecast(B, [], [], hoy, 'presupuesto', 20_000).llegadaForecast).toBeNull();   // sin datos reales no hay forecast
    expect(calcularForecast(B, [{ fecha: hoy, valor: 10_000 }], [], hoy).meta).toBeNull();        // sin meta, sin análisis
  });
});

describe('relación entre la tarjeta de rendimiento y la de forecast', () => {
  it('con un presupuesto de retorno 0 que arranca en el capital aportado, el desvío por MERCADO del Forecast = P&L del año de la tarjeta de rendimiento', () => {
    // Herencia (datos reales 04/10/2026): mismos flujos y mismo patrimonio en las dos tarjetas.
    const hoy = '2026-10-04', valor = 39395.88;
    const pts = [{ fecha: '2026-07-24', valor: 2836.51, aportado: 3000 }, { fecha: hoy, valor, aportado: 40000 }];
    const flujos = [{ fecha: '2026-07-17', monto: 3000 }, { fecha: '2026-09-28', monto: 27000 }, { fecha: '2026-09-29', monto: 10000 }];
    const pnlAnio = rendimientoPorAnio(pts, 2026, hoy, flujos)[0].pnl!;
    const b: Presupuesto = { inicio: '2026-10', valorInicial: 40_000, aporteAnual: 0, tasaAnual: 0, anios: 30, edadInicial: 35, fijadoEn: hoy };
    const f = calcularForecast(b, [{ fecha: hoy, valor }], [], hoy);
    expect(f.ultimo!.desvioMercado!).toBeCloseTo(pnlAnio, 6);          // −604,12 en las dos
    expect(f.ultimo!.desvioAportes!).toBeCloseTo(0, 9);
  });

  it('identidad general: P&L del año = P&L antes del inicio del presupuesto + rendimiento real del período (mismos flujos)', () => {
    const hoy = '2026-10-04', vIni0 = 1_000, vInicioPpto = 1_200, vHoy = 1_500;
    const flujos = [{ fecha: '2026-03-10', monto: 100 }, { fecha: '2026-10-02', monto: 50 }];
    // P&L del año (Jan→hoy): vHoy − vIni0 − ΣF ; P&L antes del presupuesto (Jan→30/09): vInicioPpto − vIni0 − F_antes ; período (Oct→hoy): vHoy − vInicioPpto − F_periodo
    const pnlAnio = vHoy - vIni0 - 150, pnlAntes = vInicioPpto - vIni0 - 100;
    const b: Presupuesto = { inicio: '2026-10', valorInicial: vInicioPpto, aporteAnual: 0, tasaAnual: 0, anios: 5, edadInicial: 35, fijadoEn: hoy };
    const f = calcularForecast(b, [{ fecha: hoy, valor: vHoy }], [flujos[1]], hoy);
    const rendimientoPeriodo = vHoy - vInicioPpto - 50;
    expect(f.ultimo!.desvioMercado!).toBeCloseTo(rendimientoPeriodo, 9);   // ppto con retorno 0 → desvío mercado = rendimiento real del período
    expect(pnlAntes + rendimientoPeriodo).toBeCloseTo(pnlAnio, 9);
  });
});

describe('conexión rendimiento ↔ forecast', () => {
  it('retornoObjetivo: la tasa anual prorrateada compone a la anual en 365 días', () => {
    expect(retornoObjetivo(0.08, 365)).toBeCloseTo(0.08, 12);
    expect(retornoObjetivo(0.08, 0)).toBe(0);
    expect(Math.pow(1 + retornoObjetivo(0.08, 73), 5)).toBeCloseTo(1.08, 12);
  });

  it('el rendimiento del período del Forecast usa la MISMA fórmula que la tarjeta de rendimiento (coinciden si los períodos coinciden)', () => {
    // Año completo: apertura 31-dic con 10.000, aporte de 1.000 el 1-jul, cierre 31-dic con 12.200.
    const pts = [{ fecha: '2025-12-31', valor: 10_000, aportado: 10_000 }, { fecha: '2026-12-31', valor: 12_200, aportado: 11_000 }];
    const flujos = [{ fecha: '2026-07-01', monto: 1_000 }];
    const tarjeta = rendimientoPorAnio(pts, 2025, '2026-12-31', flujos).find(r => r.anio === 2026)!.rendimiento!;
    const b: Presupuesto = { inicio: '2026-01', valorInicial: 10_000, aporteAnual: 0, tasaAnual: 0.08, anios: 5, edadInicial: 35, fijadoEn: '2026-01-02' };
    const f = calcularForecast(b, [{ fecha: '2026-12-31', valor: 12_200 }], flujos, '2026-12-31');
    expect(f.rendimiento!.real!).toBeCloseTo(tarjeta, 12);
    expect(f.rendimiento!.dias).toBe(365);
    expect(f.rendimiento!.presupuestado).toBeCloseTo(0.08, 12);
  });

  it('Herencia (datos reales): −1,51% real vs +0,09% presupuestado en 4 días, sin la señal de concentrado (sin flujos en el período)', () => {
    const b: Presupuesto = { inicio: '2026-10', valorInicial: 40_000, aporteAnual: 0, tasaAnual: 0.08, anios: 40, edadInicial: 35, fijadoEn: '2026-10-04' };
    const f = calcularForecast(b, [{ fecha: '2026-10-04', valor: 39_395.88 }], [], '2026-10-04');
    expect(f.rendimiento!.dias).toBe(4);
    expect(f.rendimiento!.real!).toBeCloseTo((39_395.88 - 40_000) / 40_000, 12);
    expect(f.rendimiento!.presupuestado).toBeCloseTo(Math.pow(1.08, 4 / 365) - 1, 12);
    expect(f.rendimiento!.concentrado).toBe(false);
  });

  it('sin datos reales no hay rendimiento ni cumplimiento de aportes', () => {
    const f = calcularForecast(B, [], [], '2026-03-31');
    expect(f.rendimiento).toBeNull();
    expect(f.aportes).toBeNull();
  });

  it('aporte comprometido: faltante y extra se miden en meses CERRADOS y acumulados (el mes en curso no cuenta)', () => {
    const b: Presupuesto = { ...B, aporteAnual: 2_400 };                    // US$200/mes obligatorios
    const puntos = [{ fecha: '2026-01-31', valor: 10_100 }, { fecha: '2026-02-28', valor: 10_200 }, { fecha: '2026-03-15', valor: 10_300 }];
    // Ene 200, feb 0, mar (en curso) 0 → cerrados: presupuestado 400, real 200 → faltan 200
    const falta = calcularForecast(b, puntos, [{ fecha: '2026-01-10', monto: 200 }], '2026-03-15').aportes!;
    expect(falta.faltante).toBeCloseTo(200, 9);
    expect(falta.extra).toBe(0);
    // Ene 700 (500 extra), feb 0 → acumulado 700 vs 400 → extra 300, sin faltante (el acumulado compensa)
    const extra = calcularForecast(b, puntos, [{ fecha: '2026-01-10', monto: 700 }], '2026-03-15').aportes!;
    expect(extra.faltante).toBe(0);
    expect(extra.extra).toBeCloseTo(300, 9);
  });

  it("modo ritmo: el aporte comprometido es un PISO (con 0 aportes recientes el forecast sigue asumiendo US$200/mes)", () => {
    const b: Presupuesto = { ...B, aporteAnual: 2_400 };
    const puntos = [{ fecha: '2026-01-31', valor: 10_100 }, { fecha: '2026-02-28', valor: 10_200 }, { fecha: '2026-03-31', valor: 10_300 }];
    const sinAportes = calcularForecast(b, puntos, [], '2026-03-31', 'ritmo').repro!;
    expect(sinAportes.aporteMensualUsado).toBeCloseTo(200, 9);               // ritmo 0 < comprometido
    const conExtra = calcularForecast(b, puntos, [{ fecha: '2026-01-10', monto: 3_000 }], '2026-03-31', 'ritmo').repro!;
    expect(conExtra.aporteMensualUsado).toBeCloseTo(1_000, 9);               // ritmo 3000/3 > comprometido → se respeta
  });
});

describe('aporte necesario para la meta', () => {
  // Ahorros (datos reales): US$200/mes obligatorios, 8%, 40 años, meta US$1.000.000 → con el comprometido NO alcanza.
  const ahorros = { inicio: '2026-10', valorInicial: 16_507, aporteAnual: 2_400, tasaAnual: 0.08, anios: 40 };
  const valorAlHor = (A: number) => { const f = presupuestoMensual({ ...ahorros, aporteAnual: A, edadInicial: 35, fijadoEn: 'x' }); return valorAlHorizonte(f[11].valor, A, 0.08, 40); };
  it('Ahorros: el aporte comprometido (2.400) queda corto y el necesario es mínimo y suficiente (≈US$207/mes)', () => {
    const a = analisisMeta(ahorros, 1_000_000, 16_455)!;
    expect(a.presupuesto.dentroDelHorizonte).toBe(false);          // llega en el año 41
    const n = a.aporteNecesario!;
    expect(n).toBeGreaterThan(2_400);
    expect(n).toBeLessThan(2_700);
    expect(valorAlHor(n)).toBeGreaterThanOrEqual(1_000_000);        // suficiente
    expect(valorAlHor(n - 1)).toBeLessThan(1_000_000);              // y mínimo (a 1 dólar de distancia no alcanza)
  });
  it('si el valor ya llega sin aportes, el necesario es 0; una meta inválida da null', () => {
    const rico = { inicio: '2026-10', valorInicial: 500_000, aporteAnual: 0, tasaAnual: 0.08, anios: 40 };
    expect(aporteNecesarioParaMeta(rico, 1_000_000)).toBe(0);
    expect(aporteNecesarioParaMeta(rico, 0)).toBeNull();
    expect(aporteNecesarioParaMeta(rico, NaN)).toBeNull();
  });
  it('con la meta alcanzable solo con aportes, crece al subir la meta y baja al subir el retorno', () => {
    const base = { inicio: '2026-10', valorInicial: 1_000, aporteAnual: 0, tasaAnual: 0.05, anios: 20 };
    const a1 = aporteNecesarioParaMeta(base, 100_000)!, a2 = aporteNecesarioParaMeta(base, 200_000)!;
    expect(a2).toBeGreaterThan(a1);
    expect(aporteNecesarioParaMeta({ ...base, tasaAnual: 0.10 }, 100_000)!).toBeLessThan(a1);
  });
});

