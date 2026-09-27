import { gsap } from 'gsap';
import type { Word } from '../content/words';
import { FORTUNES } from '../content/fortunes';
import wordOfDayList from '../content/generated/word-of-day.json';
import type { Voice } from '../audio/voice';
import type { Progress } from '../game/progress';
import { dailyIndex, streakDays, practisedToday } from '../game/daily';
import { LESSONS } from '../content/path';
import type { ModeId, ModeInfo } from '../modes';
import { $ } from './dom';

export interface HomeDeps {
  progress: Progress;
  voice: Voice;
  reduceMotion: boolean;
  modes: readonly ModeInfo[];
  pool(): readonly Word[];
  /** What Today still holds: reviews due now, and new words still allowed today. */
  today(): { due: number; fresh: number };
  onEnter(mode: ModeId): void;
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
 * The home screen: the fortune of the day; Today's bubble with what is left for today; a strip of
 * words (the word of the day, then words due, then words you met most recently), tap to hear; and
 * a carousel of the modes with your progress in each.
 */
export class Home {
  private readonly el = $('home');
  private readonly cards = $('modeCards');
  private readonly dots = $('modeDots');
  private readonly light: () => void;

  constructor(private readonly d: HomeDeps) {
    $('todayBtn').addEventListener('click', () => d.onEnter('today'));
    this.cards.replaceChildren(...d.modes.filter(m => !m.hero).map(m => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'card'; b.dataset.mode = m.id;
      const orb = Object.assign(document.createElement('span'), { className: `mode m-${m.id} mini` });
      orb.setAttribute('aria-hidden', 'true');
      b.append(orb,
        Object.assign(document.createElement('span'), { className: 'card-name', textContent: m.name }),
        Object.assign(document.createElement('span'), { className: 'card-desc', textContent: m.desc }),
        Object.assign(document.createElement('span'), { className: 'card-meta' }));
      if (m.make) b.addEventListener('click', () => d.onEnter(m.id));
      else { b.disabled = true; b.querySelector('.card-meta')!.textContent = 'Soon'; }
      li.append(b);
      return li;
    }));
    // one dot per card; the dot of the card nearest the middle is lit, and the dots hide when all cards fit
    this.dots.replaceChildren(...[...this.cards.children].map(() => document.createElement('i')));
    this.light = () => {
      const box = this.cards.getBoundingClientRect(), mid = box.left + box.width / 2;
      let best = 0, bd = Infinity;
      [...this.cards.children].forEach((c, i) => { const r = c.getBoundingClientRect(), dd = Math.abs(r.left + r.width / 2 - mid); if (dd < bd) { bd = dd; best = i; } });
      [...this.dots.children].forEach((dot, i) => dot.classList.toggle('on', i === best));
      this.dots.hidden = this.cards.scrollWidth <= this.cards.clientWidth + 2;
    };
    this.cards.addEventListener('scroll', () => requestAnimationFrame(this.light), { passive: true });
    window.addEventListener('resize', this.light);
  }

  get shown(): boolean { return !this.el.hidden; }

  render(): void {
    const { progress, pool } = this.d;
    const now = new Date(), words = pool();
    $('fortuneDay').textContent = fortuneOfDay(now);
    $('days').textContent = String(streakDays(progress.log, now));
    $('daysBox').classList.toggle('lit', practisedToday(progress.log, now));

    // Today
    const { due, fresh } = this.d.today();
    const done = !due && !fresh;
    $('homeStats').textContent = done
      ? 'All done for today. Come back tomorrow, or play a mode below.'
      : `${due} ${due === 1 ? 'review' : 'reviews'} due · ${fresh} new ${fresh === 1 ? 'word' : 'words'}`;
    $('todayName').textContent = done ? 'Done' : practisedToday(progress.log, now) ? 'Keep going' : 'Start';
    ($('todayBtn') as HTMLButtonElement).disabled = done;

    this.renderStrip(words, now);

    // progress on each mode's card
    const heard = words.filter(w => this.d.voice.hasClip(w));
    for (const b of this.cards.querySelectorAll<HTMLButtonElement>('.card')) {
      const meta = b.querySelector('.card-meta')!;
      if (b.dataset.mode === 'words') meta.textContent = `${progress.learnedCount('words', words)} of ${words.length} learned`;
      if (b.dataset.mode === 'path') meta.textContent = `${LESSONS.filter(x => progress.data.path.done[x.lesson.id]).length} of ${LESSONS.length} lessons`;
      if (b.dataset.mode === 'listen') meta.textContent = `${progress.learnedCount('listen', heard)} of ${heard.length} heard well`;
    }
    requestAnimationFrame(this.light);
  }

  private renderStrip(words: readonly Word[], now: Date): void {
    const { progress, voice } = this.d;
    const cards = progress.cards('words');
    const due = words.filter(w => cards[w.id] && cards[w.id].due <= now).sort((a, b) => cards[a.id].due.getTime() - cards[b.id].due.getTime());
    const recent = words.filter(w => cards[w.id] && cards[w.id].due > now)
      .sort((a, b) => (cards[b.id].last_review?.getTime() ?? 0) - (cards[a.id].last_review?.getTime() ?? 0));
    const tile = (w: Word, tag: string, cls: string): HTMLLIElement => {
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
    };
    const wotd = wordOfDay(now);
    const shownDue = due.slice(0, 10);
    const items = [tile(wotd, `Word of the day · HSK ${wotd.level}`, 'wotd'),
      ...shownDue.map(w => tile(w, 'Due', 'due')),
      ...recent.slice(0, 12 - shownDue.length).map(w => tile(w, 'Learning', ''))];
    if (items.length === 1) {
      const li = document.createElement('li');
      li.className = 'strip-hint';
      li.textContent = `Words you meet gather here. ${words.length} are waiting.`;
      items.push(li);
    }
    $('wordStrip').replaceChildren(...items);
  }

  show(): void {
    document.body.classList.add('at-home');
    this.el.hidden = false;
    this.el.scrollTop = 0;
    this.render();
    const orbs = this.el.querySelectorAll('.hero-orb, .card .mode');
    gsap.fromTo(orbs, { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: this.d.reduceMotion ? 0.1 : 0.9, stagger: 0.06, ease: 'elastic.out(1,.45)', clearProps: 'transform' });
    $('title').textContent = 'Squish: pop bubbles to learn Chinese';
  }

  /** Pops the chosen mode's bubble and fades the screen out; `then` runs once it has gone. */
  leave(mode: ModeId, then: () => void): void {
    const orb = this.el.querySelector<HTMLElement>(`[data-mode="${mode}"] .mode`);
    gsap.to(orb, { scale: 1.35, opacity: 0, duration: 0.22, ease: 'power2.out' });
    gsap.to(this.el, { opacity: 0, duration: 0.3, delay: 0.1, onComplete: () => {
      this.el.hidden = true;
      gsap.set(this.el, { opacity: 1 });
      if (orb) gsap.set(orb, { clearProps: 'all' });
      document.body.classList.remove('at-home');
      then();
    } });
  }
}
