import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { useDesempeno } from '../hooks/useDesempeno';
import { useChartTheme } from '../hooks/usePrefs';
import { Card, CardHeader, Stat, fmtUsd, fmtUsdCompact, fmtPct, fmtPctSigno } from '../components/ui';
import { AlertaSnapshotServidor } from '../components/AlertaSnapshotServidor';
import { VsSp500 } from '../components/VsSp500';
import { MIN_DIAS_ANUALIZAR } from '../engine/desempeno';

// Desempeño — el ÚNICO lugar donde se ve cuánto rindió la cartera. Pensado como un tablero clásico: 4 números arriba (patrimonio, ganancia, contra
// el S&P 500, máxima caída), un gráfico (cartera vs capital aportado vs lo mismo invertido en el S&P 500), el detalle por año y, plegado, el resto
// de los indicadores. UN solo % de cabecera: la ganancia sobre el capital aportado (coincide con tu P&L en dólares). El cálculo vive en
// engine/desempeno.ts; acá solo se presenta.

const fmtFecha = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const fmtCorta = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');
const tono = (n: number | null | undefined) => (n == null ? 'text-ink-900' : n >= 0 ? 'text-pos' : 'text-neg');
const signo = (n: number) => (n >= 0 ? '+' : '−');

function Kpi({ titulo, valor, sub, tonoValor }: { titulo: string; valor: React.ReactNode; sub?: React.ReactNode; tonoValor?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-soft px-4 py-3 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold">{titulo}</p>
      <p className={`text-2xl font-bold tnum mt-1 font-display leading-tight break-words ${tonoValor ?? 'text-ink-900'}`}>{valor}</p>
      {sub && <p className="text-[11px] text-ink-600 mt-1 leading-snug">{sub}</p>}
    </div>
  );
}

