/** What we remember about each word, on this device. */
export interface ProgressData {
  /** Mastery 0–3 per word (by characters). */
  m: Record<string, number>;
  /** Last time each word was met (ms since epoch). */
  seen: Record<string, number>;
  /** How often each word was missed or forgotten. */
  miss: Record<string, number>;
  best: number;
}

export const emptyProgress = (): ProgressData => ({ m: {}, seen: {}, miss: {}, best: 0 });

/** Where progress is kept. IndexedDB in the browser; an in-memory stand-in in tests. */
export interface ProgressStore {
  load(): Promise<ProgressData | null>;
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

  async load(): Promise<ProgressData | null> {
    const db = await this.db();
    const data = await new Promise<ProgressData | undefined>((resolve, reject) => {
      const req = db.transaction('kv').objectStore('kv').get('progress');
      req.onsuccess = () => resolve(req.result as ProgressData | undefined);
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
  constructor(private data: ProgressData | null = null) {}
  async load() { return this.data ? structuredClone(this.data) : null; }
  async save(d: ProgressData) { this.data = structuredClone(d); }
}

/** Mastery bookkeeping on top of a store. Saves are fire-and-forget; the game never waits on them. */
export class Progress {
  data: ProgressData = emptyProgress();
  constructor(private readonly store: ProgressStore) {}

  /** Loads saved progress, migrating the old localStorage format from the single-file version. */
  async init(legacy: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null): Promise<void> {
    try {
      const saved = await this.store.load();
      if (saved) { this.data = { ...emptyProgress(), ...saved }; return; }
      const raw = legacy?.getItem(LEGACY_KEY);
      if (raw) {
        this.data = { ...emptyProgress(), ...JSON.parse(raw) };
        await this.store.save(this.data);
      }
    } catch {
      // Storage can be unavailable (private mode, blocked). Play on with in-memory progress.
    }
  }

  private persist(): void { this.store.save(this.data).catch(() => {}); }

  level(h: string): number { return this.data.m[h] ?? 0; }

  /** A bubble for this word was finished. Clean runs level it up; messy ones level it down. */
  finish(h: string, clean: boolean): void {
    const d = this.data;
    d.seen[h] = Date.now();
    d.m[h] = clean ? Math.min(3, (d.m[h] ?? 0) + 1) : Math.max(0, (d.m[h] ?? 0) - 1);
    if (clean && d.miss[h]) d.miss[h] = Math.max(0, d.miss[h] - 1);
    this.persist();
  }

  miss(h: string): void {
    const d = this.data;
    d.miss[h] = (d.miss[h] ?? 0) + 1;
    d.seen[h] ??= Date.now();
    this.persist();
  }

  recordStreak(streak: number): void {
    if (streak > this.data.best) { this.data.best = streak; this.persist(); }
  }

  learnedCount(): number { return Object.values(this.data.m).filter(v => v >= 1).length; }
}
