// =============================================================================
// Control: ajustes de la Liquidez SIN su aporte/retiro de capital. Si el efectivo de la cartera sube o baja por una edición manual
// (movimiento 'ajuste' de LIQUIDEZ) pero no hay un aporte/retiro del mismo monto, el valor de la cartera cambia y el capital aportado
// no: la ganancia (valor + retiros − aportes) queda distorsionada por exactamente ese monto. Puro y testeado.
// Baja de Liquidez ⇒ falta un retiro; suba ⇒ falta un aporte. Se toleran 3 días entre el ajuste y el flujo y 0,5 % o US$ 0,05 de diferencia.
// =============================================================================

export interface AjusteLiquidezMov { id?: string; ticker: string; tipo: string; cantidad: number; fecha: string }
export interface FlujoCapital { fecha: string; monto: number; tipo: string }

export interface AjusteSinFlujo {
  fecha: string;
  monto: number;                 // con signo: negativo = salió efectivo, positivo = entró
  falta: 'retiro' | 'aporte';
}

const DIA = 86_400_000;
const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DIA;

export function ajustesSinFlujo(movs: AjusteLiquidezMov[], flujos: FlujoCapital[]): AjusteSinFlujo[] {
  const usados = new Set<number>();
  const out: AjusteSinFlujo[] = [];
  const ajustes = movs.filter(m => m.ticker === 'LIQUIDEZ' && m.tipo === 'ajuste' && Number(m.cantidad) !== 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const m of ajustes) {
    const c = Number(m.cantidad) || 0;
    const sale = c < 0;
    const idx = flujos.findIndex((f, i) => !usados.has(i)
      && (f.tipo === 'retiro') === sale
      && dias(f.fecha, m.fecha) <= 3
      && Math.abs(f.monto - Math.abs(c)) <= Math.max(0.05, Math.abs(c) * 0.005));
    if (idx >= 0) usados.add(idx);
    else out.push({ fecha: m.fecha, monto: c, falta: sale ? 'retiro' : 'aporte' });
  }
  return out;
}
