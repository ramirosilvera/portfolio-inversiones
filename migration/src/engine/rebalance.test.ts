import { describe, it, expect } from 'vitest';
import {
  montoParaObjetivo, pesoResultante, cantidadPorMonto, aplicarObjetivo, redondearPct,
  resolverObjetivosSimultaneos, pesoResultanteConjunto, objetivosTrasCierre,
} from './rebalance';

describe('montoParaObjetivo — cuánto comprar para llegar al objetivo', () => {
  it('lleva el peso exactamente al objetivo (contando que el total crece)', () => {
    const vi = 1000, V = 10000, t = 0.20;
    const x = montoParaObjetivo(vi, V, t);
    // el peso resultante debe ser t
    expect(pesoResultante(vi, V, x)).toBeCloseTo(0.20, 9);
    expect(x).toBeGreaterThan(0);
  });
  it('posición nueva (vi=0): peso resultante = objetivo', () => {
    const x = montoParaObjetivo(0, 8000, 0.10);
    expect(pesoResultante(0, 8000, x)).toBeCloseTo(0.10, 9);
  });
  it('si ya está por encima del objetivo, devuelve negativo (habría que vender)', () => {
    expect(montoParaObjetivo(5000, 10000, 0.20)).toBeLessThan(0);
  });
});

describe('cantidadPorMonto', () => {
  it('divide monto por precio', () => { expect(cantidadPorMonto(1000, 25)).toBe(40); });
  it('precio 0 → 0 (no divide por cero)', () => { expect(cantidadPorMonto(1000, 0)).toBe(0); });
});

describe('aplicarObjetivo — sincroniza a 100%', () => {
  const items = [
    { id: 'a', peso_objetivo: 0.5 },
    { id: 'b', peso_objetivo: 0.3 },
    { id: 'c', peso_objetivo: 0.2 },
  ];
  const sum = (r: { peso_objetivo: number | null }[]) => r.reduce((s, x) => s + (x.peso_objetivo ?? 0), 0);

  it('al subir uno, el resto se escala proporcional y el total sigue en 100%', () => {
    const r = aplicarObjetivo(items, 'a', 0.6);
    expect(r.find(x => x.id === 'a')!.peso_objetivo).toBeCloseTo(0.6, 9);
    // b y c mantienen su proporción relativa (3:2) sobre el 40% restante
    expect(r.find(x => x.id === 'b')!.peso_objetivo).toBeCloseTo(0.4 * 0.6, 9);
    expect(r.find(x => x.id === 'c')!.peso_objetivo).toBeCloseTo(0.4 * 0.4, 9);
    expect(sum(r)).toBeCloseTo(1, 9);
  });

  it('si nadie tenía objetivo, reparte el resto en partes iguales', () => {
    const nuevos = [{ id: 'a', peso_objetivo: null }, { id: 'b', peso_objetivo: null }, { id: 'c', peso_objetivo: null }];
    const r = aplicarObjetivo(nuevos, 'a', 0.4);
    expect(r.find(x => x.id === 'b')!.peso_objetivo).toBeCloseTo(0.3, 9);
    expect(r.find(x => x.id === 'c')!.peso_objetivo).toBeCloseTo(0.3, 9);
    expect(sum(r)).toBeCloseTo(1, 9);
  });

  it('nuevo=null saca la posición del plan y renormaliza el resto a 100%', () => {
    const r = aplicarObjetivo(items, 'c', null);
    expect(r.find(x => x.id === 'c')!.peso_objetivo).toBeNull();
    expect(sum(r)).toBeCloseTo(1, 9);
    // a y b mantenían 5:3 → ahora 0.625 / 0.375
    expect(r.find(x => x.id === 'a')!.peso_objetivo).toBeCloseTo(0.625, 9);
  });

  it('clamp: objetivo > 1 se acota a 1 y el resto queda en 0', () => {
    const r = aplicarObjetivo(items, 'a', 1.5);
    expect(r.find(x => x.id === 'a')!.peso_objetivo).toBe(1);
    expect(r.find(x => x.id === 'b')!.peso_objetivo).toBeCloseTo(0, 9);
  });
});

