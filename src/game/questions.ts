import { type Word, overlaps } from '../content/words';
import { type Rng, defaultRng, shuffle } from './random';

/** 0: characters → meaning, 1: characters → pinyin, 2: meaning → characters. */
export type QuestionType = 0 | 1 | 2;

export interface Question {
  type: QuestionType;
  /** What is written big behind the bubble. */
  prompt: string;
  /** Whether the prompt is Chinese (picks the font). */
  zh: boolean;
  ask: string;
  answer: string;
  /** Four options, the answer first. Shuffled onto the edges when shown. */
  choices: string[];
  /** Whether the answer chips are Chinese. */
  chipZh: boolean;
  /** Shown after "I forgot": the answer is highlighted. */
  revealed?: boolean;
  /** The repeat that comes back before the core after "I forgot". */
  retest?: boolean;
}

export const TONES: Record<string, string> = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', 'ü': 'ǖǘǚǜ' };
const TONED = Object.values(TONES).join('');

/** Counts syllables with a tone mark. Neutral-tone syllables have none. */
export const toneMarkCount = (p: string): number => [...p].filter(c => TONED.includes(c)).length;

/**
 * Returns the pinyin with one toned vowel moved to a different tone, e.g. "hǎo" → "hào".
 * Returns null when the pinyin has no tone marks.
 */
export function retone(p: string, rng: Rng = defaultRng): string | null {
  const chars = [...p];
  const spots: Array<[number, string, number]> = [];
  chars.forEach((c, i) => {
    for (const [base, marks] of Object.entries(TONES)) {
      const k = marks.indexOf(c);
      if (k >= 0) spots.push([i, base, k]);
    }
  });
  if (!spots.length) return null;
  const [i, base, k] = spots[Math.floor(rng() * spots.length)];
  let nk = k;
  while (nk === k) nk = Math.floor(rng() * 4);
  chars[i] = TONES[base][nk];
  return chars.join('');
}

/**
 * Picks n distractor values of `key` from the pool. They differ from the answer and from each other,
 * never come from a word with the same characters, and never share a gloss with the answer
 * (so "time" is never offered against "time; moment").
 */
export function distinct(answer: Word, pool: readonly Word[], n: number, key: 'h' | 'p' | 'e', rng: Rng = defaultRng, extra: string[] = [], ordered = false): string[] {
  const out: string[] = [];
  const used = new Set([answer[key], ...extra]);
  for (const w of ordered ? pool : shuffle(pool.slice(), rng)) {
    if (w.h === answer.h || overlaps(w, answer)) continue;
    const v = w[key];
    if (!used.has(v)) {
      used.add(v);
      out.push(v);
      if (out.length === n) break;
    }
  }
  return out;
}

/** The three layers of a bubble for one word, outermost first. The bank should hold quiz words only. */
export function makeQuestions(w: Word, bank: readonly Word[], rng: Rng = defaultRng): Question[] {
  const len = [...w.h].length;
  const others = bank.filter(x => x.id !== w.id);
  // look-alike options first: same number of characters, then the closest lengths
  const byLength = new Map<number, Word[]>();
  for (const x of others) {
    const d = Math.abs([...x.h].length - len);
    byLength.set(d, [...(byLength.get(d) ?? []), x]);
  }
  const pool = [...byLength.keys()].sort((a, b) => a - b).flatMap(d => shuffle(byLength.get(d)!, rng));
  const tone = retone(w.p, rng);
  const pinD = tone && tone !== w.p ? [tone] : [];
  pinD.push(...distinct(w, pool, 3 - pinD.length, 'p', rng, pinD, true));
  return [
    { type: 0, prompt: w.h, zh: true, ask: 'What does it mean?', answer: w.e, choices: [w.e, ...distinct(w, others, 3, 'e', rng)], chipZh: false },
    { type: 1, prompt: w.h, zh: true, ask: 'How is it said?', answer: w.p, choices: [w.p, ...pinD], chipZh: false },
    { type: 2, prompt: w.e, zh: false, ask: len > 1 ? 'Which characters?' : 'Which character?', answer: w.h, choices: [w.h, ...distinct(w, pool, 3, 'h', rng, [], true)], chipZh: true }
  ];
}

/**
 * "I forgot": the current question is shown with its answer on a new outer layer,
 * and a fresh copy of it is asked again just before the core.
 */
export function applyForgot(queue: Question[], w: Word, bank: readonly Word[], rng: Rng = defaultRng): Question[] {
  const [q, ...rest] = queue;
  if (!q) return queue;
  const retest: Question = { ...makeQuestions(w, bank, rng)[q.type], retest: true };
  const revealed: Question = { ...q, revealed: true };
  return rest.length
    ? [revealed, ...rest.slice(0, -1), retest, rest[rest.length - 1]]
    : [revealed, retest];
}
