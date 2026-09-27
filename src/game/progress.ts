import type { Word } from '../content/words';
import { newCard, review, reviveCard, State, type Card, type Grade } from './memory';
import { ASK_KINDS, type AskKind } from './questions';
import type { StyleId } from '../theme/themes';

/**
 * What a card measures. Each skill has its own schedule, so a word you read well but can't
 * hear yet is due for listening and not for reading.
 * words: the Words bubble (meaning, pinyin and characters). The others arrive with later modes.
 */
export type Skill = 'words' | 'tone' | 'listen' | 'speak' | 'write' | 'sentence';
export const SKILLS: readonly Skill[] = ['words', 'tone', 'listen', 'speak', 'write', 'sentence'];

/** Anything that can be scheduled: a word, a syllable, a sentence. */
export interface Item { readonly id: string }

export interface Settings {
  /** Highest HSK level to draw new words from. */
  maxLevel: number;
  /** What bubbles ask about; at least one. */
  ask: AskKind[];
  /** The look: soap bubbles, or ink and lanterns. */
  style: StyleId;
  /** New words a day in Today's session. */
  newPerDay: number;
}

/** Everything we keep about the learner, on this device. Version 3: FSRS cards per skill. */
export interface ProgressData {
  version: 3;
  /** One FSRS card per skill and item id. */
  cards: Record<Skill, Record<string, Card>>;
  best: number;
  settings: Settings;
  /** The path: when each lesson was finished (ms since the epoch), by lesson id. */
  path: { done: Record<string, number> };
}

/** One finished review. Kept short: the log grows by one entry per bubble. */
export interface ReviewEntry {
  /** Time, in ms since the epoch. */
  t: number;
  s: Skill;
  id: string;
  g: Grade;
}

const emptyCards = (): ProgressData['cards'] => Object.fromEntries(SKILLS.map(s => [s, {}])) as ProgressData['cards'];
export const emptyProgress = (): ProgressData => ({ version: 3, cards: emptyCards(), best: 0, path: { done: {} }, settings: { maxLevel: 1, ask: [...ASK_KINDS], style: 'bubble', newPerDay: 10 } });

/** The version-1 shape from the single-file game and Phase 0 (mastery 0–3 keyed by characters). */
interface ProgressV1 { m?: Record<string, number>; seen?: Record<string, number>; miss?: Record<string, number>; best?: number }

/** Version 2: one card per word, all from the Words bubble. */
interface ProgressV2 { version: 2; cards: Record<string, Card>; best: number; settings: Settings }

/**
 * Moves version-1 progress to FSRS cards. Words you had met become cards due now, so they are
 * reviewed first and FSRS learns your real memory of them; the best streak is kept.
 */
export function migrateV1(old: ProgressV1, bank: readonly Word[], now: Date): ProgressData {
  const data = emptyProgress();
  data.best = old.best ?? 0;
  for (const h of Object.keys(old.seen ?? {})) {
    for (const w of bank) if (w.h === h) data.cards.words[w.id] = newCard(now);
  }
  const maxSeen = Math.max(1, ...bank.filter(w => data.cards.words[w.id]).map(w => w.level));
  data.settings.maxLevel = maxSeen;
  return data;
}

/** Version-2 cards all came from the Words bubble, so they become the `words` skill. */
export function migrateV2(old: ProgressV2): ProgressData {
  const data = emptyProgress();
  data.cards.words = { ...old.cards };
  data.best = old.best ?? 0;
  data.settings = { ...data.settings, ...old.settings };
  return data;
}

/** Where progress is kept. IndexedDB in the browser; an in-memory stand-in in tests. */
export interface ProgressStore {
  load(): Promise<unknown | null>;
  save(data: ProgressData): Promise<void>;
  loadLog(): Promise<ReviewEntry[]>;
  /** Adds one entry; the log is never rewritten, so a save stays small however long it grows. */
  appendLog(entry: ReviewEntry): Promise<void>;
}

const LEGACY_KEY = 'squish-zh-v1';

export class IndexedDbStore implements ProgressStore {
  private dbp: Promise<IDBDatabase> | null = null;
  constructor(private readonly name = 'squish', private readonly idb: IDBFactory = indexedDB) {}

