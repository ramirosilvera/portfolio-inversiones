// Valor diario de cada cartera calculado en el SERVIDOR (cron), para que el histórico no dependa de que se abra la app. Puro y
// testeado. Misma regla de valuación que src/lib/valuation.ts (unitValueUSD): un CEDEAR vale (precio del subyacente ÷ ratio),
// un bono/ETF/acción vale su precio por unidad, el efectivo (LIQUIDEZ) vale su cantidad. Una posición abierta SIN precio fresco
// hace el snapshot INCOMPLETO y no se graba: un valor armado a medias (cayendo a costo) ensucia el histórico de rendimiento y de
// máxima caída para siempre, y un hueco se ve y se declara; un número equivocado no.

export interface PosicionValuable {
  portfolio_id: string;
  ticker: string;
  tipo: string;
  cantidad: number;
  precio_compra: number | null;
  ratio_cedear: number | null;
}

export interface PrecioCache { ticker: string; precio: number; updated_at: string }

export interface ValuacionPortfolio {
  portfolio_id: string;
  valor: number;
  completo: boolean;
  faltan: string[];                                  // tickers abiertos sin precio fresco (motivo de que no sea completo)
  detalle: { t: string; c: number; v: number }[];   // composición de ese día (ticker, cantidad, valor USD)
  costo: number;                                      // Σ cantidad × precio de compra (fallback de `aportado` si no hay aportes)
}

// Frescura máxima de un precio para considerarlo "de hoy": los fines de semana el mercado no actualiza, y un feriado largo
// puede dejar el último cierre a ~4 días; 5 días corta lo que de verdad es un precio abandonado.
export const MAX_EDAD_PRECIO_MS = 5 * 24 * 60 * 60 * 1000;

export function valuarPortfolio(
  portfolioId: string, posiciones: PosicionValuable[], precios: Map<string, PrecioCache>, ahora: number,
): ValuacionPortfolio {
  let valor = 0, costo = 0;
  const faltan: string[] = [];
  const detalle: { t: string; c: number; v: number }[] = [];

  for (const p of posiciones) {
    const cant = Number(p.cantidad) || 0;
    if (!(cant > 0)) continue;
    costo += (Number(p.precio_compra) || 0) * cant;
    let v: number | null = null;

    if (p.tipo === 'cash') {
      v = (Number(p.precio_compra) || 0) * cant;            // convención: cantidad = USD, precio 1
    } else if (p.tipo === 'accion_ar') {
      v = null;                                             // requiere MEP + precio en pesos: no se valúa en el servidor
    } else {
      const px = precios.get(p.ticker.toUpperCase());
      const fresco = px && Number.isFinite(px.precio) && px.precio > 0 && ahora - Date.parse(px.updated_at) <= MAX_EDAD_PRECIO_MS;
      if (fresco) {
        if (p.tipo === 'cedear') v = p.ratio_cedear && p.ratio_cedear > 0 ? (px.precio / p.ratio_cedear) * cant : null;
        else v = px.precio * cant;
      }
    }

    if (v == null) { faltan.push(p.ticker); continue; }
    valor += v;
    detalle.push({ t: p.ticker, c: cant, v: +v.toFixed(2) });
  }

  return { portfolio_id: portfolioId, valor: +valor.toFixed(2), completo: faltan.length === 0 && detalle.length > 0, faltan, detalle, costo: +costo.toFixed(2) };
}

export interface AporteMin { portfolio_id: string; fecha: string; monto: number; tipo: string }

// Aportado neto acumulado a `hasta` — misma convención que el cliente (retiro resta). Si el portfolio NO tiene ningún aporte, el
// cliente usa el costo de las posiciones (useRendimientoAnual): se replica para que ambos caminos graben lo mismo.
export function aportadoNeto(aportes: AporteMin[], hasta: string, costoFallback: number): number {
  if (!aportes.length) return +costoFallback.toFixed(2);
  let t = 0;
  for (const a of aportes) {
    if (a.fecha > hasta) continue;
    t += a.tipo === 'retiro' ? -Number(a.monto) : Number(a.monto);
  }
  return +t.toFixed(2);
}

export interface FilaSnapshot {
  portfolio_id: string; fecha: string; valor: number; aportado: number; fuente: 'cron'; completo: true;
  detalle: { t: string; c: number; v: number }[];
}

// Arma las filas a grabar (solo carteras completas). `omitidas` lista las carteras salteadas y por qué, para loguear sin filtrar montos.
export function armarSnapshots(
  hoy: string, posiciones: PosicionValuable[], precios: Map<string, PrecioCache>, aportes: AporteMin[], ahora: number,
): { filas: FilaSnapshot[]; omitidas: { portfolio_id: string; faltan: string[] }[] } {
  const porPf = new Map<string, PosicionValuable[]>();
  for (const p of posiciones) (porPf.get(p.portfolio_id) ?? porPf.set(p.portfolio_id, []).get(p.portfolio_id)!).push(p);
  const filas: FilaSnapshot[] = [];
  const omitidas: { portfolio_id: string; faltan: string[] }[] = [];

  for (const [pf, pos] of porPf) {
    const v = valuarPortfolio(pf, pos, precios, ahora);
    if (!v.completo || !(v.valor > 0)) { omitidas.push({ portfolio_id: pf, faltan: v.faltan }); continue; }
    const aportesPf = aportes.filter(a => a.portfolio_id === pf);
    filas.push({
      portfolio_id: pf, fecha: hoy, valor: v.valor, aportado: aportadoNeto(aportesPf, hoy, v.costo),
      fuente: 'cron', completo: true, detalle: v.detalle,
    });
  }
  return { filas, omitidas };
}
