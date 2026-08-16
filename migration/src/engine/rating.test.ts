import { describe, it, expect } from 'vitest';
import { clasificarRating } from './rating';

describe('clasificarRating — S&P/Fitch (escala global de letras)', () => {
  it('grado de inversión: de AAA a BBB-', () => {
    expect(clasificarRating('S&P', 'AAA')).toEqual({ grado: 'grado_inversion', escala: 'global' });
    expect(clasificarRating('Fitch', 'A-')).toEqual({ grado: 'grado_inversion', escala: 'global' });
    expect(clasificarRating('S&P', 'BBB-')).toEqual({ grado: 'grado_inversion', escala: 'global' });
  });

  it('especulativo: de BB+ a C', () => {
    expect(clasificarRating('S&P', 'BB+')?.grado).toBe('especulativo');
    expect(clasificarRating('Fitch', 'B-')?.grado).toBe('especulativo');
    expect(clasificarRating('S&P', 'CCC')?.grado).toBe('especulativo');
  });

  it('default: D/RD/SD', () => {
    expect(clasificarRating('S&P', 'D')?.grado).toBe('default');
    expect(clasificarRating('Fitch', 'RD')?.grado).toBe('default');
  });

  it('no distingue mayúsculas/minúsculas ni espacios', () => {
    expect(clasificarRating('S&P', ' bbb- ')?.grado).toBe('grado_inversion');
    expect(clasificarRating('S&P', 'bb+')?.grado).toBe('especulativo');
  });
});

describe('clasificarRating — Moody\'s (escala numérica global)', () => {
  it('grado de inversión: de Aaa a Baa3', () => {
    expect(clasificarRating("Moody's", 'Aaa')).toEqual({ grado: 'grado_inversion', escala: 'global' });
    expect(clasificarRating("Moody's", 'A2')?.grado).toBe('grado_inversion');
    expect(clasificarRating("Moody's", 'Baa3')?.grado).toBe('grado_inversion');
  });

  it('especulativo: de Ba1 a Ca', () => {
    expect(clasificarRating("Moody's", 'Ba1')?.grado).toBe('especulativo');
    expect(clasificarRating("Moody's", 'Caa2')?.grado).toBe('especulativo');
    expect(clasificarRating("Moody's", 'Ca')?.grado).toBe('especulativo');
  });

  it('default: C', () => {
    expect(clasificarRating("Moody's", 'C')?.grado).toBe('default');
  });
});

describe('clasificarRating — FIX SCR y Moody\'s Local (escala NACIONAL argentina, SÍ se clasifica)', () => {
  it('FIX SCR clasifica con la misma tabla de letras que Fitch, marcando escala "local"', () => {
    expect(clasificarRating('FIX SCR', 'AAA')).toEqual({ grado: 'grado_inversion', escala: 'local' });
    expect(clasificarRating('FIX SCR', 'BB+')).toEqual({ grado: 'especulativo', escala: 'local' });
    expect(clasificarRating('FIX SCR', 'D')).toEqual({ grado: 'default', escala: 'local' });
  });

  it('acepta el sufijo "(arg)" (con o sin espacio) y lo normaliza antes de clasificar', () => {
    expect(clasificarRating('FIX SCR', 'AAA(arg)')).toEqual({ grado: 'grado_inversion', escala: 'local' });
    expect(clasificarRating('FIX SCR', 'AAA (arg)')).toEqual({ grado: 'grado_inversion', escala: 'local' });
    expect(clasificarRating('FIX SCR', 'aaa(ARG)')).toEqual({ grado: 'grado_inversion', escala: 'local' });
  });

  // Moody's Local Argentina publica su escala nacional con notación de LETRAS +/- (AAA.ar, AA+.ar,
  // A+.ar, BBB-.ar...), la misma que S&P/Fitch — NO la notación numérica (Aaa/Aa1/A2/Baa3) que usa
  // Moody's Investors Service en su escala global. Verificado contra la escala pública de Moody's
  // Local Argentina y una acción de rating real (CABA: de AA+.ar a AAA.ar). Caso real que detectó
  // este bug: MIC3D (Mirgor), calificado "A+.ar" por Moody's Local, clasificaba null (parecía "sin
  // calificar" en la UI) porque "A+" no existe en la tabla numérica de Moody's.
  it('Moody\'s Local clasifica con la tabla de LETRAS +/- (S&P/Fitch), marcando escala "local"', () => {
    expect(clasificarRating("Moody's Local", 'AAA')).toEqual({ grado: 'grado_inversion', escala: 'local' });
    expect(clasificarRating("Moody's Local", 'A+')).toEqual({ grado: 'grado_inversion', escala: 'local' });
    expect(clasificarRating("Moody's Local", 'BBB-')).toEqual({ grado: 'grado_inversion', escala: 'local' });
    expect(clasificarRating("Moody's Local", 'BB+')).toEqual({ grado: 'especulativo', escala: 'local' });
  });

  it('acepta el sufijo ".ar" y lo normaliza antes de clasificar', () => {
    expect(clasificarRating("Moody's Local", 'A+.ar')).toEqual({ grado: 'grado_inversion', escala: 'local' });
    expect(clasificarRating("Moody's Local", 'AAA.ar')).toEqual({ grado: 'grado_inversion', escala: 'local' });
  });

  it('NO clasifica con la notación numérica de Moody\'s global (esa tabla es solo para la calificadora "Moody\'s")', () => {
    expect(clasificarRating("Moody's Local", 'Baa3')).toBeNull();
    expect(clasificarRating("Moody's Local", 'Ba1')).toBeNull();
  });

  it('NUNCA mezcla escala global y local en el mismo grado sin distinguir — "escala" siempre lo indica', () => {
    const global = clasificarRating('S&P', 'BBB-');
    const local = clasificarRating('FIX SCR', 'BBB-');
    expect(global?.grado).toBe(local?.grado); // mismo grado...
    expect(global?.escala).not.toBe(local?.escala); // ...pero escalas distintas, siempre presentes
  });
});

describe('clasificarRating — "Otra": notación desconocida, nunca clasifica', () => {
  it('siempre null, aunque la nota "parezca" reconocible', () => {
    expect(clasificarRating('Otra', 'AAA')).toBeNull();
    expect(clasificarRating('Otra', 'Baa3')).toBeNull();
  });
});

describe('clasificarRating — datos faltantes o desconocidos', () => {
  it('sin calificadora o sin nota → null', () => {
    expect(clasificarRating(null, 'AAA')).toBeNull();
    expect(clasificarRating('S&P', null)).toBeNull();
    expect(clasificarRating(undefined, undefined)).toBeNull();
    expect(clasificarRating('S&P', '')).toBeNull();
  });

  it('nota que no matchea ninguna escala conocida → null, no adivina', () => {
    expect(clasificarRating('S&P', 'XYZ123')).toBeNull();
    expect(clasificarRating("Moody's", 'BBB-')).toBeNull(); // notación de S&P, no de Moody's
    expect(clasificarRating('FIX SCR', 'XYZ123')).toBeNull();
  });
});
