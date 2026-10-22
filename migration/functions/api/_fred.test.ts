import { describe, it, expect } from 'vitest';
import { parsearFredCsv, resumenDiag, procesarIngesta, SERIES_FRED } from './_fred';

const csv = (serie: string, filas: string[], cab = 'observation_date') => [`${cab},${serie}`, ...filas].join('\n');

describe('parsearFredCsv', () => {
  it('toma el último valor numérico de un CSV real de FRED, saltando los faltantes (".")', () => {
    expect(parsearFredCsv(csv('VIXCLS', ['2026-10-19,18.1', '2026-10-20,17.2', '2026-10-21,.']), 'VIXCLS', 'vix')).toBe(17.2);
    expect(parsearFredCsv(csv('DGS10', ['2026-10-20,4.31']), 'DGS10', 'dgs10')).toBe(4.31);
  });
  it('acepta el encabezado viejo (DATE) y fin de línea CRLF', () => {
    expect(parsearFredCsv(csv('DGS3MO', ['2026-10-20,4.05'], 'DATE').replace(/\n/g, '\r\n'), 'DGS3MO', 'dgs3mo')).toBe(4.05);
  });
  it('regresión: una página HTML con HTTP 200 NO se lee como dato (antes daba 400 por parseFloat("400px"))', () => {
    const html = '<!doctype html><html><head><style>.box{max-width:400px,400px}</style></head><body>Just a moment...,400px</body></html>';
    for (const [serie, clave] of [['VIXCLS', 'vix'], ['DGS10', 'dgs10'], ['DTWEXBGS', 'dollar_index']]) expect(parsearFredCsv(html, serie, clave)).toBeNull();
  });
  it('un CSV de OTRA serie no sirve (el encabezado debe nombrar la pedida)', () => {
    expect(parsearFredCsv(csv('DGS10', ['2026-10-20,4.3']), 'VIXCLS', 'vix')).toBeNull();
  });
  it('una sola línea que no es dato invalida todo el archivo', () => {
    expect(parsearFredCsv(csv('VIXCLS', ['2026-10-19,18.1', 'error 400,bad request']), 'VIXCLS', 'vix')).toBeNull();
  });
  it('un valor imposible para la serie (400 en el VIX, el dgs10 o el HY) se descarta aunque el CSV sea válido', () => {
    expect(parsearFredCsv(csv('VIXCLS', ['2026-10-20,400']), 'VIXCLS', 'vix')).toBeNull();
    expect(parsearFredCsv(csv('DGS10', ['2026-10-20,400.0']), 'DGS10', 'dgs10')).toBeNull();
    expect(parsearFredCsv(csv('BAMLH0A0HYM2', ['2026-10-20,400']), 'BAMLH0A0HYM2', 'hy_spread')).toBeNull();
  });
  it('vacío, solo encabezado o sin ningún dato numérico → null', () => {
    expect(parsearFredCsv('', 'VIXCLS', 'vix')).toBeNull();
    expect(parsearFredCsv('observation_date,VIXCLS', 'VIXCLS', 'vix')).toBeNull();
    expect(parsearFredCsv(csv('VIXCLS', ['2026-10-20,.']), 'VIXCLS', 'vix')).toBeNull();
  });
});

describe('resumenDiag', () => {
  it('resume en una línea: serie, estado, tipo de contenido, largo y el comienzo del cuerpo sin saltos de línea', () => {
    const d = resumenDiag('VIXCLS', { status: 200, contentType: 'text/html; charset=utf-8', texto: '<!DOCTYPE html>\n<html>\n  <head>  <title>Just a moment...</title>' });
    expect(d).toBe('VIXCLS http 200 text/html len 64: <!DOCTYPE html> <html> <head> <title>Just a moment...</title>');
    expect(d).not.toMatch(/\n/);
  });
  it('acota el cuerpo y tolera una respuesta sin content-type', () => {
    const d = resumenDiag('DGS10', { status: 403, contentType: '', texto: 'x'.repeat(1000) }, 20);
    expect(d).toBe(`DGS10 http 403 s/ct len 1000: ${'x'.repeat(20)}`);
  });
});

describe('procesarIngesta (series bajadas por el workflow de GitHub)', () => {
  const AHORA = '2026-10-22T01:00:00.000Z';
  const buenas = {
    DGS10: csv('DGS10', ['2026-10-20,4.31']), DGS3MO: csv('DGS3MO', ['2026-10-20,4.05']), BAMLH0A0HYM2: csv('BAMLH0A0HYM2', ['2026-10-20,2.9']),
    VIXCLS: csv('VIXCLS', ['2026-10-19,18.1', '2026-10-20,17.2']), DTWEXBGS: csv('DTWEXBGS', ['2026-10-16,121.3', '2026-10-17,.']),
  };
  it('guarda las cinco series con su clave y la hora de la ingesta', () => {
    const r = procesarIngesta({ series: buenas }, AHORA);
    expect(r.guardados).toEqual({ dgs10: 4.31, dgs3mo: 4.05, hy_spread: 2.9, vix: 17.2, dollar_index: 121.3 });
    expect(r.rechazados).toEqual([]);
    expect(r.rows).toHaveLength(5);
    expect(r.rows.every(x => x.updated_at === AHORA)).toBe(true);
  });
  it('rechaza lo que no pasa la validación y guarda el resto (HTML, valor imposible, serie equivocada)', () => {
    const r = procesarIngesta({ series: { ...buenas, VIXCLS: '<html>error 400</html>', DGS10: csv('DGS10', ['2026-10-20,400']), DGS3MO: buenas.DGS10 } }, AHORA);
    expect(r.rechazados.sort()).toEqual(['DGS10', 'DGS3MO', 'VIXCLS']);
    expect(r.guardados).toEqual({ hy_spread: 2.9, dollar_index: 121.3 });
  });
  it('una serie ausente o que no es texto se rechaza; las desconocidas se ignoran', () => {
    const r = procesarIngesta({ series: { VIXCLS: buenas.VIXCLS, DGS10: 123, MALA: 'x' } }, AHORA);
    expect(r.guardados).toEqual({ vix: 17.2 });
    expect(r.rechazados).toContain('DGS10');
    expect(r.rechazados).not.toContain('MALA');
  });
  it('un cuerpo que no tiene la forma esperada rechaza todo sin explotar', () => {
    for (const body of [null, undefined, {}, { series: null }, { series: [] }, 'x', 5]) {
      const r = procesarIngesta(body, AHORA);
      expect(r.rows).toEqual([]);
      expect(r.rechazados.sort()).toEqual(Object.keys(SERIES_FRED).sort());
    }
  });
  it('rechaza un CSV desmesurado (no es lo que se pidió)', () => {
    expect(procesarIngesta({ series: { VIXCLS: csv('VIXCLS', Array(30_000).fill('2026-10-20,17.2')) } }, AHORA).guardados).toEqual({});
  });
});
