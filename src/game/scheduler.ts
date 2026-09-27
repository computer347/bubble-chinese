import type { Card } from './memory';
import type { Item } from './progress';
import { type Rng, defaultRng, shuffle } from './random';

/** Something the scheduler can pick: a word, a syllable, a sentence. */
export interface Schedulable extends Item { readonly level: number }

/**
 * Chooses the next item for one skill, given that skill's cards:
 * 1. an item that is due for review (the most overdue first, lightly shuffled),
 * 2. otherwise a new item from the lowest level with items left (the ones `prefer` scores highest first),
 * 3. otherwise the item due soonest (reviewing ahead).
 * The last few items never come back to back.
 */
export class Scheduler {
  private recent: string[] = [];
  constructor(private readonly recentSize = 6, private readonly rng: Rng = defaultRng) {}

  next<T extends Schedulable>(pool: readonly T[], cards: Readonly<Record<string, Card>>, now = new Date(), prefer?: (item: T) => number): T {
    const fresh = pool.filter(w => !this.recent.includes(w.id));
    const candidates = fresh.length ? fresh : pool;
    const due = candidates
      .filter(w => cards[w.id] && cards[w.id].due <= now)
      .sort((a, b) => cards[a.id].due.getTime() - cards[b.id].due.getTime());
    let pick: T | undefined;
    if (due.length) {
      pick = due[Math.floor(this.rng() * Math.min(3, due.length))];
    } else {
      const unseen = candidates.filter(w => !cards[w.id]);
      if (unseen.length) {
        const lowest = Math.min(...unseen.map(w => w.level));
        let level = shuffle(unseen.filter(w => w.level === lowest), this.rng);
        if (prefer) { const best = Math.max(...level.map(prefer)); level = level.filter(w => prefer(w) === best); }
        pick = level[0];
      } else {
        pick = candidates.slice().sort((a, b) => cards[a.id].due.getTime() - cards[b.id].due.getTime())[0];
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
