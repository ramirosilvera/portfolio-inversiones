import { useState, useEffect } from 'react';
import { Plus, Trash2, TrendingUp, TrendingDown, PiggyBank, AlertCircle } from 'lucide-react';
import { useFlujo, useFlujoMutations } from '../hooks/useFlujo';
import { useMacro } from '../hooks/usePosiciones';
import { resumenFlujo, type FlujoDestino } from '../engine/flujo';
import { Card, CardHeader, Button, Empty, inputCls, fmtPct, fmtArs } from '../components/ui';
import type { FlujoItem, FlujoCategoria } from '../types/domain';
import type { ResumenFlujo } from '../engine/flujo';

const DESTINOS: { key: FlujoDestino; label: string }[] = [
  { key: 'fci', label: 'FCI' },
  { key: 'mercadopago', label: 'Mercado Pago' },
  { key: 'cedears', label: 'CEDEARs' },
  { key: 'bonos', label: 'Bonos' },
  { key: 'efectivo', label: 'Efectivo' },
  { key: 'otro', label: 'Otro' },
];
const destinoLabel = (d: string | null) => DESTINOS.find(x => x.key === d)?.label ?? '—';

const SECCIONES: { cat: FlujoCategoria; titulo: string; sub: string; icon: typeof TrendingUp; nuevo: string }[] = [
  { cat: 'ingreso', titulo: 'Ingresos', sub: 'Sueldo y otras entradas.', icon: TrendingUp, nuevo: 'Nuevo ingreso' },
  { cat: 'egreso', titulo: 'Egresos', sub: 'Tarjetas y gastos principales.', icon: TrendingDown, nuevo: 'Nuevo egreso' },
  { cat: 'inversion', titulo: 'Inversiones / asignaciones', sub: 'A dónde va lo que te queda: FCI, Mercado Pago, CEDEARs, bonos.', icon: PiggyBank, nuevo: 'Nueva asignación' },
];

export function FinanzasPage() {
  const { data: items = [], isLoading } = useFlujo();
  const { add } = useFlujoMutations();
  const { data: macro = {} } = useMacro();
  const [error, setError] = useState<string | null>(null);
  const mep = (macro as Record<string, number | null>).dolar_mep ?? (macro as Record<string, number | null>).dolar_ccl ?? null;
  const r = resumenFlujo(items, mep);

  const agregar = (cat: FlujoCategoria, orden: number) => {
    setError(null);
    add(cat, { orden }).catch(e => setError(`No se pudo agregar la fila: ${e instanceof Error ? e.message : 'error'}`));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold text-ink-900 font-display">Finanzas · flujo de caja</h1>
        <span className="text-xs text-ink-600">{mep != null ? `MEP ${fmtArs(mep)}` : 'MEP no disponible'}</span>
      </div>

      <ResumenFlujoCard r={r} />

      {r.pendientesConversion > 0 && (
        <p className="text-[11px] text-warn">
          {r.pendientesConversion} fila(s) en USD sin poder convertir (no hay MEP disponible); no se suman a los totales hasta que vuelva el dato.
        </p>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-neg/10 ring-1 ring-neg/20 px-3 py-2 text-sm text-neg">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {isLoading ? (
        <Card><div className="p-6 text-sm text-ink-600">Cargando flujo…</div></Card>
      ) : (
        SECCIONES.map(s => {
          const suyas = items.filter(i => i.categoria === s.cat);
          return <Seccion key={s.cat} def={s} items={suyas} mep={mep} onAdd={() => agregar(s.cat, suyas.length)} />;
        })
      )}

      <p className="text-[11px] text-ink-600 leading-relaxed">
        Es tu planilla: agregá o quitá filas, editá conceptos y montos como en Excel (se guardan solos al salir del campo).
        Los totales los calcula el código; el MEP convierte las filas en USD. La parte de FCI + Mercado Pago se muestra en el Dashboard.
      </p>
    </div>
  );
}

