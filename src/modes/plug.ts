import { gsap } from 'gsap';
import type { Role, Sentence } from '../content/sentences';
import { ROLE_NAMES } from '../content/sentences';
import { Rating, type Grade } from '../game/memory';
import { Scheduler } from '../game/scheduler';
import { shuffle } from '../game/random';
import { PLUG_ITEMS, STAGES, TO_OPEN, openStage, scaffoldOf, fits, checkOrder, placedText, pieceWords, knownShare, type PlugItem, type Scaffold } from '../game/plug';
import type { Mode, ModeContext } from './mode';
import { $ } from '../ui/dom';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), { className: cls, textContent: text });

/** A solve's grade: clean is Good, one slip or hint Hard, more Again. */
export const plugGrade = (mistakes: number, hints: number): Grade => (mistakes + hints === 0 ? Rating.Good : mistakes + hints === 1 ? Rating.Hard : Rating.Again);

/** Where Plug is, for the end-to-end tests. */
export interface PlugStatus {
  id: string | null; scaffold: Scaffold | null; stage: number; solved: boolean; mistakes: number; hints: number;
  /** Each socket's role, and the text of the piece in it. */
  sockets: { role: Role | null; text: string | null }[];
  /** Pieces still in the tray. */
  tray: string[];
  /** The canonical order, piece by piece. */
  expected: string[];
}

/**
 * Plug: a sentence's pieces, each shaped by its grammatical role (who, when, where, how, does,
 * what, particle), to plug into the sentence's sockets in order. New sentences show shape and
 * colour; while learning, shape only; once known, plain slots where every valid order counts.
 * The grammar opens a stage at a time; each solve is a review in the `sentence` skill.
 */
export class PlugMode implements Mode {
  private readonly root = $('plug');
  private readonly socketsEl = $('plugSockets');
  private readonly trayEl = $('plugTray');
  private readonly nextBtn = $('plugNext') as HTMLButtonElement;
  private readonly scheduler = new Scheduler(8);
  private item: PlugItem | null = null;
  private scaffold: Scaffold = 'shape-colour';
  /** The chunk index in each socket, or null. */
  private placed: (number | null)[] = [];
  private pieces: HTMLButtonElement[] = [];
  private mistakes = 0;
  private hints = 0;
  private solved = false;
  private stage = 0;
  private drag: { piece: HTMLButtonElement; x: number; y: number; moved: boolean; id: number } | null = null;

  constructor(private readonly ctx: ModeContext) {
    $('plugHear').addEventListener('click', () => this.hear());
    $('plugHint').addEventListener('click', () => this.hint());
    this.nextBtn.addEventListener('click', () => this.next());
    // dragging: a piece follows the finger and drops into the socket under it
    this.root.addEventListener('pointermove', e => this.dragMove(e));
    this.root.addEventListener('pointerup', e => this.dragEnd(e));
    this.root.addEventListener('pointercancel', () => this.dragCancel());
    // keys from anywhere on the screen (the pieces and buttons have focus here, not the stage)
    this.root.addEventListener('keydown', e => this.key(e));
  }

  start(): void {
    this.root.hidden = false;
    this.ctx.hud.modeLabel({ en: 'Plug', zh: '句', py: 'jù' });
    this.next();
  }

  stop(): void {
    this.ctx.voice.stop();
    this.root.hidden = true;
    this.item = null;
    this.ctx.hud.modeLabel(null);
  }

  key(e: KeyboardEvent): void {
    if (e.key === 'Backspace' && !this.solved) {
      // takes back the last piece placed
      const last = this.placed.map((c, i) => (c === null ? -1 : i)).filter(i => i >= 0).pop();
      if (last !== undefined) { e.preventDefault(); this.unplace(last); }
    }
  }

  snapshot(): PlugStatus {
    const it = this.item;
    const text = (c: number | null) => (c === null || !it ? null : pieceWords(it, c).map(w => w.h).join(''));
    return {
      id: it?.id ?? null, scaffold: it ? this.scaffold : null, stage: this.stage, solved: this.solved, mistakes: this.mistakes, hints: this.hints,
      sockets: this.placed.map((c, i) => ({ role: it?.chunks[i].role ?? null, text: text(c) })),
      tray: this.pieces.filter(p => p.parentElement === this.trayEl).map(p => text(Number(p.dataset.c))!),
      expected: it ? it.chunks.map((_, i) => text(i)!) : []
    };
  }

