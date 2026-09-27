import type { ReviewEntry, Skill } from './progress';

/** The local calendar day of a time, as YYYY-MM-DD. Days turn over at local midnight. */
export function dayKey(t: Date | number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A stable pick for the day: the same all day, a different one tomorrow, and the same on every device. */
export function dailyIndex(now: Date, n: number, salt = ''): number {
  let h = 2166136261;
  for (const c of dayKey(now) + salt) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % Math.max(1, n);
}

/** Days in a row with at least one finished bubble, ending today (or yesterday, if today has none yet). */
export function streakDays(log: readonly ReviewEntry[], now: Date): number {
  const days = new Set(log.map(e => dayKey(e.t)));
  const d = new Date(now);
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/** Whether today already has a finished bubble (so the streak is safe). */
export const practisedToday = (log: readonly ReviewEntry[], now: Date): boolean => log.some(e => dayKey(e.t) === dayKey(now));

/** Items first reviewed today in a skill: the new words met today. */
export function newToday(log: readonly ReviewEntry[], now: Date, skill: Skill = 'words'): number {
  const first = new Map<string, number>();
  for (const e of log) if (e.s === skill && !first.has(e.id)) first.set(e.id, e.t);
  const today = dayKey(now);
  let n = 0;
  for (const t of first.values()) if (dayKey(t) === today) n++;
  return n;
}
