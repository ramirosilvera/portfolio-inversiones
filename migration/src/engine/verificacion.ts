// =============================================================================
// Estado de verificación de los datos del catálogo de renta fija (bonos_referencia, migración 0061).
//
// El catálogo se alimenta de IOL, que NO es fuente primaria (2026-10: cronogramas con cupón a la mitad, otra emisión, ON en
// pesos cargadas como USD…). Cada fila lleva un nivel que dice CUÁNTO se puede confiar en sus flujos, para no decidir con un
// dato que solo se parece a un bono. Los niveles ordenan de más a menos confiable; `revisar` e `inconsistente` son alertas
// distintas: la primera es un indicio (precio atípico), la segunda una contradicción directa con otra fuente.
// Puro y testeado (regla de oro #1: el código clasifica, no un LLM).
// =============================================================================

export type NivelVerificacion = 'primaria' | 'secundaria' | 'consistente' | 'revisar' | 'inconsistente' | 'sin_verificar';
export type TonoVerificacion = 'pos' | 'accent' | 'gray' | 'warn' | 'neg';

export interface InfoNivel {
  label: string;
  tono: TonoVerificacion;
  // Qué significa, en una frase que se entienda sin conocer el proceso.
  descripcion: string;
  // ¿Se puede usar para decidir una compra? primaria/secundaria/consistente sí; el resto, no sin revisar antes.
  confiable: boolean;
}

// Orden = de más a menos confiable (también el orden de los filtros y de las columnas ordenables).
export const NIVELES: NivelVerificacion[] = ['primaria', 'secundaria', 'consistente', 'revisar', 'inconsistente', 'sin_verificar'];

export const VERIFICACION: Record<NivelVerificacion, InfoNivel> = {
  primaria: {
    label: 'Verificado · fuente primaria',
    tono: 'pos',
    descripcion: 'Contrastado con el aviso de resultados, el suplemento o el flujo de fondos del broker.',
    confiable: true,
  },
  secundaria: {
    label: 'Verificado · fuente externa',
    tono: 'accent',
    descripcion: 'Tasa y vencimiento coinciden con fuentes externas independientes de IOL (estudios jurídicos, comunicados del emisor, prensa); falta el aviso primario.',
    confiable: true,
  },
  consistente: {
    label: 'Consistente',
    tono: 'gray',
    descripcion: 'El vencimiento (y la tasa si figura) coincide con la ficha de IOL y la TIR de mercado es plausible. Sin fuente externa: sigue siendo un dato de IOL.',
    confiable: true,
  },
  revisar: {
    label: 'Revisar',
    tono: 'warn',
    descripcion: 'Sin contradicción directa, pero el precio de mercado da una TIR atípica: puede haber un cupón o un saldo mal cargado.',
    confiable: false,
  },
  inconsistente: {
    label: 'Inconsistente',
    tono: 'neg',
    descripcion: 'Hay evidencia en contra de los datos del catálogo (otra moneda, otro vencimiento, flujos faltantes). No usar para decidir.',
    confiable: false,
  },
  sin_verificar: {
    label: 'Sin verificar',
    tono: 'gray',
    descripcion: 'Solo datos de IOL: no hubo precio ni analytics para contrastarlos.',
    confiable: false,
  },
};

const VALIDOS = new Set<string>(NIVELES);

// Un valor ausente o desconocido (fila nueva, columna que el servidor todavía no devolvió) es «sin verificar», nunca «verificado».
export function nivelDe(ref: { verificacion?: string | null }): NivelVerificacion {
  const v = ref.verificacion;
  return v && VALIDOS.has(v) ? (v as NivelVerificacion) : 'sin_verificar';
}

export function esConfiable(ref: { verificacion?: string | null }): boolean {
  return VERIFICACION[nivelDe(ref)].confiable;
}

// Posición del nivel en NIVELES (0 = más confiable): para ordenar una columna.
export function rangoVerificacion(ref: { verificacion?: string | null }): number {
  return NIVELES.indexOf(nivelDe(ref));
}

export function resumenVerificacion(refs: { verificacion?: string | null }[]): Record<NivelVerificacion, number> {
  const out = Object.fromEntries(NIVELES.map(n => [n, 0])) as Record<NivelVerificacion, number>;
  for (const r of refs) out[nivelDe(r)]++;
  return out;
}

// Texto del tooltip: descripción del nivel + nota de la fila + fecha de la última verificación.
export function textoVerificacion(ref: { verificacion?: string | null; verificacion_nota?: string | null; verificado_en?: string | null }): string {
  const n = nivelDe(ref);
  const partes = [VERIFICACION[n].descripcion];
  if (ref.verificacion_nota) partes.push(ref.verificacion_nota);
  if (ref.verificado_en) partes.push(`Revisado el ${ref.verificado_en.split('-').reverse().join('/')}.`);
  return partes.join(' ');
}