  /* ---------- a sentence ---------- */

  /** The sentences open to the learner: at their level, up to the furthest stage they have opened. */
  private pool(): PlugItem[] {
    const { progress } = this.ctx;
    const level = PLUG_ITEMS.filter(x => x.level <= progress.data.settings.maxLevel);
    this.stage = openStage(level, progress.cards('sentence'));
    return level.filter(x => x.stage <= this.stage);
  }

  private next(): void {
    const { progress } = this.ctx;
    const before = this.stage;
    const pool = this.pool();
    if (!pool.length) return;
    const met = progress.cards('words');
    // among new sentences, those whose words you know best come first
    const it = this.scheduler.next(pool, progress.cards('sentence'), new Date(), x => Math.round(knownShare(x, met) * 4));
    this.item = it;
    this.scaffold = scaffoldOf(progress.card('sentence', it.id));
    this.placed = it.chunks.map(() => null);
    this.mistakes = 0; this.hints = 0; this.solved = false;
    this.render(it, before !== this.stage && before !== 0);
  }

  private render(it: PlugItem, newStage: boolean): void {
    this.root.dataset.scaffold = this.scaffold;
    this.root.classList.remove('solved');
    const st = STAGES[this.stage];
    const pool = PLUG_ITEMS.filter(x => x.stage === this.stage && x.level <= this.ctx.progress.data.settings.maxLevel);
    const solvedHere = pool.filter(x => this.ctx.progress.card('sentence', x.id)).length;
    $('plugStage').textContent = `${newStage ? 'New · ' : ''}${st.name} ${st.zh}${solvedHere < TO_OPEN ? ` · ${solvedHere} of ${Math.min(TO_OPEN, pool.length)} to open the next` : ''}`;
    $('plugStage').lang = 'en';
    $('plugEn').textContent = it.en;
    $('plugResult').textContent = '';
    this.nextBtn.hidden = true;
    ($('plugHint') as HTMLButtonElement).disabled = false;
    // sockets in the sentence's order, shaped by role while there are shapes
    this.socketsEl.replaceChildren(...it.chunks.map((c, i) => {
      const li = el('li', 'socket');
      li.dataset.role = c.role ?? '';
      li.dataset.i = String(i);
      li.setAttribute('aria-label', this.scaffold === 'none' ? `Place ${i + 1}` : `Place ${i + 1}: ${ROLE_NAMES[c.role!]}`);
      li.append(el('span', 'shape'));
      return li;
    }));
    // the pieces, shuffled into the tray
    this.pieces = shuffle(it.chunks.map((_, i) => i)).map(i => this.pieceEl(it, i));
    this.trayEl.replaceChildren(...this.pieces);
    const roles = [...new Set(it.chunks.map(c => c.role!))];
    $('plugLegend').replaceChildren(...(this.scaffold === 'shape-colour' ? roles.map(r => { const s = el('span', 'legend'); s.dataset.role = r; s.append(el('i', 'shape'), el('span', '', ROLE_NAMES[r])); return s; }) : []));
    gsap.fromTo(this.pieces, { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: this.ctx.stage.reduceMotion ? 0.05 : 0.7, stagger: 0.05, ease: 'elastic.out(1,.5)', clearProps: 'transform' });
    if (newStage) gsap.fromTo('#plugStage', { scale: 1.25 }, { scale: 1, duration: 0.8, ease: 'elastic.out(1,.4)' });
  }

