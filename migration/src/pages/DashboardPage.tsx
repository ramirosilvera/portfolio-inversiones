import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Flame, LayoutGrid, Plus, Check } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { usePortfolios } from '../hooks/usePortfolios';
import { useMacro, useDrawdowns } from '../hooks/usePosiciones';
import { useRendimientoAnual } from '../hooks/useRendimientoAnual';
import { useFlujo } from '../hooks/useFlujo';
import { useCobros } from '../hooks/useCobros';
import { useAmortizaciones } from '../hooks/useAmortizaciones';
import { useBrokers } from '../hooks/useBrokers';
import { usePosicionBrokers } from '../hooks/usePosicionBrokers';
import { useEstadoCuenta, useAdminUsers } from '../hooks/useAdmin';
import { useWatchlist } from '../hooks/useWatchlist';
import { useCikMap } from '../hooks/useCikMap';
import { useDcfInputs, type StoredDcf } from '../hooks/useDcfInputs';
import { useRadarTicker } from '../hooks/useRadarTicker';
import { useBonosCalc, useObjetivoDuracion, resumenBonos, alertasBonos } from '../hooks/useBonos';
import { useCedearsCalc, resumenCedears, useObjetivoConcentracion, alertasCedears } from '../hooks/useCedears';
import { CONCENTRACION_POSICION_ALERTA, HHI_SECTOR_ALERTA } from '../engine/cedears';
import { categoriaDe, pctRentaFija, alertasDistribucion, CATEGORIA_LABEL, CATEGORIA_COLOR, type CategoriaPatrimonio } from '../engine/distribucion';
import { useChartTheme } from '../hooks/usePrefs';
import { SEMAFOROS, resumenMacro, type Lectura, type ResumenMacro } from '../engine/semaforos';
import { resumenFlujo } from '../engine/flujo';
import { resumenCobros } from '../engine/cobros';
import { resumenAportes } from '../engine/aportes';
import { capitalCalendar, agruparCuotasPorPosicion, type CapitalBond, type CapitalMonthBucket } from '../engine/coupons';
import { redondearPct, TOLERANCIA_OBJETIVO } from '../engine/rebalance';
import { resumenPorBroker } from '../engine/brokers';
import { portfolioTir } from '../engine/irr';
import { useRecordSnapshot } from '../hooks/useSnapshots';
import { useDashboardLayout } from '../hooks/useDashboardLayout';
import { Card, CardHeader, Stat, Badge, Field, AlertasBanner, inputCls, fmtUsd, fmtUsdCompact, fmtNum, fmtPct, fmtArs, fmtArsCompact, colorDeBroker } from '../components/ui';
import { WidgetGrid } from '../components/dashboard/WidgetGrid';
import { AddWidgetModal } from '../components/dashboard/AddWidgetModal';
import type { MetricContext } from '../components/dashboard/metrics';
import { UpdatedAt } from '../components/UpdatedAt';
import { DistanciaMaximo } from '../components/DistanciaMaximo';
import { unitValueUSD as unitUSD } from '../lib/valuation';
import type { Posicion, AssetType, SeccionKey, DashboardWidget, Aporte } from '../types/domain';

