import { describe, it, expect } from 'vitest';
import { resumenPorAnio } from './forecastAnual';
import { calcularForecast, type Presupuesto } from './presupuesto';
import { rendimientoPorAnio } from './rendimiento';

const pts = (rows: string) => rows.split(';').map(r => { const [fecha, valor, aportado] = r.split(','); return { fecha, valor: +valor, aportado: +aportado }; });
const fl = (rows: string) => rows.split(';').map(r => { const [fecha, monto] = r.split(','); return { fecha, monto: +monto }; });

// Datos reales de Ahorros (04/10/2026).
const hoy = '2026-10-04';
const snaps = pts('2025-12-31,9361.76,6319.91;2026-07-24,11312.33,9030.74;2026-08-04,11885.28,13030.74;2026-08-20,22834.83,20262.63;2026-09-07,18548.58,15774.63;2026-09-28,16657.57,14424.63;2026-10-04,16455.42,14424.63');
const flujos = fl('2025-06-02,6319.91;2026-03-02,862.83;2026-06-01,1848;2026-08-04,2000;2026-08-04,2000;2026-08-13,2621;2026-08-14,820;2026-08-14,1822;2026-08-19,1968.89;2026-09-07,-1884.96;2026-09-07,-714;2026-09-07,-1889.04;2026-09-25,650;2026-09-28,-2000');
const rend = rendimientoPorAnio(snaps, 2025, hoy, flujos);
const ahorros: Presupuesto = { inicio: '2026-01', valorInicial: 9361.76, aporteAnual: 2400, tasaAnual: 0.10, anios: 40, edadInicial: 35, fijadoEn: hoy };
const puntos = snaps.map(s => ({ fecha: s.fecha, valor: s.valor }));

describe('resumenPorAnio — Ahorros (presupuesto desde 1-ene-2026, períodos alineados con "Rendimiento por año")', () => {
  const filas = resumenPorAnio(ahorros, puntos, flujos, hoy, rend);

  it('estructura: 2025 de historia, 2026 a la fecha y el cierre estimado de 2026', () => {
    expect(filas.map(f => `${f.anio}:${f.tipo}`)).toEqual(['2025:historia', '2026:presupuesto', '2026:cierre']);
    expect(filas[1].aLaFecha).toBe(true);
  });

  it('el % de 2026 es IDÉNTICO al de la tarjeta de rendimiento y al "rendimiento del período" del Forecast', () => {
    const tarjeta = rend.find(r => r.anio === 2026)!.rendimiento!;
    expect(filas[1].rendReal!).toBeCloseTo(tarjeta, 12);
    const f = calcularForecast(ahorros, puntos, flujos, hoy);
    expect(f.rendimiento!.real!).toBeCloseTo(tarjeta, 12);        // período del presupuesto = año calendario
    expect(f.rendimiento!.dias).toBe(rend.find(r => r.anio === 2026)!.dias);
  });

  it('2025 sin presupuesto: solo real (+48,1%) con el retorno objetivo como referencia', () => {
    expect(filas[0].rendReal!).toBeCloseTo(0.4812, 3);
    expect(filas[0].valorReal!).toBeCloseTo(9361.76, 2);
    expect(filas[0].valorPpto).toBeNull();
    expect(filas[0].rendObjetivo!).toBeGreaterThan(0.05);
  });

  it('desvío del año = aportes + mercado; los aportes reales (8.105) superan lo comprometido (US$200/mes)', () => {
    const f = filas[1];
    expect(f.desvioAportes! + f.desvioMercado!).toBeCloseTo(f.desvio!, 9);
    expect(f.aporteReal!).toBeCloseTo(8104.72, 2);
    expect(f.aportePpto!).toBeLessThan(2400);                      // prorrateado a hoy
    expect(f.desvioAportes!).toBeGreaterThan(5000);                // aportes extra
  });

  it('con presupuesto de retorno 0, el desvío por mercado del año = P&L del año de la tarjeta de rendimiento', () => {
    const sinRetorno = resumenPorAnio({ ...ahorros, tasaAnual: 0 }, puntos, flujos, hoy, rend);
    expect(sinRetorno[1].desvioMercado!).toBeCloseTo(rend.find(r => r.anio === 2026)!.pnl!, 6);
  });

  it('cierre estimado de 2026: forecast actualizado vs presupuesto a diciembre, a partir del valor real de hoy', () => {
    const c = filas[2];
    expect(c.valorReal!).toBeGreaterThan(16_455);                  // parte de hoy y sigue creciendo
    expect(c.valorPpto!).toBeGreaterThan(9_361.76);
    expect(c.desvio!).toBeCloseTo(c.valorReal! - c.valorPpto!, 9);
    expect(c.aportePpto!).toBeCloseTo(2400, 6);                    // el año completo
  });
});

