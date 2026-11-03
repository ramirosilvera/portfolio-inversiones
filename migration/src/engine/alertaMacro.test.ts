import { describe, it, expect } from 'vitest';
import { alertasEstres, claveAlertaDia, fechaLocalISO, INDICADORES_ESTRES, UMBRAL_ROJO, SALIDA } from './alertaMacro';
import { SEMAFOROS } from './semaforos';

const alloc = [
  { ticker: 'MSFT', mkt: 4000, tipo: 'cedear' }, { ticker: 'YM38D', mkt: 1100, tipo: 'bono' }, { ticker: 'AEC3D', mkt: 2000, tipo: 'bono' },
  { ticker: 'LIQUIDEZ', mkt: 900, tipo: 'cash' },
];
const patrimonio = 8000;

describe('alertasEstres', () => {
  it('los umbrales de texto coinciden con los semáforos: el valor de rojo da rojo y el anterior no', () => {
    for (const k of INDICADORES_ESTRES) {
      const def = SEMAFOROS.find(s => s.key === k)!;
      expect(def.evalua(UMBRAL_ROJO[k].valorRojo)).toBe('rojo');
    }
    expect(SEMAFOROS.find(s => s.key === 'vix')!.evalua(29.9)).toBe('amarillo');
    expect(SEMAFOROS.find(s => s.key === 'riesgo_pais')!.evalua(799)).toBe('amarillo');
  });
  it('solo dispara por estrés REAL: oro, Bitcoin, S&P y Merval en rojo no alertan', () => {
    expect(alertasEstres({ oro: 5000, bitcoin: 150000, sp500: 9000, merval_usd: 3000, dolar_oficial: 900 }, alloc, patrimonio)).toEqual([]);
  });
  it('VIX en rojo: expuesto = CEDEARs/acciones/ETFs (4.000 de 8.000 = 50 %)', () => {
    const [a] = alertasEstres({ vix: 32.4 }, alloc, patrimonio);
    expect(a).toMatchObject({ key: 'vix', valor: 32.4, umbral: 'rojo desde 30', expuestoUsd: 4000 });
    expect(a.expuestoPct).toBeCloseTo(0.5, 6);
  });
  it('riesgo país en rojo: expuesto = bonos (3.100) y el HY spread, lo mismo; se ordena por exposición', () => {
    const r = alertasEstres({ riesgo_pais: 850, vix: 31 }, alloc, patrimonio);
    expect(r.map(x => x.key)).toEqual(['vix', 'riesgo_pais']);   // 4.000 > 3.100
    expect(r[1].expuestoUsd).toBe(3100);
  });
  it('ADR YPF en rojo: expuesto solo a las ONs de YPF (YM…)', () => {
    const [a] = alertasEstres({ adr_ypf: 20 }, alloc, patrimonio);
    expect(a.key).toBe('adr_ypf'); expect(a.expuestoUsd).toBe(1100);
  });
  it('sin dato (null/undefined/NaN) no alerta; sin patrimonio el % es null', () => {
    expect(alertasEstres({ vix: null, hy_spread: undefined, riesgo_pais: NaN }, alloc, patrimonio)).toEqual([]);
    expect(alertasEstres({ vix: 40 }, alloc, 0)[0].expuestoPct).toBeNull();
  });
  it('la clave del día cambia si aparece otro indicador (la alerta descartada reaparece)', () => {
    const a = alertasEstres({ vix: 40 }, alloc, patrimonio), b = alertasEstres({ vix: 40, riesgo_pais: 900 }, alloc, patrimonio);
    expect(claveAlertaDia('2026-11-03', a)).not.toBe(claveAlertaDia('2026-11-03', b));
    expect(claveAlertaDia('2026-11-03', a)).toBe(claveAlertaDia('2026-11-03', a));
  });
});

describe('histéresis', () => {
  it('el umbral de salida es más permisivo que el de entrada y todos los indicadores lo tienen', () => {
    for (const k of INDICADORES_ESTRES) {
      expect(SALIDA[k]).toBeDefined();
      expect(SALIDA[k].sigue(UMBRAL_ROJO[k].valorRojo)).toBe(true);   // en rojo, sigue
    }
  });
  it('riesgo país 790 sin alerta previa NO alerta; con alerta previa SÍ (banda 770–800) y lo marca', () => {
    expect(alertasEstres({ riesgo_pais: 790 }, alloc, patrimonio)).toEqual([]);
    const [a] = alertasEstres({ riesgo_pais: 790 }, alloc, patrimonio, new Set(['riesgo_pais']));
    expect(a).toMatchObject({ key: 'riesgo_pais', enBanda: true, salida: 'bajar de 770 pb' });
  });
  it('riesgo país 760 con alerta previa se apaga (salió de la banda)', () => {
    expect(alertasEstres({ riesgo_pais: 760 }, alloc, patrimonio, new Set(['riesgo_pais']))).toEqual([]);
  });
  it('el ADR YPF (rojo hacia abajo) sigue en alerta hasta pasar US$ 26', () => {
    expect(alertasEstres({ adr_ypf: 25.5 }, alloc, patrimonio, new Set(['adr_ypf']))[0].enBanda).toBe(true);
    expect(alertasEstres({ adr_ypf: 26.5 }, alloc, patrimonio, new Set(['adr_ypf']))).toEqual([]);
  });
  it('un indicador en rojo de verdad no queda marcado como «en banda»', () => {
    expect(alertasEstres({ vix: 35 }, alloc, patrimonio, new Set(['vix']))[0].enBanda).toBe(false);
  });
  it('la fecha es LOCAL, no UTC (21:30 en Argentina sigue siendo el mismo día)', () => {
    expect(fechaLocalISO(new Date(2026, 10, 3, 21, 30))).toBe('2026-11-03');
    expect(fechaLocalISO(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
  });
});
