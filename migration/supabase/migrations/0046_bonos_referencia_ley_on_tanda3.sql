-- ===========================================================================
-- Tercera y última tanda de clasificación de `ley` (ver 0042/0043/0045) para los 7 tickers que
-- quedaron pendientes en 0045. Investigación real con ángulos de búsqueda distintos a las 2 rondas
-- anteriores (sesión 2026-08-21).
--
-- 4 resueltos con confianza estructural alta (oferta pública 100% local vía CNV, marco legal citado
-- explícitamente, o identificación de la clase específica con evidencia cruzada de fecha/tasa/monto):
-- HBCDD, FYC1D, JNC6D, MJC1D.
--
-- 3 quedan DEFINITIVAMENTE sin clasificar después de 3 rondas de investigación real — no hay
-- evidencia suficiente, y seguir insistiendo no va a producir un dato mejor que uno inventado:
--   * BNCXD (Banco Santander Argentina): se confirmó el patrón del emisor (todas sus clases
--     conocidas son locales), pero nunca se pudo atar el ticker a una clase/ISIN específica.
--   * TY37D, TY38D: emisor no identificado en 3 rondas. No aparecen en Rava/Cohen/Allaria/
--     Puentenet ni en licitaciones del Tesoro. Una fuente (Banco Provincia) sugiere que TY38D
--     podría ser un bono CER, pero sin confirmar emisor. Quedan para carga 100% manual desde la
--     app cuando se pueda verificar directamente en CNV/BYMA.
-- ===========================================================================

-- Banco Hipotecario S.A. — HBCDD identificado como Clase 12 (USD 34.407.562, 6,00%, vto.
-- 20/11/2026), emitida el mismo día que la Clase 11 bajo Régimen de Emisor Frecuente local —
-- distinta del eurobono Reg S/144A HBC4O (ley Nueva York) del mismo banco.
update public.bonos_referencia set ley = 'local' where ticker = 'HBCDD';

-- Farmcity S.A. — FYC1D (Clase I, Hard Dollar MEP): 100% oferta pública CNV, cláusula de
-- jurisdicción que remite al Tribunal Arbitral de la Bolsa de Comercio de Buenos Aires o
-- tribunales competentes de Argentina.
update public.bonos_referencia set ley = 'local' where ticker = 'FYC1D';

-- Inversora Juramento S.A. — JNC6D (Clase VI): marco regulatorio confirmado (Ley 23.576/26.831/
-- 27.440, normas CNV), calificada localmente por FIX SCR.
update public.bonos_referencia set ley = 'local' where ticker = 'JNC6D';

-- Minas Argentinas S.A. — MJC1D (Clase 1, ON inaugural): oferta pública CNV colocada por
-- brokers locales (Balanz/Inviu) en el mercado argentino.
update public.bonos_referencia set ley = 'local' where ticker = 'MJC1D';
