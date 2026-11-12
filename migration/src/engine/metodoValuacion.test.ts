import { describe, it, expect } from 'vitest';
import { puentesMetodo } from './metodoValuacion';
import { indiceTwr, twrAcumulado } from './desempeno';

const CED = new Set(['MSFT', 'MA']);
const det = (msft: number, bono: number) => [{ t: 'MSFT', c: 10, v: msft }, { t: 'DNC7D', c: 1000, v: bono }];

describe('puentesMetodo (escalón CCL → MEP)', () => {
  it('sin ningún punto nuevo y con factor vivo: puente al último snapshot viejo anterior a hoy', () => {
    const snaps = [
      { fecha: '2026-11-10', valor: 1000, detalle: det(500, 500) },
      { fecha: '2026-11-11', valor: 1010, detalle: det(510, 500) },
    ];
    const p = puentesMetodo(snaps, CED, 1.0549, '2026-11-12');
    expect([...p.keys()]).toEqual(['2026-11-11']);
    expect(p.get('2026-11-11')).toBeCloseTo(1010 + 510 * 0.0549, 2);
  });
  it('con un snapshot ya en método nuevo: el puente va al snapshot anterior a ese, con el factor de ese', () => {
    const snaps = [
      { fecha: '2026-11-11', valor: 1010, detalle: det(510, 500) },
      { fecha: '2026-11-12', valor: 1066, factor_cedear: 1.05, detalle: det(536, 500) },
    ];
    const p = puentesMetodo(snaps, CED, null);
    expect(p.get('2026-11-11')).toBeCloseTo(1010 + 510 * 0.05, 2);
  });
  it('sin detalle, sin factor o sin CEDEARs en el detalle: no hay puente (no se inventa)', () => {
    expect(puentesMetodo([{ fecha: '2026-11-11', valor: 1000 }], CED, 1.05, '2026-11-12').size).toBe(0);
    expect(puentesMetodo([{ fecha: '2026-11-11', valor: 1000, detalle: det(500, 500) }], CED, null, '2026-11-12').size).toBe(0);
    expect(puentesMetodo([{ fecha: '2026-11-11', valor: 1000, detalle: [{ t: 'DNC7D', v: 1000 }] }], CED, 1.05, '2026-11-12').size).toBe(0);
  });
  it('indiceTwr: con el puente, el escalón de método NO es retorno (sin él, +5,5 % sobre los CEDEARs se leería como ganancia)', () => {
    const f = 1.0549;
    const viejo = [{ fecha: '2026-11-10', valor: 1000 }, { fecha: '2026-11-11', valor: 1000 }];
    // mercado plano: el 12/11 el valor en método nuevo es 1000 + 500 × 0,0549
    const nuevo = { fecha: '2026-11-12', valor: 1000 + 500 * (f - 1) };
    const sin = indiceTwr([...viejo, nuevo], []);
    expect(twrAcumulado(sin.serie)).toBeGreaterThan(0.02);
    const con = indiceTwr([viejo[0], { ...viejo[1], puente: 1000 + 500 * (f - 1) }, nuevo], []);
    expect(twrAcumulado(con.serie)!).toBeCloseTo(0, 6);
  });
});
