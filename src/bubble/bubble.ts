import * as THREE from 'three';
import { gsap } from 'gsap';
import { PALETTES, PHYS, type Physics } from '../content/palettes';
import { SoftBody } from '../engine/softbody';
import type { Sound } from '../audio/sound';
import { filmMaterial, coreMaterial, applyCore, type FilmMaterial } from '../render/materials';
import type { BallView } from '../render/backdrop';
import { R, type Stage } from '../stage/stage';
import { rand } from '../game/random';
import { smooth } from '../ui/dom';

export type Edge = 'top' | 'right' | 'bottom' | 'left';
export const EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];
const EDGE_DIR: Record<Edge, [number, number]> = { top: [0, 1], bottom: [0, -1], left: [-1, 0], right: [1, 0] };

/**
 * hidden: nothing on screen. intro: inflating. live: can be pulled. between: a film just popped.
 * popping: the core burst and the bubble is flying off.
 */
export type BubbleState = 'hidden' | 'intro' | 'live' | 'between' | 'popping';

/** What the bubble tells the mode that owns it. */
export interface BubbleHandler {
  /** The skin was stretched all the way to an edge. The mode answers with reject, popFilm or popCore. */
  reach(edge: Edge, vertex: number): void;
  /** The core has burst and the next colour has flooded the screen. */
  popped(): void;
  /** The bubble was tapped, or poked with Space. */
  poked?(): void;
}

export interface BubbleOptions {
  /** Where each edge's answer starts, in normalised screen units (0 centre, 1 the screen edge). Read every frame. */
  thresholds: Record<Edge, number>;
  /** How far the skin is stretched toward an edge (0–1), every frame. */
  onTension(edge: Edge | null, hot: number): void;
  /** The mesh detail changed (by the slider or the performance guard). */
  onDetail(index: number, points: number): void;
}

interface Layer { mesh: THREE.Mesh; mat: THREE.Material; film: boolean; sc: { v: number } }

/** The most layers a bubble can have: films around one core. */
export const MAX_LAYERS = 6;

/**
 * A soft, layered bubble: soap films around a coloured core, all sharing one soft-body mesh.
 * It sits pinned in the middle of the stage; you drag it (or it is pulled) toward one of four edges,
 * and when the skin reaches an edge it asks its handler what that means.
 */
export class Bubble {
  state: BubbleState = 'hidden';
  handler: BubbleHandler | null = null;
  /** Layers still on the bubble, and how many it has had in all (grows with addLayer). */
  get layers(): number { return this.stack.length; }
  totalLayers = 3;
  asleep = false;
  get detailIndex(): number { return this.soft.detailIndex; }
  get dragging(): boolean { return this._dragging; }

  private readonly stage: Stage;
  private readonly sound: Sound;
  private readonly opts: BubbleOptions;
  private readonly rm: number;
  private soft = new SoftBody(1, R);
  private readonly geo = new THREE.BufferGeometry();
  private posAttr!: THREE.BufferAttribute;
  private nrmAttr!: THREE.BufferAttribute;
  private readonly coreMat = coreMaterial(PALETTES[0].mat);
  private baseEmissive = PALETTES[0].mat.emissive;
  private readonly body = new THREE.Group();
  private readonly films: Layer[];
  private readonly core: Layer;
  private readonly allLayers: Layer[];
  private stack: Layer[] = [];
  private readonly bs = { s: 1 };

  // centre of the body and the surface simulation
  private readonly P: Physics = { ...PHYS.jelly };
  private kMul = 1;
  private cMul = 1;
  private readonly C = new THREE.Vector3();
  private readonly Vc = new THREE.Vector3();
  private readonly Pw = new THREE.Vector3();
  private readonly thrust = new THREE.Vector3();
  private simTime = 0;
  private _dragging = false;
  private autoDrag = false;
  private grabVi = 0;
  private sleepFrames = 0;
  private acc = 0;
  private cooldown = 0;
  private tension = 0;
  private readonly grabTarget = { x: 0, y: 0, z: 0 };

  // popping the core
  private readonly POP_DUR: number;
  private popT = 0;
  private holeV = 0;
  private pendingPal = 0;
  private readonly spin = new THREE.Vector3();

  // scratch
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly _v = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _n = new THREE.Vector3();
  private readonly _q = new THREE.Vector3();
  private readonly _p = new THREE.Vector3();
  private readonly _dq = new THREE.Quaternion();
  private readonly _axis = new THREE.Vector3();
  private readonly view: BallView = { x: 0, y: 0, r: 100, vx: 0, vy: 0, visible: true, pushing: true };

