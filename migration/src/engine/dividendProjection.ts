// =============================================================================
// Calendario proyectado de dividendos de CEDEARs/acciones/ETFs — mismo formato que
// engine/coupons.ts (couponCalendar) para que la UI de "Proyectado" pueda mostrar bonos y
// cedears con el mismo componente. A diferencia de los cupones (100% sintéticos, calculados de
// tasa/frecuencia cargadas a mano), esto parte de un dato REAL del proveedor (o una estimación
// por cadencia histórica si el próximo pago no está declarado todavía) — ver _dividendos.ts en
// functions/, que ya hace ese cálculo para "hoy". Acá se PROYECTA hacia adelante repitiendo la
// cadencia (frecuenciaAnual), algo que _dividendos.ts no hace porque solo mira el próximo evento.
// =============================================================================

export interface DividendoInfo {
  proximaFecha: string | null;
  montoPorAccion: number | null;
  estado: 'declarado' | 'estimado' | 'sin-dato';
  frecuenciaAnual: number | null;
}

export interface DividendPosicion {
  ticker: string;
  tipo: 'cedear' | 'accion' | 'accion_ar' | 'etf' | 'bono' | 'cash';
  cantidad: number;
  ratioCedear: number | null;
}

export interface DividendEvent {
  ym: string;
  year: number;
  month: number;
  ticker: string;
  monto: number;
  estado: 'declarado' | 'estimado';  // el 1er pago hereda el estado del proveedor; los siguientes
                                      // (repetición de cadencia) SIEMPRE son 'estimado' — son una
                                      // extrapolación nuestra, no algo que el proveedor declaró.
}

export interface DividendMonthBucket {
  ym: string;
  year: number;
  month: number;
  total: number;
  detalle: { ticker: string; monto: number; estado: 'declarado' | 'estimado' }[];
}

// Genera los eventos de dividendo de los próximos `meses` a partir de (fromYear, fromMonth)
// inclusive, repitiendo la cadencia conocida (frecuenciaAnual) hacia adelante.
export function dividendEvents(
  posiciones: DividendPosicion[],
  infoPorTicker: Record<string, DividendoInfo | null | undefined>,
  fromYear: number, fromMonth: number, meses = 12,
): DividendEvent[] {
  const startAbs = fromYear * 12 + (fromMonth - 1);
  const endAbs = startAbs + meses;
  const events: DividendEvent[] = [];

  for (const p of posiciones) {
    // Mismo criterio de exclusión que sugerirDividendoPendiente (cron): bono/cash no son
    // dividendo, y accion_ar no tiene relación de conversión conocida con el ADR/CEDEAR que
    // pueda compartir el mismo ticker en otro portfolio.
    if (p.tipo === 'bono' || p.tipo === 'cash' || p.tipo === 'accion_ar' || !(p.cantidad > 0)) continue;
    const info = infoPorTicker[p.ticker.toUpperCase()];
    if (!info || info.estado === 'sin-dato' || !info.proximaFecha || info.montoPorAccion == null) continue;

    let divisor = 1;
    if (p.tipo === 'cedear') {
      if (!(p.ratioCedear! > 0)) continue; // sin ratio confiable, mejor no proyectar nada
      divisor = p.ratioCedear!;
    }
    const monto = +((info.montoPorAccion * p.cantidad) / divisor).toFixed(2);
    if (!(monto > 0)) continue;

    const pasoDias = info.frecuenciaAnual && info.frecuenciaAnual > 0 ? Math.round(365 / info.frecuenciaAnual) : null;
    let fecha = new Date(info.proximaFecha + 'T00:00:00Z');
    // Tope defensivo alto A PROPÓSITO: 400 iteraciones cubre incluso un pagador DIARIO por más de
    // un año — un tope bajo (ej. 40) corta en silencio a un pagador semanal (frecuenciaAnual=52,
    // paso=7 días) antes de completar la ventana de 12 meses, subestimando el total proyectado sin
    // ningún aviso. El `abs >= endAbs` de abajo ya corta por FECHA en el caso normal; esto solo
    // protege contra una frecuenciaAnual corrupta que igual generaría pasoDias > 0.
    for (let i = 0; i < 400; i++) {
      const abs = fecha.getUTCFullYear() * 12 + fecha.getUTCMonth();
      if (abs >= endAbs) break;
      if (abs >= startAbs) {
        events.push({
          ym: `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}`,
          year: fecha.getUTCFullYear(), month: fecha.getUTCMonth() + 1,
          ticker: p.ticker, monto,
          estado: i === 0 && info.estado === 'declarado' ? 'declarado' : 'estimado',
        });
      }
      // `pasoDias == null || <= 0`, explícito: pasoDias podría ser 0 (frecuenciaAnual > 730, un
      // dato corrupto) — un `if (!pasoDias) break` también lo atraparía hoy porque 0 es falsy,
      // pero deja la protección atada a esa coincidencia. Un refactor futuro que cambiara la
      // condición de "sin cadencia" a `pasoDias === null` reintroduciría en silencio un loop de
      // 400 eventos en la MISMA fecha (total 400x inflado). Explícito acá para que no dependa de eso.
      if (pasoDias == null || pasoDias <= 0) break; // sin cadencia conocida: un solo evento, no se repite
      fecha = new Date(fecha.getTime() + pasoDias * 86400000);
    }
  }
  return events;
}

// Agrupa los eventos por mes (calendario continuo de `meses` a partir del inicio) — mismo shape
// que couponCalendar para reusar el mismo chart/tabla en la UI.
export function dividendCalendar(
  posiciones: DividendPosicion[],
  infoPorTicker: Record<string, DividendoInfo | null | undefined>,
  fromYear: number, fromMonth: number, meses = 12,
): DividendMonthBucket[] {
  const events = dividendEvents(posiciones, infoPorTicker, fromYear, fromMonth, meses);
  const buckets: DividendMonthBucket[] = [];
  for (let i = 0; i < meses; i++) {
    const abs = (fromYear * 12 + (fromMonth - 1)) + i;
    const year = Math.floor(abs / 12);
    const month = (abs % 12) + 1;
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const detalle = events.filter(e => e.ym === ym).map(e => ({ ticker: e.ticker, monto: e.monto, estado: e.estado }));
    buckets.push({ ym, year, month, total: +detalle.reduce((s, d) => s + d.monto, 0).toFixed(2), detalle });
  }
  return buckets;
}

// Dividendo anual ESTIMADO (suma de 12 meses de calendario) — mismo criterio que el "Cupón anual"
// de CuponesPage (suma del couponCalendar), para el Stat "Dividendos anual (estimado)".
export function dividendoAnualEstimado(
  posiciones: DividendPosicion[], infoPorTicker: Record<string, DividendoInfo | null | undefined>,
  fromYear: number, fromMonth: number,
): number {
  return +dividendCalendar(posiciones, infoPorTicker, fromYear, fromMonth, 12)
    .reduce((s, m) => s + m.total, 0).toFixed(2);
}
