import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface Transferencia {
  id: string;
  portfolio_origen_id: string;
  portfolio_destino_id: string;
  posicion_origen_id: string;
  posicion_destino_id: string | null;
  ticker: string;
  tipo: string;
  cantidad: number;
  precio_compra: number;
  fecha_compra: string | null;
  nota: string | null;
  created_at: string;
}

// Historial de transferencias donde participó CUALQUIERA de los portfolios del usuario (como
// origen o como destino) — no se filtra por uno solo, porque una transferencia le importa a los
// dos lados. RLS (transferencias_select) ya solo deja ver las propias.
export function useTransferencias() {
  return useQuery({
    queryKey: ['transferencias'],
    queryFn: async (): Promise<Transferencia[]> => {
      const { data, error } = await supabase.from('transferencias').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Todo el movimiento (restar en origen + crear en destino + loguear) pasa por una única función
// atómica en la base — ver 0024/0048/0049. No es una venta: no realiza P&L (en el origen queda un
// movimiento 'ajuste', en el destino una 'compra' al costo original), pero SÍ registra un flujo en
// aportes (retiro/inicial) para que el rendimiento por año no la cuente como ganancia/pérdida de
// mercado. `valorMercado` (cantidad × cotización de hoy) hace que ese flujo sea a mercado; sin
// cotización, la función cae al costo.
export function useTransferirPosicion() {
  const qc = useQueryClient();
  return async (posicionId: string, portfolioDestino: string, cantidad: number, nota?: string, valorMercado?: number | null): Promise<void> => {
    const { error } = await supabase.rpc('transferir_posicion', {
      p_posicion_id: posicionId, p_portfolio_destino: portfolioDestino, p_cantidad: cantidad, p_nota: nota || null,
      p_valor_mercado: valorMercado != null && valorMercado > 0 ? valorMercado : null,
    });
    if (error) throw error;
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['posiciones'] }),
      qc.invalidateQueries({ queryKey: ['transferencias'] }),
      qc.invalidateQueries({ queryKey: ['movimientos'] }),
      qc.invalidateQueries({ queryKey: ['aportes'] }),
      qc.invalidateQueries({ queryKey: ['posicion_brokers'] }),
    ]);
  };
}
