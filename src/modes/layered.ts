import type { Word } from '../content/words';
import { MAX_LAYERS, EDGES, type Edge } from '../bubble/bubble';
import { forgetLayer, arrange, placeOptions, type Question } from '../game/questions';
import { checkDictation } from '../game/pinyin';
import { Scheduler } from '../game/scheduler';
import { gradeBubble, dueLabel } from '../game/memory';
import type { Skill } from '../game/progress';
import { $ } from '../ui/dom';
import type { Mode, ModeContext } from './mode';

/**
 * A mode where each bubble is one word wrapped in layers, each layer a question with four answers
 * on the edges. Pull the bubble to the right answer to pop a layer; the core ends in a fortune slip.
 * Subclasses say which skill it trains, how the layers are asked, and what happens around them.
 */
/** One bubble to play: a word, and the skill it trains. */
export interface NextBubble { word: Word; skill: Skill }

export abstract class LayeredMode implements Mode {
  word: Word | null = null;
  questions: Question[] = [];
  correctEdge: Edge = 'top';
  /** Wrong answers on the current layer. */
  wrongThisLayer = 0;
  /** Where the last right answer was, so the next one goes elsewhere. */
  private lastEdge: number | null = null;
  protected abstract readonly skill: Skill;
  protected readonly scheduler = new Scheduler();
  private cleanRun = true;
  private bubblePts = 0;
  private bubbleWrong = 0;
  private forgotUsed = false;
  private firstBubble = true;
  private lastDue = new Date();
  /**
   * The next bubble, chosen early (while the slip is up) so its sounds are ready when it arrives.
   * undefined: not chosen yet; null: nothing left to play.
   */
  private upcoming: NextBubble | null | undefined = undefined;
  /** The skill the bubble on screen trains (a mode may mix skills). */
  protected current: Skill = 'words';

  constructor(protected readonly ctx: ModeContext) {
    ctx.hud.forgot.addEventListener('click', () => { if (this.active) this.forgot(); });
  }

  /** The layers for a word, outermost first. */
  protected abstract makeQuestions(w: Word, bank: readonly Word[]): Question[];
  /** The next word to play. */
  protected pick(): Word { return this.scheduler.next(this.ctx.pool(), this.ctx.progress.cards(this.skill)); }
  /** The next bubble: a word and the skill it trains, or null when the session is over. */
  protected choose(): NextBubble | null { return { word: this.pick(), skill: this.skill }; }
  /** Nothing left to play: back to the home screen. */
  protected finish(): void { this.ctx.home(); }
  /** A layer has come up. `fresh` is true for the first layer and whenever the prompt changes. */
  protected onLayer(_q: Question, _fresh: boolean): void {}
  /** A wrong answer on the current layer. */
  protected onWrong(_q: Question): void {}
  /** A layer was answered; `firstTry` if with no wrong answers or "I forgot". */
  protected onLayerDone(_q: Question, _firstTry: boolean): void {}
  /** "I forgot" was pressed on this layer. */
  protected onForgot(q: Question): void { if (q.type !== 0 && this.word) this.ctx.voice.say(this.word); }
  /** The bubble was tapped or poked with Space. */
  protected onPoke(): void {}
  /** The name shown at the top centre while playing, if any. */
  protected label(): { en: string; zh: string; py: string } | null { return null; }
  /** The page title while this word is up (read by screen readers). */
  protected title(w: Word): string { return `Squish: ${w.e}`; }

  private get active(): boolean { return this.ctx.bubble.handler?.reach === this.reach; }
  private readonly reach = (edge: Edge, vi: number) => this.judge(edge, vi);

  prepare(): void { this.upcoming = this.choose(); }

  start(): void {
    this.ctx.bubble.handler = { reach: this.reach, popped: () => this.showSlip(), poked: () => this.onPoke() };
    this.ctx.hud.modeLabel(this.label());
    this.ctx.chips.measure();
    this.spawn();
  }

  stop(): void {
    const { bubble, chips, slip, stage, voice } = this.ctx;
    bubble.hide();
    bubble.handler = null;
    this.upcoming = undefined;
    slip.dismiss();
    voice.stop();
    chips.out();
    this.ctx.dictation.hide();
    this.ctx.hud.modeLabel(null);
    stage.backdrop.setWord('', false);
  }

