import { test, expect, type Page } from '@playwright/test';

type Snap = {
  mode: string | null; tab: string; voice: { latency: number | null; primed: boolean };
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

/** Opens a tab of the shell. */
const tab = (page: Page, name: 'path' | 'practice' | 'read' | 'you') => page.click(`.tabbtn[data-tab="${name}"]`);

async function start(page: Page, mode = 'words'): Promise<Snap> {
  await openHome(page);
  if (mode !== 'today') await tab(page, 'practice');
  await page.click(`[data-mode="${mode}"]`);
  return waitFor(page, s => s.state === 'live', 'first bubble to be live');
}

async function openHome(page: Page, query = ''): Promise<Snap> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto(`/?e2e${query}`);
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
  // the layers come in a random order
  expect([...s.queue].sort()).toEqual(['0', '1', '2']);
  await expect(page.locator('#ask')).toHaveText(/^(What does it mean\?|How is it said\?|Which characters?\?)$/);
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
  // an example sentence, when this word has one: tapping works without errors (no audio files in CI)
  if (await page.locator('#example').isVisible()) {
    await expect(page.locator('#exZh .tok.me')).toHaveCount(1);
    await page.locator('#exZh .tok').first().click();
    await page.click('#exPlay');
  }
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
  const s0 = await start(page);
  const [a, b, c] = s0.queue;
  await page.click('#forgot');
  const s = await waitFor(page, x => x.layers === 4, 'an extra layer');
  expect(s.queue).toEqual([`${a}r`, b, `${a}t`, c]);
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
  await page.click('#homeBtn');
  await waitFor(page, x => x.state === 'home', 'back in the shell');
  await tab(page, 'you');
  await expect(page.locator('#tab-you')).toBeVisible();
  await expect(page.locator('#wordsList .h').first()).toHaveText(s.word!);
  await expect(page.locator('#wordsList .due').first()).toContainText('in ');
  await tab(page, 'path');
  await expect(page.locator('#tab-you')).toBeHidden();
  expect(errorsOf(page)).toEqual([]);
});

test('the home screen: modes, HSK level, and back again', async ({ page }) => {
  const s = await openHome(page);
  await expect(page.locator('#home')).toBeVisible();
  expect(s.maxLevel).toBe(1);
  expect(s.pool).toBeGreaterThan(280);           // quiz words in HSK 1 (grammar particles excluded)
  await expect(page.locator('#homeStats')).toContainText('10 new words');
  await expect(page.locator('#fortuneDay')).not.toBeEmpty();
  await expect(page.locator('#tabbar')).toBeVisible();
  await tab(page, 'read');
  await expect(page.locator('.wcard.wotd')).toContainText('Word of the day');
  await tab(page, 'practice');
  await expect(page.locator('[data-mode="plug"]')).toBeDisabled();
  await expect(page.locator('[data-mode="listen"]')).toBeEnabled();
  // the settings live in the You tab
  await tab(page, 'you');
  await page.click('[data-level="2"]');
  await tab(page, 'practice');
  const s2 = await snap(page);
  expect(s2.maxLevel).toBe(2);
  expect(s2.pool).toBeGreaterThan(s.pool + 150);
  await page.click('[data-mode="words"]');
  await waitFor(page, x => x.state === 'live', 'a bubble');
  await expect(page.locator('#home')).toBeHidden();
  await expect(page.locator('#tabbar')).toBeHidden();
  await page.click('#homeBtn');
  const back = await waitFor(page, x => x.state === 'home', 'back home');
  await expect(page.locator('#home')).toBeVisible();
  // back on the tab it was entered from
  expect(back.tab).toBe('practice');
  expect(errorsOf(page)).toEqual([]);
});

test('Listen: the word is heard, and its tones, meaning and characters pop by ear', async ({ page }) => {
  const s0 = await start(page, 'listen');
  expect(s0.mode).toBe('listen');
  expect([...s0.queue].sort()).toEqual(['3', '4', '5']);
  // the prompt is the sound: the characters are not shown anywhere before the core pops
  await expect(page.locator('#title')).not.toContainText(s0.word!);
  await waitFor(page, s => s.voice.latency !== null, 'the word to play');
  for (let i = 0; i < 3; i++) {
    const before = await snap(page);
    await answer(page);
    await waitFor(page, s => s.layers === before.layers - 1, `layer ${i + 1} to pop`);
  }
  await waitFor(page, s => s.state === 'note', 'the fortune slip');
  await expect(page.locator('#zhBig')).toHaveText(s0.word!);
  // the next word was chosen while the slip was up, so its clip is decoded before its bubble arrives
  // and starts within 150 ms
  await page.click('#next');
  const next = await waitFor(page, s => s.state !== 'note' && s.word !== s0.word, 'the next word');
  expect(next.voice.primed).toBe(true);
  const played = await waitFor(page, s => s.voice.latency !== null, 'the next word to play');
  expect(played.voice.latency!).toBeLessThan(150);
  await waitFor(page, s => s.state === 'live' && s.layers === 3, 'the next bubble');
  // the tone layer counted for the tone statistics, shown in the You tab
  await page.click('#homeBtn');
  await waitFor(page, s => s.state === 'home', 'back in the shell');
  await tab(page, 'you');
  await expect(page.locator('#drawerSub')).toContainText('Tones heard right');
  expect(errorsOf(page)).toEqual([]);
});

