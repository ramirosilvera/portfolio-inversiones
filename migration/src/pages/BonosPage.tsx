import { useState } from 'react';
import { Landmark, Pencil, X, CalendarClock, Trash2, Plus } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosicionMutations, useMacro } from '../hooks/usePosiciones';
import { useBonosCalc, useObjetivoDuracion, resumenBonos, alertasBonos, DEFAULT_MIN_GRADO_INVERSION_PCT, DEFAULT_MAX_DURACION_ANIOS, DEFAULT_MIN_LEY_EXTRANJERA_PCT } from '../hooks/useBonos';
import { useAmortizaciones } from '../hooks/useAmortizaciones';
import { CONCENTRACION_POSICION_ALERTA } from '../engine/bonos';
import { CALIFICADORAS } from '../engine/rating';
import { LEY_LABEL, LEY_TONE } from '../engine/rentaFija';
import { Card, CardHeader, Button, Badge, Stat, Field, Empty, RatingBadge, NumField, inputCls, fmtUsdCompact, fmtNum, fmtPct, AlertasBanner } from '../components/ui';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useChartTheme } from '../hooks/usePrefs';
import type { Posicion, AmortizacionProgramada } from '../types/domain';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const FREC: Record<number, string> = { 1: 'Anual', 2: 'Semestral', 4: 'Trimestral', 12: 'Mensual' };
// Gris neutro para "sin calificar"/"sin clasificar" en las barras de calidad crediticia y ley
// aplicable — mismo criterio que SIN_ASIGNAR_COLOR en components/ui.tsx (colorDeBroker): no compite
// con los tonos pos/warn/neg ni con accent/sol (ley).
const SIN_DATO_COLOR = '#8B96A5';

// Sin cotización de mercado (bc.mkt == null — típico de un bono recién suscripto en licitación
// primaria, que puede tardar en aparecer en el proveedor de precios): la TIR/duración de esa fila
// no salen del precio de mercado sino de tu precio de compra (mismo criterio que "capitalUsado" cae
// al costo). Además, si "hoy" cae cerca de una fecha de cupón calculada desde el vencimiento, el
// motor no descuenta el interés corrido (no modela precio "sucio") y ese cupón casi inmediato puede
// inflar la TIR bastante por encima del cupón nominal — no es que el bono rinda eso en la práctica.
const SIN_COTIZACION_HINT = 'Sin cotización todavía: se estima con tu precio de compra. Con un cupón próximo, la TIR puede estar inflada (no descuenta interés corrido).';

// Ningún proveedor (ni data912, verificado a mano contra su respuesta real) publica cronograma de
// amortización ni valor residual — TIR/duración/rendimiento corriente asumen bullet (100% del
// capital recién al vencimiento) salvo que marques el bono como "Amortizable" y cargues el valor
// residual con el ✏️ (ver CuponModal). El sesgo de dejarlo en bullet cuando en los hechos amortiza
// puede ser grande (no "leve") y cambia de signo según si el bono cotiza bajo o sobre la par — ver
// el comentario de ytm() en engine/coupons.ts. "Paridad" y "Valor mercado" NUNCA se ajustan por
// valor residual: si hay cotización de mercado, el precio ya refleja lo que vale el bono hoy.
const BULLET_HINT = 'TIR, duración y rendimiento corriente asumen bullet (100% al vencimiento) salvo que lo marques "Amortizable" y cargues el valor residual (✏️). Paridad y Valor mercado no se ajustan.';

