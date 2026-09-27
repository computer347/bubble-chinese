import { describe, it, expect } from 'vitest';
import { QUIZ_WORDS } from '../../src/content/words';
import { Scheduler, Bag } from '../../src/game/scheduler';
import { newCard, review, Rating, type Card } from '../../src/game/memory';
import { mulberry32 } from '../../src/game/random';

const now = new Date('2026-09-26T12:00:00Z');
const pool = QUIZ_WORDS.filter(w => w.level <= 2);

describe('Scheduler', () => {
  it('starts with new words from HSK 1 before HSK 2', () => {
    const s = new Scheduler(6, mulberry32(1));
    const cards: Record<string, Card> = {};
    for (let i = 0; i < 40; i++) {
      const w = s.next(pool, cards, now);
      expect(w.level).toBe(1);
      cards[w.id] = review(newCard(now), Rating.Good, now);   // due again in minutes, not now
    }
  });

  it('puts due reviews ahead of new words, most overdue first', () => {
    const s = new Scheduler(6, mulberry32(2));
    const cards: Record<string, Card> = {};
    const [a, b, c] = pool;
    cards[a.id] = { ...newCard(now), due: new Date(now.getTime() - 3 * 86_400_000) };
    cards[b.id] = { ...newCard(now), due: new Date(now.getTime() - 86_400_000) };
    cards[c.id] = { ...newCard(now), due: new Date(now.getTime() + 86_400_000) };
    const first = [s.next(pool, cards, now), s.next(pool, cards, now)].map(w => w.id);
    expect(first.sort()).toEqual([a.id, b.id].sort());
  });

  it('never repeats a word within the recent window', () => {
    const s = new Scheduler(6, mulberry32(5));
    const cards: Record<string, Card> = {};
    const picks = Array.from({ length: 100 }, () => s.next(pool, cards, now).id);
    for (let i = 0; i < picks.length; i++) expect(picks.slice(Math.max(0, i - 6), i)).not.toContain(picks[i]);
  });

  it('reviews ahead once every word has been met and nothing is due', () => {
    const s = new Scheduler(0, mulberry32(3));
    const cards: Record<string, Card> = {};
    const small = pool.slice(0, 5);
    small.forEach((w, i) => { cards[w.id] = { ...newCard(now), due: new Date(now.getTime() + (i + 1) * 3_600_000) }; });
    expect(s.next(small, cards, now).id).toBe(small[0].id);
  });
});

describe('Scheduler preference', () => {
  it('prefers the new items scored highest, within the lowest level', () => {
    const s = new Scheduler(6, mulberry32(4));
    const cards: Record<string, Card> = {};
    const third = (w: { p: string }) => (/[ǎěǐǒǔǚ]/.test(w.p) ? 1 : 0);
    for (let i = 0; i < 20; i++) {
      const w = s.next(pool, cards, now, third);
      expect(w.level).toBe(1);
      expect(third(w)).toBe(1);
      cards[w.id] = review(newCard(now), Rating.Good, now);
    }
  });
});

describe('Bag', () => {
  it('draws everything once before repeating', () => {
    const bag = new Bag([1, 2, 3, 4, 5], mulberry32(2));
    expect(Array.from({ length: 5 }, () => bag.next()).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
