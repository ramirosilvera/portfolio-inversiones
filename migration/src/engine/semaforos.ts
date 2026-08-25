// =============================================================================
// Semáforos macro — umbrales EXACTOS de la planilla original (sección 9). Puro.
// verde = benigno · amarillo = atención · rojo = estrés.
// =============================================================================

export type Luz = 'verde' | 'amarillo' | 'rojo';

export type Grupo = 'arg' | 'global' | 'refugio';

export interface SemaforoDef {
  key: string;
  label: string;
  grupo: Grupo;
  fmt?: (v: number) => string;
  evalua: (v: number) => Luz;
  // Qué mide y por qué importa — texto fijo interpretativo, no un dato. Se muestra en /macro para
  // que la sección tenga un desarrollo real (en el Dashboard solo se ve el semáforo resumido).
  desc: string;
}

export const GRUPOS: { key: Grupo; label: string }[] = [
  { key: 'arg', label: 'Argentina' },
  { key: 'global', label: 'EE.UU. / global' },
  { key: 'refugio', label: 'Refugio' },
];

// Índices que se muestran en "Distancia al máximo histórico" — mismo trío en el resumen del
// Dashboard y en la página Macro completa, así que vive acá para que ambos usen la misma lista.
export const DD_ITEMS: { key: string; label: string }[] = [
  { key: 'sp500', label: 'S&P 500' }, { key: 'merval', label: 'Merval' }, { key: 'oro', label: 'Oro' },
];

const pct = (v: number) => `${v.toFixed(1)}%`;
const usd0 = (v: number) => `US$${Math.round(v).toLocaleString('en-US')}`;  // indicador en dólares
const ars0 = (v: number) => `$${Math.round(v).toLocaleString('es-AR')}`;    // indicador en pesos (dólar $)

export const SEMAFOROS: SemaforoDef[] = [
  { key: 'dolar_oficial', label: 'Dólar oficial', grupo: 'arg', fmt: ars0, evalua: v => v < 1200 ? 'rojo' : v < 1600 ? 'verde' : 'amarillo',
    desc: 'Tipo de cambio mayorista regulado por el BCRA. Referencia de comercio exterior y ancla de expectativas — muy atrasado (apreciado) anticipa devaluación; muy depreciado erosiona el poder de compra en pesos.' },
  { key: 'dolar_mep',     label: 'Dólar MEP',     grupo: 'arg', fmt: ars0, evalua: v => v < 1400 ? 'rojo' : v < 1750 ? 'verde' : 'amarillo',
    desc: 'Dólar bursátil (vía bonos), el que efectivamente convierte pesos a dólares sin cepo. Termómetro de la brecha cambiaria real, más fiable que el oficial cuando hay controles.' },
  { key: 'riesgo_pais',   label: 'Riesgo país',   grupo: 'arg', fmt: v => `${Math.round(v)}`, evalua: v => v < 400 ? 'verde' : v < 800 ? 'amarillo' : 'rojo',
    desc: 'Sobretasa (EMBI+) que exige el mercado para prestarle a Argentina en vez de al Tesoro de EE.UU. Define el costo — y la posibilidad real — de financiarse en dólares.' },
  { key: 'merval_usd',    label: 'Merval USD',    grupo: 'arg', fmt: usd0, evalua: v => v > 2050 ? 'rojo' : v > 1500 ? 'amarillo' : 'verde',
    desc: 'Índice líder de acciones argentinas medido en dólares (vía CCL). Mide si las empresas locales cotizan caras o baratas en términos duros, sin el ruido de la inflación en pesos.' },
  { key: 'adr_ypf',       label: 'ADR YPF',       grupo: 'arg', fmt: usd0, evalua: v => v > 40 ? 'verde' : v > 25 ? 'amarillo' : 'rojo',
    desc: 'Certificado de YPF que cotiza en la bolsa de Nueva York. Proxy del sector energético argentino y del apetito internacional por activos locales.' },
  // Índice dólar amplio (FRED, base 2006=100, ~120). Dólar fuerte = viento en contra para emergentes.
  { key: 'dollar_index',  label: 'Dólar (amplio)', grupo: 'global', fmt: v => v.toFixed(1), evalua: v => v > 126 ? 'rojo' : v > 118 ? 'amarillo' : 'verde',
    desc: 'Índice DXY: fortaleza del dólar contra una canasta de monedas desarrolladas. Un dólar global fuerte encarece el financiamiento y le saca flujo a los emergentes (Argentina incluida).' },
  // Recalibrado 2026 (S&P ~7400): el umbral original (rojo >7000) quedó estructuralmente en rojo.
  { key: 'sp500',         label: 'S&P 500',       grupo: 'global', fmt: usd0, evalua: v => v > 8600 ? 'rojo' : v > 7800 ? 'amarillo' : 'verde',
    desc: 'Índice de las 500 mayores empresas de EE.UU. Barómetro del apetito global por riesgo; en máximos sostenidos deja poco margen de suba adicional.' },
  { key: 'vix',           label: 'VIX',           grupo: 'global', fmt: v => v.toFixed(1), evalua: v => v < 20 ? 'verde' : v < 30 ? 'amarillo' : 'rojo',
    desc: '"Índice del miedo": volatilidad implícita esperada del S&P 500 a 30 días. Sube cuando el mercado empieza a temer un shock, antes de que el precio lo refleje del todo.' },
  { key: 'hy_spread',     label: 'HY spread',     grupo: 'global', fmt: pct, evalua: v => v < 4 ? 'verde' : v < 6 ? 'amarillo' : 'rojo',
    desc: 'Diferencial de tasa que exigen los bonos corporativos de alto rendimiento (high yield) sobre el Tesoro de EE.UU. Mide el apetito real por riesgo crediticio, no solo por acciones.' },
  { key: 'dgs3mo',        label: 'T-Bills 3M',    grupo: 'global', fmt: pct, evalua: v => v > 5 ? 'rojo' : v > 2 ? 'verde' : 'amarillo',
    desc: 'Tasa de las letras del Tesoro de EE.UU. a 3 meses. Referencia de la política monetaria de la Fed y del costo del dinero "libre de riesgo" para todo el resto de los activos.' },
  { key: 'oro',           label: 'Oro',           grupo: 'refugio', fmt: usd0, evalua: v => v > 4000 ? 'rojo' : v > 3000 ? 'amarillo' : 'verde',
    desc: 'Precio del oro en USD por onza. Activo refugio clásico: sube cuando crece la aversión al riesgo o la desconfianza en las monedas fiat.' },
  { key: 'bitcoin',       label: 'Bitcoin',       grupo: 'refugio', fmt: usd0, evalua: v => v > 100000 ? 'rojo' : v > 50000 ? 'amarillo' : 'verde',
    desc: 'Precio de BTC en USD. Refugio no soberano de alta volatilidad; funciona más como proxy del apetito por riesgo especulativo que como cobertura estable.' },
];

