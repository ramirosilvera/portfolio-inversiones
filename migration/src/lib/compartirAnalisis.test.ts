import { describe, it, expect } from 'vitest';
import { resumenCedear, resumenBono, textoWhatsApp, urlWhatsApp, nombreArchivo, PIE_LEGAL } from './compartirAnalisis';

const dcf: any = { verdict: 'COMPRAR', intrinsicPerShare: 500, marginOfSafety: 0.3, motivoInestable: null };
const ratios: any = { pe: 25, roic: 0.2, wacc: 0.09, operatingMargin: 0.4, debtToEquity: 0.3 };
const ced = (over: any = {}) => resumenCedear({ ticker: 'MSFT', nombre: 'Microsoft', precio: 350, dcf, ratios, d: 0.101, g: 0.08, mosRequerido: 0.2, fuente: 'SEC EDGAR', fecha: '2026-10-26', ...over });
const ref: any = { ticker: 'AL30', nombre: 'Bonar 2030', emisor: 'República Argentina', moneda: 'USD', vencimiento: '2030-07-09', calificadora: 'Fix', calificacion: 'CCC', verificacion: 'primaria', fuente: 'IOL | corregido 2026-10-10: aviso' };
const calc: any = { px: 70.5, tir: 0.12, rendCorriente: 0.07, paridad: 75.2, paridadAprox: false, duracion: { macaulay: 3.4 } };

describe('resumenCedear', () => {
  it('lleva veredicto, precio, valor intrínseco y margen formateados', () => {
    const r = ced();
    expect(r.veredicto).toEqual({ texto: 'COMPRAR', tono: 'pos' });
    expect(r.metricas.find(m => m.etiqueta === 'Margen de seguridad')?.valor).toBe('30%');
    expect(r.metricas.find(m => m.etiqueta === 'Valor intrínseco')?.valor).toBe('US$500.00');
  });
  it('no incluye datos de la cartera del usuario', () => {
    const txt = JSON.stringify(ced()).toLowerCase();
    for (const w of ['nominales', 'cantidad', 'p&l', 'resultado', 'invertido']) expect(txt).not.toContain(w);
  });
  it('un DCF inestable viaja como aviso; SIN_DATOS se rotula', () => {
    expect(ced({ dcf: { ...dcf, motivoInestable: 'g ≥ d' } }).avisos[0]).toContain('g ≥ d');
    expect(ced({ dcf: { ...dcf, verdict: 'SIN_DATOS' } }).veredicto?.texto).toBe('SIN DATOS');
  });
});

describe('resumenBono', () => {
  it('bono confiable: sin avisos y con TIR', () => {
    const r = resumenBono({ ref, calc, spreadUst: 0.05, fecha: '2026-10-26' });
    expect(r.avisos).toEqual([]);
    expect(r.metricas.find(m => m.etiqueta === 'TIR')?.valor).toBe('12.0%');
  });
  it('no confiable: el aviso de verificación viaja con la imagen', () => {
    const r = resumenBono({ ref: { ...ref, verificacion: 'sin_verificar' }, calc, spreadUst: null, fecha: '2026-10-26' });
    expect(r.avisos.join(' ')).toMatch(/No decidas/);
    expect(r.veredicto?.tono).toBe('warn');
  });
  it('sin cotización avisa y no inventa TIR', () => {
    const r = resumenBono({ ref, calc: { ...calc, px: null, tir: null }, spreadUst: null, fecha: '2026-10-26' });
    expect(r.avisos.join(' ')).toMatch(/Sin cotización/);
    expect(r.metricas.find(m => m.etiqueta === 'TIR')?.valor).toBe('—');
  });
});

describe('texto y archivo', () => {
  it('el texto de WhatsApp tiene el pie legal, la fuente y la fecha', () => {
    const t = textoWhatsApp(ced());
    expect(t).toContain(PIE_LEGAL); expect(t).toContain('SEC EDGAR · 2026-10-26'); expect(t.startsWith('*MSFT*')).toBe(true);
  });
  it('la URL escapa el texto y el nombre de archivo es seguro', () => {
    expect(urlWhatsApp('a b\n*c*')).toBe('https://wa.me/?text=a%20b%0A*c*');
    expect(nombreArchivo({ ...ced(), titulo: 'BRK.B' })).toBe('analisis-brk-b-2026-10-26.png');
  });
});
