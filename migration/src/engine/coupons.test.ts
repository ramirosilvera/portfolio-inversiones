import { describe, it, expect } from 'vitest';
import { couponEvents, couponCalendar, capitalEvents, capitalCalendar, agruparCuotasPorPosicion, cuponAnualTotal, ytm, bondDuration, rendimientoCorriente, ytmFromCronograma, bondDurationFromCronograma, inferirCuponDeCronograma, type CouponBond, type CapitalBond, type CronogramaItem } from './coupons';
import { xirr } from './irr';

const semestral: CouponBond = { ticker: 'GD46', faceValue: 1000, tasaAnual: 0.08, frecuencia: 2, mesRef: 1 };
// paga en enero y julio; cupón por período = 1000 × 0.08/2 = 40

describe('couponEvents', () => {
  it('semestral: 2 pagos en 12 meses, monto correcto', () => {
    const ev = couponEvents([semestral], 2026, 1, 12);
    expect(ev).toHaveLength(2);
    expect(ev.every(e => e.monto === 40)).toBe(true);
    expect(ev.map(e => e.month).sort((a, b) => a - b)).toEqual([1, 7]);
  });

  it('trimestral: 4 pagos en 12 meses', () => {
    const trim: CouponBond = { ticker: 'ON', faceValue: 400, tasaAnual: 0.10, frecuencia: 4, mesRef: 3 };
    const ev = couponEvents([trim], 2026, 1, 12);
    expect(ev).toHaveLength(4);                 // meses 3,6,9,12
    expect(ev[0].monto).toBe(10);               // 400 × 0.10/4
    expect(ev.map(e => e.month).sort((a, b) => a - b)).toEqual([3, 6, 9, 12]);
  });

  it('respeta el vencimiento (no paga después)', () => {
    const vto: CouponBond = { ...semestral, vencimiento: '2026-07-31' };
    const ev = couponEvents([vto], 2026, 1, 24);
    // enero 2026 y julio 2026, nada después de julio 2026
    expect(ev.every(e => e.year === 2026 && e.month <= 7)).toBe(true);
  });

  it('ignora bonos sin tasa o sin nominal', () => {
    expect(couponEvents([{ ...semestral, tasaAnual: 0 }], 2026, 1, 12)).toHaveLength(0);
    expect(couponEvents([{ ...semestral, faceValue: 0 }], 2026, 1, 12)).toHaveLength(0);
  });

  describe('amortizaciones (cronograma manual)', () => {
    it('sin amortizaciones/valorResidual: se comporta exactamente igual que antes (retrocompatible)', () => {
      const ev = couponEvents([semestral], 2026, 1, 12);
      expect(ev.every(e => e.monto === 40)).toBe(true);
    });

    it('el cupón baja DESPUÉS de una cuota programada, no en el pago donde cae la cuota', () => {
      // paga enero y julio; cuota de 25% cargada para marzo 2026 (entre los dos pagos).
      const bono: CouponBond = { ...semestral, amortizaciones: [{ fecha: '2026-03-15', porcentaje: 0.25 }] };
      const ev = couponEvents([bono], 2026, 1, 12);
      const enero = ev.find(e => e.month === 1 && e.year === 2026)!;
      const julio = ev.find(e => e.month === 7 && e.year === 2026)!;
      expect(enero.monto).toBe(40);       // sale ANTES de la cuota: sobre el 100% todavía
      expect(julio.monto).toBeCloseTo(30, 6); // sale DESPUÉS: 1000 × 0.75 × 0.08/2 = 30
    });

    it('valorResidual inicial más bajo (bono que ya venía amortizado) también baja el cupón desde el principio', () => {
      const bono: CouponBond = { ...semestral, valorResidual: 0.5 };
      const ev = couponEvents([bono], 2026, 1, 12);
      expect(ev.every(e => e.monto === 20)).toBe(true); // 1000 × 0.5 × 0.08/2
    });

    it('el cronograma sumando más del 100% no produce cupones negativos: el pago siguiente directamente no se lista', () => {
      const bono: CouponBond = { ...semestral, amortizaciones: [{ fecha: '2026-02-01', porcentaje: 0.6 }, { fecha: '2026-03-01', porcentaje: 0.6 }] };
      const ev = couponEvents([bono], 2026, 1, 12);
      expect(ev.find(e => e.month === 7 && e.year === 2026)).toBeUndefined();
      expect(ev.every(e => e.monto >= 0)).toBe(true);
    });

    it('una cuota ANTERIOR al mes de inicio de la proyección se ignora — se presume ya reflejada en valorResidual, no se descuenta de nuevo', () => {
      // Proyectando desde julio 2026: la cuota de enero 2026 (antes del inicio) no debe bajar el
      // saldo — si se descontara igual, julio saldría a 20 en vez de 40 (doble conteo).
      const bono: CouponBond = { ...semestral, amortizaciones: [{ fecha: '2026-01-05', porcentaje: 0.5 }] };
      const ev = couponEvents([bono], 2026, 7, 6); // julio a diciembre 2026
      const julio = ev.find(e => e.month === 7 && e.year === 2026)!;
      expect(julio.monto).toBe(40); // NO 20 — la cuota de enero (pasada) no cuenta acá
    });
  });
});

