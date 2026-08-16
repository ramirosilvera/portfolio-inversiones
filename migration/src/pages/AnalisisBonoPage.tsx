import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, LineChart, Sparkles } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { useBonosReferencia } from '../hooks/useBonosReferencia';
import { useBonosPrecios, useMacro } from '../hooks/usePosiciones';
import { useUltimoAnalisis, useSetUltimoAnalisis } from '../hooks/useAnalisisIA';
import { calcularBonoReferencia, comparables, tirPromedioComparables, TIPO_LABEL, type BonoReferencia, type BonoReferenciaCalc } from '../engine/rentaFija';
import { ETIQUETA_GRADO } from '../engine/rating';
import { Card, CardHeader, Stat, Badge, RatingBadge, Button, Empty, fmtUsd, fmtNum, fmtPct, normalizeAiText } from '../components/ui';
import { api } from '../lib/api';

const TIPO_TONE: Record<BonoReferencia['tipo'], 'accent' | 'sol' | 'gray'> = { soberano: 'accent', subsoberano: 'sol', on: 'gray' };

// Análisis de un bono/ON del catálogo de referencia (bonos_referencia): cronograma completo +
// TIR/duración/paridad, calculados por engine/rentaFija.ts — no hay DCF acá (Owner Earnings no
// aplica a renta fija), a diferencia de AnalisisPage.tsx que sí es DCF de acciones/CEDEARs.
export function AnalisisBonoPage() {
  const { ticker = '' } = useParams();
  const T = ticker.toUpperCase();
  const { active } = usePortfolios();
  const { data: catalogo = [], isLoading, isError } = useBonosReferencia();
  const { data: precios = {} } = useBonosPrecios();
  const { data: macro = {} } = useMacro();
  const hoy = new Date().toISOString().slice(0, 10);

  const ref = catalogo.find(b => b.ticker === T);
  const calc = useMemo(() => ref ? calcularBonoReferencia(ref, precios[T] ?? null, hoy) : null, [ref, precios, T, hoy]);

  const catalogoCalc = useMemo(
    () => catalogo.map(r => calcularBonoReferencia(r, precios[r.ticker] ?? null, hoy)),
    [catalogo, precios, hoy],
  );
  const comps = useMemo(() => calc ? comparables(calc, catalogoCalc, 6) : [], [calc, catalogoCalc]);
  const tirComparables = useMemo(() => tirPromedioComparables(comps), [comps]);

  const riskFree = ((macro as Record<string, number | null>).dgs10 ?? null);
  const spreadRiskFree = calc?.tir != null && riskFree != null ? calc.tir - riskFree / 100 : null;
  const spreadComparables = calc?.tir != null && tirComparables != null ? calc.tir - tirComparables : null;

  // Próximo flujo futuro del cronograma — mismo filtro que usa el motor (ytmFromCronograma) para
  // decidir qué es "futuro", no un criterio nuevo acá.
  const proximoCupon = ref?.cronograma.filter(f => f.fecha > hoy).sort((a, b) => a.fecha.localeCompare(b.fecha))[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Link to="/radar" className="text-ink-600 hover:text-ink-900 inline-flex items-center justify-center w-9 h-9" aria-label="Volver al Radar"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="text-2xl font-bold text-ink-900 font-display">{T || 'Renta fija'}</h1>
        {ref && <Badge tone={TIPO_TONE[ref.tipo]}>{TIPO_LABEL[ref.tipo]}</Badge>}
        {ref?.amortizable && <Badge tone="warn">amortizable</Badge>}
        {ref && <RatingBadge calificadora={ref.calificadora} calificacion={ref.calificacion} grado={calc?.grado ?? null} escala={calc?.escalaGrado ?? null} />}
      </div>

      {isError && (
        <Card><Empty icon={LineChart} title="No se pudo cargar el catálogo">
          Probá recargar la página — si sigue fallando, puede ser un problema temporal de conexión.
        </Empty></Card>
      )}

      {!isLoading && !isError && !ref && (
        <Card><Empty icon={LineChart} title="No está en el catálogo de referencia">
          Todavía no cargamos el cronograma de {T}. El catálogo se actualiza periódicamente — si es un bono/ON líquido, puede sumarse en la próxima actualización.
        </Empty></Card>
      )}

      {ref && calc && (
        <>
          <Card>
            <CardHeader title={ref.nombre || ref.ticker}
              sub={`${ref.emisor ?? 'Emisor no identificado'} · ${ref.moneda} · vence ${ref.vencimiento}${ref.emision ? ` · emitido ${ref.emision}` : ''} · fuente: ${ref.fuente}, actualizado ${ref.actualizado_en.slice(0, 10)}`} />
            <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Precio" value={fmtUsd(calc.px)} />
              <Stat label="Paridad" value={calc.paridad != null ? `${fmtNum(calc.paridad, 1)}%` : '—'} />
              <Stat label="TIR"
                value={calc.tir != null ? <>{fmtPct(calc.tir)}{calc.tirSinAjustar && <sup className="text-[9px] text-ink-500 font-normal ml-0.5">e</sup>}</> : '—'}
                hint={calc.tirSinAjustar ? 'Estimada: a esta altura del último cupón, el cronograma no tiene ningún pago previo del que inferir el interés corrido, así que se calculó con precio limpio sin ajustar — puede estar inflada, sobre todo muy cerca del vencimiento.' : undefined} />
              <Stat label="Rendimiento corriente" value={calc.rendCorriente != null ? fmtPct(calc.rendCorriente) : '—'}
                hint="Cupón anualizado / precio — a diferencia de la TIR, ignora la ganancia/pérdida de capital hasta el vencimiento" />
              <Stat label="Duración (Macaulay)" value={calc.duracion ? `${fmtNum(calc.duracion.macaulay, 1)} años` : '—'} />
              <Stat label="Duración modificada" value={calc.duracion ? fmtNum(calc.duracion.modified, 2) : '—'}
                hint="Aproxima el % de variación del precio ante una suba/baja de 1 punto de tasa" />
              <Stat label="Valor residual" value={`${fmtNum(ref.valor_residual * 100, 1)}%`}
                hint="Fracción del nominal original que todavía queda por cobrar" />
              <Stat label="Spread vs. UST 10Y" value={spreadRiskFree != null ? fmtPct(spreadRiskFree) : '—'}
                hint="TIR de este bono menos la tasa libre de riesgo (bono del Tesoro de EE.UU. a 10 años)" />
            </div>
            {calc.px == null && (
              <p className="px-4 pb-2 text-[11px] text-warn">Sin cotización disponible ahora mismo — TIR, duración y rendimiento corriente no se pueden calcular sin precio de mercado.</p>
            )}
            {calc.tirSinAjustar && (
              <p className="px-4 pb-2 text-[11px] text-ink-500">
                <sup className="text-[9px]">e</sup> Último cupón antes del vencimiento sin ningún pago previo en el cronograma — la TIR se calculó con precio limpio, sin descontar el interés corrido, y puede estar inflada (sobre todo muy cerca del vencimiento).
              </p>
            )}
            {proximoCupon && (
              <p className="px-4 pb-4 text-[11px] text-ink-600">
                Próximo cupón: <span className="tnum font-medium text-ink-800">{proximoCupon.fecha}</span>
                {' · '}{fmtNum(proximoCupon.interes * 100, 3)}% interés
                {proximoCupon.amortizacion > 0 && ` + ${fmtNum(proximoCupon.amortizacion * 100, 1)}% amortización`}
                {' del nominal original.'}
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Cronograma de flujos" sub="Fracción del nominal ORIGINAL por período (interés + amortización) — fuente: IOL." />
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead className="text-[11px] text-ink-600 border-b border-line">
                  <tr>
                    <th className="text-left px-4 py-2">Fecha</th>
                    <th className="text-right px-3">Interés</th>
                    <th className="text-right px-3">Amortización</th>
                    <th className="text-right px-3">Saldo residual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ref.cronograma.map((f, i) => (
                    // key con índice, no solo `f.fecha`: IOL suele traer interés y amortización de
                    // la misma fecha como registros separados en el cronograma original — la fecha
                    // sola no es única.
                    <tr key={`${f.fecha}-${i}`} className={f.fecha <= hoy ? 'opacity-40' : ''}>
                      <td className="px-4 py-2">{f.fecha}</td>
                      <td className="text-right px-3 tnum">{fmtNum(f.interes * 100, 3)}%</td>
                      <td className="text-right px-3 tnum">{f.amortizacion > 0 ? `${fmtNum(f.amortizacion * 100, 1)}%` : '—'}</td>
                      <td className="text-right px-3 tnum">{fmtNum(f.saldo_residual * 100, 1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {comps.length > 0 && (
            <Card>
              <CardHeader title="Comparativa" sub="Bonos de calificación y duración parecidas — no la mejor TIR del catálogo, sino los de riesgo más similar a este."
                right={spreadComparables != null && (
                  <span className={`text-xs tnum ${spreadComparables >= 0 ? 'text-pos' : 'text-neg'}`}
                    title="TIR de este bono menos el promedio de TIR de los comparables del mismo grado">
                    {spreadComparables >= 0 ? '+' : ''}{fmtPct(spreadComparables)} vs. promedio comparable
                  </span>
                )} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="text-[11px] text-ink-600 border-b border-line">
                    <tr>
                      <th className="text-left px-4 py-2">Ticker</th>
                      <th className="text-left px-3">Emisor</th>
                      <th className="text-left px-3">Calificación</th>
                      <th className="text-right px-3">TIR</th>
                      <th className="text-right px-3">Duración</th>
                      <th className="px-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {comps.map(c => (
                      <tr key={c.ref.ticker} className="hover:bg-canvas">
                        <td className="px-4 py-2 font-semibold text-ink-900">{c.ref.ticker}</td>
                        <td className="px-3 text-ink-700 truncate max-w-[140px]" title={c.ref.emisor ?? undefined}>{c.ref.emisor ?? <span className="text-ink-500">—</span>}</td>
                        <td className="px-3">
                          <span title={!c.mismoGrado ? `Distinto grado de riesgo que ${T} — completa la lista porque no había suficientes comparables exactos` : undefined}>
                            <RatingBadge calificadora={c.ref.calificadora} calificacion={c.ref.calificacion} grado={c.grado} escala={c.escalaGrado} />
                          </span>
                        </td>
                        <td className="text-right px-3 tnum">{fmtPct(c.tir!)}</td>
                        <td className="text-right px-3 tnum">{c.duracion ? `${fmtNum(c.duracion.macaulay, 1)}a` : '—'}</td>
                        <td className="px-2 text-right"><Link to={`/analisis/bono/${c.ref.ticker}`} className="text-ink-600 hover:text-accent text-xs">Ver</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {comps.some(c => !c.mismoGrado) && (
                <p className="px-4 py-2 text-[11px] text-ink-500">No había suficientes bonos calificados igual que {T} en el catálogo — se completó con los de grado más cercano (sin fondo resaltado en Calificación).</p>
              )}
            </Card>
          )}

          <AnalisisIA ticker={T} portfolioId={active?.id ?? null} bono={ref} calc={calc}
            tirComparables={tirComparables} spreadComparables={spreadComparables} nComparables={comps.filter(c => c.mismoGrado).length} />
        </>
      )}
    </div>
  );
}

// Mismo patrón que GeminiAnalysis en AnalisisPage.tsx (acciones/CEDEARs): la IA interpreta los
// números ya calculados por el código (TIR, duración, calificación, comparativa) — nunca los
// recalcula ni inventa una cifra nueva.
// La prop se llama `bono`, NO `ref`: `ref` es un nombre reservado por React (el mecanismo de
// forwardRef) — en un componente función sin forwardRef, JSX simplemente lo descarta ANTES de
// construir el objeto de props, así que nunca llega adentro. Con `ref: bono` en la desestructuración
// de abajo `bono` daba `undefined` siempre, para CUALQUIER bono — el análisis IA de renta fija nunca
// había funcionado ni una sola vez (confirmado: 0 filas con tipo='bono' en analisis_ia en producción).
function AnalisisIA({ ticker, portfolioId, bono, calc, tirComparables, spreadComparables, nComparables }: {
  ticker: string; portfolioId: string | null; bono: BonoReferencia; calc: BonoReferenciaCalc;
  tirComparables: number | null; spreadComparables: number | null; nComparables: number;
}) {
  const { texto: guardado, fecha } = useUltimoAnalisis(ticker, 'bono');
  const setUltimo = useSetUltimoAnalisis();
  const [txt, setTxt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mostrado = txt ?? guardado;

  // try/finally: postAnalisis() ya no rechaza (ver api.ts), pero si algo INESPERADO explota acá
  // adentro (construyendo `context`, guardando el resultado) sin este finally `busy` quedaba en
  // true para siempre — el botón trababa en "Analizando…" sin mostrar error ni dejar reintentar
  // (caso reportado: análisis IA de renta fija).
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const context = {
        ticker, emisor: bono.emisor, tipo: bono.tipo, instrumento: bono.instrumento,
        calificadora: bono.calificadora, calificacion: bono.calificacion,
        grado: calc.grado ? ETIQUETA_GRADO[calc.grado] : null,
        tir: calc.tir, rendimientoCorriente: calc.rendCorriente,
        duracionMacaulay: calc.duracion?.macaulay ?? null, duracionModificada: calc.duracion?.modified ?? null,
        paridad: calc.paridad, valorResidual: bono.valor_residual, vencimiento: bono.vencimiento,
        tirPromedioComparablesMismoGrado: tirComparables, spreadVsComparables: spreadComparables, cantidadComparablesMismoGrado: nComparables,
      };
      const r = await api.analisisBono({ ticker, portfolio_id: portfolioId, context });
      if (r.error) setErr(r.error);
      else { setTxt(r.analisis ?? ''); if (r.analisis) setUltimo(ticker, 'bono', r.analisis); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'error inesperado');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Análisis cualitativo (IA)" sub="Gemini interpreta los números calculados por el código (TIR, duración, calificación, comparativa). No es recomendación de inversión."
        right={<Button variant="ghost" onClick={run} disabled={busy || calc.tir == null}><Sparkles className="w-4 h-4" /> {busy ? 'Analizando…' : mostrado ? 'Regenerar' : 'Analizar'}</Button>} />
      {calc.tir == null && !mostrado && <p className="px-4 pb-3 text-xs text-ink-500">Necesita TIR calculada (precio de mercado disponible) para poder analizarlo.</p>}
      {err && <p className="px-4 pt-1 text-xs text-neg">No se pudo generar: {err}</p>}
      {mostrado && (
        <div className="px-4 py-3">
          <p className="text-sm text-ink-700 whitespace-pre-wrap break-words leading-relaxed">{normalizeAiText(mostrado)}</p>
          {!txt && fecha && <p className="text-[10px] text-ink-500 mt-1.5">Guardado · {new Date(fecha).toLocaleString('es-AR')}</p>}
        </div>
      )}
    </Card>
  );
}
