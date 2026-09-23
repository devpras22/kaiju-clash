// OWNER: models agent. Shared rig / pose / animation / IK / spring / material-patch utilities for monster models.
import * as THREE from 'three';
import { RigDef } from './geometry.js';

// ------------------------------------------------------------------ shader patching
/** Adds a shared hit-flash uniform + optional custom emissive/vertex code to a built-in material. */
export function patchMaterial(mat, uniforms, opts = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uFlash;\n' + (opts.fragDecl || ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (opts.emissive || '') + '\ntotalEmissiveRadiance += uFlash;');
    if (opts.vertDecl) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + opts.vertDecl)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (opts.vert || ''));
    }
  };
  mat.customProgramCacheKey = () => 'kc-' + (opts.key || 'base');
  return mat;
}

// ------------------------------------------------------------------ easing / key helpers
export const ease = {
  inOut: (t) => t * t * (3 - 2 * t),
  out: (t) => 1 - (1 - t) * (1 - t),
  in: (t) => t * t,
  outBack: (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  lin: (t) => t,
};
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 0→1 over [a,b] smooth. */
export const ramp = (x, a, b) => ease.inOut(clamp01((x - a) / (b - a)));
/** bump: 0 at a, 1 between b..c, 0 at d */
export const bump = (x, a, b, c, d) => ramp(x, a, b) * (1 - ramp(x, c, d));

// ------------------------------------------------------------------ pose buffer
/**
 * Pose layout: per bone euler (x,y,z) + named channels.
 * Right-side bones (name ending in 'R' with an 'L' twin) are MIRRORED at apply time (y,z negated), so the same
 * numbers mean the same anatomical motion on either side. Channels ending in 'R' with vec3 are mirrored on x.
 */
export const CHANNELS = { hipsPos: 3, bodyPos: 3, bodyRot: 3, ikL: 3, ikR: 3, ikW: 2, glow: 1, roar: 1, lean: 1 };

export class PoseLayout {
  constructor(rig) {
    this.rig = rig;
    this.nb = rig.bones.length;
    this.off = {};
    let o = this.nb * 3;
    for (const [k, n] of Object.entries(CHANNELS)) { this.off[k] = o; o += n; }
    this.size = o;
    this.mirror = rig.bones.map((b) => /R$/.test(b.name) && rig.index[b.name.slice(0, -1) + 'L'] !== undefined);
  }
}

/** Mutable pose with authoring helpers (all "add" so layers compose). */
export class Pose {
  constructor(layout) { this.L = layout; this.a = new Float32Array(layout.size); }
  zero() { this.a.fill(0); this.a[this.L.off.ikW] = 1; this.a[this.L.off.ikW + 1] = 1; return this; }
  _o(name) {
    const b = this.L.rig.index[name];
    if (b !== undefined) return b * 3;
    const o = this.L.off[name]; if (o === undefined) throw new Error('pose channel ' + name); return o;
  }
  add(name, x = 0, y = 0, z = 0) { const o = this._o(name); const a = this.a; a[o] += x; if (CHANNELS[name] !== 1) { a[o + 1] += y; if (CHANNELS[name] !== 2) a[o + 2] += z; } return this; }
  set(name, x = 0, y = 0, z = 0) { const o = this._o(name); const a = this.a; a[o] = x; if (CHANNELS[name] !== 1) { a[o + 1] = y; if (CHANNELS[name] !== 2) a[o + 2] = z; } return this; }
  get(name, i = 0) { return this.a[this._o(name) + i]; }
  /** add pose object {bone:[x,y,z] | channel:[..] | scalar} scaled by w */
  addObj(obj, w = 1) {
    if (!obj || w === 0) return this;
    for (const k in obj) {
      const v = obj[k]; const o = this._o(k);
      if (typeof v === 'number') this.a[o] += v * w;
      else for (let i = 0; i < v.length; i++) this.a[o + i] += v[i] * w;
    }
    return this;
  }
  /** keyframed pose objects: keys = [[t, obj], ...] sorted; smooth interpolation between neighbouring keys. */
  keys(p, keys, w = 1, fn = ease.inOut) {
    if (p <= keys[0][0]) return this.addObj(keys[0][1], w);
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, a] = keys[i], [t1, b] = keys[i + 1];
      if (p <= t1) {
        const f = fn(clamp01((p - t0) / Math.max(t1 - t0, 1e-6)));
        this.addObj(a, w * (1 - f)); this.addObj(b, w * f); return this;
      }
    }
    return this.addObj(keys[keys.length - 1][1], w);
  }
  copy(o) { this.a.set(o.a); return this; }
}

