import { gsap } from 'gsap';
import { WORDS } from '../content/words';
import { STORIES, type Story, type StoryLine } from '../content/stories';
import type { Sentence } from '../content/sentences';
import type { Mode, ModeContext } from './mode';
import type { StartArg } from '../ui/shell';
import { $ } from '../ui/dom';

const byId = new Map(WORDS.map(w => [w.id, w]));
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), { className: cls, textContent: text });
const zhEl = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => { const e = el(tag, cls, text); e.lang = 'zh-Hans'; return e; };

/** How long a press on a sentence is held before it counts as a long press. */
const HOLD_MS = 450;

/** Where the reader is, for the end-to-end tests. */
export interface ReadStatus { story: string | null; pop: 'word' | 'sentence' | null; playing: number | null }

/**
 * The story reader: a paper page of characters with their pinyin above them (as faint or as strong
 * as the slider says). Tap a word for its meaning, shown above it, and to hear it; hold a sentence
 * for its translation and its recording; or play the whole story, each sentence lit in turn.
 */
export class ReadMode implements Mode {
  private readonly root = $('reader');
  private readonly page = $('rPage');
  private readonly pop = $('rPop');
  private readonly playBtn = $('rPlay') as HTMLButtonElement;
  private readonly slider = $('pyOpacity') as HTMLInputElement;
  private story: Story | null = null;
  private lines: StoryLine[] = [];
  /** Bumped to stop a story being played. */
  private playRun = 0;
  private status: ReadStatus = { story: null, pop: null, playing: null };
  private hold: { timer: number; x: number; y: number; fired: boolean } | null = null;

  constructor(private readonly ctx: ModeContext) {
    this.slider.addEventListener('input', () => this.setPinyin(Number(this.slider.value)));
    this.slider.addEventListener('change', () => ctx.progress.setPinyin(Number(this.slider.value)));
    this.playBtn.addEventListener('click', () => (this.status.playing !== null ? this.stopPlaying() : void this.playFrom(0)));
    this.page.addEventListener('pointerdown', e => this.pressStart(e));
    this.page.addEventListener('pointermove', e => { if (this.hold && Math.hypot(e.clientX - this.hold.x, e.clientY - this.hold.y) > 10) this.pressCancel(); });
    this.page.addEventListener('pointerup', () => { if (this.hold && !this.hold.fired) this.pressCancel(); });
    this.page.addEventListener('pointercancel', () => this.pressCancel());
    this.page.addEventListener('contextmenu', e => e.preventDefault());
    this.page.addEventListener('click', e => this.tap(e));
    this.root.addEventListener('scroll', () => this.hidePop(), { passive: true });
    // a tap beside the page puts the card away too
    this.root.addEventListener('click', e => { if (!this.page.contains(e.target as Node)) this.hidePop(); });
  }

