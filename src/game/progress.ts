import type { Word } from '../content/words';
import { newCard, review, reviveCard, State, type Card, type Grade } from './memory';

export interface Settings {
  /** Highest HSK level to draw new words from. */
  maxLevel: number;
}

/** Everything we keep about the learner, on this device. Version 2 (FSRS). */
export interface ProgressData {
  version: 2;
  /** One FSRS card per word id (characters|pinyin). */
  cards: Record<string, Card>;
  best: number;
  settings: Settings;
}

export const emptyProgress = (): ProgressData => ({ version: 2, cards: {}, best: 0, settings: { maxLevel: 1 } });

/** The version-1 shape from the single-file game and Phase 0 (mastery 0–3 keyed by characters). */
interface ProgressV1 { m?: Record<string, number>; seen?: Record<string, number>; miss?: Record<string, number>; best?: number }

/**
 * Moves version-1 progress to FSRS cards. Words you had met become cards due now, so they are
 * reviewed first and FSRS learns your real memory of them; the best streak is kept.
 */
export function migrateV1(old: ProgressV1, bank: readonly Word[], now: Date): ProgressData {
  const data = emptyProgress();
  data.best = old.best ?? 0;
  for (const h of Object.keys(old.seen ?? {})) {
    for (const w of bank) if (w.h === h) data.cards[w.id] = newCard(now);
  }
  const maxSeen = Math.max(1, ...bank.filter(w => data.cards[w.id]).map(w => w.level));
  data.settings.maxLevel = maxSeen;
  return data;
}

/** Where progress is kept. IndexedDB in the browser; an in-memory stand-in in tests. */
export interface ProgressStore {
  load(): Promise<unknown | null>;
  save(data: ProgressData): Promise<void>;
}

const LEGACY_KEY = 'squish-zh-v1';

export class IndexedDbStore implements ProgressStore {
  private dbp: Promise<IDBDatabase> | null = null;
  constructor(private readonly name = 'squish', private readonly idb: IDBFactory = indexedDB) {}

  private db(): Promise<IDBDatabase> {
    this.dbp ??= new Promise((resolve, reject) => {
      const req = this.idb.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbp;
  }

  async load(): Promise<unknown | null> {
    const db = await this.db();
    const data = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction('kv').objectStore('kv').get('progress');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return data ?? null;
  }

  async save(data: ProgressData): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(structuredClone(data), 'progress');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export class MemoryStore implements ProgressStore {
  constructor(private data: unknown | null = null) {}
  async load() { return this.data ? structuredClone(this.data) : null; }
  async save(d: ProgressData) { this.data = structuredClone(d); }
}

/** Learner progress on top of a store. Saves are fire-and-forget; the game never waits on them. */
export class Progress {
  data: ProgressData = emptyProgress();
  constructor(private readonly store: ProgressStore, private readonly bank: readonly Word[]) {}

  /** Loads saved progress, migrating older versions (IndexedDB v1, or the single-file game's localStorage). */
  async init(legacy: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null, now = new Date()): Promise<void> {
    try {
      const saved = await this.store.load() as (ProgressData | ProgressV1 | null);
      if (saved && (saved as ProgressData).version === 2) {
        const d = saved as ProgressData;
        this.data = { ...emptyProgress(), ...d, settings: { ...emptyProgress().settings, ...d.settings } };
        for (const id of Object.keys(this.data.cards)) this.data.cards[id] = reviveCard(this.data.cards[id]);
        return;
      }
      const v1 = saved ?? (legacy?.getItem(LEGACY_KEY) ? JSON.parse(legacy.getItem(LEGACY_KEY)!) as ProgressV1 : null);
      if (v1) {
        this.data = migrateV1(v1 as ProgressV1, this.bank, now);
        await this.store.save(this.data);
      }
    } catch {
      // Storage can be unavailable (private mode, blocked). Play on with in-memory progress.
    }
  }

  private persist(): void { this.store.save(this.data).catch(() => {}); }

  card(id: string): Card | undefined { return this.data.cards[id]; }

  /** Records one finished bubble for a word. */
  review(id: string, grade: Grade, now = new Date()): Card {
    const c = review(this.data.cards[id] ?? newCard(now), grade, now);
    this.data.cards[id] = c;
    this.persist();
    return c;
  }

  recordStreak(streak: number): void {
    if (streak > this.data.best) { this.data.best = streak; this.persist(); }
  }

  setMaxLevel(level: number): void { this.data.settings.maxLevel = level; this.persist(); }

  /** Words whose memory has graduated to long-term review. */
  learnedCount(pool: readonly Word[]): number {
    return pool.filter(w => { const c = this.data.cards[w.id]; return c && c.state === State.Review; }).length;
  }

  dueCount(pool: readonly Word[], now = new Date()): number {
    return pool.filter(w => { const c = this.data.cards[w.id]; return c && c.due <= now; }).length;
  }

  newCount(pool: readonly Word[]): number { return pool.filter(w => !this.data.cards[w.id]).length; }
}
