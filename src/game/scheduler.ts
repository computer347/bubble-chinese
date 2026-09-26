import type { Word } from '../content/words';
import type { ProgressData } from './progress';
import { type Rng, defaultRng, shuffle } from './random';

/**
 * Chooses the next word. A light spaced-repetition weighting until Phase 1 brings FSRS:
 * new words come up often, missed words more often, mastered words rarely,
 * and the last few words never repeat back to back.
 */
export class WordScheduler {
  private recent: string[] = [];
  constructor(private readonly bank: readonly Word[], private readonly recentSize = 10, private readonly rng: Rng = defaultRng) {}

  weight(w: Word, data: ProgressData): number {
    if (this.recent.includes(w.h)) return 0;
    const lv = data.m[w.h] ?? 0;
    let wt = !data.seen[w.h] ? 2.2 : [3, 1.5, 0.7, 0.25][lv];
    const miss = data.miss[w.h] ?? 0;
    if (miss && lv < 2) wt += Math.min(3, miss) * 0.8;
    return wt;
  }

  next(data: ProgressData): Word {
    const wts = this.bank.map(w => this.weight(w, data));
    const total = wts.reduce((a, b) => a + b, 0);
    let r = this.rng() * total;
    let pick = this.bank[Math.floor(this.rng() * this.bank.length)];
    for (let i = 0; i < this.bank.length; i++) {
      r -= wts[i];
      if (r <= 0 && wts[i] > 0) { pick = this.bank[i]; break; }
    }
    this.recent.push(pick.h);
    if (this.recent.length > this.recentSize) this.recent.shift();
    return pick;
  }
}

/** Draws items in random order without repeats until everything has been drawn once. */
export class Bag<T> {
  private order: number[] = [];
  constructor(private readonly items: readonly T[], private readonly rng: Rng = defaultRng) {}
  next(): T {
    if (!this.order.length) this.order = shuffle(this.items.map((_, i) => i), this.rng);
    return this.items[this.order.pop()!];
  }
}