describe('resolverObjetivosSimultaneos — varias compras a la vez', () => {
  it('con un solo target, coincide exacto con montoParaObjetivo (n=1 es caso particular)', () => {
    const V = 10000, vi = 1000, t = 0.20;
    const m = resolverObjetivosSimultaneos([{ id: 'a', valorActual: vi, objetivo: t }], V, 0);
    expect(m!.get('a')).toBeCloseTo(montoParaObjetivo(vi, V, t), 9);
  });

  it('dos targets simultáneos: cada uno llega EXACTO a su % sobre el total final combinado', () => {
    const V = 10000;
    const targets = [{ id: 'a', valorActual: 1000, objetivo: 0.20 }, { id: 'b', valorActual: 500, objetivo: 0.15 }];
    const m = resolverObjetivosSimultaneos(targets, V, 0)!;
    const xa = m.get('a')!, xb = m.get('b')!;
    const F = V + xa + xb;
    expect(pesoResultanteConjunto(1000, xa, F)).toBeCloseTo(0.20, 9);
    expect(pesoResultanteConjunto(500, xb, F)).toBeCloseTo(0.15, 9);
  });

  it('agregar un segundo target agranda el monto necesario del primero (mismo objetivo %)', () => {
    const V = 10000;
    const soloA = resolverObjetivosSimultaneos([{ id: 'a', valorActual: 1000, objetivo: 0.20 }], V, 0)!.get('a')!;
    const conB = resolverObjetivosSimultaneos(
      [{ id: 'a', valorActual: 1000, objetivo: 0.20 }, { id: 'b', valorActual: 500, objetivo: 0.15 }], V, 0,
    )!.get('a')!;
    expect(conB).toBeGreaterThan(soloA);
  });

  it('respeta montos fijos de otras simulaciones (método monto/cantidad) al resolver el objetivo', () => {
    const V = 10000;
    const sinFijo = resolverObjetivosSimultaneos([{ id: 'a', valorActual: 1000, objetivo: 0.20 }], V, 0)!.get('a')!;
    const conFijo = resolverObjetivosSimultaneos([{ id: 'a', valorActual: 1000, objetivo: 0.20 }], V, 2000)!.get('a')!;
    expect(conFijo).toBeCloseTo(montoParaObjetivo(1000, V + 2000, 0.20), 9);
    expect(conFijo).toBeGreaterThan(sinFijo);
  });

  it('un target ya sobreponderado queda excluido del sistema (no infla el total) y devuelve negativo', () => {
    const V = 10000;
    const targets = [
      { id: 'a', valorActual: 5000, objetivo: 0.20 }, // ya es 50% del total, objetivo 20% → sobreponderada
      { id: 'b', valorActual: 500, objetivo: 0.15 },
    ];
    const m = resolverObjetivosSimultaneos(targets, V, 0)!;
    expect(m.get('a')!).toBeLessThan(0);
    // b se resuelve como si 'a' no estuviera en el sistema (a no compra nada realmente)
    expect(m.get('b')!).toBeCloseTo(montoParaObjetivo(500, V, 0.15), 9);
  });

  it('objetivos combinados ≥100% del total: inalcanzable, devuelve null', () => {
    const targets = [{ id: 'a', valorActual: 0, objetivo: 0.60 }, { id: 'b', valorActual: 0, objetivo: 0.55 }];
    expect(resolverObjetivosSimultaneos(targets, 10000, 0)).toBeNull();
  });

  it('un solo target de exactamente 100%: inalcanzable (no debe devolver un F absurdo)', () => {
    const targets = [{ id: 'a', valorActual: 1000, objetivo: 1 }];
    const m = resolverObjetivosSimultaneos(targets, 10000, 0);
    expect(m).toBeNull();
  });

  it('posición nueva (valorActual=0) en simultáneo con una existente', () => {
    const V = 10000;
    const targets = [{ id: 'nueva', valorActual: 0, objetivo: 0.10 }, { id: 'vieja', valorActual: 2000, objetivo: 0.25 }];
    const m = resolverObjetivosSimultaneos(targets, V, 0)!;
    const F = V + m.get('nueva')! + m.get('vieja')!;
    expect(pesoResultanteConjunto(0, m.get('nueva')!, F)).toBeCloseTo(0.10, 9);
    expect(pesoResultanteConjunto(2000, m.get('vieja')!, F)).toBeCloseTo(0.25, 9);
  });
});