  /** Opens a story by id. */
  start(arg?: unknown): void {
    const a = arg as StartArg | undefined;
    const s = a?.kind === 'story' ? STORIES.find(x => x.id === a.id) : undefined;
    if (!s) { this.ctx.home(); return; }
    this.story = s;
    this.lines = s.paras.flat();
    this.status = { story: s.id, pop: null, playing: null };
    this.ctx.hud.modeLabel({ en: s.title, zh: '读', py: 'dú' });
    document.title = `Squish: ${s.title}`;
    this.slider.value = String(this.ctx.progress.data.settings.pinyin);
    this.setPinyin(this.ctx.progress.data.settings.pinyin);
    this.render(s);
    this.root.hidden = false;
    this.root.scrollTop = 0;
    this.playBtn.textContent = '▶ Play all';
    gsap.fromTo(this.page, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: this.ctx.stage.reduceMotion ? 0.05 : 0.5, ease: 'power3.out', clearProps: 'transform' });
  }

  stop(): void {
    this.stopPlaying();
    this.hidePop();
    this.pressCancel();
    this.root.hidden = true;
    this.story = null;
    this.status = { story: null, pop: null, playing: null };
    this.ctx.hud.modeLabel(null);
  }

  key(e: KeyboardEvent): void {
    if (e.key === ' ' && this.story) { e.preventDefault(); this.playBtn.click(); }
  }

  snapshot(): ReadStatus { return { ...this.status }; }

  private setPinyin(v: number): void {
    this.root.style.setProperty('--py-o', String(v));
    this.slider.setAttribute('aria-valuetext', v === 0 ? 'Pinyin hidden' : `Pinyin at ${Math.round(v * 100)}%`);
  }

  private render(s: Story): void {
    const head = el('header', 'r-head');
    head.append(zhEl('h2', 'r-title', s.zh), el('p', 'r-en', s.title), el('p', 'r-meta', `HSK ${s.level} · ${s.chars} characters · tap a word, hold a sentence`));
    let i = 0;
    const paras = s.paras.map(p => {
      const para = zhEl('p', 'r-para');
      for (const line of p) para.append(this.sentenceEl(line, i++));
      return para;
    });
    const done = el('button', 'next r-done', 'Finished');
    done.type = 'button';
    done.addEventListener('click', () => {
      if (this.story) this.ctx.progress.completeStory(this.story.id);
      this.ctx.sound.chime(3);
      this.ctx.home();
    });
    const credit = el('p', 'r-credit', `Story by ${s.by} · ${s.licence}`);
    if (s.source) {
      credit.textContent = `${s.source.credit} · ${s.licence} · `;
      const a = el('a', '', s.source.name);
      a.href = s.source.url; a.target = '_blank'; a.rel = 'noopener';
      credit.append(a);
    }
    const foot = el('footer', 'r-foot');
    foot.append(done, credit);
    this.page.replaceChildren(head, ...paras, foot);
  }

  private sentenceEl(line: StoryLine, i: number): HTMLElement {
    const sent = el('span', 'r-sent');
    sent.dataset.i = String(i);
    let w = 0;
    for (const t of line.tokens) {
      if ('p' in t) { sent.append(el('span', 'r-pu', t.p)); continue; }
      const r = el('ruby', 'r-w');
      r.append(document.createTextNode('id' in t ? byId.get(t.id)!.h : t.name), el('rt', '', t.py));
      if ('id' in t) { r.dataset.id = t.id; r.dataset.w = String(w++); } else r.dataset.name = t.name;
      sent.append(r);
    }
    return sent;
  }

  /* ---------- tap a word, hold a sentence ---------- */

  private pressStart(e: PointerEvent): void {
    const sent = (e.target as HTMLElement).closest<HTMLElement>('.r-sent');
    if (!sent || e.button > 0) return;
    this.pressCancel();
    const hold = { timer: 0, x: e.clientX, y: e.clientY, fired: false };
    hold.timer = window.setTimeout(() => {
      hold.fired = true;
      this.showSentence(sent);
    }, HOLD_MS);
    this.hold = hold;
    sent.classList.add('pressing');
  }

  private pressCancel(): void {
    if (!this.hold) return;
    clearTimeout(this.hold.timer);
    this.page.querySelectorAll('.pressing').forEach(x => x.classList.remove('pressing'));
    // a long press already showed its translation; the click that follows it is not a tap
    if (!this.hold.fired) this.hold = null;
  }

  private tap(e: MouseEvent): void {
    if (this.hold?.fired) { this.hold = null; this.page.querySelectorAll('.pressing').forEach(x => x.classList.remove('pressing')); return; }
    this.hold = null;
    const w = (e.target as HTMLElement).closest<HTMLElement>('.r-w');
    if (!w || w.classList.contains('shown')) { this.hidePop(); return; }
    this.showWord(w);
  }

  private showWord(r: HTMLElement): void {
    const word = r.dataset.id ? byId.get(r.dataset.id) : undefined;
    const py = r.querySelector('rt')?.textContent ?? '';
    const box = el('div', 'rpop-word');
    if (word) {
      box.append(zhEl('span', 'rpop-h', word.h), el('span', 'rpop-p', py), el('span', 'rpop-e', word.e));
      this.ctx.voice.say(word);
    } else {
      box.append(zhEl('span', 'rpop-h', r.dataset.name ?? ''), el('span', 'rpop-p', py), el('span', 'rpop-e', 'a name'));
      this.ctx.speech.speak(r.dataset.name ?? '');
    }
    this.openPop(r, [box], 'word');
  }

  private showSentence(sent: HTMLElement): void {
    const i = Number(sent.dataset.i), line = this.lines[i];
    if (!line) return;
    this.ctx.sound.chime(1);
    const hear = el('button', 'hear', '▶ Hear it'), slow = el('button', 'hear', 'Slowly');
    hear.type = slow.type = 'button';
    hear.addEventListener('click', () => this.saySentence(i, false));
    slow.addEventListener('click', () => this.saySentence(i, true));
    const btns = el('div', 'hearbtns'); btns.append(hear, slow);
    this.openPop(sent, [el('p', 'rpop-en', line.en), btns], 'sentence');
    this.saySentence(i, false);
  }

  /** The glass card above a word or sentence (below it, when there is no room above). */
  private openPop(target: HTMLElement, body: Node[], kind: 'word' | 'sentence'): void {
    this.hidePop();
    target.classList.add('shown');
    this.pop.className = `rpop rpop-${kind}`;
    this.pop.replaceChildren(...body);
    this.pop.hidden = false;
    // a sentence can wrap over lines: sit above the line it starts on
    const rects = [...target.getClientRects()];
    const r = rects[0] ?? target.getBoundingClientRect();
    const p = this.pop.getBoundingClientRect();
    const topLimit = this.root.getBoundingClientRect().top + 8;
    const x = Math.min(Math.max(12, r.left + r.width / 2 - p.width / 2), innerWidth - p.width - 12);
    const above = r.top - p.height - 10;
    const last = rects[rects.length - 1] ?? r;
    const y = above >= topLimit ? above : last.bottom + 10;
    this.pop.style.left = `${x}px`;
    this.pop.style.top = `${y}px`;
    this.pop.style.setProperty('--ax', `${Math.min(Math.max(16, r.left + r.width / 2 - x), p.width - 16)}px`);
    this.pop.classList.toggle('below', y !== above);
    gsap.fromTo(this.pop, { opacity: 0, y: y === above ? 8 : -8, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: this.ctx.stage.reduceMotion ? 0.05 : 0.28, ease: 'back.out(1.8)' });
    this.status.pop = kind;
  }

  private hidePop(): void {
    if (this.pop.hidden) return;
    this.pop.hidden = true;
    this.page.querySelectorAll('.shown').forEach(x => x.classList.remove('shown'));
    this.status.pop = null;
  }

  /* ---------- listening ---------- */

  /** One sentence, its words lit as they are said; resolves when it ends (or is stopped). */
  private saySentence(i: number, slow: boolean): Promise<void> {
    const line = this.lines[i];
    const sent = this.page.querySelector<HTMLElement>(`.r-sent[data-i="${i}"]`);
    if (!line || !sent) return Promise.resolve();
    const words = [...sent.querySelectorAll<HTMLElement>('.r-w[data-w]')];
    this.page.querySelectorAll('.r-sent.playing').forEach(x => x.classList.remove('playing'));
    sent.classList.add('playing');
    return new Promise(resolve => {
      void this.ctx.voice.saySentence(this.asSentence(line), slow, k => {
        words.forEach((w, j) => w.classList.toggle('lit', j === k));
        if (k === null) { sent.classList.remove('playing'); resolve(); }
      });
    });
  }

  /** The voice plays a story line like a sentence: its words are its syllabus words, in order. */
  private asSentence(line: StoryLine): Sentence {
    const words = line.tokens.flatMap(t => ('id' in t ? [t.id] : []));
    return { id: line.id, text: line.text, en: line.en, level: this.story?.level ?? 1, pattern: '', chunks: [{ role: null, words }], punct: [], py: [], source: { name: 'Squish' } };
  }

  /** Plays the story from a sentence to the end, scrolling each into view. */
  private async playFrom(start: number): Promise<void> {
    const run = ++this.playRun;
    this.hidePop();
    this.playBtn.textContent = '■ Stop';
    for (let i = start; i < this.lines.length; i++) {
      if (run !== this.playRun) return;
      this.status.playing = i;
      const sent = this.page.querySelector<HTMLElement>(`.r-sent[data-i="${i}"]`);
      sent?.scrollIntoView({ block: 'center', behavior: this.ctx.stage.reduceMotion ? 'auto' : 'smooth' });
      await this.saySentence(i, false);
      if (run !== this.playRun) return;
      await new Promise(r => setTimeout(r, 380));
    }
    if (run === this.playRun) this.stopPlaying();
  }

  private stopPlaying(): void {
    this.playRun++;
    if (this.status.playing !== null) this.ctx.voice.stop();
    this.status.playing = null;
    this.playBtn.textContent = '▶ Play all';
    this.page.querySelectorAll('.playing, .lit').forEach(x => x.classList.remove('playing', 'lit'));
  }
}