// ------------------------------------------------------------------ base monster
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _e = new THREE.Euler();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();

export class MonsterBase {
  /** @param {RigDef} rig */
  constructor(id, rig, opts = {}) {
    this.id = id; this.rig = rig;
    this.root = new THREE.Group(); this.root.name = 'monster-' + id;
    this.body = new THREE.Group(); this.root.add(this.body);
    this.height = 14;
    this.bones = {}; this.boneList = [];
    this.bindPos = [];
    for (const b of rig.bones) {
      const bone = new THREE.Bone(); bone.name = b.name;
      const pp = b.parent ? rig.bones[rig.index[b.parent]].pos : [0, 0, 0];
      bone.position.set(b.pos[0] - pp[0], b.pos[1] - pp[1], b.pos[2] - pp[2]);
      this.bindPos.push(bone.position.clone());
      this.bones[b.name] = bone; this.boneList.push(bone);
      if (b.parent) this.bones[b.parent].add(bone); else this.body.add(bone);
    }
    this.body.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.boneList);
    this.meshes = []; this.materials = []; this.geometries = [];
    this.layout = new PoseLayout(rig);
    this.target = new Pose(this.layout).zero();
    this.out = new Pose(this.layout).zero();
    this.from = new Pose(this.layout).zero();
    this._state = null; this._lastT = 0; this._fade = 1; this._fadeDur = 0.12;
    this.springs = []; // {ch, k, d, lagYaw, lagPitch}
    this._springInit = false;
    this.time = 0; this.walkPhase = 0; this._prevYaw = null; this._prevPitch = 0;
    this.charge = 0; this._glow = 0;
    this._flashT = 0; this._flashDur = 0.12; this._flashColor = new THREE.Color(1, 1, 1);
    this.uniforms = {
      uFlash: { value: new THREE.Color(0, 0, 0) }, uCharge: { value: 0 }, uTime: { value: 0 },
      uGlowColor: { value: new THREE.Color(0x39b6ff) }, uGlowInt: { value: 4 },
    };
    this.sockets = {}; // name → [bone, [x,y,z], dir?]
    this.legs = []; // [{thigh, shin, foot, ch:'ikL', w:0, bindAnkle:Vector3, mirror}]
    this.skin = opts.skin || 'default';
  }

  addSkinned(geometry, material, { shadow = true, receive = true, order = 0 } = {}) {
    const m = new THREE.SkinnedMesh(geometry, material);
    m.castShadow = shadow; m.receiveShadow = receive; m.frustumCulled = false; m.renderOrder = order;
    this.body.add(m);
    this.body.updateMatrixWorld(true);
    m.bind(this.skeleton, m.matrixWorld);
    this.meshes.push(m);
    if (!this.materials.includes(material)) this.materials.push(material);
    if (!this.geometries.includes(geometry)) this.geometries.push(geometry);
    return m;
  }

  addLeg(side) {
    const s = side; const th = this.bones['thigh' + s], sh = this.bones['shin' + s], ft = this.bones['foot' + s];
    const bi = this.rig.index['foot' + s];
    this.legs.push({ th, sh, ft, ch: 'ik' + s, wi: s === 'L' ? 0 : 1, bindAnkle: new THREE.Vector3(...this.rig.bones[bi].pos), mirror: s === 'R' });
  }

  // ---- to implement in subclasses
  pose(/* state, anim, P, dt */) {}
  fadeFor(state) { return state === 'hit' || state === 'hitHeavy' ? 0.06 : state === 'walk' || state === 'idle' ? 0.18 : 0.12; }
  afterUpdate(/* dt, anim */) {}

  update(dt, anim) {
    anim = anim || { state: 'idle', t: 0, progress: 0, speed: 0 };
    const state = anim.state || 'idle';
    const t = anim.t || 0;
    if (state !== this._state || t + 1e-4 < this._lastT - 0.05) {
      if (this._state !== null) { this.from.copy(this.out); this._fade = 0; this._fadeDur = this.fadeFor(state, this._state); }
      this._prevState = this._state; this._state = state;
    }
    this._lastT = t;
    this.time += dt;
    this._fade = Math.min(1, this._fade + (this._fadeDur > 0 ? dt / this._fadeDur : 1));

    const P = this.target.zero();
    this.pose(state, anim, P, dt);

    // crossfade from snapshot
    const o = this.out.a, tg = this.target.a, fr = this.from.a;
    if (this._fade >= 1) o.set(tg);
    else { const f = ease.inOut(this._fade); for (let i = 0; i < o.length; i++) o[i] = fr[i] + (tg[i] - fr[i]) * f; }

    this._applySprings(dt);
    this._apply();
    this._glow = this.out.a[this.layout.off.glow];
    this._updateFx(dt);
    this.afterUpdate(dt, anim);
  }

  _applySprings(dt) {
    const o = this.out.a; const L = this.layout;
    const yaw = o[L.off.bodyRot + 1] + o[this.rig.index.hips * 3 + 1] + this.root.rotation.y;
    const pitch = o[this.rig.index.hips * 3];
    if (this._prevYaw === null) this._prevYaw = yaw;
    let dy = yaw - this._prevYaw; if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
    const dp = pitch - this._prevPitch;
    this._prevYaw = yaw; this._prevPitch = pitch;
    if (!this._springInit) { for (const s of this.springs) { s.x = o[s.ch]; s.v = 0; } this._springInit = true; }
    if (dt <= 0) { for (const s of this.springs) o[s.ch] = s.x; return; }
    const steps = Math.ceil(dt / (1 / 120)); const h = dt / steps;
    for (const s of this.springs) {
      s.x -= dy * (s.lagYaw || 0) + dp * (s.lagPitch || 0);
      for (let k = 0; k < steps; k++) {
        const acc = s.k * (o[s.ch] - s.x) - s.d * s.v; s.v += acc * h; s.x += s.v * h;
      }
      if (s.max) s.x = Math.max(o[s.ch] - s.max, Math.min(o[s.ch] + s.max, s.x));
      o[s.ch] = s.x;
    }
  }

  _apply() {
    const o = this.out.a; const L = this.layout;
    for (let i = 0; i < L.nb; i++) {
      const b = this.boneList[i]; const m = L.mirror[i] ? -1 : 1;
      _e.set(o[i * 3], o[i * 3 + 1] * m, o[i * 3 + 2] * m, 'XYZ');
      b.quaternion.setFromEuler(_e);
      b.position.copy(this.bindPos[i]);
    }
    const hp = L.off.hipsPos; this.boneList[0].position.x += o[hp]; this.boneList[0].position.y += o[hp + 1]; this.boneList[0].position.z += o[hp + 2];
    const bp = L.off.bodyPos, br = L.off.bodyRot;
    this.body.position.set(o[bp], o[bp + 1], o[bp + 2]);
    this.body.rotation.set(o[br], o[br + 1], o[br + 2], 'YXZ');
    this.root.updateWorldMatrix(true, false);
    this.body.updateMatrixWorld(true);
    for (const leg of this.legs) this._solveLeg(leg);
  }

  _solveLeg(leg) {
    const o = this.out.a; const L = this.layout;
    const w = Math.min(1, Math.max(0, o[L.off.ikW + leg.wi]));
    if (w < 0.001) return;
    const { th, sh, ft } = leg;
    const qTh = _q3.copy(th.quaternion); const fkTh = qTh.clone(); const fkSh = sh.quaternion.clone(); const fkFt = ft.quaternion.clone();
    const H = th.getWorldPosition(_v1); const Kc = sh.getWorldPosition(_v2); const Ac = ft.getWorldPosition(_v3);
    const a = H.distanceTo(Kc), b = Kc.distanceTo(Ac);
    const io = L.off[leg.ch]; const mx = leg.mirror ? -1 : 1;
    const T = _v4.set(leg.bindAnkle.x + o[io] * mx, leg.bindAnkle.y + o[io + 1], leg.bindAnkle.z + o[io + 2]);
    this.body.localToWorld(T);
    const dvec = T.clone().sub(H); let d = dvec.length();
    d = Math.min(Math.max(d, Math.abs(a - b) + 0.05), (a + b) * 0.999);
    const n = dvec.normalize();
    // pole: forward of the hips bone (knees bend forward)
    const fwd = _v5.set(0, 0, 1).applyQuaternion(this.boneList[0].getWorldQuaternion(_q)).normalize();
    const pd = fwd.clone().addScaledVector(n, -fwd.dot(n)); if (pd.lengthSq() < 1e-6) pd.set(0, 0, 1); pd.normalize();
    const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d))); const sinA = Math.sqrt(1 - cosA * cosA);
    const K = H.clone().addScaledVector(n, a * cosA).addScaledVector(pd, a * sinA);
    const Tc = H.clone().addScaledVector(n, d);
    // aim thigh
    const cur = Kc.clone().sub(H).normalize(); const want = K.clone().sub(H).normalize();
    _q.setFromUnitVectors(cur, want);
    th.getWorldQuaternion(_q2); _q2.premultiply(_q);
    th.parent.getWorldQuaternion(_q); _q.invert().multiply(_q2);
    th.quaternion.copy(fkTh).slerp(_q, w); th.updateMatrixWorld(true);
    // aim shin
    const K2 = sh.getWorldPosition(new THREE.Vector3()); const A2 = ft.getWorldPosition(new THREE.Vector3());
    _q.setFromUnitVectors(A2.sub(K2).normalize(), Tc.clone().sub(K2).normalize());
    sh.getWorldQuaternion(_q2); _q2.premultiply(_q);
    th.getWorldQuaternion(_q); _q.invert().multiply(_q2);
    sh.quaternion.copy(fkSh).slerp(_q, w); sh.updateMatrixWorld(true);
    // foot: orientation relative to body (flat on ground) using the pose's foot euler
    const bi = this.rig.index[ft.name]; const m = L.mirror[bi] ? -1 : 1;
    _e.set(o[bi * 3], o[bi * 3 + 1] * m, o[bi * 3 + 2] * m, 'XYZ');
    this.body.getWorldQuaternion(_q2); _q2.multiply(_q.setFromEuler(_e));
    sh.getWorldQuaternion(_q); _q.invert().multiply(_q2);
    ft.quaternion.copy(fkFt).slerp(_q, w); ft.updateMatrixWorld(true);
  }

  _updateFx(dt) {
    if (this._flashT > 0) this._flashT = Math.max(0, this._flashT - dt);
    const f = this._flashT > 0 ? Math.pow(this._flashT / this._flashDur, 0.7) * 0.9 : 0;
    this.uniforms.uFlash.value.copy(this._flashColor).multiplyScalar(f);
    this.uniforms.uTime.value = this.time;
  }

  // ---- contract
  getSocket(name, target) {
    const s = this.sockets[name] || this.sockets.chest;
    const bone = this.bones[s[0]];
    target.set(s[1][0], s[1][1], s[1][2]);
    bone.updateWorldMatrix(true, false);
    return bone.localToWorld(target);
  }
  getSocketDir(name, target) {
    const s = this.sockets[name] || this.sockets.chest;
    const bone = this.bones[s[0]];
    bone.updateWorldMatrix(true, false);
    const d = s[2] || [0, 0, 1];
    target.set(d[0], d[1], d[2]).applyQuaternion(bone.getWorldQuaternion(_q)).normalize();
    return target;
  }
  flash(color = 0xffffff, duration = 0.12) { this._flashColor.set(color); this._flashDur = Math.max(duration, 0.01); this._flashT = this._flashDur; }
  setCharge(a) { this.charge = Math.min(1, Math.max(0, a || 0)); }
  setSkin() {}
  dispose() {
    this.root.parent?.remove(this.root);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose(); // textures are cached/shared, intentionally kept
    this.skeleton.dispose();
  }
}

