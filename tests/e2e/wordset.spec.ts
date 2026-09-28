import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Snap = { mode: string | null; state: string; word: string | null };
const snap = (page: Page) => page.evaluate(() => window.__squish!.snapshot() as unknown as Snap);

const words = JSON.parse(readFileSync('src/content/generated/hsk.json', 'utf8')) as { id: string; h: string; quiz?: boolean }[];
const path = JSON.parse(readFileSync('src/content/generated/path.json', 'utf8')) as { units: { id: string; lessons: { words: string[] }[] }[] };
const quizzed = new Map(words.filter(w => w.quiz !== false).map(w => [w.id, w.h]));
/** The Family topic's quizzed words, as characters. */
const family = path.units.find(u => u.id === 'family')!.lessons.flatMap(l => l.words).filter(id => quizzed.has(id)).map(id => quizzed.get(id)!);

async function practice(page: Page): Promise<void> {
  await page.goto('/?e2e');
  await page.waitForFunction(() => window.__squish?.snapshot().state === 'home');
  await page.click('.tabbtn[data-tab="practice"]');
}

test('a word set: pick a topic, and Words only asks its words; clear it for all of them', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await practice(page);
  await expect(page.locator('#setLabel')).toHaveText('All of HSK 1');

  await page.click('#setChip');
  await expect(page.locator('#setSheet')).toBeVisible();
  // a couple of single words is too few to make bubbles of
  await page.click('[data-group="topic:food"] summary');
  await page.locator('[data-group="topic:food"] .wpick').nth(0).click();
  await page.locator('[data-group="topic:food"] .wpick').nth(1).click();
  await expect(page.locator('#setApply')).toBeDisabled();
  await page.click('#setAll');
  // a whole topic
  await page.click('[data-group="topic:family"] .wgroup-all');
  await expect(page.locator('[data-group="topic:family"] .wgroup-all')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#setApply');
  await expect(page.locator('#setSheet')).toBeHidden();
  await expect(page.locator('#setLabel')).toHaveText('Family');
  await expect(page.locator('[data-mode="words"] .card-meta')).toHaveText(`0 of ${family.length} learned`);

  // each time Words opens, its word comes from the set
  for (let i = 0; i < 3; i++) {
    await page.click('[data-mode="words"]');
    await expect.poll(async () => (await snap(page)).state, { timeout: 60_000 }).toBe('live');
    expect(family).toContain((await snap(page)).word);
    await page.evaluate(() => window.__squish!.home());
    await expect.poll(async () => (await snap(page)).state).toBe('home');
  }

  // cleared: every word again; then a kind of word
  await page.click('#setChip');
  await page.click('#setAll');
  await expect(page.locator('#setApply')).toHaveText('Use all words');
  await page.click('#setApply');
  await expect(page.locator('#setLabel')).toHaveText('All of HSK 1');
  await page.click('#setChip');
  await page.click('[data-group="kind:num"] .wgroup-all');
  await page.click('#setApply');
  await expect(page.locator('#setLabel')).toHaveText('Numbers');
  expect(errors).toEqual([]);
});
