import { test, expect, type Page } from '@playwright/test';

type Write = { screen: string; char: string | null; stage: string | null; at: number; of: number };
type Plug = { id: string | null; scaffold: string | null; solved: boolean; mistakes: number; hints: number; sockets: { role: string | null; text: string | null }[]; tray: string[]; expected: string[] };
type Snap = { state: string; tab: string; write: Write | null; plug: Plug | null };
const snap = (page: Page) => page.evaluate(() => window.__squish!.snapshot() as unknown as Snap);

async function practice(page: Page, meet = 0): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/?e2e');
  await page.waitForFunction(() => window.__squish?.snapshot().state === 'home');
  if (meet) await page.evaluate(n => window.__squish!.meetWords(n), meet);
  await page.click('.tabbtn[data-tab="practice"]');
  return errors;
}

/** Traces the character on screen along its own stroke centre-lines. */
async function trace(page: Page, ch: string): Promise<void> {
  const strokes = await page.evaluate(async c => (await (await fetch(`strokes/u${c.codePointAt(0)!.toString(16)}.json`)).json()).medians as number[][][], ch);
  const box = (await page.locator('.strokebox .strokes svg').boundingBox())!;
  // Hanzi Writer's layout: the data's box (0,-124)-(1024,900) scaled into the padded square, y up
  const size = box.width, pad = Math.round(size * 0.06), scale = (size - 2 * pad) / 1024;
  const at = ([x, y]: number[]) => ({ x: box.x + pad + x * scale, y: box.y + size - (pad + 124 * scale) - y * scale });
  for (const median of strokes) {
    const pts = median.map(at);
    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    for (const pt of pts.slice(1)) await page.mouse.move(pt.x, pt.y, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
}

test('Write: rounds of the characters you know; a new one is watched, then traced', async ({ page }) => {
  const errors = await practice(page, 10);
  await expect(page.locator('[data-mode="write"]')).toBeEnabled();
  await expect(page.locator('[data-mode="write"] .card-meta')).toContainText('characters');
  await page.click('[data-mode="write"]');
  await expect.poll(async () => (await snap(page)).write?.screen, { timeout: 30_000 }).toBe('char');
  const w = (await snap(page)).write!;
  expect(w.stage).toBe('new');
  expect(w.of).toBe(8);
  await expect(page.locator('.wstatus')).toHaveText('Now trace it.', { timeout: 30_000 });
  await trace(page, w.char!);
  await expect(page.locator('.wstatus')).toHaveText(/Clean!|Done, with/);
  await expect(page.locator('#lNext')).toHaveText('Next');
  await page.click('#lNext');
  await expect.poll(async () => (await snap(page)).write?.at).toBe(1);
  // skip the rest of the round: the summary lists every character
  for (let i = 1; i < 8; i++) { await page.click('#lNext'); }
  await expect.poll(async () => (await snap(page)).write?.screen).toBe('done');
  await expect(page.locator('.wdone span')).toHaveCount(8);
  await expect(page.locator('.wdone .wd-clean')).toHaveCount(1);
  await page.click('#lQuit');
  await expect.poll(async () => (await snap(page)).state).toBe('home');
  expect(errors).toEqual([]);
});

test('Plug: pieces shaped by role plug into the sentence; a wrong shape bounces; solved, it moves on', async ({ page }) => {
  const errors = await practice(page);
  await page.click('[data-mode="plug"]');
  await expect.poll(async () => (await snap(page)).plug?.id, { timeout: 30_000 }).not.toBeNull();
  let p = (await snap(page)).plug!;
  expect(p.scaffold).toBe('shape-colour');
  expect(p.tray.sort()).toEqual([...p.expected].sort());

  // dragged onto a socket of another shape, a piece bounces back to the tray
  if (new Set(p.sockets.map(s => s.role)).size > 1) {
    const piece = page.locator('#plugTray .piece').first();
    const role = await piece.getAttribute('data-role');
    const other = page.locator(`#plugSockets .socket:not([data-role="${role}"])`).first();
    const a = (await piece.boundingBox())!, b = (await other.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect((await snap(page)).plug!.tray.length).toBe(p.expected.length);
  }

  // tapped in order, each piece flies to its socket, and the sentence is solved
  for (const t of p.expected) await page.locator('#plugTray .piece', { hasText: t }).first().click();
  await expect.poll(async () => (await snap(page)).plug?.solved).toBe(true);
  p = (await snap(page)).plug!;
  expect(p.sockets.map(s => s.text)).toEqual(p.expected);
  expect(p.mistakes + p.hints).toBe(0);
  await expect(page.locator('#plugResult')).not.toBeEmpty();
  const first = p.id;

  // the next sentence; a hint places a piece and counts
  await page.click('#plugNext');
  await expect.poll(async () => (await snap(page)).plug?.id).not.toBe(first);
  await page.click('#plugHint');
  await expect.poll(async () => (await snap(page)).plug?.hints).toBe(1);
  expect((await snap(page)).plug!.sockets[0].text).toBe((await snap(page)).plug!.expected[0]);
  // Backspace takes the last piece back
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await snap(page)).plug?.sockets[0].text).toBeNull();

  await page.evaluate(() => window.__squish!.home());
  await expect.poll(async () => (await snap(page)).state).toBe('home');
  await expect(page.locator('[data-mode="plug"] .card-meta')).toContainText('stage 1 of');
  expect(errors).toEqual([]);
});
