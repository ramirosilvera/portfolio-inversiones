import { useRef, useState } from 'react';
import { Share2, Download } from 'lucide-react';
import { toBlob } from 'html-to-image';
import { Button } from './ui';
import { textoWhatsApp, urlWhatsApp, nombreArchivo, PIE_LEGAL, type ResumenCompartible, type TonoCompartir } from '../lib/compartirAnalisis';

// Colores FIJOS (no los tokens del tema): la imagen sale igual en modo claro y oscuro, y se lee bien en WhatsApp.
const COLOR: Record<TonoCompartir, string> = { pos: '#047857', neg: '#b91c1c', warn: '#b45309', neutral: '#0f172a' };
const FONDO_VEREDICTO: Record<TonoCompartir, string> = { pos: '#d1fae5', neg: '#fee2e2', warn: '#fef3c7', neutral: '#e2e8f0' };

// La tarjeta que se convierte en PNG. Ancho fijo 480 px (a pixelRatio 2 = 960 px: nítida en el celular).
function TarjetaImagen({ r }: { r: ResumenCompartible }) {
  return (
    <div style={{ width: 480, background: '#ffffff', color: '#0f172a', padding: 24, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1 }}>{r.titulo}</div>
          {r.subtitulo && <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>{r.subtitulo}</div>}
        </div>
        {r.veredicto && (
          <div style={{ background: FONDO_VEREDICTO[r.veredicto.tono], color: COLOR[r.veredicto.tono], fontWeight: 700, fontSize: 13, padding: '6px 12px', borderRadius: 999, textAlign: 'center', maxWidth: 190 }}>
            {r.veredicto.texto}
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 20 }}>
        {r.metricas.map(m => (
          <div key={m.etiqueta} style={{ background: '#f1f5f9', borderRadius: 12, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: '#64748b', fontWeight: 600 }}>{m.etiqueta}</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2, color: COLOR[m.tono ?? 'neutral'] }}>{m.valor}</div>
          </div>
        ))}
      </div>
      {r.avisos.map((a, i) => (
        <div key={i} style={{ marginTop: 12, background: '#fef3c7', color: '#92400e', borderRadius: 10, padding: '8px 12px', fontSize: 12, lineHeight: 1.4 }}>⚠ {a}</div>
      ))}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e2e8f0', fontSize: 10.5, color: '#64748b', lineHeight: 1.45 }}>
        <div>{PIE_LEGAL}</div>
        <div style={{ marginTop: 2 }}>Fuente: {r.fuente} · {r.fecha}</div>
      </div>
    </div>
  );
}

// Compartir un análisis como IMAGEN (PNG generado en el navegador, sin servidor) y por WhatsApp.
// Celular: el menú «Compartir» del sistema con la imagen adjunta (ahí se elige WhatsApp). Compu: descarga el PNG y abre WhatsApp Web con el
// resumen en texto (WhatsApp no permite adjuntar una imagen desde un link). No lleva datos de la cartera.
export function CompartirAnalisis({ resumen }: { resumen: ResumenCompartible | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!resumen) return null;

  const generar = async (): Promise<Blob> => {
    if (!ref.current) throw new Error('No se pudo preparar la imagen.');
    // Las fuentes del sistema ya están cargadas; skipFonts evita pedir hojas de fuentes externas (CORS) que romperían la captura.
    const blob = await toBlob(ref.current, { pixelRatio: 2, cacheBust: true, backgroundColor: '#ffffff', skipFonts: true });
    if (!blob) throw new Error('No se pudo generar la imagen.');
    return blob;
  };
  const descargar = (blob: Blob, nombre: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const correr = async (fn: (blob: Blob) => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await fn(await generar()); }
    catch (e) { if ((e as Error)?.name !== 'AbortError') setMsg(e instanceof Error ? e.message : 'No se pudo compartir.'); }
    finally { setBusy(false); }
  };

  const soloDescargar = () => correr(async blob => { descargar(blob, nombreArchivo(resumen)); setMsg('Imagen descargada ✓'); });

  const whatsapp = () => correr(async blob => {
    const nombre = nombreArchivo(resumen);
    const texto = textoWhatsApp(resumen);
    const file = new File([blob], nombre, { type: 'image/png' });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: `Análisis ${resumen.titulo}`, text: texto });
      return;
    }
    descargar(blob, nombre);
    window.open(urlWhatsApp(texto), '_blank', 'noopener');
    setMsg('Descargué la imagen y abrí WhatsApp con el resumen: adjuntá la imagen desde tu carpeta de descargas.');
  });

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span title="Compartir el análisis como imagen (celular: menú Compartir → WhatsApp)">
        <Button variant="ghost" onClick={whatsapp} disabled={busy}><Share2 className="w-4 h-4" /> {busy ? 'Preparando…' : 'Compartir'}</Button>
      </span>
      <span title="Descargar el análisis como imagen PNG">
        <Button variant="ghost" onClick={soloDescargar} disabled={busy}><Download className="w-4 h-4" /> Imagen</Button>
      </span>
      {msg && <span role="status" className="text-[11px] text-ink-600">{msg}</span>}
      {/* Fuera de pantalla pero renderizada: html-to-image necesita el nodo en el DOM. */}
      <div aria-hidden style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
        <div ref={ref}><TarjetaImagen r={resumen} /></div>
      </div>
    </div>
  );
}
