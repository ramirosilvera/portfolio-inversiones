// ¿El servidor (cron) está grabando el valor diario de la cartera? El histórico de rendimiento, benchmark y máxima caída depende de
// que se grabe todos los días aunque nadie abra la app; si el cron deja de hacerlo, los huecos se acumulan sin que se note hasta que
// ya no se pueden recuperar. Puro y testeado: la pantalla solo decide si mostrar el aviso con lo que devuelve esto.

export interface SnapshotMin { fecha: string; fuente?: string | null }

export type EstadoSnapshotServidor =
  | { estado: 'ok'; ultimo: string }
  | { estado: 'atrasado'; ultimo: string; dias: number }       // el último snapshot del cron es viejo
  | { estado: 'sin_registro' }                                  // el cron nunca grabó uno para esta cartera
  | { estado: 'no_aplica' };                                    // no se espera snapshot del servidor (ver `motivo`)

// El cron graba a diario, fines de semana incluidos: más de 2 días sin una fila suya es una falla, no un feriado.
export const MAX_DIAS_SIN_SNAPSHOT_SERVIDOR = 2;

const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function estadoSnapshotServidor(
  snaps: SnapshotMin[], hoy: string, opts: { hayPosiciones: boolean; tieneAccionAr: boolean },
): EstadoSnapshotServidor {
  // El servidor no valúa acciones locales (requieren MEP y precio en pesos) ni una cartera vacía: ahí NO se espera snapshot suyo.
  if (!opts.hayPosiciones || opts.tieneAccionAr) return { estado: 'no_aplica' };
  const ultimo = snaps.filter(s => s.fuente === 'cron').map(s => s.fecha).sort().pop();
  if (!ultimo) return { estado: 'sin_registro' };
  const d = dias(ultimo, hoy);
  return d > MAX_DIAS_SIN_SNAPSHOT_SERVIDOR ? { estado: 'atrasado', ultimo, dias: d } : { estado: 'ok', ultimo };
}

// Fila que graba la APP. NO incluye `fuente` ni `completo` a propósito: en un upsert las columnas ausentes no se tocan si la fila ya existe, así que
// si el cron ya grabó el día (fuente='cron') el navegador solo actualiza valor/aportado/detalle y NO le cambia el origen — antes lo pisaba con
// 'app', y la alerta de «el servidor no graba» (estadoSnapshotServidor arriba, que cuenta solo filas del cron) saltaba aunque el cron estuviera
// funcionando. Si la fila no existe, entra con los defaults de la tabla (fuente 'app', completo true).
export function filaSnapshotApp(portfolioId: string, fecha: string, valor: number, aportado: number, detalle?: { t: string; c: number; v: number }[]) {
  return { portfolio_id: portfolioId, fecha, valor, aportado, detalle: detalle ?? null };
}

