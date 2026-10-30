-- Parte 2 (ejecutar DESPUÉS de 2026-10-30_traspaso_ahorros_herencia.sql, una sola vez, en el SQL Editor de Supabase).
-- Registra en Ahorros las ventas ejecutadas en IOL el 30/10/2026 y configura el broker Cocos.
--
-- Datos REALES de IOL (get_activities, 30/10/2026):
--   UNHD  : venta 44 u  @ 13,09  → neto US$ 573,87 (comisión US$ 2,09 + AR$ 543,59). Liquida T+1 (lun 02/11). Operación 194263319.
--   CS51D : venta 1.614 VN @ 101,25 (por 100 VN = 1,0125) → neto US$ 1.629,28 (comisión US$ 4,90 + AR$ 254,93). Liquida T+1. Operación 194263317.
--   Total neto a recibir en IOL: US$ 2.203,15 (coincide con el saldo T+1 de IOL).
-- Cocos: orden de Ramiro por 1.095 VN de YM38D, gastos estimados US$ 6,25 sobre US$ 1.122,92 (0,557 % todo incluido) y monto final US$ 1.129,17.
--   Coincide con: comisión 0,45 % + IVA 21 % + derechos de mercado (≈ 0,012 %). La compra se registra cuando Ramiro confirme el boleto.

do $$
declare
  a constant uuid := 'a8124780-21e7-485a-b9b1-469033aa80ba';  -- Ahorros
  v_iol uuid; v_hoy date := '2026-10-30';
  la uuid; pu uuid; pc uuid; m_u uuid; m_c uuid; v_mep numeric;
begin
  if exists (select 1 from ordenes_ejecutadas o where o.portfolio_id = a and o.numero_orden in ('194263319', '194263317')) then
    raise exception 'Las ventas ya están registradas';
  end if;
  select id into v_iol from brokers where nombre = 'Invertir Online';
  select id into la from posiciones where portfolio_id = a and tipo = 'cash' and ticker = 'LIQUIDEZ';
  select id into pu from posiciones where portfolio_id = a and tipo = 'cedear' and ticker = 'UNH';
  select id into pc from posiciones where portfolio_id = a and tipo = 'bono' and ticker = 'CS51D';
  select mep into v_mep from fx_historico where fecha <= v_hoy order by fecha desc limit 1;

  -- UNH (lote de IOL: 44; quedan 113 en Santander)
  m_u := gen_random_uuid();
  insert into movimientos (id, portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota)
    values (m_u, a, la, 'LIQUIDEZ', 'compra', 573.87, 1, v_hoy, 'Venta de 44 UNH en IOL (neto de comisión; liquida 02/11)');
  insert into movimientos (portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota, liquidez_mov_id)
    values (a, pu, 'UNH', 'venta', 44, 13.09, v_hoy, 'Venta lote IOL (salida de IOL de Ahorros, plan 30/10/2026)', m_u);
  delete from posicion_brokers where posicion_id = pu and broker_id = v_iol;
  update posiciones set cantidad = cantidad - 44 where id = pu;

  -- CS51D (todo)
  m_c := gen_random_uuid();
  insert into movimientos (id, portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota)
    values (m_c, a, la, 'LIQUIDEZ', 'compra', 1629.28, 1, v_hoy, 'Venta de 1.614 CS51D en IOL (neto de comisión; liquida 02/11)');
  insert into movimientos (portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota, liquidez_mov_id)
    values (a, pc, 'CS51D', 'venta', 1614, 1.0125, v_hoy, 'Venta total en IOL (plan 30/10/2026)', m_c);
  delete from posicion_brokers where posicion_id = pc and broker_id = v_iol;
  update posiciones set cantidad = 0 where id = pc;

  -- Liquidez de Ahorros: lo vendido queda en IOL hasta que Ramiro lo retire hacia BBVA
  insert into posicion_brokers (posicion_id, broker_id, cantidad) values (la, v_iol, 573.87 + 1629.28)
    on conflict (posicion_id, broker_id) do update set cantidad = posicion_brokers.cantidad + excluded.cantidad;
  update posiciones set cantidad = cantidad + 573.87 + 1629.28 where id = la;

  -- Órdenes reales de IOL (con comisión)
  insert into ordenes_ejecutadas (portfolio_id, fecha, ticker, broker, numero_orden, nominales, precio_ejecutado, monto_usd, comision_usd, comision_ars, estado, origen, mep, lado, nota)
  values
    (a, v_hoy, 'UNHD', 'IOL', '194263319', 44, 13.09, 575.96, 2.09, 543.59, 'terminada', 'api', v_mep, 'venta', 'Venta de salida de IOL (plan 30/10/2026) | liquida 02/11 | MEP: fx_historico'),
    (a, v_hoy, 'CS51D', 'IOL', '194263317', 1614, 1.0125, 1634.18, 4.90, 254.93, 'terminada', 'api', v_mep, 'venta', 'Venta de salida de IOL (plan 30/10/2026) | precio 101,25 por 100 VN | liquida 02/11 | MEP: fx_historico');
end $$;

-- Broker Cocos: comisión de operación todo incluido (0,45 % + IVA + derechos de mercado ≈ 0,557 %, según el preview real de la orden de YM38D).
-- Cobros (dividendos/cupones) y retención: sin dato verificado → quedan en null (se usa el 1 % general hasta cargar el dato real).
update brokers set comision_operacion = 0.00557 where nombre = 'Cocos';

-- Control: Ahorros debe quedar con UNH 113, CS51D 0 y Liquidez ≈ 4.223 (7 + 2.013 + 2.203).
select p.ticker, p.cantidad from posiciones p
where p.portfolio_id = 'a8124780-21e7-485a-b9b1-469033aa80ba' and p.ticker in ('UNH', 'CS51D', 'LIQUIDEZ');
