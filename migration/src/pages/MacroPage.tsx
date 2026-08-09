import { useState } from 'react';
import { Globe, Sparkles } from 'lucide-react';
import { useMacro, useDrawdowns } from '../hooks/usePosiciones';
import { useUltimoAnalisis, useSetUltimoAnalisis } from '../hooks/useAnalisisIA';
import { SEMAFOROS, GRUPOS, resumenMacro, type Luz, type Lectura } from '../engine/semaforos';
import { api } from '../lib/api';
import { Card, CardHeader, Button, Badge, normalizeAiText } from '../components/ui';
import { DistanciaMaximo } from '../components/DistanciaMaximo';

const LUZ_DOT: Record<Luz, string> = { verde: 'bg-pos', amarillo: 'bg-warn', rojo: 'bg-neg' };
// Palabra para lectores de pantalla — el semáforo es solo color, esto lo hace accesible sin rediseñarlo.
const LUZ_LABEL: Record<Luz, string> = { verde: 'benigno', amarillo: 'atención', rojo: 'estrés' };
const TONE_ALERTA: Record<'amarillo' | 'rojo', 'warn' | 'neg'> = { amarillo: 'warn', rojo: 'neg' };

// Contexto macro completo: semáforos + distancia a máximos históricos + focos de atención +
// indicadores agrupados por área + lectura ejecutiva por IA. Es global (no depende del portfolio
// activo). El Dashboard muestra solo una versión resumida de esto (título + distancia a máximos +
// barra de salud) con un link acá para el detalle completo.
export function MacroPage() {
  const { data: macro = {} } = useMacro();
  const { data: dd = {} } = useDrawdowns();
  const { texto: guardado, fecha } = useUltimoAnalisis('MACRO', 'macro');
  const setUltimo = useSetUltimoAnalisis();
  const [ia, setIa] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mostrado = ia ?? guardado;

  const semaforos: Lectura[] = SEMAFOROS.map(s => {
    const v = (macro as Record<string, number | null>)[s.key];
    return { def: s, valor: v ?? null, luz: v != null ? s.evalua(v) : null };
  });
  const resumen = resumenMacro(semaforos);
  const conDatos = semaforos.filter(r => r.luz);

  async function explicar() {
    setBusy(true); setErr(null);
    const r = await api.analisisMacro({
      indicadores: conDatos.map(r => ({ indicador: r.def.label, grupo: r.def.grupo, valor: r.valor != null && r.def.fmt ? r.def.fmt(r.valor) : r.valor, estado: r.luz })),
    });
    if (r.error) setErr(r.error);
    else { setIa(r.analisis ?? ''); if (r.analisis) setUltimo('MACRO', 'macro', r.analisis); }
    setBusy(false);
  }

  const tone = resumen.luz === 'rojo' ? 'neg' : resumen.luz === 'amarillo' ? 'warn' : 'pos';
  const { verdes, amarillos, rojos, total } = resumen.conteo;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="w-5 h-5 text-accent" />
        <h1 className="text-2xl font-bold text-ink-900 font-display">Contexto macro</h1>
      </div>

      <Card>
        <CardHeader title="Panorama" sub="Semáforos, síntesis y lectura ejecutiva."
          right={<Badge tone={tone}>{resumen.titulo}</Badge>} />

        <DistanciaMaximo dd={dd} />

        {/* Salud del tablero: barra verde/amarillo/rojo + leyenda (visual, de un vistazo). */}
        {total === 0 ? (
          <div className="px-4 pt-3.5"><p className="text-sm text-ink-600">Todavía no hay datos de mercado; se completan con el próximo refresco.</p></div>
        ) : (
          <div className="px-4 pt-3.5">
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

        {/* Síntesis: párrafo narrativo generado por reglas (no IA) a partir de los semáforos —
            conteo, estado general y foco por área. Complementa la barra de salud con contexto en
            prosa, sin depender de la lectura ejecutiva (que sí llama a un modelo). */}
        {resumen.parrafo && (
          <div className="px-4 pt-3">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-500 mb-1.5">Síntesis</p>
            <p className="text-sm text-ink-800 leading-relaxed">{resumen.parrafo}</p>
          </div>
        )}

        {/* Focos de atención: solo las señales que no están en verde (lo accionable, de un vistazo). */}
        {resumen.alertas.length > 0 && (
          <div className="px-4 pt-3">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-500 mb-1.5">Focos de atención</p>
            <div className="flex flex-wrap gap-1.5">
              {resumen.alertas.map(a => <Badge key={a.key} tone={TONE_ALERTA[a.luz]} wrap>{a.label}: {a.msg}</Badge>)}
            </div>
          </div>
        )}

        {/* Los 12 indicadores completos, agrupados por área, siempre visibles (esta página existe
            para desarrollar el detalle que el resumen del Dashboard no muestra) — valor, semáforo
            y qué mide/por qué importa cada uno. */}
        <div className="px-4 pt-3 pb-1 space-y-4">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-500">Los {SEMAFOROS.length} indicadores</p>
          {GRUPOS.map(g => {
            const items = semaforos.filter(r => r.def.grupo === g.key);
            if (!items.length) return null;
            return (
              <div key={g.key}>
                <p className="text-[9px] uppercase tracking-wide text-ink-500 mb-1.5">{g.label}</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {items.map(({ def, valor, luz }) => (
                    <div key={def.key} className="rounded-xl bg-canvas ring-1 ring-inset ring-line px-3 py-2.5 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink-900">{def.label}</span>
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-600 shrink-0">
                          <span className={`w-1.5 h-1.5 rounded-full ${luz ? LUZ_DOT[luz] : 'bg-ink-300'}`}
                            title={luz ? LUZ_LABEL[luz] : 'sin dato'} aria-label={luz ? LUZ_LABEL[luz] : 'sin dato'} role="img" />
                          {luz ? LUZ_LABEL[luz] : 'sin dato'}
                        </span>
                      </div>
                      <p className="text-lg font-bold tnum text-ink-900 mt-0.5">{valor != null && def.fmt ? def.fmt(valor) : valor ?? '—'}</p>
                      <p className="text-[11px] text-ink-600 mt-1 leading-snug">{def.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Lectura ejecutiva por IA: un solo párrafo. */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" onClick={explicar} disabled={busy || conDatos.length === 0}>
              <Sparkles className="w-4 h-4" /> {busy ? 'Analizando…' : mostrado ? 'Volver a analizar' : 'Lectura ejecutiva (IA)'}
            </Button>
            {err && <span className="text-[11px] text-neg">No se pudo generar: {err}</span>}
          </div>
          {mostrado && (
            <div className="mt-2 rounded-xl bg-canvas ring-1 ring-inset ring-line px-3 py-2.5">
              <p className="text-sm text-ink-800 leading-relaxed whitespace-pre-wrap break-words">{normalizeAiText(mostrado)}</p>
              <p className="text-[10px] text-ink-600 mt-1.5">Lectura por IA · los valores los calcula el código.{!ia && fecha && ` · ${new Date(fecha).toLocaleDateString('es-AR')}`}</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
