import { useMemo } from 'react';
import { Card, CardHeader, Stat, fmtUsd, fmtPct, fmtPctSigno } from './ui';
import { useSp500 } from '../hooks/useSp500';
import { useOrdenesEjecutadas } from '../hooks/useOrdenesEjecutadas';
import { calcularDesempeno, type MaxDrawdown, type FlujoFechado } from '../engine/desempeno';
import type { Punto } from '../engine/rendimiento';

// "Desempeño desde el inicio": rentabilidad (acumulada y anualizada), comparación contra el S&P 500 con TUS mismos aportes y
// retiros, y máxima caída — todo en USD, con los datos que realmente hay. Cada cifra dice qué período cubre; lo que no se puede
// afirmar (anualizar menos de un año, una caída medida con huecos) se rotula o no se muestra. Cálculo en engine/desempeno.ts.

const fmtFecha = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

function DdTexto({ dd, minimo }: { dd: MaxDrawdown | null; minimo?: boolean }) {
  if (!dd) return <span className="text-ink-500">sin datos</span>;
  if (dd.mdd === 0) return <span className="tnum font-semibold text-pos">sin caídas</span>;
  return (
    <span>
      <span className="tnum font-semibold text-neg">{minimo && '≥ '}{fmtPct(Math.abs(dd.mdd), 1)}</span>
      <span className="text-ink-500"> · pico {fmtFecha(dd.fechaPico)} → mínimo {fmtFecha(dd.fechaMinimo)}{dd.fechaRecuperacion ? ` · recuperada ${fmtFecha(dd.fechaRecuperacion)}` : ' · sin recuperar'}</span>
    </span>
  );
}

