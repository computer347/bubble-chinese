import data from './generated/stories.json';
import { LESSONS, type Token } from './path';

/** A sentence of a story; its id names its recording. */
export interface StoryLine { id: string; text: string; en: string; tokens: Token[] }

/** Where a story came from, when it was not written for the app (StoryWeaver, say). */
export interface StorySource { name: string; url: string; credit: string }

export interface Story {
  id: string;
  title: string;
  zh: string;
  level: number;
  /** The path unit it belongs with, if any. */
  unit: string | null;
  by: string;
  licence: string;
  source?: StorySource;
  chars: number;
  /** The lesson after which every word in it has been taught; null when it goes beyond the path. */
  after: string | null;
  words: string[];
  paras: StoryLine[][];
}

/**
 * The graded stories of the Read tab, built from data/content/stories by scripts/build-content.mjs,
 * in the order they open along the path.
 */
export const STORIES: readonly Story[] = data as unknown as Story[];

export type StoryState = 'read' | 'open' | 'locked';

/**
 * A story opens once the path has taught its words (or, for one beyond the path, once its level is
 * chosen); it is read once finished.
 */
export function storyState(s: Story, done: Readonly<Record<string, number>>, read: Readonly<Record<string, number>>, maxLevel: number): StoryState {
  if (read[s.id]) return 'read';
  if (s.after ? done[s.after] : s.level <= maxLevel) return 'open';
  return 'locked';
}

/** "After lesson 9, Family 2": what opens a locked story. */
export function unlockHint(s: Story): string {
  if (!s.after) return `Opens at HSK ${s.level}`;
  const x = LESSONS.find(l => l.lesson.id === s.after);
  return x ? `Opens after lesson ${x.index + 1}, ${x.lesson.title}` : 'Opens later on the path';
}
