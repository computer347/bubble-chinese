import * as THREE from 'three';

/** One drifting sprite: where it is, how big, how it sways. */
interface Mote { s: THREE.Sprite; x: number; y: number; z: number; size: number; speed: number; sway: number; phase: number; alpha: number }

const COUNT = 14;

/**
 * A soap bubble: clear in the middle, a bright rim tinted like a film, a highlight up and to the left.
 * On a pale ground the rim is drawn in deeper film colours, or it would vanish.
 */
function bubbleTexture(light = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rim = g.createRadialGradient(128, 128, 70, 128, 128, 126);
  rim.addColorStop(0, 'rgba(255,255,255,0)');
  rim.addColorStop(0.72, 'rgba(255,255,255,0.05)');
  rim.addColorStop(0.9, light ? 'rgba(170,90,200,0.45)' : 'rgba(255,214,245,0.55)');
  rim.addColorStop(0.97, light ? 'rgba(60,130,220,0.6)' : 'rgba(201,243,255,0.8)');
  rim.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rim; g.fillRect(0, 0, 256, 256);
  const hi = g.createRadialGradient(88, 80, 2, 88, 80, 34);
  hi.addColorStop(0, 'rgba(255,255,255,0.9)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hi; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A wide, soft wash of colour: full at the heart, gone at the edge (tinted per field). */
function fieldTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const wash = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  wash.addColorStop(0, 'rgba(255,255,255,1)');
  wash.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  wash.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = wash; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The colour fields: soap-film tints for the bubble style, faint lamplight and cinnabar for ink. */
/**
 * The colour fields for each style and mode. Kept faint enough that the ground stays clearly light or
 * dark: soap-film tints for bubbles, lamplight and cinnabar for ink.
 */
const FIELDS: Record<'bubble' | 'ink', Record<'light' | 'dark', { color: string; alpha: number }[]>> = {
  bubble: {
    dark: [{ color: '#FF3FA4', alpha: 0.22 }, { color: '#1FB8FF', alpha: 0.2 }, { color: '#7A4CFF', alpha: 0.26 }, { color: '#FF8A4A', alpha: 0.12 }],
    light: [{ color: '#FF8AD0', alpha: 0.3 }, { color: '#7FE3FF', alpha: 0.32 }, { color: '#B9A2FF', alpha: 0.32 }, { color: '#FFC79A', alpha: 0.26 }]
  },
  ink: {
    light: [{ color: '#F0B35A', alpha: 0.16 }, { color: '#C8412F', alpha: 0.08 }, { color: '#E9C98A', alpha: 0.14 }, { color: '#B5562E', alpha: 0.06 }],
    dark: [{ color: '#E08A2A', alpha: 0.14 }, { color: '#B8321F', alpha: 0.12 }, { color: '#F0B35A', alpha: 0.08 }, { color: '#7A2A14', alpha: 0.1 }]
  }
};

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
  /** A few large washes of colour that wander slowly, so the glass has light to bend. */
  private readonly fields: { s: THREE.Sprite; phase: number; alpha: number }[] = [];
  private readonly bubbleMat: THREE.SpriteMaterial;
  private readonly bubbleLightMat: THREE.SpriteMaterial;
  private readonly glowMat: THREE.SpriteMaterial;
  private ink = false;
  private dark = true;
  /** 0 hidden … 1 shown, eased toward `target`. */
  private level = 0;
  private target = 0;
  private w = 10;
  private h = 10;

  constructor(private readonly reduceMotion: boolean) {
    this.bubbleMat = new THREE.SpriteMaterial({ map: bubbleTexture(), transparent: true, depthWrite: false, toneMapped: false });
    this.bubbleLightMat = new THREE.SpriteMaterial({ map: bubbleTexture(true), transparent: true, depthWrite: false, toneMapped: false });
    this.glowMat = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < COUNT; i++) {
      const s = new THREE.Sprite(this.bubbleMat.clone());
      s.renderOrder = -1;
      this.group.add(s);
      this.motes.push({ s, x: 0, y: 0, z: 0, size: 1, speed: 0, sway: 0, phase: 0, alpha: 0 });
    }
    const wash = fieldTexture();
    for (let i = 0; i < FIELDS.bubble.dark.length; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: wash, transparent: true, depthWrite: false, toneMapped: false }));
      s.renderOrder = -2;
      this.group.add(s);
      this.fields.push({ s, phase: i * 1.7 + 0.4, alpha: 0 });
    }
    this.tintFields();
    this.group.visible = false;
  }

  private tintFields(): void {
    FIELDS[this.ink ? 'ink' : 'bubble'][this.dark ? 'dark' : 'light'].forEach((f, i) => {
      (this.fields[i].s.material as THREE.SpriteMaterial).color.set(f.color);
      this.fields[i].alpha = f.alpha;
    });
  }

  /** Bubbles, or lantern glows; on a dark ground or a light one. */
  setStyle(ink: boolean, dark = true): void {
    this.ink = ink;
    this.dark = dark;
    for (const m of this.motes) {
      const mat = (ink ? this.glowMat : dark ? this.bubbleMat : this.bubbleLightMat).clone();
      (m.s.material as THREE.SpriteMaterial).dispose();
      m.s.material = mat;
    }
    this.tintFields();
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
    // the fields drift on slow loops across the screen, never quite repeating
    const w = this.w / 1.35, h = this.h / 1.35, size = Math.max(w, h) * 0.85;
    const slow = this.reduceMotion ? 0 : t;
    for (const f of this.fields) {
      f.s.position.set(Math.sin(slow * 0.043 + f.phase) * w * 0.38, Math.cos(slow * 0.031 + f.phase * 1.3) * h * 0.36, -3.1);
      f.s.scale.setScalar(size * (0.9 + 0.15 * Math.sin(slow * 0.07 + f.phase)));
      (f.s.material as THREE.SpriteMaterial).opacity = f.alpha * this.level;
    }
    return true;
  }
}
