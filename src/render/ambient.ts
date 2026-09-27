import * as THREE from 'three';

/** One drifting sprite: where it is, how big, how it sways. */
interface Mote { s: THREE.Sprite; x: number; y: number; z: number; size: number; speed: number; sway: number; phase: number; alpha: number }

const COUNT = 14;

/** A soap bubble: clear in the middle, a bright rim tinted like a film, a highlight up and to the left. */
function bubbleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rim = g.createRadialGradient(128, 128, 70, 128, 128, 126);
  rim.addColorStop(0, 'rgba(255,255,255,0)');
  rim.addColorStop(0.72, 'rgba(255,255,255,0.05)');
  rim.addColorStop(0.9, 'rgba(255,214,245,0.55)');
  rim.addColorStop(0.97, 'rgba(201,243,255,0.8)');
  rim.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rim; g.fillRect(0, 0, 256, 256);
  const hi = g.createRadialGradient(88, 80, 2, 88, 80, 34);
  hi.addColorStop(0, 'rgba(255,255,255,0.9)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hi; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A lantern's glow seen through paper: warm at the heart, fading to nothing. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const glow = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255,196,120,0.95)');
  glow.addColorStop(0.25, 'rgba(236,96,48,0.55)');
  glow.addColorStop(0.6, 'rgba(200,40,30,0.16)');
  glow.addColorStop(1, 'rgba(200,40,30,0)');
  g.fillStyle = glow; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The world behind the tabs: a few soft bubbles (or lantern glows, in the ink style) drifting
 * slowly upward between the backdrop and the glass, so the page is never a flat colour and the
 * glass has something to show through it. Sprites from two small textures, drawn once; a few dozen
 * vertices in all, so it costs next to nothing, and it fades away while a task is on screen.
 */
export class Ambient {
  readonly group = new THREE.Group();
  private readonly motes: Mote[] = [];
  private readonly bubbleMat: THREE.SpriteMaterial;
  private readonly glowMat: THREE.SpriteMaterial;
  private ink = false;
  /** 0 hidden … 1 shown, eased toward `target`. */
  private level = 0;
  private target = 0;
  private w = 10;
  private h = 10;

  constructor(private readonly reduceMotion: boolean) {
    this.bubbleMat = new THREE.SpriteMaterial({ map: bubbleTexture(), transparent: true, depthWrite: false, toneMapped: false });
    this.glowMat = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < COUNT; i++) {
      const s = new THREE.Sprite(this.bubbleMat.clone());
      s.renderOrder = -1;
      this.group.add(s);
      this.motes.push({ s, x: 0, y: 0, z: 0, size: 1, speed: 0, sway: 0, phase: 0, alpha: 0 });
    }
    this.group.visible = false;
  }

  /** Bubbles, or lantern glows. */
  setStyle(ink: boolean): void {
    this.ink = ink;
    for (const m of this.motes) {
      const mat = (ink ? this.glowMat : this.bubbleMat).clone();
      (m.s.material as THREE.SpriteMaterial).dispose();
      m.s.material = mat;
    }
    this.scatter(true);
  }

  /** The visible area at the sprites' depth, so they fill the screen on any shape. */
  resize(visW: number, visH: number): void { this.w = visW * 1.35; this.h = visH * 1.35; this.scatter(true); }

  show(on: boolean): void { this.target = on ? 1 : 0; if (on) this.group.visible = true; }

  private place(m: Mote, anywhere: boolean): void {
    m.size = this.ink ? 0.5 + Math.random() * 1.6 : 0.25 + Math.random() * 1.1;
    m.x = (Math.random() - 0.5) * this.w;
    m.y = anywhere ? (Math.random() - 0.5) * this.h : -this.h / 2 - m.size;
    m.z = -2.9 + Math.random() * 1.2;
    m.speed = (this.ink ? 0.06 : 0.1) + Math.random() * 0.12;
    m.sway = 0.1 + Math.random() * 0.25;
    m.phase = Math.random() * Math.PI * 2;
    m.alpha = this.ink ? 0.35 + Math.random() * 0.45 : 0.3 + Math.random() * 0.5;
  }

  private scatter(anywhere: boolean): void { for (const m of this.motes) this.place(m, anywhere); }

  /** Drifts the motes; returns false when there is nothing on screen (so the frame can rest). */
  update(dt: number, t: number): boolean {
    this.level += (this.target - this.level) * Math.min(1, dt * 3);
    if (this.level < 0.01 && this.target === 0) { this.group.visible = false; return false; }
    const drift = this.reduceMotion ? 0 : 1;
    for (const m of this.motes) {
      m.y += m.speed * dt * drift;
      if (m.y - m.size > this.h / 2) this.place(m, false);
      m.s.position.set(m.x + Math.sin(t * 0.4 + m.phase) * m.sway * drift, m.y, m.z);
      m.s.scale.setScalar(m.size);
      (m.s.material as THREE.SpriteMaterial).opacity = m.alpha * this.level;
    }
    return true;
  }
}
