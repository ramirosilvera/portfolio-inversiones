// =============================================================================
// Análisis de renta variable (CEDEARs): distribución por sector y por estilo Peter Lynch (rol),
// y concentración. Puro y testeado — mismo criterio que engine/bonos.ts: una sola fuente de verdad
// que CedearsPage y (si se agrega después) un resumen del Dashboard puedan compartir.
// =============================================================================

import { unitValueUSD, marketValueUSD, costUSD } from '../lib/valuation';
import type { Alerta } from './alertas';
import type { Posicion, AssetRole } from '../types/domain';

// Las 6 categorías canónicas de "One Up on Wall Street" (Peter Lynch) + 'compounder', un agregado
// del proyecto (no es de Lynch — la usan value investors de calidad tipo Terry Smith/Nick Sleep
// para negocios que reinvierten capital a tasas altas de forma sostenida) para no forzar esas
// empresas dentro de "stalwart" cuando el crecimiento es mayor al típico de esa categoría.
export const ROL_LABEL: Record<AssetRole, { label: string; desc: string }> = {
  compounder: { label: 'Compounder', desc: 'Reinvierte capital a tasas altas de forma sostenida por muchos años (no es una categoría de Lynch — agregado del proyecto para calidad compuesta).' },
  stalwart: { label: 'Estable grande', desc: 'Empresa grande y madura, crecimiento moderado (~10-12% anual) — más resistente en recesiones que una fast grower.' },
  fast_grower: { label: 'Crecimiento acelerado', desc: 'Empresa chica o agresiva creciendo 20%+ anual — mayor potencial, mayor riesgo y volatilidad.' },
  slow_grower: { label: 'Crecimiento lento', desc: 'Empresa grande y madura, crece apenas más que la economía — suele pagar buenos dividendos.' },
  cyclical: { label: 'Cíclica', desc: 'Ingresos y ganancias suben y bajan con el ciclo económico (autos, aerolíneas, materiales).' },
  turnaround: { label: 'Recuperación', desc: 'Empresa golpeada o en crisis con potencial de recuperación fuerte si resuelve sus problemas.' },
  asset_play: { label: 'Activos ocultos', desc: 'El valor de sus activos (inmuebles, patentes, caja, participaciones) no está reflejado en el precio.' },
};
export const ROLES: AssetRole[] = ['compounder', 'stalwart', 'fast_grower', 'slow_grower', 'cyclical', 'turnaround', 'asset_play'];

// Colores FIJOS por rol (no por índice como en un donut genérico): así el mismo rol siempre se ve
// del mismo color, sea cual sea el orden en que aparezcan las categorías presentes en la cartera.
export const ROL_COLOR: Record<AssetRole, string> = {
  compounder: '#4F97D4', stalwart: '#5FB49C', fast_grower: '#F4C752', slow_grower: '#9BCFEF',
  cyclical: '#B08BD6', turnaround: '#E08E6D', asset_play: '#C7A15A',
};
export const SIN_CLASIFICAR_COLOR = '#8B96A5';

// Umbral de alerta de concentración por POSICIÓN (ticker) — a diferencia de sector/estilo (más
// abajo), este no es personalizable por el usuario: no se pidió, y una alerta de "un solo ticker
// es X% de la cartera" es un riesgo bastante universal (no depende tanto del criterio personal).
export const CONCENTRACION_POSICION_ALERTA = 0.40;  // un solo ticker concentra esto o más del capital en CEDEARs
// HHI ≈ 0.33 equivale a 3 sectores parejos (1/3): por debajo de eso, la cartera está más repartida
// que "3 sectores del mismo tamaño"; por encima, más concentrada que eso. Fijo (no personalizable):
// es una referencia estadística, no una preferencia — el umbral que SÍ es personal es el de abajo
// (% en un solo sector), pedido directamente por el usuario.
export const HHI_SECTOR_ALERTA = 0.33;
// % del capital sin sector cargado a partir del cual vale la pena avisar (no es un riesgo de
// mercado — es un hueco de datos que le resta precisión al resto de los indicadores de esta página).
export const SIN_CLASIFICAR_ALERTA = 0.20;

export interface CedearCalc {
  pos: Posicion;
  mkt: number | null;         // valor de mercado (null si no hay cotización)
  capital: number;            // costo (precio_compra × cantidad)
  res: number | null;         // resultado (mkt − capital)
  capitalUsado: number;       // mkt si hay cotización, si no cae al costo
}

// Un solo CEDEAR: valor de mercado (via unitValueUSD, que ya divide por ratio_cedear) y resultado.
export function calcularCedear(pos: Posicion, live: number | null, factorCedear = 1): CedearCalc {
  const mkt = marketValueUSD(pos, live, factorCedear);
  const capital = costUSD(pos);
  const res = mkt != null ? mkt - capital : null;
  return { pos, mkt, capital, res, capitalUsado: mkt ?? capital };
}

// Índice de Herfindahl-Hirschman sobre una lista de pesos (0..1, deberían sumar ~1): mide
// concentración. 1/N = perfectamente repartido entre N categorías; 1 = todo en una sola. Estándar
// de la industria para medir diversificación — no es una aproximación, es la fórmula real (Σ wᵢ²).
export function herfindahl(pesos: number[]): number {
  return pesos.reduce((s, w) => s + w * w, 0);
}

