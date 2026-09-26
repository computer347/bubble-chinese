import { describe, it, expect } from 'vitest';
import { WORDS, QUIZ_WORDS } from '../../src/content/words';
import { FORTUNES } from '../../src/content/fortunes';
import { PALETTES, PHYS } from '../../src/content/palettes';
import { toneMarkCount } from '../../src/game/questions';

const HANZI = /^[\u3400-\u9fff]+$/u;
const PINYIN = /^[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü’' ]+$/u;
const dup = <T,>(xs: T[]) => xs.filter((x, i) => xs.indexOf(x) !== i);

describe('word bank', () => {
  it('ids are unique and stable (characters|pinyin)', () => {
    expect(dup(WORDS.map(w => w.id))).toEqual([]);
    for (const w of WORDS) expect(w.id).toBe(`${w.h}|${w.p}`);
  });

  it('quiz words have unique characters, since the characters are the prompt', () => {
    expect(dup(QUIZ_WORDS.map(w => w.h))).toEqual([]);
  });

  it.each(WORDS.map(w => [w.id, w]))('%s is well formed', (_id, w) => {
    expect(w.h).toMatch(HANZI);
    expect(w.p).toMatch(PINYIN);
    expect(w.e.trim()).toBe(w.e);
    expect(w.e.length).toBeGreaterThan(0);
    expect(w.e.length).toBeLessThanOrEqual(34);          // fits an answer chip
    expect(w.pos.length).toBeGreaterThanOrEqual(0);
    expect(toneMarkCount(w.p)).toBeLessThanOrEqual([...w.h].length);
    if (w.quiz !== false) expect(toneMarkCount(w.p)).toBeGreaterThanOrEqual(1);
    for (const m of w.mw ?? []) expect(m).toMatch(HANZI);
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
