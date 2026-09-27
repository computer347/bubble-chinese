import { test, expect, type Page } from '@playwright/test';

/**
 * Layout on real screen sizes: every answer is fully on screen, and the bubble (with some room
 * to wobble) never covers an answer, the question panel or the scores.
 * Sizes are the visible area in a browser, with its toolbars, not the full screen.
 */
const SCREENS: Array<[string, number, number]> = [
  ['iPhone SE in Safari', 375, 548],
  ['iPhone 15 in Safari', 393, 659],
  ['iPhone 15 Pro Max in Safari', 430, 739],
  ['small Android', 360, 640],
  ['phone, landscape', 740, 340],
  ['iPad portrait', 820, 1080],
  ['laptop', 1280, 720]
];

type Rect = { l: number; t: number; r: number; b: number };
type Snap = { state: string; layers: number; correctEdge: string; ball: { x: number; y: number; r: number } };
const snap = (page: Page) => page.evaluate(() => window.__squish!.snapshot() as unknown as Snap);

async function until(page: Page, pred: (s: Snap) => boolean): Promise<Snap> {
  const end = Date.now() + 60_000;
  for (;;) {
    const s = await snap(page);
    if (pred(s)) return s;
    if (Date.now() > end) throw new Error(`timed out; last ${JSON.stringify(s)}`);
    await page.waitForTimeout(150);
  }
}

async function rects(page: Page, sel: string): Promise<Array<Rect & { name: string }>> {
  return page.$$eval(sel, els => els.filter(e => e.getClientRects().length > 0 && getComputedStyle(e).opacity !== '0' && getComputedStyle(e).visibility !== 'hidden').map(e => {
    const r = e.getBoundingClientRect();
    return { name: (e as HTMLElement).dataset.edge ?? e.id ?? e.className, l: r.left, t: r.top, r: r.right, b: r.bottom };
  }));
}

/** Distance from a vertical line (the tassel) to a rectangle. */
const lineDist = (x: number, y0: number, y1: number, q: Rect) => Math.hypot(Math.max(q.l - x, 0, x - q.r), Math.max(q.t - y1, 0, y0 - q.b));
/** Distance from a circle's centre to a rectangle. */
const dist = (x: number, y: number, q: Rect) => Math.hypot(Math.max(q.l - x, 0, x - q.r), Math.max(q.t - y, 0, y - q.b));

async function check(page: Page, W: number, H: number, where: string, tail = 1): Promise<string[]> {
  await until(page, x => x.state === 'live');
  // the settled layout: fonts loaded (a late font can widen an answer and re-fit the bubble),
  // no fit in the last 0.6 s, and the bubble has finished gliding to its spot
  await page.evaluate(() => document.fonts.ready);
  let s = await snap(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(300);
    const t = await snap(page);
    const since = await page.evaluate(() => { const f = (window.__squish!.snapshot() as unknown as { lastFit: { at: number } | null }).lastFit; return f ? performance.now() - f.at : Infinity; });
    const still = Math.abs(t.ball.r - s.ball.r) < 1 && Math.abs(t.ball.y - s.ball.y) < 3 && since > 600;
    s = t;
    if (still && t.state === 'live') break;
  }
  const problems: string[] = [];
  const chips = await rects(page, '.ans');
  for (const c of chips) {
    if (c.l < -0.5 || c.t < -0.5 || c.r > W + 0.5 || c.b > H + 0.5) problems.push(`${where}: ${c.name} answer is off screen (${c.l | 0},${c.t | 0})-(${c.r | 0},${c.b | 0})`);
  }
  // the resting bubble plus 8% for its wobble must stay clear of the answers and the corners
  const { x, y, r } = s.ball, room = r * 1.08;
  for (const c of [...chips, ...(await rects(page, '.corner .q, .stats, #modeLabel'))]) {
    // a lantern's tassel hangs below it
    if (tail > 1 && lineDist(x, y + r * 0.8, y + tail * r, c) < 1) problems.push(`${where}: tassel touches ${c.name}: ball ${x | 0},${y | 0},${r | 0} chip ${c.l | 0},${c.t | 0},${c.r | 0},${c.b | 0}`);
    if (dist(x, y, c) < room) problems.push(`${where}: bubble (r ${r | 0} at ${x | 0},${y | 0}) covers ${c.name} (${c.l | 0},${c.t | 0})-(${c.r | 0},${c.b | 0})`);
  }
  return problems;
}

const RUNS: Array<[string, number, number, 'bubble' | 'ink']> = [
  ...SCREENS.map(([n, w, h]) => [n, w, h, 'bubble'] as [string, number, number, 'bubble']),
  ['iPhone SE in Safari', 375, 548, 'ink'],
  ['iPhone 15 in Safari', 393, 659, 'ink']
];

for (const [name, W, H, style] of RUNS) {
  test(`layout: ${name} (${W}×${H})${style === 'ink' ? ', ink & lanterns' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width: W, height: H });
    await page.goto('/?e2e');
    await page.waitForFunction(() => !!window.__squish);
    // lanterns sway, so clicks on them skip the wait for a still target
    const force = style === 'ink';
    if (force) await page.click('[data-style="ink"]');
    const tail = force ? 1.45 : 1;
    const problems: string[] = [];
    for (const mode of ['words', 'listen']) {
      await until(page, s => s.state === 'home');
      await page.click(`[data-mode="${mode}"]`, { force });
      for (let layer = 0; layer < 3; layer++) {
        problems.push(...await check(page, W, H, `${mode} layer ${layer + 1}`, tail));
        const before = await snap(page);
        if (before.layers <= 1) break;
        await page.click(`.ans[data-edge="${before.correctEdge}"]`);
        await until(page, x => x.layers === before.layers - 1);
      }
      await page.click('#homeBtn').catch(() => {});
      await until(page, s => s.state === 'home' || s.state === 'popping' || s.state === 'note');
      if ((await snap(page)).state !== 'home') { await until(page, s => s.state === 'note'); await page.click('#homeBtn'); }
    }
    expect(problems).toEqual([]);
  });
}
