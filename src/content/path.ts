import data from './generated/path.json';
import type { Chunk } from './sentences';

/** A word in a dialogue line: an HSK word (with its pinyin as said here), a name, or punctuation. */
export type Token = { id: string; py: string } | { name: string; py: string } | { p: string };

/** A line of a lesson's dialogue; its id names its recording (shared by lines with the same text). */
export interface DialogueLine { id: string; who: string; en: string; text: string; tokens: Token[] }

/** A sentence to put in order: its chunks are the tiles. */
export interface BuildSentence { text: string; en: string; pattern: string; chunks: Chunk[]; punct: { at: number; p: string }[]; py: string[] }

export interface Lesson { id: string; title: string; words: string[]; dialogue: DialogueLine[]; builds: BuildSentence[] }

export interface Unit { id: string; title: string; zh: string; topic: string; notes: string[]; lessons: Lesson[] }

/**
 * The path, built from data/content/path-hsk1.txt by scripts/build-content.mjs: units of lessons,
 * each teaching about ten words with a dialogue and sentences to build.
 */
export const PATH: { level: number; units: Unit[] } = data as unknown as { level: number; units: Unit[] };

/** Every lesson in path order, with its unit. */
export const LESSONS: readonly { lesson: Lesson; unit: Unit; index: number }[] =
  PATH.units.flatMap(unit => unit.lessons.map(lesson => ({ lesson, unit }))).map((x, index) => ({ ...x, index }));

export type LessonState = 'done' | 'open' | 'locked';

/** Lessons open one at a time: the first not yet done is open, those after it are locked. */
export function lessonStates(done: Readonly<Record<string, number>>): Map<string, LessonState> {
  const out = new Map<string, LessonState>();
  let open = false;
  for (const { lesson } of LESSONS) {
    if (done[lesson.id]) out.set(lesson.id, 'done');
    else if (!open) { out.set(lesson.id, 'open'); open = true; }
    else out.set(lesson.id, 'locked');
  }
  return out;
}

/** The lesson to do next, or null when every drafted lesson is done. */
export const nextLesson = (done: Readonly<Record<string, number>>) => LESSONS.find(x => !done[x.lesson.id]) ?? null;

/** Where each word is taught on the path (its lesson's position); words not on the path are absent. */
export const PATH_ORDER: ReadonlyMap<string, number> = new Map(LESSONS.flatMap(x => x.lesson.words.map(id => [id, x.index] as const)));

/** Words taught up to and including a lesson: the lesson's own, and every earlier one's. */
export const taughtThrough = (index: number): string[] => LESSONS.filter(x => x.index <= index).flatMap(x => x.lesson.words);
