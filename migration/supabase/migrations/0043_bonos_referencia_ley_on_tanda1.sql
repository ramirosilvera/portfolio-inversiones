-- ===========================================================================
-- Primera tanda de clasificación de `ley` (ver 0042) para Obligaciones Negociables (ON) — los ~69
-- tickers que quedaron `NULL` a propósito en 0042 porque, a diferencia del soberano, no hay 2
-- familias de ticker conocidas para inferir en bloque.
--
-- Investigación real por emisor/clase (sesión 2026-08-21), vía prospectos/avisos de suscripción en
-- CNV/sitios de los propios emisores, notas de estudios de abogados que asesoraron cada colocación
-- (Bruchou Funes, Cleary Gottlieb, Marval, abogados.com.ar), y el prefijo del ISIN de cada especie
-- (AR0… = Caja de Valores Argentina/ley local; USP… = código internacional 144A/Reg S, típico de
-- ley Nueva York) — NUNCA un solo snippet de precio/ficha de broker sin ese respaldo.
--
-- Dos niveles de confianza, ambos con evidencia real (nunca una adivinanza):
--   * VERIFICADO: cita textual de la cláusula de ley aplicable, o ISIN confirmado + asesores legales
--     de la colocación citados por fuente independiente.
--   * INFERENCIA: mismo Programa Global/clase-familia que un ticker YA verificado del mismo emisor,
--     sin ningún indicio de que ese ticker puntual sea distinto (Genneia/Arcor/CAPEX confirman que
--     UN mismo emisor puede tener clases locales Y extranjeras a la vez, así que esta inferencia
--     solo se aplicó dentro de la MISMA familia/clase numerada, nunca "todo lo demás del emisor").
--
-- Quedan explícitamente SIN clasificar (ni verificado ni inferencia razonable encontrada — mejor
-- vacío que adivinado): YM43D (no investigado en esta tanda), VSCID/VSCJD/VSCTD (Vista Energy
-- mezcla clases locales y de ley NY en el mismo programa sin patrón claro), NPCDD, PLC5D (sin ISIN
-- ni prospecto propio localizado). Y los ~34 tickers de emisores no cubiertos en esta tanda (bancos
-- chicos, CNH Industrial, CGC, Farmcity, Inversora Juramento, Minas Argentinas, Pecom, Banco de
-- Valores, Plaza Logística, TY37D/TY38D) — quedan para una tanda 2.
-- ===========================================================================

-- YPF S.A. — inversores.ypf.com separa sus prospectos en carpetas .../locales/ vs .../internacionales/,
-- usado como fuente primaria del propio emisor. YM39D/YM40D: inferencia (misma carpeta "locales" que
-- la serie 38-42 verificada, sin prospecto propio hallado).
update public.bonos_referencia set ley = 'extranjera' where ticker in ('YM34D','YMCID','YMCJD','YMCXD');
update public.bonos_referencia set ley = 'local' where ticker in ('YM38D','YM39D','YM40D','YM41D','YM42D');

-- Pampa Energía S.A. — MGC1D/MGCRD/MGCOD: notas internacionales (Cleary Gottlieb/Davis Polk como
-- asesores NY). MGCTD: colocación local reciente (31/03/2026, prensa propia del emisor).
update public.bonos_referencia set ley = 'extranjera' where ticker in ('MGC1D','MGCRD','MGCOD');
update public.bonos_referencia set ley = 'local' where ticker = 'MGCTD';

-- CRESUD S.A.C.I.F. y A. — Clases XLIII-LIII, mismo Programa Global (Ley 23.576 + Ley 26.831),
-- descriptas en los propios 6-K de Cresud ante la SEC como colocaciones de mercado local.
update public.bonos_referencia set ley = 'local' where ticker in ('CS48D','CS49D','CS50D','CS51D','CS52D','CS53D');

-- CAPEX S.A. — Clases XI/XII locales (Ley 23.576, programa CNV RESFC-2022-21941). Clase V (CAC5D):
-- canje 2023 con Exchange Offering Memorandum internacional, ley de Nueva York confirmada.
update public.bonos_referencia set ley = 'local' where ticker in ('CACBD','CACDD');
update public.bonos_referencia set ley = 'extranjera' where ticker = 'CAC5D';

-- Genneia S.A. — Clase XLIX, bono verde internacional US$400M, ley de Nueva York confirmada
-- (Bruchou Funes de Rioja, pv magazine Latam).
update public.bonos_referencia set ley = 'extranjera' where ticker = 'GN49D';

