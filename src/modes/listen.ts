import { WORDS, type Word } from '../content/words';
import { makeListenQuestions, toneAccuracy, weakestTone, markedTones } from '../game/listening';
import { Rating, State } from '../game/memory';
import type { Question } from '../game/questions';
import type { Scheduler } from '../game/scheduler';
import { LayeredMode } from './layered';
import type { ModeContext } from './mode';

const byId = new Map(WORDS.map(w => [w.id, w]));
/** ?dictation: every Listen bubble ends in dictation, to try it before any word has graduated. */
const alwaysDictate = typeof location !== 'undefined' && new URLSearchParams(location.search).has('dictation');

/**
 * How a listening bubble behaves, shared by Listen and by Today's listening reviews.
 * The word plays as each layer comes up, again when you tap the bubble, and slowly after a wrong
 * answer. Layers: which tones, what it means, which characters (against words that sound alike).
 * The tone layer is also a review in the `tone` skill. Once a word's listening has graduated to
 * long-term review, its core asks you to type the pinyin.
 */
export class Listening {
  constructor(private readonly ctx: ModeContext, private readonly word: () => Word | null) {}

  /** Words of the practice set that can be heard, with those met in Words first, so you hear what you can already read. */
  pool(): Word[] {
    const { practicePool: pool, progress, voice } = this.ctx;
    const heard = pool().filter(w => voice.hasClip(w));
    const read = progress.cards('words');
    const met = heard.filter(w => read[w.id]);
    return met.length >= 4 ? met : heard.length ? heard : pool().slice();
  }

  /** The next word to hear; among new ones, those with your weakest tone first. Its clip starts decoding now. */
  pick(scheduler: Scheduler, from: readonly Word[] = this.pool()): Word {
    const { progress, voice } = this.ctx;
    const weak = weakestTone(toneAccuracy(progress.log, byId));
    const w = scheduler.next(from, progress.cards('listen'), new Date(), weak ? x => (markedTones(x.p).includes(weak) ? 1 : 0) : undefined);
    voice.prime(w);
    return w;
  }

  questions(w: Word, bank: readonly Word[]): Question[] {
    const dictate = alwaysDictate || this.ctx.progress.card('listen', w.id)?.state === State.Review;
    return makeListenQuestions(w, bank, undefined, dictate);
  }

  onLayer(): void {
    const w = this.word();
    // after the bubble has inflated, so the voice isn't lost under the inflating sound
    if (w) setTimeout(() => { if (this.word() === w && this.ctx.bubble.state !== 'hidden') this.ctx.voice.play(w); }, this.ctx.stage.reduceMotion ? 150 : 380);
  }

  /** Replays the word: slowly after a wrong answer or "I forgot", normally when tapped. */
  replay(slow: boolean): void { const w = this.word(); if (w) this.ctx.voice.play(w, slow); }

  onLayerDone(q: Question, firstTry: boolean): void {
    const w = this.word();
    if (q.type === 3 && w) this.ctx.progress.review('tone', w.id, firstTry ? Rating.Good : Rating.Again);
  }

  static readonly label = { en: 'Listen', zh: '听', py: 'tīng' };
  static readonly title = 'Squish: listen and pop';
}

/** Listen: the word is heard, not read. See Listening. */
export class ListenMode extends LayeredMode {
  protected readonly skill = 'listen' as const;
  private readonly listening = new Listening(this.ctx, () => this.word);

  protected makeQuestions(w: Word, bank: readonly Word[]) { return this.listening.questions(w, bank); }
  protected pick(): Word { return this.listening.pick(this.scheduler); }
  protected onLayer(): void { this.listening.onLayer(); }
  protected onWrong(): void { this.listening.replay(true); }
  protected onPoke(): void { this.listening.replay(false); }
  protected onForgot(): void { this.listening.replay(true); }
  protected onLayerDone(q: Question, firstTry: boolean): void { this.listening.onLayerDone(q, firstTry); }
  protected label() { return Listening.label; }
  protected title(): string { return Listening.title; }
}
