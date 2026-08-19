import { describe, it, expect } from 'vitest';
import { bonosACSV, nombreArchivoCsv } from './exportRentaFija';
import type { BonoReferenciaCalc, BonoReferencia } from './rentaFija';

const ref: BonoReferencia = {
  ticker: 'MIC3D', tipo: 'on', instrumento: 'NOTE', moneda: 'USD',
  nombre: 'Obligación negociable USD (MIC3D)', emisor: 'Mirgor S.A.C.I.F.I.A.',
  emision: '2024-11-11', vencimiento: '2026-11-11', amortizable: false, valor_residual: 1,
  cronograma: [], fuente: 'IOL', actualizado_en: '2026-08-13T00:00:00Z',
  calificadora: "Moody's Local", calificacion: 'A+.ar',
  vol_media_usd: 36812.56, vol_mediana_usd: 14739.09, vol_minimo_usd: 677.03, vol_dias_con_datos: 22,
};

const calc: BonoReferenciaCalc = {
  ref, px: 1.003, paridad: 100.3, tir: 0.1456,
  duracion: { macaulay: 0.24, modified: 0.21 }, rendCorriente: 0.0698,
  grado: 'grado_inversion', escalaGrado: 'local',
  volumen: { mediaUsd: 36812.56, medianaUsd: 14739.09, minimoUsd: 677.03, diasConDatos: 22 },
};

describe('bonosACSV', () => {
  it('arranca con BOM UTF-8 (Excel necesita esto para no romper tildes/ñ)', () => {
    const csv = bonosACSV([calc]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it('usa ; como separador (evita el choque con la coma decimal de Excel en español)', () => {
    const csv = bonosACSV([calc]);
    const header = csv.slice(1).split('\r\n')[0];
    expect(header.split(';')[0]).toBe('Ticker');
    expect(header).toContain('TIR (%)');
  });

  it('exporta porcentajes YA multiplicados por 100, no la fracción cruda', () => {
    const csv = bonosACSV([calc]);
    const fila = csv.slice(1).split('\r\n')[1];
    const cols = fila.split(';');
    // Paridad, TIR, rendCorriente van multiplicados por 100
    expect(cols).toContain('14.56'); // TIR: 0.1456 * 100
    expect(cols).toContain('100.30'); // Paridad
  });

  it('escapa campos con el separador o comillas envolviéndolos entre comillas (RFC 4180)', () => {
    const conComa: BonoReferenciaCalc = {
      ...calc,
      ref: { ...ref, emisor: 'Emisor; con separador', nombre: 'Bono "raro"' },
    };
    const csv = bonosACSV([conComa]);
    const fila = csv.slice(1).split('\r\n')[1];
    expect(fila).toContain('"Emisor; con separador"');
    expect(fila).toContain('"Bono ""raro"""');
  });

  it('campos null/faltantes quedan vacíos, no "null" ni "undefined" como texto', () => {
    const sinDatos: BonoReferenciaCalc = {
      ref: { ...ref, emisor: null, calificadora: null, calificacion: null },
      px: null, paridad: null, tir: null, duracion: null, rendCorriente: null,
      grado: null, escalaGrado: null, volumen: null,
    };
    const csv = bonosACSV([sinDatos]);
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
  });

  it('catálogo vacío: solo el header, no rompe', () => {
    const csv = bonosACSV([]);
    expect(csv.slice(1).split('\r\n')).toHaveLength(1);
  });

  it('el nombre de archivo incluye la fecha para no pisar descargas previas', () => {
    expect(nombreArchivoCsv('2026-08-19')).toBe('renta-fija-2026-08-19.csv');
  });
});
