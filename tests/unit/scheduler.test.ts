import { describe, it, expect } from 'vitest';
import { WORDS } from '../../src/content/words';
import { WordScheduler, Bag } from '../../src/game/scheduler';
import { emptyProgress } from '../../src/game/progress';
import { mulberry32 } from '../../src/game/random';

describe('WordScheduler', () => {
  it('never repeats a word within the recent window', () => {
    const s = new WordScheduler(WORDS, 10, mulberry32(5));
    const data = emptyProgress();
    const picks = Array.from({ length: 300 }, () => s.next(data).h);
    for (let i = 0; i < picks.length; i++) {
      expect(picks.slice(Math.max(0, i - 10), i)).not.toContain(picks[i]);
    }
  });

  it('brings missed words back more often than mastered ones', () => {
    const data = emptyProgress();
    const missed = WORDS[0].h, mastered = WORDS[1].h;
    for (const w of WORDS) { data.seen[w.h] = 1; data.m[w.h] = 2; }
    data.m[missed] = 0; data.miss[missed] = 3;
    data.m[mastered] = 3;
    const s = new WordScheduler(WORDS, 0, mulberry32(9));
    const counts: Record<string, number> = {};
    for (let i = 0; i < 20000; i++) { const h = s.next(data).h; counts[h] = (counts[h] ?? 0) + 1; }
    expect(counts[missed]).toBeGreaterThan((counts[mastered] ?? 0) * 5);
  });
});

describe('Bag', () => {
  it('draws everything once before repeating', () => {
    const bag = new Bag([1, 2, 3, 4, 5], mulberry32(2));
    const first = Array.from({ length: 5 }, () => bag.next());
    expect([...first].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