// Qué significa cada señal cuando está en amarillo/rojo (para el resumen narrativo). Es texto
// interpretativo fijo, no un dato — los números los evalúa el código arriba.
const SIGNIFICADO: Record<string, { amarillo: string; rojo: string }> = {
  dolar_oficial: { amarillo: 'oficial depreciándose', rojo: 'oficial atrasado/apreciado' },
  dolar_mep:     { amarillo: 'MEP en alza', rojo: 'MEP barato/atrasado' },
  riesgo_pais:   { amarillo: 'riesgo país elevado', rojo: 'riesgo país alto: financiamiento caro y salida del mercado' },
  merval_usd:    { amarillo: 'Merval en zona alta en USD', rojo: 'Merval caro en USD: poco margen' },
  adr_ypf:       { amarillo: 'YPF débil', rojo: 'YPF golpeada' },
  dollar_index:  { amarillo: 'dólar global firme', rojo: 'dólar global fuerte: presión sobre emergentes' },
  sp500:         { amarillo: 'S&P alto', rojo: 'S&P en nivel elevado: poco margen de suba adicional' },
  vix:           { amarillo: 'volatilidad en aumento', rojo: 'volatilidad alta: miedo en el mercado' },
  hy_spread:     { amarillo: 'crédito corporativo exigido', rojo: 'crédito corporativo estresado: aversión al riesgo' },
  dgs3mo:        { amarillo: 'tasa corta expansiva', rojo: 'tasa corta restrictiva: dinero caro' },
  // OJO: "rojo" acá es un umbral de PRECIO ABSOLUTO (ver evalua del semáforo `oro` arriba, línea
  // ~60), no una comparación contra el máximo histórico real. La distancia real al máximo (que sí
  // puede estar en negativo aunque el precio absoluto sea alto — caso real: oro cayendo 15% desde
  // su ATH mientras sigue por encima del umbral) se calcula aparte en `distanciaMaximo`/`drawdowns.ts`
  // y se muestra en el bloque "Distancia al máximo histórico" (DistanciaMaximo.tsx). Antes este texto
  // decía "oro en máximos", una afirmación falsa cuando el precio venía retrocediendo — el usuario
  // veía "en máximos" acá Y "-15% vs máx · oportunidad" en el bloque de arriba, contradictorios.
  oro:           { amarillo: 'oro firme', rojo: 'oro en nivel elevado: fuerte demanda de refugio' },
  bitcoin:       { amarillo: 'BTC elevado', rojo: 'BTC en zona eufórica' },
};

