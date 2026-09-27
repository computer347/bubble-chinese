import type { Word } from '../content/words';
import { makeQuestions, kindOf, type Question } from '../game/questions';
import { shuffle } from '../game/random';
import { MAX_LAYERS } from '../bubble/bubble';
import { LayeredMode, type NextBubble } from './layered';

/** Where a lesson's drill stands, and what to do when it ends. */
interface DrillSetup {
  /** The drill's words; distractors come from `bank`, the words taught so far. */
  words: Word[];
  bank: Word[];
  label: { en: string; zh: string; py: string };
  done(): void;
}

/**
 * Questions for a word from the words taught so far, so a lesson's options are words you have met.
 * Early in the path there may be too few of them for four distinct options; then the full list helps out.
 */
function lessonQuestions(w: Word, bank: readonly Word[], pool: readonly Word[]): Question[] {
  const qs = makeQuestions(w, bank);
  return qs.every(q => q.choices.length === 4) ? qs : makeQuestions(w, pool);
}

/**
 * A lesson's pop step: one bubble per new word, back to back, no slip in between. Each bubble is a
 * review in the `words` skill, which is how the path's words join Today.
 */
export class DrillMode extends LayeredMode {
  protected readonly skill = 'words' as const;
  protected slipAfter = false;
  private setup: DrillSetup | null = null;
  private toPlay: Word[] = [];

  /** Starts a drill over these words. */
  run(setup: DrillSetup): void {
    this.setup = setup;
    this.toPlay = shuffle(setup.words.slice());
    this.start();
  }

  protected choose(): NextBubble | null {
    const word = this.toPlay.shift();
    return word ? { word, skill: 'words' } : null;
  }

  protected makeQuestions(w: Word, bank: readonly Word[]): Question[] { return lessonQuestions(w, this.setup?.bank ?? bank, bank); }
  protected label() { return this.setup?.label ?? null; }
  protected finish(): void { const done = this.setup?.done; this.stop(); this.setup = null; done?.(); }
  /** How many bubbles are left, the one on screen included. */
  get left(): number { return this.toPlay.length + (this.word ? 1 : 0); }
}

/**
 * A lesson's checkpoint: one bubble with a layer for each of up to six of the lesson's words,
 * each asking one thing about its word. It is a test, not a review: the drill already counted.
 */
export class CheckpointMode extends LayeredMode {
  protected readonly skill = 'words' as const;
  protected slipAfter = false;
  protected records = false;
  private setup: DrillSetup | null = null;
  private played = false;

  run(setup: DrillSetup): void {
    this.setup = setup;
    this.played = false;
    this.start();
  }

  protected choose(): NextBubble | null {
    if (this.played || !this.setup) return null;
    this.played = true;
    return { word: this.setup.words[0], skill: 'words' };
  }

  /** One question for each of up to six words, of a kind the learner asks about, in random order. */
  protected makeQuestions(_w: Word, pool: readonly Word[]): Question[] {
    const s = this.setup!, kinds = this.ctx.progress.data.settings.ask;
    return shuffle(s.words.slice()).slice(0, MAX_LAYERS).map(w => {
      const options = lessonQuestions(w, s.bank, pool).filter(q => kinds.includes(kindOf(q.type)));
      return { ...options[Math.floor(Math.random() * options.length)], word: w.id };
    });
  }

  /** "I forgot" asks the same word again, not the bubble's first word. */
  protected remake(q: Question, _w: Word, pool: readonly Word[]): Question | undefined {
    const w = this.setup?.words.find(x => x.id === q.word);
    return w ? { ...lessonQuestions(w, this.setup!.bank, pool).find(x => x.type === q.type)!, word: w.id } : undefined;
  }

  protected label() { return this.setup?.label ?? null; }
  protected finish(): void { const done = this.setup?.done; this.stop(); this.setup = null; done?.(); }
}
