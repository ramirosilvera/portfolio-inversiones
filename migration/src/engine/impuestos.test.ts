import { describe, it, expect } from 'vitest';
import {
  paramsBP, patrimonioImponible, evaluarBienesPersonales, gananciasPorAnio, proximaDDJJ, alertasImpuestos,
  BIENES_PERSONALES, DDJJ_AVISO_DIAS, ESCALA_BP, escalaBP, calcularBienesPersonales, patrimonioOtrosArs, esProvisoria,
} from './impuestos';
import type { Cobro } from '../types/domain';

const cobro = (o: Partial<Cobro>): Cobro => ({
  id: 'x', portfolio_id: 'p', posicion_id: null, ticker: 'MSFT', tipo: 'dividendo', fecha: '2026-03-10', monto: 10,
  estado: 'disponible', origen: 'manual', movimiento_id: null, nota: null, created_at: '', ...o,
});

describe('paramsBP', () => {
  it('devuelve el año pedido si está publicado', () => {
    const p = paramsBP(2025)!;
    expect(p.minimoNoImponible).toBe(BIENES_PERSONALES[2025].minimoNoImponible);
    expect(p.estimado).toBe(false);
  });
  it('para un año sin publicar usa el último conocido y lo marca estimado', () => {
    const p = paramsBP(2026)!;
    expect(p.anioParams).toBe(2025);
    expect(p.estimado).toBe(true);
  });
  it('antes del primer año conocido no inventa nada', () => {
    expect(paramsBP(2020)).toBeNull();
  });
});

describe('patrimonioImponible', () => {
  it('separa bonos, acciones locales y liquidez; el total incluye todo', () => {
    const r = patrimonioImponible([
      { tipo: 'cedear', valorUsd: 1000 }, { tipo: 'bono', valorUsd: 400 },
      { tipo: 'accion_ar', valorUsd: 100 }, { tipo: 'cash', valorUsd: 500 }, { tipo: 'etf', valorUsd: 0 },
    ]);
    expect(r.total).toBe(2000);
    expect(r.probable).toBe(1500);
    expect(r.bonos).toBe(400);
    expect(r.liquidez).toBe(500);
  });
  it('ignora valores negativos o no numéricos', () => {
    expect(patrimonioImponible([{ tipo: 'cedear', valorUsd: -5 }, { tipo: 'cedear', valorUsd: NaN }]).total).toBe(0);
  });
});

describe('evaluarBienesPersonales', () => {
  const params = { minimoNoImponible: 400_000_000, casaHabitacion: 0, fuente: 't' };
  it('lejos del mínimo → ok', () => {
    const e = evaluarBienesPersonales(60_000, 1500, params)!;   // 90 M
    expect(e.nivel).toBe('ok');
    expect(e.ratio).toBeCloseTo(0.225, 3);
    expect(e.margenUsd).toBeCloseTo(400_000_000 / 1500 - 60_000, 2);
  });
  it('umbrales 50 % / 80 % / 100 %', () => {
    expect(evaluarBienesPersonales(150_000, 1500, params)!.nivel).toBe('info');   // 56 %
    expect(evaluarBienesPersonales(220_000, 1500, params)!.nivel).toBe('warn');   // 82 %
    expect(evaluarBienesPersonales(300_000, 1500, params)!.nivel).toBe('neg');    // 112 %
    expect(evaluarBienesPersonales(300_000, 1500, params)!.margenUsd).toBeLessThan(0);
  });
  it('sin dólar no calcula', () => {
    expect(evaluarBienesPersonales(1000, 0, params)).toBeNull();
  });
});

