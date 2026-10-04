import { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones, useQuotes } from '../hooks/usePosiciones';
import { useChartTheme } from '../hooks/usePrefs';
import { useProyeccionInputs, type ProyeccionInputs } from '../hooks/useProyeccionInputs';
import { project } from '../engine/projection';
import { analisisMeta } from '../engine/presupuesto';
import { marketValueUSD, costUSD } from '../lib/valuation';
import { Card, CardHeader, Button, Stat, inputCls, fmtUsd, fmtUsdCompact, fmtPct, fmtPctSigno } from '../components/ui';
import { PresupuestoVsReal } from '../components/PresupuestoVsReal';
import { VsSp500 } from '../components/VsSp500';
import { useRendimientoAnual } from '../hooks/useRendimientoAnual';

// Año en curso real: si se hardcodea, a partir del año siguiente el eje temporal y las edades
// quedan desfasados del calendario.
const anioActual = new Date().getFullYear();

const DEFAULTS: ProyeccionInputs = { aporteAnual: 3000, tasaAnual: 0.08, anios: 40, edadInicial: 35 };

export function ForecastPage() {
  const { active } = usePortfolios();
  const chart = useChartTheme();
  const { data: posiciones = [], isLoading: posLoading } = usePosiciones(active?.id);
  const equity = posiciones.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker);
  const bonds = posiciones.filter(p => p.tipo === 'bono').map(p => p.ticker);
  const arStocks = posiciones.filter(p => p.tipo === 'accion_ar').map(p => p.ticker);
  const { data: quotes = {} } = useQuotes(equity, bonds, arStocks);

  const valorActual = useMemo(
    () => posiciones.reduce((s, p) => s + (marketValueUSD(p, quotes[p.ticker] ?? null) ?? costUSD(p)), 0),
    [posiciones, quotes]);

  // Rendimiento real por año (el de la tarjeta de rendimiento): evidencia para elegir el retorno que se asume acá.
  const { porAnio, hoy } = useRendimientoAnual(active?.id);
  const { data: saved, isLoading: savedLoading, isError: savedError, save: saveInputs, remove: removeInputs, savePresupuesto } = useProyeccionInputs(active?.id);
  const [aporteAnual, setAporteAnual] = useState(DEFAULTS.aporteAnual);
  const [tasaAnual, setTasaAnual] = useState(DEFAULTS.tasaAnual);
  const [anios, setAnios] = useState(DEFAULTS.anios);
  const [edadInicial, setEdadInicial] = useState(DEFAULTS.edadInicial);
  const [saveMsg, setSaveMsg] = useState<{ text: string; err: boolean } | null>(null);

  // Al entrar (o cambiar de portfolio): si hay supuestos guardados para ESTE portfolio, usarlos;
  // si no, los defaults. Solo una vez por portfolio (no pisar lo que el usuario está tipeando).
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (savedLoading || !active || seededFor.current === active.id) return;
    seededFor.current = active.id;
    setSaveMsg(null);
    const i = { ...DEFAULTS, ...saved };   // `saved` puede traer solo el presupuesto (ver useProyeccionInputs)
    setAporteAnual(i.aporteAnual); setTasaAnual(i.tasaAnual); setAnios(i.anios); setEdadInicial(i.edadInicial);
  }, [saved, savedLoading, active]);

  const rows = useMemo(() => project({
    valorInicial: Math.round(valorActual), aporteAnual, tasaAnual, anios, anioBase: anioActual, edadInicial,
  }), [valorActual, aporteAnual, tasaAnual, anios, edadInicial]);

  const fin = rows[rows.length - 1];
  // Meta de capital del portfolio (Configuración) cruzada con los supuestos de pantalla: cuándo se llega y
  // qué tan sensible es al retorno. Mismo cálculo que la tarjeta del Inicio (engine/presupuesto).
  const meta = active?.capital_objetivo ?? null;
  const analisis = useMemo(() => (meta && !posLoading)
    ? analisisMeta({ inicio: new Date().toISOString().slice(0, 7), valorInicial: Math.round(valorActual), aporteAnual, tasaAnual, anios }, meta, valorActual)
    : null, [meta, posLoading, valorActual, aporteAnual, tasaAnual, anios]);
  const chartData = rows.map(r => ({ anio: r.anio, Patrimonio: Math.round(r.valor), Aportado: Math.round(r.aportadoTotal) }));

  const guardar = async () => {
    try { await saveInputs({ aporteAnual, tasaAnual, anios, edadInicial }); setSaveMsg({ text: 'Guardado ✓', err: false }); }
    catch (e) { setSaveMsg({ text: `No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`, err: true }); }
  };
  const restablecer = async () => {
    setAporteAnual(DEFAULTS.aporteAnual); setTasaAnual(DEFAULTS.tasaAnual); setAnios(DEFAULTS.anios); setEdadInicial(DEFAULTS.edadInicial);
    try {
      await removeInputs();
      setSaveMsg({ text: 'Restablecido a los valores por defecto.', err: false });
    } catch (e) {
      // Antes: catch vacío — si el borrado fallaba, el mensaje decía "Restablecido" igual (los campos
      // SÍ volvían al default en pantalla, pero la fila guardada en la base seguía viva; al cambiar
      // de portfolio y volver, los supuestos viejos reaparecían como si el restablecer nunca hubiera
      // pasado). Ahora se avisa que el borrado en sí falló, aunque los campos ya se resetearon local.
      setSaveMsg({ text: `Los campos se restablecieron, pero no se pudo borrar lo guardado: ${e instanceof Error ? e.message : 'error'}`, err: true });
    }
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Forecast · {active.nombre}</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Hoy" value={fmtUsdCompact(valorActual)} hint="patrimonio actual del portfolio" />
        <Stat label={`En ${anios} años`} value={fmtUsdCompact(fin?.valor)} hint={`al ${fmtPct(tasaAnual, 1)} anual`} />
        <Stat label="Aportado total" value={fmtUsdCompact(fin?.aportadoTotal)} />
        <Stat label="Ganancia proyectada" value={fmtUsdCompact(fin?.gananciaAcumulada)} />
      </div>

      <Card>
        <CardHeader title="Supuestos" sub="Interés compuesto + aportes anuales."
          right={<div className="flex items-center gap-1.5">
            <Button variant="ghost" onClick={restablecer}>Restablecer</Button>
            <Button onClick={guardar}>Guardar</Button>
          </div>} />
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Num l="Aporte anual (USD)" v={aporteAnual} step={500} onChange={setAporteAnual} />
          <Num l="Retorno anual (%)" v={+(tasaAnual * 100).toFixed(1)} step={0.5} onChange={v => setTasaAnual(v / 100)} />
          <Num l="Años" v={anios} step={5} onChange={setAnios} />
          <Num l="Edad hoy" v={edadInicial} step={1} onChange={setEdadInicial} />
        </div>
        {/* Conexión con "Rendimiento por año": lo que rindió de verdad al lado del retorno que se asume. Es una referencia,
            no una entrada: pocos años y períodos cortos hacen que extrapolarlo sea engañoso. */}
        {porAnio.some(r => r.rendimiento != null) && (
          <p className="px-4 pb-3 text-[11px] text-ink-600"
            title="Rendimiento por año calendario (Modified Dietz), no anualizado en el año en curso. Con poca historia no se usa como supuesto: es solo una referencia.">
            Rendimiento real: {porAnio.filter(r => r.rendimiento != null).map((r, i) => (
              <span key={r.anio}>{i > 0 && ' · '}{r.anio} <span className="tnum font-semibold">{fmtPctSigno(r.rendimiento, 1)}{r.concentrado && '*'}</span></span>
            ))}
            {' '}— asumís <span className="tnum font-semibold">{fmtPct(tasaAnual, 1)}</span>/año{porAnio.some(r => r.concentrado) && ' (* poco representativo)'}
          </p>
        )}
        {saveMsg && <p className={`px-4 pb-3 text-[11px] ${saveMsg.err ? 'text-neg' : 'text-ink-600'}`}>{saveMsg.text}</p>}
      </Card>

      <PresupuestoVsReal portfolioId={active.id} valorActual={valorActual} cargando={savedLoading || posLoading} error={savedError} rendAnios={porAnio}
        supuestos={{ aporteAnual, tasaAnual, anios, edadInicial }}
        presupuesto={saved?.presupuesto ?? null}
        onFijar={savePresupuesto} onBorrar={() => savePresupuesto(null)} />

      <VsSp500 rendAnios={porAnio} hoy={hoy} />

      <Card>
        <CardHeader title="Crecimiento proyectado" />
        <div className="p-2 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
              <XAxis dataKey="anio" stroke={chart.axis} fontSize={11} />
              {/* Con meta, el eje siempre la incluye (si no, la línea quedaba fuera de escala). */}
              <YAxis stroke={chart.axis} fontSize={11} tickFormatter={v => `US$${(v / 1000).toFixed(0)}k`} width={52}
                domain={meta ? [0, (max: number) => Math.max(max, meta) * 1.05] : undefined} />
              <Tooltip contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, fontSize: 12, color: chart.tooltipText }}
                formatter={(v: number) => fmtUsd(v, 0)} />
              <Legend wrapperStyle={{ fontSize: 11, color: chart.tooltipText }} />
              {meta && <ReferenceLine y={meta} stroke={chart.warn} strokeDasharray="5 4" label={{ value: 'Meta', position: 'insideTopLeft', fill: chart.warn, fontSize: 11 }} />}
              <Line type="monotone" dataKey="Aportado" stroke={chart.line2} strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="Patrimonio" stroke="#4F97D4" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {analisis && (
        <Card>
          <CardHeader title="Objetivo de capital"
            sub={`Meta ${fmtUsdCompact(analisis.objetivo)} · con los supuestos de arriba${analisis.yaAlcanzada ? ' · ya alcanzada ✓' : ''}.`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead className="text-[11px] text-ink-600 border-b border-line">
                <tr><th className="text-left px-4 py-2">Escenario</th><th className="text-right px-3">Retorno</th>
                  <th className="text-right px-3">Llegás a la meta</th><th className="text-right px-4">A {anios} años</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {analisis.sensibilidad.map(e => (
                  <tr key={e.delta} className={e.delta === 0 ? 'bg-canvas' : ''}>
                    <td className="px-4 py-1.5 text-ink-700">{e.delta === 0 ? 'Supuestos' : `${e.delta < 0 ? '−' : '+'}${Math.abs(e.delta * 100).toFixed(0)} pp`}</td>
                    <td className="text-right px-3 tnum text-ink-600">{fmtPct(e.tasa, 1)}</td>
                    <td className={`text-right px-3 tnum font-semibold ${e.dentroDelHorizonte ? 'text-ink-900' : 'text-warn'}`}
                      title={e.dentroDelHorizonte ? undefined : `Fuera del horizonte de ${anios} años`}>
                      {e.llegada.anio != null && e.llegada.meses != null ? `${e.llegada.anio} (año ${Math.ceil(e.llegada.meses / 12)})` : 'no llega'}
                    </td>
                    <td className={`text-right px-4 tnum ${e.valorHorizonte >= analisis.objetivo ? 'text-ink-900' : 'text-warn'}`}>{fmtUsdCompact(e.valorHorizonte)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!analisis.yaAlcanzada && analisis.aporteNecesario != null && (
            <p className="px-4 pt-3 text-[11px] text-ink-700">
              Para llegar en {anios} años a {fmtPct(tasaAnual, 1)}: <span className="tnum font-semibold">{fmtUsd(Math.ceil(analisis.aporteNecesario / 12), 0)}/mes</span> ({fmtUsd(analisis.aporteNecesario, 0)}/año).
              {' '}{analisis.aporteNecesario > aporteAnual
                ? <span className="text-warn">Tus supuestos aportan {fmtUsd(aporteAnual / 12, 0)}/mes: falta {fmtUsd(Math.ceil((analisis.aporteNecesario - aporteAnual) / 12), 0)}/mes.</span>
                : <span className="text-pos">Tus supuestos ya lo cubren.</span>}
            </p>
          )}
          <p className="px-4 py-3 text-[11px] text-ink-600">En ámbar, lo que no cumple la meta dentro del horizonte. ±2 pp muestra qué tan sensible es la fecha al retorno.</p>
        </Card>
      )}

      <Card>
        <CardHeader title="Año a año (cada 5)" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr><th className="text-left px-4 py-2">Año</th><th className="text-right px-3">Edad</th>
                <th className="text-right px-3">Aportado</th><th className="text-right px-4">Patrimonio</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.filter((_, i) => i % 5 === 0 || i === rows.length - 1).map(r => (
                <tr key={r.anio} className="hover:bg-canvas">
                  <td className="px-4 py-1.5 text-ink-700">{r.anio}</td>
                  <td className="text-right px-3 tnum text-ink-600">{r.edad ?? '—'}</td>
                  <td className="text-right px-3 tnum text-ink-600">{fmtUsdCompact(r.aportadoTotal)}</td>
                  <td className="text-right px-4 tnum font-semibold text-accent">{fmtUsdCompact(r.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Num({ l, v, step, onChange }: { l: string; v: number; step: number; onChange: (n: number) => void }) {
  // Draft de texto propio, no controlado directo por `v` — "Retorno anual (%)" pasa por un
  // round-trip (fracción → *100 → toFixed(1)) para mostrarse; sin este draft, escribir "8." hacía
  // Number("8.") === 8, el valor volvía a bajar como "8" y el punto decimal desaparecía en cada
  // tecla, imposibilitando escribir un decimal. Solo se resincroniza desde `v` cuando CAMBIA por una
  // razón externa (Restablecer, cambio de portfolio) — no en cada tecla propia (ver el porqué en el
  // comentario de useEffect).
  const [draft, setDraft] = useState(String(v));
  useEffect(() => { setDraft(String(v)); }, [v]);
  return (
    <label className="block">
      <span className="text-[10px] uppercase text-ink-600">{l}</span>
      <input type="number" step={step} value={draft}
        onChange={e => {
          setDraft(e.target.value);
          // Vacío: no empuja 0 al padre (eso forzaría un re-sync que borra lo que se está por
          // escribir) — el campo queda vacío hasta que se tipee un número real.
          if (e.target.value === '') return;
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className={`${inputCls} mt-1 tnum`} />
    </label>
  );
}
