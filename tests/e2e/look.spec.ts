import { test, expect, type Page } from '@playwright/test';

/** Relative luminance (0 black … 1 white) of the page's ground and text colours. */
const lum = (page: Page) => page.evaluate(() => {
  const L = (c: string) => {
    const probe = document.createElement('i');
    probe.style.color = c; document.body.append(probe);
    const [r, g, b] = getComputedStyle(probe).color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    probe.remove();
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const s = getComputedStyle(document.documentElement);
  return { bg: L(s.getPropertyValue('--bg')), ui: L(s.getPropertyValue('--ui')) };
});
/** WCAG contrast ratio between two luminances. */
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

test('light and dark: pale ground with dark text, or deep ground with light text, in both styles', async ({ page }) => {
  await page.goto('/?e2e');
  await page.waitForFunction(() => window.__squish?.snapshot().state === 'home');
  await page.click('.tabbtn[data-tab="you"]');
  for (const style of ['bubble', 'ink']) {
    await page.click(`[data-style="${style}"]`);
    for (const look of ['dark', 'light']) {
      await page.click(`[data-look="${look}"]`);
      await expect(page.locator('body')).toHaveClass(new RegExp(`look-${look}`));
      await page.waitForTimeout(600);                 // the colours ease across
      const { bg, ui } = await lum(page);
      if (look === 'dark') expect(bg).toBeLessThan(ui); else expect(bg).toBeGreaterThan(ui);
      expect(ratio(bg, ui), `${style} ${look}`).toBeGreaterThan(7);
    }
  }
  await page.click('[data-look="auto"]');
  await expect(page.locator('[data-look="auto"]')).toHaveAttribute('aria-checked', 'true');
});
