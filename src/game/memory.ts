import { fsrs, createEmptyCard, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';

export { Rating, State };
export type { Card, Grade };

/**
 * FSRS spaced repetition (via ts-fsrs). One card per word. Each finished bubble is one review:
 * Again if you forgot or missed twice, Hard for one miss, Good for a clean pop.
 */
export const scheduler = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9 }));

export function newCard(now: Date): Card { return createEmptyCard(now); }

/** Rates a bubble from how it went. */
export function gradeBubble(r: { wrong: number; forgot: boolean }): Grade {
  if (r.forgot || r.wrong >= 2) return Rating.Again;
  if (r.wrong === 1) return Rating.Hard;
  return Rating.Good;
}

export function review(card: Card, grade: Grade, now: Date): Card {
  return scheduler.next(card, now, grade).card;
}

/** Stored cards may come back from IndexedDB or JSON with dates as strings. */
export function reviveCard(c: Card): Card {
  return {
    ...c,
    due: new Date(c.due),
    last_review: c.last_review ? new Date(c.last_review) : undefined
  };
}

/** 0–3 dots for the words panel, from how long the memory is expected to last. */
export function masteryDots(card: Card | undefined): number {
  if (!card || card.state === State.New || card.state === State.Learning || card.state === State.Relearning) return 0;
  if (card.stability < 7) return 1;
  if (card.stability < 30) return 2;
  return 3;
}

/** "now", "in 3 hours", "in 4 days". */
export function dueLabel(card: Pick<Card, 'due'>, now: Date): string {
  const ms = card.due.getTime() - now.getTime();
  if (ms <= 0) return 'due now';
  const h = ms / 3_600_000;
  if (h < 1) return `in ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 24) return `in ${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return d < 60 ? `in ${d} ${d === 1 ? 'day' : 'days'}` : `in ${Math.round(d / 30)} months`;
}