export function DashboardPage() {
  const { active } = usePortfolios();
  // Patrimonio/costo/alloc + rendimiento por año calendario — un solo hook compartido con
  // AportesPage (que muestra el detalle completo), así los dos lugares NUNCA calculan estos números
  // distinto. Ver hooks/useRendimientoAnual.ts.
  const {
    qPos, qAportes, qSnaps,
    posiciones, quotes, aportes, snaps,
    sinPrecio, valuacionDeMercado,
    patrimonio, costo, pnl, alloc,
    hoy, anioActual, inceptionYear, aportadoNeto, porAnio, hayDatos,
  } = useRendimientoAnual(active?.id);
  const { data: macro = {} } = useMacro();
  const { data: flujo = [] } = useFlujo();
  const { data: cobros = [] } = useCobros(active?.id);
  const resumenCobrado = useMemo(() => resumenCobros(cobros), [cobros]);
  // Próximo capital (amortización/rescate) proyectado — separado de resumenCobrado (que es SOLO plata
  // ya cobrada) a propósito. Se calcula acá (no dentro de CobrosResumen) para poder mostrar la tarjeta
  // aunque todavía no haya ningún cobro registrado (portfolio nuevo con un bono por vencer pronto).
  const { data: amortizaciones = [] } = useAmortizaciones();
  const cuotasPorPosicion = useMemo(() => agruparCuotasPorPosicion(amortizaciones), [amortizaciones]);
  const hoyCapital = new Date();
  const hoyCapitalISO = hoyCapital.toISOString().slice(0, 10);
  const proximoCapital = useMemo<CapitalMonthBucket | null>(() => {
    const capitalBonds: CapitalBond[] = posiciones.filter(p => p.tipo === 'bono').map(p => ({
      ticker: p.ticker, faceValue: p.cantidad, vencimiento: p.vencimiento,
      valorResidual: p.amortizable && p.valor_residual != null ? p.valor_residual : 1,
      // Cuotas de ESTE mes ya cobradas y registradas (valor_residual ya las descontó) siguen en la
      // tabla hasta que el usuario las borre — capitalEvents() solo filtra por mes, no por día, así
      // que acá filtramos por fecha exacta para no mostrar como "próximo" algo que ya se cobró hoy.
      amortizaciones: (cuotasPorPosicion.get(p.id) ?? []).filter(c => c.fecha >= hoyCapitalISO),
    }));
    if (capitalBonds.length === 0) return null;
    return capitalCalendar(capitalBonds, hoyCapital.getFullYear(), hoyCapital.getMonth() + 1, 12).find(m => m.total > 0) ?? null;
  }, [posiciones, cuotasPorPosicion, hoyCapitalISO, hoyCapital.getFullYear(), hoyCapital.getMonth()]);
  // Sugeridos por el cron, sin confirmar todavía — resumenCobros los excluye a propósito de los
  // totales (no son plata confirmada), así que se cuentan aparte solo para avisar que hay algo
  // esperando revisión en /cupones.
  const pendientesCount = useMemo(() => cobros.filter(c => c.estado === 'pendiente').length, [cobros]);

  // TIR money-weighted: aportes (capital externo) + patrimonio actual como flujo terminal. Reusa el
  // `hoy` del hook (antes se calculaba una segunda vez acá con el mismo `new Date()` — un solo
  // string de fecha por render, no dos).
  const tir = useMemo(() => portfolioTir({
    aportes: aportes.map(a => ({ monto: a.monto, fecha: a.fecha, retiro: a.tipo === 'retiro' })),
    costos: posiciones.filter(p => p.cantidad > 0).map(p => ({ costo: p.precio_compra * p.cantidad, fecha: p.fecha_compra })),
    valorActual: patrimonio,
    hoy,
  }), [aportes, posiciones, patrimonio, hoy]);

  const semaforos: Lectura[] = SEMAFOROS.map(s => {
    const v = (macro as Record<string, number | null>)[s.key];
    return { def: s, valor: v ?? null, luz: v != null ? s.evalua(v) : null };
  });
  const resumen = resumenMacro(semaforos);

  const mep = (macro as Record<string, number | null>).dolar_mep ?? (macro as Record<string, number | null>).dolar_ccl ?? null;
  const flujoR = resumenFlujo(flujo, mep);
  const objetivo = active?.capital_objetivo ?? null;
  const rendActual = porAnio.find(r => r.anio === anioActual)?.rendimiento ?? null;
  // Una sola instancia — AlertasResumen (el cartel de arriba) y Distribucion (el campo editable) la
  // necesitan las DOS, y cada una tenía su propia copia de este hook (mismo localStorage, pero
  // useState separado): cambiar el objetivo en Distribucion no actualizaba el cartel de alertas hasta
  // un remount completo. Instanciado acá y pasado por props, quedan sincronizadas siempre.
  const objetivoDistribucion = useObjetivoDistribucion(active?.id);

  const record = useRecordSnapshot();
  const recordedRef = useRef('');

  // El snapshot solo es fiable cuando TODO resolvió: si se graba antes de que lleguen las
  // cotizaciones, el patrimonio cae a costo; y si se graba antes que los aportes, `aportadoNeto`
  // usa el fallback de costo. Cualquiera de las dos cosas ensucia el histórico de rendimiento.
  const datosListos = qPos.isSuccess && qAportes.isSuccess && qSnaps.isSuccess && valuacionDeMercado;

  // Registra el snapshot de hoy (idempotente por día). El lock incluye el valor grabado, así que si
  // el patrimonio se corrige (llegan cotizaciones frescas) el snapshot del día se actualiza en vez
  // de quedar clavado en un valor provisorio. Este efecto (a diferencia del resto del cálculo de
  // rendimiento por año) se queda acá y NO se mueve al hook compartido: es un side-effect de esta
  // página, no un cálculo — no tendría sentido grabar el snapshot del día solo porque el usuario
  // entró directo a /aportes sin pasar por el Dashboard.
  useEffect(() => {
    if (!active?.id || !datosListos || !(patrimonio > 0)) return;
    const key = `${active.id}:${hoy}:${Math.round(patrimonio)}:${Math.round(aportadoNeto)}`;
    if (recordedRef.current === key) return;
    const hoySnap = snaps.find(s => s.fecha === hoy);
    const cambió = !hoySnap
      || Math.abs(hoySnap.valor - patrimonio) / Math.max(1, patrimonio) > 0.005
      || Math.abs(hoySnap.aportado - aportadoNeto) > 0.01;
    if (cambió) {
      recordedRef.current = key;
      void record(active.id, hoy, patrimonio, aportadoNeto).catch(() => { recordedRef.current = ''; });
    }
  }, [active?.id, datosListos, patrimonio, aportadoNeto, snaps, hoy, record]);

  // ── Dashboard personalizable: agregar/quitar/reordenar tarjetas ───────────────
  const { widgets: layout, agregar, agregarSeccion, actualizar, eliminar, mover, restaurarDefault } = useDashboardLayout();
  const [personalizando, setPersonalizando] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [editando, setEditando] = useState<Extract<DashboardWidget, { kind: 'metrica' }> | null>(null);
  const [layoutErr, setLayoutErr] = useState<string | null>(null);
  // mover/eliminar no tienen feedback propio (a diferencia del modal, que maneja su error inline) —
  // sin este catch, un fallo de red dejaba el click sin ningún efecto visible ni explicación.
  const conFeedback = (accion: () => Promise<void>) => {
    setLayoutErr(null);
    accion().catch(e => setLayoutErr(e instanceof Error ? e.message : 'No se pudo guardar el cambio.'));
  };

  // Contexto compartido para las tarjetas atómicas de "Cartera" (distribución) — mismo alloc/
  // patrimonio que ya usan el Hero y la sección Distribución, nunca recalculado distinto.
  const metricCtx: MetricContext = useMemo(() => ({ alloc, patrimonio, isLoading: qPos.isLoading }), [alloc, patrimonio, qPos.isLoading]);

  // Elementos YA armados (no ejecutan sus hooks hasta que React los monte de verdad — JSX es
  // perezoso) — una sección que el usuario sacó del layout simplemente nunca corre sus queries.
  const seccionNodes: Partial<Record<SeccionKey, ReactNode>> = {
    objetivo_capital: <ObjetivoCapitalCard objetivo={objetivo} patrimonio={patrimonio} />,
    // Rendimiento por año + Aportes unificados en una sola tarjeta (antes 2 separadas) — el usuario
    // elige qué mostrar (selector en el header, persistido por portfolio); por default solo
    // Rendimiento, para no duplicar de entrada lo que ya se ve completo en /aportes.
    rendimiento_por_anio: <CapitalResumen porAnio={porAnio} anioActual={anioActual} hayDatosRendimiento={hayDatos} aportes={aportes} personalizando={personalizando} />,
    distribucion: <Distribucion alloc={alloc} total={patrimonio} isLoading={qPos.isLoading}
      objetivoFijaPct={objetivoDistribucion.objetivoPct} toleranciaDistribucionPct={objetivoDistribucion.toleranciaPct}
      setObjetivoFijaPct={objetivoDistribucion.setObjetivoPct} setToleranciaDistribucionPct={objetivoDistribucion.setToleranciaPct} />,
    cedears: <CedearsResumen personalizando={personalizando} />,
    bonos: <BonosResumen personalizando={personalizando} />,
    radar: <RadarResumen personalizando={personalizando} />,
    patrimonio_broker: <PatrimonioBrokers posiciones={posiciones} quotes={quotes} isLoading={qPos.isLoading} />,
    cobros: (cobros.length > 0 || proximoCapital) ? <CobrosResumen resumen={resumenCobrado} pendientesCount={pendientesCount} proximoCapital={proximoCapital} /> : null,
    liquidez_fci: flujo.length > 0 ? <LiquidezFci resumen={flujoR} mep={mep} /> : null,
    macro: <MacroResumen resumen={resumen} />,
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold text-ink-900 font-display">Dashboard · {active.nombre}</h1>
        <UpdatedAt icon />
      </div>

      {sinPrecio.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-warn/10 ring-1 ring-inset ring-warn/25 px-3 py-2.5 text-[11px] text-ink-700">
          <AlertTriangle className="w-4 h-4 shrink-0 text-warn mt-0.5" />
          <p>
            Sin cotización de <b>{sinPrecio.slice(0, 4).join(', ')}{sinPrecio.length > 4 ? ` +${sinPrecio.length - 4}` : ''}</b>:
            esas posiciones se muestran <b>a costo</b>, así que el patrimonio y el P&L no reflejan el mercado.
            No se registra el histórico del día hasta que vuelvan los precios.
          </p>
        </div>
      )}

      <AlertasResumen alloc={alloc} patrimonio={patrimonio}
        objetivoFijaPct={objetivoDistribucion.objetivoPct} toleranciaDistribucionPct={objetivoDistribucion.toleranciaPct} />

      {/* Hero: lo esencial, sin repetir. Patrimonio con más peso visual — es el número más
          decisivo de la página — el resto queda como Stat normal debajo. */}
      <div className="space-y-2">
        <div className="rounded-2xl border border-line bg-surface shadow-soft px-5 py-4" title={`costo ${fmtUsdCompact(costo)}`}>
          <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold">Patrimonio</p>
          <p className="text-3xl font-bold text-ink-900 tnum mt-1 font-display">{fmtUsdCompact(patrimonio)}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="P&L" value={<span className={pnl >= 0 ? 'text-pos' : 'text-neg'}>{fmtUsdCompact(pnl)}</span>} delta={costo > 0 ? pnl / costo : undefined} />
          <Stat label="Rend. total"
            value={<span className={tir.historica == null ? '' : tir.historica >= 0 ? 'text-pos' : 'text-neg'}>{tir.historica != null ? fmtPct(tir.historica) : '—'}</span>}
            hint={`rendimiento acumulado desde la creación${tir.aproximada ? ' (aprox., sin aportes cargados)' : ''}`} />
          <Stat label={`Rend. ${anioActual}`}
            value={<span className={rendActual == null ? '' : rendActual >= 0 ? 'text-pos' : 'text-neg'}>{rendActual != null ? fmtPct(rendActual) : '—'}</span>}
            hint={`rendimiento del año en curso${inceptionYear === anioActual ? ' (nació este año)' : ''}`} />
        </div>
      </div>

      {/* Cuerpo personalizable: agregar/quitar/reordenar tarjetas — ver components/dashboard/. El
          Hero y las Alertas de arriba quedan siempre fijos (identidad de la página / seguridad, no
          contenido opcional); Administración queda fija abajo (gateada por rol, no es una preferencia). */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-ink-700 font-display">Tus tarjetas</h2>
        <div className="flex items-center gap-2">
          {personalizando && (
            <>
              <button onClick={() => setAgregando(true)}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-celeste-600 hover:underline">
                <Plus className="w-3.5 h-3.5" /> Agregar tarjeta
              </button>
              <RestaurarDefault onRestaurar={() => conFeedback(restaurarDefault)} />
            </>
          )}
          <button onClick={() => setPersonalizando(p => !p)}
            className={`inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-3 py-1.5 border ${personalizando ? 'bg-celeste-500 text-white border-celeste-500' : 'border-line bg-surface text-ink-700 hover:bg-canvas'}`}>
            {personalizando ? <Check className="w-3.5 h-3.5" /> : <LayoutGrid className="w-3.5 h-3.5" />}
            {personalizando ? 'Listo' : 'Personalizar'}
          </button>
        </div>
      </div>

      {layoutErr && <p className="text-[11px] text-neg">{layoutErr}</p>}

      <WidgetGrid layout={layout} seccionNodes={seccionNodes} ctx={metricCtx} personalizando={personalizando}
        onMover={(id, dir) => conFeedback(() => mover(id, dir))}
        onEliminar={id => conFeedback(() => eliminar(id))}
        onEditar={w => setEditando(w)} />

      {(agregando || editando) && (
        <AddWidgetModal key={editando?.id ?? 'nuevo'} layout={layout} editing={editando}
          onClose={() => { setAgregando(false); setEditando(null); }}
          onAgregarMetrica={(metricas, viz, titulo) => agregar({ kind: 'metrica', metricas, viz, titulo })}
          onAgregarSeccion={agregarSeccion}
          onActualizarMetrica={(id, metricas, viz, titulo) => actualizar(id, { metricas, viz, titulo })} />
      )}

      <AdminResumen />
    </div>
  );
}