  private db(): Promise<IDBDatabase> {
    this.dbp ??= new Promise((resolve, reject) => {
      // version 2 of the database adds the review log
      const req = this.idb.open(this.name, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('log')) db.createObjectStore('log', { autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbp;
  }

  private async read<T>(store: string, get: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const req = get(db.transaction(store).objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  }

  private async write(store: string, put: (s: IDBObjectStore) => void): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      put(tx.objectStore(store));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async load(): Promise<unknown | null> {
    return (await this.read<unknown>('kv', s => s.get('progress'))) ?? null;
  }

  save(data: ProgressData): Promise<void> {
    return this.write('kv', s => s.put(structuredClone(data), 'progress'));
  }

  loadLog(): Promise<ReviewEntry[]> {
    return this.read<ReviewEntry[]>('log', s => s.getAll());
  }

  appendLog(entry: ReviewEntry): Promise<void> {
    return this.write('log', s => s.add(entry));
  }
}

export class MemoryStore implements ProgressStore {
  private log: ReviewEntry[] = [];
  constructor(private data: unknown | null = null) {}
  async load() { return this.data ? structuredClone(this.data) : null; }
  async save(d: ProgressData) { this.data = structuredClone(d); }
  async loadLog() { return this.log.slice(); }
  async appendLog(e: ReviewEntry) { this.log.push({ ...e }); }
}

/** Learner progress on top of a store. Saves are fire-and-forget; the game never waits on them. */
export class Progress {
  data: ProgressData = emptyProgress();
  /** Every review so far, oldest first. */
  log: ReviewEntry[] = [];
  constructor(private readonly store: ProgressStore, private readonly bank: readonly Word[]) {}

  /** Loads saved progress, migrating older versions (v2, IndexedDB v1, or the single-file game's localStorage). */
  async init(legacy: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null, now = new Date()): Promise<void> {
    try {
      const saved = await this.store.load() as (ProgressData | ProgressV2 | ProgressV1 | null);
      const version = (saved as { version?: number } | null)?.version;
      if (saved && version === 3) {
        const d = saved as ProgressData;
        const base = emptyProgress();
        this.data = { ...base, ...d, cards: { ...base.cards, ...d.cards }, settings: { ...base.settings, ...d.settings }, path: { ...base.path, ...d.path } };
        for (const s of SKILLS) for (const id of Object.keys(this.data.cards[s])) this.data.cards[s][id] = reviveCard(this.data.cards[s][id]);
        this.log = await this.store.loadLog();
        return;
      }
      if (saved && version === 2) {
        this.data = migrateV2(saved as ProgressV2);
        for (const id of Object.keys(this.data.cards.words)) this.data.cards.words[id] = reviveCard(this.data.cards.words[id]);
        await this.store.save(this.data);
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

  /** All cards of one skill, by item id. */
  cards(skill: Skill): Record<string, Card> { return this.data.cards[skill]; }

  card(skill: Skill, id: string): Card | undefined { return this.data.cards[skill][id]; }

  /** Records one finished review of an item in a skill. */
  review(skill: Skill, id: string, grade: Grade, now = new Date()): Card {
    const cards = this.data.cards[skill];
    const c = review(cards[id] ?? newCard(now), grade, now);
    cards[id] = c;
    const entry: ReviewEntry = { t: now.getTime(), s: skill, id, g: grade };
    this.log.push(entry);
    this.persist();
    this.store.appendLog(entry).catch(() => {});
    return c;
  }

  /** Marks a path lesson finished (again, if redone: the latest time is kept). */
  completeLesson(id: string, now = new Date()): void { this.data.path.done[id] = now.getTime(); this.persist(); }

  recordStreak(streak: number): void {
    if (streak > this.data.best) { this.data.best = streak; this.persist(); }
  }

  setMaxLevel(level: number): void { this.data.settings.maxLevel = level; this.persist(); }

  setStyle(style: StyleId): void { this.data.settings.style = style; this.persist(); }

  setNewPerDay(n: number): void { this.data.settings.newPerDay = Math.max(0, Math.round(n)); this.persist(); }

  /** Chooses what bubbles ask about. An empty choice is ignored: there must be something to ask. */
  setAsk(ask: readonly AskKind[]): void {
    const kinds = ASK_KINDS.filter(k => ask.includes(k));
    if (!kinds.length) return;
    this.data.settings.ask = kinds;
    this.persist();
  }

  /** Items whose memory has graduated to long-term review. */
  learnedCount(skill: Skill, pool: readonly Item[]): number {
    const cards = this.data.cards[skill];
    return pool.filter(w => cards[w.id]?.state === State.Review).length;
  }

  dueCount(skill: Skill, pool: readonly Item[], now = new Date()): number {
    const cards = this.data.cards[skill];
    return pool.filter(w => { const c = cards[w.id]; return c && c.due <= now; }).length;
  }

  newCount(skill: Skill, pool: readonly Item[]): number {
    const cards = this.data.cards[skill];
    return pool.filter(w => !cards[w.id]).length;
  }
}
