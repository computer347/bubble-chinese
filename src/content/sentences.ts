import data from './generated/sentences.json';

/** S subject, T time, P place, A adverb or helping verb, V verb or predicate, O object, X particle. */
export type Role = 'S' | 'T' | 'P' | 'A' | 'V' | 'O' | 'X';

export interface Chunk { role: Role; words: string[] }

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
}

export const SENTENCES: readonly Sentence[] = data as Sentence[];

export const ROLE_NAMES: Record<Role, string> = { S: 'subject', T: 'time', P: 'place', A: 'adverb', V: 'verb', O: 'object', X: 'particle' };

/** Sentences that use a word and fit the learner's level, shortest first. */
export function examplesFor(wordId: string, maxLevel: number): Sentence[] {
  return SENTENCES
    .filter(s => s.level <= maxLevel && s.chunks.some(c => c.words.includes(wordId)))
    .sort((a, b) => a.text.length - b.text.length);
}

/** The word ids of a sentence in reading order (the order word timings are stored in). */
export const sentenceWords = (s: Sentence): string[] => s.chunks.flatMap(c => c.words);
