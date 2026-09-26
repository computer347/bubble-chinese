import { describe, it, expect } from 'vitest';
import { gradeBubble, newCard, review, masteryDots, dueLabel, reviveCard, Rating, State } from '../../src/game/memory';

const DAY = 86_400_000;

describe('gradeBubble', () => {
  it('maps how a bubble went to an FSRS rating', () => {
    expect(gradeBubble({ wrong: 0, forgot: false })).toBe(Rating.Good);
    expect(gradeBubble({ wrong: 1, forgot: false })).toBe(Rating.Hard);
    expect(gradeBubble({ wrong: 2, forgot: false })).toBe(Rating.Again);
    expect(gradeBubble({ wrong: 0, forgot: true })).toBe(Rating.Again);
  });
});

describe('FSRS reviews', () => {
  it('clean pops push the next review further out each time', () => {
    let now = new Date('2026-09-01T10:00:00Z');
    let card = newCard(now);
    const gaps: number[] = [];
    for (let i = 0; i < 6; i++) {
      card = review(card, Rating.Good, now);
      gaps.push(card.due.getTime() - now.getTime());
      now = card.due;
    }
    expect(card.state).toBe(State.Review);
    for (let i = 2; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
    expect(gaps[gaps.length - 1]).toBeGreaterThan(7 * DAY);
  });

  it('forgetting a well-known word brings it back within a day', () => {
    let now = new Date('2026-09-01T10:00:00Z');
    let card = newCard(now);
    for (let i = 0; i < 5; i++) { card = review(card, Rating.Good, now); now = card.due; }
    card = review(card, Rating.Again, now);
    expect(card.due.getTime() - now.getTime()).toBeLessThan(DAY);
    expect(card.lapses).toBe(1);
  });

  it('survives a JSON round trip', () => {
    const c = review(newCard(new Date()), Rating.Good, new Date());
    const back = reviveCard(JSON.parse(JSON.stringify(c)));
    expect(back.due).toBeInstanceOf(Date);
    expect(back.due.getTime()).toBe(c.due.getTime());
  });
});

describe('labels', () => {
  it('mastery dots grow with stability', () => {
    expect(masteryDots(undefined)).toBe(0);
    const base = review(newCard(new Date()), Rating.Good, new Date());
    expect(masteryDots({ ...base, state: State.Review, stability: 3 })).toBe(1);
    expect(masteryDots({ ...base, state: State.Review, stability: 12 })).toBe(2);
    expect(masteryDots({ ...base, state: State.Review, stability: 90 })).toBe(3);
  });
  it('due labels read naturally', () => {
    const now = new Date('2026-09-01T10:00:00Z');
    expect(dueLabel({ due: new Date(now.getTime() - 1) }, now)).toBe('due now');
    expect(dueLabel({ due: new Date(now.getTime() + 10 * 60_000) }, now)).toBe('in 10 min');
    expect(dueLabel({ due: new Date(now.getTime() + 3 * DAY) }, now)).toBe('in 3 days');
  });
});
