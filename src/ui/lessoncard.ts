import { gsap } from 'gsap';
import { $ } from './dom';

/** What ended a card: its button, or leaving the lesson. */
export type CardResult = 'next' | 'quit';

export interface CardContent {
  /** "Meet · 3 of 10". */
  step: string;
  /** How far through the lesson, 0–1. */
  progress: number;
  body: Node[];
  /** The button's text; "Next" by default. */
  next?: string;
  /** Starts with the button disabled (a question to answer first); enable() turns it on. */
  locked?: boolean;
}

/**
 * The lesson's paper card: a step label, a progress bar, whatever the step shows, and one button.
 * show() resolves when the button is pressed, or with 'quit' when the lesson is left.
 */
export class LessonCard {
  private readonly el = $('lesson');
  private readonly card = $('lcard');
  private readonly nextBtn = $('lNext') as HTMLButtonElement;
  private resolve: ((r: CardResult) => void) | null = null;

  constructor(private readonly reduceMotion: boolean) {
    this.nextBtn.addEventListener('click', () => this.settle('next'));
    $('lQuit').addEventListener('click', () => this.settle('quit'));
  }

  get shown(): boolean { return !this.el.hidden; }

  show(c: CardContent): Promise<CardResult> {
    this.settle('quit');                                  // a card left waiting is abandoned
    $('lStep').textContent = c.step;
    ($('lBar') as HTMLElement).style.width = `${Math.round(Math.max(0, Math.min(1, c.progress)) * 100)}%`;
    $('lBody').replaceChildren(...c.body);
    this.nextBtn.textContent = c.next ?? 'Next';
    this.nextBtn.disabled = !!c.locked;
    const wasHidden = this.el.hidden;
    this.el.hidden = false;
    this.card.scrollTop = 0;
    if (wasHidden) gsap.fromTo(this.card, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: this.reduceMotion ? 0.1 : 0.4, ease: 'power3.out' });
    else gsap.fromTo($('lBody'), { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: this.reduceMotion ? 0.05 : 0.25, ease: 'power2.out' });
    if (!c.locked) this.nextBtn.focus({ preventScroll: true });
    return new Promise(r => { this.resolve = r; });
  }

  /** Allows moving on (after a question is answered). */
  enable(label?: string): void {
    this.nextBtn.disabled = false;
    if (label) this.nextBtn.textContent = label;
    this.nextBtn.focus({ preventScroll: true });
  }

  hide(): void { this.el.hidden = true; }

  private settle(r: CardResult): void {
    const f = this.resolve;
    this.resolve = null;
    f?.(r);
  }
}
