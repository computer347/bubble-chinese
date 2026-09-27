import type { Word } from '../content/words';
import { makeQuestions, type Question } from '../game/questions';
import { newToday } from '../game/daily';
import type { Progress, Skill } from '../game/progress';
import { LayeredMode, type NextBubble } from './layered';
import { PATH_ORDER } from '../content/path';
import { Listening } from './listen';
import type { ModeContext } from './mode';

/** The skills Today mixes. */
const SKILLS: readonly Skill[] = ['words', 'listen'];

/** The due card of a skill among some words that has waited longest, as its due time; Infinity if none is due. */
function oldestDue(progress: Progress, skill: Skill, words: readonly Word[], now: Date): number {
  const cards = progress.cards(skill);
  let t = Infinity;
  for (const w of words) { const c = cards[w.id]; if (c && c.due <= now) t = Math.min(t, c.due.getTime()); }
  return t;
}

/** What Today has left: reviews due now (across skills) and new words still allowed today. */
export function todayLeft(ctx: Pick<ModeContext, 'progress' | 'pool'>, heardPool: readonly Word[], now = new Date()): { due: number; fresh: number } {
  const { progress } = ctx;
  const words = ctx.pool();
  const due = progress.dueCount('words', words, now) + progress.dueCount('listen', heardPool, now);
  const unseen = progress.newCount('words', words);
  const fresh = Math.min(unseen, Math.max(0, progress.data.settings.newPerDay - newToday(progress.log, now)));
  return { due, fresh };
}

/**
 * Today: one session for the day. Reviews that are due come first, whichever skill has waited
 * longest (reading in Words, or listening); then new words through Words, up to the daily limit;
 * then it is done, and you are back home.
 */
export class TodayMode extends LayeredMode {
  protected readonly skill = 'words' as const;
  private readonly listening = new Listening(this.ctx, () => this.word);

  /** The listening pool: words met in Words that have a voice clip. */
  heardPool(): Word[] {
    const read = this.ctx.progress.cards('words');
    return this.ctx.pool().filter(w => read[w.id] && this.ctx.voice.hasClip(w));
  }

  protected choose(): NextBubble | null {
    const { progress, pool } = this.ctx;
    const now = new Date(), words = pool(), heard = this.heardPool();
    const from: Record<Skill, readonly Word[]> = { words, listen: heard, tone: [], speak: [], write: [], sentence: [] };
    // the review that has waited longest, in any skill
    let skill: Skill | null = null, t = Infinity;
    for (const s of SKILLS) { const d = oldestDue(progress, s, from[s], now); if (d < t) { t = d; skill = s; } }
    if (skill === 'listen') return { word: this.listening.pick(this.scheduler, heard), skill };
    if (skill === 'words') return { word: this.scheduler.next(words, progress.cards('words'), now), skill };
    // then new words, up to the day's limit
    if (todayLeft(this.ctx, heard, now).fresh > 0) {
      // new words in path order: the next lesson's first, then the rest of the level
      const unseen = words.filter(w => !progress.card('words', w.id));
      const pathFirst = (w: Word) => { const i = PATH_ORDER.get(w.id); return i === undefined ? 0 : 1000 - i; };
      return { word: this.scheduler.next(unseen, progress.cards('words'), now, pathFirst), skill: 'words' };
    }
    return null;
  }

  private get hearing(): boolean { return this.current === 'listen'; }

  protected makeQuestions(w: Word, bank: readonly Word[]): Question[] {
    return this.hearing ? this.listening.questions(w, bank) : makeQuestions(w, bank);
  }
  protected onLayer(): void { if (this.hearing) this.listening.onLayer(); }
  protected onWrong(): void { if (this.hearing) this.listening.replay(true); }
  protected onPoke(): void { if (this.hearing) this.listening.replay(false); }
  protected onForgot(q: Question): void { if (this.hearing) this.listening.replay(true); else super.onForgot(q); }
  protected onLayerDone(q: Question, firstTry: boolean): void { if (this.hearing) this.listening.onLayerDone(q, firstTry); }
  protected label() { return { en: 'Today', zh: '今天', py: 'jīntiān' }; }
  protected title(w: Word): string { return this.hearing ? Listening.title : super.title(w); }
}
