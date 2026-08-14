import { useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Archive, Save, KeyRound, Layers, Download, ShieldCheck, Upload, AlertTriangle } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { useAuth } from '../hooks/useAuth';
import { useCikMap } from '../hooks/useCikMap';
import { Trash2 } from 'lucide-react';
import { Card, CardHeader, Button, Badge, fmtUsd, Field, inputCls, Empty } from '../components/ui';
import { buildBackup, descargarBackup } from '../lib/backup';
import { parseBackup, restoreBackup, type Preview } from '../lib/restore';

export function ConfigPage() {
  const { portfolios, active, defaultId, setDefaultId, setActiveId, createPortfolio, updatePortfolio, archivePortfolio } = usePortfolios();
  const [nuevo, setNuevo] = useState({ nombre: '', descripcion: '', capital_objetivo: '', moneda_ref: 'USD' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [archivandoId, setArchivandoId] = useState<string | null>(null);
  const [archiveErr, setArchiveErr] = useState<string | null>(null);

  const crear = async () => {
    if (!nuevo.nombre.trim()) { setMsg({ text: 'Ingresá un nombre.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await createPortfolio({
        nombre: nuevo.nombre.trim(),
        descripcion: nuevo.descripcion || null,
        capital_objetivo: nuevo.capital_objetivo ? Number(nuevo.capital_objetivo) : null,
        moneda_ref: nuevo.moneda_ref,
      });
      setNuevo({ nombre: '', descripcion: '', capital_objetivo: '', moneda_ref: 'USD' });
      setMsg({ text: 'Portfolio creado y activado. Cargá sus posiciones en la pestaña Posiciones.', ok: true });
    } catch (e) {
      // Antes el error se tragaba y parecía que "no hacía nada".
      setMsg({ text: `No se pudo crear: ${e instanceof Error ? e.message : 'error desconocido'}` });
    } finally {
      setBusy(false);
    }
  };

  const archivar = async (p: { id: string; nombre: string }) => {
    if (!window.confirm(`¿Archivar "${p.nombre}"? Deja de aparecer, pero no se borra.`)) return;
    setArchivandoId(p.id); setArchiveErr(null);
    try { await archivePortfolio(p.id); }
    catch (e) { setArchiveErr(e instanceof Error ? e.message : 'No se pudo archivar'); }
    finally { setArchivandoId(null); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Configuración</h1>

      <Card>
        <CardHeader title="Nuevo portfolio" sub="Cada portfolio es independiente: posiciones, capital y análisis no se mezclan." />
        <div className="p-4 grid sm:grid-cols-2 gap-3">
          <Field label="Nombre">
            <input placeholder="Nombre (ej. Ahorros, Herencia)" value={nuevo.nombre}
              onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })}
              className={inputCls} />
          </Field>
          <Field label="Capital objetivo (USD)">
            <input placeholder="Capital objetivo (USD, opcional)" type="number" value={nuevo.capital_objetivo}
              onChange={e => setNuevo({ ...nuevo, capital_objetivo: e.target.value })}
              className={inputCls} />
          </Field>
          <Field label="Descripción / estrategia" className="sm:col-span-2">
            <input placeholder="Descripción / estrategia (opcional)" value={nuevo.descripcion}
              onChange={e => setNuevo({ ...nuevo, descripcion: e.target.value })}
              className={inputCls} />
          </Field>
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button onClick={crear} disabled={busy || !nuevo.nombre.trim()}><Plus className="w-4 h-4" /> {busy ? 'Creando…' : 'Crear'}</Button>
            {msg && <span className={`text-xs ${msg.ok ? 'text-pos' : 'text-warn'}`}>{msg.text}</span>}
          </div>
        </div>
      </Card>

      {portfolios.length > 1 && (
        <Card>
          <CardHeader title="Portfolio por defecto" sub="Cuál se muestra primero al abrir la app. Podés seguir cambiando de portfolio cuando quieras." />
          <div className="p-4 flex flex-wrap items-center gap-3">
            <Field label="Mostrar por defecto" className="flex-1 min-w-[200px]">
              <select value={defaultId ?? ''}
                onChange={e => { const v = e.target.value || null; setDefaultId(v); if (v) setActiveId(v); }}
                className={`${inputCls} appearance-none`}>
                <option value="">Automático (la última que usé)</option>
                {portfolios.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Field>
            {defaultId && <span className="text-xs text-pos self-end pb-2">Abrirá en «{portfolios.find(p => p.id === defaultId)?.nombre ?? '—'}»</span>}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Mis portfolios" />
        {archiveErr && <p className="px-4 pt-2 text-xs text-warn">{archiveErr}</p>}
        <div className="divide-y divide-line">
          {portfolios.map(p => (
            <div key={p.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-900">{p.nombre}
                  {active?.id === p.id && <span className="ml-2"><Badge tone="accent">activo</Badge></span>}
                </p>
                <p className="text-[11px] text-ink-600 truncate">{p.descripcion || '—'}</p>
              </div>
              <span className="text-xs text-ink-600 tnum">obj: {fmtUsd(p.capital_objetivo, 0)}</span>
              <button onClick={() => archivar(p)} disabled={archivandoId === p.id} title="Archivar" aria-label={`Archivar ${p.nombre}`}
                className="text-ink-600 hover:text-warn inline-flex items-center justify-center w-9 h-9 disabled:opacity-50"><Archive className="w-4 h-4" /></button>
            </div>
          ))}
          {portfolios.length === 0 && <Empty icon={Layers} title="Sin portfolios">Creá el primero arriba.</Empty>}
        </div>
      </Card>

      {active && <EditActive key={active.id}
        nombre={active.nombre} estrategia={active.estrategia ?? ''} capital={active.capital_objetivo}
        onSave={(patch) => updatePortfolio(active.id, patch)} />}

      <BackupSection />
      <RestoreSection />
      <CikMapSection />
      <ChangePassword />
    </div>
  );
}

// Recordatorio de "hace cuánto no hacés backup", en localStorage (nada que ver con los datos del
// portfolio, es solo un timestamp del navegador). Sin esto, tener el botón no garantiza que se use:
// el plan gratuito de Supabase no tiene red de seguridad propia, así que este archivo ES el backup.
const LAST_BACKUP_KEY = 'lastBackupAt';
const leerUltimoBackup = (): Date | null => {
  try { const v = localStorage.getItem(LAST_BACKUP_KEY); return v ? new Date(v) : null; } catch { return null; }
};
const marcarBackupHecho = () => { try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); } catch { /* */ } };
const DIAS_AVISO = 30;

function BackupSection() {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [ultimo, setUltimo] = useState(() => leerUltimoBackup());

  const descargar = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await buildBackup(session?.user.email ?? null);
      descargarBackup(r);
      marcarBackupHecho(); setUltimo(new Date());
      const detalle = `${r.counts.portfolios ?? 0} portfolios · ${r.counts.posiciones ?? 0} posiciones · ${r.counts.movimientos ?? 0} movimientos · ${r.counts.aportes ?? 0} aportes · ${r.counts.cobros ?? 0} cobros · ${r.counts.flujo_items ?? 0} flujo`;
      setMsg(r.errores.length
        ? { text: `Backup descargado (${r.total} registros), con avisos: ${r.errores.join('; ')}` }
        : { text: `Backup descargado ✓ — ${r.total} registros (${detalle}). Guardalo en tu Drive.`, ok: true });
    } catch (e) {
      setMsg({ text: `No se pudo generar el backup: ${e instanceof Error ? e.message : 'error'}` });
    } finally { setBusy(false); }
  };

  const diasDesde = ultimo ? Math.floor((Date.now() - ultimo.getTime()) / 86_400_000) : null;
  const haceFalta = diasDesde == null || diasDesde > DIAS_AVISO;

  return (
    <Card>
      <CardHeader title="Backup de tus datos" sub="Descargá un archivo JSON con TODOS tus portfolios y datos para guardarlo por tu cuenta (ej. en tu Drive)." />
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-2 rounded-xl bg-canvas ring-1 ring-inset ring-line px-3 py-2.5 text-[11px] text-ink-600">
          <ShieldCheck className="w-4 h-4 shrink-0 text-pos mt-0.5" />
          <p>Incluye portfolios, brokers y su asignación, posiciones, movimientos, aportes, transferencias entre portfolios, cobros (dividendos/intereses/amortizaciones) y el saldo ya invertido, flujo de caja, supuestos de DCF y de Proyección, cronograma de amortización manual, layout del Dashboard, histórico, watchlist, mapa de CIK, análisis de IA y tu perfil. Se genera en tu navegador (no se sube a ningún lado). El proyecto está en el plan gratuito de Supabase, que NO incluye backups automáticos — este archivo es la única copia de tus datos fuera de la base. Guardalo en tu Drive u otro lugar seguro cada tanto.</p>
        </div>
        {haceFalta && (
          <p className="flex items-center gap-1.5 text-[11px] text-warn">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {diasDesde == null ? 'Nunca descargaste un backup desde este navegador.' : `Tu último backup (desde este navegador) fue hace ${diasDesde} días.`}
          </p>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={descargar} disabled={busy}><Download className="w-4 h-4" /> {busy ? 'Generando…' : 'Descargar backup (JSON)'}</Button>
          {msg && <span className={`text-xs ${msg.ok ? 'text-pos' : 'text-warn'}`}>{msg.text}</span>}
        </div>
      </div>
    </Card>
  );
}

const TABLA_LABEL: Record<string, string> = {
  portfolios: 'portfolios', posiciones: 'posiciones', movimientos: 'movimientos', aportes: 'aportes',
  portfolio_snapshots: 'histórico', flujo_items: 'flujo', dcf_inputs: 'DCF', cik_map: 'CIK', watchlist: 'watchlist',
  analisis_ia: 'análisis IA', profiles: 'perfil', cobros: 'cobros', proyeccion_inputs: 'supuestos proyección',
  brokers: 'brokers', posicion_brokers: 'asignación de brokers', cobros_inversiones: 'saldo invertido',
  transferencias: 'transferencias', amortizaciones_programadas: 'cronograma amortización', dashboard_layout: 'layout Dashboard',
};

function RestoreSection() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; ok?: boolean; err?: boolean } | null>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setResult(null); setConfirm(false);
    const input = e.target;
    const file = input.files?.[0];
    if (!file) { setPreview(null); return; }
    try { setPreview(parseBackup(await file.text())); }
    catch { setPreview({ ok: false, error: 'No se pudo leer el archivo.', counts: {}, total: 0, avisos: [] }); }
    input.value = ''; // permite volver a elegir el MISMO archivo (si no, onChange no dispara)
  };

  const restaurar = async () => {
    if (!preview?.backup || !session) return;
    setBusy(true); setResult(null);
    try {
      const r = await restoreBackup(preview.backup, session.user.id);
      await qc.invalidateQueries();
      setResult(r.errores.length
        ? { text: `Restauración PARCIAL — ${r.total} registros. Errores: ${r.errores.join('; ')}`, err: true }
        : { text: `Restaurado ✓ — ${r.total} registros. Si algo no aparece, recargá la app.`, ok: true });
      setPreview(null); setConfirm(false);
    } catch (e) {
      setResult({ text: `Falló la restauración: ${e instanceof Error ? e.message : 'error'}`, err: true });
    } finally { setBusy(false); }
  };

  const distintoUsuario = preview?.fromEmail && session?.user.email && preview.fromEmail !== session.user.email;

  return (
    <Card>
      <CardHeader title="Restaurar backup" sub="Cargá un archivo de backup (JSON) para recuperar tus datos en esta cuenta." />
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-2 rounded-xl bg-warn/10 ring-1 ring-inset ring-warn/20 px-3 py-2.5 text-[11px] text-ink-700">
          <AlertTriangle className="w-4 h-4 shrink-0 text-warn mt-0.5" />
          <p><b>Agrega y sobrescribe</b> con los datos del backup (no borra lo que no esté en él). Ideal para una cuenta <b>vacía</b> o recuperación. Si ya tenés portfolios, podrían quedar duplicados.</p>
        </div>

        <input type="file" accept="application/json,.json" onChange={onFile} aria-label="Archivo de backup a restaurar"
          className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-full file:border-0 file:bg-celeste-500 file:text-white file:px-4 file:py-2 file:text-sm file:font-semibold hover:file:bg-celeste-600 file:cursor-pointer" />

        {preview && !preview.ok && <p className="text-xs text-warn">{preview.error}</p>}

        {preview?.ok && (
          <div className="rounded-xl bg-canvas ring-1 ring-inset ring-line px-3 py-3 space-y-2">
            <p className="text-xs text-ink-700">
              <b>{preview.total} registros</b>{preview.exportedAt ? ` · exportado ${new Date(preview.exportedAt).toLocaleString('es-AR')}` : ''}{preview.fromEmail ? ` · por ${preview.fromEmail}` : ''}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(preview.counts).filter(([, n]) => n > 0).map(([t, n]) => (
                <Badge key={t} tone="gray">{TABLA_LABEL[t] ?? t}: {n}</Badge>
              ))}
            </div>
            {distintoUsuario && <p className="text-[11px] text-warn">El backup es de otra cuenta ({preview.fromEmail}); se restaurará bajo la tuya ({session?.user.email}).</p>}
            {preview.avisos.map((a, i) => <p key={i} className="text-[11px] text-warn">{a}</p>)}
            <label className="flex items-center gap-2 text-xs text-ink-700 pt-1">
              <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} className="w-4 h-4 accent-celeste-500" />
              Entiendo que se agregan/sobrescriben mis datos con los del backup.
            </label>
            <Button onClick={restaurar} disabled={!confirm || busy}><Upload className="w-4 h-4" /> {busy ? 'Restaurando…' : 'Restaurar ahora'}</Button>
          </div>
        )}

        {result && <p className={`text-xs ${result.ok ? 'text-pos' : result.err ? 'text-neg' : 'text-warn'}`}>{result.text}</p>}
      </div>
    </Card>
  );
}

