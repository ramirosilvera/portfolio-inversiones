import { supabase } from './supabase';
import { objetivosTrasCierre, type ObjetivoItem } from '../engine/rebalance';

// Cuando una posición sale del portfolio (borrada, vendida entera o transferida entera) su % objetivo tiene que salir del plan y,
// si el plan sumaba 100 %, el resto se reescala para seguir sumando 100 % (engine/rebalance.objetivosTrasCierre). Se llama
// DESPUÉS de la operación principal; si falla, el que llama avisa que la operación se hizo pero los objetivos no se reajustaron.
export async function leerObjetivos(portfolioId: string): Promise<ObjetivoItem[]> {
  const { data, error } = await supabase.from('posiciones').select('id, peso_objetivo')
    .eq('portfolio_id', portfolioId).not('peso_objetivo', 'is', null);
  if (error) throw error;
  return (data ?? []) as ObjetivoItem[];
}

// `antes`: foto de los objetivos tomada ANTES de la operación — necesaria al borrar, porque después la fila ya no existe y no
// habría de dónde saber cuánto pesaba. Sin `antes` se lee ahora (venta o transferencia: la fila sigue, con cantidad 0).
export async function reajustarObjetivosTrasCierre(portfolioId: string, posicionId: string, antes?: ObjetivoItem[]): Promise<void> {
  const cambios = objetivosTrasCierre(antes ?? await leerObjetivos(portfolioId), posicionId);
  const results = await Promise.all(cambios.map(c =>
    supabase.from('posiciones').update({ peso_objetivo: c.peso_objetivo }).eq('id', c.id)));
  const fallo = results.find(r => r.error);
  if (fallo?.error) throw fallo.error;
}
