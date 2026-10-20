import { useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { Card, CardHeader, Badge, Field, NumField, inputCls, fmtArs } from './ui';
import { BASE_LABEL, TIPO_OTRO_LABEL, esProvisoria, type BaseValuacion, type TipoOtroBien } from '../engine/impuestos';
import type { PatrimonioOtro, PatrimonioOtroInput } from '../hooks/usePatrimonioOtros';

const VACIO: PatrimonioOtroInput = { nombre: '', tipo: 'vehiculo', valor_ars: 0, base: 'valuacion_arca', nota: null };

// Bienes fuera de los portfolios que suman al patrimonio de Bienes Personales (ver engine/impuestos.ts). Solo la valuación de ARCA al
// 31/12 es el valor que cuenta; cualquier otra base se marca «provisorio» para que no se confunda con el dato oficial.
export function OtrosBienes({ items, cargando, umbralCasa, onAgregar, onActualizar, onEliminar }: {
  items: PatrimonioOtro[]; cargando: boolean;
  umbralCasa?: number;   // umbral de exención de la casa-habitación del período (ARCA); sin dato no se marca exenta
  onAgregar: (i: PatrimonioOtroInput) => Promise<void>;
  onActualizar: (id: string, i: PatrimonioOtroInput) => Promise<void>;
  onEliminar: (id: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState<string | 'nuevo' | null>(null);
  const [form, setForm] = useState<PatrimonioOtroInput>(VACIO);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const abrir = (b?: PatrimonioOtro) => {
    setError(null);
    setForm(b ? { nombre: b.nombre, tipo: b.tipo, valor_ars: b.valor_ars, base: b.base, nota: b.nota, fecha_valuacion: b.fecha_valuacion } : VACIO);
    setEditando(b ? b.id : 'nuevo');
  };
  const cerrar = () => { setEditando(null); setError(null); };

  const guardar = async () => {
    setGuardando(true); setError(null);
    try {
      if (editando === 'nuevo') await onAgregar(form); else if (editando) await onActualizar(editando, form);
      cerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally { setGuardando(false); }
  };

  const borrar = async (b: PatrimonioOtro) => {
    if (!window.confirm(`¿Eliminar «${b.nombre}»? Deja de sumar al patrimonio de Bienes Personales.`)) return;
    try { await onEliminar(b.id); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar.'); }
  };

  return (
    <Card>
      <CardHeader
        title="Otros bienes"
        sub="Lo que tenés fuera de los portfolios y también suma al patrimonio: vehículo, inmuebles, efectivo, cuentas en el exterior."
        right={editando === null ? <button onClick={() => abrir()} className="inline-flex items-center gap-1 text-xs font-semibold text-celeste-600 hover:underline"><Plus className="w-3.5 h-3.5" /> Agregar</button> : undefined}
      />
      {cargando ? <p className="p-4 text-sm text-ink-600">Cargando…</p> : items.length === 0 && editando === null ? (
        <p className="p-4 text-sm text-ink-600">No cargaste otros bienes. Si tenés algo más que los portfolios, agregalo para que el patrimonio sea el real.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map(b => (
            <li key={b.id} className="px-4 py-3">
              {/* Nombre y acciones arriba, valor debajo: en el celular el nombre se cortaba y la nota quedaba en una columna angosta. */}
              <div className="flex items-start gap-2">
                <p className="font-semibold text-ink-900 text-sm min-w-0 flex-1 break-words">{b.nombre}</p>
                <div className="flex shrink-0 -mr-2 -mt-1.5">
                  <button onClick={() => abrir(b)} title="Editar" aria-label={`Editar ${b.nombre}`} className="p-2 text-ink-600 hover:text-ink-900"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => borrar(b)} title="Eliminar" aria-label={`Eliminar ${b.nombre}`} className="p-2 text-ink-600 hover:text-neg"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <p className="tnum font-bold text-ink-900 text-base">{fmtArs(b.valor_ars)}</p>
              <p className="text-[11px] text-ink-600 flex flex-wrap items-center gap-1.5 mt-1">
                <span>{TIPO_OTRO_LABEL[b.tipo]}</span>
                <Badge tone={esProvisoria(b.base) ? 'warn' : 'pos'}>{esProvisoria(b.base) ? `provisorio · ${BASE_LABEL[b.base].toLowerCase()}` : BASE_LABEL[b.base]}</Badge>
                {b.tipo === 'casa_habitacion' && umbralCasa != null && (
                  b.valor_ars <= umbralCasa ? <Badge tone="pos">exenta</Badge> : <Badge tone="warn">supera el umbral de exención</Badge>
                )}
                <span>al {b.fecha_valuacion.split('-').reverse().join('/')}</span>
              </p>
              {b.nota && <p className="text-[11px] text-ink-500 mt-1.5 break-words">{b.nota}</p>}
            </li>
          ))}
        </ul>
      )}

      {editando !== null && (
        <div className="p-4 border-t border-line space-y-3 bg-canvas/40">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink-900">{editando === 'nuevo' ? 'Nuevo bien' : 'Editar bien'}</p>
            <button onClick={cerrar} aria-label="Cerrar" className="p-1 text-ink-600 hover:text-ink-900"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nombre"><input className={inputCls} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej.: Volkswagen T-Cross 2021" /></Field>
            <Field label="Tipo">
              <select className={inputCls} value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value as TipoOtroBien })}>
                {(Object.keys(TIPO_OTRO_LABEL) as TipoOtroBien[]).map(t => <option key={t} value={t}>{TIPO_OTRO_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label="Valor en pesos" hint="Para un vehículo, la valuación de la tabla de ARCA al 31/12 (no el seguro ni el mercado).">
              <NumField className={inputCls} value={form.valor_ars} min={0} step="any" onChange={n => setForm({ ...form, valor_ars: n })} />
            </Field>
            <Field label="De dónde sale ese valor">
              <select className={inputCls} value={form.base} onChange={e => setForm({ ...form, base: e.target.value as BaseValuacion })}>
                {(Object.keys(BASE_LABEL) as BaseValuacion[]).map(b => <option key={b} value={b}>{BASE_LABEL[b]}{esProvisoria(b) ? ' (provisorio)' : ''}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Fecha de la valuación" hint="Para el impuesto, el 31/12 del período.">
              <input type="date" className={inputCls} value={form.fecha_valuacion ?? ''} onChange={e => setForm({ ...form, fecha_valuacion: e.target.value || undefined })} />
            </Field>
            <Field label="Nota (opcional)"><input className={inputCls} value={form.nota ?? ''} onChange={e => setForm({ ...form, nota: e.target.value })} /></Field>
          </div>
          {error && <p role="alert" className="text-xs text-neg">{error}</p>}
          <div className="flex gap-2">
            <button onClick={guardar} disabled={guardando} className="rounded-full bg-celeste-500 text-white px-4 py-2 text-sm font-semibold shadow-glow hover:bg-celeste-600 disabled:opacity-60">{guardando ? 'Guardando…' : 'Guardar'}</button>
            <button onClick={cerrar} className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-canvas">Cancelar</button>
          </div>
        </div>
      )}
      {editando === null && error && <p role="alert" className="px-4 pb-3 text-xs text-neg">{error}</p>}
    </Card>
  );
}