describe('capitalEvents', () => {
  const bullet: CapitalBond = { ticker: 'GD46', faceValue: 1000, vencimiento: '2026-09-15' };

  it('bono bullet sin cargar nada: rescate del 100% en el mes de vencimiento', () => {
    const ev = capitalEvents([bullet], 2026, 1, 12);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ tipo: 'rescate', monto: 1000, month: 9, year: 2026 });
  });

  it('amortizable sin cronograma, solo valorResidual: rescate por ESE valor, no el 100%', () => {
    const ev = capitalEvents([{ ...bullet, valorResidual: 0.6 }], 2026, 1, 12);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ tipo: 'rescate', monto: 600 });
  });

  it('con cuotas programadas que NO cubren todo: cada cuota + un rescate final por el resto', () => {
    const bono: CapitalBond = { ...bullet, amortizaciones: [{ fecha: '2026-03-10', porcentaje: 0.3 }] };
    const ev = capitalEvents([bono], 2026, 1, 12);
    expect(ev).toHaveLength(2);
    const cuota = ev.find(e => e.tipo === 'cuota')!;
    const rescate = ev.find(e => e.tipo === 'rescate')!;
    expect(cuota.monto).toBe(300);
    expect(cuota.month).toBe(3);
    expect(rescate.monto).toBeCloseTo(700, 6); // 1000 × (1 − 0.3)
    expect(rescate.month).toBe(9);
  });

  it('cronograma que cubre el 100%: no hay rescate adicional (el remanente es ~0)', () => {
    const bono: CapitalBond = { ...bullet, amortizaciones: [{ fecha: '2026-03-10', porcentaje: 0.5 }, { fecha: '2026-06-10', porcentaje: 0.5 }] };
    const ev = capitalEvents([bono], 2026, 1, 12);
    expect(ev).toHaveLength(2);
    expect(ev.every(e => e.tipo === 'cuota')).toBe(true);
    expect(ev.reduce((s, e) => s + e.monto, 0)).toBe(1000);
  });

  it('cuota o vencimiento fuera de la ventana de meses: no aparece', () => {
    const bono: CapitalBond = { ...bullet, vencimiento: '2028-01-15', amortizaciones: [{ fecha: '2027-06-01', porcentaje: 0.2 }] };
    const ev = capitalEvents([bono], 2026, 1, 12); // ventana: 2026-01 a 2026-12
    expect(ev).toHaveLength(0);
  });

  it('una cuota FUTURA pero fuera de la ventana de 12 meses igual resta del rescate (aunque no tenga evento propio acá)', () => {
    // vencimiento SÍ cae dentro de la ventana; la cuota de 2027 es futura pero queda afuera de los
    // 12 meses proyectados — el rescate final tiene que reflejar que ya está "comprometida".
    const bono: CapitalBond = { ticker: 'X', faceValue: 1000, vencimiento: '2026-11-01', amortizaciones: [{ fecha: '2027-06-01', porcentaje: 0.2 }] };
    const ev = capitalEvents([bono], 2026, 1, 12); // ventana: 2026-01 a 2026-12 — la cuota de 2027 queda afuera
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ tipo: 'rescate', monto: 800 }); // 1000 × (1 − 0.2), no 1000
  });

  it('una cuota ANTERIOR al mes de inicio de la proyección se ignora del todo — ni evento ni descuento del rescate', () => {
    // Proyectando desde julio 2026: si la cuota de enero (pasada) contara igual, el rescate sería
    // 800 en vez de 1000 — doble conteo sobre algo que valorResidual ya debería reflejar.
    const bono: CapitalBond = { ...bullet, amortizaciones: [{ fecha: '2026-01-05', porcentaje: 0.2 }] };
    const ev = capitalEvents([bono], 2026, 7, 12);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ tipo: 'rescate', monto: 1000 });
  });

  it('faceValue inválido: se ignora, no revienta', () => {
    expect(capitalEvents([{ ...bullet, faceValue: 0 }], 2026, 1, 12)).toHaveLength(0);
  });
});

