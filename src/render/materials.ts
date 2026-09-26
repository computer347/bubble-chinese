import * as THREE from 'three';
import type { CoreMaterial } from '../content/palettes';

export interface FilmMaterial extends THREE.MeshPhysicalMaterial {
  userData: { fade: { value: number } };
}

/**
 * Soap film: iridescent, nearly clear in the middle and bright at the rim (a Fresnel term on alpha).
 * Transparent instead of transmissive, which avoids three.js's extra transmission render pass.
 */
export function filmMaterial(opacity: number): FilmMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', roughness: 0.04, metalness: 0,
    iridescence: 1, iridescenceIOR: 1.33, iridescenceThicknessRange: [160, 760],
    clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.9,
    transparent: true, opacity, depthWrite: false
  }) as FilmMaterial;
  m.userData.fade = { value: 1 };
  m.onBeforeCompile = shader => {
    shader.uniforms.uFade = m.userData.fade;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uFade;\nvoid main() {')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        float fres = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.0);
        gl_FragColor.a = clamp(mix(0.07, 1.0, fres) * opacity * 2.2, 0.0, 1.0) * uFade;`);
  };
  return m;
}

export function coreMaterial(m: CoreMaterial): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ clearcoatRoughness: 0.06, iridescenceIOR: 1.3, sheenRoughness: 0.45 });
  applyCore(mat, m);
  return mat;
}

export function applyCore(mat: THREE.MeshPhysicalMaterial, m: CoreMaterial): void {
  mat.color.set(m.color);
  mat.emissive.set(m.emissiveColor);
  mat.emissiveIntensity = m.emissive;
  mat.roughness = m.roughness;
  mat.metalness = m.metalness;
  mat.clearcoat = m.clearcoat;
  mat.iridescence = m.iridescence;
  mat.sheen = m.sheen;
  mat.sheenColor.set(m.sheenColor);
  mat.envMapIntensity = m.envMapIntensity;
}
