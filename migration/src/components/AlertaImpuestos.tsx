import { Link } from 'react-router-dom';
import { useImpuestos } from '../hooks/useImpuestos';
import { AlertasBanner } from './ui';

// Avisos de impuestos (Bienes Personales cerca/por encima del mínimo, declaración próxima con dividendos del exterior) sobre TODOS los
// portfolios juntos. No muestra nada mientras carga ni cuando no hay nada para avisar (ver engine/impuestos.ts).
export function AlertaImpuestos() {
  const { alertas, cargando } = useImpuestos();
  if (cargando || alertas.length === 0) return null;
  return (
    <div className="space-y-1">
      <AlertasBanner alertas={alertas} />
      <Link to="/impuestos" className="text-[11px] font-semibold text-celeste-600 hover:underline">Ver detalle de impuestos →</Link>
    </div>
  );
}
