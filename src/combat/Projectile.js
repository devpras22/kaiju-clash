// OWNER: combat agent. Thrown building-chunk projectile (MAKORA BUILDING HURL).
// CONTRACT (internal to combat): new Projectile(game, owner, move) ; .update(dt, target) ; .launch(targetPoint) ; .explode() ; .dispose()
//   .state 'held' | 'flying' | 'dead' ; .position ; .velocity
import * as THREE from 'three';

let _sharedTex = null;
function windowTexture() {
  if (_sharedTex) return _sharedTex;
  const W = 128, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const e = document.createElement('canvas'); e.width = W; e.height = H;
  const ge = e.getContext('2d');
  g.fillStyle = '#6d6a66'; g.fillRect(0, 0, W, H);
  // concrete grime
  for (let i = 0; i < 500; i++) {
    const v = 80 + Math.random() * 50; g.fillStyle = `rgba(${v},${v - 4},${v - 8},0.35)`;
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 4, 1 + Math.random() * 4);
  }
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const cols = 6, rows = 6, cw = W / cols, rh = H / rows;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const lit = Math.random() < 0.45;
    const wx = x * cw + cw * 0.18, wy = y * rh + rh * 0.2, ww = cw * 0.64, wh = rh * 0.55;
    g.fillStyle = lit ? '#e8c27a' : '#1a2230'; g.fillRect(wx, wy, ww, wh);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(wx, wy + wh - 2, ww, 2);
    if (lit) { ge.fillStyle = `rgb(${200 + Math.random() * 55},${150 + Math.random() * 40},80)`; ge.fillRect(wx, wy, ww, wh); }
  }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const emap = new THREE.CanvasTexture(e); emap.colorSpace = THREE.SRGBColorSpace;
  _sharedTex = { map, emap };
  return _sharedTex;
}

function chunkGeometry(sx, sy, sz) {
  const geo = new THREE.BoxGeometry(sx, sy, sz, 3, 3, 3);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // jagged broken top/bottom faces
    const onBreak = Math.abs(y) > sy * 0.49;
    const j = onBreak ? 0.45 : 0.12;
    const h = Math.sin(x * 3.1 + z * 1.7) * 0.5 + Math.sin(x * 7.3 - z * 5.1) * 0.5;
    p.setXYZ(i, x + (Math.random() - 0.5) * j * 0.5, y + h * j * (onBreak ? 1 : 0.3), z + (Math.random() - 0.5) * j * 0.5);
  }
  geo.computeVertexNormals();
  return geo;
}

export class Projectile {
  constructor(game, owner, move) {
    this.game = game; this.owner = owner; this.move = move;
    this.state = 'held';
    this.radius = move.projRadius || 2.6;
    this.gravity = move.gravity || 34;
    this.velocity = new THREE.Vector3();
    this.spin = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
    this.life = 0;
    const tex = windowTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex.map, emissiveMap: tex.emap, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.85, metalness: 0.05,
    });
    const rebarMat = new THREE.MeshStandardMaterial({ color: 0x3a2e28, roughness: 0.6, metalness: 0.7 });
    const group = new THREE.Group();
    const body = new THREE.Mesh(chunkGeometry(3.6, 3.0, 3.2), mat);
    body.castShadow = true; group.add(body);
    // rebar sticking out of the broken face
    for (let i = 0; i < 5; i++) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2 + Math.random(), 4), rebarMat);
      r.position.set((Math.random() - 0.5) * 2.8, 1.6, (Math.random() - 0.5) * 2.4);
      r.rotation.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6);
      group.add(r);
    }
    // loose rubble
    for (let i = 0; i < 4; i++) {
      const s = 0.5 + Math.random() * 0.7;
      const m = new THREE.Mesh(chunkGeometry(s, s * 0.8, s), mat);
      m.position.set((Math.random() - 0.5) * 3.4, -1.4 + Math.random() * 0.4, (Math.random() - 0.5) * 3);
      group.add(m);
    }
    this.mesh = group;
    this.mats = [mat, rebarMat];
    this.position = group.position;
    game.scene.add(group);
    this._followOwner();
  }

  _followOwner() {
    const o = this.owner;
    const p = new THREE.Vector3();
    o.model.getSocket('handR', p);
    const q = new THREE.Vector3(); o.model.getSocket('handL', q);
    p.lerp(q, 0.5); // held in both hands
    p.y += 1.2;
    this.position.copy(p);
  }

  launch(target) {
    if (this.state !== 'held') return;
    this.state = 'flying';
    const d = new THREE.Vector3().subVectors(target, this.position);
    const horiz = Math.hypot(d.x, d.z);
    const speed = this.move.speed || 52;
    const T = Math.max(0.25, horiz / speed);
    this.velocity.set(d.x / T, (d.y + 0.5 * this.gravity * T * T) / T, d.z / T);
  }

  update(dt, target) {
    if (this.state === 'dead') return;
    this.life += dt;
    this.mesh.rotation.x += this.spin.x * dt * (this.state === 'flying' ? 1 : 0.1);
    this.mesh.rotation.y += this.spin.y * dt * (this.state === 'flying' ? 1 : 0.1);
    this.mesh.rotation.z += this.spin.z * dt * (this.state === 'flying' ? 1 : 0.1);
    if (this.state === 'held') { this._followOwner(); return; }
    this.velocity.y -= this.gravity * dt;
    this.position.addScaledVector(this.velocity, dt);
    // hit target fighter
    if (target && !target.isKO) {
      const hit = target.sphereOverlap(this.position, this.radius);
      if (hit) {
        const dir = new THREE.Vector3(this.velocity.x, 0, this.velocity.z).normalize();
        const res = target.receiveHit(this.owner, this.move, { point: hit, dir });
        if (res === 'hit' || res === 'block') { this.explode(res === 'block' ? 0.7 : 1); return; }
      }
    }
    const city = this.game.city;
    const ground = city.groundHeight ? city.groundHeight(this.position.x, this.position.z) : 0;
    const R = (city.arenaRadius || 60);
    if (this.position.y - this.radius * 0.5 <= ground) { this.explode(0.8); return; }
    if (Math.hypot(this.position.x, this.position.z) > R + 12) { this.explode(1.1); return; }
    if (this.life > 5) this.explode(0.5);
  }

  explode(scale = 1) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    const g = this.game, p = this.position.clone();
    g.fx.debris?.(p, 1.4 * scale, 0x8a8278);
    g.fx.explosion?.(p, 0.9 * scale, 0xff9a4a);
    g.fx.dust?.(p, 1.2 * scale);
    g.fx.flashLight?.(p, 0xffa060, 60 * scale, 0.25);
    g.city.impact?.(p, 7 * scale, 1.2 * scale);
    g.cameraRig.shake(0.3 * scale, 0.35);
    g.audio.play?.('explosion', { volume: 0.8 * scale, pan: this.owner._pan(p) });
    g.audio.play?.('crumble', { volume: 0.6 * scale, pan: this.owner._pan(p) });
    this.dispose();
  }

  dispose() {
    this.state = 'dead';
    if (!this.mesh) return;
    this.game.scene.remove(this.mesh);
    this.mesh.traverse((o) => o.geometry && o.geometry.dispose());
    this.mats.forEach((m) => m.dispose());
    this.mesh = null;
  }
}