describe('capitalCalendar', () => {
  it('agrupa por mes y suma cuota + rescate si coinciden (detalle conserva el tipo de cada uno)', () => {
    const a: CapitalBond = { ticker: 'A', faceValue: 1000, vencimiento: '2026-05-15' };
    const b: CapitalBond = { ticker: 'B', faceValue: 500, vencimiento: '2026-05-20' };
    const cal = capitalCalendar([a, b], 2026, 1, 12);
    const mayo = cal.find(m => m.month === 5)!;
    expect(mayo.total).toBe(1500);
    expect(mayo.detalle).toHaveLength(2);
    expect(mayo.detalle.every(d => d.tipo === 'rescate')).toBe(true);
  });

  it('devuelve un bucket por cada uno de los `meses` pedidos, en 0 si no hay nada ese mes', () => {
    const cal = capitalCalendar([{ ticker: 'A', faceValue: 1000, vencimiento: '2026-05-15' }], 2026, 1, 12);
    expect(cal).toHaveLength(12);
    expect(cal.filter(m => m.total > 0)).toHaveLength(1);
  });
});

describe('couponCalendar', () => {
  it('devuelve un bucket por mes con el total del mes', () => {
    const cal = couponCalendar([semestral], 2026, 1, 12);
    expect(cal).toHaveLength(12);
    expect(cal[0].total).toBe(40);              // enero
    expect(cal[6].total).toBe(40);              // julio
    expect(cal[1].total).toBe(0);               // febrero sin pago
  });
});

describe('cuponAnualTotal', () => {
  it('suma el cupón anual de todos los bonos', () => {
    expect(cuponAnualTotal([semestral])).toBe(80); // 1000 × 0.08
  });
});

describe('ytm — TIR al vencimiento (vs current yield)', () => {
  it('a la par: YTM ≈ tasa del cupón', () => {
    const r = ytm({ precio: 1, tasaAnual: 0.06, frecuencia: 2, vencimiento: '2031-07-24', hoy: '2026-07-24' })!;
    expect(r).toBeCloseTo(0.0609, 2);   // ≈6% (levemente más por capitalización semestral)
  });

  it('bajo la par: YTM MUY superior al current yield (pull-to-par)', () => {
    // Cupón 7% comprado a 60 de paridad: current yield = 7/60 = 11,7%; la YTM debe ser bastante mayor.
    const r = ytm({ precio: 0.60, tasaAnual: 0.07, frecuencia: 2, vencimiento: '2031-07-24', hoy: '2026-07-24' })!;
    const currentYield = 0.07 / 0.60;
    expect(r).toBeGreaterThan(currentYield);
    expect(r).toBeGreaterThan(0.17);
  });

  it('sobre la par: YTM menor que el cupón', () => {
    const r = ytm({ precio: 1.15, tasaAnual: 0.08, frecuencia: 2, vencimiento: '2030-07-24', hoy: '2026-07-24' })!;
    expect(r).toBeLessThan(0.08);
    expect(r).toBeGreaterThan(0);
  });

  it('datos inválidos o bono vencido → null (no inventa)', () => {
    expect(ytm({ precio: 0, tasaAnual: 0.07, frecuencia: 2, vencimiento: '2030-01-01', hoy: '2026-07-24' })).toBeNull();
    expect(ytm({ precio: 1, tasaAnual: 0.07, frecuencia: 2, vencimiento: '2020-01-01', hoy: '2026-07-24' })).toBeNull();
    expect(ytm({ precio: 1, tasaAnual: 0.07, frecuencia: 2, vencimiento: 'nope', hoy: '2026-07-24' })).toBeNull();
  });

  describe('valorResidual (bonos amortizables)', () => {
    const base = { tasaAnual: 0.06, frecuencia: 2, vencimiento: '2031-07-24', hoy: '2026-07-24' };

    it('sin valorResidual (u omitido) equivale a valorResidual: 1 (bullet, compatibilidad hacia atrás)', () => {
      const sinParam = ytm({ precio: 0.9, ...base })!;
      const conUno = ytm({ precio: 0.9, ...base, valorResidual: 1 })!;
      expect(sinParam).toBeCloseTo(conUno, 10);
    });

    it('escala invariante: pagar k×precio por k×valorResidual da la MISMA TIR que pagar precio por valorResidual 1 (XIRR es lineal en escala)', () => {
      const completo = ytm({ precio: 1, ...base, valorResidual: 1 })!;
      const mitad = ytm({ precio: 0.5, ...base, valorResidual: 0.5 })!;
      expect(mitad).toBeCloseTo(completo, 8);
    });

    it('a precio fijo, un valorResidual más bajo (menos capital por cobrar) da una TIR menor', () => {
      const conTodo = ytm({ precio: 0.9, ...base, valorResidual: 1 })!;
      const conMitad = ytm({ precio: 0.9, ...base, valorResidual: 0.5 })!;
      expect(conMitad).toBeLessThan(conTodo);
    });
  });

  // El precio (data912) es SIEMPRE limpio (sin interés corrido) — todos los fixtures de arriba usan
  // `hoy` exactamente en un límite de período (corrido = 0 por construcción), que es justo lo que
  // dejó pasar este bug sin que ningún test lo detectara. Estos casos prueban explícitamente a mitad
  // de período. Nota de diseño: comparar la TIR entre dos `hoy` distintos NO aísla el efecto del
  // interés corrido (mover `hoy` también acorta el tiempo restante al vencimiento, que por sí solo
  // ya cambia la TIR) — por eso cada caso compara contra un valor de referencia armado a mano con
  // xirr() (mismo precio sucio esperado, mismos flujos futuros), no contra otro `hoy`.
  describe('interés corrido (precio limpio → sucio)', () => {
    it('a mitad de período: reproduce el precio sucio (limpio + corrido por día) armado a mano con xirr()', () => {
      // Período en curso 2026-02-20→2026-08-20 (181 días); hoy a 91 días del inicio → fracción
      // ≈0,5028. cupón semestral = 0,04. sucio esperado = 1,019444 + 0,04×0,5028 ≈ 1,039555.
      const precio = 1.0194444444, tasaAnual = 0.08, frecuencia = 2, vencimiento = '2031-08-20', hoy = '2026-05-22';
      const r = ytm({ precio, tasaAnual, frecuencia, vencimiento, hoy })!;
      const sucioEsperado = 1.039554941637569;
      const fechas = ['2026-08-20', '2027-02-20', '2027-08-20', '2028-02-20', '2028-08-20', '2029-02-20', '2029-08-20', '2030-02-20', '2030-08-20', '2031-02-20', '2031-08-20'];
      const cupon = tasaAnual / frecuencia;
      const referencia = xirr([{ date: hoy, amount: -sucioEsperado }, ...fechas.map(f => ({ date: f, amount: cupon })), { date: fechas.at(-1)!, amount: 1 }]);
      expect(r).toBeCloseTo(referencia!, 8);
    });

    it('a mitad de período, la TIR es menor que si se ignorara el interés corrido (mismo precio, mismos flujos, mismo hoy)', () => {
      const precio = 1.0194444444, tasaAnual = 0.08, frecuencia = 2, vencimiento = '2031-08-20', hoy = '2026-05-22';
      const conAjuste = ytm({ precio, tasaAnual, frecuencia, vencimiento, hoy })!;
      // Réplica manual del comportamiento ANTERIOR al fix (sucio = precio, sin sumar corrido) para el
      // MISMO hoy — así se aísla el efecto del ajuste sin el confound de mover el tiempo al vencimiento.
      const fechas = ['2026-08-20', '2027-02-20', '2027-08-20', '2028-02-20', '2028-08-20', '2029-02-20', '2029-08-20', '2030-02-20', '2030-08-20', '2031-02-20', '2031-08-20'];
      const cupon = tasaAnual / frecuencia;
      const sinAjuste = xirr([{ date: hoy, amount: -precio }, ...fechas.map(f => ({ date: f, amount: cupon })), { date: fechas.at(-1)!, amount: 1 }])!;
      expect(conAjuste).toBeLessThan(sinAjuste);
    });
  });
});

