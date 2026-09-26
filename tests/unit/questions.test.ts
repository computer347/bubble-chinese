import { describe, it, expect } from 'vitest';
import { WORDS } from '../../src/content/words';
import { makeQuestions, retone, applyForgot, TONES } from '../../src/game/questions';
import { mulberry32 } from '../../src/game/random';

const baseOf = (c: string) => Object.entries(TONES).find(([, m]) => m.includes(c))?.[0];

describe('retone', () => {
  it('changes exactly one tone mark and keeps the vowel', () => {
    const rng = mulberry32(1);
    for (const w of WORDS) {
      const r = retone(w.p, rng);
      if (!r) continue;
      expect(r).not.toBe(w.p);
      const a = [...w.p], b = [...r];
      expect(b.length).toBe(a.length);
      const diffs = a.map((c, i) => [c, b[i]]).filter(([x, y]) => x !== y);
      expect(diffs.length).toBe(1);
      expect(baseOf(diffs[0][0])).toBe(baseOf(diffs[0][1]));
    }
  });

  it('returns null without tone marks', () => {
    expect(retone('ma')).toBeNull();
  });
});

describe('makeQuestions', () => {
  it.each(WORDS.map(w => [w.h, w]))('%s gets three layers with four distinct options', (_h, w) => {
    const qs = makeQuestions(w, WORDS, mulberry32(42));
    expect(qs.map(q => q.type)).toEqual([0, 1, 2]);
    for (const q of qs) {
      expect(q.choices).toHaveLength(4);
      expect(new Set(q.choices).size).toBe(4);
      expect(q.choices).toContain(q.answer);
    }
    expect(qs[0].answer).toBe(w.e);
    expect(qs[1].answer).toBe(w.p);
    expect(qs[2].answer).toBe(w.h);
    // character options have the same length as the answer when the bank allows it
    const len = [...w.h].length;
    expect(qs[2].choices.every(c => [...c].length === len)).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const w = WORDS[10];
    expect(makeQuestions(w, WORDS, mulberry32(7))).toEqual(makeQuestions(w, WORDS, mulberry32(7)));
  });
});

describe('applyForgot', () => {
  const w = WORDS[3];
  const rng = mulberry32(3);
  it('adds one layer: the revealed question now, and a retest just before the core', () => {
    const q = makeQuestions(w, WORDS, rng);
    const out = applyForgot(q, w, WORDS, rng);
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ type: 0, revealed: true });
    expect(out[1].type).toBe(1);
    expect(out[2]).toMatchObject({ type: 0, retest: true });
    expect(out[3].type).toBe(2);
  });
  it('on the core, the retest becomes the new core', () => {
    const core = makeQuestions(w, WORDS, rng).slice(2);
    const out = applyForgot(core, w, WORDS, rng);
    expect(out.map(q => [q.type, !!q.revealed, !!q.retest])).toEqual([[2, true, false], [2, false, true]]);
  });
});
