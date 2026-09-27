/** A rectangle on screen, in CSS pixels. */
export interface Rect { l: number; t: number; r: number; b: number }

/** Distance from a point to a rectangle (0 inside it). */
export const distToRect = (x: number, y: number, q: Rect): number =>
  Math.hypot(Math.max(q.l - x, 0, x - q.r), Math.max(q.t - y, 0, y - q.b));

/** Distance from a vertical line (x, from y0 down to y1) to a rectangle (0 if they cross). */
export const lineToRect = (x: number, y0: number, y1: number, q: Rect): number =>
  Math.hypot(Math.max(q.l - x, 0, x - q.r), Math.max(q.t - y1, 0, y0 - q.b));

export interface FitOptions {
  /** Screen size. */
  W: number; H: number;
  /** Where the bubble's centre sits across the screen. */
  x: number;
  /** Everything the bubble must not cover: answers, the question panel, scores, buttons. */
  obstacles: readonly Rect[];
  /** The designed radius; the bubble never grows past it. */
  maxR: number;
  /** The designed height of the centre, preferred when several heights fit equally well. */
  prefY: number;
  /** How far below the centre something hangs (a lantern's tassel), in radii; it too must stay clear. */
  tail?: number;
  /** Extra room for the skin's wobble, as a factor on the radius. */
  wobble?: number;
  /** Clear space kept around the bubble. */
  gap?: number;
  /** How far the resting bubble bobs up and down, in pixels; the whole range must stay clear. */
  bob?: number;
}

/**
 * Where to put the bubble so it is as large as possible (up to its designed size) without
 * covering anything or leaving the screen: tries every height, keeps the one with the largest
 * radius, and among near-equal ones the closest to the designed height.
 */
export function fitBubble(o: FitOptions): { y: number; r: number } {
  const wobble = o.wobble ?? 1.1, gap = o.gap ?? 8;
  const tail = o.tail ?? 1;
  /** Whether whatever hangs below a bubble of radius r at height y, all the way down to its tip, is clear. */
  const tailClear = (y: number, r: number): boolean => {
    const ty = y + tail * r * wobble;
    return ty <= o.H - gap && o.obstacles.every(q => lineToRect(o.x, y + r, ty, q) >= gap);
  };
  const radiusAt = (y: number): number => {
    let room = Math.min(o.x, o.W - o.x, y, o.H - y) - gap;
    for (const q of o.obstacles) room = Math.min(room, distToRect(o.x, y, q) - gap);
    let r = Math.max(0, Math.min(o.maxR, room / wobble));
    if (tail > 1 && !tailClear(y, r)) {
      // the largest radius whose tail still clears, by halving
      let lo = 0, hi = r;
      for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (tailClear(y, mid)) lo = mid; else hi = mid; }
      r = lo;
    }
    return r;
  };
  // the bobbing centre sweeps y ± bob: the smallest room anywhere on that sweep is what counts
  const bob = o.bob ?? 0;
  const roomAt = bob ? (y: number) => Math.min(radiusAt(y - bob), radiusAt(y), radiusAt(y + bob)) : radiusAt;
  let best = { y: o.prefY, r: roomAt(o.prefY) };
  for (let y = 0; y <= o.H; y += 2) {
    const r = roomAt(y);
    // a clearly larger fit wins; a near-equal one wins only if it is closer to the designed height
    if (r > best.r + 1 || (r > best.r - 1 && Math.abs(y - o.prefY) < Math.abs(best.y - o.prefY))) best = { y, r };
  }
  return best;
}
