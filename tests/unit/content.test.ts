import { describe, it, expect } from 'vitest';
import { WORDS } from '../../src/content/words';
import { FORTUNES } from '../../src/content/fortunes';
import { PALETTES, PHYS } from '../../src/content/palettes';
import { toneMarkCount } from '../../src/game/questions';

const HANZI = /^[\u3400-\u9fff]+$/u;
// letters allowed in pinyin: a–z, tone-marked vowels, ü, apostrophe (’ or '), spaces
const PINYIN = /^[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü’' ]+$/u;

describe('word bank', () => {
  it('has a healthy number of words', () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(150);
  });

  it('has no duplicate characters or meanings (duplicates would make two answers correct)', () => {
    const dup = <T,>(xs: T[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
    expect(dup(WORDS.map(w => w.h))).toEqual([]);
    expect(dup(WORDS.map(w => w.e))).toEqual([]);
  });

  it.each(WORDS.map(w => [w.h, w]))('%s is well formed', (_h, w) => {
    expect(w.h).toMatch(HANZI);
    expect(w.p).toMatch(PINYIN);
    expect(w.e.trim()).toBe(w.e);
    expect(w.e.length).toBeGreaterThan(0);
    // every character has at most one toned syllable, and at least one syllable carries a tone
    const marks = toneMarkCount(w.p);
    expect(marks).toBeGreaterThanOrEqual(1);
    expect(marks).toBeLessThanOrEqual([...w.h].length);
  });
});

describe('fortunes', () => {
  it('are unique, trimmed and slip-sized', () => {
    expect(new Set(FORTUNES).size).toBe(FORTUNES.length);
    for (const f of FORTUNES) {
      expect(f.trim()).toBe(f);
      expect(f.length).toBeLessThanOrEqual(90);
    }
    expect(FORTUNES.length).toBeGreaterThanOrEqual(100);
  });
});

describe('palettes', () => {
  it('each palette has a physics preset and valid colours', () => {
    for (const p of PALETTES) {
      expect(PHYS[p.kind]).toBeDefined();
      expect(p.bg).toMatch(/^#[0-9A-F]{6}$/i);
      expect(p.ui).toMatch(/^#[0-9A-F]{6}$/i);
      expect(p.shadow).toMatch(/^rgba\(/);
    }
  });
});
