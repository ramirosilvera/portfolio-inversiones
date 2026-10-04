import { describe, it, expect } from 'vitest';
import { parseBackup, parseBackupVerificado, checksumTablas, verificarChecksum, referenciasHuerfanas, RESTORE_ORDER } from './backupParse';

// El backup de este archivo lo lee la app tal cual llega del usuario (JSON.parse de un archivo
// externo, potencialmente viejo) — no hace falta más que 1 fila en cualquier tabla para pasar el
// chequeo total > 0 de parseBackup.
function backup(version: number | undefined, extra: Record<string, unknown[]> = {}) {
  return JSON.stringify({
    app: 'portfolio-inversiones',
    backup_version: version,
    tables: { portfolios: [{ id: '1' }], ...extra },
  });
}

describe('parseBackup — avisos por versión (cada tabla nueva debe avisar en los backups anteriores)', () => {
  it('backup <= v6: avisa que falta amortizaciones_programadas (agregada en v7) Y dashboard_layout (v8)', () => {
    const r = parseBackup(backup(6));
    expect(r.avisos.some(a => a.includes('amortización manual'))).toBe(true);
    expect(r.avisos.some(a => a.includes('Dashboard personalizable'))).toBe(true);
  });

  it('backup v7: ya trae amortizaciones_programadas, pero todavía avisa que falta dashboard_layout (v8)', () => {
    const r = parseBackup(backup(7));
    expect(r.avisos.some(a => a.includes('amortización manual'))).toBe(false);
    expect(r.avisos.some(a => a.includes('Dashboard personalizable'))).toBe(true);
  });

  it('backup v8: ya trae dashboard_layout, pero avisa que falta bonos_destacados (v9) — este aviso faltaba antes del fix', () => {
    const r = parseBackup(backup(8));
    expect(r.avisos.some(a => a.includes('Dashboard personalizable'))).toBe(false);
    expect(r.avisos.some(a => a.includes('Destacados de renta fija'))).toBe(true);
  });

  it('backup v9: avisa que falta ordenes_ejecutadas (v10)', () => {
    const r = parseBackup(backup(9));
    expect(r.avisos.some(a => a.includes('ordenes_ejecutadas'))).toBe(true);
    expect(r.avisos.some(a => a.includes('bonos_destacados'))).toBe(false);
  });

  it('backup v11 (versión actual): sin avisos de tablas faltantes', () => {
    const r = parseBackup(backup(11));
    expect(r.avisos.some(a => a.includes('ordenes_ejecutadas'))).toBe(false);
    expect(r.avisos.some(a => a.includes('bonos_destacados'))).toBe(false);
    expect(r.avisos.some(a => a.includes('dashboard_layout'))).toBe(false);
    expect(r.avisos.some(a => a.includes('más nueva'))).toBe(false);
  });

  it('backup de una versión futura no soportada: avisa en vez de fallar en silencio', () => {
    const r = parseBackup(backup(12));
    expect(r.avisos.some(a => a.includes('más nueva'))).toBe(true);
  });

  it('backup sin backup_version (undefined): no explota, no dispara avisos de "<= N" por accidente', () => {
    const r = parseBackup(backup(undefined));
    expect(r.ok).toBe(true);
    expect(r.avisos.some(a => a.includes('amortización manual') || a.includes('Dashboard personalizable') || a.includes('Destacados de renta fija'))).toBe(false);
  });
});

describe('parseBackup — v10 sigue siendo restaurable sin avisos de más', () => {
  it('un backup v10 no avisa por dcf_analisis (tabla legacy sin aviso) ni por tablas anteriores', () => {
    const r = parseBackup(backup(10));
    expect(r.ok).toBe(true);
    expect(r.avisos).toEqual([]);
  });
  it('el aviso de transferencias (solo exportable) sale del registro', () => {
    const r = parseBackup(backup(11, { transferencias: [{ id: 't' }] }));
    expect(r.avisos.some(a => a.includes('Transferencias no se restaura'))).toBe(true);
    expect(RESTORE_ORDER.some(t => t.table === 'transferencias')).toBe(false);
  });
});

