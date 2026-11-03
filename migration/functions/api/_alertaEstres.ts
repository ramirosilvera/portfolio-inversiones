// Estado de la alerta de estrés macro (la «banda» de la histéresis), calculado por el CRON y guardado en macro_cache para que todos los
// dispositivos vean lo mismo. Puro y testeado; la lectura/escritura de la base vive en cron/refresh-all.ts.
import { INDICADORES_ESTRES, siguienteActivos } from '../../src/engine/alertaMacro';
import { sanearMacro } from '../../src/engine/macroRangos';

export interface FilaMacro { clave: string; valor: number | null; data_json?: unknown }

const comoSet = (v: unknown): Set<string> => new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

// Devuelve la lista nueva de indicadores en alerta, o null si no hay que escribir nada (sin cambios). Un valor imposible (dato corrupto)
// se descarta antes de evaluar, igual que en el cliente; si NO llegó ningún valor de los indicadores no se toca el estado.
export function nuevoEstadoActivos(filas: FilaMacro[], claveEstado: string): string[] | null {
  const macro: Record<string, number | null> = {};
  for (const f of filas) if ((INDICADORES_ESTRES as readonly string[]).includes(f.clave)) macro[f.clave] = f.valor;
  if (!Object.values(macro).some(v => v != null)) return null;
  const previoFila = filas.find(f => f.clave === claveEstado);
  const previos = comoSet(previoFila?.data_json);
  const nuevos = siguienteActivos(sanearMacro(macro), previos);
  const igual = previoFila != null && nuevos.length === previos.size && nuevos.every(k => previos.has(k));
  return igual ? null : nuevos;
}