export { RigDef };

// ------------------------------------------------------------------ gait
/**
 * Ground-planted walk cycle. ph = cycle phase (1 cycle = 2 steps). Writes ikL/ikR foot offsets + hips motion.
 * o: { stride (distance per cycle), lift, stance (fraction), lateral, bob, sway, yaw, roll }
 */
export function gait(P, ph, o) {
  const st = o.stance ?? 0.6; const L = o.stride * st * 0.5;
  const legs = [['ikL', ph, 1], ['ikR', ph + 0.5, -1]];
  for (const [ch, p0, side] of legs) {
    const p = ((p0 % 1) + 1) % 1;
    let d, y = 0, pitch = 0;
    if (p < st) d = L / 2 - (p / st) * L;
    else { const q = (p - st) / (1 - st); d = -L / 2 + ease.inOut(q) * L; y = Math.sin(Math.PI * q) * o.lift; pitch = Math.sin(Math.PI * 2 * q) * 0.35; }
    if (o.lateral) P.add(ch, d * side, y, 0);
    else { P.add(ch, 0, y, d); P.add(ch === 'ikL' ? 'footL' : 'footR', -pitch, 0, 0); }
  }
  const w = ((ph % 1) + 1) % 1;
  const c2 = Math.cos(Math.PI * 4 * (w - 0.04));
  P.add('hipsPos', Math.cos(Math.PI * 2 * (w - st / 2)) * (o.sway || 0), -(o.bob || 0) * (0.5 + 0.5 * c2), 0);
  P.add('hips', 0, Math.sin(Math.PI * 2 * w) * (o.yaw || 0), Math.cos(Math.PI * 2 * (w - st / 2)) * (o.roll || 0));
}
