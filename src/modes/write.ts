import type { Word } from '../content/words';
import { Rating, State, type Card, type Grade } from '../game/memory';
import { Scheduler } from '../game/scheduler';
import { LessonCard, type CardResult } from '../ui/lessoncard';
import { StrokeBox, hanziOf, strokeColors } from '../ui/strokes';
import type { Mode, ModeContext } from './mode';
import type { StartArg } from '../ui/shell';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), { className: cls, textContent: text });
const zhEl = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text: string) => { const e = el(tag, cls, text); e.lang = 'zh-Hans'; return e; };

/** A character to write, with the word it is practised in. */
export interface WriteItem { id: string; level: number; word: Word }

/** Characters written in one round. */
export const ROUND = 8;

/**
 * The characters you can practise writing: those of the words you have met (in the word set, when
 * one is chosen), each with the shortest word it appears in, which is shown for context.
 */
export function writableChars(words: readonly Word[], met: Readonly<Record<string, Card>>): WriteItem[] {
  const out = new Map<string, WriteItem>();
  for (const w of words) {
    if (!met[w.id]) continue;
    for (const ch of hanziOf(w.h)) {
      const had = out.get(ch);
      if (!had || [...w.h].length < [...had.word.h].length) out.set(ch, { id: ch, level: w.level, word: w });
    }
  }
  return [...out.values()];
}

/** How a character is written: watched first when new, traced over its outline while learning, from memory once known. */
export type WriteStage = 'new' | 'guided' | 'memory';
export const stageOf = (card: Card | undefined): WriteStage => (!card ? 'new' : card.state === State.Review ? 'memory' : 'guided');

/** A trace's grade: clean is Good; a few slips Hard; many, or a peek at the answer, Again. */
export const gradeOf = (mistakes: number, peeked: boolean): Grade => (peeked || mistakes > 3 ? Rating.Again : mistakes > 0 ? Rating.Hard : Rating.Good);

/** Where Write is, for the end-to-end tests. */
export interface WriteStatus { screen: 'char' | 'done' | 'empty' | 'none'; char: string | null; stage: WriteStage | null; at: number; of: number }

/**
 * Write: rounds of characters from the words you know, each scheduled in the `write` skill. A new
 * character is watched, then traced over its outline; while learning it is traced; once known it is
 * written from memory, with only its word, pinyin and meaning to go on.
 */
export class WriteMode implements Mode {
  private readonly card: LessonCard;
  private readonly scheduler = new Scheduler(ROUND);
  private run = 0;
  private status: WriteStatus = { screen: 'none', char: null, stage: null, at: 0, of: 0 };

  constructor(private readonly ctx: ModeContext) {
    this.card = new LessonCard(ctx.stage.reduceMotion);
  }

  /** Opens a round: of anything to write, or (from Today) only the characters due. */
  start(arg?: unknown): void {
    const a = arg as StartArg | undefined;
    this.ctx.hud.modeLabel({ en: 'Write', zh: '写', py: 'xiě' });
    void this.rounds(a?.kind === 'due');
  }

  stop(): void {
    this.run++;
    this.card.hide();
    this.ctx.hud.modeLabel(null);
    this.status = { screen: 'none', char: null, stage: null, at: 0, of: 0 };
  }

  snapshot(): WriteStatus { return { ...this.status }; }

  /** The characters for a round: those due first, then new ones, never the same twice. */
  private pickRound(onlyDue: boolean): WriteItem[] {
    const { progress } = this.ctx;
    const items = writableChars(this.ctx.practicePool(), progress.cards('words'));
    const cards = progress.cards('write'), now = new Date();
    if (onlyDue) return items.filter(x => cards[x.id] && cards[x.id].due <= now).sort((a, b) => cards[a.id].due.getTime() - cards[b.id].due.getTime()).slice(0, ROUND);
    const round: WriteItem[] = [];
    for (let i = 0; i < ROUND && round.length < items.length; i++) {
      const left = items.filter(x => !round.includes(x));
      round.push(this.scheduler.next(left, cards, now));
    }
    return round;
  }

  private async show(c: Parameters<LessonCard['show']>[0], onShown?: () => void): Promise<boolean> {
    const token = this.run;
    const p = this.card.show(c);
    onShown?.();
    const r: CardResult = await p;
    if (token !== this.run) return false;
    if (r === 'quit') { this.ctx.voice.stop(); this.ctx.home(); return false; }
    return true;
  }

