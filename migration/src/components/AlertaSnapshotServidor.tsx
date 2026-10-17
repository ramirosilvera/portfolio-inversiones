import { AlertTriangle } from 'lucide-react';
import { estadoSnapshotServidor } from '../engine/snapshotServidor';
import type { Posicion } from '../types/domain';

const fmtFecha = (iso: string) => iso.split('-').reverse().join('/');

// Aviso si el servidor dejó de grabar el valor diario de la cartera (ver engine/snapshotServidor.ts). No muestra nada mientras los
// datos cargan ni cuando todo está bien, para no sumar ruido.
export function AlertaSnapshotServidor({ snaps, posiciones, hoy, listo }: {
  snaps: { fecha: string; fuente?: string | null }[]; posiciones: Posicion[]; hoy: string; listo: boolean;
}) {
  if (!listo) return null;
  const abiertas = posiciones.filter(p => Number(p.cantidad) > 0);
  const e = estadoSnapshotServidor(snaps, hoy, { hayPosiciones: abiertas.length > 0, tieneAccionAr: abiertas.some(p => p.tipo === 'accion_ar') });
  if (e.estado === 'ok' || e.estado === 'no_aplica') return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl bg-warn/10 ring-1 ring-inset ring-warn/25 px-3 py-2.5 text-[11px] text-ink-700">
      <AlertTriangle className="w-4 h-4 shrink-0 text-warn mt-0.5" />
      <p>
        {e.estado === 'sin_registro'
          ? <>El servidor todavía no grabó ningún valor diario de esta cartera.</>
          : <>El servidor no graba el valor diario desde el <b>{fmtFecha(e.ultimo)}</b> ({e.dias} días).</>}
        {' '}Sin ese registro el histórico de rendimiento, la comparación con el S&amp;P 500 y la máxima caída quedan con huecos que después no se pueden recuperar.
        Revisá el workflow «Refrescar datos de mercado» en GitHub Actions y los secrets <code>APP_URL</code> y <code>CRON_SECRET</code>.
      </p>
    </div>
  );
}
