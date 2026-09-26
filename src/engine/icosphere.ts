export interface Icosphere {
  /** Unit direction of every vertex (x, y, z interleaved). */
  dirs: Float32Array;
  /** Triangle indices, wound outward. */
  index: Uint32Array;
}

/** Subdivided icosahedron. Level 3 → 642 points, 4 → 2,562, 5 → 10,242. */
export function icosphere(detail: number): Icosphere {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: number[] = [];
  const add = (x: number, y: number, z: number): number => {
    const l = Math.hypot(x, y, z);
    v.push(x / l, y / l, z / l);
    return v.length / 3 - 1;
  };
  ([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]] as const)
    .forEach(p => add(p[0], p[1], p[2]));
  let f = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  for (let d = 0; d < detail; d++) {
    const cache = new Map<number, number>();
    const nf: number[] = [];
    const mid = (a: number, b: number): number => {
      const key = a < b ? a * 1048576 + b : b * 1048576 + a;
      let m = cache.get(key);
      if (m === undefined) {
        m = add(v[a * 3] + v[b * 3], v[a * 3 + 1] + v[b * 3 + 1], v[a * 3 + 2] + v[b * 3 + 2]);
        cache.set(key, m);
      }
      return m;
    };
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i], b = f[i + 1], c = f[i + 2];
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nf.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    f = nf;
  }
  for (let i = 0; i < f.length; i += 3) {
    const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
    const e1x = v[b] - v[a], e1y = v[b + 1] - v[a + 1], e1z = v[b + 2] - v[a + 2];
    const e2x = v[c] - v[a], e2y = v[c + 1] - v[a + 1], e2z = v[c + 2] - v[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    if (nx * v[a] + ny * v[a + 1] + nz * v[a + 2] < 0) { const tmp = f[i + 1]; f[i + 1] = f[i + 2]; f[i + 2] = tmp; }
  }
  return { dirs: new Float32Array(v), index: new Uint32Array(f) };
}

/** Area-weighted vertex normals. */
export function vertexNormals(pos: Float32Array, idx: Uint32Array, out: Float32Array): void {
  out.fill(0);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let i3 = 0; i3 < out.length; i3 += 3) {
    const l = 1 / (Math.hypot(out[i3], out[i3 + 1], out[i3 + 2]) || 1);
    out[i3] *= l; out[i3 + 1] *= l; out[i3 + 2] *= l;
  }
}
