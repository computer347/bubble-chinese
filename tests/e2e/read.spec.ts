import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Read = { story: string | null; pop: 'word' | 'sentence' | null; playing: number | null };
type Snap = { mode: string | null; tab: string; state: string; read: Read | null };
const snap = (page: Page) => page.evaluate(() => window.__squish!.snapshot() as unknown as Snap);

const stories = JSON.parse(readFileSync('src/content/generated/stories.json', 'utf8')) as { id: string; after: string | null; paras: { en: string }[][] }[];
const path = JSON.parse(readFileSync('src/content/generated/path.json', 'utf8')) as { units: { lessons: { id: string }[] }[] };
const lessonIds = path.units.flatMap(u => u.lessons.map(l => l.id));
const first = stories[0];
/** Lessons to finish before the first story opens. */
const toOpen = lessonIds.indexOf(first.after!) + 1;

async function readTab(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto('/?e2e');
  await page.waitForFunction(() => window.__squish?.snapshot().state === 'home');
  await page.click('.tabbtn[data-tab="read"]');
}

test('stories open along the path: locked at first, then readable', async ({ page }) => {
  await readTab(page);
  await expect(page.locator('.scard')).toHaveCount(stories.length);
  await expect(page.locator(`[data-story="${first.id}"]`)).toBeDisabled();
  await expect(page.locator(`[data-story="${first.id}"] .scard-meta`)).toContainText(`lesson ${toOpen}`);
  await page.evaluate(n => window.__squish!.finishLessons(n), toOpen);
  await expect(page.locator(`[data-story="${first.id}"]`)).toBeEnabled();
  await expect(page.locator(`[data-story="${stories[stories.length - 1].id}"]`)).toBeDisabled();
});

test('the reader: tap a word for its meaning, hold a sentence for its translation, then finish', async ({ page }) => {
  await readTab(page);
  await page.evaluate(n => window.__squish!.finishLessons(n), toOpen);
  await page.click(`[data-story="${first.id}"]`);
  await expect(page.locator('#reader')).toBeVisible();
  await expect.poll(async () => (await snap(page)).read?.story).toBe(first.id);
  await expect(page.locator('.r-sent')).toHaveCount(first.paras.flat().length);

  // a word: its meaning above it
  const word = page.locator('.r-w[data-id]').first();
  await word.click();
  await expect(page.locator('#rPop')).toBeVisible();
  await expect(page.locator('#rPop .rpop-e')).not.toBeEmpty();
  expect((await snap(page)).read?.pop).toBe('word');
  await word.click();
  await expect(page.locator('#rPop')).toBeHidden();

  // a sentence held: its translation
  const sent = page.locator('.r-sent').nth(1);
  const box = (await sent.boundingBox())!;
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.locator('#rPop .rpop-en')).toHaveText(first.paras.flat()[1].en);
  expect((await snap(page)).read?.pop).toBe('sentence');

  // the pinyin slider fades the pinyin
  await page.locator('#pyOpacity').fill('0');
  await expect.poll(() => page.locator('.r-w rt').first().evaluate(e => Number(getComputedStyle(e).opacity))).toBe(0);

  // play all runs, and stops
  await page.click('#rPlay');
  await expect.poll(async () => (await snap(page)).read?.playing).not.toBeNull();
  await page.click('#rPlay');
  await expect.poll(async () => (await snap(page)).read?.playing).toBeNull();

  // finished: back on the shelf, marked read, and the setting kept
  await page.click('.r-done');
  await expect.poll(async () => (await snap(page)).state).toBe('home');
  await expect(page.locator('#reader')).toBeHidden();
  await expect(page.locator(`#tab-read .story.read [data-story="${first.id}"]`)).toBeVisible();
  await page.click(`[data-story="${first.id}"]`);
  await expect(page.locator('#pyOpacity')).toHaveValue('0');
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
});
