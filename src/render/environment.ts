import * as THREE from 'three';

/** A studio of soft boxes, tinted by the page colour, pre-filtered into an environment map. */
export class Environment {
  private pmrem: THREE.PMREMGenerator;
  private rt: THREE.WebGLRenderTarget | null = null;
  constructor(renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  build(tint: string): void {
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.BoxGeometry(24, 24, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(0.7), side: THREE.BackSide })));
    const panel = (w: number, h: number, x: number, y: number, z: number, k: number, col = '#ffffff') => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
    };
    panel(9, 4, 0, 10, 3, 7);
    panel(2.2, 12, -10, 1, 4, 4);
    panel(1.6, 12, 10, 2, -3, 2.6);
    panel(12, 3, 0, -3, 10, 1.4);
    panel(14, 6, 0, -10, 0, 1.2, tint);
    const rt = this.pmrem.fromScene(s, 0.02);
    this.rt?.dispose();
    this.rt = rt;
    this.scene.environment = rt.texture;
    s.traverse(o => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    });
  }
}