describe('pesoResultanteConjunto', () => {
  it('peso = (valor + monto) / total final (el total YA incluye el monto)', () => {
    expect(pesoResultanteConjunto(1000, 500, 15000)).toBeCloseTo(1500 / 15000, 9);
  });
  it('total final 0 → 0 (no divide por cero)', () => {
    expect(pesoResultanteConjunto(0, 0, 0)).toBe(0);
  });
});

describe('redondearPct — el % mostrado siempre suma 100', () => {
  const suma = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
  it('tercios: 34/33/33 = 100 (no 99)', () => {
    const m = redondearPct([{ id: 'a', peso: 1 / 3 }, { id: 'b', peso: 1 / 3 }, { id: 'c', peso: 1 / 3 }]);
    expect(suma(m)).toBe(100);
    expect([...m.values()].sort()).toEqual([33, 33, 34]);
  });
  it('reparte la unidad sobrante al de mayor resto', () => {
    // 16.6 + 16.6 + 66.6 → floors 16/16/66 = 98 → +1 a los dos mayores restos
    const m = redondearPct([{ id: 'a', peso: 0.166 }, { id: 'b', peso: 0.166 }, { id: 'c', peso: 0.666 }]);
    expect(suma(m)).toBe(100);
  });
  it('normaliza si no suman 1 exacto', () => {
    const m = redondearPct([{ id: 'a', peso: 0.5 }, { id: 'b', peso: 0.3 }]); // suman 0.8
    expect(suma(m)).toBe(100);
    expect(m.get('a')!).toBe(63);  // 0.5/0.8 = 62.5 → 63 (resto mayor)
  });
  it('lista vacía → mapa vacío sin romper', () => {
    expect(redondearPct([]).size).toBe(0);
  });
});

describe('objetivosTrasCierre', () => {
  const plan = [{ id: 'a', peso_objetivo: 0.5 }, { id: 'b', peso_objetivo: 0.3 }, { id: 'c', peso_objetivo: 0.2 }];
  const suma = (l: { peso_objetivo: number | null }[]) => l.reduce((s, i) => s + (i.peso_objetivo ?? 0), 0);

  it('plan completo: la que sale pierde el objetivo y el resto se reescala a 100 %', () => {
    const cambios = objetivosTrasCierre(plan, 'c');
    expect(cambios.find(c => c.id === 'c')!.peso_objetivo).toBeNull();
    expect(cambios.find(c => c.id === 'a')!.peso_objetivo).toBeCloseTo(0.5 / 0.8, 10);
    expect(cambios.find(c => c.id === 'b')!.peso_objetivo).toBeCloseTo(0.3 / 0.8, 10);
    expect(suma(cambios)).toBeCloseTo(1, 10);
  });
  it('plan parcial: solo se limpia la que sale, el resto no se toca', () => {
    const parcial = [{ id: 'a', peso_objetivo: 0.4 }, { id: 'b', peso_objetivo: 0.2 }];
    expect(objetivosTrasCierre(parcial, 'b')).toEqual([{ id: 'b', peso_objetivo: null }]);
  });
  it('una posición sin objetivo no dispara nada', () => {
    expect(objetivosTrasCierre(plan, 'zzz')).toEqual([]);
    expect(objetivosTrasCierre([...plan, { id: 'd', peso_objetivo: null }], 'd')).toEqual([]);
  });
  it('tolera redondeos de carga (99,8 % cuenta como completo)', () => {
    const c = objetivosTrasCierre([{ id: 'a', peso_objetivo: 0.6 }, { id: 'b', peso_objetivo: 0.398 }], 'b');
    expect(c.find(x => x.id === 'b')!.peso_objetivo).toBeNull();
    expect(c.find(x => x.id === 'a')!.peso_objetivo).toBeCloseTo(1, 10);
  });
  it('la última que queda sale del plan sin dividir por cero', () => {
    expect(objetivosTrasCierre([{ id: 'a', peso_objetivo: 1 }], 'a')).toEqual([{ id: 'a', peso_objetivo: null }]);
  });
});