  private async rounds(onlyDue: boolean): Promise<void> {
    const token = ++this.run;
    for (;;) {
      const round = this.pickRound(onlyDue);
      if (!round.length) {
        this.status = { screen: 'empty', char: null, stage: null, at: 0, of: 0 };
        const body = onlyDue
          ? [el('h3', 'lh', 'Nothing to write'), el('p', 'lp', 'No characters are due. Come back tomorrow, or write any of them from Practice.')]
          : [el('h3', 'lh', 'Meet some words first'), el('p', 'lp', 'Write practises the characters of the words you know. Pop a few in Words or take a lesson on the path, then come back.')];
        if (await this.show({ step: 'Write', progress: 0, next: 'Back', body })) this.ctx.home();
        return;
      }
      const results: { ch: string; clean: boolean }[] = [];
      for (let i = 0; i < round.length; i++) {
        const r = await this.one(round[i], i, round.length);
        if (r === null || token !== this.run) return;
        results.push({ ch: round[i].id, clean: r });
      }
      this.status = { screen: 'done', char: null, stage: null, at: round.length, of: round.length };
      const clean = results.filter(x => x.clean).length;
      const list = zhEl('p', 'wdone', '');
      for (const x of results) list.append(zhEl('span', x.clean ? 'wd-clean' : 'wd-slip', x.ch));
      this.ctx.sound.chime(clean === results.length ? 5 : 3);
      const more = onlyDue ? this.pickRound(true).length > 0 : true;
      if (!await this.show({ step: 'Write · round done', progress: 1, next: more ? 'Another round' : 'Back', body: [
        el('h3', 'lh', clean === results.length ? 'All clean!' : 'Round done'),
        el('p', 'lp', `${results.length} ${results.length === 1 ? 'character' : 'characters'}, ${clean} written without a slip. Each comes back when it is due, from memory once you know it.`),
        list
      ] })) return;
      if (!more) { this.ctx.home(); return; }
    }
  }

  /** One character: resolves whether it was written cleanly, or null if Write was left. */
  private async one(item: WriteItem, i: number, n: number): Promise<boolean | null> {
    const { progress, voice, sound } = this.ctx;
    const stage = stageOf(progress.card('write', item.id));
    const w = item.word, ch = item.id;
    this.status = { screen: 'char', char: ch, stage, at: i, of: n };
    const size = Math.min(260, window.innerWidth - 90);
    const box = new StrokeBox(ch, size, strokeColors(), { outline: stage !== 'memory' });
    const status = el('p', 'wstatus', stage === 'new' ? 'Watch the strokes…' : stage === 'guided' ? 'Trace it.' : 'Write it from memory.');
    // the word it is in: in memory the character itself is left out
    const context = el('p', 'wword');
    const h = zhEl('span', 'h', '');
    for (const c of w.h) h.append(c === ch ? zhEl('span', stage === 'memory' ? 'wgap' : 'wme', stage === 'memory' ? '？' : c) : document.createTextNode(c));
    context.append(h, el('span', 'p', w.p), el('span', 'e', w.e));
    const hear = el('button', 'hear', 'Hear it');
    const watch = el('button', 'hear', stage === 'memory' ? 'Show me' : 'Watch again');
    hear.type = watch.type = 'button';
    hear.addEventListener('click', () => voice.say(w));
    const btns = el('div', 'hearbtns'); btns.append(hear, watch);
    let peeked = false, done = false, clean = false;
    const trace = () => box.trace({
      onStroke: (k, total) => { status.textContent = `Stroke ${k} of ${total}`; },
      onMistake: m => { status.textContent = m === 1 ? 'Not quite; try that stroke again.' : `${m} slips so far; a hint shows after ${stage === 'memory' ? 'three' : 'two'} on a stroke.`; },
      onComplete: m => {
        if (done) return;
        done = true; clean = m === 0 && !peeked;
        status.textContent = peeked ? 'Done. It comes back soon, to try from memory again.' : m ? `Done, with ${m} ${m === 1 ? 'slip' : 'slips'}.` : 'Clean!';
        if (stage === 'memory') box.reveal();
        progress.review('write', ch, gradeOf(m, peeked));
        sound.chime(clean ? 4 : 0);
        this.card.enable('Next');
      }
    }, stage === 'memory' ? 3 : 2);
    watch.addEventListener('click', () => {
      if (stage === 'memory' && !done) peeked = true;
      status.textContent = 'Watch the strokes…';
      void box.watch().then(() => { if (!done) { status.textContent = stage === 'memory' ? 'Now write it.' : 'Now trace it.'; trace(); } });
    });
    const title = stage === 'memory' ? 'Write from memory' : `Write ${ch}`;
    const ok = await this.show({ step: `Write · ${i + 1} of ${n}`, progress: i / n, next: 'Skip', body: [el('h3', 'lh', title), context, box.el, status, btns] }, () => {
      if (stage === 'new') void box.watch().then(() => { if (!done) { status.textContent = 'Now trace it.'; trace(); } });
      else trace();
      if (stage === 'memory') setTimeout(() => voice.say(w), 300);
    });
    box.destroy();
    return ok ? clean : null;
  }
}
