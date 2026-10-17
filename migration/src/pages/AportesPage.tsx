import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { useAportes, useAporteMutations } from '../hooks/useAportes';
import { useMacro } from '../hooks/usePosiciones';
import { resumenAportes } from '../engine/aportes';
import { Card, CardHeader, Button, Badge, Field, Empty, inputCls, fmtUsd, fmtArs } from '../components/ui';
import type { Aporte, AporteTipo } from '../types/domain';

// Conversión USD↔ARS con el MEP vigente, mismo criterio que el campo ARS vinculado de Comprar/
// Vender en PosicionesPage: el USD sigue siendo el valor que de verdad se guarda (`f.monto`), el ARS
// es solo una vista de conversión para tipear más cómodo. Si no hay MEP (todavía cargando o la
// Function cayó), devuelve '' y el campo ARS queda deshabilitado — el USD sigue funcionando igual.
const arsFromUsd = (usd: number, mep: number | null): string => (mep && usd > 0 ? String(+(usd * mep).toFixed(2)) : '');
const usdFromArs = (ars: number, mep: number | null): string => (mep && ars > 0 ? String(+(ars / mep).toFixed(2)) : '');

// Separador de miles SOLO mientras el campo no tiene foco — reformatear en cada tecla mientras se
// tipea mueve el cursor a un lugar impredecible (agregar una coma antes del cursor lo corre). El
// valor RAW (sin comas) es siempre lo que viaja a onUsdChange/onArsChange — este componente nunca
// le agrega formato al string que usan los cálculos, solo a lo que se ve cuando no estás editando.
const formatearMiles = (raw: string): string => {
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : raw;
};

