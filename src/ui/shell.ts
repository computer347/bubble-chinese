import { gsap } from 'gsap';
import type { Word } from '../content/words';
import { FORTUNES } from '../content/fortunes';
import wordOfDayList from '../content/generated/word-of-day.json';
import { LESSONS } from '../content/path';
import type { Voice } from '../audio/voice';
import type { Progress } from '../game/progress';
import { dailyIndex, streakDays, practisedToday } from '../game/daily';
import type { ModeId, ModeInfo } from '../modes';
import { PathView } from './pathview';
import type { Unit } from '../content/path';
import { $ } from './dom';

export type Tab = 'path' | 'practice' | 'read' | 'you';
export const TABS: readonly Tab[] = ['path', 'practice', 'read', 'you'];

/** What a tile or path stop starts: a mode, with what it should open. */
export type StartArg = { kind: 'lesson' | 'write'; index: number } | { kind: 'note'; unit: Unit };

export interface ShellDeps {
  progress: Progress;
  voice: Voice;
  reduceMotion: boolean;
  modes: readonly ModeInfo[];
  pool(): readonly Word[];
  /** What Today still holds: reviews due now, and new words still allowed today. */
  today(): { due: number; fresh: number };
  /** Starts a mode from the element that was tapped (its orb zooms into the task). */
  onEnter(mode: ModeId, from: HTMLElement | null, arg?: StartArg): void;
  /** A tab was opened (so the words list and stats can be drawn fresh). */
  onTab(tab: Tab): void;
}

interface DayWord { h: string; p: string; pn: string; e: string; level: number }
const DAY_WORDS = wordOfDayList as DayWord[];

/**
 * The word of the day: a word from the level above what the app teaches. Today it comes from the
 * HSK 3 list with CC-CEDICT meanings; swap this function for a fetched source later.
 */
export function wordOfDay(now = new Date()): Word {
  const d = DAY_WORDS[dailyIndex(now, DAY_WORDS.length, 'word')];
  return { id: `${d.h}|${d.p}`, h: d.h, p: d.p, pn: d.pn, e: d.e, level: d.level, pos: [] };
}

/** The fortune of the day, the same all day. */
export const fortuneOfDay = (now = new Date()): string => FORTUNES[dailyIndex(now, FORTUNES.length, 'fortune')];

/**
 * The app's shell: four tabs under a floating tab bar.
 * Path: the fortune of the day, Today's bubble, and the path of lessons.
 * Practice: a tile for each mode. Read: the word of the day (stories to come).
 * You: stats, your words and every setting (drawn by their own components).
 */
export class Shell {
  tab: Tab = 'path';
  private readonly el = $('home');
  private readonly bar = $('tabbar');
  private readonly cards = $('modeCards');
  private readonly pathView: PathView;

