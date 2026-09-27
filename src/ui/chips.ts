import { gsap } from 'gsap';
import { EDGES, type Edge } from '../bubble/bubble';
import type { Rect } from './fit';

interface Chip { el: HTMLButtonElement; hot: number }

/** The four answer chips on the edges of the screen. */
export class Chips {
  /** Where each chip starts, in normalised screen units; the bubble pops when its skin reaches it. */
  readonly thresholds: Record<Edge, number> = { top: 0.85, bottom: 0.85, left: 0.85, right: 0.85 };
  private readonly chips: Record<Edge, Chip>;

  constructor(private readonly reduceMotion: boolean, onPick: (edge: Edge) => void) {
    this.chips = Object.fromEntries(EDGES.map(edge => {
      const el = document.querySelector<HTMLButtonElement>(`.ans[data-edge="${edge}"]`)!;
      el.addEventListener('click', () => onPick(edge));
      return [edge, { el, hot: -1 }];
    })) as Record<Edge, Chip>;
  }

  el(edge: Edge): HTMLButtonElement { return this.chips[edge].el; }
  private els(): HTMLButtonElement[] { return EDGES.map(e => this.chips[e].el); }

  /** Lights one chip by how far the bubble is stretched toward it (0–1); the others go dark. */
  setHot(edge: Edge | null, h: number): void {
    for (const e of EDGES) {
      const c = this.chips[e], v = e === edge ? h : 0;
      if (Math.abs(v - c.hot) < 0.008) continue;
      c.hot = v;
      c.el.style.setProperty('--hot', v.toFixed(3));
      c.el.classList.toggle('lit', v > 0.55);
    }
  }

  flash(edge: Edge, cls: string, ms: number): void {
    const el = this.chips[edge].el;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  /** The "no" shake on a wrong chip. */
  shake(edge: Edge): void {
    this.flash(edge, 'nope', 700);
    gsap.fromTo(this.chips[edge].el, { '--dx': '0px' }, { keyframes: { '--dx': ['-12px', '12px', '-8px', '8px', '-3px', '0px'] }, duration: 0.45, ease: 'none' });
  }

  /** Puts four options on the edges in the given order (top, right, bottom, left) and returns the answer's edge. */
  set(options: readonly string[], answer: string, zh: boolean): Edge {
    let correct: Edge = 'top';
    EDGES.forEach((edge, k) => {
      const el = this.chips[edge].el;
      el.textContent = options[k];
      el.classList.toggle('zh', zh);
      if (zh) el.setAttribute('lang', 'zh-Hans'); else el.removeAttribute('lang');
      el.setAttribute('aria-label', `Answer: ${options[k]}`);
      if (options[k] === answer) correct = edge;
    });
    this.setHot(null, 0);
    this.measure();
    return correct;
  }

  /** Where each chip starts on screen, which sets how far the bubble must stretch to reach it. */
  measure(): void {
    const W = window.innerWidth, H = window.innerHeight, thr = this.thresholds;
    const clampN = (v: number) => Math.max(0.4, Math.min(0.95, v));
    const t = this.el('top'), b = this.el('bottom'), l = this.el('left'), r = this.el('right');
    thr.top = clampN(1 - 2 * (t.offsetTop + t.offsetHeight) / H);
    thr.bottom = clampN(2 * b.offsetTop / H - 1);
    thr.left = clampN(1 - 2 * (l.offsetLeft + l.offsetWidth) / W);
    thr.right = clampN(2 * r.offsetLeft / W - 1);
  }

  /**
   * Where the chips sit once settled, from layout rather than the current transform (which
   * scales them while they slide in). Top and bottom are centred across, left and right down.
   */
  layoutRects(): Rect[] {
    return EDGES.map(e => {
      const el = this.el(e), w = el.offsetWidth, h = el.offsetHeight;
      const l = el.offsetLeft - (e === 'top' || e === 'bottom' ? w / 2 : 0);
      const t = el.offsetTop - (e === 'left' || e === 'right' ? h / 2 : 0);
      return { l, t, r: l + w, b: t + h };
    });
  }

  in(): void {
    this.els().forEach(el => el.classList.remove('off', 'hint', 'nope', 'yes', 'reveal'));
    gsap.fromTo(this.els(), { opacity: 0, '--in': 0.4 }, { opacity: 1, '--in': 1, duration: this.reduceMotion ? 0.15 : 0.55, stagger: 0.05, ease: 'back.out(2.2)' });
  }

  out(): void {
    this.els().forEach(el => el.classList.add('off'));
    gsap.to(this.els(), { opacity: 0, '--in': 0.6, duration: 0.25, ease: 'power2.in' });
  }
}
