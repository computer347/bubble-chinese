import { gsap } from 'gsap';
import { $ } from './dom';

/** The typed-answer field that replaces the four chips on a dictation layer. */
export class Dictation {
  private readonly form = $('dictation') as HTMLFormElement;
  private readonly input = $('dictIn') as HTMLInputElement;

  constructor(private readonly reduceMotion: boolean, onSubmit: (text: string) => void) {
    this.form.addEventListener('submit', e => {
      e.preventDefault();
      if (this.input.value.trim()) onSubmit(this.input.value);
    });
  }

  get shown(): boolean { return !this.form.hidden; }

  show(): void {
    this.input.value = '';
    this.input.placeholder = 'ni3 hao3 or nǐ hǎo';
    this.form.hidden = false;
    gsap.fromTo(this.form, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: this.reduceMotion ? 0.1 : 0.4, ease: 'back.out(2)' });
    this.input.focus({ preventScroll: true });
  }

  hide(): void { this.form.hidden = true; }

  /** A miss: the field shakes and the text is selected, ready to retype. */
  shake(): void {
    gsap.fromTo(this.form, { x: 0 }, { keyframes: { x: [-12, 12, -8, 8, -3, 0] }, duration: 0.45, ease: 'none' });
    this.input.select();
  }

  /** "I forgot": the answer is shown as the placeholder, to be typed out. */
  reveal(answer: string): void {
    this.input.value = '';
    this.input.placeholder = answer;
    this.input.focus({ preventScroll: true });
  }
}