  constructor(private readonly d: ShellDeps) {
    $('todayBtn').addEventListener('click', e => d.onEnter('today', e.currentTarget as HTMLElement));
    this.pathView = new PathView({
      reduceMotion: d.reduceMotion,
      done: () => d.progress.data.path.done,
      onLesson: (i, el) => d.onEnter('path', el, { kind: 'lesson', index: i }),
      onNote: (u, el) => d.onEnter('path', el, { kind: 'note', unit: u }),
      onWrite: (i, el) => d.onEnter('path', el, { kind: 'write', index: i })
    });
    this.cards.replaceChildren(...d.modes.filter(m => !m.hero && m.id !== 'path').map(m => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'card'; b.dataset.mode = m.id;
      const orb = Object.assign(document.createElement('span'), { className: `mode m-${m.id} mini` });
      orb.setAttribute('aria-hidden', 'true');
      if (m.glyph) orb.append(Object.assign(document.createElement('span'), { className: 'orb-glyph', textContent: m.glyph, lang: 'zh-Hans' }));
      b.append(orb,
        Object.assign(document.createElement('span'), { className: 'card-name', textContent: m.name }),
        Object.assign(document.createElement('span'), { className: 'card-desc', textContent: m.desc }),
        Object.assign(document.createElement('span'), { className: 'card-meta' }));
      if (m.make) b.addEventListener('click', () => d.onEnter(m.id, b));
      else { b.disabled = true; b.querySelector('.card-meta')!.textContent = 'Soon'; }
      li.append(b);
      return li;
    }));
    this.bar.querySelectorAll<HTMLButtonElement>('.tabbtn').forEach(b => b.addEventListener('click', () => this.open(b.dataset.tab as Tab)));
  }

  get shown(): boolean { return !this.el.hidden; }

  /** Switches tab: the glass droplet slides across, the new tab's content settles in. */
  open(tab: Tab, instant = false): void {
    const changed = tab !== this.tab;
    this.tab = tab;
    for (const t of TABS) ($(`tab-${t}`)).hidden = t !== tab;
    this.bar.querySelectorAll<HTMLButtonElement>('.tabbtn').forEach(b => {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    this.placeDrop(instant || !changed);
    this.render();
    this.d.onTab(tab);
    if (changed && !instant) {
      this.el.scrollTop = 0;
      gsap.fromTo($(`tab-${tab}`), { opacity: 0, y: 14, scale: 0.985 }, { opacity: 1, y: 0, scale: 1, duration: this.d.reduceMotion ? 0.05 : 0.38, ease: 'power3.out', clearProps: 'transform' });
    }
  }

  /** The droplet sits under the current tab's button. */
  private placeDrop(instant: boolean): void {
    const btn = this.bar.querySelector<HTMLElement>(`.tabbtn[data-tab="${this.tab}"]`);
    const drop = this.bar.querySelector<HTMLElement>('.tab-drop');
    if (!btn || !drop) return;
    const x = btn.offsetLeft, w = btn.offsetWidth;
    if (instant) gsap.set(drop, { x, width: w });
    else gsap.to(drop, { x, width: w, duration: this.d.reduceMotion ? 0.05 : 0.5, ease: 'elastic.out(1,.75)' });
  }

  render(): void {
    const { progress, pool } = this.d;
    const now = new Date(), words = pool();
    $('days').textContent = String(streakDays(progress.log, now));
    $('daysBox').classList.toggle('lit', practisedToday(progress.log, now));
    if (this.tab === 'path') {
      $('fortuneDay').textContent = fortuneOfDay(now);
      const { due, fresh } = this.d.today();
      const done = !due && !fresh;
      $('homeStats').textContent = done
        ? 'All done for today. Come back tomorrow, or take the next lesson below.'
        : `${due} ${due === 1 ? 'review' : 'reviews'} due · ${fresh} new ${fresh === 1 ? 'word' : 'words'}`;
      $('todayName').textContent = done ? 'Done' : practisedToday(progress.log, now) ? 'Keep going' : 'Start';
      ($('todayBtn') as HTMLButtonElement).disabled = done;
      this.pathView.render();
    }
    if (this.tab === 'practice') {
      const heard = words.filter(w => this.d.voice.hasClip(w));
      for (const b of this.cards.querySelectorAll<HTMLButtonElement>('.card')) {
        const meta = b.querySelector('.card-meta')!;
        if (b.dataset.mode === 'words') meta.textContent = `${progress.learnedCount('words', words)} of ${words.length} learned`;
        if (b.dataset.mode === 'listen') meta.textContent = `${progress.learnedCount('listen', heard)} of ${heard.length} heard well`;
        if (b.dataset.mode === 'write') {
          const done = LESSONS.filter(x => progress.data.path.done[x.lesson.id]).length;
          b.disabled = done === 0;
          meta.textContent = done ? `Characters from ${done} ${done === 1 ? 'lesson' : 'lessons'}` : 'Finish a lesson first';
        }
      }
    }
    if (this.tab === 'read') $('wotdStrip').replaceChildren(wordTile(wordOfDay(now), `Word of the day · HSK ${wordOfDay(now).level}`, 'wotd', this.d.voice));
    if (this.tab === 'you') this.renderStrip(words, now);
  }

  private renderStrip(words: readonly Word[], now: Date): void {
    const { progress, voice } = this.d;
    const cards = progress.cards('words');
    const due = words.filter(w => cards[w.id] && cards[w.id].due <= now).sort((a, b) => cards[a.id].due.getTime() - cards[b.id].due.getTime());
    const recent = words.filter(w => cards[w.id] && cards[w.id].due > now)
      .sort((a, b) => (cards[b.id].last_review?.getTime() ?? 0) - (cards[a.id].last_review?.getTime() ?? 0));
    const shownDue = due.slice(0, 10);
    const items = [...shownDue.map(w => wordTile(w, 'Due', 'due', voice)), ...recent.slice(0, 12 - shownDue.length).map(w => wordTile(w, 'Learning', '', voice))];
    // with nothing met yet the list below says so; the strip stays out of the way
    $('wordStrip').hidden = !items.length;
    $('wordStrip').replaceChildren(...items);
  }

  show(tab: Tab = this.tab): void {
    document.body.classList.add('at-home');
    this.el.hidden = false;
    this.bar.hidden = false;
    gsap.fromTo(this.bar, { y: 90, opacity: 0 }, { y: 0, opacity: 1, duration: this.d.reduceMotion ? 0.05 : 0.5, ease: 'back.out(1.6)' });
    this.open(tab, true);
    const orbs = this.el.querySelectorAll(`#tab-${tab} .hero-orb, #tab-${tab} .card .mode, #tab-${tab} .stop .mode`);
    gsap.fromTo(orbs, { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: this.d.reduceMotion ? 0.1 : 0.9, stagger: 0.04, ease: 'elastic.out(1,.45)', clearProps: 'transform' });
    $('title').textContent = 'Squish: pop bubbles to learn Chinese';
  }

  /**
   * Leaves for a task: the tapped element's orb zooms up and a circle of its colour fills the
   * screen from it, the shell fades beneath; `then` runs once the screen is covered.
   */
  leave(from: HTMLElement | null, then: () => void): void {
    const orb = from?.querySelector<HTMLElement>('.mode') ?? from;
    const fill = zoomFill(orb, this.d.reduceMotion);
    gsap.to(this.bar, { y: 90, opacity: 0, duration: 0.25, ease: 'power2.in', onComplete: () => { this.bar.hidden = true; } });
    if (orb) gsap.to(orb, { scale: 1.5, duration: 0.35, ease: 'power2.in' });
    gsap.to(this.el, { opacity: 0, duration: 0.3, delay: 0.12, onComplete: () => {
      this.el.hidden = true;
      gsap.set(this.el, { opacity: 1 });
      if (orb) gsap.set(orb, { clearProps: 'transform' });
      document.body.classList.remove('at-home');
      then();
      fill();
    } });
  }
}

/**
 * The zoom-fill: a disc of the orb's colour grows from its centre to cover the screen, then
 * melts away once the task has taken over. Returns the function that melts it.
 */
function zoomFill(from: HTMLElement | null, reduceMotion: boolean): () => void {
  if (!from || reduceMotion) return () => {};
  const r = from.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const cs = getComputedStyle(from);
  const colour = cs.getPropertyValue('--c2').trim() || cs.backgroundColor || 'rgba(255,255,255,.4)';
  const reach = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));
  const disc = Object.assign(document.createElement('div'), { className: 'zoomfill' });
  disc.style.background = `radial-gradient(circle at ${cx}px ${cy}px, ${colour} 0, color-mix(in srgb, ${colour} 70%, var(--bg)) 70%)`;
  document.body.append(disc);
  gsap.fromTo(disc, { clipPath: `circle(${r.width / 2}px at ${cx}px ${cy}px)` }, { clipPath: `circle(${reach}px at ${cx}px ${cy}px)`, duration: 0.42, ease: 'power3.in' });
  return () => gsap.to(disc, { opacity: 0, duration: 0.45, delay: 0.05, ease: 'power2.out', onComplete: () => disc.remove() });
}

function wordTile(w: Word, tag: string, cls: string, voice: Voice): HTMLLIElement {
  const li = document.createElement('li'), b = document.createElement('button');
  b.type = 'button'; b.className = `wcard ${cls}`.trim();
  b.setAttribute('aria-label', `${tag}: ${w.h}, ${w.p}, ${w.e}. Tap to hear it.`);
  const h = Object.assign(document.createElement('span'), { className: 'h', textContent: w.h });
  h.lang = 'zh-Hans';
  b.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: tag }), h,
    Object.assign(document.createElement('span'), { className: 'p', textContent: w.p }),
    Object.assign(document.createElement('span'), { className: 'e', textContent: w.e }));
  b.addEventListener('click', () => voice.say(w));
  li.append(b);
  return li;
}
