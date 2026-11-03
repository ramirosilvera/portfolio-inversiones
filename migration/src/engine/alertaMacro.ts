// =============================================================================
// Alerta de ESTRÉS macro para Inicio: indicadores del contexto macro que están en rojo por estrés REAL (no por «nivel elevado»), con
// el dato clave y cuánto de la cartera está expuesto a ese riesgo. Puro y testeado (regla de oro #1: el código calcula).
// Decisión del usuario (2026-11-03): solo estrés real. Oro, Bitcoin, S&P y Merval en rojo son «nivel elevado/euforia» y los dólares
// «atrasados» tampoco son estrés: siguen en /macro pero no disparan esta alerta.
// La exposición es una ESTIMACIÓN de cuánto del patrimonio pertenece a los activos que ese indicador afecta, no una predicción de pérdida.
// =============================================================================

import { SEMAFOROS, type SemaforoDef } from './semaforos';

export const INDICADORES_ESTRES = ['riesgo_pais', 'vix', 'hy_spread', 'dollar_index', 'dgs3mo', 'adr_ypf'] as const;

// Texto del umbral de rojo de cada indicador (los mismos de engine/semaforos.ts; el test verifica que coincidan con `evalua`).
export const UMBRAL_ROJO: Record<string, { texto: string; valorRojo: number }> = {
  riesgo_pais:  { texto: 'rojo desde 800 pb', valorRojo: 800 },
  vix:          { texto: 'rojo desde 30', valorRojo: 30 },
  hy_spread:    { texto: 'rojo desde 6 %', valorRojo: 6 },
  dollar_index: { texto: 'rojo sobre 126', valorRojo: 126.01 },
  dgs3mo:       { texto: 'rojo sobre 5 %', valorRojo: 5.01 },
  adr_ypf:      { texto: 'rojo bajo US$ 25', valorRojo: 24.99 },
};

// Histéresis: un indicador que ya estaba en alerta sigue en alerta hasta que sale de la banda (un valor que oscila alrededor del umbral,
// p. ej. riesgo país 799/805/798, no prende y apaga la alerta cada día). Ver `sigueEnAlerta`.
export const SALIDA: Record<string, { texto: string; sigue: (v: number) => boolean }> = {
  riesgo_pais:  { texto: 'bajar de 770 pb', sigue: v => v >= 770 },
  vix:          { texto: 'bajar de 28', sigue: v => v >= 28 },
  hy_spread:    { texto: 'bajar de 5,7 %', sigue: v => v >= 5.7 },
  dollar_index: { texto: 'bajar de 125', sigue: v => v >= 125 },
  dgs3mo:       { texto: 'bajar de 4,8 %', sigue: v => v >= 4.8 },
  adr_ypf:      { texto: 'subir de US$ 26', sigue: v => v <= 26 },
};

// Fecha LOCAL (no UTC): con toISOString() a partir de las 21:00 en Argentina ya es «mañana» y una alerta descartada reaparecía de noche.
export const fechaLocalISO = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface PosAlloc { ticker: string; mkt: number; tipo: string }

// Qué parte de la cartera afecta cada indicador (qué activos son sensibles a ese riesgo).
const EXPOSICION: Record<string, { etiqueta: string; aplica: (p: PosAlloc) => boolean }> = {
  riesgo_pais:  { etiqueta: 'bonos y acciones argentinas', aplica: p => p.tipo === 'bono' || p.tipo === 'accion_ar' },
  vix:          { etiqueta: 'CEDEARs, acciones y ETFs', aplica: p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf' },
  hy_spread:    { etiqueta: 'bonos y ONs (riesgo de crédito)', aplica: p => p.tipo === 'bono' },
  dollar_index: { etiqueta: 'activos argentinos (bonos y acciones locales)', aplica: p => p.tipo === 'bono' || p.tipo === 'accion_ar' },
  dgs3mo:       { etiqueta: 'CEDEARs, acciones, ETFs y bonos', aplica: p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf' || p.tipo === 'bono' },
  adr_ypf:      { etiqueta: 'ONs de YPF', aplica: p => /^(YM|YPF)/i.test(p.ticker) },
};

export interface AlertaEstres {
  key: string;
  label: string;
  valor: number;
  umbral: string;            // «rojo desde 30»
  significado: string;       // qué implica (del semáforo)
  expuestoUsd: number;
  expuestoPct: number | null;   // fracción 0..1 del patrimonio; null si no hay patrimonio
  expuestoEtiqueta: string;
  enBanda: boolean;          // true = ya no cruza el umbral de rojo pero sigue en alerta por histéresis
  salida: string;            // qué tiene que pasar para que se apague («bajar de 770 pb»)
}

const SIGNIFICADO_ROJO: Record<string, string> = {
  riesgo_pais: 'financiamiento caro y salida del mercado',
  vix: 'volatilidad alta: miedo en el mercado',
  hy_spread: 'crédito corporativo estresado: aversión al riesgo',
  dollar_index: 'dólar global fuerte: presión sobre emergentes',
  dgs3mo: 'tasa corta restrictiva: dinero caro',
  adr_ypf: 'YPF golpeada',
};

// Indicadores de estrés en ROJO hoy, con su exposición. Un indicador sin dato no alerta (nunca se asume). Orden: más expuesto primero.
export function alertasEstres(macro: Record<string, number | null | undefined>, alloc: PosAlloc[], patrimonio: number, activos: ReadonlySet<string> = new Set()): AlertaEstres[] {
  const out: AlertaEstres[] = [];
  for (const key of INDICADORES_ESTRES) {
    const def: SemaforoDef | undefined = SEMAFOROS.find(s => s.key === key);
    const v = macro[key];
    if (!def || v == null || !Number.isFinite(v)) continue;
    const rojo = def.evalua(v) === 'rojo';
    const enBanda = !rojo && activos.has(key) && SALIDA[key].sigue(v);
    if (!rojo && !enBanda) continue;
    const exp = EXPOSICION[key];
    const usd = alloc.filter(p => p.mkt > 0 && exp.aplica(p)).reduce((s, p) => s + p.mkt, 0);
    out.push({
      key, label: def.label, valor: v, umbral: UMBRAL_ROJO[key].texto, significado: SIGNIFICADO_ROJO[key],
      expuestoUsd: +usd.toFixed(2), expuestoPct: patrimonio > 0 ? usd / patrimonio : null, expuestoEtiqueta: exp.etiqueta,
      enBanda, salida: SALIDA[key].texto,
    });
  }
  return out.sort((a, b) => b.expuestoUsd - a.expuestoUsd);
}

// Clave que identifica «esta alerta de hoy»: si cambia el conjunto de indicadores en rojo, la alerta reaparece aunque se haya descartado.
export const claveAlertaDia = (hoy: string, alertas: AlertaEstres[]): string => `${hoy}|${alertas.map(a => a.key).sort().join(',')}`;
