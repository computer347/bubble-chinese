import { test, expect, type Page } from '@playwright/test';

type Snap = {
  state: string; word: string | null; layers: number; totalLayers: number;
  correctEdge: string; score: number; streak: number; detail: number; asleep: boolean; wrong: number; queue: string[];
  pool: number; due: number; maxLevel: number;
};

const snap = (page: Page) => page.evaluate(() => window.__squish!.snapshot() as unknown as Snap);

async function waitFor(page: Page, pred: (s: Snap) => boolean, label: string): Promise<Snap> {
  let s = await snap(page);
  const until = Date.now() + 60_000;
  while (!pred(s)) {
    if (Date.now() > until) throw new Error(`Timed out waiting for: ${label}. Last state: ${JSON.stringify(s)}`);
    await page.waitForTimeout(150);
    s = await snap(page);
  }
  return s;
}

async function start(page: Page): Promise<Snap> {
  await openHome(page);
  await page.click('[data-mode="words"]');
  return waitFor(page, s => s.state === 'live', 'first bubble to be live');
}

async function openHome(page: Page): Promise<Snap> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto('/?e2e');
  await page.waitForFunction(() => !!window.__squish);
  return waitFor(page, s => s.state === 'home', 'the home screen');
}

const errorsOf = (page: Page) => (page as unknown as { __errors: string[] }).__errors;

/** Answers the current layer by clicking the correct chip, which pulls the bubble there. */
async function answer(page: Page, correct = true): Promise<void> {
  const s = await waitFor(page, x => x.state === 'live', 'a live layer');
  const edges = ['top', 'right', 'bottom', 'left'];
  const edge = correct ? s.correctEdge : edges.find(e => e !== s.correctEdge)!;
  await page.click(`.ans[data-edge="${edge}"]`);
}

test('renders the bubble, the prompt and four answers', async ({ page }) => {
  const s = await start(page);
  expect(s.layers).toBe(3);
  expect(s.word).toBeTruthy();
  for (const e of ['top', 'right', 'bottom', 'left']) await expect(page.locator(`.ans[data-edge="${e}"]`)).not.toBeEmpty();
  await expect(page.locator('#ask')).toHaveText('What does it mean?');
  // the WebGL canvas actually drew something other than the flat page colour
  const varied = await page.evaluate(() => {
    const src = document.getElementById('stage') as HTMLCanvasElement;
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d')!; g.drawImage(src, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data;
    const set = new Set<number>();
    for (let i = 0; i < d.length; i += 4) set.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4));
    return set.size;
  });
  expect(varied).toBeGreaterThan(20);
  expect(errorsOf(page)).toEqual([]);
});

test('three right answers pop every layer and deliver a fortune slip', async ({ page }) => {
  const s0 = await start(page);
  for (let i = 0; i < 3; i++) {
    const before = await snap(page);
    await answer(page);
    await waitFor(page, s => s.layers === before.layers - 1, `layer ${i + 1} to pop`);
  }
  await waitFor(page, s => s.state === 'note', 'the fortune slip');
  await expect(page.locator('#note')).toBeVisible();
  await expect(page.locator('#zhBig')).toHaveText(s0.word!);
  await expect(page.locator('#fortuneText')).not.toBeEmpty();
  const s = await snap(page);
  expect(s.streak).toBe(3);
  expect(s.score).toBeGreaterThan(0);
  await expect(page.locator('#result')).toContainText('Next review in');
  await page.click('#next');
  const next = await waitFor(page, x => x.state === 'live' && x.layers === 3, 'the next bubble');
  expect(next.word).not.toBe(s0.word);
  expect(next.due).toBe(0);
  expect(errorsOf(page)).toEqual([]);
});

test('a wrong answer snaps back, keeps the layer and resets the streak', async ({ page }) => {
  await start(page);
  await answer(page, true);
  await waitFor(page, s => s.layers === 2, 'first layer to pop');
  await answer(page, false);
  const s = await waitFor(page, x => x.wrong === 1, 'the miss to register');
  expect(s.streak).toBe(0);
  expect(s.layers).toBe(2);
  expect(errorsOf(page)).toEqual([]);
});

test('"I forgot" reveals the answer and adds a layer that is retested before the core', async ({ page }) => {
  await start(page);
  await page.click('#forgot');
  const s = await waitFor(page, x => x.layers === 4, 'an extra layer');
  expect(s.queue).toEqual(['0r', '1', '0t', '2']);
  await expect(page.locator(`.ans[data-edge="${s.correctEdge}"]`)).toHaveClass(/reveal/);
  await expect(page.locator('#forgot')).toBeDisabled();
  await expect(page.locator('#layerTxt')).toHaveText('Layer 1 of 4');
  expect(errorsOf(page)).toEqual([]);
});

test('dragging the bubble onto the right chip stretches it until it pops', async ({ page }) => {
  const s = await start(page);
  const box = await page.locator('#stage').boundingBox();
  const chip = await page.locator(`.ans[data-edge="${s.correctEdge}"]`).boundingBox();
  // the bubble sits a little below the middle of the screen
  const from = { x: box!.width / 2, y: box!.height * 0.59 };
  const to = { x: chip!.x + chip!.width / 2, y: chip!.y + chip!.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x + (to.x - from.x) * i / 12, from.y + (to.y - from.y) * i / 12);
    await page.waitForTimeout(120);
  }
  await page.mouse.up();
  await waitFor(page, x => x.layers === 2, 'the dragged layer to pop');
  expect(errorsOf(page)).toEqual([]);
});

test('the words panel lists popped words with their next review', async ({ page }) => {
  const s = await start(page);
  for (let i = 0; i < 3; i++) {
    const before = await snap(page);
    await answer(page);
    await waitFor(page, x => x.layers === before.layers - 1, `layer ${i + 1} to pop`);
  }
  await waitFor(page, x => x.state === 'note', 'the fortune slip');
  await page.click('#next');
  await waitFor(page, x => x.state === 'live', 'the next bubble');
  await page.click('#wordsBtn');
  await expect(page.locator('#drawer')).toBeVisible();
  await expect(page.locator('#wordsList .h').first()).toHaveText(s.word!);
  await expect(page.locator('#wordsList .due').first()).toContainText('in ');
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawer')).toBeHidden();
  expect(errorsOf(page)).toEqual([]);
});

test('the home screen: modes, HSK level, and back again', async ({ page }) => {
  const s = await openHome(page);
  await expect(page.locator('#home')).toBeVisible();
  expect(s.maxLevel).toBe(1);
  expect(s.pool).toBeGreaterThan(280);           // quiz words in HSK 1 (grammar particles excluded)
  await expect(page.locator('#homeStats')).toContainText('new words to meet up to HSK 1');
  await expect(page.locator('.m-plug')).toBeDisabled();
  await page.click('[data-level="2"]');
  const s2 = await snap(page);
  expect(s2.maxLevel).toBe(2);
  expect(s2.pool).toBeGreaterThan(s.pool + 150);
  await page.click('[data-mode="words"]');
  await waitFor(page, x => x.state === 'live', 'a bubble');
  await expect(page.locator('#home')).toBeHidden();
  await page.click('#homeBtn');
  await waitFor(page, x => x.state === 'home', 'back home');
  await expect(page.locator('#home')).toBeVisible();
  expect(errorsOf(page)).toEqual([]);
});
