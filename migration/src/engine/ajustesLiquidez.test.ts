import { describe, it, expect } from 'vitest';
import { ajustesSinFlujo } from './ajustesLiquidez';

const aj = (cantidad: number, fecha = '2026-10-28') => ({ ticker: 'LIQUIDEZ', tipo: 'ajuste', cantidad, fecha });

describe('ajustesSinFlujo', () => {
  it('baja de Liquidez sin retiro → falta un retiro (el caso real: −669 el 28/10)', () => {
    expect(ajustesSinFlujo([aj(-669)], [])).toEqual([{ fecha: '2026-10-28', monto: -669, falta: 'retiro' }]);
  });
  it('con el retiro del mismo monto queda conciliado', () => {
    expect(ajustesSinFlujo([aj(-669)], [{ fecha: '2026-10-28', monto: 669, tipo: 'retiro' }])).toEqual([]);
  });
  it('suba de Liquidez sin aporte → falta un aporte; un retiro NO la concilia', () => {
    expect(ajustesSinFlujo([aj(100)], [{ fecha: '2026-10-28', monto: 100, tipo: 'retiro' }])).toEqual([{ fecha: '2026-10-28', monto: 100, falta: 'aporte' }]);
    expect(ajustesSinFlujo([aj(100)], [{ fecha: '2026-10-28', monto: 100, tipo: 'recurrente' }])).toEqual([]);
  });
  it('tolera 3 días de diferencia pero no 10, y montos que no coinciden no concilian', () => {
    expect(ajustesSinFlujo([aj(-50)], [{ fecha: '2026-10-30', monto: 50, tipo: 'retiro' }])).toEqual([]);
    expect(ajustesSinFlujo([aj(-50)], [{ fecha: '2026-11-10', monto: 50, tipo: 'retiro' }])).toHaveLength(1);
    expect(ajustesSinFlujo([aj(-50)], [{ fecha: '2026-10-28', monto: 80, tipo: 'retiro' }])).toHaveLength(1);
  });
  it('un mismo retiro no concilia dos ajustes', () => {
    expect(ajustesSinFlujo([aj(-50), aj(-50)], [{ fecha: '2026-10-28', monto: 50, tipo: 'retiro' }])).toHaveLength(1);
  });
  it('ignora movimientos que no son ajustes de LIQUIDEZ', () => {
    expect(ajustesSinFlujo([{ ticker: 'GOOGL', tipo: 'ajuste', cantidad: -5, fecha: '2026-10-28' }, { ticker: 'LIQUIDEZ', tipo: 'venta', cantidad: 5, fecha: '2026-10-28' }], [])).toEqual([]);
  });
});
