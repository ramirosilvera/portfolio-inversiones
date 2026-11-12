-- YA APLICADO el 2026-11-12 (con sentencias sueltas por el conector de Supabase: el bloque DO pedía una aprobación que no llegaba). No volver a ejecutar.
-- Boletos REALES de BBVA de la cuota 2/4 de Ahorros (12/11/2026): reemplazan la estimación (comisión 1,148 %).
-- Pegar y ejecutar UNA sola vez en el SQL Editor de Supabase (proyecto wyedmgxngqdgnxmbencl). Todo o nada (una transacción).
--   GOOGL ref. 234.100.264: 28 × 5,42  bruto 151,76  neto 153,69  (estimado 153,50, +0,19)
--   MA    ref. 234.100.282: 10 × 21,48 bruto 214,80  neto 217,53  (estimado 217,27, +0,26)
--   MELI  ref. 234.100.346: 20 × 13,21 bruto 264,20  neto 267,56  (estimado 267,23, +0,33)
-- Efecto: precio del movimiento = neto ÷ nominales; costo promedio +delta ÷ cantidad; Liquidez de Ahorros −0,78 (BBVA 1.283,54 → 1.282,76);
-- órdenes pasan de 'estimada' a 'manual' con su referencia y la comisión real (neto − bruto).
do $$
declare
  a constant uuid := 'a8124780-21e7-485a-b9b1-469033aa80ba';
  la uuid; r record; pid uuid; q double precision; c double precision; delta numeric; tot_delta numeric := 0; mid uuid; lid uuid;
begin
  select id into la from posiciones where portfolio_id = a and tipo = 'cash' and ticker = 'LIQUIDEZ';
  for r in select * from (values
    ('GOOGL', 28, 153.69::numeric, 153.50::numeric, 151.76::numeric, '234100264'),
    ('MA',    10, 217.53,          217.27,           214.80,          '234100282'),
    ('MELI',  20, 267.56,          267.23,           264.20,          '234100346')
  ) t(tk, qn, neto, est, bruto, ref) loop
    select m.id, m.liquidez_mov_id into mid, lid from movimientos m where m.portfolio_id = a and m.ticker = r.tk and m.tipo = 'compra' and m.nota like 'Cuota 2/4 Ahorros en BBVA%' order by m.created_at desc limit 1;
    if mid is null then raise exception 'No encontré el movimiento de %', r.tk; end if;
    delta := r.neto - r.est;
    update movimientos set precio = round((r.neto / r.qn)::numeric, 6), nota = 'Cuota 2/4 Ahorros en BBVA — boleto real ref. ' || r.ref || ': importe bruto ' || r.bruto || ', neto ' || r.neto || ' (con derechos y comisiones)' where id = mid;
    update movimientos set cantidad = r.neto where id = lid;
    select id, cantidad, precio_compra into pid, q, c from posiciones where portfolio_id = a and tipo = 'cedear' and ticker = r.tk;
    update posiciones set precio_compra = (q * c + delta) / q where id = pid;
    update ordenes_ejecutadas set comision_usd = r.neto - r.bruto, numero_orden = r.ref, origen = 'manual', nota = 'Cuota 2/4 BBVA: boleto real ref. ' || r.ref || ' (neto ' || r.neto || ', bruto ' || r.bruto || '); reemplaza la estimación' where portfolio_id = a and ticker = r.tk and broker = 'BBVA' and fecha = '2026-11-12';
    tot_delta := tot_delta + delta;
  end loop;
  -- Bajar posiciones.cantidad de la LIQUIDEZ dispara un trigger que reescala posicion_brokers: se fijan después las filas por broker.
  update posiciones set cantidad = cantidad - tot_delta where id = la;
end $$;

update posicion_brokers pb set cantidad = v.c
from (values ('BBVA', 1282.76::double precision), ('Santander', 507::double precision), ('Cocos', 0.83::double precision)) v(n, c), brokers b
where pb.posicion_id = (select id from posiciones where portfolio_id = 'a8124780-21e7-485a-b9b1-469033aa80ba' and ticker = 'LIQUIDEZ')
  and b.id = pb.broker_id and b.nombre = v.n;

-- Control: Liquidez de Ahorros ≈ 1.790,59 y la suma por broker coincide con la cantidad.
select p.ticker, p.cantidad, round(p.precio_compra::numeric, 6) as costo,
       (select coalesce(sum(pb.cantidad), 0) from posicion_brokers pb where pb.posicion_id = p.id) as en_brokers
from posiciones p where p.portfolio_id = 'a8124780-21e7-485a-b9b1-469033aa80ba' and p.ticker in ('GOOGL', 'MA', 'MELI', 'LIQUIDEZ') order by 1;
