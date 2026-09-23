// OWNER: combat agent. Cinematic fighting-game camera.
// CONTRACT (must be preserved):
//   new CameraRig(camera)
//   rig.setMode('orbit' | 'select' | 'fight', opts) — 'orbit' = title flyover; 'select' = frame opts.targets (Vector3[]); 'fight' = track opts.fighters
//   rig.update(dt)
//   rig.shake(amount 0..1, duration = 0.3)
//   rig.cinematic({ target: Vector3, offset: Vector3, duration, fov }) — temporary dramatic shot (supers, KO), then returns to mode
// ADDITIONS (optional, backwards compatible):
//   rig.screenRight() → Vector3 (unit, horizontal) — camera's right vector on the ground plane; used for screen-relative controls
//   rig.screenForward() → Vector3 (unit, horizontal) — camera look direction on the ground plane
//   cinematic extra opts: { orbit: rad/s (offset rotates around target), lookOffset: Vector3, easeIn, easeOut }
//      target may be a live Vector3 (e.g. a fighter position) — the shot tracks it.
//   rig.clearCinematic() ; rig.inCinematic : boolean
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// Smooth pseudo-perlin 1D noise (sum of incommensurate sines) — continuous, no jitter.
function noise(t, seed) {
  return (
    Math.sin(t * 1.0 + seed * 12.9898) * 0.5 +
    Math.sin(t * 2.137 + seed * 78.233) * 0.3 +
    Math.sin(t * 4.371 + seed * 37.719) * 0.2
  );
}
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'orbit'; this.opts = {};
    this.t = 0;
    this.trauma = 0; this.traumaDecay = 2;
    this.pos = new THREE.Vector3(0, 30, 90); this.look = new THREE.Vector3(0, 8, 0);
    this.baseFov = camera.fov || 40; this.fov = this.baseFov;
    this._side = null;
    this._cine = null;
    this._right = new THREE.Vector3(1, 0, 0);
    this._fwd = new THREE.Vector3(0, 0, -1);
    this._goalPos = new THREE.Vector3(); this._goalLook = new THREE.Vector3();
    this._snap = true;
  }

  get inCinematic() { return !!this._cine; }

  setMode(mode, opts = {}) {
    const prev = this.mode;
    this.mode = mode; this.opts = opts;
    if (mode === 'fight') { this._side = null; if (prev !== 'fight') this._snap = true; }
  }

  shake(amount, duration = 0.3) {
    if (!(amount > 0)) return;
    const decay = 1 / Math.max(0.12, duration);
    // big shakes keep their slower decay unless the new one is comparable in size
    if (amount >= this.trauma * 0.6) this.traumaDecay = decay;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  cinematic(o = {}) {
    this._cine = {
      target: o.target || new THREE.Vector3(0, 8, 0),
      offset: (o.offset || new THREE.Vector3(0, 4, 24)).clone(),
      lookOffset: (o.lookOffset || new THREE.Vector3()).clone(),
      duration: o.duration ?? 2,
      fov: o.fov ?? this.baseFov,
      orbit: o.orbit ?? 0,
      easeIn: o.easeIn ?? 0.35,
      easeOut: o.easeOut ?? 0.5,
      t: 0,
    };
  }
  clearCinematic() { this._cine = null; }

  screenRight() { return this._right.clone(); }
  screenForward() { return this._fwd.clone(); }

  _fightGoal(dt, goalPos, goalLook) {
    const fs = this.opts.fighters;
    const a = fs[0].position, b = fs[1].position;
    const mid = _v.copy(a).add(b).multiplyScalar(0.5);
    const axis = _w.copy(b).sub(a); axis.y = 0;
    let sep = axis.length();
    if (sep < 0.001) axis.set(1, 0, 0); else axis.divideScalar(sep);
    const perp = new THREE.Vector3(-axis.z, 0, axis.x);
    if (!this._side) {
      // initial side: the perpendicular closest to +Z (so P1 at -x reads on the left)
      this._side = perp.z >= 0 ? perp.clone() : perp.clone().negate();
    }
    if (perp.dot(this._side) < 0) perp.negate();
    this._side.lerp(perp, 1 - Math.exp(-dt * 3)).normalize();

    const aspect = this.camera.aspect || 16 / 9;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.fov * 0.5));
    const tanH = tanV * aspect;
    const air = Math.max(a.y, b.y);
    const halfW = sep * 0.5 + 12;
    const halfH = 11 + air * 0.6;
    const dist = Math.max(36, halfW / tanH, halfH / tanV);
    goalPos.copy(mid).addScaledVector(this._side, dist);
    goalPos.y = 5.5 + dist * 0.045 + air * 0.3; // low angle — monsters loom
    goalLook.copy(mid); goalLook.y = 9 + air * 0.55;
  }

  update(dt) {
    this.t += dt;
    const goalPos = this._goalPos, goalLook = this._goalLook;
    let targetFov = this.baseFov;
    let rate = 4;
    if (this.mode === 'fight' && this.opts.fighters && this.opts.fighters[0] && this.opts.fighters[1]) {
      this._fightGoal(dt, goalPos, goalLook);
      rate = 5;
    } else if (this.mode === 'select' && this.opts.targets && this.opts.targets.length) {
      const mid = this.opts.targets.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / this.opts.targets.length);
      goalLook.copy(mid).setY(8.5);
      goalPos.copy(mid).add(_v.set(Math.sin(this.t * 0.12) * 9, 6 + Math.sin(this.t * 0.21) * 1.2, 46));
      rate = 2.5;
    } else {
      const ang = this.t * 0.045;
      const r = 105 + Math.sin(this.t * 0.07) * 18;
      goalPos.set(Math.cos(ang) * r, 34 + Math.sin(this.t * 0.17) * 10, Math.sin(ang) * r);
      goalLook.set(0, 14 + Math.sin(this.t * 0.11) * 3, 0);
      rate = 1.5;
    }

    // cinematic override with eased blend
    if (this._cine) {
      const c = this._cine;
      c.t += dt;
      const w = Math.min(smooth(c.t / Math.max(0.01, c.easeIn)), smooth((c.duration - c.t) / Math.max(0.01, c.easeOut)));
      const off = _v.copy(c.offset);
      if (c.orbit) off.applyAxisAngle(UP, c.orbit * c.t);
      const cPos = off.add(c.target);
      const cLook = _w.copy(c.target).add(c.lookOffset);
      goalPos.lerp(cPos, w); goalLook.lerp(cLook, w);
      targetFov = THREE.MathUtils.lerp(this.baseFov, c.fov, w);
      rate = THREE.MathUtils.lerp(rate, 9, w);
      if (c.t >= c.duration) this._cine = null;
    }

    if (this._snap && dt > 0) { this.pos.copy(goalPos); this.look.copy(goalLook); this._snap = false; }
    const k = 1 - Math.exp(-dt * rate);
    this.pos.lerp(goalPos, k); this.look.lerp(goalLook, k);
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 6));

    const cam = this.camera;
    cam.position.copy(this.pos);
    // subtle handheld drift
    const ht = this.t * 0.35;
    cam.position.x += noise(ht, 1) * 0.35; cam.position.y += noise(ht, 2) * 0.25; cam.position.z += noise(ht, 3) * 0.35;
    const look = _w.copy(this.look);
    look.x += noise(ht * 1.3, 4) * 0.2; look.y += noise(ht * 1.3, 5) * 0.15;

    // trauma shake: intensity = trauma², smooth noise, positional + roll
    let roll = 0;
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma;
      const st = this.t * 22;
      cam.position.x += noise(st, 11) * s * 2.2; cam.position.y += noise(st, 12) * s * 1.8; cam.position.z += noise(st, 13) * s * 2.2;
      look.x += noise(st, 14) * s * 1.2; look.y += noise(st, 15) * s * 1.2;
      roll = noise(st * 0.8, 16) * s * 0.06;
      this.trauma = Math.max(0, this.trauma - dt * this.traumaDecay);
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    if (roll) cam.rotateZ(roll);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }

    // screen-relative basis for controls (horizontal)
    // In fight mode use the stable framing side (not the live camera) so cinematics/shake never flip controls.
    cam.updateMatrixWorld();
    if (this.mode === 'fight' && this._side) this._right.set(this._side.z, 0, -this._side.x);
    else this._right.setFromMatrixColumn(cam.matrixWorld, 0);
    this._right.y = 0;
    if (this._right.lengthSq() < 1e-6) this._right.set(1, 0, 0); else this._right.normalize();
    this._fwd.set(this._right.z, 0, -this._right.x);
  }
}
