import type { Mode, ModeContext } from './mode';
import { WordsMode } from './words';
import { ListenMode } from './listen';
import { TodayMode } from './today';
import { PathMode } from './path';

export type ModeId = 'today' | 'path' | 'words' | 'listen' | 'write' | 'plug' | 'learn';

export interface ModeInfo {
  id: ModeId;
  name: string;
  desc: string;
  /** Builds the mode; absent while it is still to come. */
  make?(ctx: ModeContext): Mode;
  /** The home screen's big bubble, rather than a card in the carousel. */
  hero?: boolean;
  /** A character on its orb that says what the task is. */
  glyph?: string;
}

/** The home screen shows one bubble per mode, in this order. */
export const MODES: readonly ModeInfo[] = [
  { id: 'today', name: 'Today', desc: 'Your reviews and new words for today', make: ctx => new TodayMode(ctx), hero: true },
  { id: 'path', name: 'Path', desc: 'Lessons by topic: new words in context', make: ctx => new PathMode(ctx) },
  { id: 'words', name: 'Words', desc: 'Read a word: its meaning, pinyin, characters', make: ctx => new WordsMode(ctx), glyph: '字' },
  { id: 'listen', name: 'Listen', desc: 'Hear a word: its tones, meaning, characters', make: ctx => new ListenMode(ctx), glyph: '听' },
  { id: 'write', name: 'Write', desc: 'Stroke order for the characters you have met', glyph: '写' },
  { id: 'plug', name: 'Plug', desc: 'Build sentences from pieces', glyph: '句' }
];
