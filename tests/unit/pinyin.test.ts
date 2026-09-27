import { describe, it, expect } from 'vitest';
import { QUIZ_WORDS, WORDS } from '../../src/content/words';
import { normalizePinyin, checkDictation } from '../../src/game/pinyin';

const byH = (h: string) => WORDS.find(w => w.h === h)!;

describe('normalizePinyin', () => {
  it('turns tone numbers into marks in the right place', () => {
    expect(normalizePinyin('ni3 hao3')).toBe('nǐhǎo');
    expect(normalizePinyin('Ni3Hao3')).toBe('nǐhǎo');
    expect(normalizePinyin('xie4xie5')).toBe('xièxie');
    expect(normalizePinyin('dou1')).toBe('dōu');
    expect(normalizePinyin('gui4')).toBe('guì');
    expect(normalizePinyin('liu2')).toBe('liú');
    expect(normalizePinyin('lv4 se4')).toBe('lǜsè');
    expect(normalizePinyin('nu:3')).toBe('nǚ');
    expect(normalizePinyin('peng2you5')).toBe('péngyou');
  });

  it('leaves marked pinyin alone apart from spaces and case', () => {
    expect(normalizePinyin('Nǐ hǎo')).toBe('nǐhǎo');
    expect(normalizePinyin("xī'ān")).toBe('xīān');
  });
});

describe('checkDictation', () => {
  it('accepts numbers, marks, and the spoken third-tone change', () => {
    const w = byH('你好');
    expect(checkDictation('ni3 hao3', w)).toBe('right');
    expect(checkDictation('nǐhǎo', w)).toBe('right');
    expect(checkDictation('ni2 hao3', w)).toBe('right');      // what you actually hear
    expect(checkDictation('ni4 hao3', w)).toBe('tones');
    expect(checkDictation('ni hao', w)).toBe('tones');
    expect(checkDictation('wo3', w)).toBe('wrong');
    expect(checkDictation('', w)).toBe('wrong');
  });

  it('accepts every HSK 1–2 word typed with tone numbers', () => {
    for (const w of QUIZ_WORDS) {
      expect(checkDictation(w.p, w), w.id).toBe('right');
      expect(checkDictation(w.pn, w), w.id).toBe('right');
    }
  });
});
