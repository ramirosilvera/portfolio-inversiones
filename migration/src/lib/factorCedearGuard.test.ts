// Guardia: toda llamada de PRODUCCIÓN que valúa un CEDEAR debe pasar el factor CCL÷MEP. Los parámetros tienen valor por omisión (1) para no
// romper tests ni llamadores puros, así que olvidarlo compila igual y valuaría al CCL (≈ 5,5 % bajo) sin ningún aviso — la revisión independiente del
// 2026-11-12 lo marcó como riesgo latente. Este test lee el código y falla si una llamada de producción omite el argumento.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(__dirname, '..', '..');
const LLAMADAS: Record<string, number> = {   // nombre → cantidad mínima de argumentos
  unitValueUSD: 3, unitUSD: 3, marketValueUSD: 3, calcularCedear: 3, valuarPortfolio: 5, armarSnapshots: 6,
};

function archivos(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivos(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

// Argumentos de nivel superior de la llamada que abre en `i` (posición del '(').
function contarArgs(src: string, i: number): number {
  let prof = 0, args = 0, vacio = true, str: string | null = null;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (str) { if (c === '\\') k++; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; vacio = false; continue; }
    if (c === '(' || c === '[' || c === '{') { prof++; if (prof > 1) vacio = false; continue; }
    if (c === ')' || c === ']' || c === '}') { prof--; if (prof === 0) return vacio ? 0 : args + 1; continue; }
    if (prof === 1 && c === ',') { args++; continue; }
    if (!/\s/.test(c)) vacio = false;
  }
  return 0;
}

describe('guardia: las llamadas de producción que valúan CEDEARs pasan el factor', () => {
  const files = [...archivos(join(RAIZ, 'src')), ...archivos(join(RAIZ, 'functions'))];
  it('hay archivos para revisar', () => { expect(files.length).toBeGreaterThan(50); });
  for (const [nombre, min] of Object.entries(LLAMADAS)) {
    it(`${nombre}(…) lleva al menos ${min} argumentos en todo el código`, () => {
      const faltan: string[] = [];
      const re = new RegExp(`(?<![\\w.])${nombre}\\s*\\(`, 'g');
      for (const f of files) {
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(re)) {
          const antes = src.slice(Math.max(0, m.index! - 20), m.index!);
          if (/function\s+$/.test(antes) || /import|export\s*\{/.test(src.slice(src.lastIndexOf('\n', m.index!) + 1, m.index!))) continue;   // definición
          if (contarArgs(src, m.index! + m[0].length - 1) < min) faltan.push(`${f.replace(RAIZ + '/', '')}:${src.slice(0, m.index!).split('\n').length}`);
        }
      }
      expect(faltan).toEqual([]);
    });
  }
});
