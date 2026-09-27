import { gsap } from 'gsap';
import { LEVELS } from '../content/words';
import type { Progress } from '../game/progress';
import type { AskKind } from '../game/questions';
import type { StyleId } from '../theme/themes';
import { $ } from './dom';

export interface MenuDeps {
  progress: Progress;
  reduceMotion: boolean;
  /** A study setting changed (level, what is asked, new words a day). */
  onStudy(): void;
  onStyle(style: StyleId): void;
}

/**
 * The ☰ menu: a sheet that slides in from the side, on the home screen and in play. It holds every
 * setting (level, what is asked, new words a day, style, wobble, detail, sound) and the way to
 * "Your words". The sound, wobble and detail controls are wired by the game.
 */
export class Menu {
  private readonly el = $('menu');
  private readonly scrim = $('scrim');
  private readonly btn = $('menuBtn');
  private readonly levelBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-level]')];
  private readonly askBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-ask]')];
  private readonly newBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-new]')];
  private readonly styleBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-style]')];

  constructor(private readonly d: MenuDeps) {
    const { progress } = d;
    this.btn.addEventListener('click', () => (this.open ? this.close() : this.show()));
    $('menuClose').addEventListener('click', () => this.close());
    this.scrim.addEventListener('click', () => this.close());
    // "Your words" opens the drawer (bound in Drawer); the menu steps aside for it
    $('wordsBtn').addEventListener('click', () => this.close(false));
    this.levelBtns.forEach(b => b.addEventListener('click', () => { progress.setMaxLevel(Number(b.dataset.level)); this.render(); d.onStudy(); }));
    // toggles; the last one left on can't be turned off, since a bubble must ask something
    this.askBtns.forEach(b => b.addEventListener('click', () => {
      const kind = b.dataset.ask as AskKind, ask = progress.data.settings.ask;
      progress.setAsk(ask.includes(kind) ? ask.filter(k => k !== kind) : [...ask, kind]);
      this.render(); d.onStudy();
    }));
    this.newBtns.forEach(b => b.addEventListener('click', () => { progress.setNewPerDay(Number(b.dataset.new)); this.render(); d.onStudy(); }));
    this.styleBtns.forEach(b => b.addEventListener('click', () => {
      const style = b.dataset.style as StyleId;
      if (style === progress.data.settings.style) return;
      progress.setStyle(style);
      this.render();
      d.onStyle(style);
    }));
    this.render();
  }

  /** Open, and not already on its way out. */
  get open(): boolean { return !this.el.hidden && !this.closing; }
  private closing = false;

  render(): void {
    const s = this.d.progress.data.settings;
    this.levelBtns.forEach(b => { const lv = Number(b.dataset.level); b.hidden = !LEVELS.includes(lv); b.setAttribute('aria-checked', String(lv === s.maxLevel)); });
    this.askBtns.forEach(b => { const on = s.ask.includes(b.dataset.ask as AskKind); b.setAttribute('aria-pressed', String(on)); b.disabled = on && s.ask.length === 1; });
    this.newBtns.forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.new) === s.newPerDay)));
    this.styleBtns.forEach(b => b.setAttribute('aria-checked', String(b.dataset.style === s.style)));
  }

  show(): void {
    this.render();
    this.closing = false;
    this.el.hidden = false; this.scrim.hidden = false;
    this.scrim.style.pointerEvents = '';
    this.btn.setAttribute('aria-expanded', 'true');
    gsap.fromTo(this.el, { xPercent: -100 }, { xPercent: 0, duration: this.d.reduceMotion ? 0.01 : 0.35, ease: 'power3.out', overwrite: true });
    gsap.fromTo(this.scrim, { opacity: 0 }, { opacity: 1, duration: 0.25 });
    $('menuClose').focus({ preventScroll: true });
  }

  /** Slides the menu away; `refocus` returns focus to the ☰ button. */
  close(refocus = true): void {
    if (!this.open) return;
    this.closing = true;
    this.btn.setAttribute('aria-expanded', 'false');
    // the fading backdrop must not swallow a tap made straight after closing
    this.scrim.style.pointerEvents = 'none';
    gsap.to(this.scrim, { opacity: 0, duration: 0.2, onComplete: () => { this.scrim.hidden = true; } });
    gsap.to(this.el, { xPercent: -100, duration: this.d.reduceMotion ? 0.01 : 0.25, ease: 'power2.in', overwrite: true, onComplete: () => { this.el.hidden = true; this.closing = false; } });
    if (refocus) this.btn.focus({ preventScroll: true });
  }
}
