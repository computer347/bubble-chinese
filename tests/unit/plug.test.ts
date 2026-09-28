import { describe, it, expect } from 'vitest';
import { PLUG_ITEMS, USED_STAGES, STAGES, stageOf, openStage, scaffoldOf, fits, checkOrder, validOrders, placedText, pieceWords, TO_OPEN } from '../../src/game/plug';
import { newCard, review, Rating, type Card } from '../../src/game/memory';

const now = new Date('2026-09-28T10:00:00Z');
const find = (text: string) => PLUG_ITEMS.find(x => x.text === text)!;

describe('Plug sentences', () => {
  it('gathers every role-tagged sentence once, with unique ids, spread over the stages', () => {
    expect(PLUG_ITEMS.length).toBeGreaterThan(150);
    expect(new Set(PLUG_ITEMS.map(x => x.id)).size).toBe(PLUG_ITEMS.length);
    expect(new Set(PLUG_ITEMS.map(x => x.text)).size).toBe(PLUG_ITEMS.length);
    for (const x of PLUG_ITEMS) for (const c of x.chunks) expect(c.role).not.toBeNull();
    expect(USED_STAGES.length).toBeGreaterThan(5);
    for (const s of USED_STAGES) expect(STAGES[s]).toBeDefined();
  });

  it('puts each sentence at the furthest grammar point it uses', () => {
    const at = (t: string) => stageOf(find(t).chunks);
    expect(at('他是我的朋友。')).toBe(1);                 // S V O
    expect(at('我不是老师。')).toBe(5);                     // 不
  });

  it('opens a stage once enough of the one before are solved', () => {
    const cards: Record<string, Card> = {};
    const first = USED_STAGES[0];
    expect(openStage(PLUG_ITEMS, cards)).toBe(first);
    for (const x of PLUG_ITEMS.filter(i => i.stage === first).slice(0, TO_OPEN)) cards[x.id] = review(newCard(now), Rating.Good, now);
    expect(openStage(PLUG_ITEMS, cards)).toBe(USED_STAGES[1]);
  });
});

describe('fitting and checking', () => {
  it('fits by shape while there are shapes, anywhere without', () => {
    expect(scaffoldOf(undefined)).toBe('shape-colour');
    expect(scaffoldOf(review(newCard(now), Rating.Good, now))).toBe('shape');
    expect(fits('S', 'S', 'shape')).toBe(true);
    expect(fits('S', 'V', 'shape-colour')).toBe(false);
    expect(fits('S', 'V', 'none')).toBe(true);
  });

  it('accepts the canonical order and every listed alternative, and names the wrong sockets', () => {
    const alt = PLUG_ITEMS.find(x => x.alt.length)!;
    const orders = validOrders(alt);
    expect(orders.length).toBeGreaterThan(1);
    for (const o of orders) expect(checkOrder(alt, o).ok).toBe(true);
    const s = find('他是我的朋友。');
    expect(checkOrder(s, ['他', '是', '我的朋友']).ok).toBe(true);
    expect(checkOrder(s, ['我的朋友', '是', '他'])).toEqual({ ok: false, wrong: [0, 2] });
  });

  it('reads the placed sentence back, and gives each piece its pinyin in context', () => {
    const s = find('我不是老师。');
    expect(placedText(s, ['我', '不', '是', '老师'])).toBe('我不是老师。');
    expect(pieceWords(s, 1)).toEqual([{ h: '不', p: 'bú' }]);
  });
});