// Distancia porcentual al máximo (drawdown): actual/max − 1. 0 = en máximos; negativo = por debajo.
export function distanciaMaximo(actual: number | null | undefined, max: number | null | undefined): number | null {
  if (actual == null || max == null || !(max > 0) || !Number.isFinite(actual)) return null;
  return actual / max - 1;
}

// Caída desde el máximo: >20% = estrés (rojo), >5% = corrección para vigilar (amarillo), si no
// verde. Antes ambas ramas devolvían 'rojo', así que un retroceso trivial del 0,1% marcaba estrés
// y el tramo ">20%" era código muerto.
export function sp500Drawdown(actual: number, maximoHistorico: number): { pct: number; luz: Luz } {
  const caida = maximoHistorico > 0 ? (maximoHistorico - actual) / maximoHistorico : 0;
  return { pct: caida, luz: caida > 0.20 ? 'rojo' : caida > 0.05 ? 'amarillo' : 'verde' };
}

export interface Sintesis { rojos: number; texto: string; luz: Luz; }

// ≥4 rojos → estrés creciente; ≥2 → vulnerabilidad moderada; si no, estable.
export function sintesis(luces: Luz[]): Sintesis {
  const rojos = luces.filter(l => l === 'rojo').length;
  if (rojos >= 4) return { rojos, texto: 'Estrés creciente', luz: 'rojo' };
  if (rojos >= 2) return { rojos, texto: 'Vulnerabilidad moderada', luz: 'amarillo' };
  return { rojos, texto: 'Panorama estable', luz: 'verde' };
}

export interface Lectura { def: SemaforoDef; valor: number | null; luz: Luz | null; }
export interface Alerta { key: string; label: string; grupo: Grupo; luz: Exclude<Luz, 'verde'>; msg: string; }
export interface ResumenMacro {
  luz: Luz; titulo: string; parrafo: string;
  conteo: { verdes: number; amarillos: number; rojos: number; total: number };
  alertas: Alerta[];   // señales en amarillo/rojo, con su significado
}

// Resumen narrativo del contexto macro a partir de las lecturas. Rule-based (sin IA): describe
// cuántas señales hay en cada color, el estado general y dónde están los focos (Argentina vs global).
export function resumenMacro(lecturas: Lectura[]): ResumenMacro {
  const con = lecturas.filter(l => l.luz != null) as (Lectura & { luz: Luz })[];
  const verdes = con.filter(l => l.luz === 'verde').length;
  const amarillos = con.filter(l => l.luz === 'amarillo').length;
  const rojos = con.filter(l => l.luz === 'rojo').length;
  const s = sintesis(con.map(l => l.luz));

  const alertas: Alerta[] = con
    .filter(l => l.luz !== 'verde')
    .map(l => ({ key: l.def.key, label: l.def.label, grupo: l.def.grupo, luz: l.luz as 'amarillo' | 'rojo', msg: SIGNIFICADO[l.def.key]?.[l.luz as 'amarillo' | 'rojo'] ?? '' }))
    .filter(a => a.msg)
    .sort((a, b) => (a.luz === b.luz ? 0 : a.luz === 'rojo' ? -1 : 1));

  const partes: string[] = [];
  if (con.length === 0) {
    partes.push('Todavía no hay datos de mercado cargados; se completan con el refresco.');
  } else {
    partes.push(`De ${con.length} indicadores, ${verdes} en verde, ${amarillos} en amarillo y ${rojos} en rojo.`);
    partes.push(
      rojos >= 4 ? 'El tablero muestra estrés generalizado: conviene cautela, calidad y algo de liquidez.'
      : rojos >= 2 ? 'Hay focos de tensión puntuales, pero el resto se mantiene contenido.'
      : amarillos >= 3 ? 'Panorama en general benigno, con algunas señales para vigilar.'
      : 'Panorama mayormente benigno, sin señales de estrés amplias.');
    const nombra = (g: Grupo) => alertas.filter(a => a.grupo === g).map(a => a.msg);
    const arg = nombra('arg'); if (arg.length) partes.push(`En Argentina: ${arg.join('; ')}.`);
    const glob = nombra('global'); if (glob.length) partes.push(`En lo global/EE.UU.: ${glob.join('; ')}.`);
    const ref = nombra('refugio'); if (ref.length) partes.push(`Refugios: ${ref.join('; ')}.`);
  }

  return {
    luz: s.luz, titulo: s.texto,
    parrafo: partes.join(' '),
    conteo: { verdes, amarillos, rojos, total: con.length },
    alertas,
  };
}
