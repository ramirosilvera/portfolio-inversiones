import { describe, it, expect } from 'vitest';
import { dedupeByConflictKey, parseTickers, TICKER_RE, CIK_RE, requireCronSecret, type Env } from './_shared';

describe('dedupeByConflictKey', () => {
  it('sin duplicados: devuelve todas las filas igual', () => {
    const rows = [{ ticker: 'A', precio: 1 }, { ticker: 'B', precio: 2 }];
    expect(dedupeByConflictKey(rows, 'ticker')).toEqual(rows);
  });

  it('con duplicados por la clave de conflicto: se queda con UNA fila por clave (la última)', () => {
    // Caso real que rompió producción: una posición partida entre brokers repite el ticker en el
    // request de cotizaciones — dos fetches concurrentes, ambos intentan upsertear 'MELI'.
    const rows = [
      { ticker: 'MELI', precio: 100 },
      { ticker: 'MA', precio: 200 },
      { ticker: 'MELI', precio: 101 }, // el mismo ticker de nuevo, precio distinto (timing)
    ];
    const out = dedupeByConflictKey(rows, 'ticker') as { ticker: string; precio: number }[];
    expect(out.length).toBe(2);
    const meli = out.find(r => r.ticker === 'MELI')!;
    expect(meli.precio).toBe(101); // última gana, mismo criterio que resolution=merge-duplicates
  });

  it('clave compuesta (varias columnas): dedupea por la combinación, no por una sola columna', () => {
    const rows = [
      { portfolio_id: 'p1', fecha: '2026-01-01', valor: 10 },
      { portfolio_id: 'p1', fecha: '2026-01-02', valor: 20 }, // misma portfolio, otra fecha → NO es duplicado
      { portfolio_id: 'p1', fecha: '2026-01-01', valor: 15 }, // mismo par → duplicado del primero
    ];
    const out = dedupeByConflictKey(rows, 'portfolio_id,fecha') as { valor: number }[];
    expect(out.length).toBe(2);
    expect(out.map(r => r.valor).sort()).toEqual([15, 20]);
  });

  it('lista vacía → lista vacía', () => {
    expect(dedupeByConflictKey([], 'ticker')).toEqual([]);
  });
});

describe('TICKER_RE', () => {
  it('acepta tickers reales (equities, CEDEARs, bonos con sufijo, clases con punto)', () => {
    for (const t of ['MSFT', 'GGAL', 'BPOD', 'AL30D', 'BRK.B', 'A']) expect(TICKER_RE.test(t)).toBe(true);
  });

  it('rechaza caracteres que romperían un filtro PostgREST o una URL de proveedor', () => {
    // Caso real de la auditoría: "#" trunca el filtro PostgREST (?ticker=eq.X#... corta ahí) y
    // devolvía el análisis cacheado de OTRO ticker/usuario.
    for (const t of ['AAPL#', 'AAPL&select=*', 'AAPL/../x', '', 'AAPLAAPLAAPL', 'aa pl']) {
      expect(TICKER_RE.test(t)).toBe(false);
    }
  });
});

describe('CIK_RE', () => {
  it('acepta exactamente 10 dígitos', () => expect(CIK_RE.test('0000320193')).toBe(true));
  it('rechaza cualquier otro formato', () => {
    for (const c of ['320193', '00003201930', 'abcdefghij', '']) expect(CIK_RE.test(c)).toBe(false);
  });
});

describe('parseTickers', () => {
  const url = (qs: string) => new URL(`https://x.test/api?${qs}`);

  it('parsea, mayúsculiza, deduplica y descarta vacíos', () => {
    expect(parseTickers(url('tickers=msft,GGAL,,msft'), 'tickers')).toEqual(['MSFT', 'GGAL']);
  });

  it('cae al segundo param si el primero no vino (ej. "tickers" vs "ticker")', () => {
    expect(parseTickers(url('ticker=aapl'), 'tickers', 'ticker')).toEqual(['AAPL']);
  });

  it('descarta valores con formato inválido en vez de dejarlos pasar', () => {
    // Mismo caso que TICKER_RE: un ticker malicioso no debe llegar ni siquiera a la lista.
    expect(parseTickers(url('tickers=MSFT,AAPL%23,GGAL'), 'tickers')).toEqual(['MSFT', 'GGAL']);
  });

  it('sin el param: lista vacía', () => {
    expect(parseTickers(url(''), 'tickers')).toEqual([]);
  });
});

describe('requireCronSecret', () => {
  const req = (headers: Record<string, string> = {}) => new Request('https://x.test/api/cron/x', { headers });

  it('sin CRON_SECRET configurado: se niega a correr (500), no queda abierto', () => {
    // Bug real de la auditoría: antes, sin el secret configurado, el endpoint aceptaba CUALQUIER
    // request sin autenticación — este es el fail-closed que lo reemplaza.
    const env = {} as Env;
    const res = requireCronSecret(env, req());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
  });

  it('con CRON_SECRET configurado pero header ausente/incorrecto: 401', () => {
    const env = { CRON_SECRET: 'shh' } as Env;
    expect(requireCronSecret(env, req())!.status).toBe(401);
    expect(requireCronSecret(env, req({ 'X-Cron-Secret': 'otro' }))!.status).toBe(401);
  });

  it('con CRON_SECRET configurado y header correcto: null (autorizado)', () => {
    const env = { CRON_SECRET: 'shh' } as Env;
    expect(requireCronSecret(env, req({ 'X-Cron-Secret': 'shh' }))).toBeNull();
  });
});
