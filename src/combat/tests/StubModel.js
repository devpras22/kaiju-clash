// Test-only placeholder model (used by src/combat/tests/iso.config.mjs when models are mid-edit).
import * as THREE from 'three';
class PlaceholderModel {
  constructor(id) {
    this.id = id; this.root = new THREE.Group(); this.height = 14;
    const mat = new THREE.MeshStandardMaterial({ color: id === 'saurian' ? 0x2b3a2e : 0x3a2a22, roughness: 0.8 }); this.mat = mat;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(3, 7, 8, 16), mat); body.position.y = 6.5; this.root.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 12), mat); head.position.set(0, 12.5, 1.5); this.root.add(head);
    this._flash = 0;
  }
  update(dt, anim) { this.root.rotation.x = anim.state === 'ko' || anim.state === 'knockdown' ? -Math.PI / 2 * Math.min(anim.t * 2, 1) : 0; }
  getSocket(name, target) {
    const local = { mouth: [0, 12.5, 3.5], head: [0, 12.5, 1.5], chest: [0, 9, 2], handL: [3.5, 8, 4], handR: [-3.5, 8, 4], footL: [1.5, 0.5, 0], footR: [-1.5, 0.5, 0] }[name] || [0, 7, 0];
    target.set(...local); this.root.updateWorldMatrix(true, false); return target.applyMatrix4(this.root.matrixWorld);
  }
  flash() {} setCharge() {} dispose() {}
}
export function createMonsterModel(id) { return new PlaceholderModel(id); }