// Alertas consolidadas de CEDEARs + Bonos, arriba de todo — así lo que necesita atención se ve
// apenas se entra al Dashboard, sin tener que visitar /cedears y /bonos por separado. Misma fuente
// (alertasCedears/alertasBonos + los hooks que ya usan CedearsResumen/BonosResumen) así la lista acá
// es EXACTAMENTE la misma que la de cada página — nunca "en el Dashboard no avisa pero en la sección sí".
function AlertasResumen({ alloc, patrimonio, objetivoFijaPct, toleranciaDistribucionPct }: {
  alloc: { mkt: number; tipo: AssetType }[]; patrimonio: number; objetivoFijaPct: number; toleranciaDistribucionPct: number;
}) {
  const { active } = usePortfolios();
  const { cedearsCalc, isLoading: cedearsLoading } = useCedearsCalc(active?.id);
  const { bonosCalc, isLoading: bonosLoading } = useBonosCalc(active?.id);
  const { minGradoInversionPct, maxDuracionAnios } = useObjetivoDuracion(active?.id);
  const { sectorPct: concentracionSectorPct, estiloPct: concentracionEstiloPct } = useObjetivoConcentracion(active?.id);
  // Mismo risk-free que BonosPage (tasa a 10 años UST) — sin esto, spreadPromedio siempre da null
  // acá y la alerta de "spread negativo" nunca podría aparecer en el Dashboard aunque sí en /bonos.
  const { data: macro = {} } = useMacro();
  const riskFree = (macro as Record<string, number | null>).dgs10 != null ? (macro as Record<string, number | null>).dgs10! / 100 : null;

  if (cedearsLoading || bonosLoading) return null;

  const alertas = [
    ...alertasCedears(resumenCedears(cedearsCalc), concentracionSectorPct, concentracionEstiloPct),
    ...alertasBonos(resumenBonos(bonosCalc, riskFree), minGradoInversionPct, maxDuracionAnios),
    ...alertasDistribucion(pctRentaFija(alloc, patrimonio), objetivoFijaPct, toleranciaDistribucionPct),
  ];
  if (alertas.length === 0) return null;

  return <AlertasBanner alertas={alertas} />;
}

// Progreso hacia el objetivo de capital del portfolio — extraído para poder agregarse/quitarse como
// cualquier otra sección del Dashboard personalizable (ver seccionNodes en DashboardPage). Mismo
// criterio que el resto de las secciones: se auto-oculta (null) cuando no aplica, en vez de
// necesitar un `if` externo antes de renderizarse.
function ObjetivoCapitalCard({ objetivo, patrimonio }: { objetivo: number | null; patrimonio: number }) {
  if (objetivo == null || objetivo <= 0) return null;
  return (
    <Card>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="font-semibold text-ink-800">Objetivo de capital</span>
          <span className="tnum text-ink-600">{fmtUsdCompact(patrimonio)} / {fmtUsdCompact(objetivo)}</span>
        </div>
        <div className="h-2.5 rounded-full bg-canvas overflow-hidden">
          <div className="h-full rounded-full bg-celeste-500" style={{ width: `${Math.min(100, (patrimonio / objetivo) * 100)}%` }} />
        </div>
        <p className="text-[11px] text-ink-600 mt-1.5 tnum">
          {fmtPct(patrimonio / objetivo, 0)} alcanzado
          {patrimonio < objetivo && <> · faltan {fmtUsdCompact(objetivo - patrimonio)}</>}
        </p>
      </div>
    </Card>
  );
}

// Rendimiento por año calendario Y/O Aportes — dos vistas del mismo concepto de capital ("cómo
// rindió" vs. "cuánto metí"), fusionadas en una sola tarjeta con un selector de modo en vez de 2
// tarjetas separadas. El rendimiento muestra solo los últimos N años (más años acumulándose año a
// año, sin límite, hacía que esta tarjeta creciera indefinidamente en el inicio) — el detalle
// completo de las dos vistas (historial de movimientos, tabla ordenable/filtrable de rendimiento)
// vive en /aportes, con los MISMOS `porAnio`/`aportes` (mismo hook, nunca recalculados acá).
const ANIOS_VISIBLES_DASHBOARD = 5;
type ModoCapital = 'rendimiento' | 'aportes' | 'ambos';
const MODO_CAPITAL_LABEL: Record<ModoCapital, string> = { rendimiento: 'Rendimiento', aportes: 'Aportes', ambos: 'Ambos' };

// Qué mostrar en la tarjeta — preferencia de VISTA, no de layout: vive en localStorage por
// portfolio (mismo patrón que useObjetivoDistribucion más abajo), no en dashboard_layout. No es
// "agregar/quitar una tarjeta" (eso ya lo cubre el Dashboard personalizable) — es una preferencia
// de cómo se ve ESTA tarjeta puntual, así que no tiene sentido que viaje con el resto del layout ni
// que "Restaurar predeterminado" la toque.
function leerModoCapital(key: string | null): ModoCapital {
  try {
    const raw = key ? localStorage.getItem(key) : null;
    if (raw === 'rendimiento' || raw === 'aportes' || raw === 'ambos') return raw;
  } catch { /* */ }
  return 'rendimiento';
}

