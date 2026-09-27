import { gsap } from 'gsap';
import { WORDS, type Word } from '../content/words';
import type { Voice } from '../audio/voice';
import type { Progress } from '../game/progress';
import { masteryDots, dueLabel } from '../game/memory';
import { toneAccuracy } from '../game/listening';
import { $ } from './dom';

export interface DrawerDeps {
  progress: Progress;
  voice: Voice;
  reduceMotion: boolean;
  /** Quiz words up to the chosen level. */
  pool(): readonly Word[];
}

const byId = new Map(WORDS.map(w => [w.id, w]));
const ORDINAL = ['', '1st', '2nd', '3rd', '4th'];

/** "Tones heard right: 1st 90%, 3rd 62%" from the Listen tone layers, or '' before any. */
export function toneLine(stats: ReturnType<typeof toneAccuracy>): string {
  const parts = ([1, 2, 3, 4] as const).filter(t => stats[t].total).map(t => `${ORDINAL[t]} ${Math.round(100 * stats[t].right / stats[t].total)}%`);
  return parts.length ? ` Tones heard right: ${parts.join(', ')}.` : '';
}

/** "Your words": every word you have met, with its mastery and next review. Also holds the slow-voice toggle. */
export class Drawer {
  /** Whether taps on words play the slow voice. */
  slow = false;
  private readonly el = $('drawer');

  constructor(private readonly d: DrawerDeps) {
    const toggle = $('slowToggle');
    toggle.addEventListener('click', () => {
      this.slow = !this.slow;
      toggle.setAttribute('aria-pressed', String(this.slow));
      toggle.textContent = this.slow ? 'Slow voice on' : 'Slow voice';
    });
    $('wordsBtn').addEventListener('click', () => this.show());
    $('drawerClose').addEventListener('click', () => this.close());
  }

  get open(): boolean { return !this.el.hidden; }

  show(): void {
    const { progress, voice, pool } = this.d;
    const now = new Date(), words = pool(), cards = progress.cards('words');
    const met = words.filter(w => cards[w.id])
      .sort((x, y) => (cards[y.id].last_review?.getTime() ?? 0) - (cards[x.id].last_review?.getTime() ?? 0));
    $('drawerSub').textContent = `${progress.learnedCount('words', words)} learned, ${met.length} met, ${progress.dueCount('words', words)} due. ${words.length} words up to HSK ${progress.data.settings.maxLevel}. Best streak ${progress.data.best}.${toneLine(toneAccuracy(progress.log, byId))}`;
    const list = $('wordsList');
    list.replaceChildren();
    if (!met.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Pop your first bubble and its word will land here. Tap a word to hear it.';
      list.appendChild(li);
    }
    for (const w of met) {
      const li = document.createElement('li'), b = document.createElement('button'), card = cards[w.id], lv = masteryDots(card);
      b.type = 'button';
      const h = Object.assign(document.createElement('span'), { className: 'h', textContent: w.h });
      h.lang = 'zh-Hans';
      const pEl = Object.assign(document.createElement('span'), { className: 'p', textContent: w.p });
      const e = Object.assign(document.createElement('span'), { className: 'e', textContent: w.e });
      const dots = Object.assign(document.createElement('span'), { className: 'lv' });
      dots.setAttribute('aria-label', `Mastery ${lv} of 3`);
      for (let i = 0; i < 3; i++) dots.appendChild(Object.assign(document.createElement('i'), { className: lv > i ? 'on' : '' }));
      const due = Object.assign(document.createElement('span'), { className: 'due', textContent: dueLabel(card, now) });
      b.append(h, pEl, e, dots, due);
      b.addEventListener('click', () => voice.say(w, this.slow));
      li.appendChild(b); list.appendChild(li);
    }
    this.el.hidden = false;
    gsap.fromTo(this.el, { xPercent: 100 }, { xPercent: 0, duration: this.d.reduceMotion ? 0.01 : 0.45, ease: 'power3.out', overwrite: true });
    $('drawerClose').focus({ preventScroll: true });
  }

  close(): void {
    gsap.to(this.el, { xPercent: 100, duration: this.d.reduceMotion ? 0.01 : 0.3, ease: 'power2.in', overwrite: true, onComplete: () => { this.el.hidden = true; } });
    $('wordsBtn').focus({ preventScroll: true });
  }
}
