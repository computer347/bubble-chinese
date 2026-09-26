import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { Progress, MemoryStore, IndexedDbStore } from '../../src/game/progress';

class FakeStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe('Progress', () => {
  it('levels a word up on clean pops and down on messy ones, within 0–3', async () => {
    const p = new Progress(new MemoryStore());
    await p.init(null);
    for (let i = 0; i < 5; i++) p.finish('好', true);
    expect(p.level('好')).toBe(3);
    p.finish('好', false);
    expect(p.level('好')).toBe(2);
    for (let i = 0; i < 5; i++) p.finish('好', false);
    expect(p.level('好')).toBe(0);
  });

  it('counts learned words and keeps the best streak', async () => {
    const p = new Progress(new MemoryStore());
    await p.init(null);
    p.finish('一', true); p.finish('二', false);
    p.recordStreak(4); p.recordStreak(2);
    expect(p.learnedCount()).toBe(1);
    expect(p.data.best).toBe(4);
  });

  it('migrates progress from the single-file version (localStorage)', async () => {
    const legacy = new FakeStorage();
    legacy.setItem('squish-zh-v1', JSON.stringify({ m: { 猫: 2 }, seen: { 猫: 1 }, miss: {}, best: 7 }));
    const store = new MemoryStore();
    const p = new Progress(store);
    await p.init(legacy as unknown as Storage);
    expect(p.level('猫')).toBe(2);
    expect((await store.load())?.best).toBe(7);
  });

  it('round-trips through IndexedDB', async () => {
    const store = new IndexedDbStore('squish-test');
    const a = new Progress(store);
    await a.init(null);
    a.finish('水', true);
    await new Promise(r => setTimeout(r, 20));
    const b = new Progress(new IndexedDbStore('squish-test'));
    await b.init(null);
    expect(b.level('水')).toBe(1);
  });
});
