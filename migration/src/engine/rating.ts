// =============================================================================
// Calificación crediticia de bonos/ONs. La calificadora y la nota las carga el usuario a mano (no
// hay API configurada en este proyecto que dé rating por bono — ni data912 ni las fuentes de
// acciones lo tienen).
//
// Escala GLOBAL (S&P, Moody's, Fitch) vs. escala NACIONAL/local (FIX SCR, Moody's Local): NO son
// comparables entre sí — el techo soberano argentino hace que el mejor bono en escala nacional
// (ej. "AAA(arg)") pueda convivir con una calificación soberana GLOBAL mucho más baja. Por eso cada
// nota se clasifica DENTRO de su propia escala (el código nunca mezcla "grado de inversión global"
// con "grado de inversión nacional" como si fueran lo mismo — ver `escala` en el resultado, y cada
// lugar de la UI que muestra el grado aclara a qué escala corresponde).
//
// FIX SCR (afiliada local de Fitch) Y Moody's Local Argentina publican su escala nacional con la
// notación de LETRAS +/- de S&P/Fitch (AAA.ar, AA+.ar, A+.ar, BBB-.ar...) — no con la notación
// numérica (Aaa, Aa1, A2, Baa3...) que Moody's Investors Service usa en su escala GLOBAL. Verificado
// contra la escala pública de Moody's Local Argentina (moodyslocal.com.ar) y una acción de rating real
// (CABA: de AA+.ar a AAA.ar) — antes este archivo asumía que Moody's Local usaba la tabla numérica,
// lo que hacía fallar silenciosamente cualquier nota con +/- (ej. "A+.ar" clasificaba null pese a ser
// grado de inversión real, caso detectado en MIC3D). Por eso ambas calificadoras locales reusan
// ESCALA_SP_FITCH, no ESCALA_MOODYS — la tabla numérica solo aplica a la calificadora GLOBAL "Moody's".
// =============================================================================

export type GradoCredito = 'grado_inversion' | 'especulativo' | 'default';
export type EscalaRating = 'global' | 'local';
export interface RatingClasificado { grado: GradoCredito; escala: EscalaRating }

// Calificadoras de escala GLOBAL (comparables entre países).
export const CALIFICADORAS_GLOBALES = ['S&P', "Moody's", 'Fitch'] as const;
// Calificadoras de escala NACIONAL/local — clasificables (FIX SCR, Moody's Local) o no ('Otra': no
// conocemos su notación, nunca "adivinamos").
export const CALIFICADORAS_LOCALES = ['FIX SCR', "Moody's Local", 'Otra'] as const;
// Orden del selector: las locales (FIX SCR, Moody's Local) primero — son las que se usan en la
// enorme mayoría de bonos/ONs argentinos; el techo soberano hace que casi ningún emisor local
// tenga rating GLOBAL de grado de inversión, así que S&P/Moody's/Fitch quedan como el caso menos
// frecuente (ej. ONs hard-dollar con rating internacional) y 'Otra' al final como comodín.
export const CALIFICADORAS = ['FIX SCR', "Moody's Local", ...CALIFICADORAS_GLOBALES, 'Otra'] as const;
export type Calificadora = typeof CALIFICADORAS[number];
// Todas las que sí clasificamos automáticamente (todas menos 'Otra').
export const CALIFICADORAS_CLASIFICABLES = [...CALIFICADORAS_GLOBALES, 'FIX SCR', "Moody's Local"] as const;

// S&P y Fitch comparten notación de letras (fuente: escalas públicas de S&P Global Ratings y
// Fitch Ratings, largo plazo). BBB- es el último escalón de grado de inversión; D/RD/SD = default.
// FIX SCR (Fitch Argentina) usa la MISMA estructura de letras en su escala nacional.
const ESCALA_SP_FITCH: Record<string, GradoCredito> = {
  AAA: 'grado_inversion', 'AA+': 'grado_inversion', AA: 'grado_inversion', 'AA-': 'grado_inversion',
  'A+': 'grado_inversion', A: 'grado_inversion', 'A-': 'grado_inversion',
  'BBB+': 'grado_inversion', BBB: 'grado_inversion', 'BBB-': 'grado_inversion',
  'BB+': 'especulativo', BB: 'especulativo', 'BB-': 'especulativo',
  'B+': 'especulativo', B: 'especulativo', 'B-': 'especulativo',
  'CCC+': 'especulativo', CCC: 'especulativo', 'CCC-': 'especulativo', CC: 'especulativo', C: 'especulativo',
  D: 'default', RD: 'default', SD: 'default',
};

// Moody's (global) usa notación numérica (1/2/3) en vez de +/-. Baa3 es el último escalón de grado
// de inversión; C es el piso (default/en incumplimiento). Moody's Local Argentina NO usa esta tabla
// — ver el comentario sobre ESCALA_SP_FITCH más arriba.
const ESCALA_MOODYS: Record<string, GradoCredito> = {
  AAA: 'grado_inversion', AA1: 'grado_inversion', AA2: 'grado_inversion', AA3: 'grado_inversion',
  A1: 'grado_inversion', A2: 'grado_inversion', A3: 'grado_inversion',
  BAA1: 'grado_inversion', BAA2: 'grado_inversion', BAA3: 'grado_inversion',
  BA1: 'especulativo', BA2: 'especulativo', BA3: 'especulativo',
  B1: 'especulativo', B2: 'especulativo', B3: 'especulativo',
  CAA1: 'especulativo', CAA2: 'especulativo', CAA3: 'especulativo', CA: 'especulativo',
  C: 'default',
};

// Quita el sufijo de escala nacional argentina si está presente, para que "AAA", "AAA(arg)" y
// "AAA.ar" busquen todos la misma nota base en la tabla de letras/números.
function notaBase(calificacion: string): string {
  return calificacion.trim().toUpperCase()
    .replace(/\s*\(ARG\)\s*$/, '')
    .replace(/\.AR$/, '')
    .trim();
}

// Clasifica en grado de inversión / especulativo / default DENTRO de la escala de la calificadora
// (global o nacional) — null si falta algún dato, si la calificadora es 'Otra' (notación
// desconocida), o si la nota no matchea ninguna escala conocida (nunca "adivina").
export function clasificarRating(calificadora: string | null | undefined, calificacion: string | null | undefined): RatingClasificado | null {
  if (!calificadora || !calificacion) return null;
  const nota = notaBase(calificacion);
  if (!nota) return null;
  if (calificadora === 'S&P' || calificadora === 'Fitch') {
    const g = ESCALA_SP_FITCH[nota]; return g ? { grado: g, escala: 'global' } : null;
  }
  if (calificadora === "Moody's") {
    const g = ESCALA_MOODYS[nota]; return g ? { grado: g, escala: 'global' } : null;
  }
  if (calificadora === 'FIX SCR') {
    const g = ESCALA_SP_FITCH[nota]; return g ? { grado: g, escala: 'local' } : null;
  }
  if (calificadora === "Moody's Local") {
    const g = ESCALA_SP_FITCH[nota]; return g ? { grado: g, escala: 'local' } : null;
  }
  return null; // 'Otra': no conocemos su notación, no clasificamos
}

export const ETIQUETA_GRADO: Record<GradoCredito, string> = {
  grado_inversion: 'Grado de inversión',
  especulativo: 'Especulativo',
  default: 'Default',
};

export const ETIQUETA_ESCALA: Record<EscalaRating, string> = {
  global: 'escala global',
  local: 'escala nacional (Arg.)',
};
