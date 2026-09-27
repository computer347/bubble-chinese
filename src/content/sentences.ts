import data from './generated/sentences.json';

/** S subject, T time, P place, A adverb or helping verb, V verb or predicate, O object, X particle. */
export type Role = 'S' | 'T' | 'P' | 'A' | 'V' | 'O' | 'X';

/** role is null for imported sentences that have not been tagged for Plug mode yet. */
export interface Chunk { role: Role | null; words: string[] }

export type SentenceSource =
  | { name: 'Squish' }
  | { name: 'Tatoeba'; id: number; author: string; enId: number };

/** An example sentence, built from data/content/sentences.tsv by scripts/build-content.mjs. */
export interface Sentence {
  id: string;
  text: string;
  en: string;
  /** Highest HSK level among its words. */
  level: number;
  /** Roles in order, e.g. "S T V O". */
  pattern: string;
  /** Groups of word ids, each with one role: the pieces of Plug mode. */
  chunks: Chunk[];
  /** Punctuation, placed before chunk index `at`. */
  punct: { at: number; p: string }[];
  /** Other valid chunk orders, as role patterns. */
  alt?: string[];
  /** Pinyin of each word as said in this sentence (不 bú, 一 yí/yì), in reading order. */
  py: string[];
  /** Words that are part of a larger word in this sentence (后 in 后天); not used as examples for them. */
  bound?: string[];
  source: SentenceSource;
}

export const SENTENCES: readonly Sentence[] = data as Sentence[];

export const ROLE_NAMES: Record<Role, string> = { S: 'subject', T: 'time', P: 'place', A: 'adverb', V: 'verb', O: 'object', X: 'particle' };

/** Sentences that use a word and fit the learner's level: real Tatoeba sentences first, then shortest. */
export function examplesFor(wordId: string, maxLevel: number): Sentence[] {
  return SENTENCES
    .filter(s => s.level <= maxLevel && s.chunks.some(c => c.words.includes(wordId)) && !s.bound?.includes(wordId))
    .sort((a, b) => (a.source.name === 'Tatoeba' ? 0 : 1) - (b.source.name === 'Tatoeba' ? 0 : 1) || a.text.length - b.text.length);
}

/** Tatoeba's page for a sentence (attribution: CC BY 2.0 FR). */
export const tatoebaUrl = (id: number): string => `https://tatoeba.org/en/sentences/show/${id}`;

/** The word ids of a sentence in reading order (the order word timings are stored in). */
export const sentenceWords = (s: Sentence): string[] => s.chunks.flatMap(c => c.words);
