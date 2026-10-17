import { Link } from 'react-router-dom';
import { usePortfolios } from '../hooks/usePortfolios';
import { useDesempeno } from '../hooks/useDesempeno';
import { Card, CardHeader, Stat, Badge, fmtUsd, fmtPct, fmtPctSigno } from '../components/ui';
import { AlertaSnapshotServidor } from '../components/AlertaSnapshotServidor';
import { MIN_DIAS_ANUALIZAR, type MaxDrawdown } from '../engine/desempeno';

// Desempeño: responde tres preguntas con datos reales, siempre diciendo qué período cubren. Lo que no se puede afirmar todavía (un
// anualizado con menos de un año, una caída medida con huecos) se rotula o no se muestra. Todo el cálculo está en engine/desempeno.ts.

const fmtFecha = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const sumarDias = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);

function Caida({ dd, minimo }: { dd: MaxDrawdown | null; minimo?: boolean }) {
  if (!dd) return <span className="text-ink-500">sin datos</span>;
  if (dd.mdd === 0) return <span className="tnum font-semibold text-pos">sin caídas</span>;
  return (
    <span>
      <span className="tnum font-semibold text-neg">{minimo && '≥ '}{fmtPct(Math.abs(dd.mdd), 1)}</span>
      <span className="text-ink-500"> · pico {fmtFecha(dd.fechaPico)} → mínimo {fmtFecha(dd.fechaMinimo)}{dd.fechaRecuperacion ? ` · recuperada ${fmtFecha(dd.fechaRecuperacion)}` : ' · sin recuperar'}</span>
    </span>
  );
}

function Pregunta({ n, titulo, sub, badge, children }: { n: number; titulo: string; sub: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={`${n} · ${titulo}`} sub={sub} right={badge} />
      <div className="p-4 space-y-3 text-sm">{children}</div>
    </Card>
  );
}

