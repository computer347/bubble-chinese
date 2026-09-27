import { gsap } from 'gsap';
import { WORDS, type Word } from '../content/words';
import { PATH, LESSONS, taughtThrough, type Lesson, type Unit, type Token, type BuildSentence } from '../content/path';
import { shuffle } from '../game/random';
import { LessonCard, type CardResult } from '../ui/lessoncard';
import { PathView } from '../ui/pathview';
import { DrillMode, CheckpointMode } from './drills';
import type { LayeredMode } from './layered';
import type { Mode, ModeContext } from './mode';

const byId = new Map(WORDS.map(w => [w.id, w]));
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), { className: cls, textContent: text });
const zhEl = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text: string) => { const e = el(tag, cls, text); e.lang = 'zh-Hans'; return e; };

/** Where the path mode is, for the end-to-end tests. */
export interface PathStatus { screen: 'map' | 'card' | 'drill' | 'checkpoint' | 'none'; step: string; lesson: string | null }

/**
 * The path: a map of units and lessons, and the lesson player. A lesson runs as a series of steps:
 * the unit's culture note (on its first lesson), meeting each new word, popping them in bubbles
 * (each pop a review, so the words join Today), the dialogue in context with two questions,
 * putting sentences in order, and a checkpoint bubble with a layer per word.
 */
export class PathMode implements Mode {
  private readonly drill: DrillMode;
  private readonly checkpoint: CheckpointMode;
  private readonly view: PathView;
  private readonly card: LessonCard;
  /** Bumped whenever a lesson is left, so a lesson still awaiting a card gives up quietly. */
  private run = 0;
  private active: LayeredMode | null = null;
  private status: PathStatus = { screen: 'none', step: '', lesson: null };

  constructor(private readonly ctx: ModeContext) {
    this.drill = new DrillMode(ctx);
    this.checkpoint = new CheckpointMode(ctx);
    this.card = new LessonCard(ctx.stage.reduceMotion);
    this.view = new PathView({
      reduceMotion: ctx.stage.reduceMotion,
      done: () => ctx.progress.data.path.done,
      onLesson: i => void this.lesson(i),
      onNote: u => void this.noteOnly(u)
    });
  }

  start(): void { this.map(); }

  stop(): void {
    this.run++;
    this.active?.stop();
    this.active = null;
    this.card.hide();
    this.view.hide();
    this.ctx.hud.modeLabel(null);
    this.status = { screen: 'none', step: '', lesson: null };
  }

  key(e: KeyboardEvent): void { this.active?.key(e); }

  /** The bubble mode running inside a lesson, if any (for the game's test handle). */
  layered(): LayeredMode | null { return this.active; }
  snapshot(): PathStatus { return { ...this.status }; }

  private map(): void {
    this.card.hide();
    this.active = null;
    this.ctx.hud.modeLabel({ en: 'Path', zh: '学', py: 'xué' });
    this.view.show();
    this.status = { screen: 'map', step: '', lesson: null };
    $title('Squish: the path');
  }

  private async noteOnly(u: Unit): Promise<void> {
    const token = ++this.run;
    this.view.hide();
    const r = await this.showCard({ step: `Unit · ${u.title}`, progress: 0, body: noteBody(u), next: 'Back to the path' });
    if (token === this.run && r) this.map();
  }

  /** Shows a card; resolves true to carry on, false if the lesson was left meanwhile. */
  private async showCard(c: Parameters<LessonCard['show']>[0], onShown?: () => void): Promise<boolean> {
    const token = this.run;
    this.status = { ...this.status, screen: 'card', step: c.step };
    const p = this.card.show(c);
    onShown?.();
    const r: CardResult = await p;
    if (token !== this.run) return false;
    if (r === 'quit') { this.run++; this.ctx.voice.stop(); this.map(); return false; }
    return true;
  }

  private drillRun(mode: DrillMode | CheckpointMode, words: Word[], bank: Word[], label: { en: string; zh: string; py: string }, screen: 'drill' | 'checkpoint'): Promise<boolean> {
    const token = this.run;
    this.card.hide();
    this.active = mode;
    this.status = { ...this.status, screen, step: screen };
    return new Promise(resolve => mode.run({ words, bank, label, done: () => { this.active = null; resolve(token === this.run); } }));
  }