// Resumen condensado + barra cascada: cómo se reparte el ingreso (egresos / asignado / sin asignar).
function ResumenFlujoCard({ r }: { r: ResumenFlujo }) {
  const I = r.ingresos, E = r.egresos, A = r.invertido, S = r.sinAsignar;
  const denom = Math.max(I, E + A, 1);
  const seg = [
    { key: 'egr', label: 'Egresos', monto: E, w: E / denom, cls: 'bg-neg/70', dot: 'bg-neg' },
    { key: 'asig', label: 'Asignado', monto: A, w: A / denom, cls: 'bg-celeste-500', dot: 'bg-celeste-500' },
    { key: 'sin', label: 'Sin asignar', monto: Math.max(0, S), w: Math.max(0, S) / denom, cls: 'bg-pos/60', dot: 'bg-pos' },
  ];
  return (
    <Card>
      <div className="p-4">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-ink-600 font-semibold">Disponible del mes</p>
            {/* Único lugar de la app que imprime un monto ARS sin compactar a tamaño hero — con
                inflación real esto puede llegar a muchas cifras; min-w-0 + truncate (con el valor
                completo en title) evita que se salga de la Card en mobile, misma clase de bug que
                se arregló en Stat (ui.tsx). */}
            <p className={`text-2xl font-bold font-display tnum truncate ${r.disponible >= 0 ? 'text-ink-900' : 'text-neg'}`} title={fmtArs(r.disponible)}>{fmtArs(r.disponible)}</p>
            <p className="text-[11px] text-ink-600 tnum truncate">de {fmtArs(I)} de ingresos</p>
          </div>
          <div className="text-right">
            {r.tasaAhorro != null && (
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${r.tasaAhorro >= 0 ? 'bg-pos/10 text-pos ring-1 ring-pos/20' : 'bg-neg/10 text-neg ring-1 ring-neg/20'}`}>
                ahorro {fmtPct(r.tasaAhorro, 0)}
              </span>
            )}
            <p className="text-[11px] text-ink-600 mt-1 tnum">FCI + billetera {fmtArs(r.fci)}</p>
          </div>
        </div>

        {/* Barra cascada. */}
        <div className="mt-3 h-3 rounded-full bg-canvas overflow-hidden flex">
          {seg.map(s => s.w > 0 && <div key={s.key} className={s.cls} style={{ width: `${Math.min(100, s.w * 100)}%` }} title={`${s.label}: ${fmtArs(s.monto)}`} />)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {seg.map(s => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-ink-600">
              <span className={`w-2 h-2 rounded-full ${s.dot}`} /> {s.label} <span className="tnum font-semibold text-ink-800">{fmtArs(s.monto)}</span>
            </span>
          ))}
        </div>
        {S < 0 && <p className="mt-2 text-[11px] text-warn">Estás asignando más de lo disponible ({fmtArs(-S)} de más): revisá las inversiones o los egresos.</p>}
      </div>
    </Card>
  );
}

function Seccion({ def, items, mep, onAdd }: {
  def: { cat: FlujoCategoria; titulo: string; sub: string; icon: typeof TrendingUp; nuevo: string };
  items: FlujoItem[]; mep: number | null; onAdd: () => void;
}) {
  const Icon = def.icon;
  // Total en ARS convirtiendo USD con el MEP — coherente con la cascada de arriba. Sin MEP, las
  // filas en USD no se cuentan (igual que en resumenFlujo).
  const total = items.filter(i => i.activo)
    .reduce((s, i) => s + (i.moneda === 'USD' ? (mep ? i.monto * mep : 0) : i.monto), 0);
  return (
    <Card>
      <CardHeader title={def.titulo} sub={def.sub}
        right={<span className="text-xs text-ink-600 tnum">{fmtArs(total)}</span>} />
      <div className="divide-y divide-line">
        <div className="hidden sm:flex items-center gap-2 px-4 py-1.5 text-[10px] uppercase tracking-wide text-ink-500 font-semibold">
          <span className="w-4" />
          <span className="flex-1">Concepto</span>
          <span className="w-32 text-right">Monto</span>
          <span className="w-20">Moneda</span>
          {def.cat === 'inversion' && <span className="w-32">Destino</span>}
          <span className="w-9" />
        </div>
        {items.map(it => <Row key={it.id} it={it} />)}
        {items.length === 0 && (
          <div className="px-4 py-6"><Empty icon={Icon} title={`Sin ${def.titulo.toLowerCase()}`}>Agregá la primera fila.</Empty></div>
        )}
      </div>
      <div className="px-4 py-3 border-t border-line">
        <Button variant="ghost" onClick={onAdd}><Plus className="w-4 h-4" /> {def.nuevo}</Button>
      </div>
    </Card>
  );
}

// Fila editable estilo planilla: los campos de texto/número se guardan al salir (onBlur); el
// checkbox y los selects se guardan al instante. Mantiene un borrador local para no escribir en la
// base con cada tecla. Si un guardado falla, se avisa y NO se pierde lo tipeado (para reintentar).
// Solo dígitos y un único punto decimal — así un pegado con separador de miles (o cualquier otra
// basura) nunca deja el borrador en un estado que Number() no pueda parsear bien.
const sanitizeMontoInput = (s: string): string => {
  const cleaned = s.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
};

function Row({ it }: { it: FlujoItem }) {
  const { update, remove } = useFlujoMutations();
  const [concepto, setConcepto] = useState(it.concepto);
  const [monto, setMonto] = useState(it.monto ? String(it.monto) : '');
  const [montoFocused, setMontoFocused] = useState(false);
  const [err, setErr] = useState(false);

  // Si el ítem cambia desde afuera (refetch), sincronizamos el borrador — salvo que haya un guardado
  // fallido pendiente, para no pisar lo que el usuario todavía no pudo guardar.
  useEffect(() => { if (!err) setConcepto(it.concepto); }, [it.concepto, err]);
  useEffect(() => { if (!err) setMonto(it.monto ? String(it.monto) : ''); }, [it.monto, err]);

  const save = (patch: Partial<FlujoItem>) => { setErr(false); update(it.id, patch).catch(() => setErr(true)); };
  const commitConcepto = () => { if (concepto !== it.concepto) save({ concepto }); };
  const commitMonto = () => { const n = Number(monto) || 0; if (n !== it.monto) save({ monto: n }); };
  // Con foco: el número crudo, fácil de tipear sin que el cursor pelee con separadores. Sin foco:
  // con separador de miles (es-AR) — un sueldo de 7 cifras se lee de un vistazo, no se cuentan ceros.
  const montoDisplay = montoFocused || !monto ? monto : Number(monto).toLocaleString('es-AR', { maximumFractionDigits: 2 });

  return (
    <div className={`flex flex-wrap sm:flex-nowrap items-center gap-2 px-4 py-2 ${it.activo ? '' : 'opacity-45'} ${err ? 'ring-1 ring-inset ring-neg/40 rounded-lg' : ''}`}>
      <input type="checkbox" checked={it.activo} onChange={() => save({ activo: !it.activo })}
        title={it.activo ? 'Cuenta en los totales (destildar para excluir)' : 'Excluida de los totales'}
        aria-label="Contar en los totales" className="w-4 h-4 shrink-0 accent-celeste-500 cursor-pointer" />
      <input value={concepto} onChange={e => setConcepto(e.target.value)} onBlur={commitConcepto}
        placeholder="Concepto (ej. Sueldo)" className={`${inputCls} flex-1 min-w-[8rem]`} />
      <input type="text" inputMode="decimal" value={montoDisplay}
        onFocus={() => setMontoFocused(true)}
        onChange={e => setMonto(sanitizeMontoInput(e.target.value))}
        onBlur={() => { setMontoFocused(false); commitMonto(); }}
        placeholder="0" aria-label="Monto" className={`${inputCls} w-28 sm:w-32 text-right tnum`} />
      <select value={it.moneda} onChange={e => save({ moneda: e.target.value as 'ARS' | 'USD' })} aria-label="Moneda" className={`${inputCls} w-20`}>
        <option value="ARS">ARS</option><option value="USD">USD</option>
      </select>
      {it.categoria === 'inversion' && (
        <select value={it.destino ?? 'otro'} onChange={e => save({ destino: e.target.value as FlujoDestino })} aria-label="Destino" className={`${inputCls} w-32`}>
          {DESTINOS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      )}
      {err && <span className="text-[10px] text-neg shrink-0" title="No se pudo guardar; reintentá">no se guardó ⚠</span>}
      <button onClick={() => { setErr(false); if (window.confirm('¿Borrar esta fila?')) remove(it.id).catch(() => setErr(true)); }}
        aria-label="Borrar fila" title="Borrar fila" className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9 shrink-0">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

// Reexport para el Dashboard.
export { destinoLabel };
