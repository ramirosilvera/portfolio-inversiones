// =============================================================================
// Clasificación de foso económico (Buffett/Munger) y sector para las empresas de DEFAULT_CIK.
//
// Es JUICIO CUALITATIVO curado a mano, no un dato que el código calcule — mismo criterio que
// calificadora/calificacion de bonos (engine/rating.ts): la Regla de oro #1 del proyecto reserva
// justamente esto para la interpretación cualitativa, nunca para una fórmula. No es un hecho
// infalible: es un análisis razonado sobre 83 empresas grandes y muy seguidas públicamente (no un
// dato que cambie día a día como un precio), pensado para filtrar el Radar al buscar qué seguir —
// tan editable como cualquier otro dato curado de este archivo si no coincide con tu propia lectura.
//
// Framework: los 5 tipos de foso de la tradición Buffett/Munger (la formalización más usada, la de
// Morningstar, está construida directamente sobre sus ideas — no es un marco ajeno aplicado acá):
//   red             — efecto de red: el producto vale más cuantos más lo usan (dos lados o directo).
//   costos_cambio   — migrar a un competidor es caro, lento o riesgoso para el cliente.
//   costos          — ventaja de costo estructural (escala, proceso, acceso a un insumo único).
//   intangibles     — marca, patentes o licencia regulatoria que un competidor no puede replicar.
//   escala_eficiente— el mercado es tan chico que solo alcanza para 1-2 jugadores rentables (nicho).
// Una empresa puede tener más de un foso a la vez (lo normal en las más fuertes) — `fosos` es un
// array, no un valor único.
//
// `amplitud` (ancho/estrecho/ninguno) es el eje de DURABILIDAD del foso — mismo concepto de
// "moat width" que usa la industria de research (Morningstar wide/narrow/no-moat): ancho = ventaja
// duradera y defendible a 10+ años, estrecho = existe pero bajo presión competitiva real o
// estructuralmente limitada (ej. patentes que vencen), ninguno = negocio de commodity/cíclico sin
// protección estructural más allá de la escala del momento.
// =============================================================================

export type Sector =
  | 'Tecnología' | 'Salud' | 'Financiero' | 'Consumo discrecional' | 'Consumo básico'
  | 'Industrial' | 'Energía' | 'Comunicación' | 'Materiales';

export type TipoFoso = 'red' | 'costos_cambio' | 'costos' | 'intangibles' | 'escala_eficiente';

export type AmplitudFoso = 'ancho' | 'estrecho' | 'ninguno';

export interface ClasificacionMoat {
  sector: Sector;
  fosos: TipoFoso[];
  amplitud: AmplitudFoso;
  nota: string; // justificación breve, específica de la empresa — no una frase genérica repetida
}

export const SECTOR_LABEL: Record<Sector, string> = {
  'Tecnología': 'Tecnología', 'Salud': 'Salud', 'Financiero': 'Financiero',
  'Consumo discrecional': 'Consumo discrecional', 'Consumo básico': 'Consumo básico',
  'Industrial': 'Industrial', 'Energía': 'Energía', 'Comunicación': 'Comunicación', 'Materiales': 'Materiales',
};

export const FOSO_LABEL: Record<TipoFoso, string> = {
  red: 'Efecto de red',
  costos_cambio: 'Costos de cambio',
  costos: 'Ventaja de costos',
  intangibles: 'Intangibles (marca/patentes/regulación)',
  escala_eficiente: 'Escala eficiente (nicho)',
};

export const AMPLITUD_LABEL: Record<AmplitudFoso, string> = {
  ancho: 'Foso ancho', estrecho: 'Foso estrecho', ninguno: 'Sin foso claro',
};

// Tono compartido por RadarPage (columna Foso) y AnalisisPage (tarjeta de foso) — mismo criterio
// que el grado de crédito de bonos (RatingBadge, ui.tsx): ancho = más durable = pos, estrecho =
// warn (real pero bajo presión), ninguno = gray (no necesariamente un negocio malo, solo sin
// barrera estructural — no amerita el rojo de "default").
export const AMPLITUD_TONE: Record<AmplitudFoso, 'pos' | 'warn' | 'gray'> = { ancho: 'pos', estrecho: 'warn', ninguno: 'gray' };

