import { describe, it, expect } from 'vitest';
import {
  paramsBP, patrimonioImponible, evaluarBienesPersonales, gananciasPorAnio, proximaDDJJ, alertasImpuestos,
  BIENES_PERSONALES, DDJJ_AVISO_DIAS,
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
