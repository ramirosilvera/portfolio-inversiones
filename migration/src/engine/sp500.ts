// Comparación del rendimiento por año del portfolio contra el S&P 500 (retorno total, SPY ajustado). Puro y testeado:
// los números salen de acá, nunca de un LLM. La serie viene de /api/market/sp500-anual.

export interface PuntoSp { f: string; c: number }

const DIA = 86_400_000;
const MAX_GAP_DIAS = 7; // tolerancia: la serie tiene que cubrir el inicio del período con ≤ 1 semana de desfase

// Último cierre con fecha ≤ `fecha`. null si la serie empieza más de MAX_GAP_DIAS después (no cubre el período).
function cierreAl(serie: PuntoSp[], fecha: string): number | null {
  let lo = 0, hi = serie.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (serie[mid].f <= fecha) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans < 0) return null;
  return serie[ans].c;
}

// Retorno del S&P entre dos fechas. null si la serie no cubre el inicio o el fin del período.
export function retornoSp(serie: PuntoSp[], desde: string, hasta: string): number | null {
  if (serie.length < 2 || !(desde < hasta)) return null;
  if ((Date.parse(serie[0].f) - Date.parse(desde)) / DIA > MAX_GAP_DIAS) return null;
  const ult = serie[serie.length - 1].f;
  if ((Date.parse(hasta) - Date.parse(ult)) / DIA > MAX_GAP_DIAS) return null;
  const a = cierreAl(serie, desde) ?? serie[0].c;
  const b = cierreAl(serie, hasta);
  if (b == null || !(a > 0)) return null;
  return b / a - 1;
}

export interface FilaVsSp {
  anio: number;
  portfolio: number | null;
  sp500: number | null;
  diferencia: number | null; // portfolio − S&P, en puntos porcentuales/100
  dias: number | null;
  parcial: boolean;           // el año en curso, o el de arranque del portfolio
  concentrado: boolean;
}

// Período de cada año = el mismo que usa "Rendimiento por año": fin = 31/12 (o hoy), `dias` hacia atrás. Sin `dias`,
// se asume año calendario completo (o hasta hoy en el año en curso).
export function compararConSp500(
  rendAnios: { anio: number; rendimiento: number | null; dias?: number; concentrado?: boolean }[],
  serie: PuntoSp[], hoy: string,
): FilaVsSp[] {
  const anioHoy = Number(hoy.slice(0, 4));
  return rendAnios.map(r => {
    const fin = r.anio >= anioHoy ? hoy : `${r.anio}-12-31`;
    const diasPer = r.dias ?? (r.anio >= anioHoy ? Math.round((Date.parse(hoy) - Date.parse(`${r.anio - 1}-12-31`)) / DIA) : 365);
    const desde = new Date(Date.parse(fin) - diasPer * DIA).toISOString().slice(0, 10);
    const sp = r.rendimiento == null ? null : retornoSp(serie, desde, fin);
    return {
      anio: r.anio, portfolio: r.rendimiento, sp500: sp,
      diferencia: r.rendimiento != null && sp != null ? r.rendimiento - sp : null,
      dias: diasPer, parcial: r.anio >= anioHoy || diasPer < 360, concentrado: !!r.concentrado,
    };
  });
}
