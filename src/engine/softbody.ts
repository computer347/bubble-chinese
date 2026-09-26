import { icosphere, vertexNormals } from './icosphere';

/** Mesh resolutions and the time step each one is stable at. */
export const DETAILS = [
  { level: 3, dt: 1 / 130 },
  { level: 4, dt: 1 / 170 },
  { level: 5, dt: 1 / 320 }
] as const;

export interface SoftParams {
  /** Spring pulling each point back to its rest position. */
  k: number;
  /** Damping. */
  c: number;
  /** Surface tension at the finest mesh; scaled down automatically on coarser meshes. */
  kc: number;
  /** How much the skin lags when the body accelerates. */
  inertia: number;
}

export interface Grab {
  vertex: number;
  /** Where the grabbed point should be, as an offset from its rest position (body space). */
  target: { x: number; y: number; z: number };
  strength: number;
}

/**
 * A sphere of points, each on a spring to its rest position and coupled to its neighbours
 * (a discrete Laplacian), which is what makes ripples travel across the surface.
 * Positions are body-local; the body's centre is simulated by the caller.
 */
export class SoftBody {
  readonly n: number;
  readonly index: Uint32Array;
  readonly dirs: Float32Array;
  readonly rest: Float32Array;
  readonly restNormals: Float32Array;
  /** Offset of each point from rest, and its velocity. */
  readonly d: Float32Array;
  readonly v: Float32Array;
  readonly grabWeights: Float32Array;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly dt: number;
  private readonly kcScale: number;
  private readonly nbStart: Int32Array;
  private readonly nb: Int32Array;
  private readonly nbInv: Float32Array;

