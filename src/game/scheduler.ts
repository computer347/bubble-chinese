import type { Word } from '../content/words';
import type { ProgressData } from './progress';
import { type Rng, defaultRng, shuffle } from './random';

/**
 * Chooses the next bubble:
 * 1. a word that is due for review (the most overdue first, lightly shuffled),
 * 2. otherwise a new word from the lowest level with words left,
 * 3. otherwise the word due soonest (reviewing ahead).
 * The last few words never come back to back.
 */
export class WordScheduler {
  private recent: string[] = [];
  constructor(private readonly recentSize = 6, private readonly rng: Rng = defaultRng) {}

  next(pool: readonly Word[], data: ProgressData, now = new Date()): Word {
    const fresh = pool.filter(w => !this.recent.includes(w.id));
    const candidates = fresh.length ? fresh : pool;
    const due = candidates
      .filter(w => data.cards[w.id] && data.cards[w.id].due <= now)
      .sort((a, b) => data.cards[a.id].due.getTime() - data.cards[b.id].due.getTime());
    let pick: Word | undefined;
    if (due.length) {
      pick = due[Math.floor(this.rng() * Math.min(3, due.length))];
    } else {
      const unseen = candidates.filter(w => !data.cards[w.id]);
      if (unseen.length) {
        const lowest = Math.min(...unseen.map(w => w.level));
        pick = shuffle(unseen.filter(w => w.level === lowest), this.rng)[0];
      } else {
        pick = candidates.slice().sort((a, b) => data.cards[a.id].due.getTime() - data.cards[b.id].due.getTime())[0];
      }
    }
    this.recent.push(pick.id);
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
