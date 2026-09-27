import { WORDS, type Word } from '../content/words';
import { makeListenQuestions, toneAccuracy, weakestTone, markedTones } from '../game/listening';
import { Rating, State } from '../game/memory';
import type { Question } from '../game/questions';
import { LayeredMode } from './layered';

const byId = new Map(WORDS.map(w => [w.id, w]));
/** ?dictation: every Listen bubble ends in dictation, to try it before any word has graduated. */
const alwaysDictate = typeof location !== 'undefined' && new URLSearchParams(location.search).has('dictation');

/**
 * Listen: the word is heard, not read. It plays as each layer comes up, again when you tap
 * the bubble, and slowly after a wrong answer. Layers: which tones, what it means, which characters
 * (against words that sound alike). The tone layer is also a review in the `tone` skill.
 * Once a word's listening has graduated to long-term review, its core asks you to type the pinyin.
 */
export class ListenMode extends LayeredMode {
  protected readonly skill = 'listen' as const;

  protected makeQuestions(w: Word, bank: readonly Word[]) {
    const dictate = alwaysDictate || this.ctx.progress.card(this.skill, w.id)?.state === State.Review;
    return makeListenQuestions(w, bank, undefined, dictate);
  }

  /**
   * Words with a voice clip. Words you have met in Words mode come first, so you hear what you
   * can already read; before you have met any, it starts from HSK 1 like Words.
   * Among new words, those with your weakest tone come first.
   */
  protected pick(): Word {
    const { pool, progress, voice } = this.ctx;
    const heard = pool().filter(w => voice.hasClip(w));
    const read = progress.cards('words');
    const met = heard.filter(w => read[w.id]);
    const from = met.length >= 4 ? met : heard.length ? heard : pool();
    const weak = weakestTone(toneAccuracy(progress.log, byId));
    const w = this.scheduler.next(from, progress.cards(this.skill), new Date(),
      weak ? x => (markedTones(x.p).includes(weak) ? 1 : 0) : undefined);
    voice.prime(w);
    return w;
  }

  protected onLayer(): void {
    const w = this.word;
    // after the bubble has inflated, so the voice isn't lost under the inflating sound
    if (w) setTimeout(() => { if (this.word === w && this.ctx.bubble.state !== 'hidden') this.ctx.voice.play(w); }, this.ctx.stage.reduceMotion ? 150 : 380);
  }

  protected onWrong(): void { if (this.word) this.ctx.voice.play(this.word, true); }

  protected onPoke(): void { if (this.word) this.ctx.voice.play(this.word); }

  protected onForgot(): void { if (this.word) this.ctx.voice.play(this.word, true); }

  protected onLayerDone(q: Question, firstTry: boolean): void {
    if (q.type === 3 && this.word) this.ctx.progress.review('tone', this.word.id, firstTry ? Rating.Good : Rating.Again);
  }

  protected label() { return { en: 'Listen', zh: '听', py: 'tīng' }; }

  protected title(): string { return 'Squish: listen and pop'; }
}
