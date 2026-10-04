import { describe, it, expect } from 'vitest';
import {
  presupuestoMensual, realMensual, cruzar, reproyectar, valorAlHorizonte, tasaMensual, sumarMeses, finDeMes,
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
