import * as THREE from 'three';
import type { FilmMaterial } from '../render/materials';

/**
 * Ribs and bands drawn in the fragment shader from the body's own (deforming) position, so they
 * wobble with the skin: thin bamboo ribs down the sides, and a gold band near each pole.
 */
const RIB_VERTEX = [
  ['#include <common>', '#include <common>\nvarying vec3 vLocalPos;'],
  ['#include <begin_vertex>', '#include <begin_vertex>\nvLocalPos = transformed;']
] as const;
const RIB_FRAGMENT_HEAD = 'varying vec3 vLocalPos;\nuniform vec3 uGold;\n';
/** rib: 0–1 on the ribs; band: 0–1 on the gold bands. */
const RIB_FUNCS = `
  float ribAt(vec3 p) { return pow(abs(cos(atan(p.z, p.x) * 7.0)), 60.0); }
  float bandAt(vec3 p) { float lat = abs(p.y) / max(length(p), 1e-4); return smoothstep(0.78, 0.8, lat) * (1.0 - smoothstep(0.9, 0.92, lat)); }
`;

function withRibs(shader: THREE.WebGLProgramParametersWithUniforms, gold: THREE.Color): void {
  for (const [a, b] of RIB_VERTEX) shader.vertexShader = shader.vertexShader.replace(a, b);
  shader.uniforms.uGold = { value: gold };
  shader.fragmentShader = RIB_FRAGMENT_HEAD + RIB_FUNCS + shader.fragmentShader;
}

/** The glowing silk core of a lantern. Its colours come from the palette, like a bubble's core. */
export function lanternCore(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ sheenRoughness: 0.5 });
  const gold = new THREE.Color('#D9A441');
  m.onBeforeCompile = shader => {
    withRibs(shader, gold);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.55 * ribAt(vLocalPos)), uGold, bandAt(vLocalPos));`);
  };
  m.customProgramCacheKey = () => 'lantern-core';
  return m;
}

/** A translucent paper shade around the lantern: warm, with darker ribs, fading out when popped. */
export function paperFilm(opacity: number): FilmMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: '#F7E6C4', emissive: '#FFB070', emissiveIntensity: 0.12, roughness: 0.85, metalness: 0,
    sheen: 0.6, sheenColor: '#FFE2B8', envMapIntensity: 0.6, transparent: true, opacity, depthWrite: false
  }) as FilmMaterial;
  m.userData.fade = { value: 1 };
  const gold = new THREE.Color('#B8862F');
  m.onBeforeCompile = shader => {
    withRibs(shader, gold);
    shader.uniforms.uFade = m.userData.fade;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uFade;\nvoid main() {')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 1.0 - 0.5 * ribAt(vLocalPos);`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        float edge = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 1.5);
        gl_FragColor.a = clamp(mix(0.06, 0.75, edge) * opacity * 2.0 + ribAt(vLocalPos) * 0.45, 0.0, 1.0) * uFade;`);
  };
  m.customProgramCacheKey = () => 'lantern-paper';
  return m;
}

/**
 * Gold caps at the top and bottom of the lantern and a red tassel below. Place them each frame
 * with the outer layer's radius, since shades pop off and the lantern shrinks inward.
 */
export class LanternFittings {
  readonly group = new THREE.Group();
  private readonly top: THREE.Mesh;
  private readonly bottom: THREE.Mesh;
  private readonly tassel: THREE.Group;

  constructor() {
    const gold = new THREE.MeshPhysicalMaterial({ color: '#D4A03C', metalness: 1, roughness: 0.3, envMapIntensity: 1.2 });
    const red = new THREE.MeshPhysicalMaterial({ color: '#B3201A', roughness: 0.7, sheen: 1, sheenColor: '#FF8A6A' });
    const cap = new THREE.CylinderGeometry(0.3, 0.38, 0.1, 32);
    this.top = new THREE.Mesh(cap, gold);
    this.bottom = new THREE.Mesh(cap, gold);
    this.bottom.rotation.x = Math.PI;
    this.tassel = new THREE.Group();
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), red);
    cord.position.y = -0.08;
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), gold);
    knot.position.y = -0.18;
    const fringe = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.34, 20, 1, true), red);
    fringe.position.y = -0.37; fringe.rotation.x = Math.PI;
    this.tassel.add(cord, knot, fringe);
    this.group.add(this.top, this.bottom, this.tassel);
    this.group.visible = false;
  }

  /** Puts the fittings on a lantern of radius r (body space), drawn `squash` times as tall as wide. */
  place(r: number, squash: number): void {
    const y = r * squash * 0.96;
    this.top.position.y = y; this.top.scale.setScalar(r);
    this.bottom.position.y = -y; this.bottom.scale.setScalar(r);
    this.tassel.position.y = -y - 0.05 * r; this.tassel.scale.setScalar(r);
  }
}