describe('ytmFromCronograma / bondDurationFromCronograma — cronograma explícito (bonos_referencia)', () => {
  // Cronograma bullet equivalente a ytm({tasaAnual:0.06, frecuencia:2, vencimiento:'2031-07-24'}):
  // 10 cupones semestrales de 0.03 + el último con +1 de amortización (rescate del 100%).
  const bulletEquivalente: CronogramaItem[] = Array.from({ length: 10 }, (_, i) => {
    const anio = 2026 + Math.floor((i + 2) / 2);
    const mes = (i % 2 === 0) ? '01' : '07';
    return { fecha: `${anio}-${mes}-24`, interes: 0.03, amortizacion: i === 9 ? 1 : 0, saldo_residual: i === 9 ? 0 : 1 };
  });

  it('cronograma bullet da la MISMA TIR que ytm() con los mismos términos', () => {
    const viaCronograma = ytmFromCronograma(0.9, bulletEquivalente, '2026-07-24')!;
    const viaFlat = ytm({ precio: 0.9, tasaAnual: 0.06, frecuencia: 2, vencimiento: '2031-07-24', hoy: '2026-07-24' })!;
    expect(viaCronograma).toBeCloseTo(viaFlat, 6);
  });

  it('cronograma amortizable devuelve capital antes → TIR distinta de la aproximación bullet a igual precio', () => {
    // Mismo cupón total pero con amortización repartida en 3 cuotas en vez de un solo rescate final.
    const amortizable: CronogramaItem[] = [
      { fecha: '2027-01-24', interes: 0.03, amortizacion: 0, saldo_residual: 1 },
      { fecha: '2027-07-24', interes: 0.03, amortizacion: 0.34, saldo_residual: 0.66 },
      { fecha: '2028-01-24', interes: 0.0198, amortizacion: 0, saldo_residual: 0.66 },
      { fecha: '2028-07-24', interes: 0.0198, amortizacion: 0.33, saldo_residual: 0.33 },
      { fecha: '2029-01-24', interes: 0.0099, amortizacion: 0, saldo_residual: 0.33 },
      { fecha: '2029-07-24', interes: 0.0099, amortizacion: 0.33, saldo_residual: 0 },
    ];
    const tirAmortizable = ytmFromCronograma(0.9, amortizable, '2026-07-24')!;
    const tirBullet = ytm({ precio: 0.9, tasaAnual: 0.06, frecuencia: 2, vencimiento: '2029-07-24', hoy: '2026-07-24' })!;
    expect(tirAmortizable).not.toBeCloseTo(tirBullet, 3);
  });

  it('precio inválido o cronograma vacío → null', () => {
    expect(ytmFromCronograma(0, bulletEquivalente, '2026-07-24')).toBeNull();
    expect(ytmFromCronograma(-1, bulletEquivalente, '2026-07-24')).toBeNull();
    expect(ytmFromCronograma(0.9, [], '2026-07-24')).toBeNull();
  });

  it('todos los flujos ya pasaron (bono vencido) → null', () => {
    expect(ytmFromCronograma(0.9, bulletEquivalente, '2035-01-01')).toBeNull();
  });

  it('ignora flujos con monto cero (fecha de referencia sin pago real)', () => {
    const conCero: CronogramaItem[] = [...bulletEquivalente, { fecha: '2026-08-01', interes: 0, amortizacion: 0, saldo_residual: 1 }];
    const r = ytmFromCronograma(0.9, conCero, '2026-07-24')!;
    const sinCero = ytmFromCronograma(0.9, bulletEquivalente, '2026-07-24')!;
    expect(r).toBeCloseTo(sinCero, 8);
  });

  it('duración: cronograma bullet da la MISMA duración que bondDuration() con los mismos términos', () => {
    const tir = ytmFromCronograma(0.9, bulletEquivalente, '2026-07-24')!;
    const viaCronograma = bondDurationFromCronograma(bulletEquivalente, tir, '2026-07-24')!;
    const viaFlat = bondDuration({ tasaAnual: 0.06, frecuencia: 2, vencimiento: '2031-07-24', hoy: '2026-07-24', ytmAnual: tir })!;
    expect(viaCronograma.macaulay).toBeCloseTo(viaFlat.macaulay, 6);
    expect(viaCronograma.modified).toBeCloseTo(viaFlat.modified, 6);
  });

  it('amortizar antes acorta la duración frente al bullet equivalente (recibís capital antes)', () => {
    const amortizable: CronogramaItem[] = [
      { fecha: '2027-01-24', interes: 0.03, amortizacion: 0, saldo_residual: 1 },
      { fecha: '2027-07-24', interes: 0.03, amortizacion: 0.34, saldo_residual: 0.66 },
      { fecha: '2028-01-24', interes: 0.0198, amortizacion: 0, saldo_residual: 0.66 },
      { fecha: '2028-07-24', interes: 0.0198, amortizacion: 0.33, saldo_residual: 0.33 },
      { fecha: '2029-01-24', interes: 0.0099, amortizacion: 0, saldo_residual: 0.33 },
      { fecha: '2029-07-24', interes: 0.0099, amortizacion: 0.33, saldo_residual: 0 },
    ];
    const tirAmort = ytmFromCronograma(0.9, amortizable, '2026-07-24')!;
    const durAmort = bondDurationFromCronograma(amortizable, tirAmort, '2026-07-24')!;
    const tirBullet = ytm({ precio: 0.9, tasaAnual: 0.06, frecuencia: 2, vencimiento: '2029-07-24', hoy: '2026-07-24' })!;
    const durBullet = bondDuration({ tasaAnual: 0.06, frecuencia: 2, vencimiento: '2029-07-24', hoy: '2026-07-24', ytmAnual: tirBullet })!;
    expect(durAmort.macaulay).toBeLessThan(durBullet.macaulay);
  });

  it('ytmAnual inválido (<=-1 o NaN) → null', () => {
    expect(bondDurationFromCronograma(bulletEquivalente, -1, '2026-07-24')).toBeNull();
    expect(bondDurationFromCronograma(bulletEquivalente, NaN, '2026-07-24')).toBeNull();
  });

  it('cronograma vacío o sin flujos futuros → null', () => {
    expect(bondDurationFromCronograma([], 0.08, '2026-07-24')).toBeNull();
    expect(bondDurationFromCronograma(bulletEquivalente, 0.08, '2035-01-01')).toBeNull();
  });

  // Mismo bug y misma corrección que en ytm() (ver su comentario) — acá no hay `frecuencia`
  // explícita, así que la duración del período se infiere de la distancia entre los DOS próximos
  // flujos del propio cronograma. Mismo criterio de test que en ytm(): comparar contra otro `hoy` no
  // aísla el efecto (confound con el tiempo restante al vencimiento) — se compara contra una
  // referencia armada a mano con xirr() para el MISMO hoy.
  describe('interés corrido (precio limpio → sucio)', () => {
    it('a mitad de período: reproduce el precio sucio esperado (inferido de la distancia entre los 2 próximos flujos)', () => {
      const hoy = '2026-10-24';
      const r = ytmFromCronograma(0.9, bulletEquivalente, hoy)!;
      // futuros[0]='2027-01-24', futuros[1]='2027-07-24' → período de 181 días; el "anterior" teórico
      // (2027-01-24 menos 181 días) cae el 2026-07-27, no el 24 — la asimetría ene↔jul/jul↔ene por
      // los distintos largos de mes es real, por eso se verifica con la cuenta exacta, no a ojo.
      const sucioEsperado = 0.9147513812154696;
      const referencia = xirr([{ date: hoy, amount: -sucioEsperado }, ...bulletEquivalente.map(f => ({ date: f.fecha, amount: f.interes + f.amortizacion }))]);
      expect(r).toBeCloseTo(referencia!, 8);
    });

    it('a mitad de período, la TIR es menor que si se ignorara el interés corrido (mismo precio limpio, mismo hoy)', () => {
      const hoy = '2026-10-24';
      const conAjuste = ytmFromCronograma(0.9, bulletEquivalente, hoy)!;
      const sinAjuste = xirr([{ date: hoy, amount: -0.9 }, ...bulletEquivalente.map(f => ({ date: f.fecha, amount: f.interes + f.amortizacion }))])!;
      expect(conAjuste).toBeLessThan(sinAjuste);
    });

    it('con un solo cupón futuro (último período del bono) no hay cronograma propio de dónde inferir la duración del período — se usa el precio limpio tal cual, sin crashear', () => {
      const ultimoCupon: CronogramaItem[] = [{ fecha: '2027-01-24', interes: 0.03, amortizacion: 1, saldo_residual: 0 }];
      const r = ytmFromCronograma(0.9, ultimoCupon, '2026-07-24');
      expect(r).not.toBeNull();
      expect(Number.isFinite(r)).toBe(true);
    });
  });

  describe('inferirCuponDeCronograma — precarga de Posicion desde bonos_referencia', () => {
    it('semestral (0.03 cada 6 meses): tasaAnual ≈ 0.06, frecuencia 2, mesRef = mes del próximo cupón', () => {
      const r = inferirCuponDeCronograma(bulletEquivalente, '2026-07-24')!;
      expect(r.frecuencia).toBe(2);
      expect(r.tasaAnual).toBeCloseTo(0.06, 6);
      expect(r.mesRef).toBe(1); // futuros[0] = '2027-01-24'
    });

    it('trimestral: frecuencia 4', () => {
      const trimestral: CronogramaItem[] = [
        { fecha: '2027-01-24', interes: 0.015, amortizacion: 0, saldo_residual: 1 },
        { fecha: '2027-04-24', interes: 0.015, amortizacion: 0, saldo_residual: 1 },
        { fecha: '2027-07-24', interes: 0.015, amortizacion: 1, saldo_residual: 0 },
      ];
      const r = inferirCuponDeCronograma(trimestral, '2026-07-24')!;
      expect(r.frecuencia).toBe(4);
      expect(r.tasaAnual).toBeCloseTo(0.06, 6);
    });

    it('con un solo cupón futuro no hay de dónde inferir la frecuencia → null', () => {
      const ultimoCupon: CronogramaItem[] = [{ fecha: '2027-01-24', interes: 0.03, amortizacion: 1, saldo_residual: 0 }];
      expect(inferirCuponDeCronograma(ultimoCupon, '2026-07-24')).toBeNull();
    });

    it('cronograma inválido o vacío → null, no crashea', () => {
      expect(inferirCuponDeCronograma(null, '2026-07-24')).toBeNull();
      expect(inferirCuponDeCronograma([], '2026-07-24')).toBeNull();
    });
  });

  // Hallazgos de la revisión adversarial: bonos_referencia se puebla a mano (no hay UI con
  // validación de forma) — un `cronograma` corrupto (jsonb `null`, no-array, fecha o monto no
  // numérico) NO debe crashear ni devolver un número armado con menos flujos de los que el bono
  // paga en realidad. Mejor "sin dato" (null) que un número silenciosamente mal.
  describe('cronograma corrupto — nunca crashea, nunca inventa un número con menos flujos', () => {
    it('cronograma null o no-array (jsonb mal cargado) → null, no TypeError', () => {
      expect(ytmFromCronograma(0.9, null, '2026-07-24')).toBeNull();
      expect(ytmFromCronograma(0.9, undefined, '2026-07-24')).toBeNull();
      expect(ytmFromCronograma(0.9, {} as unknown as CronogramaItem[], '2026-07-24')).toBeNull();
      expect(bondDurationFromCronograma(null, 0.08, '2026-07-24')).toBeNull();
      expect(bondDurationFromCronograma({} as unknown as CronogramaItem[], 0.08, '2026-07-24')).toBeNull();
    });

    it('una fecha inválida en CUALQUIER flujo anula el cronograma entero (no lo descarta en silencio)', () => {
      const conFechaRota: CronogramaItem[] = [...bulletEquivalente.slice(0, -1), { ...bulletEquivalente.at(-1)!, fecha: 'no-es-una-fecha' }];
      expect(ytmFromCronograma(0.9, conFechaRota, '2026-07-24')).toBeNull();
      const tir = ytmFromCronograma(0.9, bulletEquivalente, '2026-07-24')!;
      expect(bondDurationFromCronograma(conFechaRota, tir, '2026-07-24')).toBeNull();
    });

    it('interés/amortización no numérico (NaN) anula el cronograma — no se lo trata como cupón cero', () => {
      const conNaN: CronogramaItem[] = [...bulletEquivalente.slice(0, -1), { ...bulletEquivalente.at(-1)!, interes: NaN }];
      expect(ytmFromCronograma(0.9, conNaN, '2026-07-24')).toBeNull();
    });

    it('fecha con timestamp ISO completo (formato real de IOL, no solo YYYY-MM-DD) — TIR y duración dan el mismo resultado que con fecha corta', () => {
      const conTimestamp: CronogramaItem[] = bulletEquivalente.map(f => ({ ...f, fecha: f.fecha + 'T00:00:00' }));
      const tirCorta = ytmFromCronograma(0.9, bulletEquivalente, '2026-07-24')!;
      const tirLarga = ytmFromCronograma(0.9, conTimestamp, '2026-07-24')!;
      expect(tirLarga).toBeCloseTo(tirCorta, 6);
      const durCorta = bondDurationFromCronograma(bulletEquivalente, tirCorta, '2026-07-24')!;
      const durLarga = bondDurationFromCronograma(conTimestamp, tirLarga, '2026-07-24')!;
      expect(durLarga.macaulay).toBeCloseTo(durCorta.macaulay, 6);
      expect(Number.isFinite(durLarga.macaulay)).toBe(true);
    });
  });
});