test('Listen: a wrong answer replays the word slowly; home and back to Words', async ({ page }) => {
  await start(page, 'listen');
  await waitFor(page, s => s.voice.latency !== null, 'the word to play');
  await answer(page, false);
  await waitFor(page, s => s.wrong === 1, 'the miss to register');
  await page.click('#homeBtn');
  await waitFor(page, s => s.state === 'home' && s.mode === null, 'back home');
  await tab(page, 'practice');
  await page.click('[data-mode="words"]');
  const s = await waitFor(page, x => x.state === 'live', 'a Words bubble');
  expect(s.mode).toBe('words');
  expect([...s.queue].sort()).toEqual(['0', '1', '2']);
  expect(errorsOf(page)).toEqual([]);
});

test('Listen dictation: type the pinyin you hear, with tone numbers', async ({ page }) => {
  await openHome(page, '&dictation');
  await tab(page, 'practice');
  await page.click('[data-mode="listen"]');
  const s0 = await waitFor(page, s => s.state === 'live', 'a Listen bubble');
  expect([...s0.queue].sort()).toEqual(['3', '4', '6']);
  // pop the chip layers that come before dictation, whatever the order
  while ((await snap(page)).queue[0] !== '6') {
    const before = await snap(page);
    await answer(page);
    await waitFor(page, s => s.layers === before.layers - 1 && s.state === 'live', 'a chip layer to pop');
  }
  await expect(page.locator('#dictation')).toBeVisible();
  await expect(page.locator('.ans[data-edge="top"]')).toHaveClass(/off/);
  // a wrong answer first
  await page.fill('#dictIn', 'xx9');
  await page.press('#dictIn', 'Enter');
  await waitFor(page, s => s.wrong === 1, 'the typed miss');
  await expect(page.locator('#ask')).toHaveText('Not quite. Listen again.');
  // "I forgot" shows the answer; typing it pops the layer, and the retest comes back as dictation too
  await page.click('#forgot');
  await waitFor(page, s => s.queue[0] === '6r' && s.queue.includes('6t'), 'the retest');
  const answerText = await page.locator('#dictIn').getAttribute('placeholder');
  // type the answer whenever dictation is up, pull to the right chip otherwise, until the core pops
  for (let guard = 0; guard < 6 && (await snap(page)).state !== 'note'; guard++) {
    const now = await waitFor(page, s => s.state === 'live' || s.state === 'popping' || s.state === 'note', 'a layer');
    if (now.state !== 'live') break;
    if (now.queue[0].startsWith('6')) { await page.fill('#dictIn', answerText!); await page.press('#dictIn', 'Enter'); }
    else await answer(page);
    await waitFor(page, s => s.layers === now.layers - 1, 'the layer to pop');
  }
  await waitFor(page, s => s.state === 'note', 'the fortune slip');
  await expect(page.locator('#dictation')).toBeHidden();
  expect(errorsOf(page)).toEqual([]);
});

test('Ask about: characters only makes one-layer bubbles, and one kind always stays on', async ({ page }) => {
  await openHome(page);
  await tab(page, 'you');
  await page.click('[data-ask="meaning"]');
  await page.click('[data-ask="pinyin"]');
  await expect(page.locator('[data-ask="characters"]')).toBeDisabled();
  await expect(page.locator('[data-ask="meaning"]')).toHaveAttribute('aria-pressed', 'false');
  await tab(page, 'practice');
  await page.click('[data-mode="words"]');
  const s = await waitFor(page, x => x.state === 'live', 'a bubble');
  expect(s.queue).toEqual(['2']);
  expect(s.layers).toBe(1);
  await answer(page);
  await waitFor(page, x => x.state === 'note', 'the fortune slip');
  expect(errorsOf(page)).toEqual([]);
});

test('Today: new words up to the daily limit, then done and back home', async ({ page }) => {
  await openHome(page);
  // one layer a bubble and five new words a day keep this quick
  await tab(page, 'you');
  await page.click('[data-ask="meaning"]');
  await page.click('[data-ask="pinyin"]');
  await page.click('[data-new="5"]');
  await tab(page, 'path');
  await expect(page.locator('#homeStats')).toContainText('0 reviews due · 5 new words');
  await page.click('#todayBtn');
  const seen = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const s = await waitFor(page, x => x.state === 'live', `Today bubble ${i + 1}`);
    expect(s.mode).toBe('today');
    seen.add(s.word!);
    await answer(page);
    await waitFor(page, x => x.state === 'note', 'the fortune slip');
    await page.click('#next');
  }
  expect(seen.size).toBe(5);
  // the day's new words are done and nothing is due yet: Today ends and says so
  await waitFor(page, x => x.state === 'home', 'back home');
  await expect(page.locator('#homeStats')).toContainText('All done for today');
  await expect(page.locator('#todayBtn')).toBeDisabled();
  await expect(page.locator('#days')).toHaveText('1');
  await tab(page, 'you');
  await expect(page.locator('#wordStrip .wcard')).toHaveCount(5);
  expect(errorsOf(page)).toEqual([]);
});
