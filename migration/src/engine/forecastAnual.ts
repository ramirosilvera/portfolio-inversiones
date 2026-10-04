// =============================================================================
// Presupuesto vs real POR AÑO CALENDARIO (en vez de por mes). Puro y determinista.
//
// Por qué se puede hacer sin perder rigor: el modelo sigue siendo mensual por dentro (aportes y retorno mensual
// equivalente — ver engine/presupuesto.ts), solo se REPORTA por año. Así los aportes que entran durante el año rinden
// la fracción que corresponde (el modelo anual con aporte a fin de año subestima el valor final), y la descomposición del
// desvío (aportes + mercado) es exacta a cualquier granularidad. Cada año usa los mismos rendimientos que la tarjeta
// "Rendimiento por año" (RendAnio), así que los % coinciden fila por fila.
//
// Tipos de fila:
//  - 'historia': año anterior al presupuesto → solo real (no hubo presupuesto), con el retorno objetivo prorrateado como referencia.
//  - 'presupuesto': año del presupuesto cerrado o en curso ("a la fecha" si es el año en curso).
//  - 'cierre': estimación del cierre del año en curso con el forecast actualizado, contra el presupuesto a diciembre.
// =============================================================================

import {
  presupuestoMensual, realMensual, cruzar, reproyectar, retornoObjetivo,
  type Presupuesto, type PuntoValor, type FlujoFirmado, type ModoAportes, type FilaCruce,
} from './presupuesto';
import type { RendAnio } from './rendimiento';

export interface FilaAnual {
  anio: number;
  tipo: 'historia' | 'presupuesto' | 'cierre';
  aLaFecha: boolean;             // año en curso: los valores son "a la fecha", no cierre de año
  aportePpto: number | null;
  aporteReal: number | null;
  valorPpto: number | null;
  valorReal: number | null;      // en 'cierre', el valor ESTIMADO con el forecast actualizado
  desvio: number | null;         // valorReal − valorPpto
  desvioPct: number | null;
  desvioAportes: number | null;  // del año (aportes reales − presupuestados)
  desvioMercado: number | null;  // del año (desvío − desvíoAportes)
  rendReal: number | null;       // % del año calendario (Modified Dietz — el de la tarjeta de rendimiento)
  rendObjetivo: number | null;   // retorno presupuestado prorrateado a los días del período del % real
  concentrado: boolean;          // % poco representativo (casi todo el capital entró hace pocos días)
}

const anioDe = (ym: string) => Number(ym.slice(0, 4));
const mesesHastaFinDeAnio = (inicio: string, hoy: string) => {
  const [y0, m0] = inicio.split('-').map(Number), y1 = Number(hoy.slice(0, 4));
  return Math.max(1, (y1 - y0) * 12 + (12 - m0 + 1));
};

export function resumenPorAnio(
  b: Presupuesto, puntos: PuntoValor[], flujos: FlujoFirmado[], hoy: string, rendAnios: RendAnio[], modo: ModoAportes = 'presupuesto',
): FilaAnual[] {
  const anioInicio = anioDe(b.inicio), anioHoy = Number(hoy.slice(0, 4));
  const filas: FilaAnual[] = [];
  const vacia = (anio: number, tipo: FilaAnual['tipo'], extra: Partial<FilaAnual> = {}): FilaAnual => ({
    anio, tipo, aLaFecha: false, aportePpto: null, aporteReal: null, valorPpto: null, valorReal: null, desvio: null, desvioPct: null,
    desvioAportes: null, desvioMercado: null, rendReal: null, rendObjetivo: null, concentrado: false, ...extra,
  });

  // ── años anteriores al presupuesto: solo historia real ──
  for (const r of rendAnios.filter(x => x.anio < anioInicio && x.rendimiento != null)) {
    filas.push(vacia(r.anio, 'historia', {
      aporteReal: r.aportadoNeto, valorReal: r.valorFin ?? null, rendReal: r.rendimiento,
      rendObjetivo: r.dias ? retornoObjetivo(b.tasaAnual, r.dias) : null, concentrado: !!r.concentrado,
    }));
  }

  // ── años con presupuesto: modelo mensual agregado por año calendario ──
  const n = mesesHastaFinDeAnio(b.inicio, hoy);
  const ppto = presupuestoMensual(b, n);
  const real = realMensual(b, puntos, flujos, hoy, n);
  const cruce = cruzar(ppto, real, b.valorInicial);
  let acumAportesPrev = 0, acumMercadoPrev = 0;                 // desvíos acumulados al cierre del año anterior
  for (let y = anioInicio; y <= anioHoy; y++) {
    const delAnio = cruce.filter(f => anioDe(f.periodo) === y);
    const conDato = delAnio.filter(f => f.valorReal != null);
    const ult: FilaCruce | undefined = conDato[conDato.length - 1];
    if (!ult) { filas.push(vacia(y, 'presupuesto', { aLaFecha: y === anioHoy })); continue; }
    const aportePpto = delAnio.slice(0, delAnio.indexOf(ult) + 1).reduce((s, f) => s + f.aportePpto, 0);
    const aporteReal = delAnio.slice(0, delAnio.indexOf(ult) + 1).reduce((s, f) => s + (f.aporteReal ?? 0), 0);
    const dAport = (ult.desvioAportes ?? 0) - acumAportesPrev, dMerc = (ult.desvioMercado ?? 0) - acumMercadoPrev;
    acumAportesPrev = ult.desvioAportes ?? 0; acumMercadoPrev = ult.desvioMercado ?? 0;
    const ra = rendAnios.find(x => x.anio === y);
    filas.push(vacia(y, 'presupuesto', {
      aLaFecha: y === anioHoy && hoy < `${y}-12-31`,
      aportePpto, aporteReal, valorPpto: ult.valorPpto, valorReal: ult.valorReal, desvio: ult.desvio, desvioPct: ult.desvioPct,
      desvioAportes: dAport, desvioMercado: dMerc,
      rendReal: ra?.rendimiento ?? null, rendObjetivo: ra?.dias ? retornoObjetivo(b.tasaAnual, ra.dias) : null, concentrado: !!ra?.concentrado,
    }));
  }

  // ── cierre estimado del año en curso: forecast actualizado vs presupuesto a diciembre ──
  const repro = reproyectar(b, ppto, real, modo);
  const dic = `${anioHoy}-12`;
  const iDic = ppto.findIndex(p => p.periodo === dic);
  if (repro && iDic >= 0 && cruce[iDic]?.valorReal == null) {
    const valorPpto = ppto[iDic].valor, valorReal = repro.meses[iDic].valor;
    const aporteCierre = (anio: number) => ppto.filter(p => anioDe(p.periodo) === anio).reduce((s, p) => s + p.aporte, 0);
    filas.push(vacia(anioHoy, 'cierre', {
      valorPpto, valorReal, desvio: valorReal - valorPpto, desvioPct: valorPpto ? (valorReal - valorPpto) / valorPpto : null,
      aportePpto: aporteCierre(anioHoy),
    }));
  }
  return filas;
}

