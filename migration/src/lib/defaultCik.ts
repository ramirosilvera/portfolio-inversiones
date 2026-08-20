// Espejo (frontend) del DEFAULT_CIK del servidor (functions/api/_edgar.ts). El backend resuelve
// el CIK por defecto a partir del ticker, pero el frontend necesita conocerlo para HABILITAR el
// fetch de fundamentals y saber cuándo un ticker realmente no tiene CIK. MANTENER EN SYNC con el
// server. Set estándar: mayores empresas del S&P que reportan a la SEC (us-gaap). Los que reportan
// 20-F/IFRS (ASML, MELI, TSM) pueden venir incompletos. El usuario puede sobrescribir/añadir en Config.
export const DEFAULT_CIK: Record<string, string> = {
  // --- set original ---
  UNH: '0000731766', MA: '0001141391', MSFT: '0000789019', GOOGL: '0001652044',
  MRK: '0000310158', MELI: '0001099590', LAC: '0001966983', ADBE: '0000796343',
  AMZN: '0001018724', ACN: '0001467373', NKE: '0000320187', AAPL: '0000320193',
  ASML: '0000937966', KO: '0000021344', V: '0001403161', WMT: '0000104169',
  NVDA: '0001045810', META: '0001326801', JNJ: '0000200406', PG: '0000080424',
  PEP: '0000077476', COST: '0000909832', LLY: '0000059478', JPM: '0000019617',
  // --- tecnología ---
  TSLA: '0001318605', ORCL: '0001341439', CRM: '0001108524', ADP: '0000008670',
  IBM: '0000051143', INTC: '0000050863', CSCO: '0000858877', AMD: '0000002488',
  QCOM: '0000804328', TXN: '0000097476', AVGO: '0001730168', NFLX: '0001065280',
  PYPL: '0001633917', NOW: '0001373715', INTU: '0000896878', PLTR: '0001321655',
  // TSM (Taiwan Semiconductor): CIK verificado contra fundamentals_cache en Supabase (ya tiene un
  // fetch real exitoso, no un valor supuesto). Reporta Form 20-F — parseAnnual()/IFRS_CONCEPTS en
  // el server (_edgar.ts) ya lo soportan (ver commits "fix: TSM SIN_DATOS...").
  TSM: '0001046179',
  // --- salud ---
  ABT: '0000001800', ABBV: '0001551152', TMO: '0000097745', PFE: '0000078003',
  AMGN: '0000318154', GILD: '0000882095', BMY: '0000014272', CVS: '0000064803',
  ISRG: '0001035267', DHR: '0000313616',
  // --- financieras ---
  BRKB: '0001067983', 'BRK.B': '0001067983', BAC: '0000070858', WFC: '0000072971',
  C: '0000831001', GS: '0000886982', MS: '0000895421', AXP: '0000004962',
  BLK: '0001364742', SPGI: '0000064040', SCHW: '0000316709',
  // --- consumo ---
  HD: '0000354950', LOW: '0000060667', MCD: '0000063908', SBUX: '0000829224',
  BKNG: '0001075531', MDLZ: '0001103982', MO: '0000764180', CL: '0000021665',
  PM: '0001413329', DIS: '0001744489',
  // --- industria / energía / materiales ---
  XOM: '0000034088', CVX: '0000093410', CAT: '0000018230', DE: '0000315189',
  BA: '0000012927', MMM: '0000066740', HON: '0000773840', GE: '0000040545',
  UPS: '0001090727', F: '0000037996', GM: '0001467858',
  // --- comunicaciones ---
  VZ: '0000732712', T: '0000732717',
};
