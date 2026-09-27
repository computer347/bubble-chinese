import * as THREE from 'three';
import { rand } from '../game/random';

const FONT_LATIN = '"Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif';
const FONT_ZH = '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

interface Letter {
  ch: string; rx: number; ry: number; ox: number; oy: number; vx: number; vy: number;
  rot: number; vr: number; w: number; alpha: number; dying: boolean; delay: number;
}
interface Droplet { x: number; y: number; vx: number; vy: number; r: number; tr: number; life: number; dead?: boolean }
interface Splat { x: number; y: number; r: number; tr: number; ph: number }
interface Ring { x: number; y: number; r: number; life: number; slow?: boolean }
interface Shard { x: number; y: number; vx: number; vy: number; rot: number; vr: number; len: number; life: number; c: string }

/** Where the ball is on the backdrop, in canvas pixels. */
export interface BallView { x: number; y: number; r: number; vx: number; vy: number; visible: boolean; pushing: boolean }

/**
 * The flat wall behind the bubble: the prompt word (whose letters get shoved around by the ball),
 * and the paint, flashes and shreds from pops. Drawn with Canvas 2D into a texture, and only redrawn
 * when something visible changed. The ball's contact shadow is a separate small mesh on the wall,
 * so the bubble's constant bobbing never forces a full-screen redraw and upload.
 */
export class Backdrop {
  readonly canvas = document.createElement('canvas');
  readonly mesh: THREE.Mesh;
  readonly colors = { bg: '#000', ink: '#fff', shadow: 'rgba(0,0,0,.4)' };
  cw = 1; ch = 1; cdpr = 1;
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private letters: Letter[] = [];
  private zh = false;
  private fontSize = 200;
  private droplets: Droplet[] = [];
  private splats: Splat[] = [];
  private rings: Ring[] = [];
  private shards: Shard[] = [];
  private flood: { x: number; y: number; t: number; dur: number; R: number } | null = null;
  floodColor = '#000';
  private dirty = true;
  private lastSig = '';
  private readonly shadowCanvas = document.createElement('canvas');
  private readonly shadowTex: THREE.CanvasTexture;
  private readonly shadow: THREE.Mesh;