export interface ResumenCedears {
  totalCapital: number;
  totalMkt: number;
  mayorPosicion: { ticker: string; pct: number } | null;
  nSectores: number;               // sectores distintos con capital > 0 (sin contar "Sin sector")
  hhiSector: number | null;        // concentración sectorial (Herfindahl), null si no hay capital
  porSector: { sector: string; pct: number }[];   // ordenado desc, "Sin sector" al final si aplica
  porRol: { rol: AssetRole | 'sin_clasificar'; pct: number }[];   // ordenado desc
}

export function resumenCedears(cedearsCalc: CedearCalc[]): ResumenCedears {
  const totalCapital = cedearsCalc.reduce((s, c) => s + c.capital, 0);
  const totalMkt = cedearsCalc.reduce((s, c) => s + c.capitalUsado, 0);

  const mayor = totalMkt > 0 && cedearsCalc.length > 0
    ? cedearsCalc.reduce((max, c) => c.capitalUsado > max.capitalUsado ? c : max, cedearsCalc[0])
    : null;

  const porSectorMap = new Map<string, number>();
  const porRolMap = new Map<AssetRole | 'sin_clasificar', number>();
  for (const c of cedearsCalc) {
    const sector = c.pos.sector?.trim() || 'Sin sector';
    porSectorMap.set(sector, (porSectorMap.get(sector) ?? 0) + c.capitalUsado);
    const rol = c.pos.rol ?? 'sin_clasificar';
    porRolMap.set(rol, (porRolMap.get(rol) ?? 0) + c.capitalUsado);
  }

  const toFracciones = <K,>(m: Map<K, number>): { key: K; pct: number }[] =>
    totalMkt > 0
      ? [...m.entries()].map(([key, cap]) => ({ key, pct: cap / totalMkt })).sort((a, b) => b.pct - a.pct)
      : [];

  const porSector = toFracciones(porSectorMap).map(({ key, pct }) => ({ sector: key, pct }));
  const porRol = toFracciones(porRolMap).map(({ key, pct }) => ({ rol: key, pct }));
  const nSectores = porSector.filter(s => s.sector !== 'Sin sector').length;
  const hhiSector = totalMkt > 0 ? herfindahl(porSector.map(s => s.pct)) : null;

  return {
    totalCapital, totalMkt,
    mayorPosicion: mayor && totalMkt > 0 ? { ticker: mayor.pos.ticker, pct: mayor.capitalUsado / totalMkt } : null,
    nSectores, hhiSector, porSector, porRol,
  };
}

// Alertas de riesgo/calidad de datos sobre la cartera de CEDEARs — mismos umbrales que ya
// coloreaban los Stats de CedearsPage, ahora en un único lugar para que CedearsPage y el resumen
// del Dashboard muestren EXACTAMENTE la misma lista (nunca "en una pantalla avisa y en la otra no").
// `concentracionSectorPct`/`concentracionEstiloPct` son umbrales PERSONALES (0..100, no fracciones,
// mismo criterio que `minGradoInversionPct` en alertasBonos) — obligatorios como parámetro, quien
// llama los trae de useObjetivoConcentracion (localStorage por portfolio).
export function alertasCedears(r: ResumenCedears, concentracionSectorPct: number, concentracionEstiloPct: number): Alerta[] {
  const alertas: Alerta[] = [];

  if (r.mayorPosicion && r.mayorPosicion.pct >= CONCENTRACION_POSICION_ALERTA) {
    alertas.push({ severidad: 'warn', texto: `${r.mayorPosicion.ticker} concentra ${Math.round(r.mayorPosicion.pct * 100)}% del capital en CEDEARs — un solo ticker por encima del ${Math.round(CONCENTRACION_POSICION_ALERTA * 100)}%.` });
  }

  const mayorSector = r.porSector.find(s => s.sector !== 'Sin sector');
  if (mayorSector && mayorSector.pct * 100 >= concentracionSectorPct) {
    alertas.push({ severidad: 'warn', texto: `${Math.round(mayorSector.pct * 100)}% del capital en CEDEARs está en el sector ${mayorSector.sector} — por encima de tu máximo personal de ${concentracionSectorPct}%.` });
  }

  if (r.hhiSector != null && r.hhiSector >= HHI_SECTOR_ALERTA) {
    alertas.push({ severidad: 'warn', texto: `Concentración sectorial (HHI) en ${r.hhiSector.toFixed(2)} — equivale a repartir el capital en solo ~${(1 / r.hhiSector).toFixed(1)} sectores parejos.` });
  }

  const mayorEstilo = r.porRol.find(x => x.rol !== 'sin_clasificar');
  if (mayorEstilo && mayorEstilo.pct * 100 >= concentracionEstiloPct) {
    alertas.push({ severidad: 'warn', texto: `${Math.round(mayorEstilo.pct * 100)}% del capital en CEDEARs está en el estilo "${ROL_LABEL[mayorEstilo.rol as AssetRole].label}" (Peter Lynch) — por encima de tu máximo personal de ${concentracionEstiloPct}%, poca diversificación de perfil de riesgo/crecimiento.` });
  }

  const sinSector = r.porSector.find(s => s.sector === 'Sin sector');
  if (sinSector && sinSector.pct >= SIN_CLASIFICAR_ALERTA) {
    alertas.push({ severidad: 'warn', texto: `${Math.round(sinSector.pct * 100)}% del capital en CEDEARs no tiene sector cargado — clasificalo para que la distribución sea precisa.` });
  }

  return alertas;
}

// unitValueUSD se reexporta por conveniencia (paridad/precio unitario en la tabla de CedearsPage).
export { unitValueUSD };