function useModoCapital(portfolioId: string | undefined) {
  const key = portfolioId ? `dashboard.modoCapital.${portfolioId}` : null;
  // Inicializador lazy (no useEffect-only) — con solo useEffect, el primer render SIEMPRE arrancaba
  // en 'rendimiento' así el usuario tuviera 'aportes' guardado, y un instante después saltaba al
  // modo real: un parpadeo visible cada vez que se entra al Dashboard.
  const [modo, setModoState] = useState<ModoCapital>(() => leerModoCapital(key));
  useEffect(() => { setModoState(leerModoCapital(key)); }, [key]);
  const setModo = (m: ModoCapital) => {
    setModoState(m);
    if (key) { try { localStorage.setItem(key, m); } catch { /* */ } }
  };
  return { modo, setModo };
}

function CapitalResumen({ porAnio, anioActual, hayDatosRendimiento, aportes, personalizando }: {
  porAnio: { anio: number; rendimiento: number | null }[]; anioActual: number; hayDatosRendimiento: boolean;
  aportes: Aporte[]; personalizando: boolean;
}) {
  const { active } = usePortfolios();
  const { modo, setModo } = useModoCapital(active?.id);
  const hayAportes = aportes.length > 0;
  // Antes esto era `modo === 'aportes' ? hayAportes : hayDatosRendimiento` — un portfolio con
  // posiciones pero SIN aportes cargados, en modo "Aportes", hacía `visible=false` y la tarjeta
  // desaparecía por completo apenas se clickeaba ese modo — sin forma de volver atrás, porque el
  // selector vive DENTRO de la tarjeta que acaba de esconderse. Ahora se muestra si hay CUALQUIER
  // motivo (rendimiento o aportes), y cada bloque interno decide por su cuenta si tiene algo real
  // que mostrar o un estado vacío explicado.
  const visible = hayDatosRendimiento || hayAportes;
  if (!visible) return null;

  const ordenado = [...porAnio].reverse(); // más reciente primero
  const visiblesAnio = ordenado.slice(0, ANIOS_VISIBLES_DASHBOARD);
  const restantes = ordenado.length - visiblesAnio.length;
  const { aportado, retirado, neto } = resumenAportes(aportes);
  const titulo = modo === 'rendimiento' ? 'Rendimiento por año' : modo === 'aportes' ? 'Aportes' : 'Rendimiento y aportes';
  const href = modo === 'aportes' ? '/aportes' : '/aportes#rendimiento-anual';
  const movimientos = `${aportes.length} movimiento${aportes.length > 1 ? 's' : ''} de capital — lo que mueve la TIR, no el rendimiento de mercado.`;
  const sub = modo === 'aportes' ? movimientos
    : modo === 'rendimiento' ? 'Cuánto rindió cada año calendario (del pasado, no anualizado).'
    : `Cuánto rindió cada año calendario, y ${movimientos.charAt(0).toLowerCase()}${movimientos.slice(1)}`;

  return (
    <Card>
      <CardHeader title={titulo} sub={sub}
        right={!personalizando && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div role="radiogroup" aria-label="Qué mostrar" className="inline-flex rounded-full border border-line divide-x divide-line overflow-hidden text-[11px] font-semibold">
              {(['rendimiento', 'aportes', 'ambos'] as const).map(m => (
                <button key={m} type="button" onClick={() => setModo(m)} role="radio" aria-checked={modo === m}
                  className={`px-3 py-1.5 transition-colors ${modo === m ? 'bg-celeste-700 text-white' : 'bg-surface text-ink-600 hover:bg-canvas'}`}>
                  {MODO_CAPITAL_LABEL[m]}
                </button>
              ))}
            </div>
            <Link to={href} className="text-[11px] text-celeste-600 hover:underline">
              {/* Antes solo en modo 'rendimiento' — en 'ambos' también se truncan los últimos N años,
                  así que ocultar el conteo ahí hacía parecer que esos 5 chips eran el historial completo. */}
              {modo !== 'aportes' && restantes > 0 ? `Ver ${restantes} año${restantes > 1 ? 's' : ''} más →` : 'Ver detalle →'}
            </Link>
          </div>
        )} />

      {(modo === 'rendimiento' || modo === 'ambos') && (
        <div className={modo === 'ambos' ? 'border-b border-line' : ''}>
          {modo === 'ambos' && (
            <p className="px-4 pt-3 text-[10px] uppercase tracking-wide text-ink-600 font-semibold">Rendimiento por año</p>
          )}
          <div className="p-3 flex flex-wrap gap-2">
            {visiblesAnio.map(({ anio, rendimiento }) => (
              <div key={anio} className="rounded-xl bg-canvas ring-1 ring-inset ring-line px-3 py-2 min-w-[88px]">
                <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold">{anio}{anio === anioActual ? ' · en curso' : ''}</p>
                <p className={`text-lg font-bold tnum mt-0.5 ${rendimiento == null ? 'text-ink-600' : rendimiento >= 0 ? 'text-pos' : 'text-neg'}`}>
                  {rendimiento != null ? fmtPct(rendimiento) : '—'}
                </p>
              </div>
            ))}
          </div>
          {/* Evaluado sobre TODOS los años (no solo los visibles) — los "—" se concentran justo en
              los años más viejos, que son los que este texto explica; si se evaluara sobre
              `visiblesAnio` desaparecería la explicación exactamente cuando hace falta. */}
          {porAnio.some(r => r.rendimiento == null) && (
            <p className="px-4 pb-3 text-[11px] text-ink-500">Los años en "—" se completan a medida que la app registra el valor diario; el histórico previo a esta función no se puede reconstruir.</p>
          )}
        </div>
      )}

      {(modo === 'aportes' || modo === 'ambos') && (
        hayAportes ? (
          <div>
            {modo === 'ambos' && (
              <p className="px-4 pt-3 text-[10px] uppercase tracking-wide text-ink-600 font-semibold">Aportes — desde el inicio</p>
            )}
            <div className="grid grid-cols-3 gap-2 p-3">
              <Stat label="Aportado" value={fmtUsdCompact(aportado)} hint="Suma de todos los aportes (inicial + recurrente + adelanto)" />
              <Stat label="Retirado" value={fmtUsdCompact(retirado)} hint="Suma de todos los retiros de capital" />
              {/* Sin color pos/neg: acá no significa ganancia/pérdida (ese semáforo lo usa el resto
                  de la app para P&L) — "positivo" solo dice que aportaste más de lo que retiraste. */}
              <Stat label="Neto aportado" value={fmtUsdCompact(neto)} />
            </div>
            {/* Visible, no solo tooltip — al lado de un % de rendimiento real (modo "Ambos"), un
                hover-only "no es rendimiento" no alcanza para evitar la confusión. */}
            <p className="px-4 pb-3 text-[11px] text-ink-500">Aportado − retirado — no es rendimiento.</p>
          </div>
        ) : (
          <p className="px-4 pb-3 pt-3 text-[11px] text-ink-500">Sin aportes registrados todavía.</p>
        )
      )}
    </Card>
  );
}

// Botón "Restaurar predeterminado" del modo Personalizar — confirmación en 2 clicks in-place (no
// window.confirm nativo, para mantener el mismo look del resto de la app) porque reemplaza TODO el
// layout guardado del usuario, a diferencia de mover/eliminar 1 tarjeta.
function RestaurarDefault({ onRestaurar }: { onRestaurar: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  if (confirmando) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px]">
        <span className="text-ink-600">¿Restaurar todo?</span>
        <button onClick={() => { onRestaurar(); setConfirmando(false); }} className="font-semibold text-neg hover:underline">Sí, restaurar</button>
        <button onClick={() => setConfirmando(false)} className="text-ink-500 hover:underline">Cancelar</button>
      </span>
    );
  }
  return (
    <button onClick={() => setConfirmando(true)} className="text-[11px] font-semibold text-ink-500 hover:text-ink-700 hover:underline">
      Restaurar predeterminado
    </button>
  );
}