export function BonosPage() {
  const { active } = usePortfolios();
  const { bonos, bonosCalc, isLoading: posLoading } = useBonosCalc(active?.id);
  const { update } = usePosicionMutations(active?.id);
  const { data: amortizaciones, agregar: agregarCuota, eliminar: eliminarCuota } = useAmortizaciones();
  const [editBono, setEditBono] = useState<Posicion | null>(null);
  const hoy = new Date().toISOString().slice(0, 10);
  const {
    minGradoInversionPct, maxDuracionAnios, minLeyExtranjeraPct,
    setMinGradoInversionPct, setMaxDuracionAnios, setMinLeyExtranjeraPct,
  } = useObjetivoDuracion(active?.id);
  const chart = useChartTheme();
  const { data: macro = {} } = useMacro();
  const riskFree = (macro as Record<string, number | null>).dgs10 != null ? (macro as Record<string, number | null>).dgs10! / 100 : null;

  if (!active) return null;

  const resumen = resumenBonos(bonosCalc, riskFree);
  const { totalCapital, totalMkt, duracionPromedio, tirPromedio, rendCorrientePromedio, spreadPromedio, mayorPosicion, distribucionGrado, distribucionLey } = resumen;
  const alertas = alertasBonos(resumen, minGradoInversionPct, maxDuracionAnios, minLeyExtranjeraPct);
  const haySinCotizacion = bonosCalc.some(bc => bc.mkt == null && bc.tir != null);

  // Gráfico: solo entran los bonos con duración calculable (cupón + vencimiento cargados, y no
  // vencidos). `duracionAnios` es un campo plano (no `duracion.macaulay`) a propósito: el eje X
  // del ScatterChart de recharts necesita un `dataKey` que resuelva a un número directamente — con
  // un objeto anidado, el dominio del eje se calcula mal y los puntos no se posicionan.
  const puntos = bonosCalc
    .filter(b => b.duracion != null && b.capitalUsado > 0)
    .map(b => ({ ...b, duracionAnios: b.duracion!.macaulay }));
  const sinDuracion = bonosCalc.filter(b => b.duracion == null);
  const sinDuracionVencidos = sinDuracion.filter(b => b.pos.vencimiento != null && b.pos.vencimiento <= hoy);
  const sinDuracionIncompletos = sinDuracion.filter(b => !(b.pos.vencimiento != null && b.pos.vencimiento <= hoy));
  const cumpleObjetivo = duracionPromedio != null && duracionPromedio <= maxDuracionAnios;

  // pos/warn ya salen de chart (useChartTheme) — antes se reconstruían acá con los mismos hex a
  // mano, duplicado que podía desalinearse si el tema cambiaba en un solo lugar.
  const posColor = chart.pos;
  const accentColor = '#4F97D4'; // = accent/celeste-500 (tailwind.config.ts) — fijo, no varía por tema.
  const warnColor = chart.warn;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Renta fija · {active.nombre}</h1>
      <AlertasBanner alertas={alertas} />
      <Card>
        <CardHeader title="Bonos y ONs" sub="Precio por nominal (data912). Cargá el cupón (✏️) para verlos en el calendario de Cupones."
          right={<span className="text-xs text-ink-600 tnum">Capital {fmtUsdCompact(totalCapital)} · Mercado {fmtUsdCompact(totalMkt)}</span>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr>
                <th className="text-left px-4 py-2">Especie</th>
                <th className="text-left px-3">Rating</th>
                <th className="text-left px-3">Ley</th>
                <th className="text-right px-3">Nominales</th>
                <th className="text-right px-3">Capital</th>
                <th className="text-right px-3">Paridad</th>
                <th className="text-right px-3">Valor mercado</th>
                <th className="text-right px-3">Resultado</th>
                <th className="text-right px-3">Cupón</th>
                <th className="text-right px-3">TIR (YTM)</th>
                <th className="text-right px-3">Duración</th>
                <th className="text-right px-3">Venc.</th>
                <th className="px-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {bonosCalc.map(bc => {
                const b = bc.pos;
                return (
                  <tr key={b.id} className="hover:bg-canvas align-top">
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5" title={b.notas ?? undefined}>
                        <span className="font-semibold text-ink-900">{b.ticker}</span>
                        {b.amortizable && (
                          <span title={b.valor_residual != null
                            ? `Amortizable — valor residual cargado: ${fmtPct(b.valor_residual, 0)} del nominal original`
                            : 'Amortizable sin valor residual cargado — se calcula como bullet (100%). Editalo con el ✏️.'}>
                            <Badge tone={b.valor_residual != null ? 'accent' : 'warn'}>Amort.</Badge>
                          </span>
                        )}
                      </span>
                      {(b.empresa || b.notas) && <span className="block text-[10px] text-ink-600 max-w-[220px] truncate">{b.empresa || b.notas}</span>}
                    </td>
                    <td className="px-3"><RatingBadge calificadora={b.calificadora} calificacion={b.calificacion} grado={bc.grado} escala={bc.escalaGrado} /></td>
                    <td className="px-3">
                      {b.ley
                        ? <Badge tone={LEY_TONE[b.ley]}>{LEY_LABEL[b.ley]}</Badge>
                        : <span className="text-ink-500 text-xs">—</span>}
                    </td>
                    <td className="text-right px-3 tnum">{fmtNum(b.cantidad, 0)}</td>
                    <td className="text-right px-3 tnum text-ink-700">{fmtUsdCompact(bc.capital)}</td>
                    <td className="text-right px-3 tnum text-accent">{bc.paridad != null ? fmtPct(bc.paridad / 100, 1) : '—'}</td>
                    <td className="text-right px-3 tnum">{fmtUsdCompact(bc.mkt)}</td>
                    <td className={`text-right px-3 tnum ${bc.res == null ? '' : bc.res >= 0 ? 'text-pos' : 'text-neg'}`}>{bc.res == null ? '—' : `${bc.res >= 0 ? '+' : ''}${fmtUsdCompact(bc.res)}`}</td>
                    <td className="text-right px-3 tnum">
                      {bc.cuponOk
                        ? <span className="text-ink-800">{fmtPct(b.cupon_tasa!, 1)}<span className="text-[10px] text-ink-500"> · {FREC[b.cupon_frecuencia!] ?? `${b.cupon_frecuencia!}/año`}</span></span>
                        : <span className="text-warn text-[11px]">sin cupón</span>}
                    </td>
                    <td className="text-right px-3 tnum">
                      {bc.tir != null
                        ? <span className={bc.tir >= 0 ? 'text-pos font-semibold' : 'text-neg'} title={bc.mkt == null ? SIN_COTIZACION_HINT : undefined}>
                            {fmtPct(bc.tir, 1)}{bc.mkt == null && <sup className="text-[9px] text-ink-500 font-normal ml-0.5">e</sup>}
                          </span>
                        : <span className="text-ink-500">—</span>}
                    </td>
                    <td className="text-right px-3 tnum">
                      {bc.duracion != null
                        ? <span className={bc.duracion.macaulay <= maxDuracionAnios ? 'text-pos' : 'text-ink-700'} title={bc.mkt == null ? SIN_COTIZACION_HINT : undefined}>
                            {fmtNum(bc.duracion.macaulay, 1)}a{bc.mkt == null && <sup className="text-[9px] text-ink-500 ml-0.5">e</sup>}
                          </span>
                        : <span className="text-ink-500">—</span>}
                    </td>
                    <td className="text-right px-3 tnum text-ink-600">{b.vencimiento ?? '—'}</td>
                    <td className="px-2 text-right">
                      <button onClick={() => setEditBono(b)} className="text-ink-600 hover:text-celeste-600 inline-flex items-center justify-center w-9 h-9" title="Editar cupón y rating" aria-label="Editar cupón y rating"><Pencil className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
              {posLoading
                ? <tr><td colSpan={13}><p className="p-4 text-sm text-ink-600">Cargando…</p></td></tr>
                : bonos.length === 0 && <tr><td colSpan={13}><Empty icon={Landmark} title="Sin bonos ni ONs">Agregá uno en Posiciones con el tipo "Bono / ON".</Empty></td></tr>}
            </tbody>
          </table>
        </div>
        {bonos.length > 0 && (
          <p className="px-4 pb-1.5 pt-1 text-[11px] text-ink-500">{BULLET_HINT}</p>
        )}
        {haySinCotizacion && (
          <p className="px-4 pb-3 text-[11px] text-ink-500">
            <sup className="text-[9px]">e</sup> Sin cotización todavía — TIR y duración se estiman con tu precio de compra y pueden distorsionarse con un cupón próximo.
          </p>
        )}
      </Card>

      {bonos.length > 0 && (
        <Card>
          <CardHeader title="Indicadores clave" sub="Rendimiento, crédito, jurisdicción y concentración de la renta fija." />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
            <Stat label="TIR promedio" value={tirPromedio != null
              ? <span className={tirPromedio >= 0 ? 'text-pos' : 'text-neg'}>{fmtPct(tirPromedio)}</span>
              : <span className="text-ink-500">—</span>}
              hint="TIR (YTM) promedio ponderada por capital" />
            <Stat label="Rend. corriente" value={rendCorrientePromedio != null ? fmtPct(rendCorrientePromedio) : '—'}
              hint="Cupón/precio ponderado por capital — ignora la ganancia o pérdida de capital" />
            <Stat label="Spread s/UST10y" value={spreadPromedio != null
              ? <span className={spreadPromedio >= 0 ? 'text-ink-900' : 'text-neg'}>{spreadPromedio >= 0 ? '+' : ''}{fmtPct(spreadPromedio)}</span>
              : <span className="text-ink-500">—</span>}
              hint="TIR promedio menos UST10y: la prima de riesgo de la cartera" />
            <Stat label="Mayor posición" value={mayorPosicion
              ? <span className={mayorPosicion.pct >= CONCENTRACION_POSICION_ALERTA ? 'text-warn' : 'text-ink-900'}>{mayorPosicion.ticker} · {fmtPct(mayorPosicion.pct, 0)}</span>
              : <span className="text-ink-500">—</span>}
              hint={`% del capital en un solo ticker — alerta desde ${fmtPct(CONCENTRACION_POSICION_ALERTA, 0)}. No agrupa series del mismo emisor.`} />
          </div>
          <div className="px-4 pb-4">
            <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold mb-1.5">Calidad crediticia</p>
            {totalMkt > 0 ? (
              <>
                <div className="h-3 rounded-full overflow-hidden flex bg-canvas ring-1 ring-inset ring-line">
                  {distribucionGrado.gradoInversion > 0 &&
                    <div className="bg-pos h-full" style={{ width: `${distribucionGrado.gradoInversion * 100}%` }} title={`Grado de inversión (dentro de su escala, global o nacional): ${fmtPct(distribucionGrado.gradoInversion, 0)}`} />}
                  {distribucionGrado.especulativo > 0 &&
                    <div className="bg-warn h-full" style={{ width: `${distribucionGrado.especulativo * 100}%` }} title={`Especulativo (dentro de su escala, global o nacional): ${fmtPct(distribucionGrado.especulativo, 0)}`} />}
                  {distribucionGrado.default > 0 &&
                    <div className="bg-neg h-full" style={{ width: `${distribucionGrado.default * 100}%` }} title={`Default: ${fmtPct(distribucionGrado.default, 0)}`} />}
                  {distribucionGrado.sinCalificar > 0 &&
                    <div className="h-full" style={{ width: `${distribucionGrado.sinCalificar * 100}%`, background: SIN_DATO_COLOR }} title={`Sin calificar (o calificadora "Otra"/nota no reconocida): ${fmtPct(distribucionGrado.sinCalificar, 0)}`} />}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px] text-ink-600">
                  {distribucionGrado.gradoInversion > 0 && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-pos" />Grado de inversión {fmtPct(distribucionGrado.gradoInversion, 0)}</span>}
                  {distribucionGrado.especulativo > 0 && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warn" />Especulativo {fmtPct(distribucionGrado.especulativo, 0)}</span>}
                  {distribucionGrado.default > 0 && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-neg" />Default {fmtPct(distribucionGrado.default, 0)}</span>}
                  {distribucionGrado.sinCalificar > 0 && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: SIN_DATO_COLOR }} />Sin calificar {fmtPct(distribucionGrado.sinCalificar, 0)}</span>}
                </div>
                <p className="text-[10px] text-ink-500 mt-1.5">
                  Escala NACIONAL argentina (FIX SCR/Moody's Local) — no equivale a grado de inversión global (S&amp;P/Moody's/Fitch).
                </p>
                <div className="flex items-end gap-3 mt-3">
                  <Field label="Grado de inversión mínimo (%)">
                    <NumField min="0" max="100" step="5" value={minGradoInversionPct}
                      onChange={n => setMinGradoInversionPct(Math.min(100, Math.max(0, n)))}
                      onEmptyBlur={() => setMinGradoInversionPct(DEFAULT_MIN_GRADO_INVERSION_PCT)}
                      className={`${inputCls} w-24`} />
                  </Field>
                  <p className="text-[11px] text-ink-500">Alerta si el % en grado de inversión cae por debajo de tu mínimo.</p>
                </div>
              </>
            ) : <p className="text-[11px] text-ink-500">Sin capital valuado todavía.</p>}
          </div>
          <div className="px-4 pb-4">
            <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold mb-1.5">Ley aplicable</p>
            {totalMkt > 0 ? (
              <>
                <div className="h-3 rounded-full overflow-hidden flex bg-canvas ring-1 ring-inset ring-line">
                  {distribucionLey.local > 0 &&
                    <div className="bg-accent h-full" style={{ width: `${distribucionLey.local * 100}%` }} title={`Ley local: ${fmtPct(distribucionLey.local, 0)}`} />}
                  {distribucionLey.extranjera > 0 &&
                    <div className="bg-sol h-full" style={{ width: `${distribucionLey.extranjera * 100}%` }} title={`Ley extranjera: ${fmtPct(distribucionLey.extranjera, 0)}`} />}
                  {distribucionLey.sinClasificar > 0 &&
                    <div className="h-full" style={{ width: `${distribucionLey.sinClasificar * 100}%`, background: SIN_DATO_COLOR }} title={`Sin clasificar: ${fmtPct(distribucionLey.sinClasificar, 0)}`} />}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px] text-ink-600">
                  {distribucionLey.local > 0 && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent" />Local {fmtPct(distribucionLey.local, 0)}</span>}
                  {distribucionLey.extranjera > 0 && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sol" />Extranjera {fmtPct(distribucionLey.extranjera, 0)}</span>}
                  {distribucionLey.sinClasificar > 0 && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: SIN_DATO_COLOR }} />Sin clasificar {fmtPct(distribucionLey.sinClasificar, 0)}</span>}
                </div>
                <p className="text-[10px] text-ink-500 mt-1.5">
                  Se completa desde el catálogo de referencia si el ticker coincide; si no, editala con el ✏️.
                </p>
                <div className="flex items-end gap-3 mt-3">
                  <Field label="Ley extranjera mínima (%)" hint="Ley extranjera: cobro fuera de Argentina (más segura); ley local suele rendir más. Este es tu piso.">
                    <NumField min="0" max="100" step="5" value={minLeyExtranjeraPct}
                      onChange={n => setMinLeyExtranjeraPct(Math.min(100, Math.max(0, n)))}
                      onEmptyBlur={() => setMinLeyExtranjeraPct(DEFAULT_MIN_LEY_EXTRANJERA_PCT)}
                      className={`${inputCls} w-24`} />
                  </Field>
                  <p className="text-[11px] text-ink-500">Alerta si el % bajo ley extranjera cae por debajo de tu mínimo.</p>
                </div>
              </>
            ) : <p className="text-[11px] text-ink-500">Sin capital valuado todavía.</p>}
          </div>
        </Card>
      )}

      {bonos.length > 0 && (
        <Card>
          <CardHeader title="Duración vs. capital"
            sub="Cada punto es un bono: eje X = duración (Macaulay, años) · eje Y = capital."
            right={duracionPromedio != null &&
              <Badge tone={cumpleObjetivo ? 'pos' : 'warn'}>
                {fmtNum(duracionPromedio, 1)}a promedio (máx. {maxDuracionAnios}a)
              </Badge>} />
          <div className="px-4 py-3 flex flex-wrap gap-3 items-end text-sm border-b border-line">
            <Field label="Duración promedio máxima (años)">
              <NumField min="0.25" step="0.25" value={maxDuracionAnios}
                onChange={n => setMaxDuracionAnios(Math.max(0.25, n))}
                onEmptyBlur={() => setMaxDuracionAnios(DEFAULT_MAX_DURACION_ANIOS)}
                className={`${inputCls} w-24`} />
            </Field>
            {duracionPromedio != null && (
              <p className="text-[11px] text-ink-600 ml-auto">Duración promedio ponderada: <span className="tnum font-semibold text-ink-800">{fmtNum(duracionPromedio, 1)} años</span></p>
            )}
          </div>
          {puntos.length > 0 ? (
            <div className="p-2">
              <ResponsiveContainer width="100%" height={320}>
                <ScatterChart margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="duracionAnios" name="Duración" unit="a" stroke={chart.axis} fontSize={11}
                    domain={[0, (max: number) => Math.max(max, maxDuracionAnios) * 1.15]} />
                  <YAxis type="number" dataKey="capitalUsado" name="Capital" stroke={chart.axis} fontSize={11}
                    tickFormatter={v => fmtUsdCompact(v)} width={64} />
                  <ZAxis type="number" range={[80, 320]} dataKey="capitalUsado" />
                  <ReferenceLine x={maxDuracionAnios} stroke={warnColor} strokeDasharray="4 4"
                    label={{ value: `máximo ${maxDuracionAnios}a`, position: 'insideTopRight', fill: chart.axis, fontSize: 10 }} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }}
                    content={({ active: on, payload }) => {
                      if (!on || !payload?.length) return null;
                      const d = payload[0].payload as typeof puntos[number];
                      return (
                        <div className="rounded-xl px-3 py-2 text-xs" style={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, color: chart.tooltipText }}>
                          <p className="font-semibold mb-1">{d.pos.ticker}</p>
                          <p>Duración: {fmtNum(d.duracion!.macaulay, 1)} años</p>
                          <p>Capital: {fmtUsdCompact(d.capitalUsado)}</p>
                          {d.tir != null && <p>TIR: {fmtPct(d.tir, 1)}</p>}
                        </div>
                      );
                    }} />
                  <Scatter data={puntos} name="Bonos">
                    {puntos.map((p, i) => (
                      <Cell key={i} fill={p.duracion!.macaulay <= maxDuracionAnios ? posColor : accentColor} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="p-4 text-sm text-ink-600">Sin cupón ni vencimiento cargados no se puede estimar la duración. Editalos con el ✏️.</p>
          )}
          {sinDuracion.length > 0 && puntos.length > 0 && (
            <p className="px-4 pb-3 text-[11px] text-ink-500">
              No aparecen en el gráfico:{' '}
              {sinDuracionIncompletos.length > 0 && <>falta cupón/vencimiento en {sinDuracionIncompletos.map(b => b.pos.ticker).join(', ')}</>}
              {sinDuracionIncompletos.length > 0 && sinDuracionVencidos.length > 0 && ' · '}
              {sinDuracionVencidos.length > 0 && <>ya vencieron: {sinDuracionVencidos.map(b => b.pos.ticker).join(', ')}</>}
            </p>
          )}
        </Card>
      )}

      {editBono && <CuponModal bono={editBono} onClose={() => setEditBono(null)}
        onSave={async (patch) => { await update(editBono.id, patch); setEditBono(null); }}
        cuotas={amortizaciones.filter(a => a.posicion_id === editBono.id)}
        onAgregarCuota={(fecha, porcentaje) => agregarCuota({ posicionId: editBono.id, fecha, porcentaje })}
        onEliminarCuota={eliminarCuota} />}
    </div>
  );
}