function CikMapSection() {
  const { data: entries = [], add, remove } = useCikMap();
  const [ticker, setTicker] = useState('');
  const [cik, setCik] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [deletingTicker, setDeletingTicker] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const guardar = async () => {
    if (!ticker.trim() || !cik.trim()) { setErr('Completá ticker y CIK.'); return; }
    setErr(null);
    try { await add(ticker.trim(), cik.trim().padStart(10, '0')); setTicker(''); setCik(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  };

  const borrar = async (e: { ticker: string }) => {
    if (!window.confirm(`¿Borrar el CIK guardado para ${e.ticker}?`)) return;
    setDeletingTicker(e.ticker); setDeleteErr(null);
    try { await remove(e.ticker); }
    catch (err) { setDeleteErr(err instanceof Error ? err.message : 'No se pudo borrar'); }
    finally { setDeletingTicker(null); }
  };

  return (
    <Card>
      <CardHeader title="Tickers → CIK (EDGAR)" sub="Para analizar empresas que no reconocemos por defecto. El CIK es el número de la empresa en SEC EDGAR (10 dígitos)." />
      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <Field label="Ticker">
          <input placeholder="Ticker (ej. TSLA)" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} className={inputCls} />
        </Field>
        <Field label="CIK">
          <input placeholder="CIK (ej. 1318605)" value={cik} onChange={e => setCik(e.target.value)} className={inputCls} />
        </Field>
        <div className="flex items-end">
          <Button onClick={guardar}>Agregar</Button>
        </div>
      </div>
      {err && <p className="px-4 pb-2 text-xs text-warn">{err}</p>}
      {deleteErr && <p className="px-4 pb-2 text-xs text-warn">{deleteErr}</p>}
      {entries.length > 0 && (
        <div className="divide-y divide-line">
          {entries.map(e => (
            <div key={e.ticker} className="px-4 py-2 flex items-center gap-3 text-sm">
              <span className="font-semibold text-ink-900 w-20">{e.ticker}</span>
              <span className="text-ink-600 tnum flex-1">CIK {e.cik}</span>
              <button onClick={() => borrar(e)} disabled={deletingTicker === e.ticker} aria-label="Borrar par ticker/CIK" title="Borrar" className="text-ink-600 hover:text-neg inline-flex items-center justify-center w-9 h-9 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ChangePassword() {
  const { updatePassword } = useAuth();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);

  const submit = async () => {
    if (p1.length < 6) { setMsg({ text: 'Mínimo 6 caracteres.' }); return; }
    if (p1 !== p2) { setMsg({ text: 'Las contraseñas no coinciden.' }); return; }
    setBusy(true); setMsg(null);
    const { error } = await updatePassword(p1);
    setMsg(error ? { text: error } : { text: 'Contraseña actualizada.', ok: true });
    if (!error) { setP1(''); setP2(''); }
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader title="Cambiar contraseña" sub="Se aplica a tu cuenta de acceso." />
      <div className="p-4 grid sm:grid-cols-2 gap-3">
        <Field label="Nueva contraseña">
          <input type="password" placeholder="Nueva contraseña" value={p1} onChange={e => setP1(e.target.value)} autoComplete="new-password"
            className={inputCls} />
        </Field>
        <Field label="Repetir contraseña">
          <input type="password" placeholder="Repetir contraseña" value={p2} onChange={e => setP2(e.target.value)} autoComplete="new-password"
            className={inputCls} />
        </Field>
        <div className="sm:col-span-2 flex items-center gap-3">
          <Button variant="ghost" onClick={submit} disabled={busy || !p1}><KeyRound className="w-4 h-4" /> {busy ? 'Guardando…' : 'Actualizar contraseña'}</Button>
          {msg && <span className={`text-xs ${msg.ok ? 'text-pos' : 'text-warn'}`}>{msg.text}</span>}
        </div>
      </div>
    </Card>
  );
}

function EditActive({ nombre, estrategia, capital, onSave }: {
  nombre: string; estrategia: string; capital: number | null;
  onSave: (patch: { nombre?: string; estrategia?: string; capital_objetivo?: number | null }) => Promise<void>;
}) {
  const [n, setN] = useState(nombre);
  const [e, setE] = useState(estrategia);
  const [c, setC] = useState(capital?.toString() ?? '');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const guardar = async () => {
    // Antes: sin try/catch — igual que "crear" tenía este bug (ver comentario más arriba), un
    // guardado fallido (offline, RLS) no mostraba nada: el botón simplemente no hacía nada visible.
    setBusy(true); setErr(null);
    try {
      await onSave({ nombre: n, estrategia: e, capital_objetivo: c ? Number(c) : null });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Editar portfolio activo" />
      <div className="p-4 space-y-3">
        <Field label="Nombre">
          <input value={n} onChange={ev => setN(ev.target.value)} className={inputCls} />
        </Field>
        <Field label="Capital objetivo (USD)">
          <input value={c} type="number" placeholder="Capital objetivo (USD)" onChange={ev => setC(ev.target.value)} className={inputCls} />
        </Field>
        <Field label="Estrategia">
          <textarea value={e} onChange={ev => setE(ev.target.value)} placeholder="Estrategia (texto libre)" rows={3}
            className={inputCls} />
        </Field>
        {err && <p className="text-xs text-neg">{err}</p>}
        <Button variant="ghost" onClick={guardar} disabled={busy}>
          <Save className="w-4 h-4" /> {busy ? 'Guardando…' : saved ? 'Guardado' : 'Guardar cambios'}
        </Button>
      </div>
    </Card>
  );
}