function MontoInput({ value, onChange, placeholder, disabled, className }: {
  value: string; onChange: (raw: string) => void; placeholder?: string; disabled?: boolean; className?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <input type="text" inputMode="decimal" placeholder={placeholder} disabled={disabled}
      value={focused ? value : formatearMiles(value)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
      className={className} />
  );
}

const TIPO_TONE: Record<AporteTipo, 'accent' | 'gray' | 'warn' | 'neg'> = { inicial: 'accent', recurrente: 'gray', adelanto: 'warn', retiro: 'neg' };

export function AportesPage() {
  const { active } = usePortfolios();
  const { data: aportes = [], isLoading } = useAportes(active?.id);
  const { add, remove } = useAporteMutations(active?.id);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [f, setF] = useState<{ monto: string; montoArs: string; fecha: string; tipo: AporteTipo; descripcion: string }>({
    monto: '', montoArs: '', fecha: new Date().toISOString().slice(0, 10), tipo: 'recurrente', descripcion: '',
  });
  const { data: macro = {} } = useMacro();
  const mep = (macro as Record<string, number | null>).dolar_mep ?? (macro as Record<string, number | null>).dolar_ccl ?? null;

  // Bidireccional: tipear en un campo recalcula el otro con el MEP vigente. Un valor no positivo (0,
  // negativo, a medio tipear) LIMPIA el otro campo en vez de dejarlo con un número viejo que ya no
  // corresponde — mismo criterio que SellModal/SimularCompraModal en PosicionesPage.
  const onUsdChange = (raw: string) => {
    const n = Number(raw);
    setF(prev => ({ ...prev, monto: raw, montoArs: Number.isFinite(n) && n > 0 ? arsFromUsd(n, mep) : '' }));
  };
  const onArsChange = (raw: string) => {
    const n = Number(raw);
    setF(prev => ({ ...prev, montoArs: raw, monto: Number.isFinite(n) && n > 0 ? usdFromArs(n, mep) : '' }));
  };

  // Si el usuario tipea el monto USD antes de que useMacro() resuelva el MEP (mep null al montar),
  // el campo ARS queda deshabilitado y vacío; cuando el MEP llega unos instantes después, sin este
  // efecto el campo se HABILITA pero se queda vacío al lado de un USD ya tipeado — mismo caso que
  // SellModal en PosicionesPage. Solo completa si sigue vacío (no pisa nada que el usuario ya tipeó).
  useEffect(() => {
    if (!mep || f.montoArs !== '') return;
    const n = Number(f.monto);
    if (Number.isFinite(n) && n > 0) setF(prev => ({ ...prev, montoArs: arsFromUsd(n, mep) }));
  }, [mep]); // eslint-disable-line react-hooks/exhaustive-deps

  const { aportado, retirado, neto } = resumenAportes(aportes);

  const borrar = async (a: Aporte) => {
    if (!window.confirm(`¿Borrar el aporte de ${fmtUsd(a.monto)} del ${a.fecha}?`)) return;
    setDeletingId(a.id); setDeleteErr(null);
    try { await remove(a.id); }
    catch (e) { setDeleteErr(e instanceof Error ? e.message : 'No se pudo borrar'); }
    finally { setDeletingId(null); }
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Aportes · {active.nombre}</h1>

      <Card>
        <CardHeader title="Registrar movimiento de capital" sub="Capital que entra (aporte) o sale (retiro). Impacta la TIR del Dashboard." />
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <Field label="Monto (USD)">
            <MontoInput placeholder="Monto USD" value={f.monto} onChange={onUsdChange} className={inputCls} />
          </Field>
          <Field label="Monto (ARS)" hint={mep ? `MEP ${fmtArs(mep)}` : 'MEP no disponible'}>
            <MontoInput placeholder="Monto ARS" value={f.montoArs} onChange={onArsChange} disabled={!mep}
              className={`${inputCls} disabled:opacity-50 disabled:cursor-not-allowed`} />
          </Field>
          {/* min-w-0: sin esto, el input date puede pedir más ancho del que le toca en la columna del
              grid (CSS Grid no encoge un ítem por debajo del contenido si no se le dice explícito) y
              termina empujando/superponiéndose con el <select> de Tipo al lado. */}
          <Field label="Fecha" className="min-w-0">
            <input type="date" min="2000-01-01" max={new Date().toISOString().slice(0, 10)} value={f.fecha} onChange={e => setF({ ...f, fecha: e.target.value })} className={`${inputCls} min-w-0`} />
          </Field>
          <Field label="Tipo" className="min-w-0">
            <select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value as AporteTipo })} className={`${inputCls} min-w-0`}>
              <option value="inicial">Inicial</option><option value="recurrente">Recurrente</option><option value="adelanto">Adelanto</option><option value="retiro">Retiro (salida)</option>
            </select>
          </Field>
          <Field label="Descripción">
            <input placeholder="Descripción" value={f.descripcion} onChange={e => setF({ ...f, descripcion: e.target.value })} className={inputCls} />
          </Field>
          <div className="flex items-end">
            <Button disabled={busy} onClick={async () => {
              // Antes: sin validar (aceptaba negativos y fechas futuras) y el error se tragaba, así
              // que un fallo parecía "no hizo nada" y el doble tap duplicaba el aporte.
              const monto = Number(f.monto);
              if (!(monto > 0)) { setErr('El monto debe ser mayor a 0.'); return; }
              if (f.fecha > new Date().toISOString().slice(0, 10)) { setErr('La fecha no puede ser futura.'); return; }
              // Sin cota inferior, un typo de año en el date picker nativo (ej. "0202" en vez de
              // "2026") pasaba silencioso: inceptionYear terminaba en el año 202, y
              // rendimientoPorAnio() generaba ~1800 filas (todas null) en la tabla de Aportes y en
              // el "Ver N años más" del Dashboard — visible recién ahí, no acá donde se originó.
              if (f.fecha < '2000-01-01') { setErr('La fecha no puede ser anterior a 2000.'); return; }
              setBusy(true); setErr(null);
              try {
                await add({ monto, fecha: f.fecha, tipo: f.tipo, descripcion: f.descripcion || null });
                setF({ ...f, monto: '', montoArs: '', descripcion: '' });
              } catch (e) { setErr(`No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`); }
              finally { setBusy(false); }
            }}>
              <Plus className="w-4 h-4" /> {busy ? 'Guardando…' : 'Agregar'}
            </Button>
          </div>
        </div>
        {err && <p className="px-4 pb-3 text-xs text-warn">{err}</p>}
      </Card>

      <Card>
        <CardHeader title="Historial de movimientos"
          right={<span className="text-xs text-ink-600 tnum" title={`Aportado ${fmtUsd(aportado, 0)} · Retirado ${fmtUsd(retirado, 0)}`}>Neto {fmtUsd(neto, 0)}</span>} />
        {deleteErr && <p className="px-4 pt-2 text-xs text-warn">{deleteErr}</p>}
        <div className="divide-y divide-line">
          {isLoading ? (
            <p className="p-4 text-sm text-ink-600">Cargando…</p>
          ) : aportes.length === 0 ? (
            <Empty icon={Wallet} title="Sin aportes">Registrá el primer aporte arriba.</Empty>
          ) : aportes.map(a => (
            <div key={a.id} className="px-4 py-2.5 flex items-center gap-3 gap-y-1 flex-wrap text-sm">
              <span className="text-ink-600 tnum w-24 shrink-0">{a.fecha}</span>
              <Badge tone={TIPO_TONE[a.tipo]}>{a.tipo}</Badge>
              <span className="flex-1 min-w-[80px] text-ink-600 truncate">{a.descripcion || '—'}</span>
              {/* flex-wrap (no un solo renglón sin quiebre): un monto de 7 cifras + el botón de
                  borrar podían empujar la fila entera más allá del borde de la Card en mobile —
                  misma clase de bug que se arregló en Stat (ui.tsx). */}
              <span className={`font-semibold tnum ${a.tipo === 'retiro' ? 'text-neg' : 'text-ink-900'}`}>{a.tipo === 'retiro' ? '−' : ''}{fmtUsd(a.monto, 0)}</span>
              <button onClick={() => borrar(a)} disabled={deletingId === a.id} aria-label="Borrar aporte" title="Borrar aporte" className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9 shrink-0 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      </Card>

      <p className="text-[11px] text-ink-600 leading-relaxed">
        Acá solo se ven los movimientos de capital. Cuánto rindió la cartera (ganancia, contra el S&amp;P 500, máxima caída y por año) está en <Link to="/desempeno" className="text-celeste-600 underline">Desempeño</Link>.
      </p>
    </div>
  );
}