// Resumen de CEDEARs: capital, concentración (mayor posición + HHI sectorial) y diversificación
// (sectores distintos). Mismo cálculo que CedearsPage (useCedearsCalc + resumenCedears
// compartidos) así los dos lugares nunca muestran números distintos.
function CedearsResumen({ personalizando }: { personalizando: boolean }) {
  const { active } = usePortfolios();
  const { cedears, cedearsCalc, isLoading } = useCedearsCalc(active?.id);
  const { sectorPct: concentracionSectorPct } = useObjetivoConcentracion(active?.id);

  // "Cargando…" explícito, no null — con null, WidgetGrid no puede distinguir "todavía no sabemos"
  // de "genuinamente sin CEDEARs" y muestra el placeholder de "sin datos" en modo Personalizar
  // apenas se entra a la página, aunque la consulta todavía esté en vuelo.
  if (isLoading) return <Card><CardHeader title="CEDEARs" /><p className="p-4 text-sm text-ink-600">Cargando…</p></Card>;
  if (cedears.length === 0) return null;

  const { totalMkt, mayorPosicion, nSectores, hhiSector, porSector } = resumenCedears(cedearsCalc);
  const mayorSector = porSector.length > 0 ? porSector[0] : null;
  const right = mayorSector
    ? <Badge tone={mayorSector.pct * 100 >= concentracionSectorPct ? 'warn' : 'accent'}>{mayorSector.sector} {fmtPct(mayorSector.pct, 0)}</Badge>
    : <span className="text-[11px] text-celeste-600 hover:underline">Ver CEDEARs →</span>;

  return (
    <Card>
      <CardHeader title="CEDEARs" sub={`${cedears.length} CEDEAR${cedears.length > 1 ? 's' : ''} en cartera · sector y estilo (Peter Lynch)`}
        // Sin link mientras se personaliza el layout — mismo criterio que las tarjetas atómicas: un
        // click acá durante una reordenada navegaría afuera del Dashboard sin querer.
        right={personalizando ? right : <Link to="/cedears" className="inline-flex items-center gap-1.5">{right}</Link>} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
        <Stat label="Capital" value={fmtUsdCompact(totalMkt)} />
        <Stat label="Mayor posición" value={mayorPosicion
          ? <span className={mayorPosicion.pct >= CONCENTRACION_POSICION_ALERTA ? 'text-warn' : 'text-ink-900'}>{mayorPosicion.ticker} · {fmtPct(mayorPosicion.pct, 0)}</span>
          : <span className="text-ink-500">—</span>}
          hint="% del capital en CEDEARs concentrado en un solo ticker" />
        <Stat label="Sectores distintos" value={nSectores}
          hint="Cantidad de sectores distintos con capital cargado (no cuenta 'Sin sector')" />
        <Stat label="Concentración sectorial" value={hhiSector != null
          ? <span className={hhiSector >= HHI_SECTOR_ALERTA ? 'text-warn' : 'text-ink-900'}>{fmtNum(hhiSector, 2)}</span>
          : <span className="text-ink-500">—</span>}
          hint="Índice de Herfindahl (Σ pesoᵢ²) sobre el capital por sector: 1/N con N sectores parejos, 1 = todo en un sector." />
      </div>
    </Card>
  );
}

// Resumen de Bonos: capital, TIR y duración promedio ponderada vs. el máximo personal definido en
// /bonos. Mismo cálculo que BonosPage (useBonosCalc + resumenBonos compartidos) así los dos lugares
// nunca muestran números distintos.
function BonosResumen({ personalizando }: { personalizando: boolean }) {
  const { active } = usePortfolios();
  const { bonos, bonosCalc, isLoading } = useBonosCalc(active?.id);
  const { maxDuracionAnios } = useObjetivoDuracion(active?.id);

  if (isLoading) return <Card><CardHeader title="Bonos" /><p className="p-4 text-sm text-ink-600">Cargando…</p></Card>;
  if (bonos.length === 0) return null;

  // Sin riskFree: esta tarjeta no muestra spreadPromedio (el único campo que ese parámetro afecta —
  // ver AlertasResumen, que sí lo pasa porque alertasBonos() lo necesita para la alerta de spread
  // negativo). Pasarlo acá sin usarlo agregaría una suscripción a useMacro() sin ningún efecto visible.
  const { totalMkt, duracionPromedio, tirPromedio, distribucionGrado } = resumenBonos(bonosCalc);
  const cumpleObjetivo = duracionPromedio != null && duracionPromedio <= maxDuracionAnios;
  const right = duracionPromedio != null
    ? <Badge tone={cumpleObjetivo ? 'pos' : 'warn'}>{fmtNum(duracionPromedio, 1)}a promedio (máx. {maxDuracionAnios}a)</Badge>
    : <span className="text-[11px] text-celeste-600 hover:underline">Ver bonos →</span>;

  return (
    <Card>
      <CardHeader title="Bonos" sub={`${bonos.length} bono${bonos.length > 1 ? 's' : ''} en cartera · precio por nominal (data912)`}
        right={personalizando ? right : <Link to="/bonos" className="inline-flex items-center gap-1.5">{right}</Link>} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
        <Stat label="Capital" value={fmtUsdCompact(totalMkt)} />
        <Stat label="TIR promedio" value={tirPromedio != null
          ? <span className={tirPromedio >= 0 ? 'text-pos' : 'text-neg'}>{fmtPct(tirPromedio)}</span>
          : <span className="text-ink-500">—</span>}
          hint="Promedio ponderado por capital de la TIR (YTM) de cada bono" />
        <Stat label="Duración prom." value={duracionPromedio != null ? `${fmtNum(duracionPromedio, 1)}a` : '—'}
          hint="Duración de Macaulay promedio ponderada por capital — sensibilidad de la cartera de bonos a la tasa" />
        <Stat label="Grado inversión" value={fmtPct(distribucionGrado.gradoInversion, 0)}
          hint="% del capital en bonos calificados grado de inversión, dentro de su propia escala — nacional Arg. (FIX SCR/Moody's Local, lo habitual) o global (S&P/Moody's/Fitch), no mezcladas 1 a 1. El resto es especulativo, default, o sin calificar" />
      </div>
    </Card>
  );
}