-- Mirgor S.A.C.I.F.I.A. — Clase III verificada local (BBVA, suplemento con cláusula estándar de ON
-- local); Clase IV por inferencia (mismo programa).
update public.bonos_referencia set ley = 'local' where ticker in ('MIC3D','MIC4D');

-- Telecom Argentina S.A. — Clase 28 verificada local (abogados.com.ar, cita textual Ley 23.576).
-- Clases 14/25 por inferencia (mismo Programa Global CNV Res. 19481/2018 que 23/28). Clase
-- "9,500% Notes 2031" (TLCMD): colocación 144A/RegS internacional, 6-K SEC, asesorada por Cleary
-- Gottlieb/A&O Shearman — patrón consistente con ley de Nueva York.
update public.bonos_referencia set ley = 'local' where ticker in ('TLCFD','TLCQD','TLCUD');
update public.bonos_referencia set ley = 'extranjera' where ticker = 'TLCMD';

-- Arcor S.A.I.C. — "Serie I" 2033 (RC1CD): bono internacional, ley Nueva York confirmada (Bloomberg
-- Línea, Petrini Valores). Clase 2 (RC2CD): Programa Global CNV, cláusula de arbitraje local.
update public.bonos_referencia set ley = 'extranjera' where ticker = 'RC1CD';
update public.bonos_referencia set ley = 'local' where ticker = 'RC2CD';

-- Loma Negra Compañía Industrial Argentina S.A. — Clase 5 verificada local (abogados.com.ar, cita
-- textual). Clase 6 por inferencia (mismo Programa CNV RESFC-2020-20695).
update public.bonos_referencia set ley = 'local' where ticker in ('LOC5D','LOC6D');

-- Vista Energy Argentina S.A.U. — Clase XXVI/XXVIII verificadas local ("Cable, Ley Local" en Max
-- Capital; Ley 23.576 en Bruchou/CNV). Clase XXIX verificada extranjera (Bruchou Funes de Rioja:
-- "governed by New York law", Cleary Gottlieb + Linklaters). Vista mezcla clases locales y NY en el
-- mismo programa (a diferencia del resto), así que NO se infiere para XVII/XVIII/XXVII sin
-- verificación directa — quedan sin clasificar.
update public.bonos_referencia set ley = 'local' where ticker in ('VSCRD','VSCUD');
update public.bonos_referencia set ley = 'extranjera' where ticker = 'VSCVD';

-- Pan American Energy S.L. (sucursal Argentina) — Clases 41/42 locales (Ley 23.576/26.831, sin
-- marca REGS). Clase 12 (PNDCD) y Clase 31 (PNXCD): 144A/RegS, ISIN internacional confirmado, ley
-- de Nueva York (RoadShow.com.ar, Cbonds, Chambers and Partners — trustee BNY Mellon).
update public.bonos_referencia set ley = 'local' where ticker in ('PN41D','PN42D');
update public.bonos_referencia set ley = 'extranjera' where ticker in ('PNDCD','PNXCD');

-- Central Puerto S.A. — Clase C verificada local (ISIN AR0630055561, Valo.ar). Clase D (NPCDD): sin
-- ISIN propio localizado, queda sin clasificar.
update public.bonos_referencia set ley = 'local' where ticker = 'NPCCD';

-- Pluspetrol S.A. — Clase IV (PLC4D): ISIN USP7924AAA62 (Reg S), emisión internacional confirmada.
-- Clase 6 (PLC6D): ISIN AR0559091100, local. Clase 5 (PLC5D): sin ISIN propio localizado, queda sin
-- clasificar.
update public.bonos_referencia set ley = 'extranjera' where ticker = 'PLC4D';
update public.bonos_referencia set ley = 'local' where ticker = 'PLC6D';

-- EDENOR S.A. — Clase VII: ISIN USP3710FAU86 (Reg S/144A), asesores DLA Piper/Clifford Chance US,
-- emisión internacional confirmada.
update public.bonos_referencia set ley = 'extranjera' where ticker = 'DNC7D';

-- Tecpetrol S.A. — Clase 11: ISIN AR0152326457, prospecto propio con cita textual "leyes de
-- Argentina".
update public.bonos_referencia set ley = 'local' where ticker = 'TTCBD';

-- Transportadora de Gas del Sur S.A. — Clase 4: ISIN USP9308RBB89 (Reg S/144A), asesores Skadden/
-- Cleary Gottlieb, emisión internacional confirmada.
update public.bonos_referencia set ley = 'extranjera' where ticker = 'TSC4D';

-- San Miguel S.A. — Serie XIII Clase B: ISIN AR0295506908, prospecto propio con cita textual "leyes
-- de la República Argentina".
update public.bonos_referencia set ley = 'local' where ticker = 'SNEBD';