// Ticker deduplicado (BRK.B, no BRKB — ver TICKERS_CONOCIDOS en RadarPage.tsx) → clasificación.
export const COMPANY_MOAT: Record<string, ClasificacionMoat> = {
  UNH: { sector: 'Salud', fosos: ['escala_eficiente', 'costos_cambio'], amplitud: 'ancho',
    nota: 'Mayor aseguradora de salud de EE.UU., con Optum integrado verticalmente (PBM + proveedores) — escala regulatoria difícil de replicar.' },
  MA: { sector: 'Financiero', fosos: ['red'], amplitud: 'ancho',
    nota: 'Red de pagos de dos lados (comercios + tarjetahabientes) junto con Visa — duopolio global de facto.' },
  MSFT: { sector: 'Tecnología', fosos: ['costos_cambio', 'red'], amplitud: 'ancho',
    nota: 'Office/Windows/Azure profundamente integrados en procesos empresariales — migrar es costoso y lento.' },
  GOOGL: { sector: 'Comunicación', fosos: ['red', 'intangibles'], amplitud: 'ancho',
    nota: 'Búsqueda con efecto de red de datos (más búsquedas → mejor producto → más búsquedas) + posición dominante en publicidad digital.' },
  MRK: { sector: 'Salud', fosos: ['intangibles'], amplitud: 'estrecho',
    nota: 'Patentes farmacéuticas — foso real pero temporal por naturaleza ("patent cliff" recurrente en toda la industria).' },
  MELI: { sector: 'Consumo discrecional', fosos: ['red', 'costos_cambio'], amplitud: 'ancho',
    nota: 'Marketplace dominante en Latinoamérica + Mercado Pago — efecto de red regional reforzado por logística propia.' },
  LAC: { sector: 'Materiales', fosos: [], amplitud: 'ninguno',
    nota: 'Minera de litio en desarrollo temprano — negocio de commodity, sin foso estructural probado todavía (alto riesgo de proyecto, no de foso).' },
  ADBE: { sector: 'Tecnología', fosos: ['costos_cambio', 'intangibles'], amplitud: 'ancho',
    nota: 'Creative Suite es el estándar de facto de la industria creativa — flujos de trabajo enteros dependen de sus formatos.' },
  AMZN: { sector: 'Consumo discrecional', fosos: ['costos', 'red', 'costos_cambio'], amplitud: 'ancho',
    nota: 'Escala logística + marketplace de dos lados en e-commerce, más AWS con switching costs propios en infraestructura cloud.' },
  ACN: { sector: 'Tecnología', fosos: ['costos_cambio', 'intangibles'], amplitud: 'estrecho',
    nota: 'Contratos de consultoría/IT de largo plazo con integración profunda, pero industria competitiva sin barrera de entrada dura.' },
  NKE: { sector: 'Consumo discrecional', fosos: ['intangibles'], amplitud: 'estrecho',
    nota: 'Marca histórica muy fuerte, pero foso cuestionado en años recientes por competencia directa (On, Hoka) y menor poder de fijación de precio.' },
  AAPL: { sector: 'Tecnología', fosos: ['red', 'costos_cambio', 'intangibles'], amplitud: 'ancho',
    nota: 'Ecosistema hardware+software+servicios con altísimos costos de cambio percibidos, más marca premium.' },
  ASML: { sector: 'Tecnología', fosos: ['intangibles', 'escala_eficiente'], amplitud: 'ancho',
    nota: 'Único proveedor mundial de litografía EUV — probablemente el foso más duro de toda esta lista (monopolio tecnológico real, no solo de mercado).' },
  KO: { sector: 'Consumo básico', fosos: ['intangibles', 'costos'], amplitud: 'ancho',
    nota: 'Marca global + red de distribución/embotelladoras construida durante más de un siglo.' },
  V: { sector: 'Financiero', fosos: ['red'], amplitud: 'ancho',
    nota: 'Mismo foso que Mastercard — red de pagos de dos lados, duopolio global.' },
  WMT: { sector: 'Consumo básico', fosos: ['costos'], amplitud: 'ancho',
    nota: 'Escala de compra y logística que presiona costos por debajo de casi cualquier competidor de retail físico.' },
  NVDA: { sector: 'Tecnología', fosos: ['intangibles', 'costos_cambio'], amplitud: 'ancho',
    nota: 'Liderazgo técnico en GPUs de IA reforzado por CUDA (ecosistema de software que ata a los desarrolladores) — foso actualmente muy fuerte, aunque en un sector de cambio tecnológico rápido.' },
  META: { sector: 'Comunicación', fosos: ['red'], amplitud: 'ancho',
    nota: 'Efecto de red social (Facebook/Instagram/WhatsApp) — el valor de la red crece con cada usuario nuevo.' },
  JNJ: { sector: 'Salud', fosos: ['intangibles', 'costos'], amplitud: 'ancho',
    nota: 'Portafolio diversificado de patentes en pharma + medtech, con escala de distribución global.' },
  PG: { sector: 'Consumo básico', fosos: ['intangibles', 'costos'], amplitud: 'ancho',
    nota: 'Portafolio de marcas líderes en múltiples categorías + escala de distribución minorista.' },
  PEP: { sector: 'Consumo básico', fosos: ['intangibles', 'costos'], amplitud: 'ancho',
    nota: 'Marca + red de distribución (bebidas y snacks) de escala comparable a KO.' },
  COST: { sector: 'Consumo básico', fosos: ['costos', 'costos_cambio'], amplitud: 'ancho',
    nota: 'Modelo de membresía paga (costo de cambio real: el cliente ya pagó por entrar) combinado con escala de compra.' },
  LLY: { sector: 'Salud', fosos: ['intangibles'], amplitud: 'ancho',
    nota: 'Dominancia actual en GLP-1 (obesidad/diabetes) vía patentes — foso hoy muy fuerte, aunque estructuralmente temporal como toda patente farma.' },
  JPM: { sector: 'Financiero', fosos: ['escala_eficiente', 'costos_cambio', 'intangibles'], amplitud: 'ancho',
    nota: 'Mayor banco de EE.UU. por activos, con escala regulatoria y banca relacional — uno de los bancos mejor gestionados del sector.' },
  TSLA: { sector: 'Consumo discrecional', fosos: ['intangibles', 'costos'], amplitud: 'estrecho',
    nota: 'Marca y ventaja de manufactura/batería reales, pero foso menos probado que el resto de esta lista — competencia de EVs creciendo rápido en todo el mundo.' },
  ORCL: { sector: 'Tecnología', fosos: ['costos_cambio'], amplitud: 'ancho',
    nota: 'Bases de datos empresariales legacy extremadamente difíciles de migrar — foso fuerte en su nicho instalado, más débil en cloud nuevo.' },
  CRM: { sector: 'Tecnología', fosos: ['costos_cambio'], amplitud: 'estrecho',
    nota: 'CRM integrado en procesos de venta, pero categoría SaaS con más competencia que las bases de datos legacy de Oracle.' },
  ADP: { sector: 'Tecnología', fosos: ['costos_cambio', 'escala_eficiente'], amplitud: 'ancho',
    nota: 'Nómina es un proceso crítico y de alto riesgo migrar; además la complejidad regulatoria (impuestos por jurisdicción) favorece a los jugadores establecidos.' },
  IBM: { sector: 'Tecnología', fosos: ['costos_cambio', 'intangibles'], amplitud: 'estrecho',
    nota: 'Sistemas mainframe legacy con switching costs reales, pero el foso general de la empresa se erosionó mucho respecto de décadas pasadas.' },
  INTC: { sector: 'Tecnología', fosos: ['costos'], amplitud: 'estrecho',
    nota: 'Ventaja de fabricación propia históricamente fuerte, pero claramente deteriorada frente a TSMC/AMD en los últimos años — vale decirlo con honestidad, no es el foso de antes.' },
  CSCO: { sector: 'Tecnología', fosos: ['costos_cambio'], amplitud: 'estrecho',
    nota: 'Infraestructura de red instalada con switching costs, en un mercado de networking cada vez más competido.' },
  AMD: { sector: 'Tecnología', fosos: ['intangibles'], amplitud: 'estrecho',
    nota: 'Diseño de chips competitivo (recuperó terreno frente a Intel), pero sector de altísima competencia técnica, sin foso estructural duro.' },
  QCOM: { sector: 'Tecnología', fosos: ['intangibles'], amplitud: 'ancho',
    nota: 'Patentes esenciales de telefonía móvil con modelo de licenciamiento — foso legal, no solo técnico.' },
  TXN: { sector: 'Tecnología', fosos: ['costos', 'costos_cambio'], amplitud: 'ancho',
    nota: 'Semiconductores analógicos con manufactura propia (control de costos) y diseños integrados en productos de clientes durante años.' },
  AVGO: { sector: 'Tecnología', fosos: ['intangibles', 'costos_cambio'], amplitud: 'ancho',
    nota: 'Portafolio amplio de IP en semiconductores + software enterprise (VMware) con switching costs propios.' },
  NFLX: { sector: 'Comunicación', fosos: ['costos', 'costos_cambio'], amplitud: 'estrecho',
    nota: 'Escala en producción de contenido y datos de recomendación, pero streaming es un sector de competencia intensa (Disney+, HBO Max, Prime Video).' },
  TSM: { sector: 'Tecnología', fosos: ['costos_cambio', 'intangibles', 'escala_eficiente'], amplitud: 'ancho',
    nota: 'Fundidora dominante de semiconductores de borde de proceso (>60% del mercado de foundry avanzado) — los clientes fabless diseñan sus chips alrededor del proceso de TSM (costo de cambio real) y el capex para competir a ese nodo es tan alto que hoy solo TSM/Samsung/Intel lo intentan.' },
  PYPL: { sector: 'Financiero', fosos: ['red'], amplitud: 'estrecho',
    nota: 'Efecto de red real pero más débil que Visa/Mastercard — presión creciente de Apple Pay y billeteras nativas de cada banco.' },
  NOW: { sector: 'Tecnología', fosos: ['costos_cambio'], amplitud: 'ancho',
    nota: 'Plataforma de workflows integrada profundamente en procesos de IT/operaciones empresariales — migrar implica rediseñar procesos enteros.' },
  INTU: { sector: 'Tecnología', fosos: ['costos_cambio', 'intangibles'], amplitud: 'ancho',
    nota: 'TurboTax/QuickBooks con datos históricos del usuario acumulados (costo de cambio) + marca de confianza en un tema sensible (impuestos/contabilidad).' },
  PLTR: { sector: 'Tecnología', fosos: ['costos_cambio'], amplitud: 'estrecho',
    nota: 'Integración profunda en operaciones críticas de clientes gubernamentales/enterprise, pero es una empresa más joven con foso todavía menos probado en el tiempo que el resto de la lista.' },
  ABT: { sector: 'Salud', fosos: ['intangibles', 'costos'], amplitud: 'ancho',
    nota: 'Portafolio diversificado (medtech, diagnósticos, nutrición) con escala y patentes — menos dependiente de una sola droga que una farmacéutica pura.' },
  ABBV: { sector: 'Salud', fosos: ['intangibles'], amplitud: 'estrecho',
    nota: 'Ya perdió la exclusividad de Humira (su droga histórica) — ejemplo real y reciente de "patent cliff", en proceso de diversificar hacia nuevas patentes.' },
  TMO: { sector: 'Salud', fosos: ['costos_cambio', 'costos'], amplitud: 'ancho',
    nota: 'Modelo de equipos + consumibles/reactivos recurrentes (razor-and-blade) en instrumentos de laboratorio — cliente atado al ecosistema del fabricante.' },
  PFE: { sector: 'Salud', fosos: ['intangibles'], amplitud: 'estrecho',
    nota: 'Patentes farma con patent cliffs recurrentes, además de la caída conocida de ingresos post-pico de COVID.' },
  AMGN: { sector: 'Salud', fosos: ['intangibles'], amplitud: 'ancho',
    nota: 'Biológicos (no químicos pequeños) son estructuralmente más difíciles de replicar por genéricos que las drogas tradicionales — foso algo más duradero dentro de pharma.' },
  GILD: { sector: 'Salud', fosos: ['intangibles'], amplitud: 'ancho',
    nota: 'Liderazgo de larga data en tratamientos de VIH — dominancia de nicho terapéutico específico, no solo una patente aislada.' },
  BMY: { sector: 'Salud', fosos: ['intangibles'], amplitud: 'estrecho',
    nota: 'Mismo patrón que otras farmacéuticas grandes — patentes con vencimiento, sin ventaja adicional clara fuera del portafolio.' },
  CVS: { sector: 'Salud', fosos: ['escala_eficiente', 'costos_cambio'], amplitud: 'estrecho',
    nota: 'Integración farmacia + PBM + seguros (Aetna) le da escala real, pero el sector de PBMs enfrenta presión regulatoria y de márgenes.' },
  ISRG: { sector: 'Salud', fosos: ['costos_cambio', 'intangibles', 'escala_eficiente'], amplitud: 'ancho',
    nota: 'Cirujanos entrenados en el sistema Da Vinci no cambian fácil de plataforma (entrenamiento + certificación), más patentes y ser pionero en robótica quirúrgica — uno de los fosos más claros de toda la lista, y encima sin deuda (ver sesión anterior).' },
  DHR: { sector: 'Salud', fosos: ['costos_cambio', 'costos'], amplitud: 'ancho',
    nota: 'Mismo modelo razor-and-blade que Thermo Fisher en instrumentos de diagnóstico/life sciences.' },
  'BRK.B': { sector: 'Financiero', fosos: ['intangibles', 'costos'], amplitud: 'ancho',
    nota: 'Conglomerado de seguros + participaciones — el "foso" acá es más sobre el modelo de capital permanente y reputación que sobre un negocio único.' },
  BAC: { sector: 'Financiero', fosos: ['escala_eficiente', 'costos_cambio'], amplitud: 'ancho',
    nota: 'Segundo banco más grande de EE.UU. por activos — escala regulatoria y de red de sucursales/digital.' },
  WFC: { sector: 'Financiero', fosos: ['escala_eficiente', 'costos_cambio'], amplitud: 'estrecho',
    nota: 'Misma escala estructural que otros bancos grandes, pero reputación dañada por escándalos pasados (cuentas falsas) — foso presente pero menos limpio que JPM/BAC.' },
  C: { sector: 'Financiero', fosos: ['escala_eficiente'], amplitud: 'estrecho',
    nota: 'Escala global real, pero rendimiento histórico consistentemente más débil que sus pares — el foso no se tradujo en resultados tan sólidos.' },
  GS: { sector: 'Financiero', fosos: ['intangibles', 'escala_eficiente'], amplitud: 'ancho',
    nota: 'Marca y relaciones dominantes en banca de inversión — negocio de asesoría de alto valor agregado, no de commodity.' },
  MS: { sector: 'Financiero', fosos: ['intangibles', 'escala_eficiente'], amplitud: 'ancho',
    nota: 'Mismo tipo de foso que Goldman en banca de inversión, con fuerte adición de escala en wealth management.' },
  AXP: { sector: 'Financiero', fosos: ['red', 'intangibles'], amplitud: 'ancho',
    nota: 'Red de pagos propia (a diferencia de Visa/Mastercard, es emisor y red a la vez) + marca premium asociada a clientes de alto gasto.' },
  BLK: { sector: 'Financiero', fosos: ['costos', 'costos_cambio'], amplitud: 'ancho',
    nota: 'Mayor gestora de activos del mundo (iShares/ETFs) con escala de costos, más Aladdin como plataforma de riesgo integrada en clientes institucionales.' },
  SPGI: { sector: 'Financiero', fosos: ['intangibles', 'escala_eficiente'], amplitud: 'ancho',
    nota: 'Duopolio regulado de calificación crediticia junto con Moody\'s — uno de los fosos más fuertes y menos discutibles de toda la lista.' },
  SCHW: { sector: 'Financiero', fosos: ['costos_cambio', 'costos'], amplitud: 'estrecho',
    nota: 'Escala real en brokerage/custodia, en un negocio de comisiones cada vez más presionado a la baja en toda la industria.' },
  HD: { sector: 'Consumo discrecional', fosos: ['costos', 'intangibles'], amplitud: 'ancho',
    nota: 'Escala de compra + relación con contratistas profesionales (mayor parte del ticket promedio) difícil de replicar.' },
  LOW: { sector: 'Consumo discrecional', fosos: ['costos', 'intangibles'], amplitud: 'ancho',
    nota: 'Mismo tipo de foso que Home Depot, en el rol de segundo jugador del duopolio del sector.' },
  MCD: { sector: 'Consumo discrecional', fosos: ['intangibles', 'costos'], amplitud: 'ancho',
    nota: 'Marca global más el modelo inmobiliario (dueño de gran parte de los terrenos que alquila a franquiciados) — foso poco replicable.' },
  SBUX: { sector: 'Consumo discrecional', fosos: ['intangibles', 'costos_cambio'], amplitud: 'estrecho',
    nota: 'Marca fuerte + programa de fidelización, pero competencia de cafeterías locales y presión de márgenes más marcada que en McDonald\'s.' },
  BKNG: { sector: 'Consumo discrecional', fosos: ['red', 'costos'], amplitud: 'ancho',
    nota: 'Marketplace de dos lados (hoteles + viajeros) con escala de datos/algoritmos de búsqueda.' },
  MDLZ: { sector: 'Consumo básico', fosos: ['intangibles', 'costos'], amplitud: 'ancho',
    nota: 'Portafolio de marcas de snacks globales con escala de distribución, mismo patrón que PG/PEP/KO.' },
  MO: { sector: 'Consumo básico', fosos: ['intangibles', 'costos'], amplitud: 'ancho',
    nota: 'Marca Marlboro dominante, con la propia regulación restrictiva del sector funcionando como barrera de entrada — industria en declive estructural de volumen, vale mencionarlo.' },
  CL: { sector: 'Consumo básico', fosos: ['intangibles', 'costos'], amplitud: 'ancho',
    nota: 'Marcas líderes en cuidado personal/higiene con escala de distribución global.' },
  PM: { sector: 'Consumo básico', fosos: ['intangibles'], amplitud: 'ancho',
    nota: 'Marlboro a nivel internacional (fuera de EE.UU.) más apuesta relevante en productos de riesgo reducido (IQOS).' },
  DIS: { sector: 'Comunicación', fosos: ['intangibles', 'costos'], amplitud: 'ancho',
    nota: 'Propiedad intelectual difícil de igualar (Marvel, Star Wars, Pixar, Disney clásico) monetizada en streaming, parques y merchandising a la vez.' },
  XOM: { sector: 'Energía', fosos: ['costos'], amplitud: 'estrecho',
    nota: 'Escala y activos de bajo costo real, pero negocio de commodity puro — el precio no lo controla la empresa, foso limitado por definición.' },
  CVX: { sector: 'Energía', fosos: ['costos'], amplitud: 'estrecho',
    nota: 'Mismo patrón que ExxonMobil — escala de producción, pero expuesto al ciclo de precios de un commodity global.' },
  CAT: { sector: 'Industrial', fosos: ['costos_cambio', 'intangibles'], amplitud: 'ancho',
    nota: 'Red de distribuidores/repuestos/servicio post-venta a nivel mundial — el negocio de piezas y mantenimiento ata al cliente más que la venta inicial de la máquina.' },
  DE: { sector: 'Industrial', fosos: ['costos_cambio', 'intangibles'], amplitud: 'ancho',
    nota: 'Mismo modelo que Caterpillar en maquinaria agrícola, reforzado por tecnología de agricultura de precisión integrada en el equipo.' },
  BA: { sector: 'Industrial', fosos: ['escala_eficiente', 'costos_cambio'], amplitud: 'estrecho',
    nota: 'Duopolio estructural con Airbus (barrera de entrada altísima) y switching costs reales para aerolíneas, pero años recientes de problemas de calidad/ejecución reales que hay que reconocer, no solo el foso teórico.' },
  MMM: { sector: 'Industrial', fosos: ['intangibles'], amplitud: 'estrecho',
    nota: 'Portafolio amplio de patentes en múltiples nichos industriales, empañado por litigios recientes (PFAS, earplugs militares) que pesan sobre el negocio.' },
  HON: { sector: 'Industrial', fosos: ['costos_cambio', 'intangibles'], amplitud: 'ancho',
    nota: 'Sistemas industriales/aeroespaciales integrados profundamente en las operaciones del cliente, similar en espíritu a Caterpillar/Deere.' },
  GE: { sector: 'Industrial', fosos: ['escala_eficiente', 'costos_cambio'], amplitud: 'ancho',
    nota: 'Tras la reestructuración (GE Aerospace), el negocio de motores de avión es un cuasi-duopolio con contratos de mantenimiento de largo plazo — foso de alta calidad en lo que quedó de la empresa.' },
  UPS: { sector: 'Industrial', fosos: ['costos'], amplitud: 'estrecho',
    nota: 'Escala de red de distribución real, pero cada vez más presionada por FedEx y la logística propia de Amazon.' },
  F: { sector: 'Consumo discrecional', fosos: ['intangibles'], amplitud: 'ninguno',
    nota: 'Marca reconocida, pero industria automotriz de capital intensivo, márgenes bajos y competencia global fuerte — sin foso estructural claro más allá de la escala del momento.' },
  GM: { sector: 'Consumo discrecional', fosos: ['intangibles'], amplitud: 'ninguno',
    nota: 'Mismo diagnóstico que Ford — negocio cíclico y de capital intensivo sin ventaja estructural duradera evidente.' },
  VZ: { sector: 'Comunicación', fosos: ['costos', 'costos_cambio'], amplitud: 'estrecho',
    nota: 'Infraestructura de red cara de replicar, pero industria de telecom con competencia de precios intensa entre 3 jugadores grandes en EE.UU.' },
  T: { sector: 'Comunicación', fosos: ['costos', 'costos_cambio'], amplitud: 'estrecho',
    nota: 'Mismo patrón que Verizon — escala de infraestructura, presionada por competencia de precios en un mercado maduro.' },
};