  constructor(readonly detailIndex: number, readonly radius = 1.1) {
    const { level, dt } = DETAILS[detailIndex];
    this.dt = dt;
    this.kcScale = Math.pow(0.25, 5 - level);
    const ico = icosphere(level);
    this.dirs = ico.dirs; this.index = ico.index;
    const n = this.n = ico.dirs.length / 3;

    const sets = Array.from({ length: n }, () => new Set<number>());
    const I = this.index;
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i], b = I[i + 1], c = I[i + 2];
      sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
    }
    this.nbStart = new Int32Array(n + 1);
    const list: number[] = [];
    for (let i = 0; i < n; i++) { this.nbStart[i] = list.length; sets[i].forEach(j => list.push(j)); }
    this.nbStart[n] = list.length;
    this.nb = new Int32Array(list);
    this.nbInv = new Float32Array(n);
    for (let i = 0; i < n; i++) this.nbInv[i] = 1 / (this.nbStart[i + 1] - this.nbStart[i]);

    this.rest = new Float32Array(n * 3);
    this.restNormals = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) { this.rest[i] = this.dirs[i] * radius; this.restNormals[i] = this.dirs[i]; }
    this.d = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.grabWeights = new Float32Array(n);
    this.positions = new Float32Array(n * 3);
    this.normals = new Float32Array(n * 3);
    this.updateGeometry();
  }

  reset(): void { this.d.fill(0); this.v.fill(0); this.grabWeights.fill(0); }

  /**
   * Advances the surface by dt, given the acceleration of the body's centre.
   * Returns the largest point speed, used to let the body fall asleep when still.
   */
  step(dt: number, p: SoftParams, ax: number, ay: number, az: number, grab: Grab | null, maxD: number): number {
    const { n, d: D, v: V, restNormals: RN, nbStart, nb, nbInv } = this;
    const al = Math.hypot(ax, ay, az) + 1e-6;
    const soft = 1 / (1 + al / 700);
    const eax = ax * soft, eay = ay * soft, eaz = az * soft;
    const iax = ax / al, iay = ay / al, iaz = az / al;
    const k = p.k, c = p.c, kc = p.kc * this.kcScale, gi = p.inertia;
    const GW = this.grabWeights;
    const kg = grab ? grab.strength : 0;
    const gdx = grab ? grab.target.x : 0, gdy = grab ? grab.target.y : 0, gdz = grab ? grab.target.z : 0;

    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      let sx = 0, sy = 0, sz = 0;
      for (let j = nbStart[i], e = nbStart[i + 1]; j < e; j++) { const n3 = nb[j] * 3; sx += D[n3]; sy += D[n3 + 1]; sz += D[n3 + 2]; }
      const inv = nbInv[i], dx = D[i3], dy = D[i3 + 1], dz = D[i3 + 2];
      // the trailing side lags more than the leading side, which makes the body stretch when flung
      const m = gi * (1 - 0.85 * (RN[i3] * iax + RN[i3 + 1] * iay + RN[i3 + 2] * iaz));
      let fx = kc * (sx * inv - dx) - k * dx - c * V[i3] - m * eax;
      let fy = kc * (sy * inv - dy) - k * dy - c * V[i3 + 1] - m * eay;
      let fz = kc * (sz * inv - dz) - k * dz - c * V[i3 + 2] - m * eaz;
      const w = GW[i];
      if (kg && w > 0) { fx += kg * w * (gdx - dx); fy += kg * w * (gdy - dy); fz += kg * w * (gdz - dz); }
      V[i3] += fx * dt; V[i3 + 1] += fy * dt; V[i3 + 2] += fz * dt;
    }
    const maxD2 = maxD * maxD;
    let vmax = 0;
    for (let i3 = 0, n3 = n * 3; i3 < n3; i3 += 3) {
      const vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2];
      let dx = D[i3] + vx * dt, dy = D[i3 + 1] + vy * dt, dz = D[i3 + 2] + vz * dt;
      const l2 = dx * dx + dy * dy + dz * dz;
      if (l2 > maxD2) {
        const s = maxD / Math.sqrt(l2); dx *= s; dy *= s; dz *= s;
        V[i3] *= 0.5; V[i3 + 1] *= 0.5; V[i3 + 2] *= 0.5;
      }
      D[i3] = dx; D[i3 + 1] = dy; D[i3 + 2] = dz;
      const a = Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
      if (a > vmax) vmax = a;
    }
    return vmax;
  }

  /** Pushes the surface along its normal around a vertex. Positive is inward. s2 sets the spread. */
  impulse(vi: number, strength: number, s2: number): void {
    const R = this.rest, RN = this.restNormals, V = this.v;
    const gx = R[vi * 3], gy = R[vi * 3 + 1], gz = R[vi * 3 + 2];
    const inv = 1 / (2 * this.radius * this.radius * s2), lim = 6 / inv;
    for (let i = 0, i3 = 0; i < this.n; i++, i3 += 3) {
      const dx = R[i3] - gx, dy = R[i3 + 1] - gy, dz = R[i3 + 2] - gz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > lim) continue;
      const w = Math.exp(-d2 * inv) * strength;
      V[i3] -= RN[i3] * w; V[i3 + 1] -= RN[i3 + 1] * w; V[i3 + 2] -= RN[i3 + 2] * w;
    }
  }

  /** Weights the patch around a vertex so it follows a grab. */
  setGrab(vi: number, s2 = 0.05): void {
    const R = this.rest, GW = this.grabWeights;
    const gx = R[vi * 3], gy = R[vi * 3 + 1], gz = R[vi * 3 + 2];
    const inv = 1 / (2 * this.radius * this.radius * s2);
    for (let i = 0, i3 = 0; i < this.n; i++, i3 += 3) {
      const dx = R[i3] - gx, dy = R[i3 + 1] - gy, dz = R[i3 + 2] - gz;
      const w = Math.exp(-(dx * dx + dy * dy + dz * dz) * inv);
      GW[i] = w > 0.01 ? w : 0;
    }
  }

  clearGrab(): void { this.grabWeights.fill(0); }

  /** The vertex whose rest direction is closest to (x, y, z). */
  nearestDir(x: number, y: number, z: number): number {
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    let best = -2, bi = 0;
    const D = this.dirs;
    for (let i = 0, i3 = 0; i < this.n; i++, i3 += 3) {
      const dot = D[i3] * x + D[i3 + 1] * y + D[i3 + 2] * z;
      if (dot > best) { best = dot; bi = i; }
    }
    return bi;
  }

  /** Recomputes positions (rest + offset) and normals for rendering. */
  updateGeometry(): void {
    const P = this.positions, R = this.rest, D = this.d;
    for (let i = 0; i < P.length; i++) P[i] = R[i] + D[i];
    vertexNormals(P, this.index, this.normals);
  }

  /** Largest offset from rest, for tests and debugging. */
  maxOffset(): number {
    let m = 0;
    const D = this.d;
    for (let i = 0; i < D.length; i += 3) m = Math.max(m, Math.hypot(D[i], D[i + 1], D[i + 2]));
    return m;
  }
}
