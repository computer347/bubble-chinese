import type { Word } from '../content/words';
import { Rating } from './memory';
import type { ReviewEntry } from './progress';
import { TONES, distinct, type Question } from './questions';
import { type Rng, defaultRng, shuffle } from './random';

/** The tones (1–4) marked in a pinyin string, in order. Neutral-tone syllables carry no mark and are skipped. */
export function markedTones(p: string): number[] {
  const out: number[] = [];
  for (const c of p) for (const marks of Object.values(TONES)) { const k = marks.indexOf(c); if (k >= 0) out.push(k + 1); }
  return out;
}

/** Every pinyin that differs from `p` in exactly one tone mark ("hǎo" → "hāo", "háo", "hào"). */
export function toneVariants(p: string): string[] {
  const chars = [...p], out = new Set<string>();
  chars.forEach((c, i) => {
    for (const marks of Object.values(TONES)) {
      const k = marks.indexOf(c);
      if (k < 0) continue;
      for (let t = 0; t < 4; t++) if (t !== k) { const v = chars.slice(); v[i] = marks[t]; out.add(v.join('')); }
    }
  });
  out.delete(p);
  return [...out];
}

/**
 * Whether variant `v` is how `p` is actually spoken: a third tone before another third tone is said
 * as a second tone (你好 nǐhǎo sounds like níhǎo), so offering it as a wrong answer would be a trap.
 */
export function isSandhiOf(p: string, v: string): boolean {
  const a = markedTones(p), b = markedTones(v);
  if (a.length !== b.length) return false;
  const diff = a.map((_, i) => i).filter(i => a[i] !== b[i]);
  return diff.length === 1 && a[diff[0]] === 3 && b[diff[0]] === 2 && a[diff[0] + 1] === 3;
}

/** The syllables of a word without tones: "ba4 ba5" → ["ba", "ba"]. */
const syllables = (w: Word): string[] => w.pn.toLowerCase().split(/\s+/).map(s => s.replace(/\d$/, ''));

/** Two words that sound exactly the same (他, 她 and 它 are all tā) can't be told apart by ear. */
export const soundsSame = (a: Word, b: Word): boolean => a.p.replace(/\s/g, '') === b.p.replace(/\s/g, '');

/**
 * How close two words sound: 0 the same syllables in other tones (a minimal pair by tone),
 * 1 one syllable different, 2 the same number of syllables, then further by length.
 */
export function soundDistance(a: Word, b: Word): number {
  const x = syllables(a), y = syllables(b);
  if (x.length !== y.length) return 3 + Math.abs(x.length - y.length);
  const diff = x.filter((s, i) => s !== y[i]).length;
  return diff === 0 ? 0 : diff === 1 ? 1 : 2;
}

/**
 * n characters that sound like the word: minimal pairs first, then near pairs.
 * Never a word that sounds identical, which no one could tell apart by ear.
 */
export function soundAlike(w: Word, bank: readonly Word[], n: number, rng: Rng = defaultRng): string[] {
  const groups = new Map<number, Word[]>();
  for (const x of bank) {
    if (x.h === w.h || soundsSame(x, w)) continue;
    const d = soundDistance(w, x);
    groups.set(d, [...(groups.get(d) ?? []), x]);
  }
  const ordered = [...groups.keys()].sort((a, b) => a - b).flatMap(d => shuffle(groups.get(d)!, rng));
  return distinct(w, ordered, n, 'h', rng, [], true);
}

/**
 * The three layers of a Listen bubble, outermost first: tones, meaning, characters. All are answered by ear.
 * With `dictation` the core asks you to type the pinyin instead of picking the characters.
 */
export function makeListenQuestions(w: Word, bank: readonly Word[], rng: Rng = defaultRng, dictation = false): Question[] {
  const others = bank.filter(x => x.id !== w.id && !soundsSame(x, w));
  const tones = shuffle(toneVariants(w.p).filter(v => !isSandhiOf(w.p, v)), rng).slice(0, 3);
  if (tones.length < 3) tones.push(...distinct(w, others, 3 - tones.length, 'p', rng, tones));
  // nothing is written behind the bubble: the word is only heard
  const base = { prompt: '', zh: false, audio: true } as const;
  return [
    { ...base, type: 3, ask: 'Which tones did you hear?', answer: w.p, choices: [w.p, ...tones], chipZh: false },
    { ...base, type: 4, ask: 'What did you hear?', answer: w.e, choices: [w.e, ...distinct(w, others, 3, 'e', rng)], chipZh: false },
    dictation
      ? { ...base, type: 6, ask: 'Type what you hear.', answer: w.p, choices: [], chipZh: false, typed: true }
      : { ...base, type: 5, ask: [...w.h].length > 1 ? 'Which characters?' : 'Which character?', answer: w.h, choices: [w.h, ...soundAlike(w, others, 3, rng)], chipZh: true }
  ];
}

export type ToneStats = Record<1 | 2 | 3 | 4, { right: number; total: number }>;

/**
 * How often each tone was heard right, from the tone layers in the review log. A layer counts
 * for every tone in its word, so a miss on "hǎo chī" counts against both tone 3 and tone 1.
 */
export function toneAccuracy(log: readonly ReviewEntry[], byId: ReadonlyMap<string, Word>): ToneStats {
  const stats: ToneStats = { 1: { right: 0, total: 0 }, 2: { right: 0, total: 0 }, 3: { right: 0, total: 0 }, 4: { right: 0, total: 0 } };
  for (const e of log) {
    if (e.s !== 'tone') continue;
    const w = byId.get(e.id);
    if (!w) continue;
    for (const t of new Set(markedTones(w.p)) as Set<1 | 2 | 3 | 4>) {
      stats[t].total++;
      if (e.g >= Rating.Good) stats[t].right++;
    }
  }
  return stats;
}

/** The tone heard right least often, once each counted tone has at least `min` answers; null before that. */
export function weakestTone(stats: ToneStats, min = 5): 1 | 2 | 3 | 4 | null {
  let worst: 1 | 2 | 3 | 4 | null = null, rate = Infinity;
  for (const t of [1, 2, 3, 4] as const) {
    const s = stats[t];
    if (s.total < min) continue;
    const r = s.right / s.total;
    if (r < rate) { rate = r; worst = t; }
  }
  return worst;
}
