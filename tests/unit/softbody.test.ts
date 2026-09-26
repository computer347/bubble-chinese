import { describe, it, expect } from 'vitest';
import { SoftBody, DETAILS } from '../../src/engine/softbody';
import { PHYS } from '../../src/content/palettes';
import { icosphere } from '../../src/engine/icosphere';

describe('icosphere', () => {
  it.each([[3, 642], [4, 2562], [5, 10242]])('level %i has %i points and outward winding', (level, n) => {
    const { dirs, index } = icosphere(level);
    expect(dirs.length / 3).toBe(n);
    expect(index.length / 3).toBe(20 * 4 ** level);
  });
});

// The explicit integrator is only stable below a step size that depends on the stiffest
// material; these tests fail loudly if a preset or a time step is pushed past it.
describe('SoftBody stability', () => {
  for (const [kind, phys] of Object.entries(PHYS)) {
    for (let d = 0; d < DETAILS.length; d++) {
      it(`${kind} at detail ${DETAILS[d].level} stays finite and settles`, () => {
        const b = new SoftBody(d);
        const p = { k: phys.k * 2.3, c: phys.c * 0.55, kc: phys.kc, inertia: phys.inertia }; // stiffest, least damped wobble setting
        for (let i = 0; i < 20; i++) b.impulse((i * 97) % b.n, 30, 0.01);
        const steps = Math.round(1 / b.dt);                  // one simulated second of hard use
        for (let s = 0; s < steps; s++) b.step(b.dt, p, Math.sin(s) * 400, Math.cos(s) * 400, 0, null, 1.1 * 0.95);
        expect(Number.isFinite(b.maxOffset())).toBe(true);
        for (let s = 0; s < steps * 6; s++) b.step(b.dt, p, 0, 0, 0, null, 1.1 * 0.95);
        expect(b.maxOffset()).toBeLessThan(0.02);
      });
    }
  }

  it('a grab pulls the patch toward the hand', () => {
    const b = new SoftBody(1);
    const vi = b.nearestDir(1, 0, 0);
    b.setGrab(vi);
    const grab = { vertex: vi, target: { x: 1.5, y: 0, z: 0 }, strength: 1600 };
    const p = { ...PHYS.jelly, inertia: 0 };
    for (let s = 0; s < 400; s++) b.step(b.dt, p, 0, 0, 0, grab, 1.1 * 3.2);
    expect(b.d[vi * 3]).toBeGreaterThan(1);
  });
});
