// OWNER: world agent. Tiny rigid-ish body simulation over an InstancedMesh: ballistic flight with gravity,
// tumbling, ground bounce + friction, settle → linger as rubble → sink → hide. Bounded dynamic list.
import * as THREE from 'three';

export const S_STATIC = 0, S_DYN = 1, S_SETTLED = 2, S_HIDDEN = 3, S_ATTACHED = 4, S_SINK = 5;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _dq = new THREE.Quaternion(), _ax = new THREE.Vector3();

export class BodySet {
  constructor(mesh, count, { gravity = 14, maxDyn = 320, linger = [6, 10], sinkSpeed = 0.6 } = {}) {
    this.mesh = mesh; this.count = count; this.n = 0;
    this.gravity = gravity; this.maxDyn = maxDyn; this.linger = linger; this.sinkSpeed = sinkSpeed;
    this.pos = new Float32Array(count * 3); this.quat = new Float32Array(count * 4); this.scl = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3); this.ang = new Float32Array(count * 3);
    this.oPos = new Float32Array(count * 3); this.oQuat = new Float32Array(count * 4); this.oScl = new Float32Array(count * 3);
    this.state = new Uint8Array(count); this.timer = new Float32Array(count); this.halfH = new Float32Array(count);
    this.flags = new Uint8Array(count);
    this.dyn = new Int32Array(maxDyn); this.nDyn = 0;
    this.floorFn = null;   // (i) => floor height under body i (default 0)
    this.onLand = null;    // (i, impactSpeed) => void
    this.dirty = false;
    this.rng = Math.random;
  }
  add(x, y, z, sx, sy, sz, qx = 0, qy = 0, qz = 0, qw = 1) {
    const i = this.n++;
    this.oPos.set([x, y, z], i * 3); this.oScl.set([sx, sy, sz], i * 3); this.oQuat.set([qx, qy, qz, qw], i * 4);
    this.restore(i);
    return i;
  }
  restore(i) {
    this.pos.set(this.oPos.subarray(i * 3, i * 3 + 3), i * 3);
    this.scl.set(this.oScl.subarray(i * 3, i * 3 + 3), i * 3);
    this.quat.set(this.oQuat.subarray(i * 4, i * 4 + 4), i * 4);
    this.vel.fill(0, i * 3, i * 3 + 3); this.ang.fill(0, i * 3, i * 3 + 3);
    this.state[i] = S_STATIC; this.timer[i] = 0; this.flags[i] = 0;
    this.halfH[i] = Math.min(this.scl[i * 3], this.scl[i * 3 + 1], this.scl[i * 3 + 2]) * 0.42;
    this.write(i);
  }
  reset() {
    for (let i = 0; i < this.n; i++) this.restore(i);
    this.nDyn = 0;
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  write(i) {
    if (this.state[i] === S_HIDDEN) { _m.makeScale(0, 0, 0); }
    else {
      _p.fromArray(this.pos, i * 3); _q.fromArray(this.quat, i * 4); _s.fromArray(this.scl, i * 3);
      _m.compose(_p, _q, _s);
    }
    _m.toArray(this.mesh.instanceMatrix.array, i * 16);
    this.dirty = true;
  }
  hide(i) { this.state[i] = S_HIDDEN; this.write(i); }
  canLaunch() { return this.nDyn < this.maxDyn; }
  // Launch body i into ballistic flight. Returns false if the dynamic budget is exhausted.
  launch(i, vx, vy, vz, ax = 0, ay = 0, az = 0) {
    const st = this.state[i];
    if (st === S_HIDDEN) return false;
    if (st !== S_DYN && st !== S_SETTLED && st !== S_SINK) {
      if (this.nDyn >= this.maxDyn) return false;
      this.dyn[this.nDyn++] = i;
    }
    this.state[i] = S_DYN;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.ang[i * 3] = ax; this.ang[i * 3 + 1] = ay; this.ang[i * 3 + 2] = az;
    return true;
  }
  step(dt) {
    if (dt <= 0) return;
    const P = this.pos, V = this.vel, A = this.ang, Q = this.quat, g = this.gravity;
    let w = 0;
    for (let k = 0; k < this.nDyn; k++) {
      const i = this.dyn[k];
      const st = this.state[i];
      if (st === S_DYN) {
        const i3 = i * 3;
        V[i3 + 1] -= g * dt;
        const drag = Math.exp(-0.15 * dt);
        V[i3] *= drag; V[i3 + 2] *= drag;
        P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
        const ax = A[i3], ay = A[i3 + 1], az = A[i3 + 2];
        const angL = Math.hypot(ax, ay, az);
        if (angL > 1e-4) {
          _ax.set(ax / angL, ay / angL, az / angL); _dq.setFromAxisAngle(_ax, angL * dt);
          _q.fromArray(Q, i * 4); _q.premultiply(_dq); _q.toArray(Q, i * 4);
        }
        const floor = this.floorFn ? this.floorFn(i) : 0;
        const hh = this.halfH[i];
        if (P[i3 + 1] - hh < floor) {
          P[i3 + 1] = floor + hh;
          const vy = V[i3 + 1];
          if (vy < 0) {
            const impactSpeed = -vy;
            const through = this.onLand ? this.onLand(i, impactSpeed) : false;
            if (through === true) {
              V[i3 + 1] = -impactSpeed * 0.5;
            } else if (impactSpeed > 3.5) {
              V[i3 + 1] = impactSpeed * 0.28; V[i3] *= 0.62; V[i3 + 2] *= 0.62;
              A[i3] *= 0.6; A[i3 + 1] *= 0.6; A[i3 + 2] *= 0.6;
            } else {
              V[i3 + 1] = 0;
              const f = Math.exp(-6 * dt); V[i3] *= f; V[i3 + 2] *= f;
              A[i3] *= f; A[i3 + 1] *= f; A[i3 + 2] *= f;
              if (Math.hypot(V[i3], V[i3 + 2]) < 0.6) {
                this.state[i] = S_SETTLED;
                this.timer[i] = this.linger[0] + this.rng() * (this.linger[1] - this.linger[0]);
                V.fill(0, i3, i3 + 3); A.fill(0, i3, i3 + 3);
              }
            }
          }
        }
        this.write(i);
        this.dyn[w++] = i;
      } else if (st === S_SETTLED) {
        this.timer[i] -= dt;
        if (this.timer[i] <= 0) this.state[i] = S_SINK;
        this.dyn[w++] = i;
      } else if (st === S_SINK) {
        P[i * 3 + 1] -= this.sinkSpeed * dt;
        const floor = this.floorFn ? this.floorFn(i) : 0;
        const maxS = Math.max(this.scl[i * 3], this.scl[i * 3 + 1], this.scl[i * 3 + 2]);
        if (P[i * 3 + 1] < floor - maxS * 0.6) { this.state[i] = S_HIDDEN; }
        else this.dyn[w++] = i;
        this.write(i);
      }
      // hidden / static / attached → drop from list
    }
    this.nDyn = w;
  }
  flush() {
    if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; }
  }
}
