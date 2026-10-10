import { describe, it, expect } from 'vitest';
import { couponEvents, couponCalendar, capitalEvents, capitalCalendar, agruparCuotasPorPosicion, ytm, bondDuration, rendimientoCorriente, ytmFromCronograma, bondDurationFromCronograma, inferirCuponDeCronograma, valorTecnicoFromCronograma, valorTecnicoBono, dias360, sumarMesesISO, liquidacionT1, type CouponBond, type CapitalBond, type CronogramaItem } from './coupons';
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

  // El precio (data912) ya es el SUCIO de mercado (coincide con dirty_price de IOL) — va tal cual a
  // la XIRR, sin sumarle interés corrido, sin importar en qué punto del período esté `hoy`. Ver el
  // comentario largo sobre `precio` en coupons.ts para la verificación empírica contra
  // get_fixed_income_analytics de IOL (MIC3D, CS48D, AL35D) que llevó a esta conclusión — sumar el
  // corrido encima (comportamiento de una versión anterior de este motor) contaba dos veces el mismo
  // interés y producía una TIR sistemáticamente subestimada.
  describe('el precio va tal cual a la XIRR, sin ajuste por interés corrido', () => {
    it('a cualquier punto del período, el flujo inicial es exactamente -precio (comparado contra xirr() armada a mano)', () => {
      const tasaAnual = 0.08, frecuencia = 2, vencimiento = '2031-08-20';
      const precio = 1.0194444444;
      const fechas = ['2026-08-20', '2027-02-20', '2027-08-20', '2028-02-20', '2028-08-20', '2029-02-20', '2029-08-20', '2030-02-20', '2030-08-20', '2031-02-20', '2031-08-20'];
      const cupon = tasaAnual / frecuencia;
      for (const hoy of ['2026-02-21', '2026-05-22', '2026-08-19']) {
        const r = ytm({ precio, tasaAnual, frecuencia, vencimiento, hoy })!;
        const referencia = xirr([{ date: hoy, amount: -precio }, ...fechas.map(f => ({ date: f, amount: cupon })), { date: fechas.at(-1)!, amount: 1 }]);
        expect(r).toBeCloseTo(referencia!, 10);
      }
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

  // El precio (data912) ya es el SUCIO de mercado — igual que en ytm(), va tal cual a la XIRR, sin
  // ajuste por interés corrido, sin importar en qué punto del período esté `hoy` ni cuántos flujos
  // futuros queden. Ver el comentario largo sobre `precio` en coupons.ts para la verificación
  // empírica contra get_fixed_income_analytics de IOL que llevó a esta conclusión.
  describe('el precio va tal cual a la XIRR, sin ajuste por interés corrido', () => {
    it('a cualquier punto del período, el flujo inicial es exactamente -precio (comparado contra xirr() armada a mano)', () => {
      for (const hoy of ['2026-08-25', '2026-10-24', '2026-12-01']) {
        const r = ytmFromCronograma(0.9, bulletEquivalente, hoy)!;
        const referencia = xirr([{ date: hoy, amount: -0.9 }, ...bulletEquivalente.map(f => ({ date: f.fecha, amount: f.interes + f.amortizacion }))])!;
        expect(r).toBeCloseTo(referencia, 10);
      }
    });

    it('con un solo cupón futuro (último período del bono) también usa el precio tal cual, sin crashear', () => {
      const ultimoCupon: CronogramaItem[] = [{ fecha: '2027-01-24', interes: 0.03, amortizacion: 1, saldo_residual: 0 }];
      const hoy = '2026-07-24';
      const r = ytmFromCronograma(0.9, ultimoCupon, hoy);
      const referencia = xirr([{ date: hoy, amount: -0.9 }, { date: '2027-01-24', amount: 1.03 }]);
      expect(r).not.toBeNull();
      expect(r!).toBeCloseTo(referencia!, 10);
    });

    // Caso real MIC3D (ON a ~90 días del vencimiento, cupón semestral 3.5%, precio ~par, un solo
    // flujo futuro — el caso que originalmente parecía "incongruente": TIR=14.6% para una duración de
    // apenas 0.2 años). Se auditó contra get_fixed_income_analytics de IOL: el precio de data912
    // (1.002) coincide con el dirty_price real de IOL (100.2), y la TIR real de IOL es 14.93% — muy
    // cerca del 14.56% que da este motor sin ningún ajuste. Antes de esta corrección, el motor SÍ
    // intentaba ajustar por interés corrido acá (sumándolo al precio) y el resultado se alejaba más
    // de la TIR real de IOL, no menos — quedó demostrado que el precio ya viene sucio.
    it('caso real MIC3D: TIR sin ajuste queda cerca de la TIR real de IOL (14.93%)', () => {
      const finalFlow: CronogramaItem = { fecha: '2026-11-11', interes: 0.035, amortizacion: 1, saldo_residual: 0 };
      const hoy = '2026-08-16';
      const tir = ytmFromCronograma(1.002, [finalFlow], hoy)!;
      expect(tir).toBeCloseTo(0.14561934080689637, 6);
      expect(tir).toBeGreaterThan(0.14);
      expect(tir).toBeLessThan(0.155); // dentro de ~1pp de la TIR real de IOL (14.93%)
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

// ── Paridad = precio sucio ÷ valor técnico (saldo residual + interés corrido), 30/360, liquidación T+1 ─────────────────────
// Los casos salen de get_fixed_income_analytics de IOL del 09/10/2026 (liquidación 13/10 por el feriado del 12/10; sin feriados
// acá el T+1 cae el 12/10, un día antes → diferencias de centésimas).
describe('valorTecnicoFromCronograma / paridad', () => {
  const crono = (fl: [string, number, number, number][]) =>
    fl.map(([fecha, interes, amortizacion, saldo_residual]) => ({ fecha, interes, amortizacion, saldo_residual }));

  it('PNDCD (amortizable, residual 40): corrido y valor técnico exactos de IOL con liquidación 13/10', () => {
    const c = crono([['2026-10-30', 0.0182, 0.2, 0.2], ['2027-04-30', 0.0091, 0.2, 0]]);
    // hoy 12/10 ⇒ T+1 = 13/10 (martes), la misma fecha de liquidación que usó IOL
    const vt = valorTecnicoFromCronograma(c, '2026-10-12')!;
    expect(vt.saldo).toBeCloseTo(0.4, 10);
    expect(vt.corrido * 100).toBeCloseTo(1.648111, 5);
    expect(vt.valorTecnico * 100).toBeCloseTo(41.648111, 5);
    expect(vt.aproximado).toBe(false);
    expect(0.4416 / vt.valorTecnico).toBeCloseTo(1.0603, 3);   // paridad de IOL: 1,0603
  });

  it('DNC7D (bullet por ahora, 4,9 por período): paridad ≈ 104,16 % a 108,95, no 108,95', () => {
    const c = crono([['2026-10-24', 0.049, 0, 1], ['2027-04-24', 0.049, 0, 1]]);
    const vt = valorTecnicoFromCronograma(c, '2026-10-09')!;    // viernes ⇒ T+1 = lunes 12/10
    expect(vt.valorTecnico * 100).toBeCloseTo(104.57, 1);       // IOL (13/10): 104,60
    expect(1.0895 / vt.valorTecnico * 100).toBeCloseTo(104.18, 1);   // IOL: 104,16
  });

  it('PM29D (residual 38,458 con cupones escalados): saldo = saldo después + amortización', () => {
    const c = crono([['2027-03-19', 0.011056675, 0.07692, 0.30766], ['2027-09-19', 0.008845225, 0.07692, 0.23074]]);
    const vt = valorTecnicoFromCronograma(c, '2026-10-12')!;
    expect(vt.saldo).toBeCloseTo(0.38458, 6);
    expect(vt.valorTecnico * 100).toBeCloseTo(38.6054, 2);       // IOL: 38,6054
  });

  it('CAC5D (residual 50): el saldo amortizado sale del denominador', () => {
    const c = crono([['2027-02-25', 0.02325, 0.125, 0.375], ['2027-08-25', 0.0174375, 0.125, 0.25]]);
    const vt = valorTecnicoFromCronograma(c, '2026-10-12')!;
    expect(vt.saldo).toBeCloseTo(0.5, 10);
    expect(vt.valorTecnico * 100).toBeCloseTo(50.62, 1);         // IOL: 50,62
  });

  it('BPA7D (cupón 2,5 con amortización 50 % en el medio): 100 + corrido ≈ 102,26', () => {
    const c = crono([['2026-10-31', 0.025, 0, 1], ['2027-04-30', 0.025, 0.5, 0.5], ['2027-10-31', 0.0125, 0.5, 0]]);
    const vt = valorTecnicoFromCronograma(c, '2026-10-12')!;
    expect(vt.valorTecnico * 100).toBeCloseTo(102.264, 2);       // IOL: 102,2639
  });

  it('un solo flujo futuro: período supuesto, queda marcado aproximado', () => {
    const vt = valorTecnicoFromCronograma(crono([['2026-11-11', 0.02125, 1, 0]]), '2026-10-12', '2025-11-11')!;
    expect(vt.aproximado).toBe(true);
    expect(vt.saldo).toBe(1);
    expect(vt.corrido).toBeGreaterThan(0);
    expect(vt.corrido).toBeLessThanOrEqual(0.02125);
  });

  it('sin flujos futuros o cronograma inválido → null', () => {
    expect(valorTecnicoFromCronograma(crono([['2020-01-01', 0.04, 1, 0]]), '2026-10-12')).toBeNull();
    expect(valorTecnicoFromCronograma(null, '2026-10-12')).toBeNull();
  });

  it('el corrido nunca pasa del cupón completo (liquidación en o después del próximo cupón)', () => {
    const vt = valorTecnicoFromCronograma(crono([['2026-10-13', 0.04, 0, 1], ['2027-04-13', 0.04, 1, 0]]), '2026-10-12')!;
    expect(vt.corrido).toBeLessThanOrEqual(0.04 + 1e-12);
  });
});

describe('valorTecnicoBono (campos de la posición)', () => {
  it('bullet 8 % semestral con vencimiento 2030-04-14: corrido proporcional al período en curso', () => {
    const vt = valorTecnicoBono({ tasaAnual: 0.08, frecuencia: 2, vencimiento: '2030-04-14', hoy: '2026-10-09' })!;
    expect(vt.saldo).toBe(1);
    // período 14/04→14/10: liquidación 12/10 ⇒ 178/180 de 4 puntos
    expect(vt.corrido * 100).toBeCloseTo(4 * 178 / 180, 3);
  });
  it('con valor residual 0,5 el cupón del período y el saldo se escalan', () => {
    const vt = valorTecnicoBono({ tasaAnual: 0.08, frecuencia: 2, vencimiento: '2030-04-14', hoy: '2026-10-09', valorResidual: 0.5 })!;
    expect(vt.saldo).toBe(0.5);
    expect(vt.corrido * 100).toBeCloseTo(2 * 178 / 180, 3);
  });
  it('bono vencido → null', () => {
    expect(valorTecnicoBono({ tasaAnual: 0.08, frecuencia: 2, vencimiento: '2020-04-14', hoy: '2026-10-09' })).toBeNull();
  });
});

describe('helpers de fecha del valor técnico', () => {
  it('dias360 sigue la convención US', () => {
    expect(dias360('2026-04-24', '2026-10-13')).toBe(169);
    expect(dias360('2026-04-30', '2026-10-13')).toBe(163);
    expect(dias360('2026-01-31', '2026-03-31')).toBe(60);
  });
  it('sumarMesesISO conserva el día y recorta a fin de mes', () => {
    expect(sumarMesesISO('2026-10-24', -6)).toBe('2026-04-24');
    expect(sumarMesesISO('2026-08-31', -6)).toBe('2026-02-28');
  });
  it('liquidacionT1 salta fines de semana', () => {
    expect(liquidacionT1('2026-10-09')).toBe('2026-10-12');   // viernes → lunes
    expect(liquidacionT1('2026-10-12')).toBe('2026-10-13');
  });
});