  private async lesson(index: number): Promise<void> {
    const token = ++this.run;
    const { lesson, unit } = LESSONS[index];
    const { voice, sound, progress } = this.ctx;
    const words = lesson.words.map(id => byId.get(id)!);
    // grammar particles (吗, 呢…) are met and used in the dialogue, but not drilled as "what does it mean?"
    const drilled = words.filter(w => w.quiz !== false);
    const bank = taughtThrough(index).map(id => byId.get(id)!).filter(w => w.quiz !== false);
    const label = { en: `Lesson ${index + 1}`, zh: '课', py: 'kè' };
    const first = unit.lessons[0].id === lesson.id && unit.notes.length > 0;
    const quiz = quizLines(lesson);
    const total = (first ? 1 : 0) + words.length + 1 + 1 + quiz.length + lesson.builds.length + 1;
    let at = 0;
    const prog = () => at++ / total;
    const live = () => token === this.run;
    this.view.hide();
    this.status = { screen: 'card', step: '', lesson: lesson.id };
    this.ctx.hud.modeLabel(label);
    $title(`Squish: lesson ${index + 1}, ${lesson.title}`);

    // the unit's culture note, before its first lesson
    if (first && !await this.showCard({ step: `Unit ${unitNumber(unit)} · ${unit.title}`, progress: prog(), body: noteBody(unit), next: 'Start the lesson' })) return;

    // meet each new word
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!await this.showCard({ step: `Meet · ${i + 1} of ${words.length}`, progress: prog(), body: meetBody(w, lesson, voice) },
        () => setTimeout(() => { if (live()) voice.say(w); }, 350))) return;
    }

    // pop them
    if (!await this.showCard({ step: 'Pop', progress: prog(), next: 'Start', body: [
      el('h3', 'lh', 'Pop the new words'),
      el('p', 'lp', `${drilled.length} bubbles, one for each new word${drilled.length < words.length ? ' (the little grammar words are practised in sentences instead)' : ''}. Pull each to the right answer. Each one you pop joins your reviews in Today.`)
    ] })) return;
    if (!await this.drillRun(this.drill, drilled, bank, label, 'drill')) return;
    this.ctx.hud.modeLabel(label);

    // the dialogue, then two questions about it
    if (!await this.showCard({ step: 'In context', progress: prog(), body: dialogueBody(lesson, this.ctx) })) return;
    for (let i = 0; i < quiz.length; i++) {
      const { body, onAnswer } = quizBody(lesson, quiz[i], this.ctx);
      onAnswer(() => this.card.enable());
      if (!await this.showCard({ step: `In context · question ${i + 1} of ${quiz.length}`, progress: prog(), body, locked: true })) return;
    }

    // put sentences in order
    for (let i = 0; i < lesson.builds.length; i++) {
      const { body, onDone } = buildBody(lesson.builds[i], this.ctx);
      onDone(() => this.card.enable());
      if (!await this.showCard({ step: `Build · ${i + 1} of ${lesson.builds.length}`, progress: prog(), body, locked: true })) return;
    }

    // the checkpoint
    if (!await this.showCard({ step: 'Checkpoint', progress: prog(), next: 'Start', body: [
      el('h3', 'lh', 'Checkpoint'),
      el('p', 'lp', `One bubble, a layer for each of ${Math.min(6, drilled.length)} of this lesson's words. Pop it to finish.`)
    ] })) return;
    if (!await this.drillRun(this.checkpoint, drilled, bank, label, 'checkpoint')) return;
    this.ctx.hud.modeLabel(label);

    // done
    progress.completeLesson(lesson.id);
    sound.chime(8);
    const next = LESSONS[index + 1];
    if (!await this.showCard({ step: 'Lesson complete', progress: 1, next: 'Back to the path', body: doneBody(lesson, words, next?.lesson) })) return;
    if (live()) this.map();
  }
}