  private pieceEl(it: PlugItem, c: number): HTMLButtonElement {
    const b = el('button', 'piece');
    b.type = 'button';
    b.dataset.c = String(c);
    b.dataset.role = it.chunks[c].role ?? '';
    const words = pieceWords(it, c);
    const zh = el('span', 'piece-zh', words.map(w => w.h).join(''));
    zh.lang = 'zh-Hans';
    b.append(el('span', 'shape'), zh, el('span', 'piece-py', words.map(w => w.p).join(' ')));
    b.setAttribute('aria-label', `${zh.textContent}, ${words.map(w => w.p).join(' ')}${this.scaffold === 'none' ? '' : `, ${ROLE_NAMES[it.chunks[c].role!]}`}`);
    b.style.animationDelay = `${(-Math.random() * 3).toFixed(2)}s`;
    b.addEventListener('pointerdown', e => {
      if (this.solved || e.button > 0) return;
      this.drag = { piece: b, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    });
    b.addEventListener('click', () => { if (!this.drag?.moved) this.tap(b); });
    return b;
  }

  /* ---------- placing ---------- */

  private socketOf(piece: HTMLElement): number | null {
    const li = piece.parentElement?.closest<HTMLElement>('.socket');
    return li ? Number(li.dataset.i) : null;
  }

  /** A tap: from the tray into the first socket it fits, or out of its socket back to the tray. */
  private tap(piece: HTMLButtonElement): void {
    if (this.solved || !this.item) return;
    const at = this.socketOf(piece);
    if (at !== null) { this.unplace(at); return; }
    const role = this.item.chunks[Number(piece.dataset.c)].role;
    const target = this.placed.findIndex((c, i) => c === null && fits(role, this.item!.chunks[i].role, this.scaffold));
    if (target < 0) { this.bounce(piece); return; }
    this.place(piece, target);
  }

  /** Moves a piece into a socket, flying from where it was. */
  private place(piece: HTMLButtonElement, i: number): void {
    const from = piece.getBoundingClientRect();
    const li = this.socketsEl.children[i] as HTMLElement;
    li.append(piece);
    this.placed[i] = Number(piece.dataset.c);
    this.fly(piece, from);
    this.ctx.sound.pop(false);
    if (this.placed.every(c => c !== null)) setTimeout(() => this.check(), this.ctx.stage.reduceMotion ? 50 : 380);
  }

  private unplace(i: number): void {
    const li = this.socketsEl.children[i] as HTMLElement;
    const piece = li.querySelector<HTMLButtonElement>('.piece');
    this.placed[i] = null;
    if (!piece) return;
    const from = piece.getBoundingClientRect();
    this.trayEl.append(piece);
    this.fly(piece, from);
  }

  /** FLIP: the piece jumps to its new place, then springs there from where it was, squashing as it lands. */
  private fly(piece: HTMLElement, from: DOMRect): void {
    const to = piece.getBoundingClientRect();
    if (this.ctx.stage.reduceMotion) return;
    gsap.fromTo(piece, { x: from.left - to.left, y: from.top - to.top, scaleX: 1.12, scaleY: 0.88 },
      { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: 0.55, ease: 'elastic.out(1,.6)', clearProps: 'transform' });
  }

  /** It does not fit there: a wobble and a thunk. */
  private bounce(piece: HTMLElement): void {
    this.ctx.sound.thunk();
    gsap.fromTo(piece, { x: -9 }, { x: 0, duration: 0.5, ease: 'elastic.out(1,.3)', clearProps: 'transform' });
  }

  /* ---------- dragging ---------- */

  private dragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 8) return;
    if (!d.moved) { d.moved = true; d.piece.classList.add('dragging'); d.piece.setPointerCapture?.(e.pointerId); }
    gsap.set(d.piece, { x: dx, y: dy, scale: 1.08, rotation: dx / 30 });
  }

  private dragEnd(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved) { this.drag = null; return; }             // a tap: the click handles it
    d.piece.classList.remove('dragging');
    const under = document.elementsFromPoint(e.clientX, e.clientY).map(x => x.closest<HTMLElement>('.socket')).find(Boolean);
    const piece = d.piece, it = this.item;
    setTimeout(() => { this.drag = null; }, 0);               // the click that follows a drag is not a tap
    if (under && it) {
      const i = Number(under.dataset.i), c = Number(piece.dataset.c);
      if (fits(it.chunks[c].role, it.chunks[i].role, this.scaffold)) {
        const was = this.socketOf(piece);
        if (was !== null) this.placed[was] = null;
        if (this.placed[i] !== null && was !== i) this.unplace(i);   // the piece already there makes room
        this.place(piece, i);
        return;
      }
      this.bounce(piece);
    }
    gsap.to(piece, { x: 0, y: 0, scale: 1, rotation: 0, duration: 0.5, ease: 'elastic.out(1,.5)', clearProps: 'transform' });
  }

  private dragCancel(): void {
    if (!this.drag) return;
    this.drag.piece.classList.remove('dragging');
    gsap.to(this.drag.piece, { x: 0, y: 0, scale: 1, rotation: 0, duration: 0.3, clearProps: 'transform' });
    this.drag = null;
  }

  /* ---------- checking ---------- */

  private texts(): string[] { return this.placed.map(c => (c === null || !this.item ? '' : pieceWords(this.item, c).map(w => w.h).join(''))); }

  private check(): void {
    const it = this.item;
    if (!it || this.solved || this.placed.some(c => c === null)) return;
    const { ok, wrong } = checkOrder(it, this.texts());
    if (!ok) {
      this.mistakes++;
      this.ctx.sound.thunk();
      // the pieces in the wrong places shake and hop back out
      for (const i of wrong) {
        const li = this.socketsEl.children[i] as HTMLElement;
        gsap.fromTo(li, { x: -8 }, { x: 0, duration: 0.5, ease: 'elastic.out(1,.3)' });
        setTimeout(() => this.unplace(i), 300);
      }
      $('plugResult').textContent = 'Not quite: the pieces that don’t belong there hopped out.';
      return;
    }
    this.solve();
  }

  private solve(): void {
    const it = this.item!;
    this.solved = true;
    this.root.classList.add('solved');
    this.ctx.progress.review('sentence', it.id, plugGrade(this.mistakes, this.hints));
    this.ctx.sound.chime(this.mistakes + this.hints === 0 ? 5 : 2);
    $('plugResult').textContent = placedText(it, this.texts());
    ($('plugHint') as HTMLButtonElement).disabled = true;
    const placedPieces = [...this.socketsEl.querySelectorAll<HTMLElement>('.piece')];
    gsap.fromTo(placedPieces, { scaleX: 1.15, scaleY: 0.85 }, { scaleX: 1, scaleY: 1, duration: 0.7, stagger: 0.08, ease: 'elastic.out(1,.4)', clearProps: 'transform' });
    this.hear();
    this.nextBtn.hidden = false;
    this.nextBtn.focus({ preventScroll: true });
  }

  /** Hears the sentence; while solved, each piece lights as its words are said. */
  private hear(): void {
    const it = this.item;
    if (!it) return;
    const words = it.chunks.flatMap(c => c.words);
    const s: Sentence = { id: it.id, text: it.text, en: it.en, level: it.level, pattern: '', chunks: [{ role: null, words }], punct: [], py: [...it.py], source: { name: 'Squish' } };
    // word k belongs to the chunk whose words span it
    const chunkOf: number[] = it.chunks.flatMap((c, i) => c.words.map(() => i));
    void this.ctx.voice.saySentence(s, false, k => {
      for (const p of this.socketsEl.querySelectorAll<HTMLElement>('.piece')) p.classList.toggle('lit', k !== null && Number(p.dataset.c) === chunkOf[k]);
    });
  }

  /** A hint: the next socket gets its right piece (a piece in the wrong place goes back first). */
  private hint(): void {
    const it = this.item;
    if (!it || this.solved) return;
    const texts = this.texts();
    const expected = it.chunks.map((_, i) => pieceWords(it, i).map(w => w.h).join(''));
    const i = expected.findIndex((t, k) => texts[k] !== t);
    if (i < 0) return;
    this.hints++;
    if (this.placed[i] !== null) this.unplace(i);
    // the right piece: one with the expected text still in the tray (or elsewhere, moved out)
    const piece = this.pieces.find(p => pieceWords(it, Number(p.dataset.c)).map(w => w.h).join('') === expected[i] && this.socketOf(p) === null)
      ?? this.pieces.find(p => Number(p.dataset.c) === i)!;
    const was = this.socketOf(piece);
    if (was !== null) this.unplace(was);
    this.place(piece, i);
  }
}
