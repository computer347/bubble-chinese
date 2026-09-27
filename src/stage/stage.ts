import * as THREE from 'three';
import { gsap } from 'gsap';
import { PALETTES, type Palette } from '../content/palettes';
import { Environment } from '../render/environment';
import { Backdrop, type BallView } from '../render/backdrop';
import { rand } from '../game/random';

/** Radius of a bubble at rest. The view is sized so one fits with room for the answers around it. */
export const R = 1.1;
const TAN = Math.tan(THREE.MathUtils.degToRad(17.5));

export interface StageOptions {
  canvas: HTMLCanvasElement;
  reduceMotion: boolean;
  /** End-to-end test mode: larger simulation steps so animations finish on slow software rendering. */
  e2e?: boolean;
}

/** Lets the performance guard lower what the scene draws before it lowers the resolution. */
export interface PerfHooks {
  /** True while dropping detail would be visible (mid-drag, mid-pop). */
  busy(): boolean;
  /** Drops one step of detail; false when there is none left to drop. */
  lowerDetail(): boolean;
}

/**
 * The renderer, a camera sized around a bubble, the backdrop wall with the palette it shares
 * with the page, screen shake, and the frame loop with its performance guard.
 */
export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly reduceMotion: boolean;
  readonly e2e: boolean;
  /** Longest step a frame may take, so a stall never explodes the simulation. */
  readonly maxFrameDt: number;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  readonly env: Environment;
  readonly backdrop: Backdrop;
  /** Visible width and height at z = 0, the camera distance, and the bubble's resting height. */
  visW = 1; visH = 1; camZ = 8; homeY = 0;
  palIdx = 0;
  /** The current style's palettes. */
  palettes: readonly Palette[] = PALETTES;
  perf: PerfHooks | null = null;
  /** True while the scene is at rest (the bubble asleep or hidden). With the backdrop unchanged too, it is drawn every other frame. */
  idle: (() => boolean) | null = null;
  private frameNo = 0;
  private pixelRatio: number;
  private shakeAmt = 0;
  private readonly resizeListeners: Array<() => void> = [];
  private readonly _p = new THREE.Vector3();

  constructor(opts: StageOptions) {
    this.canvas = opts.canvas;
    this.reduceMotion = opts.reduceMotion;
    this.e2e = !!opts.e2e;
    this.maxFrameDt = opts.e2e ? 1 / 4 : 1 / 30;
    // in tests, animations follow the wall clock even when software rendering drops to a few frames a second
    if (opts.e2e) gsap.ticker.lagSmoothing(0);
    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: this.e2e });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.env = new Environment(this.renderer, this.scene);
    this.backdrop = new Backdrop(opts.reduceMotion);
    this.scene.add(this.backdrop.mesh);
    window.addEventListener('resize', () => this.resize());
  }

  /** Called after every resize, once the camera and backdrop are updated. */
  onResize(fn: () => void): void { this.resizeListeners.push(fn); }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = aspect;
    this.visH = aspect >= 1 ? (2 * R) / 0.4 : (2 * R) / (0.6 * aspect);
    this.visW = this.visH * aspect;
    this.camZ = this.visH / (2 * TAN);
    this.homeY = -this.visH * 0.09;
    this.camera.position.set(0, 0, this.camZ);
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    const hp = 2 * (this.camZ - this.backdrop.mesh.position.z) * TAN;
    this.backdrop.mesh.scale.set(hp * aspect, hp, 1);
    this.backdrop.resize(w, h);
    for (const fn of this.resizeListeners) fn();
  }

  /** Recolours the backdrop, the page and the lighting. */
  commitPalette(i: number, instant: boolean): void {
    this.palIdx = i;
    const p = this.palettes[i];
    this.backdrop.setColors(p.bg, p.ui, p.shadow);
    gsap.to(document.documentElement, { '--bg': p.bg, '--ui': p.ui, '--ui-dim': p.dim, '--line': p.line, duration: instant ? 0 : 0.45, ease: 'power2.out' });
    this.renderer.setClearColor(p.bg);
    this.env.build(p.bg);
  }

  /** A palette other than the current one. */
  otherPalette(): number {
    let i: number;
    do { i = Math.floor(Math.random() * this.palettes.length); } while (i === this.palIdx);
    return i;
  }

  /** A world point in backdrop canvas pixels. */
  toCanvas(v: THREE.Vector3): { x: number; y: number } {
    const p = this._p.copy(v).project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.backdrop.cw, y: (1 - (p.y * 0.5 + 0.5)) * this.backdrop.ch };
  }

  /** Backdrop pixels per world unit at depth z. */
  pixelsPerUnit(z: number): number { return this.backdrop.ch / (2 * (this.camZ - z) * TAN); }

  shake(amount: number): void { if (!this.reduceMotion) this.shakeAmt = amount; }

  /**
   * Starts the frame loop. `tick` advances the scene by dt and says where the ball is,
   * so the backdrop letters can get out of its way.
   */
  run(tick: (dt: number) => BallView): void {
    let last = performance.now();
    let failures = 0;
    const step = (now: number): void => {
      const rawMs = now - last;
      const dt = Math.min(rawMs / 1000, this.maxFrameDt);
      last = now;
      this.guard(rawMs, dt);
      const ball = tick(dt);
      this.backdrop.update(dt, ball);
      const redrawn = this.backdrop.render(ball);
      // at rest only the slow bob moves: half the frame rate looks the same and halves the GPU work
      if (!redrawn && this.shakeAmt === 0 && this.idle?.() && (this.frameNo++ & 1)) return;
      const camZ = this.camZ;
      if (this.shakeAmt > 0) {
        this.shakeAmt = Math.max(0, this.shakeAmt - dt * 4);
        this.camera.position.set(rand(-1, 1) * 0.09 * this.shakeAmt, rand(-1, 1) * 0.09 * this.shakeAmt, camZ);
      } else this.camera.position.set(0, 0, camZ);
      this.camera.updateMatrixWorld();
      this.renderer.render(this.scene, this.camera);
    };
    // the next frame is always asked for, so one frame that throws can never freeze the app;
    // the error is still reported (the first few times), so it gets seen and fixed
    const frame = (now: number): void => {
      try { step(now); }
      catch (e) { if (failures++ < 5) console.error('Frame failed:', e); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(t => { last = t; frame(t); });
  }

  /* ---------- performance guard: drop detail, then resolution, if frames stay slow ---------- */
  private ema = 16;
  private slowT = 0;
  private guard(rawMs: number, dt: number): void {
    if (this.e2e || document.hidden || rawMs > 250) return;
    this.ema = this.ema * 0.94 + rawMs * 0.06;
    if (this.ema > 26) this.slowT += dt; else this.slowT = Math.max(0, this.slowT - dt * 0.5);
    if (this.slowT > 2.5 && !this.perf?.busy()) {
      this.slowT = 0; this.ema = 16;
      if (this.perf?.lowerDetail()) return;
      if (this.pixelRatio > 1) { this.pixelRatio = 1; this.renderer.setPixelRatio(1); this.resize(); }
    }
  }
}