const $title = (t: string) => { const h = document.getElementById('title'); if (h) h.textContent = t; };
const unitNumber = (u: Unit) => PATH.units.indexOf(u) + 1;

function noteBody(u: Unit): Node[] {
  const head = el('h3', 'lh', `${u.title} `);
  head.append(zhEl('span', 'lzh', u.zh));
  return [el('p', 'lkicker', 'Culture note'), head, ...u.notes.map(n => el('p', 'lp', n))];
}

/** A line of Chinese with each word tappable to hear it (names are read by the device's voice). */
function lineEl(tokens: readonly Token[], ctx: ModeContext, me?: string): HTMLElement {
  const p = zhEl('p', 'ex-zh dzh', '');
  for (const t of tokens) {
    if ('p' in t) { p.append(el('span', 'pu', t.p)); continue; }
    const b = el('button', `tok${'id' in t && t.id === me ? ' me' : ''}`);
    b.type = 'button';
    const hz = 'id' in t ? byId.get(t.id)!.h : t.name;
    b.append(el('span', 'py', t.py), el('span', 'hz', hz));
    b.setAttribute('aria-label', `${hz}, ${t.py}${'id' in t ? `, ${byId.get(t.id)!.e}` : ''}`);
    b.addEventListener('click', () => { if ('id' in t) ctx.voice.say(byId.get(t.id)!); else ctx.speech.speak(t.name); });
    p.append(b);
  }
  return p;
}

function meetBody(w: Word, lesson: Lesson, voice: ModeContext['voice']): Node[] {
  const hear = el('button', 'hear', 'Hear it'), slow = el('button', 'hear', 'Slowly');
  hear.type = slow.type = 'button';
  hear.addEventListener('click', () => voice.say(w));
  slow.addEventListener('click', () => voice.say(w, true));
  const card = el('div', 'meet');
  card.append(zhEl('div', 'meet-h', w.h), el('p', 'meet-p', w.p), el('p', 'meet-e', w.e));
  const btns = el('div', 'hearbtns'); btns.append(hear, slow);
  const out: Node[] = [card, btns];
  // where it comes up in the lesson's dialogue
  const line = lesson.dialogue.find(d => d.tokens.some(t => 'id' in t && t.id === w.id));
  if (line) {
    const ex = el('div', 'meet-ex');
    ex.append(el('p', 'lkicker', 'In this lesson'), zhEl('p', 'meet-exzh', line.text), el('p', 'meet-exen', line.en));
    out.push(ex);
  }
  return out;
}

function dialogueBody(lesson: Lesson, ctx: ModeContext): Node[] {
  const speakers = [...new Set(lesson.dialogue.map(d => d.who))];
  const list = el('div', 'dlg');
  for (const d of lesson.dialogue) {
    const row = el('div', `dline side-${speakers.indexOf(d.who) % 2 ? 'r' : 'l'}`);
    const play = el('button', 'dplay', '▶');
    play.type = 'button';
    play.setAttribute('aria-label', `Play: ${d.text}`);
    play.addEventListener('click', () => ctx.speech.speak(d.text));
    const bubble = el('div', 'dbubble');
    bubble.append(lineEl(d.tokens, ctx), el('p', 'den', d.en));
    row.append(el('span', 'dwho', d.who), bubble, play);
    list.append(row);
  }
  return [el('h3', 'lh', lesson.title), el('p', 'lp small', 'Tap a word to hear it, or ▶ to hear a line.'), list];
}

/** Two lines of the dialogue to ask about: the longest ones, which carry the most. */
function quizLines(lesson: Lesson): number[] {
  const byLength = lesson.dialogue.map((d, i) => ({ i, n: d.tokens.length })).sort((a, b) => b.n - a.n);
  return shuffle(byLength.slice(0, 4).map(x => x.i)).slice(0, 2);
}

