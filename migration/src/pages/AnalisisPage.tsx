import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Sparkles, CheckCircle2, AlertTriangle, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useQuotes, useMacro } from '../hooks/usePosiciones';
import { useCikMap } from '../hooks/useCikMap';
import { usePortfolios } from '../hooks/usePortfolios';
import { useChartTheme } from '../hooks/usePrefs';
import { computeRatios } from '../engine/ratios';
import { computeDcf, sensitivityTable, dcfDefaultsFor, DEFAULT_DCF_INPUTS, OE_METHOD_DEFAULT, type DcfInputs, type CapexMethod, type OeMethod, type MungerCheck } from '../engine/dcf';
import { tendenciaPrecio, contrastarConNegocio, anualizar, sinRecalentamiento } from '../engine/tendenciaPrecio';
import { useDcfInputs } from '../hooks/useDcfInputs';
import { useUltimoAnalisis, useSetUltimoAnalisis } from '../hooks/useAnalisisIA';
import { Card, CardHeader, Button, Badge, Stat, ViewToggle, inputCls, fmtUsd, fmtUsdCompact, fmtNum, fmtPct, normalizeAiText } from '../components/ui';
import type { Fundamentals } from '../types/domain';

export function AnalisisPage() {
  const { ticker = '' } = useParams();
  const T = ticker.toUpperCase();
  const { active } = usePortfolios();
  const [inp, setInp] = useState<DcfInputs>(DEFAULT_DCF_INPUTS);
  const [beta, setBeta] = useState(1.0);

  const { map: cikMap, isLoading: cikLoading } = useCikMap();
  const { map: dcfMap, isLoading: dcfLoading, save: saveDcf, remove: removeDcf } = useDcfInputs();
  const cik = cikMap.get(T)?.cik;
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { data: fund, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['fundamentals', T, cik ?? ''],
    enabled: !cikLoading,   // esperar el cik_map para tickers fuera del set por defecto
    queryFn: () => api.fundamentals(T, cik),
    staleTime: 12 * 60 * 60_000,
  });
  // Fuerza re-consulta a EDGAR salteando la cache del server (fresh=1) y actualiza la vista.
  const actualizar = async () => {
    setRefreshing(true);
    try {
      const fresh = await api.fundamentals(T, cik, true);
      qc.setQueryData(['fundamentals', T, cik ?? ''], fresh);
    } catch { /* se muestra el estado de error normal */ } finally { setRefreshing(false); }
  };
  const { data: quotes = {} } = useQuotes([T]);
  const { data: macro = {} } = useMacro();
  const price = quotes[T] ?? null;
  const riskFree = (macro.dgs10 ?? 4.3) / 100;

  // Beta real de mercado (Finnhub/FMP, cacheado) — el default cuando no hay un override guardado.
  // Antes acá se sembraba siempre 1.0 fijo, sin decir nada de la volatilidad real de la empresa.
  const { data: betaFetched, isLoading: betaLoading } = useQuery({
    queryKey: ['beta', T],
    queryFn: () => api.beta(T),
    staleTime: 24 * 60 * 60_000,
  });
  const betaDefault = betaFetched?.beta ?? 1.0;

  // Histórico de precio semanal (Yahoo Finance, hasta 10 años) para la tarjeta de tendencia — ver
  // engine/tendenciaPrecio.ts. 24h de staleTime: un precio semanal no necesita refrescarse más
  // seguido (mismo TTL que ya usa el endpoint del lado del server).
  const [rangoPrecio, setRangoPrecio] = useState<'1a' | '5a' | '10a'>('1a');
  const chart = useChartTheme();
  const { data: hist, isLoading: histLoading } = useQuery({
    queryKey: ['historico', T],
    enabled: !!T,
    queryFn: () => api.historico(T),
    staleTime: 24 * 60 * 60_000,
  });

  const seededFor = useRef<string | null>(null);
  useEffect(() => { seededFor.current = null; setSaveMsg(null); }, [T]);

  const { ratios, dcf, sens } = useMemo(() => {
    if (!fund) return { ratios: null, dcf: null, sens: null };
    const f = fund as Fundamentals;
    const r = computeRatios(f, price, beta, riskFree);
    const d = computeDcf(f, price, r.wacc, inp, r.roic);
    const s = sensitivityTable(f, r.wacc, inp,
      [inp.g - 0.04, inp.g - 0.02, inp.g, inp.g + 0.02, inp.g + 0.04].map(x => Math.max(0, x)),
      [inp.d - 0.02, inp.d, inp.d + 0.02, inp.d + 0.04]);
    return { ratios: r, dcf: d, sens: s };
  }, [fund, price, beta, riskFree, inp]);

  const puntosGrafico = useMemo(() => {
    const todos = hist?.puntos ?? [];
    return rangoPrecio === '1a' ? todos.slice(-53) : rangoPrecio === '5a' ? todos.slice(-261) : todos;
  }, [hist, rangoPrecio]);
  // Las 3 métricas de abajo (Var. 52 sem. / Var. X años / Vs. máx. X años) se calculan sobre la MISMA
  // ventana que está dibujada en el gráfico (puntosGrafico) — así el número siempre cuenta la misma
  // historia que el botón 1A/5A/10A apretado. Antes se calculaban sobre TODA la historia recibida
  // (hasta 10 años) sin importar el toggle: con "1 año" apretado igual se leía "Var. 10 años" al
  // lado — una inconsistencia visual que invita a leer mal el dato (revisión Munger de esta tarjeta).
  const tendencia = useMemo(() => tendenciaPrecio(puntosGrafico), [puntosGrafico]);
  // var5y (para el cruce contra el NEGOCIO más abajo) es la única excepción: se calcula siempre sobre
  // los últimos 5 años EXACTOS de TODA la historia recibida, no la ventana del toggle — porque
  // dcf.histCagrOE también es un CAGR a 5 años fijo, y mezclar horizontes ahí invalidaría el cruce.
  // No se muestra con una etiqueta al lado del toggle, así que no genera la misma confusión.
  const var5yCruce = useMemo(() => tendenciaPrecio(hist?.puntos ?? []).var5y, [hist]);
  // Cruza precio vs. NEGOCIO (CAGR histórico de owner earnings, no margin of safety ni valor
  // intrínseco: esos dos ya incorporan el precio de hoy, cruzarlos sería comparar el precio contra sí
  // mismo). Ver engine/tendenciaPrecio.ts para el razonamiento completo.
  const lecturaTendencia = dcf ? contrastarConNegocio(var5yCruce, dcf.histCagrOE) : null;
  // Mismo número que compara contrastarConNegocio() por dentro (var5yCruce anualizado) — se muestra
  // en los textos de abajo para que lo que se LEE sea lo mismo que lo que se COMPARA: mostrar el
  // acumulado crudo al lado de un CAGR anual (como antes) sugiere una comparación que en realidad
  // nunca se hizo así.
  const priceCagr5y = var5yCruce != null ? anualizar(var5yCruce, 5) : null;
  // 'posible-deterioro' (contrastarConNegocio) cubre DOS escenarios distintos: precio y negocio cayeron
  // juntos, O el precio SUBIÓ mientras el negocio cayó ("euforia sin respaldo" — ver tendenciaPrecio.ts).
  // Sin distinguirlos acá, el texto/ícono de abajo asumía siempre "cayeron juntos", que es falso en el
  // segundo caso (el precio subió, no bajó).
  const deterioroConPrecioAlza = priceCagr5y != null && priceCagr5y > 0;
  const etiquetaVentana = tendencia.anios == null ? 'la ventana'
    : tendencia.anios < 1 ? 'todo el historial' // IPO reciente: "0 años" leería mal
    : `${tendencia.anios} año${tendencia.anios === 1 ? '' : 's'}`;

  // Al abrir un ticker (una vez que hay ratios y cargó lo guardado): si el usuario ya guardó
  // supuestos para ese ticker, los usamos; si no, calculamos los defaults por empresa
  // (g = EG5Y−1pto acotado, d = Ke, gt 3%, N 20, MoS 20%, base = último año).
  useEffect(() => {
    // Espera a que también resuelva la consulta de beta — si no, con un saved.beta ausente se
    // podía sembrar 1.0 y quedarse así aunque el beta real llegara un instante después (el guard de
    // abajo solo siembra una vez por ticker, no se re-corre cuando cambia betaFetched).
    if (!ratios || dcfLoading || betaLoading || seededFor.current === T) return;
    seededFor.current = T;
    const saved = dcfMap.get(T);
    if (saved) { const { beta: b, ...rest } = saved; setInp(rest); setBeta(b); }
    else { setInp(dcfDefaultsFor(ratios)); setBeta(betaDefault); }
  }, [ratios, dcfLoading, betaLoading, betaDefault, T, dcfMap]);

  const guardarSupuestos = async () => {
    try { await saveDcf(T, { ...inp, beta }); setSaveMsg('Guardado ✓ — el Radar usará estos supuestos.'); }
    catch (e) { setSaveMsg(`No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`); }
  };
  const restablecer = async () => {
    // Si el beta de mercado todavía no resolvió, no pisar el campo con el fallback 1.0 — quedaría
    // trabado ahí para siempre (seededFor.current ya está seteado, el efecto de siembra no vuelve a correr).
    if (betaLoading) { setSaveMsg('Esperá a que termine de cargar el beta de mercado…'); return; }
    if (ratios) { setInp(dcfDefaultsFor(ratios)); setBeta(betaDefault); }
    try { await removeDcf(T); setSaveMsg('Restablecido a los valores por defecto.'); } catch { /* */ }
  };

  if (cikLoading || isLoading) return <p className="text-ink-600">Cargando fundamentals de {T}…</p>;
  if (error) {
    // reintentable viene DIRECTO de la Function (ver fundamentals.ts) — antes se inferÍa con un
    // regex sobre el mensaje genérico "→ HTTP 503" que armaba get() (lib/api.ts), que además
    // descartaba el {detail} real que la Function sí manda. Sin eso, diagnosticar un caso real
    // (ej. por qué un ticker puntual no trae ciertos datos) requería pedirle a mano el texto exacto
    // al usuario — ahora se puede mostrar directo.
    const reintentable = error instanceof ApiError ? error.reintentable : false;
    const detalleServidor = error instanceof ApiError ? error.message : null;
    return (
      <div className="space-y-3">
        <Link to="/analisis" className="text-xs text-celeste-600 hover:underline">← Volver a Análisis</Link>
        <div className="text-sm space-y-2">
          {reintentable ? (
            <>
              <p className="text-warn">EDGAR no devolvió los datos de <b>{T}</b> en este intento.</p>
              <p className="text-ink-600">Suele ser un límite de tasa momentáneo de la SEC, no un problema de la empresa. Reintentá en unos segundos.</p>
            </>
          ) : (
            <>
              <p className="text-warn">No hay fundamentals de <b>{T}</b> vía EDGAR.</p>
              <p className="text-ink-600">Solo funciona con empresas que reportan a la SEC. Si es una grande de EE.UU. que no reconocemos, cargá su par ticker → CIK en <b>Configuración</b>.</p>
            </>
          )}
          {detalleServidor && <p className="text-[11px] text-ink-500">Detalle: {detalleServidor}</p>}
          <Button variant="ghost" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} /> {isFetching ? 'Reintentando…' : 'Reintentar'}
          </Button>
        </div>
      </div>
    );
  }
  if (!fund || !ratios || !dcf) return null;

  const verdictTone = dcf.verdict === 'COMPRAR' ? 'pos' : dcf.verdict === 'CARO' ? 'neg' : 'warn';

  // Se arma ACÁ (no adentro de computeDcf/dcf.ts) porque depende del histórico de precio (Yahoo,
  // ver arriba) — computeDcf es una función pura que también usa el Radar (useRadarTicker, un DCF
  // por cada ticker en seguimiento) SIN ese histórico; forzar la dependencia ahí rompería esa otra
  // pantalla o dejaría el chequeo apareciendo/desapareciendo según quién llame a computeDcf. La
  // frase de la tarjeta "Precio — tendencia" ya invita a "cruzar con los Chequeos Munger de abajo"
  // cuando hay pánico/deterioro — sin esta entrada, esa frase mandaba a una lista que no tenía nada
  // dicho sobre el recalentamiento específicamente.
  const checkRecalentamiento: MungerCheck = {
    label: '¿El precio no se recalentó respecto al negocio? (evita pagar por un múltiplo que ya se expandió)',
    ok: sinRecalentamiento(lecturaTendencia),
    detail: lecturaTendencia === 'posible-recalentamiento'
      ? `Precio ${fmtPct(priceCagr5y)} anual en 5 años (acumulado ${fmtPct(var5yCruce)}) vs. Owner Earnings a un CAGR histórico de ${fmtPct(dcf.histCagrOE)} — gran parte de la suba es múltiplo, no negocio`
      : lecturaTendencia === 'posible-deterioro'
      ? (deterioroConPrecioAlza
          ? `Precio ${fmtPct(priceCagr5y)} anual en 5 años (acumulado ${fmtPct(var5yCruce)}) pero Owner Earnings cayó (CAGR histórico ${fmtPct(dcf.histCagrOE)}) — no es expansión de múltiplo por definición, pero el mercado igual le pagó más a un negocio que empeora (ver aviso arriba)`
          : `Precio y Owner Earnings cayeron juntos (Owner Earnings a un CAGR histórico de ${fmtPct(dcf.histCagrOE)}) — no es expansión de múltiplo, pero tampoco descarta que el negocio se haya deteriorado (ver aviso arriba)`)
      : lecturaTendencia === 'posible-panico'
      ? `Precio ${fmtPct(priceCagr5y)} anual en 5 años (acumulado ${fmtPct(var5yCruce)}), pero Owner Earnings no acompañó la caída (CAGR histórico ${fmtPct(dcf.histCagrOE)}) — sin señal de múltiplo inflado`
      : lecturaTendencia == null ? 'sin histórico de precio suficiente'
      : `Precio (${fmtPct(priceCagr5y)} anual en 5 años) y Owner Earnings (CAGR histórico ${fmtPct(dcf.histCagrOE)}) sin brecha relevante`,
  };

  // Qué base usa el DCF, en texto: sin esto el número normalizado no se podía cruzar contra la
  // tabla de owner earnings por año (parecía "otro" valor aunque fuera el del último ejercicio).
  const oeMetodo = inp.oeMethod ?? OE_METHOD_DEFAULT;
  const oeEtiqueta: Record<OeMethod, string> = {
    ultimo: 'último año',
    ponderado: 'ponderado 5 años (recientes pesan más)',
    prom3: 'promedio 3 años',
    prom5: 'promedio 5 años',
    mediana5: 'mediana 5 años',
    margen: 'margen mediano × ventas de hoy',
  };
  const oeAnios = dcf.ownerEarningsByYear.slice(-5).map(y => y.fy);
  const oeVentana = oeMetodo === 'ultimo' ? oeAnios.slice(-1) : oeMetodo === 'prom3' ? oeAnios.slice(-3) : oeAnios;
  const oeRango = oeVentana.length === 0 ? ''
    : oeVentana.length === 1 ? ` · ${oeVentana[0]}`
    : ` · ${oeVentana[0]}–${oeVentana[oeVentana.length - 1]}`;
  const oeHint = `${oeEtiqueta[oeMetodo]}${oeRango} · ${fmtUsd(dcf.ownerEarningsNorm, 0)}`;

  return (
    <div className="space-y-4">
      <Link to="/analisis" className="inline-flex items-center text-xs text-celeste-600 hover:underline">← Volver a Análisis</Link>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-ink-900 font-display">{T}</h1>
        <span className="text-sm text-ink-600">{(fund as Fundamentals).entityName ?? ''}</span>
        <Badge tone={verdictTone as 'pos'|'neg'|'warn'}>{dcf.verdict}</Badge>
        {/* fuente:'fmp' = EDGAR no devolvió nada (ni en caché) y se usó FMP como último recurso (ver
            fundamentals.ts) — badge propio, nunca el genérico de EDGAR: decir "EDGAR" acá sería
            insinuar una fuente que el código no usó para este dato. */}
        {(fund as { fuente?: string }).fuente === 'fmp'
          ? <Badge tone="warn">datos de FMP, no de EDGAR</Badge>
          : (fund as { warning?: string }).warning && <Badge tone="warn">datos incompletos EDGAR</Badge>}
        {(fund as { stale?: boolean }).stale && <Badge tone="warn">EDGAR no respondió — mostrando la última foto guardada</Badge>}
        <Button variant="ghost" onClick={actualizar} disabled={refreshing} className="ml-auto">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> {refreshing ? 'Actualizando…' : 'Actualizar datos'}
        </Button>
      </div>
      {(fund as { warning?: string }).warning && (
        <p className="text-[11px] text-warn">{(fund as { warning?: string }).warning}</p>
      )}
      {(fund as { stale?: boolean }).stale && !(fund as { warning?: string }).warning && (
        <p className="text-[11px] text-warn">La SEC no respondió en el último intento — estos números son del último fetch exitoso (no necesariamente de hoy). Probá "Actualizar datos".</p>
      )}
      {dcf.motivoInestable && (
        <div className="rounded-xl bg-warn/10 ring-1 ring-inset ring-warn/25 px-3 py-2 text-[11px] text-ink-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-warn mt-0.5" />
          <p>El veredicto no puede ser COMPRAR: {dcf.motivoInestable}. Revisá los supuestos abajo — con estos, el valor intrínseco no es confiable.</p>
        </div>
      )}

      {/* Veredicto + valuación */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Precio" value={fmtUsd(price)} />
        <Stat label="Valor intrínseco / acc." value={fmtUsd(dcf.intrinsicPerShare)} hint="DCF Owner Earnings" />
        <Stat label="Margen de seguridad" value={fmtPct(dcf.marginOfSafety)} hint={`exigido ${fmtPct(inp.mosRequired)}`} />
        <Stat label="Owner earnings norm." value={fmtUsdCompact(dcf.ownerEarningsNorm)} hint={oeHint} />
      </div>

      {/* Precio — tendencia. Deliberadamente NO se dibuja el valor intrínseco sobre el gráfico: esa
          línea se calcula con datos de HOY (shares, owner earnings actuales) y pintarla cruzando 5
          años de historia insinuaría que valía eso en el pasado, lo cual es falso. La comparación
          precio-vs-valor ya está arriba (Precio / Valor intrínseco / MoS); acá se cruza el precio
          contra el NEGOCIO (owner earnings), que es una pregunta distinta y más útil: "esta caída,
          ¿es pánico de mercado o el negocio también se deterioró?". */}
      <Card>
        <CardHeader title="Precio — tendencia" sub="Histórico semanal — Yahoo Finance, referencial."
          right={<ViewToggle value={rangoPrecio} onChange={setRangoPrecio} label="Ventana"
            options={[{ value: '1a', label: '1 año' }, { value: '5a', label: '5 años' }, { value: '10a', label: '10 años' }]} />} />
        {histLoading ? (
          <p className="p-4 text-sm text-ink-600">Cargando histórico de precio…</p>
        ) : !hist?.puntos?.length ? (
          <p className="p-4 text-sm text-ink-600">Histórico de precio no disponible por ahora.</p>
        ) : (
          <>
            <div className="px-4 pt-3 grid grid-cols-3 gap-3 text-sm">
              <Metric l="Var. 52 sem." v={fmtPct(tendencia.var52sem)}
                tone={tendencia.var52sem == null ? undefined : tendencia.var52sem >= 0 ? 'pos' : 'neg'} />
              <Metric l={`Var. ${etiquetaVentana}`} v={fmtPct(tendencia.varVentana)}
                tone={tendencia.varVentana == null ? undefined : tendencia.varVentana >= 0 ? 'pos' : 'neg'} />
              <Metric l={`Vs. máx. ${etiquetaVentana}`} v={fmtPct(tendencia.distanciaMax)}
                tone={tendencia.distanciaMax != null && tendencia.distanciaMax < -0.10 ? 'warn' : undefined} />
            </div>
            <div className="h-[200px] px-2 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={puntosGrafico} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="fecha" stroke={chart.axis} fontSize={10} minTickGap={48}
                    tickFormatter={f => f.slice(0, 7)} />
                  <YAxis stroke={chart.axis} fontSize={11} width={56} domain={['auto', 'auto']}
                    tickFormatter={v => fmtUsd(v, 0)} />
                  <Tooltip formatter={(v: number) => [fmtUsd(v), 'Precio']}
                    contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 12, color: chart.tooltipText, fontSize: 12 }} />
                  <Area type="monotone" dataKey="close" stroke="#4F97D4" fill="#4F97D4" fillOpacity={0.12} strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {hist.parcial && (
              <p className="px-4 pt-1 text-[11px] text-ink-500">Historial limitado — {T} parece cotizar hace menos de un año.</p>
            )}
            {lecturaTendencia && (
              <div className={`mx-4 mt-3 mb-2 rounded-xl px-3 py-2.5 text-[11px] flex items-start gap-2 ring-1 ring-inset ${
                lecturaTendencia === 'posible-panico' ? 'bg-pos/10 ring-pos/25'
                : lecturaTendencia === 'posible-deterioro' ? 'bg-neg/10 ring-neg/25'
                : lecturaTendencia === 'posible-recalentamiento' ? 'bg-warn/10 ring-warn/25' : 'bg-canvas ring-line'}`}>
                {lecturaTendencia === 'posible-deterioro'
                  ? (deterioroConPrecioAlza
                      ? <TrendingUp className="w-4 h-4 shrink-0 text-neg mt-0.5" />
                      : <TrendingDown className="w-4 h-4 shrink-0 text-neg mt-0.5" />)
                  : <TrendingUp className={`w-4 h-4 shrink-0 mt-0.5 ${lecturaTendencia === 'posible-recalentamiento' ? 'text-warn' : 'text-pos'}`} />}
                <p className="text-ink-700">
                  {lecturaTendencia === 'posible-panico' &&
                    <>Precio {fmtPct(priceCagr5y)} anual en 5 años (acumulado {fmtPct(var5yCruce)}), pero los Owner Earnings no acompañaron esa caída (CAGR histórico {fmtPct(dcf.histCagrOE)}) — puede ser sobre-reacción del mercado, no deterioro del negocio. No es una señal de compra por sí sola: cruzá igual con los Chequeos Munger de abajo.</>}
                  {lecturaTendencia === 'posible-deterioro' && (deterioroConPrecioAlza
                    ? <>Precio {fmtPct(priceCagr5y)} anual en 5 años (acumulado {fmtPct(var5yCruce)}), pero los Owner Earnings cayeron (CAGR histórico {fmtPct(dcf.histCagrOE)}) — el mercado le pagó más a un negocio que empeora, euforia sin respaldo en los números.</>
                    : <>Precio y Owner Earnings se movieron en la misma dirección negativa (CAGR histórico {fmtPct(dcf.histCagrOE)}) — nada acá contradice que el negocio se haya deteriorado. Un precio bajo por sí solo no es garantía de descuento.</>)}
                  {lecturaTendencia === 'posible-recalentamiento' &&
                    <>Precio {fmtPct(priceCagr5y)} anual en 5 años (acumulado {fmtPct(var5yCruce)}), bastante más rápido que el negocio (Owner Earnings creciendo a un CAGR histórico de {fmtPct(dcf.histCagrOE)}) — parte de la suba vino de que el mercado le puso un múltiplo mayor a la empresa, no de que el negocio haya mejorado al mismo ritmo. No es lo mismo que "cara" (eso ya lo dice el margen de seguridad de arriba, con el valor intrínseco de hoy): es una advertencia distinta — sostener este precio de acá en más depende de que el negocio siga alcanzando al múltiplo, no de que el mercado se lo siga expandiendo.</>}
                  {lecturaTendencia === 'sin-señal-clara' &&
                    <>Sin movimiento fuerte de precio ni de Owner Earnings en 5 años — no hay una lectura clara de pánico ni de deterioro.</>}
                </p>
              </div>
            )}
            <p className="px-4 pb-3 text-[10px] text-ink-500">Puede diferir levemente del precio de arriba (Finnhub/FMP) — esta serie es de Yahoo Finance.</p>
          </>
        )}
      </Card>

      {/* Ratios */}
      <Card>
        <CardHeader title="Ratios" sub="Calculados por el código desde EDGAR (no por IA)." />
        <div className="p-4 grid grid-cols-2 sm:grid-cols-6 gap-3 text-sm">
          <Metric l="P/E" v={fmtNum(ratios.pe, 1)} />
          <Metric l="P/E fwd" v={fmtNum(ratios.peForward, 1)} />
          <Metric l="P/B" v={fmtNum(ratios.pb, 1)} />
          <Metric l="ROIC" v={`${fmtPct(ratios.roic)}${ratios.roic != null && ratios.wacc != null && ratios.roic > ratios.wacc ? ' ✓' : ''}`} tone={ratios.roic != null && ratios.wacc != null && ratios.roic > ratios.wacc ? 'pos' : 'warn'} />
          <Metric l="Ke (CAPM)" v={fmtPct(ratios.costOfEquity)}
            hint="Ke = tasa libre de riesgo (FRED, real) + beta × 5% (prima de riesgo de mercado, supuesto fijo). El beta es de mercado (Finnhub/FMP) salvo que lo edites vos abajo — EDGAR no tiene beta ni prima de riesgo, son datos de mercado, no contables." />
          <Metric l="WACC" v={fmtPct(ratios.wacc)}
            hint="Mezcla Ke (de arriba) con el costo de deuda después de impuestos — ese sí sale de EDGAR (intereses/deuda/impuestos reales del balance). No es un número inventado, pero tampoco 'exacto': la parte de mercado (beta, prima de riesgo) es siempre un supuesto, EDGAR no la tiene." />
          <Metric l="EG5Y (real)" v={fmtPct(ratios.eg5y)} />
          <Metric l="Margen op." v={fmtPct(ratios.operatingMargin)} />
          <Metric l="Deuda/Eq." v={fmtNum(ratios.debtToEquity, 2)} />
          <Metric l="DeudaNeta/EBITDA" v={fmtNum(ratios.netDebtToEbitda, 2)} />
          <Metric l="Div yield" v={fmtPct(ratios.divYield)} />
          <Metric l="Payout" v={`${fmtPct(ratios.payout)}${ratios.payout != null && ratios.payout > 0.9 ? ' ⚠' : ''}`} tone={ratios.payout != null && ratios.payout > 0.9 ? 'neg' : undefined} />
          <Metric l="Tasa imp. ef." v={fmtPct(ratios.effectiveTaxRate)} />
        </div>
      </Card>

      {/* Inputs DCF + nota tasa/dividendo */}
      <Card>
        <CardHeader title="Supuestos del DCF" sub="Editá los supuestos y guardalos por ticker: el Radar usará estos mismos para el score."
          right={
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={restablecer}>Restablecer</Button>
              <Button onClick={guardarSupuestos}>Guardar</Button>
            </div>
          } />
        {saveMsg && <p className="px-4 pt-3 -mb-1 text-xs text-pos">{saveMsg}</p>}
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <NumIn l="Crecimiento g" v={inp.g} step={0.01} onChange={g => setInp({ ...inp, g })} pct />
          <NumIn l="Tasa descuento d (Ke)" v={inp.d} step={0.01} onChange={d => setInp({ ...inp, d })} pct />
          <NumIn l="Crec. terminal gt" v={inp.gt} step={0.005} onChange={gt => setInp({ ...inp, gt })} pct />
          <NumIn l="Años N" v={inp.N} step={1} onChange={N => setInp({ ...inp, N })} />
          <NumIn l="MoS exigido" v={inp.mosRequired} step={0.05} onChange={mosRequired => setInp({ ...inp, mosRequired })} pct />
          <div className="col-span-2 sm:col-span-3">
            <label className="block">
            <span className="text-[10px] uppercase text-ink-600">Base de owner earnings (normalización)</span>
            <select value={inp.oeMethod ?? OE_METHOD_DEFAULT} onChange={e => setInp({ ...inp, oeMethod: e.target.value as OeMethod })}
              className={`${inputCls} mt-1`}>
              <option value="ultimo">Último año — escala real de hoy (por defecto)</option>
              <option value="ponderado">Ponderado 5 años (recientes pesan más)</option>
              <option value="prom3">Promedio 3 años</option>
              <option value="prom5">Promedio 5 años — negocio cíclico</option>
              <option value="mediana5">Mediana 5 años — hubo un año atípico</option>
              <option value="margen">Margen mediano × ventas de hoy — creció Y es cíclica</option>
            </select>
            </label>
            <p className="text-[10px] text-ink-600 mt-1 tnum">
              {oeVentana.length === 0 ? 'Sin años disponibles.'
                : oeVentana.length === 1
                  ? `Usando el año ${oeVentana[0]} → ${fmtUsd(dcf.ownerEarningsNorm, 0)}.`
                  : `Usando ${oeVentana.length} años: ${oeVentana[0]}–${oeVentana[oeVentana.length - 1]} → ${fmtUsd(dcf.ownerEarningsNorm, 0)}.`}
            </p>
            <p className="text-[10px] text-ink-500 mt-1">
              {inp.oeMethod === 'ultimo'
                ? 'Refleja la escala real de hoy. Riesgo: si ese año tuvo margen pico, un swing de capital de trabajo o una venta puntual, capitalizás ese ruido a perpetuidad. El valor es LINEAL en esta base: 25% de error acá se come todo el margen de seguridad.'
                : inp.oeMethod === 'prom5'
                  ? 'Promedia el ciclo completo. Correcto en cíclicas. En una que crece, equivale a valuar el negocio de hace ~2 años.'
                  : inp.oeMethod === 'mediana5'
                    ? 'Descarta el año atípico (un cargo puntual o una venta de activos) sin promediar todo a ciegas.'
                    : inp.oeMethod === 'prom3'
                      ? 'Ventana corta: más actual que 5 años, con algo de suavizado.'
                      : inp.oeMethod === 'margen'
                        ? 'Normaliza la RENTABILIDAD (mediana del margen) pero mantiene la ESCALA de hoy: sin rezago y sin capitalizar un margen pico. Si no hay ventas para emparejar, usa el ponderado.'
                        : 'Sigue la tendencia sin saltar al último año, con un rezago de ~1,3 años.'}
            </p>
          </div>
          <div>
            <label className="block">
            <span className="text-[10px] uppercase text-ink-600">Capex mant.</span>
            <select value={inp.capexMethod} onChange={e => setInp({ ...inp, capexMethod: e.target.value as CapexMethod })}
              className={`${inputCls} mt-1`}>
              <option value="dna">= D&A</option><option value="capex">= Capex total</option><option value="avg">promedio</option>
            </select>
            </label>
          </div>
          <div>
            <NumIn l="Beta" v={beta} step={0.1} onChange={setBeta} />
            <p className="text-[9px] text-ink-500 mt-0.5">
              {betaFetched?.beta != null
                ? `Default de mercado (${betaFetched.fuente}): ${fmtNum(betaFetched.beta, 2)} — editable`
                : 'Sin beta de mercado para este ticker — default 1.0, editable'}
            </p>
          </div>
        </div>
        {/* Nota metodológica dividendo ↔ tasa */}
        <div className="mx-4 mb-4 rounded-xl bg-celeste-500/10 border border-celeste-500/25 px-3 py-2 text-[11px] text-ink-600 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-warn mt-0.5" />
          <p>
            Div yield <b className="text-ink-800">{fmtPct(ratios.divYield)}</b> · payout <b className="text-ink-800">{fmtPct(ratios.payout)}</b>.
            El dividendo YA está dentro de los owner earnings — la tasa NO se ajusta sola por el yield (sería doble conteo).
            Un dividendo alto y estable con payout sano (&lt;70%) es señal de negocio maduro: esa menor incertidumbre puede
            justificar que VOS bajes la tasa a mano. Un payout &gt;90% es alarma (dividendo en riesgo), no calidad.
          </p>
        </div>
      </Card>

      {/* Owner earnings por año (con capex de crecimiento) */}
      <Card>
        <CardHeader title="Owner Earnings por año" sub="OCF − capex de mantenimiento. El capex de crecimiento se muestra aparte." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-[11px] text-ink-600 border-b border-line">
              <tr><th className="text-left px-4 py-2">Año</th><th className="text-right px-3">OCF</th>
                <th className="text-right px-3">Capex mant.</th><th className="text-right px-3">Capex crec.</th>
                <th className="text-right px-4">Owner Earnings</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {dcf.ownerEarningsByYear.slice(-5).map(y => (
                <tr key={y.fy} className="hover:bg-canvas">
                  <td className="px-4 py-1.5 text-ink-700">{y.fy}</td>
                  <td className="text-right px-3 tnum">{fmtUsdCompact(y.ocf)}</td>
                  <td className="text-right px-3 tnum text-ink-600">{fmtUsdCompact(y.maintenanceCapex)}</td>
                  <td className="text-right px-3 tnum text-warn">{fmtUsdCompact(y.growthCapex)}</td>
                  <td className="text-right px-4 tnum font-semibold text-ink-900">{fmtUsdCompact(y.ownerEarnings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Sensibilidad */}
      {sens && (
        <Card>
          <CardHeader title="Sensibilidad — valor intrínseco / acción" sub="Filas = crecimiento g · Columnas = tasa de descuento d" />
          <div className="overflow-x-auto p-2">
            <table className="w-full text-xs tnum">
              <thead><tr><th className="px-2 py-1 text-left text-ink-600">g \ d</th>
                {[inp.d - 0.02, inp.d, inp.d + 0.02, inp.d + 0.04].map((d, i) => <th key={i} className="px-2 py-1 text-right text-ink-600">{fmtPct(d, 0)}</th>)}</tr></thead>
              <tbody>
                {sens.map((row, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1 text-ink-600">{fmtPct(row.g, 0)}</td>
                    {row.cells.map((c, j) => {
                      const good = c != null && price != null && c > price;
                      return <td key={j} className={`px-2 py-1 text-right ${good ? 'text-pos' : 'text-ink-700'}`}>{fmtUsd(c, 0)}{good ? ' ✓' : ''}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Chequeos Munger */}
      <Card>
        <CardHeader title="Chequeos Munger" />
        <div className="p-4 space-y-2">
          {[...dcf.mungerChecks, checkRecalentamiento].map((c, i) => (
            // flex-col: en mobile, label + detail compitiendo por la misma fila (con ml-auto) se
            // apretujaban y quedaban centrados verticalmente de forma rara al envolver a 2 líneas
            // cada uno. Ahora el detail va siempre debajo, indentado bajo el label.
            <div key={i} className="flex flex-col gap-0.5 text-sm">
              <div className="flex items-start gap-2">
                {c.ok ? <CheckCircle2 className="w-4 h-4 text-pos shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />}
                <span className="text-ink-700">{c.label}</span>
              </div>
              <span className="pl-6 text-[11px] text-ink-600">{c.detail}</span>
            </div>
          ))}
        </div>
      </Card>

      <GeminiAnalysis ticker={T} portfolioId={active?.id ?? null} context={{
        ratios, verdict: dcf.verdict, entityName: (fund as Fundamentals).entityName,
        // Magnitudes del DCF para que la IA fundamente con cifras reales (no solo la palabra del veredicto)
        precio: price, valorIntrinsecoPorAccion: dcf.intrinsicPerShare,
        margenDeSeguridad: dcf.marginOfSafety, ownerEarningsNorm: dcf.ownerEarningsNorm,
      }} />
    </div>
  );
}

function GeminiAnalysis({ ticker, portfolioId, context }: { ticker: string; portfolioId: string | null; context: unknown }) {
  // Persistencia: al abrir el ticker mostramos el último análisis guardado (server + cache) en vez
  // de una caja vacía. Solo se regenera si el usuario lo pide.
  const { texto: guardado, fecha } = useUltimoAnalisis(ticker, 'empresa');
  const setUltimo = useSetUltimoAnalisis();
  const [txt, setTxt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mostrado = txt ?? guardado;
  // try/finally: sin esto, cualquier excepción inesperada acá adentro dejaba `busy` en true para
  // siempre — el botón trababa en "Analizando…" sin mostrar error ni dejar reintentar (mismo bug
  // encontrado y corregido en el equivalente de renta fija, AnalisisBonoPage.tsx).
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.analisisEmpresa({ ticker, portfolio_id: portfolioId, context });
      if (r.error) setErr(r.error);
      else { setTxt(r.analisis ?? ''); if (r.analisis) setUltimo(ticker, 'empresa', r.analisis); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'error inesperado');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Análisis cualitativo (IA)" sub="Gemini interpreta los números calculados por el código. No es recomendación de inversión."
        right={<Button variant="ghost" onClick={run} disabled={busy}><Sparkles className="w-4 h-4" /> {busy ? 'Analizando…' : mostrado ? 'Regenerar' : 'Analizar'}</Button>} />
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

function Metric({ l, v, tone, hint }: { l: string; v: string; tone?: 'pos' | 'neg' | 'warn'; hint?: string }) {
  const c = tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : tone === 'warn' ? 'text-warn' : 'text-ink-900';
  return <div className="min-w-0" title={hint}><p className="text-[10px] uppercase text-ink-600 truncate">{l}{hint && <span className="text-ink-500"> ⓘ</span>}</p><p className={`font-semibold tnum truncate ${c}`}>{v}</p></div>;
}
function NumIn({ l, v, step, onChange, pct }: { l: string; v: number; step: number; onChange: (n: number) => void; pct?: boolean }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase text-ink-600">{l}{pct ? ' (%)' : ''}</span>
      <input type="number" step={pct ? step * 100 : step} value={pct ? +(v * 100).toFixed(2) : v}
        onChange={e => onChange(pct ? Number(e.target.value) / 100 : Number(e.target.value))}
        className={`${inputCls} mt-1 tnum`} />
    </label>
  );
}
