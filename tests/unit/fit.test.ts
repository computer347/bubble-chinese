import { describe, it, expect } from 'vitest';
import { fitBubble, distToRect, lineToRect, type Rect } from '../../src/ui/fit';

const rect = (l: number, t: number, r: number, b: number): Rect => ({ l, t, r, b });

describe('fitBubble', () => {
  it('keeps the designed size and height when there is room', () => {
    const f = fitBubble({ W: 1280, H: 720, x: 640, obstacles: [rect(600, 20, 680, 60)], maxR: 150, prefY: 400 });
    expect(f).toEqual({ y: 400, r: 150 });
  });

  it('shrinks between side answers that crowd a narrow phone, and clears every obstacle', () => {
    const obstacles = [rect(158, 118, 231, 156), rect(257, 388, 374, 443), rect(146, 687, 243, 726), rect(16, 396, 97, 435)];
    const f = fitBubble({ W: 390, H: 800, x: 195, obstacles, maxR: 117, prefY: 468 });
    for (const q of obstacles) expect(distToRect(195, f.y, q)).toBeGreaterThanOrEqual(f.r * 1.1 + 8 - 1e-9);
    expect(f.r).toBeGreaterThan(60);
  });

  it('moves off the designed height when that fits a clearly larger bubble', () => {
    // side answers at the designed height, open space above and below them
    const obstacles = [rect(0, 380, 150, 420), rect(240, 380, 390, 420)];
    const f = fitBubble({ W: 390, H: 800, x: 195, obstacles, maxR: 117, prefY: 400 });
    expect(Math.abs(f.y - 400)).toBeGreaterThan(100);
    expect(f.r).toBeGreaterThan(115);
    expect(fitBubble({ W: 390, H: 800, x: 195, obstacles: [], maxR: 117, prefY: 400 }).r).toBe(117);
  });

  it('keeps a hanging tassel clear of the answer below', () => {
    const bottom = rect(150, 600, 240, 640);
    const f = fitBubble({ W: 390, H: 700, x: 195, obstacles: [bottom], maxR: 117, prefY: 420, tail: 1.45 });
    expect(lineToRect(195, f.y + f.r, f.y + 1.45 * f.r * 1.1, bottom)).toBeGreaterThanOrEqual(8 - 1e-6);
    expect(f.r).toBeGreaterThan(80);
  });

  it('checks the whole tassel, not just its tip: a tip below an answer still means the cord crosses it', () => {
    const bottom = rect(150, 545, 240, 585);
    expect(lineToRect(195, 525, 590, bottom)).toBe(0);
    const f = fitBubble({ W: 393, H: 659, x: 196, obstacles: [bottom], maxR: 117, prefY: 400, tail: 1.45 });
    expect(lineToRect(196, f.y + f.r, f.y + 1.45 * f.r * 1.1, bottom)).toBeGreaterThanOrEqual(8 - 1e-6);
  });

  it('stays on screen', () => {
    const f = fitBubble({ W: 300, H: 200, x: 150, obstacles: [], maxR: 500, prefY: 100 });
    expect(f.r * 1.1 + 8).toBeLessThanOrEqual(100 + 1e-9);
  });
});
