import HanziWriter from 'hanzi-writer';

/** A character's stroke file: its code point, as scripts/copy-strokes.mjs names them ("u4f60.json" for 你). */
export const strokeFile = (ch: string): string => `u${ch.codePointAt(0)!.toString(16)}.json`;

/** The Chinese characters of a string, in order, without repeats. */
export const hanziOf = (s: string): string[] => [...new Set([...s].filter(c => /\p{Script=Han}/u.test(c)))];

export interface StrokeCallbacks {
  /** A stroke drawn right; `left` strokes remain. */
  onStroke?(done: number, total: number): void;
  onMistake?(mistakes: number): void;
  /** The whole character traced, with this many mistakes. */
  onComplete(mistakes: number): void;
}

/**
 * One character to watch and trace, in a practice grid (米字格). The stroke data is loaded from
 * the app's own public/strokes/, not a CDN. Watch plays the stroke order; trace starts the quiz,
 * which hints a stroke after two misses on it.
 */
export class StrokeBox {
  readonly el: HTMLElement;
  private writer: ReturnType<typeof HanziWriter.create> | null = null;

  constructor(ch: string, size: number, colors: { stroke: string; outline: string; drawing: string; highlight: string }) {
    this.el = Object.assign(document.createElement('div'), { className: 'strokebox' });
    this.el.style.width = this.el.style.height = `${size}px`;
    // the practice grid: a border, a cross and the diagonals
    this.el.innerHTML = `<svg class="grid" viewBox="0 0 100 100" aria-hidden="true"><rect x="1" y="1" width="98" height="98"/><path d="M50 1V99M1 50H99M1 1L99 99M99 1L1 99"/></svg>`;
    const target = Object.assign(document.createElement('div'), { className: 'strokes' });
    this.el.append(target);
    const base = import.meta.env.BASE_URL;
    this.writer = HanziWriter.create(target, ch, {
      width: size, height: size, padding: Math.round(size * 0.06),
      showCharacter: false, showOutline: true,
      strokeColor: colors.stroke, outlineColor: colors.outline, drawingColor: colors.drawing, highlightColor: colors.highlight,
      drawingWidth: Math.max(6, Math.round(size / 28)),
      strokeAnimationSpeed: 1.2, delayBetweenStrokes: 180,
      charDataLoader: (char: string, onLoad: (d: unknown) => void, onError: (e?: unknown) => void) => {
        fetch(`${base}strokes/${strokeFile(char)}`).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(onLoad, onError);
      }
    } as Parameters<typeof HanziWriter.create>[2]);
  }

  /** Plays the stroke order, then hides the character again (the outline stays). */
  watch(): Promise<void> {
    return new Promise(resolve => {
      this.writer?.cancelQuiz();
      this.writer?.animateCharacter({ onComplete: () => { this.writer?.hideCharacter({ duration: 300 }); resolve(); } });
    });
  }

  trace(cb: StrokeCallbacks): void {
    let mistakes = 0;
    this.writer?.quiz({
      showHintAfterMisses: 2,
      onCorrectStroke: (d: { strokeNum: number; strokesRemaining: number }) => cb.onStroke?.(d.strokeNum + 1, d.strokeNum + 1 + d.strokesRemaining),
      onMistake: () => cb.onMistake?.(++mistakes),
      onComplete: (d: { totalMistakes: number }) => cb.onComplete(d.totalMistakes)
    });
  }

  destroy(): void { this.writer?.cancelQuiz(); this.writer = null; this.el.remove(); }
}