describe('resumenPorAnio — otros casos', () => {
  it('Herencia (presupuesto desde oct-2026): una fila del año a la fecha con el % de Dietz marcado concentrado, y el cierre', () => {
    const hs = pts('2026-07-24,2836.51,3000;2026-09-20,3148.26,3000;2026-09-28,29777.29,30000;2026-09-29,39523.49,40000;2026-09-30,39378.31,40000;2026-10-04,39395.88,40000');
    const hf = fl('2026-07-17,3000;2026-09-28,10000;2026-09-28,15000;2026-09-28,2000;2026-09-29,10000');
    const r = rendimientoPorAnio(hs, 2026, hoy, hf);
    const b: Presupuesto = { inicio: '2026-10', valorInicial: 40_000, aporteAnual: 0, tasaAnual: 0.08, anios: 40, edadInicial: 35, fijadoEn: hoy };
    const filas = resumenPorAnio(b, hs.map(s => ({ fecha: s.fecha, valor: s.valor })), hf, hoy, r);
    expect(filas.map(f => f.tipo)).toEqual(['presupuesto', 'cierre']);
    expect(filas[0].concentrado).toBe(true);
    expect(filas[0].rendReal!).toBeCloseTo(-0.1063, 3);
    expect(filas[0].desvioMercado!).toBeCloseTo(filas[0].desvio!, 9);   // sin aportes presupuestados ni reales en el período
  });

  it('presupuesto de años anteriores: una fila por año calendario, con desvío y aportes de cada año por separado', () => {
    const b: Presupuesto = { inicio: '2025-01', valorInicial: 10_000, aporteAnual: 1_200, tasaAnual: 0, anios: 10, edadInicial: 35, fijadoEn: '2025-01-02' };
    const puntos2 = [{ fecha: '2025-12-31', valor: 11_500 }, { fecha: '2026-06-30', valor: 12_100 }];
    const flujos2 = [{ fecha: '2025-05-01', monto: 1_500 }, { fecha: '2026-03-01', monto: 600 }];
    const filas = resumenPorAnio(b, puntos2, flujos2, '2026-06-30', []);
    const anual = filas.filter(f => f.tipo === 'presupuesto');
    expect(anual.map(f => f.anio)).toEqual([2025, 2026]);
    expect(anual[0].aportePpto!).toBeCloseTo(1_200, 9);
    expect(anual[0].aporteReal!).toBeCloseTo(1_500, 9);
    expect(anual[0].valorPpto!).toBeCloseTo(11_200, 9);           // retorno 0: 10.000 + 1.200
    expect(anual[0].desvio!).toBeCloseTo(300, 9);                  // 11.500 − 11.200
    expect(anual[0].desvioAportes!).toBeCloseTo(300, 9);           // todo explicado por el aporte de más
    expect(anual[0].desvioMercado!).toBeCloseTo(0, 9);
    expect(anual[1].aLaFecha).toBe(true);
    // 2026 a junio: ppto 600 de aporte (6 meses), real 600 → sin desvío por aportes en el año
    expect(anual[1].desvioAportes!).toBeCloseTo(0, 9);
  });
});
