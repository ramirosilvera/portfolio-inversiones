import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useSnapshots } from '../hooks/useSnapshots';
import { useAportes } from '../hooks/useAportes';
import { useChartTheme } from '../hooks/usePrefs';
import { flujosFirmados } from '../engine/aportes';
import { calcularForecast, sumarMeses, finDeMes, type Presupuesto, type ModoAportes } from '../engine/presupuesto';
import { Card, CardHeader, Button, Stat, Badge, Field, inputCls, fmtUsd, fmtUsdCompact, fmtPct, fmtPctSigno } from './ui';
import { RendimientoLinea, AportesLinea } from './ForecastLineas';

interface Supuestos { aporteAnual: number; tasaAnual: number; anios: number; edadInicial: number }
interface Props {
  portfolioId: string;
  valorActual: number;
  supuestos: Supuestos;
  presupuesto: Presupuesto | null;
  cargando?: boolean;   // supuestos/posiciones todavía cargando: no mostrar la invitación ni cifras con patrimonio 0
  error?: boolean;      // falló la lectura del presupuesto guardado: no ofrecer fijar uno (pisaría el existente)
  onFijar: (p: Presupuesto) => Promise<void>;
  onBorrar: () => Promise<void>;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiqueta = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
// El signo sale del valor REDONDEADO: −0,3 mostraba "−US$0" y +0,4 "+US$0" (hallazgo F8).
const signo = (n: number, dp = 0) => {
  const r = +n.toFixed(dp);
  return r === 0 ? fmtUsd(0, dp) : `${r > 0 ? '+' : '−'}${fmtUsd(Math.abs(r), dp)}`;
};
// Para las tarjetas angostas (2 por fila en móvil): US$1.1K en vez de US$1,120.
const signoK = (n: number) => Math.round(n) === 0 ? fmtUsdCompact(0, { k: true }) : `${n > 0 ? '+' : '−'}${fmtUsdCompact(Math.abs(n), { k: true })}`;
const tono = (n: number | null) => n == null ? 'text-ink-600' : n >= 0 ? 'text-pos' : 'text-neg';

const hoyISO = () => new Date().toISOString().slice(0, 10);

// Presupuesto vs real vs forecast actualizado, mes a mes. Todos los números salen de
// engine/presupuesto.ts (puro y testeado); acá solo se arman los insumos y se muestran.
export function PresupuestoVsReal({ portfolioId, valorActual, supuestos, presupuesto, cargando = false, error = false, onFijar, onBorrar }: Props) {
  const chart = useChartTheme();
  const { data: snaps = [] } = useSnapshots(portfolioId);
  const { data: aportes = [] } = useAportes(portfolioId);
  const [modo, setModo] = useState<ModoAportes>('presupuesto');
  const [editando, setEditando] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const hoy = hoyISO();

  // ── alta del presupuesto ──
  const [mesInicio, setMesInicio] = useState(hoy.slice(0, 7));
  const [valorInicial, setValorInicial] = useState('');
  // Valor sugerido: snapshot al cierre del mes anterior al inicio (o el último anterior); si no hay,
  // el patrimonio actual.
  const sugerido = (ym: string): number => {
    const corte = finDeMes(sumarMeses(ym, -1));
    const previos = snaps.filter(s => s.fecha <= corte);
    return Math.round(previos.length ? previos[previos.length - 1].valor : valorActual);
  };
  // "Rehacer" parte de lo ya fijado (antes volvía al mes actual y perdía el inicio y el valor cargados).
  const abrirForm = () => {
    if (presupuesto) { setMesInicio(presupuesto.inicio); setValorInicial(String(presupuesto.valorInicial)); }
    else { setMesInicio(hoy.slice(0, 7)); setValorInicial(String(sugerido(hoy.slice(0, 7)))); }
    setEditando(true); setMsg(null);
  };

  const fijar = async () => {
    const v = Number(valorInicial);
    if (!/^\d{4}-\d{2}$/.test(mesInicio)) { setMsg({ text: 'Elegí el mes de inicio.', err: true }); return; }
    if (!Number.isFinite(v) || v < 0) { setMsg({ text: 'El valor inicial debe ser un número ≥ 0.', err: true }); return; }
    // Los supuestos de pantalla se congelan tal cual: validarlos acá (retorno ≤ −100% daba NaN en toda la
    // tabla, 0 años no tiene horizonte).
    if (!(supuestos.anios >= 1) || !(supuestos.tasaAnual > -1) || !Number.isFinite(supuestos.aporteAnual) || !Number.isFinite(supuestos.tasaAnual)) {
      setMsg({ text: 'Revisá los supuestos de arriba: años ≥ 1, retorno > −100% y aporte numérico.', err: true }); return;
    }
    setBusy(true); setMsg(null);
    try {
      await onFijar({ inicio: mesInicio, valorInicial: v, ...supuestos, fijadoEn: hoy });
      setEditando(false);
    } catch (e) { setMsg({ text: `No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`, err: true }); }
    finally { setBusy(false); }
  };
  const borrar = async () => {
    if (!window.confirm('¿Borrar el presupuesto fijado? Los supuestos del Forecast no cambian.')) return;
    setBusy(true); setMsg(null);
    try { await onBorrar(); }
    catch (e) { setMsg({ text: `No se pudo borrar: ${e instanceof Error ? e.message : 'error'}`, err: true }); }
    finally { setBusy(false); }
  };

  // ── cálculo ──
  const calc = useMemo(() => {
    if (!presupuesto) return null;
    // El punto de hoy es el patrimonio en vivo (el snapshot del día puede estar desactualizado).
    const puntos = [...snaps.filter(s => s.fecha !== hoy).map(s => ({ fecha: s.fecha, valor: s.valor })), { fecha: hoy, valor: valorActual }];
    return calcularForecast(presupuesto, puntos, flujosFirmados(aportes), hoy, modo);
  }, [presupuesto, snaps, aportes, valorActual, hoy, modo]);

  const supuestosCambiaron = presupuesto && (
    presupuesto.aporteAnual !== supuestos.aporteAnual || presupuesto.tasaAnual !== supuestos.tasaAnual
    || presupuesto.anios !== supuestos.anios || presupuesto.edadInicial !== supuestos.edadInicial);

  if (error) {
    return (
      <Card>
        <CardHeader title="Presupuesto vs real" sub="No se pudo leer el presupuesto guardado. Recargá la página; no fijes uno nuevo hasta entonces (pisaría el existente)." />
      </Card>
    );
  }
  if (cargando && !editando) {
    return (
      <Card>
        <CardHeader title="Presupuesto vs real" sub="Cargando…" />
      </Card>
    );
  }

  // ── sin presupuesto: invitación ──
  if (!presupuesto && !editando) {
    return (
      <Card>
        <CardHeader title="Presupuesto vs real"
          sub="Fijá un presupuesto con los supuestos de arriba y seguí mes a mes cómo vas contra lo previsto."
          right={<Button onClick={abrirForm}>Fijar presupuesto</Button>} />
      </Card>
    );
  }

  // ── alta / rehacer ──
  if (editando) {
    return (
      <Card>
        <CardHeader title="Presupuesto vs real"
          sub="Fijá un presupuesto con los supuestos de arriba y seguí mes a mes cómo vas contra lo previsto." />
        <div className="p-4 grid grid-cols-2 gap-3 text-sm">
          <Field label="Mes de inicio">
            <input type="month" value={mesInicio} max={hoy.slice(0, 7)}
              onChange={e => { setMesInicio(e.target.value); if (/^\d{4}-\d{2}$/.test(e.target.value)) setValorInicial(String(sugerido(e.target.value))); }}
              className={inputCls} />
          </Field>
          <Field label="Valor al cierre del mes anterior (USD)">
            <input type="number" min="0" step="100" value={valorInicial} onChange={e => setValorInicial(e.target.value)} className={inputCls} />
          </Field>
          <p className="col-span-2 text-[11px] text-ink-600">
            Se congelan: aporte {fmtUsd(supuestos.aporteAnual, 0)}/año, retorno {fmtPct(supuestos.tasaAnual, 1)} y {supuestos.anios} años.
            El valor sugerido sale del último snapshot previo al inicio.
          </p>
        </div>
        {msg && <p className={`px-4 pb-2 text-xs ${msg.err ? 'text-neg' : 'text-ink-600'}`}>{msg.text}</p>}
        <div className="px-4 pb-4 flex justify-end gap-2">
          {editando && <Button variant="ghost" onClick={() => { setEditando(false); setMsg(null); }}>Cancelar</Button>}
          <Button onClick={fijar} disabled={busy}>{busy ? 'Guardando…' : 'Fijar presupuesto'}</Button>
        </div>
      </Card>
    );
  }

  if (!presupuesto || !calc) return null;   // (ya cubierto arriba; deja el tipo estrecho)
  const { cruce, repro, ultimo, ppto } = calc;
  const chartData = cruce.map((f, i) => ({
    mes: etiqueta(f.periodo),
    // La línea usa el presupuesto del FIN de cada mes (la tabla, en el mes en curso, muestra el prorrateado a
    // hoy): si no, la curva bajaría en el último punto.
    Presupuesto: Math.round(ppto[i].valor),
    Real: f.valorReal != null ? Math.round(f.valorReal) : null,
    // El forecast se dibuja desde el último dato real (para que la línea "salga" de lo real).
    Forecast: repro && f.k >= repro.ultimoRealK ? Math.round(repro.meses[i].valor) : null,
  }));

  return (
    <Card>
      <CardHeader title="Presupuesto vs real"
        sub={`Desde ${etiqueta(presupuesto.inicio)} · aporte ${fmtUsd(presupuesto.aporteAnual, 0)}/año · retorno ${fmtPct(presupuesto.tasaAnual, 1)} · ${presupuesto.anios} años`}
        right={<div className="flex items-center gap-1.5">
          <Button variant="ghost" onClick={abrirForm} disabled={busy}>Rehacer</Button>
          <Button variant="ghost" onClick={borrar} disabled={busy}>Borrar</Button>
        </div>} />

      {supuestosCambiaron && (
        <p className="px-4 pt-3 text-[11px] text-warn">
          Los supuestos de arriba ya no coinciden con el presupuesto fijado. Este seguimiento usa los fijados; usá "Rehacer" para actualizarlos.
        </p>
      )}
      {msg && <p className={`px-4 pt-3 text-xs ${msg.err ? 'text-neg' : 'text-ink-600'}`}>{msg.text}</p>}

      {!ultimo ? (
        <p className="p-4 text-sm text-ink-600">Todavía no hay datos reales desde {etiqueta(presupuesto.inicio)}: aparecen cuando se registra el primer snapshot.</p>
      ) : (
        <>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Desvío acumulado" value={<span className={tono(ultimo.desvio)}>{signoK(ultimo.desvio!)}</span>}
              hint={`${signo(ultimo.desvio!)} · real − presupuesto al cierre de ${etiqueta(ultimo.periodo)}${ultimo.parcial ? ' (a la fecha)' : ''}`} />
            <Stat label="Por aportes" value={<span className={tono(ultimo.desvioAportes)}>{signoK(ultimo.desvioAportes!)}</span>}
              hint={`${signo(ultimo.desvioAportes!)} · aportes netos reales − presupuestados, acumulado`} />
            <Stat label="Por mercado" value={<span className={tono(ultimo.desvioMercado)}>{signoK(ultimo.desvioMercado!)}</span>}
              hint={`${signo(ultimo.desvioMercado!)} · rendimiento real − presupuestado, acumulado`} />
            <Stat label={`En ${presupuesto.anios} años`} value={fmtUsdCompact(repro?.valorHorizonte, { k: true })}
              hint={repro ? `Forecast actualizado ${fmtUsd(repro.valorHorizonte, 0)} · presupuesto ${fmtUsd(repro.valorHorizontePpto, 0)}` : undefined}
              delta={repro && repro.valorHorizontePpto ? repro.difHorizonte / repro.valorHorizontePpto : undefined} />
          </div>

          {/* Conexión con "Rendimiento por año": mismo % (Modified Dietz) y cumplimiento del aporte comprometido. */}
          <div className="px-4 pb-2 space-y-1">
            <RendimientoLinea resumen={calc} />
            <AportesLinea resumen={calc} />
          </div>
          <div className="px-4 pb-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-600">
            <span>Forecast: los meses que faltan aportan</span>
            <div role="radiogroup" aria-label="Aportes del forecast" className="flex items-center gap-1">
              {([['presupuesto', 'lo presupuestado'], ['ritmo', 'mi ritmo real (mín. el comprometido)']] as const).map(([m, label]) => (
                <button key={m} type="button" role="radio" aria-checked={modo === m} onClick={() => setModo(m)}
                  className={`px-2.5 py-1 rounded-full font-semibold ${modo === m ? 'bg-celeste-500 text-white' : 'bg-canvas text-ink-600'}`}>{label}</button>
              ))}
            </div>
            {repro && <span>({fmtUsd(repro.aporteMensualUsado, 0)}/mes, retorno presupuestado)</span>}
          </div>

          <div className="p-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                <XAxis dataKey="mes" stroke={chart.axis} fontSize={11} />
                <YAxis stroke={chart.axis} fontSize={11} domain={['auto', 'auto']} tickFormatter={v => `US$${(v / 1000).toFixed(0)}k`} width={52} />
                <Tooltip contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, fontSize: 12, color: chart.tooltipText }}
                  formatter={(v: number) => fmtUsd(v, 0)} />
                <Legend wrapperStyle={{ fontSize: 11, color: chart.tooltipText }} />
                <Line isAnimationActive={false} type="monotone" dataKey="Presupuesto" stroke={chart.line2} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="Forecast" stroke={chart.warn} strokeWidth={1.5} strokeDasharray="2 3" dot={false} connectNulls />
                <Line isAnimationActive={false} type="monotone" dataKey="Real" stroke="#4F97D4" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-[11px] text-ink-600 border-b border-line">
                <tr>
                  <th className="text-left px-4 py-2">Mes</th>
                  <th className="text-right px-2">Aporte ppto</th><th className="text-right px-2">Aporte real</th>
                  <th className="text-right px-2">Valor ppto</th><th className="text-right px-2">Valor real</th>
                  <th className="text-right px-2">Desvío</th><th className="text-right px-2">Aportes</th><th className="text-right px-4">Mercado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {cruce.map(f => (
                  <tr key={f.periodo} className="hover:bg-canvas">
                    <td className="px-4 py-1.5 text-ink-700 whitespace-nowrap">
                      {etiqueta(f.periodo)}{f.parcial && <Badge tone="gray">a la fecha</Badge>}
                    </td>
                    <td className="text-right px-2 tnum text-ink-600">{fmtUsd(f.aportePpto, 0)}</td>
                    <td className="text-right px-2 tnum text-ink-600">{f.aporteReal != null ? fmtUsd(f.aporteReal, 0) : '—'}</td>
                    <td className="text-right px-2 tnum text-ink-600">{fmtUsd(f.valorPpto, 0)}</td>
                    <td className="text-right px-2 tnum text-ink-900" title={f.valorEstimado ? 'Sin snapshot en el mes: último valor conocido' : undefined}>
                      {f.valorReal != null ? `${fmtUsd(f.valorReal, 0)}${f.valorEstimado ? '*' : ''}` : '—'}
                    </td>
                    <td className={`text-right px-2 tnum font-semibold ${tono(f.desvio)}`}>
                      {f.desvio != null ? `${signo(f.desvio)} (${fmtPctSigno(f.desvioPct, 1)})` : '—'}
                    </td>
                    <td className={`text-right px-2 tnum ${tono(f.desvioAportes)}`}>{f.desvioAportes != null ? signo(f.desvioAportes) : '—'}</td>
                    <td className={`text-right px-4 tnum ${tono(f.desvioMercado)}`}>{f.desvioMercado != null ? signo(f.desvioMercado) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-[11px] text-ink-600">
            Desvío = aportes + mercado (acumulados). Los aportes mensuales presupuestados rinden dentro del año, por eso el mes 12 queda apenas por encima del año 1 de la tabla de abajo.
            {cruce.some(f => f.valorEstimado) && ' * Sin snapshot ese mes: se usa el último conocido.'}
          </p>
        </>
      )}
    </Card>
  );
}
