import type { Word } from '../content/words';
import { makeQuestions } from '../game/questions';
import { LayeredMode } from './layered';

/**
 * Words: one HSK word per bubble. Two soap films (meaning, then pinyin) around the core
 * (characters); pull the bubble to the right answer to pop each layer.
 */
export class WordsMode extends LayeredMode {
  protected readonly skill = 'words' as const;
  protected makeQuestions(w: Word, bank: readonly Word[]) { return makeQuestions(w, bank); }
  protected label() { return { en: 'Words', zh: '字', py: 'zì' }; }
}
