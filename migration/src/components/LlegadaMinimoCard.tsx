import { Target } from 'lucide-react';
import { Card, CardHeader, Badge, fmtUsd, fmtPct, fmtArsCompact } from './ui';
import type { EscenarioLlegada, FuenteProyeccion, LlegadaMinimo } from '../engine/impuestos';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const mesAnio = (ym: string | null) => (ym ? `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '—');

export function textoLlegadaMinimo(l: LlegadaMinimo | null): string {
  if (!l) return '—';
  if (l.yaSupera) return 'Ya lo superás';
  if (l.meses == null) return 'No llega en 80 años';
  return `${l.anio}`;
}

// Cuándo el patrimonio de todos los portfolios (+ otros bienes) llega al mínimo no imponible de Bienes Personales, según los supuestos del
// Forecast y con el mínimo convertido al dólar de HOY. El cálculo está en engine/impuestos.ts (proyectarLlegadaMinimo): acá solo se presenta.
export function LlegadaMinimoCard({ llegada, escenarios, fuentes, sinPresupuesto, minimoArs, minimoUsd, mep, patrimonioUsd }: {
  llegada: LlegadaMinimo | null; escenarios: EscenarioLlegada[];
  fuentes: (FuenteProyeccion & { nombre: string })[]; sinPresupuesto: string[];
  minimoArs: number; minimoUsd: number; mep: number; patrimonioUsd: number;
}) {
  return (
    <Card>
      <CardHeader title="¿Cuándo llegás al mínimo no imponible?" sub="Según tu Forecast, con el mínimo pasado a dólares al MEP de hoy."
        right={<Badge tone="accent">proyección</Badge>} />
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <Target className="w-6 h-6 text-accent shrink-0 mt-0.5" />
          <div className="min-w-0">
            {llegada?.yaSupera ? (
              <p className="text-lg font-bold text-ink-900 font-display">Ya superás el mínimo</p>
            ) : llegada?.meses != null ? (
              <>
                <p className="text-lg font-bold text-ink-900 font-display">Hacia {mesAnio(llegada.fecha)}</p>
                <p className="text-sm text-ink-600">en ≈ {llegada.anios!.toLocaleString('es-AR')} años desde hoy</p>
              </>
            ) : (
              <p className="text-lg font-bold text-ink-900 font-display">No llegás en 80 años con estos supuestos</p>
            )}
            <p className="text-[11px] text-ink-600 mt-1">
              Mínimo {fmtArsCompact(minimoArs)} ÷ MEP {Math.round(mep).toLocaleString('es-AR')} = <b className="text-ink-800">{fmtUsd(minimoUsd, 0)}</b> · hoy tenés {fmtUsd(patrimonioUsd, 0)} ({fmtPct(minimoUsd > 0 ? patrimonioUsd / minimoUsd : 0, 0)}).
            </p>
          </div>
        </div>

        {escenarios.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[360px]">
              <thead className="text-[11px] text-ink-600 border-b border-line">
                <tr><th className="text-left py-2">Si el mínimo en dólares fuera…</th><th className="text-right px-3">Mínimo</th><th className="text-right">Llegás</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {escenarios.map(e => (
                  <tr key={e.factor} className={e.factor === 1 ? 'font-semibold' : ''}>
                    <td className="py-2 text-ink-800">{e.factor === 1 ? 'El de hoy (base)' : e.factor < 1 ? `${Math.round((1 - e.factor) * 100)} % más bajo` : `${Math.round((e.factor - 1) * 100)} % más alto`}</td>
                    <td className="text-right px-3 tnum">{fmtUsd(e.umbralUsd, 0)}</td>
                    <td className="text-right tnum">{e.llegada.yaSupera ? 'ya' : e.llegada.meses == null ? '> 80 años' : `${e.llegada.anio} (${e.llegada.anios!.toLocaleString('es-AR')} años)`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ul className="text-[11px] text-ink-600 space-y-1 list-disc pl-4">
          <li>
            Supuestos del Forecast por portfolio:{' '}
            {fuentes.map((f, i) => (
              <span key={f.nombre}>{i > 0 && ' · '}<b className="text-ink-800">{f.nombre}</b> {fmtUsd(f.valorUsd, 0)} + {fmtUsd(f.aporteAnual, 0)}/año al {fmtPct(f.tasaAnual, 0)}</span>
            ))}.
          </li>
          {sinPresupuesto.length > 0 && <li className="text-warn">Sin presupuesto fijado en Forecast: {sinPresupuesto.join(', ')} (se usa el supuesto guardado o 8 % sin aportes).</li>}
          <li>El mínimo se actualiza por IPC cada año; acá se lo deja <b className="text-ink-800">constante en dólares</b>, o sea que supone que el dólar acompaña la inflación. Si el peso se aprecia en términos reales el mínimo en dólares sube y llegás más tarde (columna «más alto»); si se deprecia más que la inflación, antes.</li>
          <li>Retorno en dólares sin inflación en dólares, igual que el Forecast; los otros bienes se mantienen fijos en dólares. Es una proyección, no una promesa.</li>
        </ul>
      </div>
    </Card>
  );
}
