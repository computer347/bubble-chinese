import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { WORDS } from '../../src/content/words';
import { Progress, MemoryStore, IndexedDbStore, migrateV1, type ProgressData } from '../../src/game/progress';
import { Rating, State } from '../../src/game/memory';

class FakeStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}
const now = new Date('2026-09-26T12:00:00Z');
const id = (h: string) => WORDS.find(w => w.h === h)!.id;

describe('Progress', () => {
  it('records reviews as FSRS cards and counts learned and due words', async () => {
    const p = new Progress(new MemoryStore(), WORDS);
    await p.init(null, now);
    let t = now;
    for (let i = 0; i < 4; i++) { const c = p.review(id('好'), Rating.Good, t); t = c.due; }
    expect(p.card(id('好'))!.state).toBe(State.Review);
    expect(p.learnedCount(WORDS)).toBe(1);
    expect(p.dueCount(WORDS, now)).toBe(0);
    expect(p.dueCount(WORDS, new Date(t.getTime() + 1))).toBe(1);
    expect(p.newCount(WORDS)).toBe(WORDS.length - 1);
  });

  it('keeps the best streak and the chosen level', async () => {
    const store = new MemoryStore();
    const p = new Progress(store, WORDS);
    await p.init(null, now);
    p.recordStreak(4); p.recordStreak(2); p.setMaxLevel(2);
    const q = new Progress(store, WORDS);
    await q.init(null, now);
    expect(q.data.best).toBe(4);
    expect(q.data.settings.maxLevel).toBe(2);
  });

  it('migrates version-1 progress: met words become cards due now', () => {
    const d = migrateV1({ m: { 猫: 2 }, seen: { 猫: 1, 绿色: 1 }, miss: {}, best: 7 }, WORDS, now);
    expect(d.version).toBe(2);
    expect(d.best).toBe(7);
    expect(d.cards[id('猫')].due.getTime()).toBe(now.getTime());
    expect(d.settings.maxLevel).toBe(2);                       // 绿色 is HSK 2
  });

  it('migrates the single-file game from localStorage', async () => {
    const legacy = new FakeStorage();
    legacy.setItem('squish-zh-v1', JSON.stringify({ m: { 猫: 2 }, seen: { 猫: 1 }, miss: {}, best: 3 }));
    const store = new MemoryStore();
    const p = new Progress(store, WORDS);
    await p.init(legacy as unknown as Storage, now);
    expect(p.card(id('猫'))).toBeDefined();
    expect(((await store.load()) as ProgressData).version).toBe(2);
  });

  it('round-trips through IndexedDB with real Date objects', async () => {
    const a = new Progress(new IndexedDbStore('squish-test'), WORDS);
    await a.init(null, now);
    a.review(id('水'), Rating.Good, now);
    await new Promise(r => setTimeout(r, 20));
    const b = new Progress(new IndexedDbStore('squish-test'), WORDS);
    await b.init(null, now);
    expect(b.card(id('水'))!.due).toBeInstanceOf(Date);
    expect(b.card(id('水'))!.reps).toBe(1);
  });
});
