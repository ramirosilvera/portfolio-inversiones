-- ===========================================================================
-- Segunda tanda de clasificación de `ley` (ver 0042/0043) para Obligaciones Negociables (ON) —
-- cubre los emisores restantes del catálogo (bancos chicos/medianos, CNH Industrial, CFN, CGC,
-- Pecom, Plaza Logística) más un reintento de los 6 tickers que quedaron sin clasificar en 0043
-- (YM43D, Vista Energy VSCID/VSCJD/VSCTD, Central Puerto NPCDD, Pluspetrol PLC5D — todos resueltos
-- esta vez vía ISIN o cita textual).
--
-- Investigación real (5 búsquedas en paralelo, sesión 2026-08-21), mismo criterio que 0043:
-- prospectos/avisos de suscripción, ISIN (AR0…=local vs. USP…=internacional 144A/Reg S) y
-- confirmación de asesores legales de la colocación (Bruchou Funes, Linklaters, etc.).
--
-- Quedan explícitamente SIN clasificar (evidencia contradictoria o insuficiente — mejor vacío que
-- adivinado): BNCXD (Banco Santander — no se pudo confirmar el ticker puntual), HBCDD (Banco
-- Hipotecario — señales contradictorias entre una clase local y el eurobono NY del mismo emisor),
-- FYC1D (Farmcity), JNC6D (Inversora Juramento), MJC1D (Minas Argentinas — sin cita textual
-- confiable), TY37D/TY38D (emisor no identificado — el prefijo "TY" en BYMA sugiere que podrían ser
-- bonos soberanos del Tesoro, no ONs corporativas; requiere confirmación directa antes de tocar
-- siquiera el `tipo` de estas 2 filas).
-- ===========================================================================

-- Banco Comafi S.A. — AFCID (Clase XVII, ISIN AR0736238632) y AFCKD (Clase XIX) verificados
-- local (Ley 23.576, prospecto). AFCJD: mismo aviso de suscripción (Clases XVIII/XIX/XX,
-- 02/02/2026) — inferencia por familia de clase, no verificado el ticker puntual.
update public.bonos_referencia set ley = 'local' where ticker in ('AFCID','AFCJD','AFCKD');

-- Banco Macro S.A. — BACHD: US$400M, 144A/Reg S, ISIN USP1047VAN75, asesorado por Linklaters
-- (Bruchou Funes de Rioja, Conventus Law) — colocación internacional confirmada.
update public.bonos_referencia set ley = 'extranjera' where ticker = 'BACHD';

-- Banco BBVA Argentina S.A. — BF45D (Clase 45): suplemento de prospecto cita Ley 23.576/26.831
-- para las Clases 44/45 — alta confianza, ticker puntual no verificado en ficha de broker.
update public.bonos_referencia set ley = 'local' where ticker = 'BF45D';

-- Banco Supervielle S.A. — Programa Global (Ley 23.576/19.550/26.831) confirmado en el prospecto
-- del programa y en cada clase individual verificada (BPCJO/BPCKO/BPCNO/BPCSO, todas ISIN AR0…).
-- BPCUD/BPCVD (Clases U/V) — inferencia por programa, sin ISIN puntual verificado.
update public.bonos_referencia set ley = 'local' where ticker in ('BPCUD','BPCVD');

-- Banco de Servicios y Transacciones S.A. (BST) — prospecto definitivo del programa cita
-- expresamente Ley 23.576/19.550/26.831/27.440. Inferencia por programa (sin ISIN puntual por
-- ticker).
update public.bonos_referencia set ley = 'local' where ticker in ('BVCPD','BVCRD','BVCUD');

-- Banco Galicia — BYCWD (Clase 30, ISIN AR0098652693) y BYCXD (Clase 31, ISIN AR0185542955),
-- ambos verificados local por ISIN (ficha Cohen).
update public.bonos_referencia set ley = 'local' where ticker in ('BYCWD','BYCXD');

-- Banco de Valores S.A. — VBC2D (Clase 2), ISIN AR0188242348, verificado local (Bruchou Funes de
-- Rioja asesoró la emisión, ficha TradingView).
update public.bonos_referencia set ley = 'local' where ticker = 'VBC2D';

-- CNH Industrial Capital Argentina S.A. — CIC9D (Clase 9) verificado local, cita textual del aviso
-- de suscripción ("leyes de la Argentina"). CIC7D/CICAD/CICBD: mismo Programa Global de oferta
-- pública local — inferencia por programa.
update public.bonos_referencia set ley = 'local' where ticker in ('CIC7D','CIC9D','CICAD','CICBD');

-- CFN S.A. — CFS9D (Serie 9): cláusula de ley local uniforme en toda la serie/programa (Series
-- VII/IX verificadas con cita textual) — inferencia por familia de serie.
update public.bonos_referencia set ley = 'local' where ticker = 'CFS9D';

-- Compañía General de Combustibles S.A. (CGC) — CP39D y CP40D, ambos verificados local por cita
-- textual del suplemento de prospecto de cada clase (Ley de Obligaciones Negociables argentina).
update public.bonos_referencia set ley = 'local' where ticker in ('CP39D','CP40D');

-- Pecom Servicios Energía S.A.U. — MCC3D (Clase 3), ISIN AR0922852063, verificado local (cita
-- textual: Ley 23.576/27.440/26.831).
update public.bonos_referencia set ley = 'local' where ticker = 'MCC3D';

-- Plaza Logística S.R.L. — ZPC3D (Clase 3): prospecto del Programa Global cita expresamente
-- "Ley N° 23.576" para todas sus clases — razonablemente confirmado, sin ISIN puntual de la Clase 3.
update public.bonos_referencia set ley = 'local' where ticker = 'ZPC3D';

-- Reintento de 0043 — YPF Clase 43 (YM43D): ISIN AR0156884063, local.
update public.bonos_referencia set ley = 'local' where ticker = 'YM43D';

-- Reintento de 0043 — Vista Energy Argentina: Clase XVII (VSCID, ISIN AROILG5600H2) y Clase XVIII
-- (VSCJD, ISIN AROILG5600I0), ambas local. Clase XXVII (VSCTD, ISIN USP9659RAA60), 144A/Reg S,
-- extranjera.
update public.bonos_referencia set ley = 'local' where ticker in ('VSCID','VSCJD');
update public.bonos_referencia set ley = 'extranjera' where ticker = 'VSCTD';

-- Reintento de 0043 — Central Puerto Clase D (NPCDD): confirmado local vía Form 6-K en SEC EDGAR
-- ("issued in the local market... applicable law being Argentine law").
update public.bonos_referencia set ley = 'local' where ticker = 'NPCDD';

-- Reintento de 0043 — Pluspetrol Clase V (PLC5D): ISIN USP7924AAC29, extranjera (144A/Reg S).
update public.bonos_referencia set ley = 'extranjera' where ticker = 'PLC5D';
