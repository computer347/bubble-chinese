import { describe, it, expect } from 'vitest';
import { dayKey, dailyIndex, streakDays, practisedToday, newToday } from '../../src/game/daily';
import type { ReviewEntry } from '../../src/game/progress';

const at = (d: string, h = 12) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`);
const e = (d: string, id = 'a', s: ReviewEntry['s'] = 'words', h = 12): ReviewEntry => ({ t: at(d, h).getTime(), s, id, g: 3 });

describe('daily', () => {
  it('keys days by the local calendar', () => {
    expect(dayKey(at('2026-09-27', 0))).toBe('2026-09-27');
    expect(dayKey(at('2026-09-27', 23))).toBe('2026-09-27');
  });

  it('picks the same item all day and moves on the next', () => {
    expect(dailyIndex(at('2026-09-27', 1), 100)).toBe(dailyIndex(at('2026-09-27', 22), 100));
    const week = new Set(['21', '22', '23', '24', '25', '26', '27'].map(d => dailyIndex(at(`2026-09-${d}`), 100)));
    expect(week.size).toBeGreaterThan(4);
    expect(dailyIndex(at('2026-09-27'), 100, 'word')).not.toBe(dailyIndex(at('2026-09-27'), 100, 'fortune'));
  });

  it('counts the streak back from today, or from yesterday before today is done', () => {
    const log = [e('2026-09-24'), e('2026-09-25'), e('2026-09-26')];
    expect(streakDays(log, at('2026-09-27'))).toBe(3);             // today not done yet: streak still alive
    expect(practisedToday(log, at('2026-09-27'))).toBe(false);
    expect(streakDays([...log, e('2026-09-27')], at('2026-09-27'))).toBe(4);
    expect(streakDays(log, at('2026-09-28'))).toBe(0);             // a missed day breaks it
    expect(streakDays([], at('2026-09-27'))).toBe(0);
  });

  it('counts words met for the first time today', () => {
    const log = [e('2026-09-26', 'old'), e('2026-09-27', 'old'), e('2026-09-27', 'x'), e('2026-09-27', 'y'), e('2026-09-27', 'x'), e('2026-09-27', 'z', 'listen')];
    expect(newToday(log, at('2026-09-27'))).toBe(2);
    expect(newToday(log, at('2026-09-27'), 'listen')).toBe(1);
  });
});