  constructor(stage: Stage, sound: Sound, opts: BubbleOptions) {
    this.stage = stage;
    this.sound = sound;
    this.opts = opts;
    this.rm = stage.reduceMotion ? 0.45 : 1;
    this.POP_DUR = stage.reduceMotion ? 0.8 : 1.45;
    stage.scene.add(this.body);
    const makeLayer = (mat: THREE.Material, film: boolean): Layer => {
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.frustumCulled = false; mesh.visible = false;
      this.body.add(mesh);
      return { mesh, mat, film, sc: { v: 1 } };
    };
    this.films = Array.from({ length: MAX_LAYERS - 1 }, (_, j) => makeLayer(filmMaterial(0.34 + (j % 2) * 0.07), true));
    this.core = makeLayer(this.coreMat, false);
    this.allLayers = [...this.films, this.core];
    this.body.visible = false;
    this.setWobble(0.55);
    this.bindInput();
    stage.onResize(() => this.wake());
  }

  private fade(L: Layer) { return (L.mat as FilmMaterial).userData.fade; }

  private bindGeometry(): void {
    const { soft, geo } = this;
    this.posAttr = new THREE.BufferAttribute(soft.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.BufferAttribute(soft.normals, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('normal', this.nrmAttr);
    geo.setIndex(new THREE.BufferAttribute(soft.index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 4);
  }

  /** Mesh resolution: an index into DETAILS. */
  setDetail(idx: number): void {
    this.soft = new SoftBody(idx, R);
    this.bindGeometry();
    this.endDrag();
    this.wake();
    this.opts.onDetail(idx, this.soft.n);
  }

  /** From stiff (0) to floppy (1). */
  setWobble(v: number): void {
    this.kMul = THREE.MathUtils.lerp(2.3, 0.42, v);
    this.cMul = THREE.MathUtils.lerp(1.9, 0.55, v);
    this.wake();
  }

  private relayout(animate: boolean): void {
    const m = this.stack.length;
    const layerTarget = (p: number) => (m <= 1 ? 1 : 1 - p * Math.min(0.21, 0.42 / (m - 1)));
    this.stack.forEach((L, p) => {
      L.mesh.renderOrder = L.film ? 20 - p : 0;
      gsap.killTweensOf(L.sc);
      const t = layerTarget(p);
      if (animate) gsap.to(L.sc, { v: t, duration: this.stage.reduceMotion ? 0.2 : 0.8, ease: 'elastic.out(1,.5)' });
      else L.sc.v = t;
    });
  }

  wake(): void { this.sleepFrames = 0; this.asleep = false; }
  private outerScale(): number { return (this.stack[0] ? this.stack[0].sc.v : 1) * this.bs.s; }

  private step(dt: number): number {
    const { C, Vc, Pw, thrust, soft, stage } = this;
    this.simTime += dt;
    let ax: number, ay: number, az: number;
    const hy = stage.homeY + (stage.reduceMotion ? 0 : Math.sin(this.simTime * 1.15) * 0.05);
    const R_ = soft.rest;
    if (this.state === 'popping') {
      ax = thrust.x - Vc.x * 1.25; ay = thrust.y - Vc.y * 1.25; az = -C.z * 8 - Vc.z * 3;
    } else if (this._dragging) {
      // pinned to the middle: a strong spring home, and only a slight lean toward the hand
      const g = this.grabVi * 3, s = this.outerScale();
      ax = 170 * (0 - C.x) + 14 * (Pw.x - C.x - R_[g] * s) - 18 * Vc.x;
      ay = 170 * (hy - C.y) + 14 * (Pw.y - C.y - R_[g + 1] * s) - 18 * Vc.y;
      az = 170 * (0 - C.z) - 18 * Vc.z;
    } else {
      const kC = this.state === 'intro' ? 60 : 150, cC = this.state === 'intro' ? 9 : 11;
      ax = kC * (0 - C.x) - cC * Vc.x; ay = kC * (hy - C.y) - cC * Vc.y; az = kC * (0 - C.z) - cC * Vc.z;
    }
    Vc.x += ax * dt; Vc.y += ay * dt; Vc.z += az * dt;
    C.x += Vc.x * dt; C.y += Vc.y * dt; C.z += Vc.z * dt;
    let grab = null;
    if (this._dragging) {
      const g = this.grabVi * 3, s = this.outerScale(), t = this.grabTarget;
      t.x = (Pw.x - C.x) / s - R_[g]; t.y = (Pw.y - C.y) / s - R_[g + 1]; t.z = (Pw.z - C.z) / s - R_[g + 2];
      grab = { vertex: this.grabVi, target: t, strength: 1600 };
    }
    const P = this.P;
    return soft.step(dt, { k: P.k * this.kMul, c: P.c * this.cMul, kc: P.kc, inertia: P.inertia }, ax, ay, az, grab, R * (this._dragging ? 3.2 : 0.95));
  }

  private impulse(vi: number, strength: number, s2: number): void { this.wake(); this.soft.impulse(vi, strength, s2); }
  /** A random point on the front of the bubble, facing you. */
  frontVertex(): number { const a = Math.random() * Math.PI * 2, r = Math.random() * 0.7; return this.soft.nearestDir(Math.cos(a) * r, Math.sin(a) * r, 1); }

  /** A wobble from the front, as if poked. */
  poke(strength = 30, spread = 0.01): void { this.impulse(this.frontVertex(), strength * this.rm, spread); }

  private placeBody(): void {
    const { body, bs } = this;
    body.position.copy(this.C);
    body.scale.setScalar(bs.s);
    for (const L of this.allLayers) if (L.mesh.visible) L.mesh.scale.setScalar(L.sc.v);
    body.updateMatrixWorld(true);
  }

  private walls(): void {
    if (this.state !== 'popping' || !this.body.visible) return;
    const { C, Vc, stage } = this;
    const rr = R * this.core.sc.v * this.bs.s * 0.9, mx = stage.visW / 2 - rr, my = stage.visH / 2 - rr;
    if (C.x > mx && Vc.x > 0) { C.x = mx; Vc.x *= -0.62; }
    if (C.x < -mx && Vc.x < 0) { C.x = -mx; Vc.x *= -0.62; }
    if (C.y > my && Vc.y > 0) { C.y = my; Vc.y *= -0.62; }
    if (C.y < -my && Vc.y < 0) { C.y = -my; Vc.y *= -0.62; }
  }

  private vertexWorld(v: number, layer: Layer, out: THREE.Vector3): THREE.Vector3 {
    const s = layer.sc.v, p = this.soft.positions;
    return out.set(p[v * 3] * s, p[v * 3 + 1] * s, p[v * 3 + 2] * s).applyMatrix4(this.body.matrixWorld);
  }

  /* ---------- pulling to an edge ---------- */

  /** Pulls the bubble toward an edge by itself (a chip click or an arrow key). */
  autoPull(edge: Edge): void {
    if (this.state !== 'live' || this._dragging || this.cooldown > 0) return;
    this.sound.unlock();
    const { stage, Pw } = this;
    const [dx, dy] = EDGE_DIR[edge];
    const vi = this.soft.nearestDir(dx * 0.85, dy * 0.85, 0.55);
    this.soft.setGrab(vi); this.grabVi = vi; this.wake();
    this.vertexWorld(vi, this.stack[0], Pw);
    this.plane.constant = -Pw.z;
    this._dragging = true; this.autoDrag = true;
    const f = (stage.camZ - Pw.z) / stage.camZ, reach = Math.min(0.98, this.opts.thresholds[edge] * 1.08);
    gsap.to(Pw, { x: dx * stage.visW / 2 * reach * f, y: dy * stage.visH / 2 * reach * f, duration: stage.reduceMotion ? 0.25 : 0.6, ease: 'power2.in' });
  }

  private checkEdge(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    let hotEdge: Edge | null = null, hot = 0;
    if (this._dragging && this.state === 'live') {
      const thr = this.opts.thresholds;
      this._q.copy(this.Pw).project(this.stage.camera);
      const rx = this._q.x, ry = this._q.y;
      const px = rx > 0 ? rx / thr.right : -rx / thr.left, py = ry > 0 ? ry / thr.top : -ry / thr.bottom;
      hotEdge = px > py ? (rx > 0 ? 'right' : 'left') : (ry > 0 ? 'top' : 'bottom');
      const pull = Math.max(px, py);
      hot = smooth(0.35, 1, pull);
      this.tension = hot;
      this.sound.squeak(hot);
      if (pull >= 1) {
        const edge = hotEdge, vi = this.grabVi;
        hotEdge = null; hot = 0;
        this.endDrag();
        this.handler?.reach(edge, vi);
      }
    } else if (this.tension > 0) {
      this.tension = Math.max(0, this.tension - dt * 3);
      if (this.tension === 0) this.sound.hush(); else this.sound.squeak(this.tension);
    }
    this.opts.onTension(hotEdge, hot);
    if (this.state !== 'popping') this.coreMat.emissiveIntensity = this.baseEmissive + this.tension * 0.6;
  }

  endDrag(): void {
    gsap.killTweensOf(this.Pw);
    this._dragging = false; this.autoDrag = false; this.soft.clearGrab();
    this.tension = 0; this.sound.hush();
  }

  /* ---------- answers ---------- */

  /** A wrong edge: the skin snaps back and the bubble shudders; pulling is paused briefly. */
  reject(vi: number): void {
    this.cooldown = 0.4;
    this.impulse(vi, -25 * this.rm, 0.04);
    this.impulse(this.frontVertex(), 18 * this.rm, 0.05);
  }

  /** Pops the outer soap film. `next` runs once the next layer is ready, just before it goes live. */
  popFilm(vi: number, next: () => void): void {
    this.state = 'between';
    this.body.updateMatrixWorld(true);
    const outer = this.stack[0];
    const p = this.stage.toCanvas(this.vertexWorld(vi, outer, this._v));
    this.stage.backdrop.burst(p.x, p.y, this.view.r, ['#ffffff', '#ffd6f5', '#c9f3ff', '#fff4c2'], 10, false);
    this.sound.pop(true);
    this.stack.shift();
    gsap.killTweensOf(outer.sc);
    gsap.to(this.fade(outer), { value: 0, duration: 0.18, ease: 'power2.out', onComplete: () => { outer.mesh.visible = false; } });
    gsap.to(outer.sc, { v: outer.sc.v * 1.25, duration: 0.18, ease: 'power2.out' });
    this.relayout(true);
    this.impulse(vi, 30 * this.rm, 0.04);
    this.stage.shake(0.35);
    setTimeout(() => { next(); this.state = 'live'; }, this.stage.reduceMotion ? 150 : 420);
  }

  /** Wraps the bubble in one more film. False when it already has the most it can hold. */
  addLayer(): boolean {
    if (this.stack.length >= MAX_LAYERS) return false;
    const film = this.films.find(f => !this.stack.includes(f))!;
    this.fade(film).value = 0;
    film.mesh.visible = true;
    film.sc.v = 1.3;
    this.stack.unshift(film);
    this.totalLayers++;
    this.relayout(true);
    gsap.to(this.fade(film), { value: 1, duration: 0.35, ease: 'power2.out' });
    this.sound.inflate();
    this.poke(22, 0.06);
    return true;
  }

  /* ---------- popping the core: deflate, fly away, spew the next palette ---------- */

  popCore(vi: number): void {
    const { stage } = this;
    this.state = 'popping'; this.popT = 0; this.holeV = vi;
    stage.canvas.style.cursor = 'default';
    gsap.killTweensOf(this.bs);
    this.spin.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(5);
    this.impulse(vi, 50 * this.rm, 0.012);
    const palIdx = stage.palIdx;
    this.pendingPal = stage.otherPalette();
    stage.backdrop.floodColor = PALETTES[this.pendingPal].bg;
    this.coreMat.emissiveIntensity = this.baseEmissive;
    this.body.updateMatrixWorld(true);
    const p = stage.toCanvas(this.vertexWorld(vi, this.core, this._v));
    stage.backdrop.burst(p.x, p.y, this.view.r, [PALETTES[palIdx].mat.color], 9, true);
    stage.backdrop.blast(p.x, p.y);
    stage.shake(1);
    this.sound.pop(false); this.sound.deflate(this.POP_DUR);
    this.stack = [];
  }

  private holeScreen(): { x: number; y: number; nx: number; ny: number } {
    const { holeV, _n, _v } = this;
    this.vertexWorld(holeV, this.core, _v);
    const nr = this.soft.normals;
    _n.set(nr[holeV * 3], nr[holeV * 3 + 1], nr[holeV * 3 + 2]).applyQuaternion(this.body.quaternion).normalize();
    const a = this.stage.toCanvas(_v);
    const b = this.stage.toCanvas(this._v2.copy(_v).addScaledVector(_n, 0.5));
    const nx = b.x - a.x, ny = b.y - a.y, l = Math.hypot(nx, ny) || 1;
    return { x: a.x, y: a.y, nx: nx / l, ny: ny / l };
  }

  private updatePop(dt: number): void {
    const { stage, spin, body } = this;
    const backdrop = stage.backdrop;
    this.popT += dt;
    const u = Math.min(this.popT / this.POP_DUR, 1);
    this.bs.s = Math.max(0.03, 1 - u * u * 0.97);
    body.updateMatrixWorld(true);
    const hp = this.holeScreen();
    this.thrust.copy(this._n).multiplyScalar(-(stage.reduceMotion ? 28 : 80) * (1 - u * 0.55) * (0.7 + 0.3 * Math.sin(this.popT * 31)));
    // the balloon tumbles as it empties
    spin.x += rand(-1, 1) * dt * 40; spin.y += rand(-1, 1) * dt * 40; spin.z += rand(-1, 1) * dt * 40;
    if (spin.length() > 10) spin.setLength(10);
    const ang = spin.length() * dt;
    if (ang > 0) { this._axis.copy(spin).normalize(); this._dq.setFromAxisAngle(this._axis, ang); body.quaternion.premultiply(this._dq); }
    if (Math.random() < 0.6) this.impulse(Math.floor(Math.random() * this.soft.n), rand(4, 14) * this.rm, 0.02);
    if (u < 0.98 && body.visible) backdrop.spew(hp.x, hp.y, hp.nx, hp.ny, stage.reduceMotion ? 1 : Math.round(5 * (1 - u * 0.5)), this.Vc.x, this.Vc.y);
    if (!backdrop.flooding && this.popT >= this.POP_DUR * 0.7) backdrop.startFlood(hp.x, hp.y);
    if (this.popT >= this.POP_DUR) body.visible = false;
    if (backdrop.floodDone && this.popT >= this.POP_DUR) {
      stage.commitPalette(this.pendingPal, false);
      this.state = 'hidden';
      this.handler?.popped();
    }
  }

  /* ---------- a new bubble ---------- */

  /** Inflates a new bubble with `films` soap films around the core, in the stage's current palette. */
  spawn(films = 2): void {
    const { stage } = this;
    const pal = PALETTES[stage.palIdx];
    applyCore(this.coreMat, pal.mat);
    this.baseEmissive = pal.mat.emissive;
    Object.assign(this.P, PHYS[pal.kind]);
    this.soft.reset();
    this.allLayers.forEach(L => {
      L.mesh.visible = false;
      gsap.killTweensOf(L.sc);
      if (L.film) { gsap.killTweensOf(this.fade(L)); this.fade(L).value = 1; }
    });
    this.stack = [...this.films.slice(0, films), this.core];
    this.stack.forEach(L => { L.mesh.visible = true; });
    this.totalLayers = this.stack.length;
    this.relayout(false);
    this.body.quaternion.identity(); this.body.visible = true;
    this.C.set(0, stage.homeY - stage.visH * 0.25, 0); this.Vc.set(0, 3.5, 0);
    this.bs.s = 0.02; this.state = 'intro';
    gsap.to(this.bs, { s: 1, duration: stage.reduceMotion ? 0.3 : 1.2, ease: 'elastic.out(1,.42)', onComplete: () => { this.state = 'live'; } });
    this.sound.inflate();
    this.wake();
  }

  /** Takes the bubble off the stage at once, without popping it. */
  hide(): void {
    this.endDrag();
    gsap.killTweensOf(this.bs);
    this.state = 'hidden';
    this.body.visible = false;
  }

  /* ---------- pointer and keyboard ---------- */
  private bindInput(): void {
    const { stage } = this;
    const canvas = stage.canvas;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hitP = new THREE.Vector3();
    let downAt = 0, downX = 0, downY = 0, moved = 0, lastHover: THREE.Vector3 | null = null, lastHoverT = 0;
    const castFrom = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, stage.camera);
    };
    const hitBody = (): THREE.Intersection | null => {
      if (!this.body.visible || !this.stack[0]) return null;
      return ray.intersectObject(this.stack[0].mesh, false)[0] ?? null;
    };
    const clampToView = (v: THREE.Vector3): void => {
      const f = (stage.camZ - v.z) / stage.camZ, mx = stage.visW / 2 * f, my = stage.visH / 2 * f;
      v.x = Math.max(-mx, Math.min(mx, v.x)); v.y = Math.max(-my, Math.min(my, v.y));
    };
    const closestCorner = (h: THREE.Intersection): number => {
      const f = h.face!;
      let best = Infinity, bi = f.a;
      for (const v of [f.a, f.b, f.c]) { const d = this.vertexWorld(v, this.stack[0], this._v).distanceToSquared(h.point); if (d < best) { best = d; bi = v; } }
      return bi;
    };
    canvas.addEventListener('pointerdown', e => {
      if (this.state !== 'live' || this.cooldown > 0 || this._dragging) return;
      castFrom(e);
      const h = hitBody();
      if (!h) return;
      this.grabVi = closestCorner(h);
      this.soft.setGrab(this.grabVi); this.wake();
      this.plane.constant = -h.point.z;
      this.Pw.copy(h.point);
      this._dragging = true; this.autoDrag = false; moved = 0; downAt = performance.now(); downX = e.clientX; downY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', e => {
      castFrom(e);
      if (this._dragging && !this.autoDrag) {
        moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
        if (ray.ray.intersectPlane(this.plane, hitP)) { this.Pw.copy(hitP); clampToView(this.Pw); }
        return;
      }
      if (this.state !== 'live' && this.state !== 'intro') { canvas.style.cursor = 'default'; return; }
      const now = performance.now(), h = hitBody();
      if (h) {
        canvas.style.cursor = 'grab';
        const p = h.point.clone();
        if (lastHover && now - lastHoverT < 120) {
          const sp = p.distanceTo(lastHover) / Math.max((now - lastHoverT) / 1000, 0.004);
          if (sp > 0.3) this.impulse(closestCorner(h), Math.min(sp * 2.2, 13) * this.P.hover * this.rm, 0.012);
        }
        lastHover = p; lastHoverT = now;
      } else { canvas.style.cursor = 'default'; lastHover = null; }
    });
    const release = (e: PointerEvent): void => {
      if (!this._dragging || this.autoDrag) return;
      const vi = this.grabVi;
      this.endDrag();
      if (moved < 6 && performance.now() - downAt < 260) { this.impulse(vi, 30 * this.rm, 0.01); this.handler?.poked?.(); }
      canvas.style.cursor = 'grab';
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', () => { lastHover = null; });
    canvas.addEventListener('keydown', e => {
      const map: Record<string, Edge> = { ArrowUp: 'top', ArrowDown: 'bottom', ArrowLeft: 'left', ArrowRight: 'right' };
      if (map[e.key]) { e.preventDefault(); this.autoPull(map[e.key]); }
      else if (e.key === ' ') { e.preventDefault(); if (this.state === 'live') { this.poke(); this.handler?.poked?.(); } }
    });
  }

  /* ---------- per frame ---------- */

  /** Advances the bubble by dt and returns where it is on screen. */
  update(dt: number): BallView {
    if (this.state === 'popping') this.updatePop(dt);
    const { soft, stage } = this;
    if (!this.asleep) {
      // fixed sub-steps; the body falls asleep when it is still and skips the physics entirely
      this.acc += dt;
      let n = 0, vmax = 0;
      const maxSteps = Math.ceil(stage.maxFrameDt / soft.dt) + 1;
      while (this.acc >= soft.dt && n < maxSteps) { vmax = Math.max(vmax, this.step(soft.dt)); this.acc -= soft.dt; n++; }
      if (n >= maxSteps) this.acc = 0;
      soft.updateGeometry();
      this.posAttr.needsUpdate = true; this.nrmAttr.needsUpdate = true;
      const calm = this.state === 'live' && !this._dragging && vmax < 0.004 && this.Vc.lengthSq() < 0.0004 && this.tension === 0;
      this.sleepFrames = calm ? this.sleepFrames + 1 : 0;
      if (this.sleepFrames > 45) { this.asleep = true; this.acc = 0; }
    } else {
      this.simTime += dt;
      this.C.y = stage.homeY + (stage.reduceMotion ? 0 : Math.sin(this.simTime * 1.15) * 0.05);
      if (this.state !== 'live' || this._dragging) this.wake();
    }
    this.walls();
    this.placeBody();
    this.checkEdge(dt);
    return this.project();
  }

  private project(): BallView {
    const { stage, view, C, Vc } = this;
    this._p.copy(C).project(stage.camera);
    if (!isFinite(this._p.x) || !isFinite(this._p.y)) return view;
    const ppu = stage.pixelsPerUnit(C.z);
    view.x = (this._p.x * 0.5 + 0.5) * stage.backdrop.cw;
    view.y = (1 - (this._p.y * 0.5 + 0.5)) * stage.backdrop.ch;
    view.r = R * (this.stack[0] ? this.stack[0].sc.v : this.core.sc.v) * this.bs.s * ppu;
    view.vx = Vc.x * ppu; view.vy = -Vc.y * ppu;
    view.visible = this.body.visible;
    view.pushing = this.body.visible && this.state !== 'popping';
    return view;
  }
}