  constructor(private readonly reduceMotion: boolean) {
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.mesh.position.z = -3.2;
    this.shadowCanvas.width = this.shadowCanvas.height = 128;
    this.shadowTex = new THREE.CanvasTexture(this.shadowCanvas);
    this.shadowTex.colorSpace = THREE.SRGBColorSpace;
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, toneMapped: false }));
    this.shadow.position.z = 0.001;
    this.mesh.add(this.shadow);
    this.drawShadow();
  }

  /** The shadow's radial falloff, in the palette's shadow colour; redrawn only when the palette changes. */
  private drawShadow(): void {
    const g = this.shadowCanvas.getContext('2d')!, s = this.colors.shadow;
    g.clearRect(0, 0, 128, 128);
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, s);
    grad.addColorStop(0.55, s.replace(/[\d.]+\)$/, m => (parseFloat(m) * 0.45).toFixed(3) + ')'));
    grad.addColorStop(1, s.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    this.shadowTex.needsUpdate = true;
  }

  /** Places the contact shadow under the ball (the wall mesh spans -0.5…0.5 in its own units). */
  private placeShadow(ball: BallView): void {
    this.shadow.visible = ball.visible;
    if (!ball.visible) return;
    const sx = ball.x + ball.r * 0.16, sy = ball.y + ball.r * 0.5, sr = ball.r * 1.35;
    this.shadow.position.x = sx / this.cw - 0.5;
    this.shadow.position.y = 0.5 - sy / this.ch;
    this.shadow.scale.set(2 * sr / this.cw, 2 * sr / this.ch, 1);
  }

  resize(w: number, h: number): void {
    this.cdpr = Math.min(window.devicePixelRatio || 1, 1.25);
    if (Math.max(w, h) * this.cdpr > 2000) this.cdpr = 2000 / Math.max(w, h);
    this.cw = Math.max(2, Math.round(w * this.cdpr));
    this.ch = Math.max(2, Math.round(h * this.cdpr));
    this.canvas.width = this.cw; this.canvas.height = this.ch;
    this.tex.dispose();
    this.tex.needsUpdate = true;
    this.layout();
  }

  private font(weight: number): string { return `${weight} ${this.fontSize}px ${this.zh ? FONT_ZH : FONT_LATIN}`; }

  layout(): void {
    const live = this.letters.filter(L => !L.dying);
    if (!live.length) return;
    const word = live.map(L => L.ch).join('');
    const fam = this.zh ? FONT_ZH : FONT_LATIN;
    const g = this.g;
    g.font = `640 100px ${fam}`;
    const w100 = g.measureText(word).width || 1;
    this.fontSize = Math.min(this.cw * 0.78 / w100 * 100, this.ch * (this.zh ? 0.3 : 0.22));
    g.font = `640 ${this.fontSize}px ${fam}`;
    const x0 = (this.cw - g.measureText(word).width) / 2;
    const cy = this.ch * 0.3;
    live.forEach((L, i) => {
      const a = g.measureText(word.slice(0, i)).width, b = g.measureText(word.slice(0, i + 1)).width;
      L.rx = x0 + (a + b) / 2;
      L.ry = cy + this.fontSize * (this.zh ? 0.36 : 0.34);
    });
    this.dirty = true;
  }

  /** Swaps the prompt: old letters fall away, new ones drop in. */
  setWord(word: string, zh: boolean): void {
    for (const L of this.letters) {
      if (L.dying) continue;
      L.dying = true;
      L.vy = -900 * this.cdpr * (0.6 + Math.random() * 0.5);
      L.vx = (Math.random() - 0.5) * 600 * this.cdpr;
      L.vr = (Math.random() - 0.5) * 10;
    }
    this.zh = zh;
    const rm = this.reduceMotion;
    this.letters.push(...[...word].map((ch, i) => ({
      ch, rx: 0, ry: 0, ox: 0, oy: rm ? 0 : -this.ch * 0.8, vx: 0, vy: 0,
      rot: rm ? 0 : (Math.random() - 0.5) * 0.8, vr: 0, w: 420, alpha: 1, dying: false, delay: rm ? 0 : 0.12 + i * 0.05
    })));
    this.layout();
    if (zh && document.fonts?.load) document.fonts.load('600 100px "Noto Sans SC"', word).then(() => this.layout()).catch(() => {});
  }

  /** A little hop for the letters when the question changes but the prompt stays. */
  kick(): void {
    for (const L of this.letters) if (!L.dying) { L.vy -= rand(500, 900) * this.cdpr; L.vr += rand(-4, 4); }
  }

  /** Blows every letter away from a point. */
  blast(x: number, y: number): void {
    for (const L of this.letters) {
      if (L.dying) continue;
      const lx = L.rx + L.ox, ly = L.ry - this.fontSize * 0.35 + L.oy;
      const dx = lx - x, dy = ly - y, d = Math.hypot(dx, dy) || 1, sp = rand(900, 1700) * this.cdpr;
      L.dying = true; L.vx = dx / d * sp; L.vy = dy / d * sp - 500 * this.cdpr; L.vr = rand(-14, 14);
      if (L.delay > 0) L.alpha = 0;
    }
  }

  burst(x: number, y: number, r: number, colors: string[], n: number, big: boolean): void {
    this.rings.push({ x, y, r: r * 0.12, life: 1 });
    if (big) this.rings.push({ x, y, r: r * 0.05, life: 0.8, slow: true });
    const kk = this.ch / 900;
    for (let i = 0; i < (this.reduceMotion ? 3 : n); i++) {
      const a = rand(0, Math.PI * 2), sp = rand(450, 1250) * this.cdpr;
      this.shards.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200 * this.cdpr, rot: rand(0, 6.28), vr: rand(-16, 16), len: rand(16, 44) * kk * this.cdpr, life: 1, c: colors[i % colors.length] });
    }
  }

  /** Paint droplets flying out of the hole in a popped core. */
  spew(x: number, y: number, nx: number, ny: number, count: number, bvx: number, bvy: number): void {
    const kk = this.ch / 900;
    for (let i = 0; i < count; i++) {
      const a = Math.atan2(ny, nx) + rand(-0.45, 0.45), sp = rand(700, 1600) * this.cdpr;
      this.droplets.push({ x, y, vx: Math.cos(a) * sp - bvx * 60 * this.cdpr, vy: Math.sin(a) * sp + bvy * 60 * this.cdpr, r: rand(5, 15) * kk * this.cdpr, tr: rand(50, 170) * kk * this.cdpr, life: rand(0.3, 0.8) });
    }
  }

  get flooding(): boolean { return !!this.flood; }
  get floodDone(): boolean { return !!this.flood && this.flood.t >= this.flood.dur; }

  startFlood(x: number, y: number): void {
    const fx = Math.max(0, Math.min(this.cw, x)), fy = Math.max(0, Math.min(this.ch, y));
    const far = Math.max(Math.hypot(fx, fy), Math.hypot(this.cw - fx, fy), Math.hypot(fx, this.ch - fy), Math.hypot(this.cw - fx, this.ch - fy));
    this.flood = { x: fx, y: fy, t: 0, dur: this.reduceMotion ? 0.3 : 0.65, R: far * 1.05 };
  }

  /** Makes the new page colour official and clears the paint. */
  setColors(bg: string, ink: string, shadow: string): void {
    const shadowChanged = shadow !== this.colors.shadow;
    this.colors.bg = bg; this.colors.ink = ink; this.colors.shadow = shadow;
    this.droplets = []; this.splats = []; this.flood = null;
    this.dirty = true;
    if (shadowChanged) this.drawShadow();
  }

  update(dt: number, ball: BallView): void {
    let rem = dt;
    while (rem > 1e-6) { const h = Math.min(rem, 1 / 120); this.updateLetters(h, ball); rem -= h; }
    this.updateEffects(dt);
  }

  private updateLetters(dt: number, ball: BallView): void {
    const KS = 150, CS = 11, cy = this.fontSize * 0.35, c = this.cdpr;
    for (const L of this.letters) {
      if (L.dying) { L.vy += 4200 * c * dt; L.ox += L.vx * dt; L.oy += L.vy * dt; L.rot += L.vr * dt; L.alpha -= dt * 1.6; continue; }
      if (L.delay > 0) { L.delay -= dt; continue; }
      const x = L.rx + L.ox, y = L.ry - cy + L.oy, dx = x - ball.x, dy = y - ball.y, dist = Math.hypot(dx, dy) || 1;
      let ax = -KS * L.ox - CS * L.vx, ay = -KS * L.oy - CS * L.vy;
      const inf = ball.r * 1.7;
      if (ball.pushing && dist < inf) {
        const f = 1 - dist / inf, push = f * f * ball.r * 50;
        ax += dx / dist * push + ball.vx * f * 3; ay += dy / dist * push + ball.vy * f * 3;
      }
      L.vx += ax * dt; L.vy += ay * dt; L.ox += L.vx * dt; L.oy += L.vy * dt;
      L.vr += (-90 * L.rot - 10 * L.vr + ax * 0.0009 / c) * dt; L.rot += L.vr * dt;
      const prox = ball.pushing ? Math.max(0, 1 - dist / (ball.r * 3)) : 0;
      L.w += (380 + 400 * Math.pow(prox, 1.2) - L.w) * Math.min(1, dt * 7);
    }
    this.letters = this.letters.filter(L => L.alpha > 0);
  }

  private updateEffects(dt: number): void {
    const g = 1500 * this.cdpr, { cw, ch } = this;
    for (const d of this.droplets) {
      d.vy += g * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt;
      if (d.life <= 0 || d.x < 0 || d.x > cw || d.y < 0 || d.y > ch) {
        this.splats.push({ x: Math.max(0, Math.min(cw, d.x)), y: Math.max(0, Math.min(ch, d.y)), r: d.r, tr: d.tr, ph: rand(0, 6.28) });
        d.dead = true;
      }
    }
    this.droplets = this.droplets.filter(d => !d.dead);
    for (const s of this.splats) s.r += (s.tr - s.r) * Math.min(1, dt * 5);
    for (const r of this.rings) { r.r += (r.slow ? 520 : 1400) * this.cdpr * dt; r.life -= dt * (r.slow ? 1.8 : 2.8); }
    this.rings = this.rings.filter(r => r.life > 0);
    for (const s of this.shards) { s.vy += g * 0.8 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.rot += s.vr * dt; s.life -= dt * 1.3; }
    this.shards = this.shards.filter(s => s.life > 0);
    if (this.flood) this.flood.t += dt;
  }

  private get effectsActive(): boolean {
    return !!(this.droplets.length || this.splats.length || this.rings.length || this.shards.length || this.flood);
  }

  private signature(): string {
    const c = this.colors;
    let s = `${c.bg}|${c.ink}`;
    for (const L of this.letters) {
      if (!L.dying && L.delay > 0) continue;
      s += `|${Math.round(L.ox * 2)},${Math.round(L.oy * 2)},${Math.round(L.rot * 400)},${Math.round(L.w / 10)},${Math.round(L.alpha * 40)}`;
    }
    return s;
  }

  /** Redraws and re-uploads the texture only if something visible changed. Returns whether it did. */
  render(ball: BallView): boolean {
    this.placeShadow(ball);
    const sig = this.signature();
    if (!this.dirty && !this.effectsActive && sig === this.lastSig) return false;
    this.draw();
    this.tex.needsUpdate = true;
    this.lastSig = sig; this.dirty = false;
    return true;
  }

  private draw(): void {
    const g = this.g, { cw, ch } = this, col = this.colors;
    g.globalAlpha = 1; g.fillStyle = col.bg; g.fillRect(0, 0, cw, ch);
    if (this.splats.length || this.flood) {
      g.fillStyle = this.floodColor;
      for (const s of this.splats) {
        const wob = 1 + 0.08 * Math.sin(s.ph + s.r * 0.05);
        g.beginPath(); g.ellipse(s.x, s.y, s.r * wob, s.r / wob, s.ph, 0, Math.PI * 2); g.fill();
      }
      if (this.flood) {
        const u = Math.min(1, this.flood.t / this.flood.dur), e = 1 - Math.pow(1 - u, 3);
        g.beginPath(); g.arc(this.flood.x, this.flood.y, this.flood.R * e, 0, Math.PI * 2); g.fill();
      }
    }
    g.fillStyle = col.ink; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const cy = this.fontSize * 0.35;
    for (const L of this.letters) {
      if ((!L.dying && L.delay > 0) || L.ch === ' ') continue;
      g.save();
      g.globalAlpha = Math.max(0, Math.min(1, L.alpha));
      g.translate(L.rx + L.ox, L.ry - cy + L.oy); g.rotate(L.rot);
      g.font = this.font(Math.round(L.w / 10) * 10);
      g.fillText(L.ch, 0, cy);
      g.restore();
    }
    g.globalAlpha = 1;
    if (this.droplets.length) {
      g.fillStyle = this.floodColor;
      for (const d of this.droplets) { g.beginPath(); g.arc(d.x, d.y, d.r, 0, Math.PI * 2); g.fill(); }
    }
    for (const r of this.rings) {
      g.strokeStyle = `rgba(255,255,255,${Math.max(0, r.life) * 0.85})`;
      g.lineWidth = Math.max(1, 12 * r.life * this.cdpr);
      g.beginPath(); g.arc(r.x, r.y, r.r, 0, Math.PI * 2); g.stroke();
    }
    if (this.shards.length) {
      g.lineCap = 'round';
      for (const s of this.shards) {
        g.save(); g.globalAlpha = Math.min(1, s.life * 1.5); g.strokeStyle = s.c;
        g.translate(s.x, s.y); g.rotate(s.rot); g.lineWidth = s.len * 0.3;
        g.beginPath(); g.moveTo(-s.len / 2, 0); g.quadraticCurveTo(0, -s.len * 0.5, s.len / 2, 0); g.stroke();
        g.restore();
      }
      g.globalAlpha = 1;
    }
  }
}