export function DesempenoPage() {
  const { active } = usePortfolios();
  const { d, listo, spError, patrimonio, hoy, snaps, posiciones, qSnaps, qPos, sinAcreditar, hayPuntos, primerFlujo } = useDesempeno(active?.id);
  if (!active) return null;

  const { calidad, twr, tir, costos, cartera, benchmark, periodo } = d;
  const anios = periodo.dias / 365;
  const aniosTxt = anios >= 1 ? `${anios.toFixed(1).replace('.', ',')} años` : `${periodo.dias} días`;
  const primeraFecha = periodo.desde;
  const sePuedeAnualizar = periodo.dias >= MIN_DIAS_ANUALIZAR;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-ink-900 font-display">Desempeño · {active.nombre}</h1>
        <p className="text-xs text-ink-600 mt-0.5">
          Todo en USD. {hayPuntos && listo
            ? <>Datos reales desde el <b>{fmtFecha(periodo.desde)}</b> ({aniosTxt} de historia, {calidad.puntos} valores). Objetivo de la serie: 10 años.</>
            : 'Esperando datos de la cartera.'}
        </p>
      </div>

      <AlertaSnapshotServidor snaps={snaps} posiciones={posiciones} hoy={hoy} listo={qSnaps.isSuccess && qPos.isSuccess} />

      {!listo || !hayPuntos ? (
        <Card><p className="p-4 text-sm text-ink-600">
          {!listo ? 'Esperando las cotizaciones de mercado para valuar la cartera de hoy…' : 'Necesita al menos dos valores diarios de la cartera. El servidor los registra solo todos los días.'}
        </p></Card>
      ) : (
        <>
          <Pregunta n={1} titulo="Rentabilidad" sub="¿Cuánto rinde mi cartera por año, en USD, con dividendos y neta de costos?"
            badge={<Badge tone={sePuedeAnualizar ? 'pos' : 'warn'}>{sePuedeAnualizar ? 'anualizado' : 'menos de 1 año'}</Badge>}>
            {twr.concentrado ? (
              <>
                <p className="text-lg">
                  <b className="tnum">{tir.acumulada != null ? fmtPctSigno(tir.acumulada, 1) : '—'}</b> sobre el capital aportado{' '}
                  <span className="text-ink-500 text-sm">en {aniosTxt}</span>
                </p>
                <p className="text-[11px] text-warn">
                  La mayor parte del capital entró hace pocos días: el % ponderado por tiempo ({twr.acumulado != null ? fmtPctSigno(twr.acumulado, 1) : '—'}) se calcula sobre
                  un capital inicial chico y no representa lo que rindió tu dinero. Mirá el rendimiento sobre el capital aportado.
                </p>
              </>
            ) : (
              <p className="text-lg">
                {twr.anualizado != null
                  ? <><b className="tnum">{fmtPctSigno(twr.anualizado, 1)}</b> por año <span className="text-ink-500 text-sm">en {aniosTxt}</span></>
                  : <><b className="tnum">{twr.acumulado != null ? fmtPctSigno(twr.acumulado, 1) : '—'}</b> acumulado <span className="text-ink-500 text-sm">en {aniosTxt}</span></>}
              </p>
            )}
            {!sePuedeAnualizar && primeraFecha && (
              <p className="text-[11px] text-warn">
                Todavía no se puede anualizar: hace falta un año de historia (llega el {fmtFecha(sumarDias(primeraFecha, MIN_DIAS_ANUALIZAR))}). Anualizar {aniosTxt} sería una estimación, no un dato.
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Stat label="Ganancia en USD" value={<span className={tir.gananciaUsd >= 0 ? 'text-pos' : 'text-neg'}>{tir.gananciaUsd >= 0 ? '+' : '−'}{fmtUsd(Math.abs(tir.gananciaUsd), 0)}</span>} hint="valor hoy + retiros − capital puesto; es la misma ganancia que ves por año en Aportes" />
              <Stat label="Sobre capital aportado" value={tir.acumulada != null ? fmtPctSigno(tir.acumulada, 1) : '—'} hint="ganancia ÷ capital invertido, sin anualizar" />
              <Stat label="Acumulado ponderado" value={twr.acumulado != null ? fmtPctSigno(twr.acumulado, 1) : '—'} hint={twr.concentrado ? 'no representativo: el capital entró hace poco' : 'ponderado por tiempo: no cuenta aportes ni retiros como ganancia'} />
              <Stat label="Anualizado" value={twr.anualizado != null ? fmtPctSigno(twr.anualizado, 1) : '—'} hint={twr.anualizado == null ? 'desde un año de historia' : 'ponderado por tiempo'} />
              <Stat label="TIR anual" value={tir.anualizada != null ? fmtPctSigno(tir.anualizada, 1) : '—'} hint={tir.anualizada == null ? 'desde un año de historia' : 'ponderada por dinero (cuándo aportaste)'} />
              <Stat label="TIR neta de costos" value={tir.neta != null ? fmtPctSigno(tir.neta, 1) : '—'} hint="descuenta las comisiones en pesos con tipo de cambio registrado" />
            </div>
            <p className="text-[11px] text-ink-600">
              <b>Dividendos y cupones:</b> suman al rendimiento cuando están acreditados en Liquidez (el patrimonio incluye el efectivo).
              {sinAcreditar > 0.5 && <span className="text-warn"> Hay {fmtUsd(sinAcreditar, 2)} confirmados sin acreditar: solo cuentan si ese efectivo ya está en tu saldo.</span>}
            </p>
            <p className="text-[11px] text-ink-600">
              <b>Costos</b> (<Link to="/ordenes" className="text-celeste-600 underline">ver órdenes y controles</Link>):{' '}
              {costos.ordenes === 0
                ? 'no hay órdenes con comisiones registradas: el rendimiento no descuenta costos de operación.'
                : <>{costos.ordenes} órdenes · comisiones {fmtUsd(costos.totalUsdConocido, 2)}{costos.estimadasUsd > 0 && <span className="text-warn"> (de las cuales ≈ {fmtUsd(costos.estimadasUsd, 2)} son estimadas, no datos reales)</span>}{costos.pctSobreOperado != null && <> ({fmtPct(costos.pctSobreOperado, 2)} de lo operado)</>}
                  {costos.comisionArsSinConvertirPesos > 0 && <span className="text-warn"> · y $ {costos.comisionArsSinConvertirPesos.toLocaleString('es-AR', { maximumFractionDigits: 0 })} en pesos sin tipo de cambio registrado (no descontados)</span>}.</>}
            </p>
          </Pregunta>

          <Pregunta n={2} titulo="Contra el S&P 500" sub="¿Le gano o le pierdo al índice, en la misma moneda y con la misma metodología?"
            badge={benchmark ? <Badge tone={benchmark.diferenciaValor >= 0 ? 'pos' : 'neg'}>{benchmark.diferenciaValor >= 0 ? 'por encima' : 'por debajo'}</Badge> : undefined}>
            {benchmark ? (
              <>
                <p className="text-lg">
                  <b className={`tnum ${benchmark.diferenciaValor >= 0 ? 'text-pos' : 'text-neg'}`}>{benchmark.diferenciaValor >= 0 ? '+' : '−'}{fmtUsd(Math.abs(benchmark.diferenciaValor), 0)}</b>{' '}
                  <span className="text-sm text-ink-600">contra el índice con tus mismos aportes y retiros</span>
                </p>
                <p className="text-xs">
                  Si cada aporte y retiro tuyo se hubiera hecho en el S&amp;P 500 (retorno total, con dividendos) el mismo día, hoy tendrías{' '}
                  <b className="tnum">{fmtUsd(benchmark.mismosFlujos.valorFinal, 0)}</b>. Tu cartera vale <b className="tnum">{fmtUsd(patrimonio, 0)}</b>.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Stat label="Tu cartera, sobre capital" value={tir.acumulada != null ? fmtPctSigno(tir.acumulada, 1) : '—'} hint="ganancia ÷ capital aportado" />
                  <Stat label="Índice, sobre capital" value={benchmark.mismosFlujos.rendimientoPeriodo != null ? fmtPctSigno(benchmark.mismosFlujos.rendimientoPeriodo, 1) : '—'} hint="con tus mismos aportes y retiros" />
                  <Stat label="Diferencia de TIR" value={benchmark.diferenciaTirPuntos != null ? `${(benchmark.diferenciaTirPuntos * 100).toFixed(1)} pp` : '—'} hint={benchmark.diferenciaTirPuntos == null ? 'desde un año de historia' : 'tu TIR − TIR del índice'} />
                  <Stat label="Cartera, ponderado" value={twr.acumulado != null ? fmtPctSigno(twr.acumulado, 1) : '—'} hint={twr.concentrado ? 'no representativo: capital reciente' : 'cierre a cierre'} />
                  <Stat label="S&P 500, cierre a cierre" value={benchmark.twrBenchmark != null ? fmtPctSigno(benchmark.twrBenchmark, 1) : '—'} hint={`${fmtFecha(periodo.desde)} → ${fmtFecha(periodo.hasta)}`} />
                  <Stat label="TIR del índice" value={benchmark.mismosFlujos.tir != null ? fmtPctSigno(benchmark.mismosFlujos.tir, 1) : '—'} hint={benchmark.mismosFlujos.tir == null ? 'desde un año de historia' : 'con tus mismos flujos'} />
                </div>
                <p className="text-[11px] text-ink-600">
                  Se mide desde el {fmtFecha(periodo.desde)} (primer valor diario registrado): ese valor es el capital inicial y cuentan tus aportes y retiros posteriores.{primerFlujo && primerFlujo < (periodo.desde ?? '') && <> Tu primer aporte es del {fmtFecha(primerFlujo)}, pero antes del {fmtFecha(periodo.desde)} no hay valores diarios y ese tramo no se compara.</>} SPY ya descuenta su costo de fondo (~0,09 %); tu cartera no descuenta costos que no estén registrados.
                </p>
              </>
            ) : (
              <p className="text-xs text-ink-500">{spError ? 'No se pudo traer el S&P 500. Reintentá más tarde.' : 'Sin comparación: falta la serie del índice o aportes cargados que cubran las fechas.'}</p>
            )}
          </Pregunta>

          <Pregunta n={3} titulo="Riesgo y máxima caída" sub="¿Cuál fue la mayor caída desde un máximo hasta el mínimo posterior, y cómo se compara con el índice?"
            badge={<Badge tone={calidad.confiable ? 'pos' : 'warn'}>{calidad.confiable ? 'serie completa' : 'serie con huecos'}</Badge>}>
            <div className="space-y-1 text-xs">
              <p><b>Tu cartera:</b> <Caida dd={cartera.mdd} minimo={cartera.rotuloMinimoConocido} /></p>
              {benchmark && <p><b>S&amp;P 500, mismas fechas:</b> <Caida dd={benchmark.mddEnMismasFechas} /></p>}
              {benchmark && <p><b>S&amp;P 500, diario:</b> <Caida dd={benchmark.mddDiario} /></p>}
            </div>
            {cartera.mdd && cartera.mdd.enCurso && <p className="text-[11px] text-ink-600">Hoy estás {fmtPct(Math.abs(cartera.mdd.actual), 1)} por debajo de tu máximo.</p>}
            {!calidad.confiable && (
              <p className="text-[11px] text-warn">
                La serie tiene {calidad.huecos.length} {calidad.huecos.length === 1 ? 'hueco' : 'huecos'} de más de una semana (el mayor, de {calidad.maxHueco} días): la caída real pudo ser mayor a la medida, por eso "≥".
                Desde que el servidor registra el valor todos los días, los huecos nuevos no se producen.
              </p>
            )}
            {twr.anomalias > 0 && <p className="text-[11px] text-warn">{twr.anomalias} {twr.anomalias === 1 ? 'tramo' : 'tramos'} con un aporte mayor al valor previo o que no cuadra con el valor registrado ese día no se pudieron medir: no suman ni restan al ponderado ni a la caída.</p>}
          </Pregunta>
        </>
      )}
    </div>
  );
}