describe('integridad (checksum SHA-256)', () => {
  const tables = { portfolios: [{ id: '1', nombre: 'Ahorros' }], aportes: [{ id: 'a', portfolio_id: '1', monto: 10.5 }] };
  it('el checksum es estable y detecta cualquier cambio', async () => {
    const h1 = await checksumTablas(tables);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(await checksumTablas(JSON.parse(JSON.stringify(tables)))).toBe(h1);   // ida y vuelta por JSON
    expect(await checksumTablas({ ...tables, aportes: [{ id: 'a', portfolio_id: '1', monto: 10.6 }] })).not.toBe(h1);
  });
  it('verificarChecksum: ok / distinto / sin-checksum', async () => {
    const value = (await checksumTablas(tables))!;
    expect(await verificarChecksum({ tables, checksum: { alg: 'SHA-256', value } })).toBe('ok');
    expect(await verificarChecksum({ tables: { ...tables, portfolios: [] }, checksum: { alg: 'SHA-256', value } })).toBe('distinto');
    expect(await verificarChecksum({ tables })).toBe('sin-checksum');
  });
  it('parseBackupVerificado: un archivo alterado avisa primero y un backup viejo queda sin checksum', async () => {
    const value = (await checksumTablas(tables))!;
    const alterado = JSON.stringify({ app: 'portfolio-inversiones', backup_version: 11, checksum: { alg: 'SHA-256', value }, tables: { ...tables, portfolios: [{ id: '1', nombre: 'Otro' }] } });
    const r = await parseBackupVerificado(alterado);
    expect(r.integridad).toBe('distinto');
    expect(r.avisos[0]).toContain('NO coincide');
    const viejo = await parseBackupVerificado(backup(10));
    expect(viejo.integridad).toBe('sin-checksum');
  });
});

describe('referenciasHuerfanas', () => {
  it('un backup consistente no tiene huérfanos (nullable y links de liquidez incluidos)', () => {
    const t = {
      portfolios: [{ id: 'p' }], posiciones: [{ id: 'x', portfolio_id: 'p' }],
      movimientos: [{ id: 'm1', portfolio_id: 'p', posicion_id: 'x', liquidez_mov_id: 'm2' }, { id: 'm2', portfolio_id: 'p', posicion_id: null, liquidez_mov_id: null }],
      cobros: [{ id: 'c', portfolio_id: 'p', posicion_id: null, movimiento_id: null, liquidez_mov_id: 'm2' }],
    };
    expect(referenciasHuerfanas(t)).toEqual([]);
  });
  it('detecta hijos sin padre y los cuenta por relación', () => {
    const t = {
      portfolios: [{ id: 'p' }],
      posiciones: [{ id: 'x', portfolio_id: 'p' }, { id: 'y', portfolio_id: 'borrado' }],
      movimientos: [{ id: 'm', portfolio_id: 'p', posicion_id: 'inexistente' }],
      aportes: [{ id: 'a', portfolio_id: null }],   // portfolio_id NOT NULL: null cuenta como huérfano
    };
    const r = referenciasHuerfanas(t);
    expect(r).toContainEqual({ tabla: 'posiciones', campo: 'portfolio_id', padre: 'portfolios', n: 1 });
    expect(r).toContainEqual({ tabla: 'movimientos', campo: 'posicion_id', padre: 'posiciones', n: 1 });
    expect(r).toContainEqual({ tabla: 'aportes', campo: 'portfolio_id', padre: 'portfolios', n: 1 });
    const aviso = parseBackup(JSON.stringify({ app: 'portfolio-inversiones', backup_version: 11, tables: t }));
    expect(aviso.avisos.some(a => a.includes('apuntan a portfolios'))).toBe(true);
  });
});

describe('ida y vuelta: archivo armado como buildBackup() → parseBackupVerificado()', () => {
  it('el checksum sobrevive a JSON.stringify con sangría + JSON.parse, y detecta una fila borrada a mano', async () => {
    const tables = { portfolios: [{ id: 'p', nombre: 'Herencia', creado: '2026-07-17T10:00:00+00:00' }],
      posiciones: [{ id: 'x', portfolio_id: 'p', cantidad: 2552.5, precio_compra: 1.0116 }], aportes: [] };
    const value = (await checksumTablas(tables))!;
    const archivo = JSON.stringify({ app: 'portfolio-inversiones', backup_version: 11, checksum: { alg: 'SHA-256', value }, tables }, null, 2);
    const ok = await parseBackupVerificado(archivo);
    expect(ok.integridad).toBe('ok');
    expect(ok.huerfanos).toEqual([]);
    expect(ok.total).toBe(2);
    const roto = archivo.replace('"cantidad": 2552.5', '"cantidad": 2552');
    expect((await parseBackupVerificado(roto)).integridad).toBe('distinto');
  });
});

