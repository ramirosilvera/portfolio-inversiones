import { describe, it, expect } from 'vitest';
import { validarCik, extraerCikDeFmpProfile } from './_cikResolve';

describe('validarCik', () => {
  it('acepta un CIK de 10 dígitos con ceros a la izquierda (formato real de EDGAR)', () => {
    expect(validarCik('0000320193')).toBe('0000320193'); // AAPL
  });

  it('recorta espacios pero no acepta otros formatos', () => {
    expect(validarCik(' 0000320193 ')).toBe('0000320193');
    expect(validarCik('320193')).toBeNull();          // sin ceros a la izquierda
    expect(validarCik('AAPL')).toBeNull();
    expect(validarCik('00003201930')).toBeNull();      // 11 dígitos
  });

  it('valores no-string (null, undefined, número) → null, nunca los convierte a mano', () => {
    expect(validarCik(null)).toBeNull();
    expect(validarCik(undefined)).toBeNull();
    expect(validarCik(320193)).toBeNull();
  });
});

describe('extraerCikDeFmpProfile', () => {
  it('extrae el CIK del primer (único) elemento del array que devuelve FMP', () => {
    expect(extraerCikDeFmpProfile([{ symbol: 'AAPL', cik: '0000320193', beta: 1.2 }])).toBe('0000320193');
  });

  it('array vacío (FMP no tiene cobertura de este ticker) → null', () => {
    expect(extraerCikDeFmpProfile([])).toBeNull();
  });

  it('perfil sin campo cik, o con un cik en formato inválido → null (no inventa ni fuerza el formato)', () => {
    expect(extraerCikDeFmpProfile([{ symbol: 'XYZ' }])).toBeNull();
    expect(extraerCikDeFmpProfile([{ symbol: 'XYZ', cik: '' }])).toBeNull();
    expect(extraerCikDeFmpProfile([{ symbol: 'XYZ', cik: 'N/A' }])).toBeNull();
  });

  it('respuesta con forma inesperada (no array, null) → null, no rompe', () => {
    expect(extraerCikDeFmpProfile(null)).toBeNull();
    expect(extraerCikDeFmpProfile(undefined)).toBeNull();
    expect(extraerCikDeFmpProfile({ cik: '0000320193' })).toBeNull(); // objeto, no array — forma real de FMP
  });
});
