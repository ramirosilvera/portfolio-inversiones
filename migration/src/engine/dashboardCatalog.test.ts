import { describe, it, expect, afterEach } from 'vitest';
import {
  METRIC_CATALOG, SECCION_CATALOG, DEFAULT_LAYOUT, ALIASES,
  resolveKey, getMetricDef, getSeccionDef, resolveViz, tituloWidget,
} from './dashboardCatalog';

describe('METRIC_CATALOG', () => {
  it('keys únicas', () => {
    const keys = METRIC_CATALOG.map(m => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('vizDefault siempre está incluido en vizDisponibles', () => {
    for (const m of METRIC_CATALOG) {
      expect(m.vizDisponibles).toContain(m.vizDefault);
    }
  });

  it('ninguna métrica queda sin visualizaciones', () => {
    for (const m of METRIC_CATALOG) expect(m.vizDisponibles.length).toBeGreaterThan(0);
  });

  it('shape scalar solo admite viz "stat" — no tiene sentido un escalar como donut/bar/table', () => {
    for (const m of METRIC_CATALOG.filter(m => m.shape === 'scalar')) {
      expect(m.vizDisponibles).toEqual(['stat']);
    }
  });

  it('shape categorico nunca admite "stat" — un desglose no es un número único', () => {
    for (const m of METRIC_CATALOG.filter(m => m.shape === 'categorico')) {
      expect(m.vizDisponibles).not.toContain('stat');
    }
  });

  it('todo título no vacío', () => {
    for (const m of METRIC_CATALOG) expect(m.titulo.trim().length).toBeGreaterThan(0);
  });

  it('detalleHref, cuando está presente, es una ruta interna (empieza con "/")', () => {
    for (const m of METRIC_CATALOG.filter(m => m.detalleHref)) {
      expect(m.detalleHref).toMatch(/^\//);
    }
  });

  // Mismas rutas que declara App.tsx (<Route path="...">) — un typo acá ("/cedars") no rompe el
  // build (el catch-all de App.tsx lo manda silenciosamente a "/"), así que el único chequeo real es
  // este: la ruta tiene que existir en la lista, no solo "empezar con /".
  const RUTAS_APP = ['/cedears', '/bonos', '/cupones', '/radar', '/finanzas', '/macro'];

  it('detalleHref apunta a una ruta que existe en App.tsx', () => {
    for (const m of METRIC_CATALOG.filter(m => m.detalleHref)) {
      expect(RUTAS_APP).toContain(m.detalleHref);
    }
  });

  it('solo las 2 métricas de Cartera (sin página propia) quedan sin detalleHref', () => {
    const sinHref = METRIC_CATALOG.filter(m => !m.detalleHref).map(m => m.key);
    expect(sinHref.sort()).toEqual(['distribucion_categoria', 'distribucion_tipo_activo']);
  });
});

describe('SECCION_CATALOG', () => {
  it('keys únicas', () => {
    const keys = SECCION_CATALOG.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('DEFAULT_LAYOUT', () => {
  it('ids únicos', () => {
    const ids = DEFAULT_LAYOUT.map(w => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('toda sección referenciada existe en SECCION_CATALOG', () => {
    const seccionKeys = new Set(SECCION_CATALOG.map(s => s.key));
    for (const w of DEFAULT_LAYOUT) {
      if (w.kind === 'seccion') expect(seccionKeys.has(w.seccion)).toBe(true);
    }
  });

  it('son todas kind:"seccion" (el layout default no inventa tarjetas atómicas)', () => {
    expect(DEFAULT_LAYOUT.every(w => w.kind === 'seccion')).toBe(true);
  });
});

describe('resolveKey / getMetricDef / getSeccionDef', () => {
  // ALIASES es un singleton a nivel de módulo y hoy YA trae alias reales de producción (ver
  // dashboardCatalog.ts) — el afterEach no puede simplemente vaciarlo (eso borraría también los
  // alias reales para el resto de la test suite); restaura la foto tomada al cargar este archivo,
  // así los tests de acá abajo pueden agregar/mutar libremente sin dejar nada pegado.
  const aliasesBase = { ...ALIASES };
  afterEach(() => {
    for (const k of Object.keys(ALIASES)) delete ALIASES[k];
    Object.assign(ALIASES, aliasesBase);
  });

  it('sin alias: devuelve la key tal cual', () => {
    expect(resolveKey('bonos_capital')).toBe('bonos_capital');
  });

  it('con alias: resuelve a la key nueva', () => {
    ALIASES['vieja_key'] = 'bonos_capital';
    expect(resolveKey('vieja_key')).toBe('bonos_capital');
    expect(getMetricDef('vieja_key')?.key).toBe('bonos_capital');
  });

  it('key inexistente: undefined, no revienta', () => {
    expect(getMetricDef('no_existe')).toBeUndefined();
    expect(getSeccionDef('no_existe')).toBeUndefined();
  });

  it('alias real de producción: "aportes" (sección vieja, fusionada) resuelve a rendimiento_por_anio', () => {
    expect(resolveKey('aportes')).toBe('rendimiento_por_anio');
    expect(getSeccionDef('aportes')?.key).toBe('rendimiento_por_anio');
  });

  // ALIASES es un solo namespace compartido entre métricas y secciones (mismo Record) — nada impide
  // a mano escribir un alias que apunte a una key que no existe en NINGÚN catálogo (typo) o que
  // "resucite" una key que un día se vuelva a agregar al catálogo (quedaría inalcanzable, oculta
  // detrás del alias). Este test corre sobre los alias REALES de producción, no sobre mutaciones del
  // test (por eso no está en el describe de arriba, que restaura `aliasesBase`).
  it('todo alias apunta a una key que existe en algún catálogo (métrica o sección)', () => {
    const targets = new Set([...METRIC_CATALOG.map(m => m.key), ...SECCION_CATALOG.map(s => s.key)] as string[]);
    for (const [origen, destino] of Object.entries(ALIASES)) {
      expect(targets.has(destino), `ALIASES['${origen}'] apunta a '${destino}', que no existe en ningún catálogo`).toBe(true);
    }
  });

  it('ningún alias tiene como origen una key que TAMBIÉN existe hoy en el catálogo (se volvería inalcanzable)', () => {
    const keys = new Set([...METRIC_CATALOG.map(m => m.key), ...SECCION_CATALOG.map(s => s.key)] as string[]);
    for (const origen of Object.keys(ALIASES)) {
      expect(keys.has(origen), `'${origen}' está en ALIASES pero también sigue en el catálogo — quedó inalcanzable`).toBe(false);
    }
  });
});

describe('resolveViz', () => {
  it('viz válido para la métrica: se devuelve igual', () => {
    expect(resolveViz('distribucion_categoria', 'bar')).toBe('bar');
  });

  it('viz inválido para la métrica: cae al vizDefault de esa métrica', () => {
    expect(resolveViz('bonos_capital', 'donut')).toBe('stat');
  });

  it('métrica inexistente: devuelve el viz tal cual (no hay catálogo contra el cual validar)', () => {
    expect(resolveViz('no_existe', 'bar')).toBe('bar');
  });
});

describe('tituloWidget', () => {
  it('1 sola métrica: su propio título de catálogo', () => {
    expect(tituloWidget(['bonos_capital'])).toBe('Capital en bonos');
  });

  it('1 métrica inexistente: cae a la key tal cual', () => {
    expect(tituloWidget(['no_existe'])).toBe('no_existe');
  });

  it('2+ métricas de la misma categoría: el nombre de la categoría', () => {
    expect(tituloWidget(['bonos_tir_promedio', 'bonos_duracion_promedio', 'bonos_proximo_capital'])).toBe('Bonos');
  });

  it('2+ métricas de categorías distintas: unión de títulos', () => {
    expect(tituloWidget(['bonos_capital', 'liquidez_disponible'])).toBe('Capital en bonos · Disponible');
  });

  it('2+ métricas con alguna inexistente: no colapsa a "misma categoría", usa la key cruda para la que falta', () => {
    expect(tituloWidget(['bonos_capital', 'no_existe'])).toBe('Capital en bonos · no_existe');
  });

  it('WidgetGrid y AddWidgetModal comparten esta MISMA función — mismo resultado sin importar el orden de guardado', () => {
    expect(tituloWidget(['bonos_duracion_promedio', 'bonos_tir_promedio'])).toBe(tituloWidget(['bonos_tir_promedio', 'bonos_duracion_promedio']));
  });
});
