import type { Word } from '../content/words';
import { TONES } from './questions';
import { isSandhiOf } from './listening';

/** Puts a tone mark on a bare syllable ("hao", 3 → "hǎo"): on a or e, on the o of ou, otherwise on the last vowel. */
function mark(syl: string, tone: number): string {
  if (tone < 1 || tone > 4) return syl;
  const at = /a/.test(syl) ? syl.indexOf('a') : /e/.test(syl) ? syl.indexOf('e') : /ou/.test(syl) ? syl.indexOf('o') : Math.max(...[...'iouü'].map(v => syl.lastIndexOf(v)));
  if (at < 0) return syl;
  return syl.slice(0, at) + TONES[syl[at]][tone - 1] + syl.slice(at + 1);
}

/**
 * Typed pinyin in one form: lower case, no spaces or apostrophes, ü for v and u:, and tone
 * numbers turned into marks ("Ni3 hao3" → "nǐhǎo"; 5 or 0 is the neutral tone).
 */
export function normalizePinyin(s: string): string {
  return s.toLowerCase().normalize('NFC')
    .replace(/u:|v/g, 'ü')
    .replace(/([a-zü]+?)([0-5])/g, (_, syl: string, t: string) => {
      // a run like "nihao3" holds several syllables; the number belongs to the last one
      const m = /^(.*?)((?:[bcdfghjklmnpqrstwxyz]|zh|ch|sh)?[aeiouü]+(?:ng|n|r)?)$/.exec(syl);
      return m ? m[1] + mark(m[2], +t) : mark(syl, +t);
    })
    .replace(/[\s'’\-·.]/g, '');
}

const untoned = (s: string): string => [...s].map(c => Object.entries(TONES).find(([, m]) => m.includes(c))?.[0] ?? c).join('');

/**
 * Checks a dictation answer. right: the pinyin as printed, or as it is spoken (nǐhǎo said níhǎo);
 * tones: the right sounds with a tone wrong; wrong: anything else.
 */
export function checkDictation(input: string, w: Word): 'right' | 'tones' | 'wrong' {
  const got = normalizePinyin(input), want = normalizePinyin(w.p);
  if (!got) return 'wrong';
  if (got === want || isSandhiOf(want, got)) return 'right';
  return untoned(got) === untoned(want) ? 'tones' : 'wrong';
}
