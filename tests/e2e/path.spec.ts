import { test, expect, type Page } from '@playwright/test';

type Snap = { state: string; layers: number; correctEdge: string; path: { screen: string; step: string; lesson: string | null } | null };
const snap = (page: Page) => page.evaluate(() => window.__squish!.snapshot() as unknown as Snap);

async function until(page: Page, pred: (s: Snap) => boolean, label: string): Promise<Snap> {
  const end = Date.now() + 60_000;
  for (;;) {
    const s = await snap(page);
    if (pred(s)) return s;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}; last ${JSON.stringify(s)}`);
    await page.waitForTimeout(150);
  }
}

/** Screenshots for looking at by eye: set SHOTS to a folder. */
const shot = async (page: Page, name: string) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }); };

/** Pops bubbles by pulling to the right answer until the drill (or checkpoint) is over. */
async function popAll(page: Page, screen: 'drill' | 'checkpoint'): Promise<number> {
  let pops = 0;
  for (;;) {
    const s = await until(page, x => x.path?.screen !== screen || x.state === 'live', 'a live layer or the end of the drill');
    if (s.path?.screen !== screen) return pops;
    await page.click(`.ans[data-edge="${s.correctEdge}"]`);
    await until(page, x => x.path?.screen !== screen || x.layers < s.layers || x.state !== 'live', 'the layer to pop');
    pops++;
  }
}

test('the path: lesson 1 from its culture note to done, and its words join the reviews', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?e2e');
  await page.waitForFunction(() => !!window.__squish);
  await until(page, s => s.state === 'home', 'home');
  // one layer a bubble keeps the drills short
  await page.click('#menuBtn');
  await page.click('[data-ask="meaning"]');
  await page.click('[data-ask="pinyin"]');
  await page.click('#menuClose');

  await page.click('[data-mode="path"]');
  await until(page, s => s.path?.screen === 'map', 'the path map');
  await expect(page.locator('.stop.open')).toHaveCount(1);
  await expect(page.locator('.stop.open [data-lesson="hello-1"]')).toHaveCount(1);
  await expect(page.locator('.stop.locked')).toHaveCount(4);
  await expect(page.locator('.punit-later')).toHaveCount(13);
  await shot(page, '1-map');

  await page.click('[data-lesson="hello-1"]');
  // the unit's culture note comes first
  await expect(page.locator('#lStep')).toContainText('Unit 1');
  await expect(page.locator('#lBody')).toContainText('您');
  await shot(page, '2-note');
  await page.click('#lNext');

  // meet ten words
  for (let i = 1; i <= 10; i++) {
    await expect(page.locator('#lStep')).toHaveText(`Meet · ${i} of 10`);
    await expect(page.locator('.meet-h')).not.toBeEmpty();
    if (i === 3) await shot(page, '3-meet');
    await page.click('#lNext');
  }

  // pop them
  await expect(page.locator('#lStep')).toHaveText('Pop');
  await page.click('#lNext');
  await until(page, s => s.path?.screen === 'drill' && s.state === 'live', 'the drill');
  await shot(page, '4-drill');
  // eight bubbles: 吗 and 呢 are grammar particles, met and used in sentences but not drilled
  expect(await popAll(page, 'drill')).toBe(8);

  // the dialogue, and two questions about it
  await expect(page.locator('#lStep')).toHaveText('In context');
  expect(await page.locator('.dline').count()).toBeGreaterThanOrEqual(6);
  await shot(page, '5-dialogue');
  await page.click('#lNext');
  for (let i = 1; i <= 2; i++) {
    await expect(page.locator('#lStep')).toHaveText(`In context · question ${i} of 2`);
    await expect(page.locator('#lNext')).toBeDisabled();
    await page.locator('.lopt').first().click();
    await expect(page.locator('.lopt.yes')).toHaveCount(1);
    if (i === 1) await shot(page, '6-question');
    await page.click('#lNext');
  }

  // put four sentences in order: tiles carry their place in data-k
  for (let i = 1; i <= 4; i++) {
    await expect(page.locator('#lStep')).toHaveText(`Build · ${i} of 4`);
    await expect(page.locator('#lNext')).toBeDisabled();
    const n = await page.locator('.bpool .btile').count();
    for (let k = 0; k < n; k++) await page.click(`.bpool .btile[data-k="${k}"]`);
    await expect(page.locator('.banswer.right')).toHaveCount(1);
    if (i === 1) await shot(page, '7-build');
    await page.click('#lNext');
  }

  // the checkpoint: one bubble, a layer per word
  await expect(page.locator('#lStep')).toHaveText('Checkpoint');
  await page.click('#lNext');
  const cp = await until(page, s => s.path?.screen === 'checkpoint' && s.state === 'live', 'the checkpoint');
  expect(cp.layers).toBe(6);
  await shot(page, '8-checkpoint');
  expect(await popAll(page, 'checkpoint')).toBe(6);

  // done: ticked on the map, the next lesson open, and the words in Today's reviews
  await expect(page.locator('#lStep')).toHaveText('Lesson complete');
  await expect(page.locator('.ldone li')).toHaveCount(10);
  await shot(page, '9-done');
  await page.click('#lNext');
  await until(page, s => s.path?.screen === 'map', 'back on the map');
  await expect(page.locator('.stop.done [data-lesson="hello-1"]')).toHaveCount(1);
  await expect(page.locator('.stop.open [data-lesson="hello-2"]')).toHaveCount(1);
  await page.click('#homeBtn');
  await until(page, s => s.state === 'home', 'home');
  await expect(page.locator('#wordStrip .wcard:not(.wotd)')).toHaveCount(8);
  await expect(page.locator('[data-mode="path"] .card-meta')).toHaveText('1 of 5 lessons');
  expect(errors).toEqual([]);
});

test('the path: leaving mid-lesson goes back to the map, and nothing is marked done', async ({ page }) => {
  await page.goto('/?e2e');
  await page.waitForFunction(() => !!window.__squish);
  await until(page, s => s.state === 'home', 'home');
  await page.click('[data-mode="path"]');
  await until(page, s => s.path?.screen === 'map', 'the map');
  await page.click('[data-lesson="hello-1"]');
  await page.click('#lNext');                        // past the culture note
  await expect(page.locator('#lStep')).toHaveText('Meet · 1 of 10');
  await page.click('#lQuit');
  await until(page, s => s.path?.screen === 'map', 'back on the map');
  await expect(page.locator('.stop.open [data-lesson="hello-1"]')).toHaveCount(1);
  await expect(page.locator('#lesson')).toBeHidden();
});
