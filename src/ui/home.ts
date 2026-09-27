import { gsap } from 'gsap';
import { LEVELS } from '../content/words';
import type { Progress } from '../game/progress';
import type { ModeId, ModeInfo } from '../modes';
import type { Word } from '../content/words';
import { $ } from './dom';

export interface HomeDeps {
  progress: Progress;
  reduceMotion: boolean;
  modes: readonly ModeInfo[];
  pool(): readonly Word[];
  onEnter(mode: ModeId): void;
  /** The level choice changed. */
  onLevel(): void;
}

/** The home screen: one bubble per mode (pop it to enter), the HSK level choice, and what is due. */
export class Home {
  private readonly el = $('home');
  private readonly levelBtns: HTMLButtonElement[];

  constructor(private readonly d: HomeDeps) {
    const box = this.el.querySelector('.modes')!;
    box.replaceChildren(...d.modes.map(m => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `mode m-${m.id}`;
      b.dataset.mode = m.id;
      b.append(Object.assign(document.createElement('span'), { className: 'mode-name', textContent: m.name }),
        Object.assign(document.createElement('span'), { className: 'mode-desc', textContent: m.desc }));
      if (m.make) b.addEventListener('click', () => d.onEnter(m.id));
      else {
        b.disabled = true;
        b.setAttribute('aria-disabled', 'true');
        b.append(Object.assign(document.createElement('span'), { className: 'soon', textContent: 'Soon' }));
      }
      return b;
    }));
    this.levelBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-level]')];
    this.levelBtns.forEach(b => b.addEventListener('click', () => { d.progress.setMaxLevel(Number(b.dataset.level)); this.render(); d.onLevel(); }));
  }

  get shown(): boolean { return !this.el.hidden; }

  render(): void {
    const { progress } = this.d;
    const max = progress.data.settings.maxLevel;
    this.levelBtns.forEach(b => {
      const lv = Number(b.dataset.level);
      b.hidden = !LEVELS.includes(lv);
      b.setAttribute('aria-checked', String(lv === max));
    });
    const p = this.d.pool(), due = progress.dueCount('words', p), fresh = progress.newCount('words', p);
    $('homeStats').textContent = due
      ? `${due} ${due === 1 ? 'word is' : 'words are'} due for review, and ${fresh} new ${fresh === 1 ? 'word waits' : 'words wait'}.`
      : fresh ? `Nothing due right now. ${fresh} new ${fresh === 1 ? 'word' : 'words'} to meet up to HSK ${max}.`
      : `You have met every word up to HSK ${max}. Reviews will come as they fall due.`;
  }

  show(): void {
    document.body.classList.add('at-home');
    this.el.hidden = false;
    this.render();
    gsap.fromTo(this.el.querySelectorAll('.mode'), { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: this.d.reduceMotion ? 0.1 : 0.9, stagger: 0.07, ease: 'elastic.out(1,.45)' });
    this.el.querySelector<HTMLButtonElement>('.mode:not([disabled])')?.focus({ preventScroll: true });
    $('title').textContent = 'Squish: pop bubbles to learn Chinese';
  }

  /** Pops the chosen mode's bubble and fades the screen out; `then` runs once it has gone. */
  leave(mode: ModeId, then: () => void): void {
    const btn = this.el.querySelector<HTMLElement>(`[data-mode="${mode}"]`);
    gsap.to(btn, { scale: 1.35, opacity: 0, duration: 0.22, ease: 'power2.out' });
    gsap.to(this.el, { opacity: 0, duration: 0.3, delay: 0.1, onComplete: () => {
      this.el.hidden = true;
      gsap.set(this.el, { opacity: 1 });
      document.body.classList.remove('at-home');
      then();
    } });
  }
}
