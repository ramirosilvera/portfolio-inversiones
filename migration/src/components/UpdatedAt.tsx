import { RefreshCw, AlertTriangle } from 'lucide-react';
import { useDataStatus } from '../hooks/usePosiciones';

// Muestra cuándo se actualizaron por última vez los datos de mercado (referencia para el usuario).
// Con `tickers` (los tenidos, sin efectivo) avisa si alguno lleva más de 72 h sin precio fresco: la
// app sigue mostrando el último precio conocido cuando la fuente falla, y antes no había forma de
// saberlo (la fecha de arriba es la del dato MÁS NUEVO de toda la cache, no la de tu cartera).
export function UpdatedAt({ className = '', icon = false, tickers }: { className?: string; icon?: boolean; tickers?: string[] }) {
  const { data } = useDataStatus(tickers);
  if (!data?.last) return null;
  const d = new Date(data.last);
  const corto = d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const viejos = data.cartera?.viejos ?? [];
  return (
    <span className={`inline-flex items-center gap-2 text-[11px] text-ink-500 ${className}`}>
      <span className="inline-flex items-center gap-1" title={`Datos de mercado actualizados: ${d.toLocaleString('es-AR')}`}>
        {icon && <RefreshCw className="w-3 h-3" />} Datos al {corto} hs
      </span>
      {viejos.length > 0 && (
        <span className="inline-flex items-center gap-1 text-warn"
          title={`Sin precio fresco hace más de 72 h (se muestra el último): ${viejos.join(', ')}`}>
          <AlertTriangle className="w-3 h-3" /> {viejos.length} precio{viejos.length > 1 ? 's' : ''} viejo{viejos.length > 1 ? 's' : ''}
        </span>
      )}
    </span>
  );
}
