import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { alertasEstres, claveAlertaDia, fechaLocalISO, INDICADORES_ESTRES, type PosAlloc } from '../engine/alertaMacro';
import { SEMAFOROS } from '../engine/semaforos';
import { fmtPct, fmtUsdCompact } from './ui';

const LS_KEY = 'macro.alertaEstres.descartada';
const leer = (): string | null => { try { return localStorage.getItem(LS_KEY); } catch { return null; } };
const guardar = (v: string) => { try { localStorage.setItem(LS_KEY, v); } catch { /* sin storage: se muestra de nuevo al recargar */ } };
// Indicadores que estaban en alerta la última vez (para la histéresis: siguen en alerta hasta salir de la banda).
const LS_ACTIVOS = 'macro.alertaEstres.activos';
const leerActivos = (): Set<string> => { try { const a = JSON.parse(localStorage.getItem(LS_ACTIVOS) ?? '[]'); return new Set(Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []); } catch { return new Set(); } };
const guardarActivos = (keys: string[]) => { try { localStorage.setItem(LS_ACTIVOS, JSON.stringify(keys)); } catch { /* sin storage: sin histéresis entre sesiones */ } };

// Alerta en Inicio cuando un indicador de estrés REAL del contexto macro está en rojo: dato clave, qué implica y cuánto de tu cartera está
// expuesto. Visible mientras dure; se puede descartar por hoy y vuelve mañana, o ya hoy si aparece otro indicador en rojo.
export function AlertaMacroEstres({ macro, alloc, patrimonio }: { macro: Record<string, number | null | undefined>; alloc: PosAlloc[]; patrimonio: number }) {
  const [activos] = useState(leerActivos);
  const alertas = useMemo(() => alertasEstres(macro, alloc, patrimonio, activos), [macro, alloc, patrimonio, activos]);
  // Solo se recuerdan los activos cuando el macro YA cargó (si no, una recarga con datos pendientes borraba la histéresis).
  const macroCargado = INDICADORES_ESTRES.some(k => macro[k] != null);
  useEffect(() => { if (macroCargado) guardarActivos(alertas.map(a => a.key)); }, [macroCargado, alertas]);
  const clave = claveAlertaDia(fechaLocalISO(), alertas);
  const [descartada, setDescartada] = useState<string | null>(leer);
  if (alertas.length === 0 || descartada === clave) return null;
  const fmt = (key: string, v: number) => SEMAFOROS.find(s => s.key === key)?.fmt?.(v) ?? String(v);
  return (
    <div role="alert" className="rounded-xl bg-neg/10 ring-1 ring-inset ring-neg/25 px-3 py-2.5 text-[11px] text-ink-800 space-y-1.5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 text-neg mt-0.5" />
        <p className="font-semibold flex-1">Estrés macro: {alertas.length === 1 ? '1 indicador en alerta' : `${alertas.length} indicadores en alerta`}</p>
        <button onClick={() => { guardar(clave); setDescartada(clave); }} aria-label="Descartar por hoy" title="Descartar por hoy"
          className="text-ink-600 hover:text-ink-900 -m-2 inline-flex items-center justify-center w-9 h-9 shrink-0"><X className="w-4 h-4" /></button>
      </div>
      <ul className="space-y-1.5 pl-6">
        {alertas.map(a => (
          <li key={a.key}>
            <span className="font-semibold">{a.label} {fmt(a.key, a.valor)}</span>
            <span className="text-ink-600"> ({a.enBanda ? `bajó del umbral; sigue en alerta hasta ${a.salida}` : a.umbral})</span> — {a.significado}.
            {/* Sin patrimonio cargado (posiciones todavía en vuelo) no se afirma nada: antes decía «Tu cartera no tiene…» mientras cargaba. */}
            {patrimonio > 0 && (
              <span className="block text-ink-700">
                {a.expuestoUsd > 0
                  ? <>Tu cartera: <b className="tnum">{a.expuestoPct != null ? fmtPct(a.expuestoPct, 0) : '—'}</b> ({fmtUsdCompact(a.expuestoUsd)}) en {a.expuestoEtiqueta}.</>
                  : <>Tu cartera no tiene {a.expuestoEtiqueta}.</>}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="pl-6 flex items-center gap-3 flex-wrap">
        <Link to="/macro" className="font-semibold text-celeste-600 hover:underline">Ver contexto macro →</Link>
        <span className="text-ink-500">La exposición es una estimación por tipo de activo, no una predicción de pérdida.</span>
      </div>
    </div>
  );
}