describe('bondDuration — Macaulay y modificada', () => {
  it('cupón cero (bullet puro): Macaulay = tiempo exacto al vencimiento', () => {
    // Sin cupón, el único flujo es el rescate al vencimiento → el "promedio ponderado" es ese único punto.
    const d = bondDuration({ tasaAnual: 0, frecuencia: 2, vencimiento: '2027-07-24', hoy: '2026-07-24', ytmAnual: 0.10 })!;
    expect(d.macaulay).toBeCloseTo(1.0, 2);
    expect(d.modified).toBeCloseTo(1.0 / 1.10, 2);
  });

  it('con cupón, la duración es MENOR al tiempo al vencimiento (los cupones adelantan flujo)', () => {
    const d = bondDuration({ tasaAnual: 0.08, frecuencia: 2, vencimiento: '2031-07-24', hoy: '2026-07-24', ytmAnual: 0.08 })!;
    expect(d.macaulay).toBeGreaterThan(0);
    expect(d.macaulay).toBeLessThan(5);   // 5 años al vencimiento
  });

  it('a mayor cupón, menor duración (más peso en flujos tempranos)', () => {
    const bajo = bondDuration({ tasaAnual: 0.03, frecuencia: 2, vencimiento: '2031-07-24', hoy: '2026-07-24', ytmAnual: 0.08 })!;
    const alto = bondDuration({ tasaAnual: 0.12, frecuencia: 2, vencimiento: '2031-07-24', hoy: '2026-07-24', ytmAnual: 0.08 })!;
    expect(alto.macaulay).toBeLessThan(bajo.macaulay);
  });

  it('a mayor plazo al vencimiento, mayor duración', () => {
    const corto = bondDuration({ tasaAnual: 0.06, frecuencia: 2, vencimiento: '2028-07-24', hoy: '2026-07-24', ytmAnual: 0.08 })!;
    const largo = bondDuration({ tasaAnual: 0.06, frecuencia: 2, vencimiento: '2036-07-24', hoy: '2026-07-24', ytmAnual: 0.08 })!;
    expect(largo.macaulay).toBeGreaterThan(corto.macaulay);
  });

  it('modificada = macaulay / (1 + YTM)', () => {
    const d = bondDuration({ tasaAnual: 0.07, frecuencia: 4, vencimiento: '2033-01-15', hoy: '2026-07-24', ytmAnual: 0.095 })!;
    expect(d.modified).toBeCloseTo(d.macaulay / 1.095, 6);
  });

  it('datos inválidos o bono vencido → null (no inventa)', () => {
    expect(bondDuration({ tasaAnual: 0.07, frecuencia: 2, vencimiento: '2020-01-01', hoy: '2026-07-24', ytmAnual: 0.08 })).toBeNull();
    expect(bondDuration({ tasaAnual: 0.07, frecuencia: 2, vencimiento: 'nope', hoy: '2026-07-24', ytmAnual: 0.08 })).toBeNull();
    expect(bondDuration({ tasaAnual: 0.07, frecuencia: 2, vencimiento: '2030-01-01', hoy: '2026-07-24', ytmAnual: NaN })).toBeNull();
  });

  describe('valorResidual (bonos amortizables)', () => {
    it('sin valorResidual (u omitido) equivale a valorResidual: 1 (bullet, compatibilidad hacia atrás)', () => {
      const base = { tasaAnual: 0.07, frecuencia: 2, vencimiento: '2033-01-15', hoy: '2026-07-24', ytmAnual: 0.095 };
      const sinParam = bondDuration(base)!;
      const conUno = bondDuration({ ...base, valorResidual: 1 })!;
      expect(sinParam.macaulay).toBeCloseTo(conUno.macaulay, 10);
    });

    it('escalar TODOS los flujos por el mismo valorResidual no cambia la duración (es un promedio ponderado, invariante a la escala)', () => {
      const base = { tasaAnual: 0.07, frecuencia: 2, vencimiento: '2033-01-15', hoy: '2026-07-24', ytmAnual: 0.095 };
      const completo = bondDuration({ ...base, valorResidual: 1 })!;
      const mitad = bondDuration({ ...base, valorResidual: 0.5 })!;
      expect(mitad.macaulay).toBeCloseTo(completo.macaulay, 8);
      expect(mitad.modified).toBeCloseTo(completo.modified, 8);
    });
  });
});

