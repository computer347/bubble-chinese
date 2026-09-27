import { describe, it, expect } from 'vitest';
import { QUIZ_WORDS, WORDS, overlaps, type Word } from '../../src/content/words';
import {
  markedTones, toneVariants, isSandhiOf, soundsSame, soundDistance, soundAlike,
  makeListenQuestions, toneAccuracy, weakestTone
} from '../../src/game/listening';
import { TONES } from '../../src/game/questions';
import { Rating } from '../../src/game/memory';
import type { ReviewEntry } from '../../src/game/progress';
import { mulberry32 } from '../../src/game/random';

const byH = (h: string) => WORDS.find(w => w.h === h)!;
const byId = new Map(WORDS.map(w => [w.id, w]));
const byGloss = new Map(WORDS.map(w => [w.e, w]));
const byHanzi = new Map(WORDS.map(w => [w.h, w]));
/** Pinyin with the tone marks taken off. */
const toneless = (p: string) => [...p].map(c => Object.entries(TONES).find(([, m]) => m.includes(c))?.[0] ?? c).join('');

describe('tones', () => {
  it('reads the marked tones in order', () => {
    expect(markedTones('nǐhǎo')).toEqual([3, 3]);
    expect(markedTones('bàba')).toEqual([4]);
    expect(markedTones('lǜsè')).toEqual([4, 4]);
  });

  it('makes every one-tone change', () => {
    expect(toneVariants('hǎo').sort()).toEqual(['hāo', 'háo', 'hào'].sort());
    expect(toneVariants('nǐhǎo')).toHaveLength(6);
    expect(toneVariants('ma')).toEqual([]);
  });

  it('knows the third-tone change: nǐhǎo is said níhǎo', () => {
    expect(isSandhiOf('nǐhǎo', 'níhǎo')).toBe(true);
    expect(isSandhiOf('nǐhǎo', 'nǐháo')).toBe(false);
    expect(isSandhiOf('hěn', 'hén')).toBe(false);
  });
});

describe('sounding alike', () => {
  it('tells identical sounds, minimal pairs and near pairs apart', () => {
    expect(soundsSame(byH('他'), byH('她'))).toBe(true);
    expect(soundDistance(byH('买'), byH('卖'))).toBe(0);      // mǎi / mài
    expect(soundDistance(byH('早饭'), byH('晚饭'))).toBe(1);    // zǎofàn / wǎnfàn
    expect(soundDistance(byH('妈妈'), byH('爸爸'))).toBe(2);
    expect(soundDistance(byH('猫'), byH('妈妈'))).toBeGreaterThan(2);
  });

  it('offers minimal pairs first, and never a word that sounds the same', () => {
    const bank = QUIZ_WORDS.filter(w => w.level <= 2);
    const picks = soundAlike(byH('买'), bank, 3, mulberry32(1));
    expect(picks).toContain('卖');
    for (const w of bank) for (const h of soundAlike(w, bank, 3, mulberry32(2))) expect(soundsSame(byHanzi.get(h)!, w)).toBe(false);
  });
});

describe('makeListenQuestions', () => {
  for (const level of [1, 2]) {
    const bank = QUIZ_WORDS.filter(w => w.level <= level);
    it.each(bank.map(w => [w.id, w] as [string, Word]))(`HSK ${level}: %s can be answered by ear alone`, (_id, w) => {
      const qs = makeListenQuestions(w, bank, mulberry32(9));
      expect(qs.map(q => q.type)).toEqual([3, 4, 5]);
      for (const q of qs) {
        expect(q.audio).toBe(true);
        expect(q.choices).toHaveLength(4);
        expect(new Set(q.choices).size).toBe(4);
        expect(q.choices[0]).toBe(q.answer);
      }
      const [tone, meaning, chars] = qs;
      // tone options: the same sounds in other tones, and never how the word is actually spoken
      if (markedTones(w.p).length) {
        for (const c of tone.choices) expect(toneless(c)).toBe(toneless(w.p));
      }
      for (const c of tone.choices.slice(1)) expect(isSandhiOf(w.p, c)).toBe(false);
      // meanings: no near-synonyms, and no word that sounds identical (tā: he / she / it)
      for (const c of meaning.choices.slice(1)) {
        const x = byGloss.get(c)!;
        expect(overlaps(x, w)).toBe(false);
        expect(soundsSame(x, w)).toBe(false);
      }
      // characters: no homophones, and within the learner's level
      for (const c of chars.choices.slice(1)) {
        const x = byHanzi.get(c)!;
        expect(soundsSame(x, w)).toBe(false);
        expect(x.level).toBeLessThanOrEqual(level);
      }
    });
  }
});

describe('tone accuracy', () => {
  const e = (h: string, g: Rating): ReviewEntry => ({ t: 0, s: 'tone', id: byH(h).id, g: g as ReviewEntry['g'] });

  it('counts each tone of a word once per tone layer', () => {
    const stats = toneAccuracy([e('好', Rating.Good), e('你好', Rating.Again), e('妈妈', Rating.Good), { ...e('好', Rating.Again), s: 'words' }], byId);
    expect(stats[3]).toEqual({ right: 1, total: 2 });
    expect(stats[1]).toEqual({ right: 1, total: 1 });
    expect(stats[2].total).toBe(0);
  });

  it('names the weakest tone once there are enough answers', () => {
    const log = [
      ...Array.from({ length: 5 }, () => e('好', Rating.Again)),    // 3rd tone: 0 of 5
      ...Array.from({ length: 5 }, () => e('八', Rating.Good))      // 1st tone: 5 of 5
    ];
    expect(weakestTone(toneAccuracy(log, byId))).toBe(3);
    expect(weakestTone(toneAccuracy(log.slice(0, 3), byId))).toBeNull();
  });
});

describe('dictation', () => {
  it('replaces the characters core with typing the pinyin', () => {
    const w = byH('你好');
    const qs = makeListenQuestions(w, QUIZ_WORDS, mulberry32(1), true);
    expect(qs.map(q => q.type)).toEqual([3, 4, 6]);
    expect(qs[2]).toMatchObject({ typed: true, answer: 'nǐhǎo', choices: [], audio: true });
  });
});