// Resumen del Radar: cuántos tickers en seguimiento y cuántos son "compra agresiva" (margen de
// seguridad amplio, ver engine/dcf.ts). Cada RadarProbe es invisible — solo corre el mismo cálculo
// que una fila de RadarPage (useRadarTicker, compartido) y reporta el resultado acá arriba, así el
// criterio nunca se desincroniza entre el Dashboard y /radar.
function RadarResumen({ personalizando }: { personalizando: boolean }) {
  const { data: items = [], isLoading } = useWatchlist();
  const { map: cikMap, isLoading: cikLoading } = useCikMap();
  const { data: macro = {} } = useMacro();
  const riskFree = ((macro as Record<string, number | null>).dgs10 ?? 4.3) / 100;
  const { map: dcfMap } = useDcfInputs();
  const [agresivos, setAgresivos] = useState<Set<string>>(new Set());
  // Separado de `agresivos` para distinguir "todavía calculando" de "el resultado es 0 compras
  // agresivas" — mismo criterio que RadarCompraAgresivaMetric en metrics.tsx. Sin esto, la tarjeta
  // mostraba "0" (un cero provisorio indistinguible del resultado real) mientras cada probe
  // (fundamentals/DCF, varios segundos en frío) todavía estaba resolviendo.
  const [reportados, setReportados] = useState<Set<string>>(new Set());

  const onProbe = useCallback((ticker: string, agresiva: boolean, listo: boolean) => {
    setAgresivos(prev => {
      if (prev.has(ticker) === agresiva) return prev;
      const next = new Set(prev);
      if (agresiva) next.add(ticker); else next.delete(ticker);
      return next;
    });
    if (listo) setReportados(prev => (prev.has(ticker) ? prev : new Set(prev).add(ticker)));
  }, []);

  if (isLoading) return <Card><CardHeader title="Radar" /><p className="p-4 text-sm text-ink-600">Cargando…</p></Card>;
  if (items.length === 0) return null;

  const probesListos = items.every(it => reportados.has(it.ticker.toUpperCase()));

  return (
    <Card>
      {items.map(it => {
        const T = it.ticker.toUpperCase();
        return <RadarProbe key={it.id} ticker={T} cik={it.cik || cikMap.get(T)?.cik} cikLoading={cikLoading}
          riskFree={riskFree} saved={dcfMap.get(T)} onResult={onProbe} />;
      })}
      <CardHeader title="Radar" sub={`${items.length} ticker${items.length > 1 ? 's' : ''} en seguimiento.`}
        right={(() => {
          if (!probesListos) return <span className="text-[11px] text-ink-500">Calculando…</span>;
          const contenido = agresivos.size > 0
            ? <Badge tone="pos"><Flame className="w-3 h-3" /><span className="ml-1">{agresivos.size} compra agresiva{agresivos.size > 1 ? 's' : ''}</span></Badge>
            : <span className="text-[11px] text-celeste-600 hover:underline">Ver radar →</span>;
          return personalizando ? contenido : <Link to="/radar" className="inline-flex items-center gap-1.5">{contenido}</Link>;
        })()} />
      <div className="grid grid-cols-2 gap-2 p-3">
        <Stat label="En seguimiento" value={items.length} />
        <Stat label="Compra agresiva" value={probesListos ? agresivos.size : '…'} />
      </div>
    </Card>
  );
}

function RadarProbe({ ticker, cik, cikLoading, riskFree, saved, onResult }: {
  ticker: string; cik: string | undefined; cikLoading: boolean; riskFree: number;
  saved: StoredDcf | undefined;
  onResult: (ticker: string, agresiva: boolean, listo: boolean) => void;
}) {
  const { agresiva, isFetching } = useRadarTicker(ticker, cik, cikLoading, riskFree, saved);
  // Latcheado (nunca vuelve a false) — un refetch de fondo (window focus, etc.) no debe hacer
  // "desaparecer" al ticker de `reportados` y reaparecer el "Calculando…" con datos ya mostrados.
  const [listoAlguna, setListoAlguna] = useState(false);
  useEffect(() => {
    if (!cikLoading && !isFetching) setListoAlguna(true);
  }, [cikLoading, isFetching]);
  useEffect(() => { onResult(ticker, agresiva, listoAlguna); }, [ticker, agresiva, listoAlguna, onResult]);
  // Si el ticker sale del watchlist este probe se desmonta y ya no vuelve a llamar onResult —
  // sin este cleanup, `agresivos` en el padre lo sigue contando para siempre.
  useEffect(() => () => onResult(ticker, false, false), [ticker, onResult]);
  return null;
}

// Resumen mínimo de administración, solo para admins (no dispara el fetch de /api/admin/users
// hasta confirmar isAdmin — ver useAdminUsers). La gestión completa vive en /admin; acá es solo
// un vistazo rápido de cuántos usuarios hay y cuántos esperan aprobación.
function AdminResumen() {
  const { isAdmin, isLoading: chequeandoAdmin } = useEstadoCuenta();
  const { users, isLoading } = useAdminUsers(isAdmin);
  if (chequeandoAdmin || !isAdmin) return null;
  const pendientes = users.filter(u => !u.isApproved).length;

  return (
    <Card>
      <CardHeader title="Administración" sub="Resumen rápido de usuarios."
        right={pendientes > 0
          ? <Link to="/admin" className="inline-flex items-center gap-1.5"><Badge tone="warn">{pendientes} pendiente{pendientes > 1 ? 's' : ''}</Badge></Link>
          : <Link to="/admin" className="text-[11px] text-celeste-600 hover:underline">Ir a Admin →</Link>} />
      <div className="grid grid-cols-2 gap-2 p-3">
        <Stat label="Usuarios" value={isLoading ? '—' : users.length} />
        <Stat label="Pendientes de aprobación" value={isLoading ? '—' : pendientes} />
      </div>
    </Card>
  );
}

// Etiquetas/colores presentacionales de cada categoría — la clasificación en sí (categoriaDe) vive
// en engine/distribucion.ts, compartida con el cálculo de la alerta de renta fija consolidada.
const DEFAULT_OBJETIVO_FIJA_PCT = 30;
const DEFAULT_TOLERANCIA_DISTRIBUCION_PCT = 10;

// Objetivo personal de % en renta fija (vs. variable), con tolerancia — persistido en localStorage
// por portfolio, mismo patrón que useObjetivoDuracion (Bonos). Vive acá (no en un hook de engine)
// porque solo lo usan Distribucion() y AlertasResumen(), ambas en este archivo.
function useObjetivoDistribucion(portfolioId: string | undefined) {
  const key = portfolioId ? `dashboard.objetivoFija.${portfolioId}` : null;
  const [objetivoPct, setObjetivoState] = useState(DEFAULT_OBJETIVO_FIJA_PCT);
  const [toleranciaPct, setToleranciaState] = useState(DEFAULT_TOLERANCIA_DISTRIBUCION_PCT);

  useEffect(() => {
    let o = DEFAULT_OBJETIVO_FIJA_PCT, t = DEFAULT_TOLERANCIA_DISTRIBUCION_PCT;
    try {
      const raw = key ? localStorage.getItem(key) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Number.isFinite(parsed.objetivoPct) && parsed.objetivoPct >= 0 && parsed.objetivoPct <= 100) o = parsed.objetivoPct;
        if (Number.isFinite(parsed.toleranciaPct) && parsed.toleranciaPct >= 0 && parsed.toleranciaPct <= 100) t = parsed.toleranciaPct;
      }
    } catch { /* */ }
    setObjetivoState(o); setToleranciaState(t);
  }, [key]);

  const persist = (o: number, t: number) => {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ objetivoPct: o, toleranciaPct: t })); } catch { /* */ }
  };
  return {
    objetivoPct, toleranciaPct,
    setObjetivoPct: (o: number) => { setObjetivoState(o); persist(o, toleranciaPct); },
    setToleranciaPct: (t: number) => { setToleranciaState(t); persist(objetivoPct, t); },
  };
}

