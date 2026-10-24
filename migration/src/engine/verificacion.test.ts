import { describe, it, expect } from 'vitest';
import { NIVELES, VERIFICACION, nivelDe, esConfiable, rangoVerificacion, resumenVerificacion, textoVerificacion } from './verificacion';

describe('nivelDe', () => {
  it('un valor ausente o desconocido es «sin verificar», nunca verificado', () => {
    expect(nivelDe({})).toBe('sin_verificar');
    expect(nivelDe({ verificacion: null })).toBe('sin_verificar');
    expect(nivelDe({ verificacion: 'verificadisimo' })).toBe('sin_verificar');
  });
  it('respeta los niveles válidos', () => {
    for (const n of NIVELES) expect(nivelDe({ verificacion: n })).toBe(n);
  });
});

describe('esConfiable', () => {
  it('solo primaria, secundaria y consistente sirven para decidir', () => {
    const ok = NIVELES.filter(n => esConfiable({ verificacion: n }));
    expect(ok).toEqual(['primaria', 'secundaria', 'consistente']);
  });
  it('revisar, inconsistente y sin verificar no', () => {
    for (const n of ['revisar', 'inconsistente', 'sin_verificar'] as const) expect(esConfiable({ verificacion: n })).toBe(false);
  });
});

describe('rangoVerificacion', () => {
  it('ordena de más a menos confiable', () => {
    expect(rangoVerificacion({ verificacion: 'primaria' })).toBeLessThan(rangoVerificacion({ verificacion: 'secundaria' }));
    expect(rangoVerificacion({ verificacion: 'consistente' })).toBeLessThan(rangoVerificacion({ verificacion: 'inconsistente' }));
    expect(rangoVerificacion({})).toBe(NIVELES.length - 1);
  });
});

describe('resumenVerificacion', () => {
  it('cuenta por nivel y suma todo el catálogo', () => {
    const refs = [{ verificacion: 'primaria' }, { verificacion: 'primaria' }, { verificacion: 'revisar' }, {}, { verificacion: 'xx' }];
    const r = resumenVerificacion(refs);
    expect(r.primaria).toBe(2);
    expect(r.revisar).toBe(1);
    expect(r.sin_verificar).toBe(2);
    expect(Object.values(r).reduce((a, b) => a + b, 0)).toBe(refs.length);
  });
});

describe('textoVerificacion', () => {
  it('suma descripción, nota y fecha en formato local', () => {
    const t = textoVerificacion({ verificacion: 'secundaria', verificacion_nota: 'Último cupón proporcional supuesto.', verificado_en: '2026-10-24' });
    expect(t).toContain(VERIFICACION.secundaria.descripcion);
    expect(t).toContain('Último cupón proporcional supuesto.');
    expect(t).toContain('24/10/2026');
  });
  it('sin nota ni fecha, solo la descripción', () => {
    expect(textoVerificacion({ verificacion: 'inconsistente' })).toBe(VERIFICACION.inconsistente.descripcion);
  });
});
