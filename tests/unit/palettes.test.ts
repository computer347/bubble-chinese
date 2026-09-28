import { describe, it, expect } from 'vitest';
import { THEMES, STYLES } from '../../src/theme/themes';

/** Relative luminance of a #rrggbb colour. */
function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

describe('palettes', () => {
  it('every ground and its text stand well apart, dark on light or light on dark', () => {
    for (const style of STYLES) for (const mode of ['light', 'dark'] as const) {
      const pals = THEMES[style].palettes[mode];
      expect(pals.length).toBeGreaterThan(1);                     // pops move to another
      for (const p of pals) {
        expect(ratio(p.bg, p.ui), `${style} ${mode} ${p.bg}`).toBeGreaterThan(9);
        if (mode === 'dark') expect(lum(p.bg)).toBeLessThan(0.05); else expect(lum(p.bg)).toBeGreaterThan(0.55);
      }
    }
  });
});