describe('rendimientoCorriente — current yield', () => {
  it('a la par: rendimiento corriente = tasa del cupón', () => {
    expect(rendimientoCorriente(0.08, 1)).toBeCloseTo(0.08, 6);
  });

  it('bajo la par: rendimiento corriente > tasa del cupón', () => {
    expect(rendimientoCorriente(0.07, 0.60)).toBeCloseTo(0.07 / 0.60, 6);
    expect(rendimientoCorriente(0.07, 0.60)).toBeGreaterThan(0.07);
  });

  it('sobre la par: rendimiento corriente < tasa del cupón', () => {
    expect(rendimientoCorriente(0.08, 1.15)).toBeLessThan(0.08);
  });

  it('cupón 0 → rendimiento corriente 0 (no es null, 0 es válido)', () => {
    expect(rendimientoCorriente(0, 0.5)).toBe(0);
  });

  it('precio inválido → null (no inventa)', () => {
    expect(rendimientoCorriente(0.08, 0)).toBeNull();
    expect(rendimientoCorriente(0.08, -1)).toBeNull();
    expect(rendimientoCorriente(-0.01, 1)).toBeNull();
  });

  describe('valorResidual (bonos amortizables)', () => {
    it('sin valorResidual (u omitido) equivale a valorResidual: 1 (bullet, compatibilidad hacia atrás)', () => {
      expect(rendimientoCorriente(0.08, 0.9)).toBeCloseTo(rendimientoCorriente(0.08, 0.9, 1)!, 10);
    });

    it('el cupón se paga sobre el capital remanente: valorResidual 0.5 da la mitad de rendimiento corriente', () => {
      expect(rendimientoCorriente(0.08, 1, 0.5)).toBeCloseTo(0.04, 6);
    });
  });
});

describe('agruparCuotasPorPosicion', () => {
  it('agrupa por posicion_id, conservando fecha y porcentaje de cada cuota', () => {
    const m = agruparCuotasPorPosicion([
      { posicion_id: 'a', fecha: '2026-03-01', porcentaje: 0.2 },
      { posicion_id: 'b', fecha: '2026-04-01', porcentaje: 0.5 },
      { posicion_id: 'a', fecha: '2026-09-01', porcentaje: 0.3 },
    ]);
    expect(m.get('a')).toEqual([{ fecha: '2026-03-01', porcentaje: 0.2 }, { fecha: '2026-09-01', porcentaje: 0.3 }]);
    expect(m.get('b')).toEqual([{ fecha: '2026-04-01', porcentaje: 0.5 }]);
  });

  it('sin filas: mapa vacío, no revienta', () => {
    expect(agruparCuotasPorPosicion([]).size).toBe(0);
  });

  it('una posición sin cuotas no aparece en el mapa (el caller usa ?? [] para el default)', () => {
    const m = agruparCuotasPorPosicion([{ posicion_id: 'a', fecha: '2026-03-01', porcentaje: 0.2 }]);
    expect(m.get('otra-posicion')).toBeUndefined();
  });
});