  key(e: KeyboardEvent): void {
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); this.forgot(); }
  }

  private renderPips(): void {
    const { bubble, hud } = this.ctx;
    hud.layers(bubble.layers, bubble.totalLayers, !!(bubble.layers && bubble.layers < MAX_LAYERS && this.questions[0] && !this.questions[0].revealed));
  }

  private setQuestion(fresh: boolean): void {
    const { chips, hud, stage, dictation, bubble } = this.ctx;
    const q = this.questions[0];
    if (!q.typed) {
      this.correctEdge = chips.set(placeOptions(q.choices, q.answer, this.lastEdge), q.answer, q.chipZh);
      this.lastEdge = EDGES.indexOf(this.correctEdge);
    }
    hud.ask(q.retest ? `Once more: ${q.ask.charAt(0).toLowerCase()}${q.ask.slice(1)}` : q.ask);
    this.renderPips();
    if (fresh) stage.backdrop.setWord(q.prompt, q.zh); else stage.backdrop.kick();
    if (q.typed) dictation.show(); else { dictation.hide(); chips.in(); }
    this.ctx.fit(fresh && bubble.state === 'hidden');
    this.wrongThisLayer = 0;
    this.onLayer(q, fresh);
  }

  private spawn(): void {
    const { bubble, voice, hud, pool } = this.ctx;
    const next = this.upcoming !== undefined ? this.upcoming : this.choose();
    this.upcoming = undefined;
    if (!next) { this.finish(); return; }
    const word = this.word = next.word;
    this.current = next.skill;
    this.questions = arrange(this.makeQuestions(word, pool()), this.ctx.progress.data.settings.ask);
    voice.preload(word);
    this.cleanRun = true; this.bubblePts = 0; this.bubbleWrong = 0; this.forgotUsed = false;
    bubble.spawn(this.questions.length - 1);
    this.setQuestion(true);
    hud.tip(this.firstBubble);
    this.firstBubble = false;
    $('title').textContent = this.title(word);
  }

  private judge(edge: Edge, vi: number): void {
    const q = this.questions[0];
    // a typed layer can't be answered by pulling: the bubble just springs back
    if (q.typed) { this.ctx.bubble.reject(vi); return; }
    if (edge === this.correctEdge) this.right(vi, edge); else this.miss(vi, edge);
  }

  /** A typed answer, from the dictation field. */
  typed(text: string): void {
    const { bubble, dictation, hud } = this.ctx;
    const q = this.questions[0], w = this.word;
    if (!q?.typed || !w || bubble.state !== 'live') return;
    const r = checkDictation(text, w);
    if (r === 'right') { dictation.hide(); this.right(bubble.frontVertex(), null); return; }
    this.miss(bubble.frontVertex(), null);
    dictation.shake();
    hud.ask(r === 'tones' ? 'The sounds are right. Check the tones.' : 'Not quite. Listen again.');
  }

  private miss(vi: number, edge: Edge | null): void {
    const { bubble, chips, sound, session } = this.ctx;
    const q = this.questions[0];
    this.wrongThisLayer++; this.cleanRun = false; session.streak = 0;
    bubble.reject(vi);
    sound.thunk();
    if (edge) {
      chips.shake(edge);
      if (this.wrongThisLayer >= 2) chips.el(this.correctEdge).classList.add('hint');
    }
    this.bubbleWrong++;
    this.ctx.updateHud();
    this.onWrong(q);
  }

  private right(vi: number, edge: Edge | null): void {
    const { bubble, chips, sound, session, progress } = this.ctx;
    const q = this.questions[0];
    const first = this.wrongThisLayer === 0;
    if (first) { session.streak++; progress.recordStreak(session.streak); }
    const pts = first ? 10 + Math.min(session.streak, 10) * 4 : 3;
    session.score += pts; this.bubblePts += pts;
    sound.chime(first ? session.streak : 0);
    if (edge) {
      chips.flash(edge, 'yes', 450);
      chips.el(this.correctEdge).classList.remove('hint');
    }
    this.ctx.updateHud();
    // a revealed layer was answered with help; its retest, later in the bubble, is the real check
    if (!q.revealed) this.onLayerDone(q, first);
    if (bubble.layers > 1) this.popFilm(vi); else this.popCore(vi);
  }

  private popFilm(vi: number): void {
    const { bubble, chips } = this.ctx;
    const prev = this.questions.shift()!;
    bubble.popFilm(vi, () => this.setQuestion(this.questions[0].prompt !== prev.prompt));
    chips.out();
    this.renderPips();
  }

  private popCore(vi: number): void {
    const { bubble, chips, hud, progress } = this.ctx;
    bubble.popCore(vi);
    chips.out();
    hud.ask('Popped!');
    this.renderPips();
    if (this.word) this.lastDue = progress.review(this.current, this.word.id, gradeBubble({ wrong: this.bubbleWrong, forgot: this.forgotUsed })).due;
    this.upcoming = this.choose();
    this.ctx.updateHud();
  }

  /* ---------- forgot: show the answer, add a layer so it is asked again before the core ---------- */
  private forgot(): void {
    const { bubble, chips, hud, session, pool, dictation } = this.ctx;
    const word = this.word;
    if (bubble.state !== 'live' || bubble.dragging || !this.questions[0] || this.questions[0].revealed || !word) return;
    this.ctx.sound.unlock();
    const q = this.questions[0];
    if (!bubble.addLayer()) return;
    const fresh = this.makeQuestions(word, pool()).find(x => x.type === q.type)!;
    this.questions = forgetLayer(this.questions, fresh);
    session.streak = 0; this.cleanRun = false; this.wrongThisLayer = 1; this.forgotUsed = true;
    this.ctx.updateHud();
    if (q.typed) {
      dictation.reveal(q.answer);
      hud.ask(`It’s ${q.answer}. Type it.`);
    } else {
      chips.el(this.correctEdge).classList.add('hint', 'reveal');
      hud.ask(q.chipZh ? `It’s ${q.answer}. Pull it there.` : `It’s “${q.answer}”. Pull it there.`);
    }
    this.ctx.fit();
    this.onForgot(q);
    this.renderPips();
  }

  /* ---------- the fortune slip ---------- */
  private showSlip(): void {
    const { slip, progress, session } = this.ctx;
    if (!this.word) return;
    const next = dueLabel({ due: this.lastDue }, new Date()).replace('due now', 'right away');
    const result = this.cleanRun
      ? `Clean pop, ${this.bubblePts} points. Streak ${session.streak}. Next review ${next}.`
      : `${this.bubblePts} points. This word comes back ${next}.`;
    slip.show(this.word, result, progress.data.settings.maxLevel, () => this.spawn());
  }

  /** For the end-to-end tests: the layer queue as type, revealed, retest. */
  queue(): string[] {
    return this.questions.map(q => `${q.type}${q.revealed ? 'r' : ''}${q.retest ? 't' : ''}`);
  }
}
