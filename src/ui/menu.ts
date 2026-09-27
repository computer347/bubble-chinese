import { LEVELS } from '../content/words';
import type { Progress } from '../game/progress';
import type { AskKind } from '../game/questions';
import type { StyleId } from '../theme/themes';
import { $ } from './dom';

export interface SettingsDeps {
  progress: Progress;
  /** A study setting changed (level, what is asked, new words a day). */
  onStudy(): void;
  onStyle(style: StyleId): void;
}

/**
 * The settings in the You tab: level, what is asked, new words a day and style. The sound,
 * wobble and detail controls next to them are wired by the game.
 */
export class Settings {
  private readonly el = $('tab-you');
  private readonly levelBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-level]')];
  private readonly askBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-ask]')];
  private readonly newBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-new]')];
  private readonly styleBtns = [...this.el.querySelectorAll<HTMLButtonElement>('[data-style]')];

  constructor(private readonly d: SettingsDeps) {
    const { progress } = d;
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

  render(): void {
    const s = this.d.progress.data.settings;
    this.levelBtns.forEach(b => { const lv = Number(b.dataset.level); b.hidden = !LEVELS.includes(lv); b.setAttribute('aria-checked', String(lv === s.maxLevel)); });
    this.askBtns.forEach(b => { const on = s.ask.includes(b.dataset.ask as AskKind); b.setAttribute('aria-pressed', String(on)); b.disabled = on && s.ask.length === 1; });
    this.newBtns.forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.new) === s.newPerDay)));
    this.styleBtns.forEach(b => b.setAttribute('aria-checked', String(b.dataset.style === s.style)));
  }
}
