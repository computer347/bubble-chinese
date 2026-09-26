import { describe, it, expect } from 'vitest';
import { QUIZ_WORDS, WORDS, overlaps } from '../../src/content/words';
import { makeQuestions, retone, applyForgot, TONES } from '../../src/game/questions';
import { mulberry32 } from '../../src/game/random';

const baseOf = (c: string) => Object.entries(TONES).find(([, m]) => m.includes(c))?.[0];
const byGloss = new Map(WORDS.map(w => [w.e, w]));
const byHanzi = new Map(WORDS.map(w => [w.h, w]));

describe('retone', () => {
  it('changes exactly one tone mark and keeps the vowel', () => {
    const rng = mulberry32(1);
    for (const w of WORDS) {
      const r = retone(w.p, rng);
      if (!r) continue;
      expect(r).not.toBe(w.p);
      const a = [...w.p], b = [...r];
      const diffs = a.map((c, i) => [c, b[i]]).filter(([x, y]) => x !== y);
      expect(diffs.length).toBe(1);
      expect(baseOf(diffs[0][0])).toBe(baseOf(diffs[0][1]));
    }
  });
  it('returns null without tone marks', () => { expect(retone('ma')).toBeNull(); });
});

describe('makeQuestions', () => {
  for (const level of [1, 2]) {
    const bank = QUIZ_WORDS.filter(w => w.level <= level);
    it.each(bank.map(w => [w.id, w]))(`HSK ${level}: %s gets three unambiguous layers`, (_id, w) => {
      const qs = makeQuestions(w, bank, mulberry32(42));
      expect(qs.map(q => q.type)).toEqual([0, 1, 2]);
      for (const q of qs) {
        expect(q.choices).toHaveLength(4);
        expect(new Set(q.choices).size).toBe(4);
        expect(q.choices).toContain(q.answer);
      }
      // no distractor meaning overlaps the answer (e.g. "time" vs "time; moment")
      for (const c of qs[0].choices.filter(c => c !== w.e)) expect(overlaps(byGloss.get(c)!, w)).toBe(false);
      // no distractor characters mean the same thing as the answer
      for (const c of qs[2].choices.filter(c => c !== w.h)) expect(overlaps(byHanzi.get(c)!, w)).toBe(false);
      // options look alike: same length whenever the bank has enough such words
      const len = [...w.h].length;
      const sameAvailable = bank.filter(x => x.h !== w.h && [...x.h].length === len && !overlaps(x, w)).length;
      const sameShown = qs[2].choices.filter(c => c !== w.h && [...c].length === len).length;
      expect(sameShown).toBe(Math.min(3, sameAvailable));
      // distractors stay within the learner's level
      for (const c of qs[2].choices) expect(byHanzi.get(c)!.level).toBeLessThanOrEqual(level);
    });
  }

  it('is deterministic for a given seed', () => {
    const w = QUIZ_WORDS[10];
    expect(makeQuestions(w, QUIZ_WORDS, mulberry32(7))).toEqual(makeQuestions(w, QUIZ_WORDS, mulberry32(7)));
  });
});

describe('applyForgot', () => {
  const w = QUIZ_WORDS[3];
  const rng = mulberry32(3);
  it('adds one layer: the revealed question now, and a retest just before the core', () => {
    const out = applyForgot(makeQuestions(w, QUIZ_WORDS, rng), w, QUIZ_WORDS, rng);
    expect(out.map(q => [q.type, !!q.revealed, !!q.retest])).toEqual([[0, true, false], [1, false, false], [0, false, true], [2, false, false]]);
  });
  it('on the core, the retest becomes the new core', () => {
    const out = applyForgot(makeQuestions(w, QUIZ_WORDS, rng).slice(2), w, QUIZ_WORDS, rng);
    expect(out.map(q => [q.type, !!q.revealed, !!q.retest])).toEqual([[2, true, false], [2, false, true]]);
  });
});