// Editar/cargar los datos de un bono existente: cupón (tasa, frecuencia, mes de referencia,
// vencimiento), calificación crediticia (calificadora + nota), ley aplicable y, si es amortizable,
// el cronograma de cuotas futuras (alimenta la proyección de Cupones — ver engine/coupons.ts
// capitalEvents).
function CuponModal({ bono, onClose, onSave, cuotas, onAgregarCuota, onEliminarCuota }: {
  bono: Posicion; onClose: () => void; onSave: (patch: Partial<Posicion>) => Promise<void>;
  cuotas: AmortizacionProgramada[]; onAgregarCuota: (fecha: string, porcentaje: number) => Promise<void>; onEliminarCuota: (id: string) => Promise<void>;
}) {
  useEscapeClose(onClose);
  const [tasa, setTasa] = useState(bono.cupon_tasa != null ? String(+(bono.cupon_tasa * 100).toFixed(4)) : '');
  const [freq, setFreq] = useState(bono.cupon_frecuencia != null ? String(bono.cupon_frecuencia) : '');
  const [mes, setMes] = useState(bono.cupon_mes != null ? String(bono.cupon_mes) : '');
  const [vto, setVto] = useState(bono.vencimiento ?? '');
  const [calificadora, setCalificadora] = useState(bono.calificadora ?? '');
  const [calificacion, setCalificacion] = useState(bono.calificacion ?? '');
  const [ley, setLey] = useState<'' | 'local' | 'extranjera'>(bono.ley ?? '');
  const [amortizable, setAmortizable] = useState(bono.amortizable);
  const [valorResidualPct, setValorResidualPct] = useState(bono.valor_residual != null ? String(+(bono.valor_residual * 100).toFixed(2)) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const guardar = async () => {
    setErr(null);
    // Mismo rango que el check constraint de la base (>0 y <=100%) — validado acá para no
    // depender de un error crudo de Postgres si alguien tipea 0 (string "0" es truthy en JS, así
    // que sin este chequeo explícito se colaba como si tuviera un valor cargado) o un número fuera
    // de rango.
    let valorResidual: number | null = null;
    if (amortizable && valorResidualPct !== '') {
      const n = Number(valorResidualPct);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
        setErr('El valor residual debe ser mayor a 0% y hasta 100%.');
        return;
      }
      valorResidual = n / 100;
    }
    setBusy(true);
    try {
      await onSave({
        cupon_tasa: tasa ? Number(tasa) / 100 : null,
        cupon_frecuencia: freq ? Number(freq) : null,
        cupon_mes: mes ? Number(mes) : null,
        vencimiento: vto || null,
        calificadora: calificadora || null,
        calificacion: calificacion.trim() || null,
        ley: ley || null,
        amortizable,
        // Si se vuelve a bullet, no arrastramos un valor residual viejo que ya no aplica.
        valor_residual: valorResidual,
      });
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Detalles de ${bono.ticker}`}>
        <Card className="animate-rise">
          <CardHeader title={`Detalles del bono · ${bono.ticker}`} sub="Cupón para el calendario · calificación y ley para los indicadores de crédito y jurisdicción."
            right={<button onClick={onClose} aria-label="Cerrar" className="text-ink-600 hover:text-ink-900 hover:bg-canvas inline-flex items-center justify-center w-9 h-9 rounded-full"><X className="w-4 h-4" /></button>} />
          <div className="p-4 grid grid-cols-2 gap-3 text-sm">
            <Field label="Tasa cupón (% anual)">
              <input type="number" step="0.05" value={tasa} onChange={e => setTasa(e.target.value)} placeholder="ej. 8" className={inputCls} />
            </Field>
            <Field label="Frecuencia">
              <select value={freq} onChange={e => setFreq(e.target.value)} className={`${inputCls} appearance-none`}>
                <option value="">—</option>
                <option value="1">Anual</option><option value="2">Semestral</option><option value="4">Trimestral</option><option value="12">Mensual</option>
              </select>
            </Field>
            <Field label="Mes de un pago">
              <select value={mes} onChange={e => setMes(e.target.value)} className={`${inputCls} appearance-none`}>
                <option value="">—</option>
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
            <Field label="Vencimiento">
              <input type="date" value={vto} onChange={e => setVto(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Calificadora">
              <select value={calificadora} onChange={e => setCalificadora(e.target.value)} className={`${inputCls} appearance-none`}>
                <option value="">—</option>
                {CALIFICADORAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Calificación">
              <input value={calificacion} onChange={e => setCalificacion(e.target.value)} placeholder="ej. BB-, Ba3, AAA(arg)" className={inputCls} />
            </Field>
            <Field label="Ley aplicable" hint="Jurisdicción de cobro (local o extranjera)">
              <select value={ley} onChange={e => setLey(e.target.value as typeof ley)} className={`${inputCls} appearance-none`}>
                <option value="">—</option>
                <option value="local">{LEY_LABEL.local}</option>
                <option value="extranjera">{LEY_LABEL.extranjera}</option>
              </select>
            </Field>
            <Field label="Estructura de repago" hint="Bullet: 100% al vencimiento · Amortizable: capital en cuotas">
              <select value={amortizable ? 'amortizable' : 'bullet'} onChange={e => setAmortizable(e.target.value === 'amortizable')} className={`${inputCls} appearance-none truncate`}>
                <option value="bullet">Bullet</option>
                <option value="amortizable">Amortizable</option>
              </select>
            </Field>
            {amortizable && (
              <Field label="Valor residual actual (%)" className="col-span-2" hint="% del nominal original que queda por cobrar. No se obtiene automático: tomalo de la ficha técnica o de tu bróker.">
                <input type="number" min="1" max="100" step="1" value={valorResidualPct}
                  onChange={e => setValorResidualPct(e.target.value)} placeholder="ej. 75" className={inputCls} />
              </Field>
            )}
          </div>
          <p className="px-4 -mt-1 text-[11px] text-ink-500 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 shrink-0" /> Con el mes de un pago alcanza: los demás se derivan de la frecuencia.
          </p>
          <p className="px-4 pt-1.5 text-[11px] text-ink-500">
            "Amortizable" + valor residual corrige TIR, duración y rendimiento corriente. Con el cronograma de cuotas también corrige la proyección de Cupones.
          </p>
          {amortizable && (
            <CronogramaCuotas cuotas={cuotas} onAgregar={onAgregarCuota} onEliminar={onEliminarCuota}
              valorResidualActual={(() => { const n = Number(valorResidualPct); return valorResidualPct !== '' && n > 0 && n <= 100 ? n / 100 : 1; })()} />
          )}
          <p className="px-4 pt-1.5 text-[11px] text-ink-500">
            FIX SCR y Moody's Local (escala nacional) y S&amp;P/Moody's/Fitch (global) se clasifican solas; no son equivalentes entre sí. "Otra" no se clasifica.
          </p>
          {err && <p className="px-4 pt-2 text-xs text-warn">{err}</p>}
          <div className="px-4 py-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// Cronograma de cuotas de amortización futuras — carga manual (no hay ninguna fuente automática,
// ver 0028_amortizaciones_programadas.sql). Alimenta la proyección de Cupones (couponEvents baja el
// cupón después de cada cuota, capitalEvents las muestra como flujo de capital) — no toca la TIR ni
// la valuación de esta página, que siguen usando solo el valor residual de HOY.
function CronogramaCuotas({ cuotas, onAgregar, onEliminar, valorResidualActual }: {
  cuotas: AmortizacionProgramada[]; onAgregar: (fecha: string, porcentaje: number) => Promise<void>; onEliminar: (id: string) => Promise<void>;
  valorResidualActual: number; // fracción 0..1 — para avisar si el cronograma programa amortizar más de lo que en realidad queda
}) {
  const [fecha, setFecha] = useState('');
  const [pct, setPct] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);
  const [borrarErr, setBorrarErr] = useState<string | null>(null);
  const ordenadas = [...cuotas].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const cubierto = ordenadas.reduce((s, c) => s + c.porcentaje, 0);

  const agregar = async () => {
    setErr(null);
    if (!fecha) { setErr('Elegí una fecha.'); return; }
    if (ordenadas.some(c => c.fecha === fecha)) { setErr('Ya hay una cuota para esa fecha — borrala para corregirla.'); return; }
    const n = Number(pct);
    if (!(n > 0 && n <= 100)) { setErr('El % debe ser mayor a 0 y hasta 100.'); return; }
    setBusy(true);
    try { await onAgregar(fecha, n / 100); setFecha(''); setPct(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo agregar'); }
    finally { setBusy(false); }
  };
  const eliminar = async (id: string) => {
    setBorrandoId(id); setBorrarErr(null);
    try { await onEliminar(id); }
    catch (e) { setBorrarErr(e instanceof Error ? e.message : 'No se pudo borrar'); }
    finally { setBorrandoId(null); }
  };

  return (
    <div className="px-4 pt-2">
      <p className="text-[11px] font-semibold text-ink-600 mb-1.5">Cronograma de cuotas (opcional)</p>
      {ordenadas.length > 0 && (
        <div className="space-y-1 mb-2">
          {ordenadas.map(c => (
            <div key={c.id} className="flex items-center gap-2 text-[12px] bg-canvas rounded-lg px-2.5 py-1.5">
              <span className="text-ink-700 tnum">{c.fecha}</span>
              <span className="text-ink-800 font-semibold tnum ml-auto">{Math.round(c.porcentaje * 100)}%</span>
              <button onClick={() => eliminar(c.id)} disabled={borrandoId === c.id}
                className="text-ink-500 hover:text-neg inline-flex items-center justify-center w-7 h-7 disabled:opacity-50" title="Borrar cuota" aria-label="Borrar cuota">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <p className="text-[10px] text-ink-500">
            Cubierto por el cronograma: {Math.round(cubierto * 100)}%{cubierto > valorResidualActual + 0.0001 ? ` — supera tu valor residual actual (${Math.round(valorResidualActual * 100)}%)` : ''}. El resto ({Math.max(0, Math.round((valorResidualActual - cubierto) * 100))}%) se proyecta al vencimiento.
          </p>
        </div>
      )}
      {borrarErr && <p className="text-[11px] text-warn mb-1.5">{borrarErr}</p>}
      {/* Grilla (no flex-1): fecha y % comparten el ancho a partes iguales y el botón queda a la
          derecha sin que el <input type="date"> nativo empuje/pise al vecino (min-w-0 en los hijos). */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
        <Field label="Fecha">
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputCls} />
        </Field>
        <Field label="% nominal original">
          <input type="number" min="1" max="100" step="1" value={pct} onChange={e => setPct(e.target.value)} placeholder="ej. 25" className={inputCls} />
        </Field>
        <Button variant="ghost" onClick={agregar} disabled={busy} className="shrink-0" aria-label="Agregar cuota"><Plus className="w-4 h-4" /></Button>
      </div>
      {err && <p className="text-[11px] text-warn mt-1">{err}</p>}
    </div>
  );
}
