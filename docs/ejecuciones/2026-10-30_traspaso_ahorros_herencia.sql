-- Traspaso Ahorros -> Herencia a valor de mercado (plan del 30/10/2026) + liquidez de Ahorros por broker.
-- Pegar y ejecutar UNA sola vez en el SQL Editor de Supabase (proyecto wyedmgxngqdgnxmbencl).
-- Se frena solo si el traspaso ya figura registrado. Todo o nada (una transacción).
--
-- Qué hace:
--  * Ahorros "vende" a Herencia MA 48, MELI 69 y LAC 63 (los lotes de IOL) al precio de mercado (precio subyacente ÷ ratio, el de la app).
--  * Herencia los "compra" con su Liquidez (costo promedio ponderado). NO hay aporte ni retiro de capital.
--  * La Liquidez de Ahorros queda repartida por broker: Santander +500, Cocos 1.130 (alta del broker) e IOL = cobrado − 1.630 retirados.

do $$
declare
  a constant uuid := 'a8124780-21e7-485a-b9b1-469033aa80ba';  -- Ahorros
  h constant uuid := '0225d029-1bb7-4bb2-81d4-b0e061dbcefe';  -- Herencia
  v_iol uuid; v_san uuid; v_cocos uuid; v_hoy date := current_date; v_user uuid;
  r record; pa uuid; ph uuid; px numeric; val numeric; tot numeric := 0;
  la uuid; lh uuid; m_la uuid; m_lh uuid; q0 double precision; c0 double precision;
  v_nota text := 'Traspaso Ahorros → Herencia a valor de mercado (salida de IOL de Ahorros, plan 30/10/2026); Herencia pagó con su Liquidez';
begin
  if exists (select 1 from movimientos m where m.portfolio_id = a and m.nota like 'Traspaso Ahorros → Herencia a valor de mercado%') then
    raise exception 'El traspaso ya está registrado';
  end if;
  select id, user_id into v_iol, v_user from brokers where nombre = 'Invertir Online';
  select id into v_san from brokers where nombre = 'Santander';
  select id into v_cocos from brokers where nombre = 'Cocos';
  if v_cocos is null then
    insert into brokers (user_id, nombre) values (v_user, 'Cocos') returning id into v_cocos;
  end if;
  select id into la from posiciones where portfolio_id = a and tipo = 'cash' and ticker = 'LIQUIDEZ';
  select id into lh from posiciones where portfolio_id = h and tipo = 'cash' and ticker = 'LIQUIDEZ';
  for r in select * from (values ('MA', 48::double precision), ('MELI', 69), ('LAC', 63)) t(tk, q) loop
    select id into pa from posiciones where portfolio_id = a and tipo = 'cedear' and ticker = r.tk;
    select id into ph from posiciones where portfolio_id = h and tipo = 'cedear' and ticker = r.tk and cantidad > 0;
    if pa is null or ph is null then raise exception 'Falta la posición % en alguno de los portfolios', r.tk; end if;
    select round((pc.precio / coalesce(p.ratio_cedear, 1))::numeric, 4) into px
      from precios_cache pc join posiciones p on p.id = pa where pc.ticker = r.tk;
    val := round((r.q * px)::numeric, 2); tot := tot + val;
    m_la := gen_random_uuid();
    insert into movimientos (id, portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota)
      values (m_la, a, la, 'LIQUIDEZ', 'compra', val, 1, v_hoy, 'Cobro del traspaso de ' || r.q || ' ' || r.tk || ' a Herencia');
    insert into movimientos (portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota, liquidez_mov_id)
      values (a, pa, r.tk, 'venta', r.q, px, v_hoy, v_nota, m_la);
    -- brokers primero (el lote de IOL se agota: la tabla exige cantidad > 0, por eso se borra la fila)
    delete from posicion_brokers where posicion_id = pa and broker_id = v_iol and cantidad - r.q <= 1e-9;
    update posicion_brokers set cantidad = cantidad - r.q where posicion_id = pa and broker_id = v_iol;
    update posiciones set cantidad = cantidad - r.q where id = pa;
    m_lh := gen_random_uuid();
    insert into movimientos (id, portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota)
      values (m_lh, h, lh, 'LIQUIDEZ', 'venta', val, 1, v_hoy, 'Pago a Ahorros por el traspaso de ' || r.q || ' ' || r.tk);
    insert into movimientos (portfolio_id, posicion_id, ticker, tipo, cantidad, precio, fecha, nota, liquidez_mov_id)
      values (h, ph, r.tk, 'compra', r.q, px, v_hoy, v_nota, m_lh);
    select cantidad, precio_compra into q0, c0 from posiciones where id = ph;
    update posiciones set precio_compra = (q0 * c0 + r.q * px) / (q0 + r.q), cantidad = q0 + r.q where id = ph;
    update posicion_brokers set cantidad = cantidad + r.q where posicion_id = ph and broker_id = v_iol;
    update posicion_brokers set cantidad = cantidad - val where posicion_id = lh and broker_id = v_iol;
    update posiciones set cantidad = cantidad - val where id = lh;
    update posiciones set cantidad = cantidad + val where id = la;
  end loop;
  -- Liquidez de Ahorros por broker: cobrado de Herencia (tot) − 1.630 retirados de IOL (500 → Santander, 1.130 → Cocos)
  insert into posicion_brokers (posicion_id, broker_id, cantidad) values (la, v_iol, tot - 1630)
    on conflict (posicion_id, broker_id) do update set cantidad = posicion_brokers.cantidad + excluded.cantidad;
  update posicion_brokers set cantidad = cantidad + 500 where posicion_id = la and broker_id = v_san;
  insert into posicion_brokers (posicion_id, broker_id, cantidad) values (la, v_cocos, 1130)
    on conflict (posicion_id, broker_id) do update set cantidad = posicion_brokers.cantidad + excluded.cantidad;
end $$;

-- Control: Herencia debe quedar con MA 245, MELI 251, LAC 298 y Liquidez ≈ 3.649; Ahorros con MA 100, MELI 61, LAC 202 y Liquidez ≈ 2.020.
select p.portfolio_id, p.ticker, p.cantidad, round(p.precio_compra::numeric, 4) as costo
from posiciones p where p.ticker in ('MA', 'MELI', 'LAC', 'LIQUIDEZ') and p.cantidad > 0 order by p.portfolio_id, p.ticker;