export function DesempenoCard({ portfolioId, snaps, flujos, patrimonio, hoy, listo }: {
  portfolioId: string; snaps: Punto[]; flujos: FlujoFechado[]; patrimonio: number; hoy: string; listo: boolean;
}) {
  const { data: ordenes = [] } = useOrdenesEjecutadas(portfolioId);
  // Punto de hoy en vivo (si la valuación está completa) + el histórico grabado.
  const puntos = useMemo(() => [
    ...snaps.filter(s => s.fecha !== hoy).map(s => ({ fecha: s.fecha, valor: s.valor })),
    ...(listo && patrimonio > 0 ? [{ fecha: hoy, valor: patrimonio }] : []),
  ], [snaps, hoy, patrimonio, listo]);
  const primero = useMemo(() => [...puntos, ...flujos].map(x => x.fecha).sort()[0] ?? null, [puntos, flujos]);
  const { data: sp, isError: spError } = useSp500(primero ? new Date(Date.parse(primero) - 7 * 86_400_000).toISOString().slice(0, 10) : undefined);

  const d = useMemo(() => calcularDesempeno({
    puntos, flujos, valorActual: patrimonio, hoy, serieSp: sp?.puntos ?? null, ordenes,
  }), [puntos, flujos, patrimonio, hoy, sp, ordenes]);

  if (!listo || puntos.length < 2) {
    return (
      <Card>
        <CardHeader title="Desempeño desde el inicio" />
        <p className="p-4 text-sm text-ink-600">
          {!listo
            ? 'Esperando las cotizaciones de mercado para valuar la cartera de hoy…'
            : 'Necesita al menos dos valores diarios de la cartera. La app los registra sola todos los días.'}
        </p>
      </Card>
    );
  }

  const { calidad, twr, tir, costos, cartera, benchmark, periodo } = d;
  const hayAportes = flujos.length > 0;
  const primerFlujo = flujos.map(f => f.fecha).sort()[0] ?? null;

  return (
    <Card>
      <CardHeader title="Desempeño desde el inicio"
        sub={`${fmtFecha(periodo.desde)} → ${fmtFecha(periodo.hasta)} · ${periodo.dias} días · ${calidad.puntos} valores diarios · en USD`} />
      <div className="p-4 space-y-4 text-sm">
        {periodo.menorAUnAnio && (
          <p className="text-[11px] text-warn">
            Menos de un año de historia: se muestra el acumulado. El anualizado aparece al cumplir un año (anualizar semanas sería una estimación, no un dato).
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Acumulado" value={twr.acumulado != null ? fmtPctSigno(twr.acumulado, 1) : '—'} hint="ponderado por tiempo: no cuenta aportes ni retiros como ganancia" />
          <Stat label="Anualizado" value={twr.anualizado != null ? fmtPctSigno(twr.anualizado, 1) : '—'} hint={twr.anualizado == null ? 'desde un año de historia' : 'ponderado por tiempo'} />
          <Stat label="TIR anual" value={tir.anualizada != null ? fmtPctSigno(tir.anualizada, 1) : '—'} hint={!hayAportes ? 'cargá tus aportes' : tir.anualizada == null ? 'desde un año de historia' : 'ponderada por dinero (cuándo aportaste)'} />
          <Stat label="TIR neta de costos" value={tir.neta != null ? fmtPctSigno(tir.neta, 1) : '—'} hint="resta las comisiones en pesos con tipo de cambio registrado" />
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold mb-1">Contra el S&amp;P 500 (retorno total, USD)</p>
          {benchmark ? (
            <div className="space-y-1 text-xs">
              <p>Si cada aporte y retiro tuyo (desde el {fmtFecha(primerFlujo)}) se hubiera hecho en el S&amp;P 500 el mismo día, hoy tendrías{' '}
                <b className="tnum">{fmtUsd(benchmark.mismosFlujos.valorFinal, 0)}</b> (rendimiento del período <b className="tnum">{benchmark.mismosFlujos.rendimientoPeriodo != null ? fmtPctSigno(benchmark.mismosFlujos.rendimientoPeriodo, 1) : '—'}</b>
                {benchmark.mismosFlujos.tir != null && <> · TIR <b className="tnum">{fmtPctSigno(benchmark.mismosFlujos.tir, 1)}</b></>}).
                Tu cartera vale <b className="tnum">{fmtUsd(patrimonio, 0)}</b>:{' '}
                <b className={`tnum ${benchmark.diferenciaValor >= 0 ? 'text-pos' : 'text-neg'}`}>{benchmark.diferenciaValor >= 0 ? '+' : '−'}{fmtUsd(Math.abs(benchmark.diferenciaValor), 0)}</b> contra el índice.
                {benchmark.diferenciaTirPuntos != null && <> Diferencia de TIR: <b className="tnum">{(benchmark.diferenciaTirPuntos * 100).toFixed(1)} pp</b>.</>}
              </p>
              <p className="text-ink-500">Cierre a cierre, el índice hizo {benchmark.twrBenchmark != null ? fmtPctSigno(benchmark.twrBenchmark, 1) : '—'} entre {fmtFecha(periodo.desde)} y {fmtFecha(periodo.hasta)} (tu acumulado ponderado por tiempo: {twr.acumulado != null ? fmtPctSigno(twr.acumulado, 1) : '—'}).
                SPY ya descuenta su costo de fondo (~0,09 %); tu cartera no descuenta costos que no estén registrados.</p>
            </div>
          ) : (
            <p className="text-xs text-ink-500">{spError ? 'No se pudo traer el S&P 500. Reintentá más tarde.' : 'Sin comparación: falta serie del índice o aportes cargados que cubran las fechas.'}</p>
          )}
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold mb-1">Máxima caída</p>
          <div className="space-y-1 text-xs">
            <p><b>Cartera:</b> <DdTexto dd={cartera.mdd} minimo={cartera.rotuloMinimoConocido} /></p>
            {benchmark && <p><b>S&amp;P 500, mismas fechas:</b> <DdTexto dd={benchmark.mddEnMismasFechas} /></p>}
            {benchmark && <p><b>S&amp;P 500, diario:</b> <DdTexto dd={benchmark.mddDiario} /></p>}
            {!calidad.confiable && (
              <p className="text-warn">
                {calidad.puntos < 2 ? 'Faltan valores.' : <>La serie de tu cartera tiene {calidad.huecos.length} {calidad.huecos.length === 1 ? 'hueco' : 'huecos'} de más de una semana
                (el mayor, de {calidad.maxHueco} días): la caída real pudo ser mayor a la medida (por eso "≥"). Desde ahora el servidor registra el valor todos los días.</>}
              </p>
            )}
            {twr.anomalias > 0 && <p className="text-warn">{twr.anomalias} {twr.anomalias === 1 ? 'tramo' : 'tramos'} con un aporte/retiro que no cuadra con el valor registrado ese día se omitieron del cálculo (revisá las fechas de tus aportes).</p>}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold mb-1">Costos registrados</p>
          {costos.ordenes === 0 ? (
            <p className="text-xs text-ink-500">Sin órdenes con comisiones registradas: el rendimiento no descuenta costos de operación.</p>
          ) : (
            <p className="text-xs text-ink-700">
              {costos.ordenes} órdenes · comisiones <b className="tnum">{fmtUsd(costos.totalUsdConocido, 2)}</b>
              {costos.pctSobreOperado != null && <> ({fmtPct(costos.pctSobreOperado, 2)} de lo operado)</>}
              {costos.comisionArsSinConvertirPesos > 0 && <span className="text-warn"> · además $ {costos.comisionArsSinConvertirPesos.toLocaleString('es-AR', { maximumFractionDigits: 0 })} en pesos sin tipo de cambio registrado (no descontados)</span>}.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