export function DesempenoPage() {
  const { active } = usePortfolios();
  const chart = useChartTheme();
  const { d, listo, spError, patrimonio, hoy, snaps, posiciones, qSnaps, qPos, sinAcreditar, hayPuntos, porAnio } = useDesempeno(active?.id);
  if (!active) return null;

  const { calidad, twr, tir, costos, cartera, benchmark, periodo, evolucion } = d;
  const capitalNeto = tir.invertido - tir.retirado;
  const sePuedeAnualizar = periodo.dias >= MIN_DIAS_ANUALIZAR;
  const hayIndice = evolucion.some(e => e.sp != null);
  const datos = evolucion.map(e => ({ fecha: e.fecha, Cartera: e.valor, 'Capital aportado': e.capital, 'S&P 500 (mismos aportes)': e.sp }));
  const mdd = cartera.mdd;
  const mddSp = benchmark?.mddEnMismasFechas;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-ink-900 font-display">Desempeño · {active.nombre}</h1>
        <p className="text-xs text-ink-600 mt-0.5">
          {hayPuntos && listo ? <>En USD · desde el <b>{fmtFecha(periodo.desde)}</b> ({periodo.dias} días de historia diaria).</> : 'En USD.'}
        </p>
      </div>

      <AlertaSnapshotServidor snaps={snaps} posiciones={posiciones} hoy={hoy} listo={qSnaps.isSuccess && qPos.isSuccess} />

      {!listo || !hayPuntos ? (
        <Card><p className="p-4 text-sm text-ink-600">
          {!listo ? 'Esperando las cotizaciones de mercado para valuar la cartera de hoy…' : 'Necesita al menos dos valores diarios de la cartera. El servidor los registra solo todos los días.'}
        </p></Card>
      ) : (
        <>
          {/* ── 4 números ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Kpi titulo="Patrimonio" valor={fmtUsd(patrimonio, 0)} sub={<>Aportado neto: {fmtUsd(capitalNeto, 0)}</>} />
            <Kpi titulo="Ganancia" tonoValor={tono(tir.gananciaUsd)}
              valor={<>{signo(tir.gananciaUsd)}{fmtUsd(Math.abs(tir.gananciaUsd), 0)}</>}
              sub={<>{tir.acumulada != null ? <><b className={tono(tir.acumulada)}>{fmtPctSigno(tir.acumulada, 1)}</b> sobre lo aportado</> : null}
                {sePuedeAnualizar && twr.anualizado != null && !twr.concentrado && <> · {fmtPctSigno(twr.anualizado, 1)} por año</>}</>} />
            <Kpi titulo="Contra el S&P 500" tonoValor={benchmark ? tono(benchmark.diferenciaValor) : undefined}
              valor={benchmark ? <>{signo(benchmark.diferenciaValor)}{fmtUsd(Math.abs(benchmark.diferenciaValor), 0)}</> : '—'}
              sub={benchmark
                ? <>Tu cartera {tir.acumulada != null ? fmtPctSigno(tir.acumulada, 1) : '—'} vs S&amp;P {benchmark.mismosFlujos.rendimientoPeriodo != null ? fmtPctSigno(benchmark.mismosFlujos.rendimientoPeriodo, 1) : '—'} con tus mismos aportes</>
                : (spError ? 'No se pudo traer el índice.' : 'Sin serie del índice todavía.')} />
            <Kpi titulo="Máxima caída" tonoValor={mdd && mdd.mdd < 0 ? 'text-neg' : 'text-pos'}
              valor={mdd ? (mdd.mdd === 0 ? 'Sin caídas' : <>{cartera.rotuloMinimoConocido && '≥ '}{fmtPct(Math.abs(mdd.mdd), 1)}</>) : '—'}
              sub={mdd && mdd.mdd < 0
                ? <>{fmtCorta(mdd.fechaPico!)} → {fmtCorta(mdd.fechaMinimo!)}{mdd.fechaRecuperacion ? ' · recuperada' : ' · sin recuperar'}{mddSp ? <> · S&amp;P en esas fechas {mddSp.mdd === 0 ? 'sin caídas' : fmtPct(Math.abs(mddSp.mdd), 1)}</> : null}</>
                : undefined} />
          </div>

          {twr.concentrado && (
            <p className="text-[11px] text-warn">La mayor parte del capital entró hace pocos días: el rendimiento ponderado por tiempo no es representativo; por eso todo se mide sobre el capital aportado.</p>
          )}

          {/* ── Gráfico ── */}
          <Card>
            <CardHeader title="Evolución" sub={hayIndice ? 'Tu cartera, el capital que pusiste y lo que tendrías si hubieras puesto esos mismos aportes en el S&P 500.' : 'Tu cartera y el capital que pusiste.'} />
            <div className="p-3">
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={datos} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="fecha" stroke={chart.axis} fontSize={11} tickFormatter={fmtCorta} minTickGap={32} />
                    <YAxis stroke={chart.axis} fontSize={11} width={56} tickFormatter={v => fmtUsdCompact(Number(v))} domain={['auto', 'auto']} />
                    <Tooltip formatter={(v: number | string) => fmtUsd(Number(v), 0)} labelFormatter={l => fmtFecha(String(l))}
                      contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, color: chart.tooltipText, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="Capital aportado" stroke={chart.axis} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
                    {hayIndice && <Line type="monotone" dataKey="S&P 500 (mismos aportes)" stroke={chart.warn} strokeWidth={1.75} dot={false} connectNulls />}
                    <Line type="monotone" dataKey="Cartera" stroke="#4F97D4" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {!calidad.confiable && calidad.huecos.length > 0 && (
                <p className="text-[11px] text-warn px-1">Hay {calidad.huecos.length} {calidad.huecos.length === 1 ? 'hueco' : 'huecos'} de más de una semana sin valor diario (el mayor, de {calidad.maxHueco} días): la caída real pudo ser mayor a la medida{cartera.rotuloMinimoConocido ? ' (por eso "≥")' : ''}. Desde que el servidor registra todos los días no se producen huecos nuevos.</p>
              )}
            </div>
          </Card>

          {/* ── Por año ── */}
          <VsSp500 rendAnios={porAnio} hoy={hoy} />

          {/* ── Más indicadores ── */}
          <details className="rounded-2xl border border-line bg-surface shadow-soft group">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-ink-800">
              Más indicadores <span className="text-[11px] font-normal text-ink-500">· para comparar con fondos u otras carteras</span>
            </summary>
            <div className="px-4 pb-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Stat label="Ponderado por tiempo" value={twr.acumulado != null ? fmtPctSigno(twr.acumulado, 1) : '—'} hint={twr.concentrado ? 'no representativo: el capital entró hace poco' : 'no cuenta aportes ni retiros como ganancia'} />
                <Stat label="Anualizado" value={twr.anualizado != null ? fmtPctSigno(twr.anualizado, 1) : '—'} hint={twr.anualizado == null ? 'desde un año de historia' : 'ponderado por tiempo'} />
                <Stat label="TIR anual" value={tir.anualizada != null ? fmtPctSigno(tir.anualizada, 1) : '—'} hint={tir.anualizada == null ? 'desde un año de historia' : 'ponderada por dinero: cuándo aportaste'} />
                <Stat label="TIR neta de costos" value={tir.neta != null ? fmtPctSigno(tir.neta, 1) : '—'} hint="descuenta las comisiones en pesos con tipo de cambio registrado" />
                <Stat label="S&P 500 ponderado" value={benchmark?.twrBenchmark != null ? fmtPctSigno(benchmark.twrBenchmark, 1) : '—'} hint="cierre a cierre, mismo período" />
                <Stat label="TIR del índice" value={benchmark?.mismosFlujos.tir != null ? fmtPctSigno(benchmark.mismosFlujos.tir, 1) : '—'} hint={benchmark?.mismosFlujos.tir == null ? 'desde un año de historia' : 'con tus mismos aportes'} />
              </div>
              <ul className="text-[11px] text-ink-600 space-y-1 leading-relaxed list-disc pl-4">
                <li>La <b>ganancia sobre lo aportado</b> (cabecera) es ganancia ÷ capital puesto: es lo más simple y coincide con tu P&amp;L. Los porcentajes de esta lista miden otra cosa (el cómo, no el cuánto) y por eso pueden diferir.</li>
                <li>Se anualiza sólo con un año o más de historia: antes sería una estimación, no un dato.</li>
                <li><b>Costos:</b> {costos.ordenes === 0 ? 'no hay órdenes con comisiones registradas.' : <>{costos.ordenes} órdenes · {fmtUsd(costos.totalUsdConocido, 2)} de comisiones{costos.estimadasUsd > 0 && <span className="text-warn"> (≈ {fmtUsd(costos.estimadasUsd, 2)} estimadas)</span>}{costos.comisionArsSinConvertirPesos > 0 && <span className="text-warn"> · y $ {Math.round(costos.comisionArsSinConvertirPesos).toLocaleString('es-AR')} sin tipo de cambio</span>}.</>} <Link to="/ordenes" className="text-celeste-600 underline">Ver órdenes y controles</Link>.</li>
                <li>Dividendos y cupones suman al rendimiento cuando están acreditados en Liquidez.{sinAcreditar > 0.5 && <span className="text-warn"> Hay {fmtUsd(sinAcreditar, 2)} confirmados sin acreditar: sólo cuentan si ese efectivo ya está en tu saldo.</span>}</li>
                {twr.anomalias > 0 && <li className="text-warn">{twr.anomalias} {twr.anomalias === 1 ? 'tramo' : 'tramos'} con un aporte/retiro que no cuadra con el valor de ese día no se pudieron medir.</li>}
              </ul>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