function Distribucion({ alloc, total, isLoading, objetivoFijaPct, toleranciaDistribucionPct, setObjetivoFijaPct, setToleranciaDistribucionPct }: {
  alloc: { ticker: string; mkt: number; target: number | null; tipo: AssetType }[]; total: number; isLoading: boolean;
  objetivoFijaPct: number; toleranciaDistribucionPct: number; setObjetivoFijaPct: (n: number) => void; setToleranciaDistribucionPct: (n: number) => void;
}) {
  const chart = useChartTheme();
  if (isLoading) {
    return <Card><CardHeader title="Distribución" /><p className="p-4 text-sm text-ink-600">Cargando…</p></Card>;
  }
  if (alloc.length === 0) {
    return <Card><CardHeader title="Distribución" /><p className="p-4 text-sm text-ink-600">Sin posiciones. Cargalas en Posiciones.</p></Card>;
  }
  // % objetivo mostrados como enteros que suman 100 (resto mayor), coherente con Posiciones. Se
  // calcula sobre TODO el portfolio (no por sección): peso_objetivo siempre es una fracción del
  // total, no del subconjunto fija/variable.
  const objPct = redondearPct(alloc.filter(a => a.target != null).map(a => ({ id: a.ticker, peso: a.target! })));
  // Mismo umbral que usa cada fila para decidir si mostrar la desviación (más abajo) — resumen
  // agregado al estilo "Focos de atención" de MacroContext, para que el drift no pase desapercibido.
  const desviados = alloc.filter(a => {
    if (a.target == null) return false;
    const w = total > 0 ? a.mkt / total : 0;
    return Math.abs(w - a.target) >= TOLERANCIA_OBJETIVO;
  }).length;

  const categorias: CategoriaPatrimonio[] = ['variable', 'fija', 'liquidez'];
  const data = categorias
    .map(cat => ({ cat, value: alloc.filter(a => categoriaDe(a.tipo) === cat).reduce((s, a) => s + a.mkt, 0) }))
    .filter(c => c.value > 0)
    .sort((a, b) => b.value - a.value);
  const fijaPct = pctRentaFija(alloc, total);

  return (
    <Card>
      <CardHeader title="Distribución" sub="Renta fija vs. variable · objetivo por ticker dentro de cada sección."
        right={desviados > 0 ? <Badge tone="warn">{desviados} fuera del objetivo</Badge> : undefined} />
      <div className="px-4 py-3 flex flex-wrap gap-3 items-end text-sm border-b border-line">
        <Field label="Objetivo renta fija (%)">
          <input type="number" min="0" max="100" step="5" value={objetivoFijaPct}
            onChange={e => {
              if (e.target.value === '') { setObjetivoFijaPct(DEFAULT_OBJETIVO_FIJA_PCT); return; }
              setObjetivoFijaPct(Math.min(100, Math.max(0, Number(e.target.value) || 0)));
            }}
            className={`${inputCls} w-24`} />
        </Field>
        <Field label="Tolerancia (±pp)">
          <input type="number" min="0" max="50" step="1" value={toleranciaDistribucionPct}
            onChange={e => {
              if (e.target.value === '') { setToleranciaDistribucionPct(DEFAULT_TOLERANCIA_DISTRIBUCION_PCT); return; }
              setToleranciaDistribucionPct(Math.min(50, Math.max(0, Number(e.target.value) || 0)));
            }}
            className={`${inputCls} w-24`} />
        </Field>
        <p className="text-[11px] text-ink-600 ml-auto">Renta fija actual: <span className="tnum font-semibold text-ink-800">{fijaPct != null ? `${fmtNum(fijaPct, 0)}%` : '—'}</span></p>
      </div>
      <div className="p-4 grid sm:grid-cols-[minmax(0,180px)_1fr] gap-4 items-center border-b border-line">
        <div className="h-[160px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="cat" cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={2} stroke="none">
                {data.map((c, i) => <Cell key={i} fill={CATEGORIA_COLOR[c.cat]} />)}
              </Pie>
              <Tooltip
                formatter={(v: number, n: string) => [fmtUsd(v, 0), CATEGORIA_LABEL[n as CategoriaPatrimonio]]}
                contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, color: chart.tooltipText, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-1.5">
          {data.map(c => (
            <div key={c.cat} className="flex items-center gap-2 text-sm">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CATEGORIA_COLOR[c.cat] }} />
              <span className="font-semibold text-ink-800 min-w-0 truncate">{CATEGORIA_LABEL[c.cat]}</span>
              <span className="tnum text-ink-700 ml-auto shrink-0">{fmtPct(total > 0 ? c.value / total : 0, 0)}</span>
              <span className="tnum text-[11px] text-ink-500 w-16 text-right">{fmtUsdCompact(c.value)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 space-y-4">
        {categorias.map(cat => {
          const items = alloc.filter(a => categoriaDe(a.tipo) === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat}>
              <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold mb-1.5">{CATEGORIA_LABEL[cat]}</p>
              <div className="space-y-1">
                {items.map(a => {
                  const w = total > 0 ? a.mkt / total : 0;
                  const off = a.target != null ? w - a.target : null;
                  return (
                    <div key={a.ticker} className="flex items-center gap-2 text-sm">
                      <span className="font-semibold text-ink-800 w-14 truncate">{a.ticker}</span>
                      <span className="tnum text-ink-700 w-12 text-right">{fmtPct(w, 0)}</span>
                      {a.target != null
                        ? <span className="tnum text-[11px] text-ink-500 w-16 text-right">obj {objPct.get(a.ticker) ?? Math.round(a.target * 100)}%</span>
                        : <span className="w-16" />}
                      {off != null && Math.abs(off) >= TOLERANCIA_OBJETIVO
                        ? <span className={`tnum text-[10px] w-10 text-right ${off > 0 ? 'text-warn' : 'text-celeste-600'}`}>{off > 0 ? '+' : ''}{fmtPct(off, 0)}</span>
                        : <span className="w-10" />}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Cobros reales (dividendos + intereses + amortizaciones) — cuánto entró y cuánto está sin
// reinvertir todavía. La amortización se ve reflejada en "Cobrado total" (es plata real) pero no en
// "Renta" (es devolución de capital, no ganancia). Las 3 tarjetas son SIEMPRE plata ya cobrada — el
// aviso de "próximo capital" de abajo es lo único proyectado acá, separado a propósito (mismo
// criterio que "Capital a cobrar 12m" en /cupones: nunca se mezcla lo realizado con lo estimado).
function CobrosResumen({ resumen, pendientesCount, proximoCapital }: { resumen: ReturnType<typeof resumenCobros>; pendientesCount: number; proximoCapital: CapitalMonthBucket | null }) {
  return (
    <Card>
      <CardHeader title="Cobros" sub="Dividendos, intereses y amortizaciones efectivamente cobrados."
        right={pendientesCount > 0
          ? <Link to="/cupones" className="inline-flex items-center gap-1.5"><Badge tone="warn">{pendientesCount} por confirmar</Badge></Link>
          : <Link to="/cupones" className="text-[11px] text-celeste-600 hover:underline">Ver detalle →</Link>} />
      <div className="grid grid-cols-3 gap-2 p-3">
        <div className="rounded-2xl border border-line bg-surface shadow-soft px-3 py-3 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold truncate">Cobrado total</p>
          <p className="text-lg font-bold font-display tnum mt-1 truncate text-ink-900">{fmtUsdCompact(resumen.total)}</p>
          <p className="text-[10px] text-ink-500 mt-0.5 truncate">dividendos + intereses + amort.</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface shadow-soft px-3 py-3 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold truncate">Disponible</p>
          <p className={`text-lg font-bold font-display tnum mt-1 truncate ${resumen.disponible > 0 ? 'text-warn' : 'text-ink-900'}`}>{fmtUsdCompact(resumen.disponible)}</p>
          <p className="text-[10px] text-ink-500 mt-0.5 truncate">listo para reinvertir</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface shadow-soft px-3 py-3 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold truncate">Renta pura</p>
          <p className="text-lg font-bold font-display tnum mt-1 truncate text-ink-900">{fmtUsdCompact(resumen.porTipo.dividendo + resumen.porTipo.interes)}</p>
          <p className="text-[10px] text-ink-500 mt-0.5 truncate">sin contar amortización</p>
        </div>
      </div>
      {proximoCapital && (
        <p className="px-4 pb-3 text-[11px] text-ink-500 border-t border-line pt-2.5"
          title="Devolución de capital (amortización + rescate al vencimiento) de todos los bonos, ventana de 12 meses — NO es renta. Bonos amortizables sin cronograma cargado se estiman con su valor residual, todo junto al vencimiento.">
          Próximo mes con capital <span className="italic">proyectado</span> (amortización o rescate al vencimiento, no es renta): <span className="tnum font-semibold text-ink-700">{fmtUsdCompact(proximoCapital.total)}</span> en {MESES_CORTOS[proximoCapital.month - 1]} {proximoCapital.year} — <Link to="/cupones" className="text-celeste-600 hover:underline">detalle en Cupones →</Link>
        </p>
      )}
    </Card>
  );
}

// Liquidez & FCI: la parte del flujo de caja que se muestra en el Dashboard (near-cash sleeve).
// Montos en pesos formateados compactos ($22,9 M) para que no desborden las cajas; el valor exacto
// queda en el tooltip.
function LiquidezFci({ resumen, mep }: { resumen: ReturnType<typeof resumenFlujo>; mep: number | null }) {
  const usd = (ars: number) => (mep ? `≈ ${fmtUsd(ars / mep, 0)}` : 'liquidez');
  const tiles = [
    { label: 'FCI + billetera', val: resumen.fci, sub: usd(resumen.fci), tone: 'text-ink-900' },
    { label: 'Disponible', val: resumen.disponible, sub: 'ingresos − egresos', tone: resumen.disponible >= 0 ? 'text-pos' : 'text-neg' },
    { label: 'Sin asignar', val: resumen.sinAsignar, sub: 'sin colocar', tone: resumen.sinAsignar >= 0 ? 'text-ink-900' : 'text-neg' },
  ];
  return (
    <Card>
      <CardHeader title="Liquidez & FCI" sub="Fondos y billetera en pesos, según tu flujo de caja · compartido entre todos tus portfolios."
        right={<Link to="/finanzas" className="text-[11px] text-celeste-600 hover:underline">Editar flujo →</Link>} />
      <div className="grid grid-cols-3 gap-2 p-3">
        {tiles.map(t => (
          <div key={t.label} className="rounded-2xl border border-line bg-surface shadow-soft px-3 py-3 min-w-0" title={fmtArs(t.val)}>
            <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold truncate">{t.label}</p>
            <p className={`text-lg font-bold font-display tnum mt-1 truncate ${t.tone}`}>{fmtArsCompact(t.val)}</p>
            <p className="text-[10px] text-ink-500 mt-0.5 truncate">{t.sub}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Patrimonio por broker: mismo cálculo y donut que BrokersPage, resumido para el Dashboard.
function PatrimonioBrokers({ posiciones, quotes, isLoading }: {
  posiciones: Posicion[]; quotes: Record<string, number | null>; isLoading: boolean;
}) {
  const chart = useChartTheme();
  const { data: brokers = [], isLoading: brokersLoading } = useBrokers();
  const { data: asignacionesAll = [], isLoading: asigLoading } = usePosicionBrokers();

  const abiertas = useMemo(() => posiciones.filter(p => p.cantidad > 0), [posiciones]);
  // Mismo criterio de valuación que Posiciones/Brokers (unitUSD, fallback a costo sin cotización).
  const posValuadas = useMemo(() => abiertas.map(p => {
    const unit = unitUSD(p, quotes[p.ticker] ?? null);
    const valorUsd = unit != null ? unit * p.cantidad : p.precio_compra * p.cantidad;
    return { id: p.id, cantidad: p.cantidad, valorUsd };
  }), [abiertas, quotes]);
  const asignaciones = useMemo(() => {
    const ids = new Set(abiertas.map(p => p.id));
    return asignacionesAll.filter(a => ids.has(a.posicion_id))
      .map(a => ({ posicionId: a.posicion_id, brokerId: a.broker_id, cantidad: a.cantidad }));
  }, [asignacionesAll, abiertas]);
  const resumen = useMemo(() => resumenPorBroker(posValuadas, asignaciones, brokers), [posValuadas, asignaciones, brokers]);

  const cargando = isLoading || brokersLoading || asigLoading;
  const right = <Link to="/brokers" className="text-[11px] text-celeste-600 hover:underline">Ver detalle →</Link>;
  if (cargando) {
    return <Card><CardHeader title="Patrimonio por broker" right={right} /><p className="p-4 text-sm text-ink-600">Cargando…</p></Card>;
  }
  if (resumen.length === 0) {
    return <Card><CardHeader title="Patrimonio por broker" right={right} /><p className="p-4 text-sm text-ink-600">Sin posiciones. Cargalas en Posiciones.</p></Card>;
  }
  return (
    <Card>
      <CardHeader title="Patrimonio por broker" sub="Dónde está físicamente cada posición." right={right} />
      <div className="p-4 grid sm:grid-cols-[minmax(0,180px)_1fr] gap-4 items-center">
        <div className="h-[160px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={resumen} dataKey="valorUsd" nameKey="nombre" cx="50%" cy="50%" innerRadius={42} outerRadius={72} paddingAngle={2} stroke="none">
                {resumen.map((r, i) => <Cell key={r.brokerId ?? 'sin-asignar'} fill={colorDeBroker(i, r.brokerId)} />)}
              </Pie>
              <Tooltip
                formatter={(v: number) => [fmtUsdCompact(v), 'Patrimonio']}
                contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, color: chart.tooltipText, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-1">
          {resumen.map((r, i) => (
            <div key={r.brokerId ?? 'sin-asignar'} className="flex items-center gap-2 text-sm">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorDeBroker(i, r.brokerId) }} />
              <span className={`font-semibold flex-1 min-w-0 truncate ${r.brokerId == null ? 'text-ink-500' : 'text-ink-800'}`}>{r.nombre}</span>
              <span className="tnum text-ink-600 w-16 text-right">{fmtPct(r.pct, 0)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// Contexto macro resumido: título + distancia a máximos + barra de salud. El detalle completo
// (focos de atención, indicadores agrupados, lectura ejecutiva por IA) vive en /macro — acá solo
// el vistazo rápido, con un link al detalle.
function MacroResumen({ resumen }: { resumen: ResumenMacro }) {
  const { data: dd = {} } = useDrawdowns();
  const tone = resumen.luz === 'rojo' ? 'neg' : resumen.luz === 'amarillo' ? 'warn' : 'pos';
  const { verdes, amarillos, rojos, total } = resumen.conteo;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <Card>
      <CardHeader title="Contexto macro" sub="Semáforos de mercado, de un vistazo."
        right={<Badge tone={tone}>{resumen.titulo}</Badge>} />

      <DistanciaMaximo dd={dd} />

      {/* Salud del tablero: barra verde/amarillo/rojo + leyenda (visual, de un vistazo). */}
      {total === 0 ? (
        <div className="px-4 pt-3.5 pb-4"><p className="text-sm text-ink-600">Todavía no hay datos de mercado; se completan con el próximo refresco.</p></div>
      ) : (
        <div className="px-4 pt-3.5 pb-4">
          <div className="h-2.5 rounded-full bg-canvas overflow-hidden flex">
            {verdes > 0 && <div className="bg-pos" style={{ width: `${pct(verdes)}%` }} />}
            {amarillos > 0 && <div className="bg-warn" style={{ width: `${pct(amarillos)}%` }} />}
            {rojos > 0 && <div className="bg-neg" style={{ width: `${pct(rojos)}%` }} />}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-ink-600">
            <span className="inline-flex items-center gap-1.5 tnum"><span className="w-2 h-2 rounded-full bg-pos" /> {verdes} en verde</span>
            <span className="inline-flex items-center gap-1.5 tnum"><span className="w-2 h-2 rounded-full bg-warn" /> {amarillos} atención</span>
            <span className="inline-flex items-center gap-1.5 tnum"><span className="w-2 h-2 rounded-full bg-neg" /> {rojos} estrés</span>
          </div>
        </div>
      )}

      <div className="px-4 pb-3.5 pt-1 border-t border-line">
        <Link to="/macro" className="text-[11px] text-celeste-600 hover:underline">Ver contexto macro completo →</Link>
      </div>
    </Card>
  );
}
