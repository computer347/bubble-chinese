import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { WORDS } from '../../src/content/words';
import { Progress, MemoryStore, IndexedDbStore, migrateV1, migrateV2, type ProgressData } from '../../src/game/progress';
import { Scheduler } from '../../src/game/scheduler';
import { newCard, review, Rating, State } from '../../src/game/memory';

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
    for (let i = 0; i < 4; i++) { const c = p.review('words', id('好'), Rating.Good, t); t = c.due; }
    expect(p.card('words', id('好'))!.state).toBe(State.Review);
    expect(p.learnedCount('words', WORDS)).toBe(1);
    expect(p.dueCount('words', WORDS, now)).toBe(0);
    expect(p.dueCount('words', WORDS, new Date(t.getTime() + 1))).toBe(1);
    expect(p.newCount('words', WORDS)).toBe(WORDS.length - 1);
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

  it('keeps the word set, stories read and the pinyin strength; an empty set means all words', async () => {
    const store = new MemoryStore();
    const p = new Progress(store, WORDS);
    await p.init(null, now);
    expect(p.data.settings.practice).toBeNull();
    p.setPractice([id('猫'), id('狗')]); p.completeStory('my-family', now); p.setPinyin(0.4);
    const q = new Progress(store, WORDS);
    await q.init(null, now);
    expect(q.data.settings.practice).toEqual([id('猫'), id('狗')]);
    expect(q.data.read['my-family']).toBe(now.getTime());
    expect(q.data.settings.pinyin).toBe(0.4);
    q.setPractice([]);
    expect(q.data.settings.practice).toBeNull();
  });

  it('migrates version-1 progress: met words become cards due now', () => {
    const d = migrateV1({ m: { 猫: 2 }, seen: { 猫: 1, 绿色: 1 }, miss: {}, best: 7 }, WORDS, now);
    expect(d.version).toBe(3);
    expect(d.best).toBe(7);
    expect(d.cards.words[id('猫')].due.getTime()).toBe(now.getTime());
    expect(d.settings.maxLevel).toBe(2);                       // 绿色 is HSK 2
  });

  it('migrates the single-file game from localStorage', async () => {
    const legacy = new FakeStorage();
    legacy.setItem('squish-zh-v1', JSON.stringify({ m: { 猫: 2 }, seen: { 猫: 1 }, miss: {}, best: 3 }));
    const store = new MemoryStore();
    const p = new Progress(store, WORDS);
    await p.init(legacy as unknown as Storage, now);
    expect(p.card('words', id('猫'))).toBeDefined();
    expect(((await store.load()) as ProgressData).version).toBe(3);
  });

  it('round-trips through IndexedDB with real Date objects', async () => {
    const a = new Progress(new IndexedDbStore('squish-test'), WORDS);
    await a.init(null, now);
    a.review('words', id('水'), Rating.Good, now);
    await new Promise(r => setTimeout(r, 20));
    const b = new Progress(new IndexedDbStore('squish-test'), WORDS);
    await b.init(null, now);
    expect(b.card('words', id('水'))!.due).toBeInstanceOf(Date);
    expect(b.card('words', id('水'))!.reps).toBe(1);
    expect(b.log).toEqual([{ t: now.getTime(), s: 'words', id: id('水'), g: Rating.Good }]);
  });

  it('migrates version 2: every card moves to the words skill, streak and level kept', async () => {
    const card = review(newCard(now), Rating.Good, now);
    const v2 = { version: 2, cards: { [id('猫')]: JSON.parse(JSON.stringify(card)) }, best: 5, settings: { maxLevel: 2 } };
    expect(migrateV2(v2 as never).cards.words[id('猫')]).toBeDefined();
    const store = new MemoryStore(v2);
    const p = new Progress(store, WORDS);
    await p.init(null, now);
    expect(p.card('words', id('猫'))!.due).toBeInstanceOf(Date);
    expect(p.card('words', id('猫'))!.due.getTime()).toBe(card.due.getTime());
    expect(p.data.best).toBe(5);
    expect(p.data.settings.maxLevel).toBe(2);
    expect(p.cards('tone')).toEqual({});
    expect(((await store.load()) as ProgressData).version).toBe(3);
  });

  it('keeps each skill on its own schedule', async () => {
    const p = new Progress(new MemoryStore(), WORDS);
    await p.init(null, now);
    const w = id('好');
    let t = now;
    for (let i = 0; i < 4; i++) t = p.review('words', w, Rating.Good, t).due;
    p.review('listen', w, Rating.Again, now);
    expect(p.card('words', w)!.state).toBe(State.Review);
    expect(p.card('listen', w)!.state).not.toBe(State.Review);
    expect(p.newCount('tone', WORDS)).toBe(WORDS.length);
    // the scheduler sees only the skill it is given: listening wants 好 back soon, words does not
    const soon = new Date(now.getTime() + 86_400_000);
    const pool = [WORDS.find(x => x.id === w)!, ...WORDS.filter(x => x.id !== w && x.level === 1).slice(0, 20)];
    expect(new Scheduler(0).next(pool, p.cards('listen'), soon).id).toBe(w);
    expect(new Scheduler(0).next(pool, p.cards('words'), soon).id).not.toBe(w);
    expect(p.log.map(e => e.s)).toEqual(['words', 'words', 'words', 'words', 'listen']);
  });

  it("upgrades a player's existing database: v2 progress in a version-1 IndexedDB", async () => {
    // what Phase 1 left on players' devices
    const card = JSON.parse(JSON.stringify(review(newCard(now), Rating.Good, now)));
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('squish-upgrade', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ version: 2, cards: { [id('猫')]: card }, best: 9, settings: { maxLevel: 1 } }, 'progress');
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    const p = new Progress(new IndexedDbStore('squish-upgrade'), WORDS);
    await p.init(null, now);
    expect(p.card('words', id('猫'))!.reps).toBe(1);
    expect(p.data.best).toBe(9);
    p.review('tone', id('猫'), Rating.Hard, now);
    await new Promise(r => setTimeout(r, 20));
    const q = new Progress(new IndexedDbStore('squish-upgrade'), WORDS);
    await q.init(null, now);
    expect(q.data.version).toBe(3);
    expect(q.card('tone', id('猫'))).toBeDefined();
    expect(q.log).toHaveLength(1);
  });
});

describe('what bubbles ask about', () => {
  it('defaults to everything, keeps a choice, and never lets it go empty', async () => {
    const store = new MemoryStore();
    const p = new Progress(store, WORDS);
    await p.init(null, now);
    expect(p.data.settings.ask).toEqual(['meaning', 'pinyin', 'characters']);
    p.setAsk(['characters', 'pinyin']);
    expect(p.data.settings.ask).toEqual(['pinyin', 'characters']);
    p.setAsk([]);
    expect(p.data.settings.ask).toEqual(['pinyin', 'characters']);
    const q = new Progress(store, WORDS);
    await q.init(null, now);
    expect(q.data.settings.ask).toEqual(['pinyin', 'characters']);
  });
});