/** "What does this line mean?", with four of the dialogue's English lines as options. */
function quizBody(lesson: Lesson, line: number, ctx: ModeContext): { body: Node[]; onAnswer(f: () => void): void } {
  const d = lesson.dialogue[line];
  const others = shuffle([...new Set(lesson.dialogue.map(x => x.en).filter(e => e !== d.en))]).slice(0, 3);
  let answered: () => void = () => {};
  const opts = el('div', 'lopts');
  for (const en of shuffle([d.en, ...others])) {
    const b = el('button', 'lopt', en);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (opts.classList.contains('done')) return;
      opts.classList.add('done');
      const right = en === d.en;
      b.classList.add(right ? 'yes' : 'nope');
      opts.querySelectorAll<HTMLButtonElement>('.lopt').forEach(o => { if (o.textContent === d.en) o.classList.add('yes'); });
      if (right) ctx.sound.chime(2); else { ctx.sound.thunk(); gsap.fromTo(b, { x: -8 }, { x: 0, duration: 0.4, ease: 'elastic.out(1,.3)' }); }
      answered();
    });
    opts.append(b);
  }
  return { body: [el('h3', 'lh', 'What does this mean?'), lineEl(d.tokens, ctx), opts], onAnswer: f => { answered = f; } };
}

/** Tiles for a sentence's chunks: tap them in order; the answer is checked once every tile is placed. */
function buildBody(s: BuildSentence, ctx: ModeContext): { body: Node[]; onDone(f: () => void): void } {
  let done: () => void = () => {}, misses = 0;
  const words = s.chunks.map(c => c.words.map(id => byId.get(id)!));
  let i = 0;
  const tiles = words.map((ws, k) => ({ k, h: ws.map(w => w.h).join(''), py: ws.map(() => s.py[i++]).join(' ') }));
  const answer = zhEl('div', 'banswer', ''), pool = zhEl('div', 'bpool', ''), end = s.punct.filter(p => p.at >= s.chunks.length).map(p => p.p).join('');
  const tileEl = (t: typeof tiles[number]) => {
    const b = el('button', 'btile');
    b.type = 'button'; b.dataset.k = String(t.k);
    b.append(el('span', 'py', t.py), el('span', 'hz', t.h));
    b.addEventListener('click', () => {
      if (answer.classList.contains('right')) return;
      (b.parentElement === pool ? answer : pool).append(b);
      if (!pool.querySelector('.btile')) check();
    });
    return b;
  };
  const check = () => {
    const order = [...answer.querySelectorAll<HTMLElement>('.btile')].map(b => tiles[Number(b.dataset.k)].h).join('');
    if (order === tiles.map(t => t.h).join('')) {
      answer.classList.add('right');
      answer.append(el('span', 'bend', end));
      ctx.sound.chime(3);
      done();
      return;
    }
    misses++;
    ctx.sound.thunk();
    gsap.fromTo(answer, { x: -10 }, { x: 0, duration: 0.45, ease: 'elastic.out(1,.3)' });
    if (misses >= 2) {
      // show the right order, and move on
      answer.replaceChildren(...tiles.map(t => { const b = tileEl(t); b.disabled = true; return b; }), el('span', 'bend', end));
      answer.classList.add('shown');
      done();
    } else setTimeout(() => [...answer.querySelectorAll('.btile')].forEach(b => pool.append(b)), 500);
  };
  // shuffled, but never already in order
  let order = shuffle(tiles.slice());
  for (let n = 0; n < 5 && tiles.length > 1 && order.every((t, k) => t.k === k); n++) order = shuffle(tiles.slice());
  pool.append(...order.map(tileEl));
  return { body: [el('h3', 'lh', 'Put it in order'), el('p', 'bprompt', s.en), answer, pool], onDone: f => { done = f; } };
}

function doneBody(lesson: Lesson, words: Word[], next?: Lesson): Node[] {
  const list = el('ul', 'ldone');
  for (const w of words) {
    const li = el('li');
    li.append(zhEl('span', 'h', w.h), el('span', 'p', w.p), el('span', 'e', w.e));
    list.append(li);
  }
  return [el('h3', 'lh', `${lesson.title}: done`), el('p', 'lp', `These words now come back in Today's reviews.${next ? ` Next up: ${next.title}.` : ''}`), list];
}
