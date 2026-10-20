import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, fmtArs, fmtArsCompact, fmtPct } from './ui';
import { mesAnio, textoLlegadaMinimo } from './LlegadaMinimoCard';
import type { LlegadaMinimo, NivelBP } from '../engine/impuestos';

// Tarjeta del Inicio: tres datos en UNA fila (también en el celular) y cada uno con su aclaración corta debajo, para que ocupe lo mínimo.
// Solo presenta: los números salen de useImpuestos / engine/impuestos.ts (ver ImpuestosResumen en DashboardPage).
export function ImpuestosResumenVista({ ratio, nivel, totalUsd, minimoUsd, llegada, impuesto, alicuotaMarginal, personalizando }: {
  ratio: number; nivel: NivelBP; totalUsd: number; minimoUsd: number; llegada: LlegadaMinimo | null;
  impuesto: number | null; alicuotaMarginal: number | null; personalizando: boolean;
}) {
  const right = <span className="text-[11px] text-celeste-600">Ver detalle →</span>;
  const tono = nivel === 'neg' ? 'text-neg' : nivel === 'warn' ? 'text-warn' : 'text-pos';
  const llegaEn = llegada?.meses != null && !llegada.yaSupera ? `≈ ${llegada.anios!.toLocaleString('es-AR')} años` : llegada?.yaSupera ? 'hoy' : 'según tu Forecast';
  return (
    <Card>
      <CardHeader title="Impuestos" sub="Bienes Personales · MEP de hoy"
        right={personalizando ? right : <Link to="/impuestos" className="hover:underline">{right}</Link>} />
      <div className="p-3 grid grid-cols-3 gap-2">
        <Tile label="Del mínimo" valor={<span className={tono}>{fmtPct(ratio, 0)}</span>} nota={`${Math.round(totalUsd / 1000)}k de ${Math.round(minimoUsd / 1000)}k`}
          titulo={`US$ ${Math.round(totalUsd).toLocaleString('es-AR')} de US$ ${Math.round(minimoUsd).toLocaleString('es-AR')} (mínimo no imponible al MEP de hoy)`} />
        <Tile label="Llegás" valor={textoLlegadaMinimo(llegada)} nota={llegaEn}
          titulo={llegada?.meses != null && !llegada.yaSupera ? `${mesAnio(llegada.fecha)}, según tu Forecast con el mínimo en dólares de hoy` : 'según tu Forecast, con el mínimo en dólares de hoy'} />
        <Tile label="Pagarías" valor={impuesto != null ? fmtArsCompact(impuesto) : '—'} nota={impuesto != null && impuesto > 0 ? `${fmtPct(alicuotaMarginal ?? 0, 2)} marginal` : 'sin pago'}
          titulo={impuesto != null && impuesto > 0 ? `${fmtArs(impuesto)} por año: Bienes Personales estimado con la escala vigente` : 'No superás el mínimo: no corresponde pagar'} />
      </div>
    </Card>
  );
}

function Tile({ label, valor, nota, titulo }: { label: string; valor: ReactNode; nota: string; titulo: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-2.5 py-2 min-w-0" title={titulo}>
      <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold truncate">{label}</p>
      <p className="text-base sm:text-lg font-bold text-ink-900 tnum font-display truncate leading-tight mt-0.5">{valor}</p>
      <p className="text-[10px] text-ink-600 truncate">{nota}</p>
    </div>
  );
}
