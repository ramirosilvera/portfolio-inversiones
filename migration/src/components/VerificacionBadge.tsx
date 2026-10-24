import { ShieldCheck, BadgeCheck, CircleCheck, TriangleAlert, OctagonX, CircleHelp } from 'lucide-react';
import { Badge } from './ui';
import { VERIFICACION, nivelDe, textoVerificacion, type NivelVerificacion } from '../engine/verificacion';

const ICONO: Record<NivelVerificacion, typeof ShieldCheck> = {
  primaria: ShieldCheck, secundaria: BadgeCheck, consistente: CircleCheck,
  revisar: TriangleAlert, inconsistente: OctagonX, sin_verificar: CircleHelp,
};

// Etiqueta corta para la tabla; la explicación completa (nivel + nota + fecha) queda en el tooltip. El ícono acompaña al color para
// que el estado no dependa solo de distinguir tonos.
const CORTO: Record<NivelVerificacion, string> = {
  primaria: 'Primaria', secundaria: 'Externa', consistente: 'Consistente',
  revisar: 'Revisar', inconsistente: 'Inconsistente', sin_verificar: 'Sin verificar',
};

export function VerificacionBadge({ bono, largo = false }: {
  bono: { verificacion?: string | null; verificacion_nota?: string | null; verificado_en?: string | null };
  largo?: boolean;
}) {
  const n = nivelDe(bono);
  const Icono = ICONO[n];
  return (
    <span title={textoVerificacion(bono)} className="inline-flex">
      <Badge tone={VERIFICACION[n].tono}>
        <span className="inline-flex items-center gap-1"><Icono className="w-3 h-3" aria-hidden="true" />{largo ? VERIFICACION[n].label : CORTO[n]}</span>
      </Badge>
    </span>
  );
}