describe('gananciasPorAnio', () => {
  it('suma bruto, retención y neto de dividendos confirmados por año', () => {
    const r = gananciasPorAnio([
      cobro({ fecha: '2026-03-10', monto: 6.4, monto_bruto: 10, retencion_usd: 3, comision_usd: 0.6 }),
      cobro({ fecha: '2026-06-10', monto: 20 }),   // sin detalle: el bruto es el monto declarado
      cobro({ fecha: '2025-12-10', monto: 5 }),
    ]);
    const a26 = r.find(x => x.anio === 2026)!;
    expect(a26.dividendosBruto).toBeCloseTo(30, 6);
    expect(a26.dividendosNeto).toBeCloseTo(26.4, 6);
    expect(a26.retencionExterior).toBeCloseTo(3, 6);
    expect(a26.sinDetalle).toBe(1);
    expect(r[0].anio).toBe(2026);   // más reciente primero
  });
  it('excluye pendientes y descartados, y separa los cupones', () => {
    const r = gananciasPorAnio([
      cobro({ estado: 'pendiente', monto: 100 }), cobro({ estado: 'descartado', monto: 100 }),
      cobro({ tipo: 'interes', ticker: 'YM43D', monto: 96 }), cobro({ tipo: 'amortizacion', monto: 500 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].dividendosBruto).toBe(0);
    expect(r[0].intereses).toBe(96);
  });
});

describe('proximaDDJJ', () => {
  it('antes del vencimiento publicado del período anterior, ese es el próximo', () => {
    const d = proximaDDJJ('2026-05-30');
    expect(d.anioFiscal).toBe(2025);
    expect(d.fecha).toBe('2026-07-27');
    expect(d.estimado).toBe(false);
    expect(d.dias).toBe(58);
  });
  it('pasado ese vencimiento, el próximo es el período en curso (estimado)', () => {
    const d = proximaDDJJ('2026-10-20');
    expect(d.anioFiscal).toBe(2026);
    expect(d.fecha).toBe('2027-06-30');
    expect(d.estimado).toBe(true);
  });
  it('el mismo día del vencimiento todavía cuenta', () => {
    expect(proximaDDJJ('2026-07-27').dias).toBe(0);
  });
});

describe('alertasImpuestos', () => {
  const ddjjLejos = proximaDDJJ('2026-10-20');
  const ddjjCerca = proximaDDJJ('2026-06-01');
  const evalBp = (usd: number) => evaluarBienesPersonales(usd, 1500, { minimoNoImponible: 400_000_000, casaHabitacion: 0, fuente: 't' });

  it('sin riesgo y lejos del vencimiento: sin alertas', () => {
    expect(alertasImpuestos({ bp: evalBp(60_000), bpEstimado: false, ddjj: ddjjLejos, dividendosAnioFiscal: 200 })).toEqual([]);
  });
  it('supera el mínimo → neg; cerca → warn', () => {
    expect(alertasImpuestos({ bp: evalBp(300_000), bpEstimado: false, ddjj: ddjjLejos, dividendosAnioFiscal: 0 })[0].severidad).toBe('neg');
    expect(alertasImpuestos({ bp: evalBp(220_000), bpEstimado: false, ddjj: ddjjLejos, dividendosAnioFiscal: 0 })[0].severidad).toBe('warn');
  });
  it('vencimiento cercano con dividendos del exterior avisa; sin dividendos no', () => {
    expect(ddjjCerca.dias).toBeLessThanOrEqual(DDJJ_AVISO_DIAS);
    expect(alertasImpuestos({ bp: evalBp(60_000), bpEstimado: false, ddjj: ddjjCerca, dividendosAnioFiscal: 150 })).toHaveLength(1);
    expect(alertasImpuestos({ bp: evalBp(60_000), bpEstimado: false, ddjj: ddjjCerca, dividendosAnioFiscal: 0 })).toHaveLength(0);
  });
});

describe('evaluarBienesPersonales con otros bienes', () => {
  const params = { minimoNoImponible: 400_000_000, casaHabitacion: 0, fuente: 't' };
  it('suma los bienes en pesos al patrimonio de los portfolios', () => {
    const e = evaluarBienesPersonales(60_000, 1500, params, 27_000_000)!;   // 90 M + 27 M
    expect(e.patrimonioArs).toBe(117_000_000);
    expect(e.ratio).toBeCloseTo(0.2925, 4);
    expect(e.margenUsd).toBeCloseTo((400_000_000 - 117_000_000) / 1500, 4);
  });
  it('un valor negativo de otros bienes no resta', () => {
    expect(evaluarBienesPersonales(60_000, 1500, params, -5)!.patrimonioArs).toBe(90_000_000);
  });
});

describe('patrimonioOtrosArs', () => {
  const params = { casaHabitacion: 1_346_548_155.99 };
  it('suma vehículos y demás; la casa-habitación exenta no entra', () => {
    expect(patrimonioOtrosArs([
      { tipo: 'vehiculo', valor_ars: 27_000_000, base: 'seguro' },
      { tipo: 'casa_habitacion', valor_ars: 200_000_000, base: 'mercado' },
    ], params)).toBe(27_000_000);
  });
  it('la casa-habitación que supera el umbral entra completa (el umbral no se resta)', () => {
    expect(patrimonioOtrosArs([{ tipo: 'casa_habitacion', valor_ars: 1_500_000_000, base: 'mercado' }], params)).toBe(1_500_000_000);
  });
  it('ignora valores en cero o inválidos', () => {
    expect(patrimonioOtrosArs([{ tipo: 'otro', valor_ars: 0, base: 'costo' }, { tipo: 'otro', valor_ars: NaN, base: 'costo' }], params)).toBe(0);
  });
  it('solo la valuación de ARCA no es provisoria', () => {
    expect(esProvisoria('valuacion_arca')).toBe(false);
    expect(esProvisoria('seguro')).toBe(true);
  });
});

describe('escala y cálculo de Bienes Personales', () => {
  const params = { minimoNoImponible: BIENES_PERSONALES[2025].minimoNoImponible };
  const escala = ESCALA_BP[2025];

  it('por debajo del mínimo no se paga nada', () => {
    const r = calcularBienesPersonales(110_000_000, params, escala);
    expect(r).toEqual({ excedente: 0, impuesto: 0, alicuotaMarginal: null, alicuotaEfectiva: 0 });
  });
  it('justo en el mínimo tampoco', () => {
    expect(calcularBienesPersonales(params.minimoNoImponible, params, escala).impuesto).toBe(0);
  });
  it('tramo 1: 0,5 % del excedente', () => {
    const r = calcularBienesPersonales(params.minimoNoImponible + 10_000_000, params, escala);
    expect(r.impuesto).toBeCloseTo(50_000, 2);
    expect(r.alicuotaMarginal).toBe(0.005);
  });
  it('la escala es continua: el fijo de cada tramo es el impuesto acumulado de los anteriores', () => {
    const [t1, t2, t3] = escala.tramos;
    expect(t2.fijo).toBeCloseTo(t1.alicuota * t1.hasta!, 1);
    expect(t3.fijo).toBeCloseTo(t2.fijo + t2.alicuota * (t2.hasta! - t1.hasta!), 1);
  });
  it('tramo 2 y 3 con el fijo + alícuota sobre el piso del tramo', () => {
    const e2 = 80_000_000;
    const r2 = calcularBienesPersonales(params.minimoNoImponible + e2, params, escala);
    expect(r2.impuesto).toBeCloseTo(263_321.42 + 0.0075 * (e2 - 52_664_283.73), 2);
    expect(r2.alicuotaMarginal).toBe(0.0075);
    const e3 = 200_000_000;
    const r3 = calcularBienesPersonales(params.minimoNoImponible + e3, params, escala);
    expect(r3.impuesto).toBeCloseTo(724_133.89 + 0.01 * (e3 - 114_105_948.16), 2);
    expect(r3.alicuotaMarginal).toBe(0.01);
    expect(r3.alicuotaEfectiva).toBeGreaterThan(0);
  });
  it('en el borde de un tramo ambos lados dan el mismo impuesto', () => {
    const borde = escala.tramos[0].hasta!;
    const dentro = calcularBienesPersonales(params.minimoNoImponible + borde, params, escala).impuesto;
    const fuera = calcularBienesPersonales(params.minimoNoImponible + borde + 0.01, params, escala).impuesto;
    expect(fuera - dentro).toBeLessThan(0.02);
  });
  it('escalaBP usa la del año o la última conocida (estimada)', () => {
    expect(escalaBP(2025)!.estimado).toBe(false);
    const e = escalaBP(2026)!;
    expect(e.anioEscala).toBe(2025);
    expect(e.estimado).toBe(true);
    expect(escalaBP(2020)).toBeNull();
  });
});
