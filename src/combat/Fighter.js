// OWNER: combat agent. Fighter state machine, physics, attacks.
// CONTRACT (used by Match/Game/UI):
//   new Fighter(game, { id, index, isAI }) ; .position (Vector3) ; .hp .maxHp .energy .maxEnergy ; .def (roster entry)
//   .update(dt, opponent) ; .model (MonsterModel) ; .state ; .isKO ; .reset(position, facingTarget)
// ADDITIONS:
//   new Fighter(game, { ..., controller })  — any object with held(a)/pressed(a)/released(a); optional think(dt, self, opp) (AI)
//   .controller (null → game.input.controller(index)) ; .locked (ignore input) ; .comboTaken (hits received in current combo)
//   .reset(pos, target, { keepEnergy }) ; .playState('intro'|'victory'|'taunt', duration) ; .receiveHit(attacker, move, {point, dir})
//   .isActionable() .canCancelNow() .attackId .move .moveName .moveConnected .moveHit .grounded .projectiles .beamActive
//   .state ∈ idle walk walkBack crouch block sidestep jump attack hitstun blockstun juggle knockdown getup ko intro victory taunt
//   .animState = the model anim state actually played
import * as THREE from 'three';
import { createMonsterModel } from '../fighters/models/MonsterModel.js';
import { getFighterDef } from '../fighters/roster.js';
import { getMoveset, F } from './moves.js';
import { Projectile } from './Projectile.js';

const UP = new THREE.Vector3(0, 1, 0);
const BUFFER = 0.15; // input buffer window (s)
const NEUTRAL = new Set(['idle', 'walk', 'walkBack', 'crouch', 'block']);
const BLOCKABLE = new Set(['idle', 'walk', 'walkBack', 'crouch', 'block', 'blockstun']);
const TURNABLE = new Set(['idle', 'walk', 'walkBack', 'crouch', 'block', 'sidestep', 'jump', 'hitstun', 'blockstun', 'getup', 'intro', 'victory', 'taunt']);
const ATTACK_PRIORITY = ['super', 'sp1', 'sp2', 'heavy', 'kick', 'light'];
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3(), _t4 = new THREE.Vector3();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function closestOnSegment(p, a, b, out) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 1e-9 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  return out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
}

// Closest points between segments p1q1 and p2q2 → writes c1, c2, returns distance.
function segSegClosest(p1, q1, p2, q2, c1, c2) {
  const d1 = _t1.subVectors(q1, p1), d2 = _t2.subVectors(q2, p2), r = _t3.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { s = 0; t = 0; }
  else if (a <= 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den !== 0 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  c1.copy(p1).addScaledVector(d1, s); c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceTo(c2);
}

export class Fighter {
  constructor(game, { id, index, isAI = false, controller = null }) {
    this.game = game; this.id = id; this.index = index; this.isAI = isAI;
    this.def = getFighterDef(id) || { name: id, color: '#ffffff' };
    this.moves = getMoveset(id); this.stats = this.moves.stats;
    this.model = createMonsterModel(id);
    game.scene.add(this.model.root);
    this.position = this.model.root.position;
    this.vel = new THREE.Vector3(); this.velocity = this.vel;
    this.radius = this.stats.radius;
    this.height = this.stats.height;
    this.maxHp = 1000; this.hp = 1000; this.maxEnergy = 100; this.energy = 0;
    this.controller = controller;
    this.yaw = index === 0 ? Math.PI / 2 : -Math.PI / 2;
    this.facing = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.projectiles = [];
    this.attackId = 0;
    this._camTarget = new THREE.Vector3();
    this._fwdOpp = new THREE.Vector3(1, 0, 0);
    this._init();
  }

  get stateT() { return this.t; }

  _init() {
    this.state = 'idle'; this.t = 0; this.clock = this.clock || 0;
    this.isKO = false; this.grounded = true; this.locked = false;
    this.move = null; this.moveName = null; this.moveConnected = false; this.moveHit = false; this.sp = {};
    this.stun = 0; this.stunTotal = 0.3; this.hitHeavy = false; this.crouchBlocking = false;
    this.comboTaken = 0; this.comboDamage = 0; this.juggleHits = 0; this.wallBounced = false;
    this.invuln = 0; this.fallStart = 0; this.airAttackUsed = false; this.airTime = 0.9;
    this.buffer = {}; this.inp = { x: 0, up: false, down: false }; this.fb = 0; this.holdBack = false;
    this.stepTimer = 0.2; this.stepFoot = 0; this.stateDur = 1; this.beamActive = false;
    this.dist = 30; this._contactCd = 0; this.animState = 'idle';
  }

  reset(pos, target, opts = {}) {
    this._endMove();
    for (const p of this.projectiles) p.dispose();
    this.projectiles = [];
    const e = this.energy;
    this._init();
    if (opts.keepEnergy) this.energy = e; else this.energy = 0;
    this.hp = this.maxHp;
    this.position.copy(pos); this.vel.set(0, 0, 0);
    const d = _t4.subVectors(target, pos); d.y = 0;
    if (d.lengthSq() > 1e-6) { this.yaw = Math.atan2(d.x, d.z); }
    this.facing.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.model.setCharge?.(0);
    this._animate(0);
  }

  // ---------- helpers ----------
  setState(s) {
    if (this.state === 'attack' && s !== 'attack') this._endMove();
    this.state = s; this.t = 0;
  }
  _softState(s) { if (this.state !== s) this.setState(s); }
  playState(s, duration = 2) { this.setState(s); this.stateDur = duration; this.vel.x = this.vel.z = 0; }
  isActionable() { return this.grounded && NEUTRAL.has(this.state) && !this.isKO; }
  isAirborne() { return !this.grounded; }
  canCancelNow() {
    const m = this.move;
    if (this.state !== 'attack' || !m || !m.cancel || !this.moveConnected) return false;
    const f = this.t / F;
    return f >= m.startup && f <= m.startup + m.active + (m.cancelWindow || 10);
  }
  _gain(x) { this.energy = clamp(this.energy + x, 0, this.maxEnergy); }
  _socket(name, out) {
    if (this.model.getSocket) return this.model.getSocket(name, out);
    return out.copy(this.position).add(_t4.set(0, 9, 0));
  }
  _pan(p) {
    const cam = this.game.camera; if (!cam) return 0;
    const v = _t4.copy(p).project(cam);
    return clamp(Number.isFinite(v.x) ? v.x : 0, -1, 1);
  }
  _sfx(name, p, opts = {}) { if (name) this.game.audio.play?.(name, { pan: this._pan(p || this.position), ...opts }); }
  currentHeight() {
    if (this.state === 'crouch' || (this.state === 'blockstun' && this.crouchBlocking)) return this.stats.crouchHeight;
    if (this.state === 'knockdown' || (this.isKO && this.grounded)) return 4;
    if (this.state === 'juggle' || this.state === 'ko') return this.height * 0.7;
    if (this.state === 'attack' && this.move && (this.move.anim === 'super' && this.move.kind === 'pulse' && this.t < 1.2)) return this.height * 0.8;
    return this.height;
  }
  _capsule(a, b) {
    const h = this.currentHeight(), r = this.radius;
    a.copy(this.position); a.y += Math.min(r, h * 0.5);
    b.copy(this.position); b.y += Math.max(h - r, h * 0.5);
  }
  // sphere vs this fighter's capsule → contact point (Vector3) or null
  sphereOverlap(center, r) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this._capsule(a, b);
    const c = closestOnSegment(center, a, b, new THREE.Vector3());
    const d = c.distanceTo(center);
    if (d >= r + this.radius) return null;
    if (d < 1e-4) return c;
    return c.addScaledVector(_t4.subVectors(center, c).normalize(), this.radius);
  }
  _threatened(opp) {
    if (!opp) return false;
    if (opp.state === 'attack' && opp.move && (opp.move.type !== 'normal' || this.dist < 22)) return true;
    return opp.projectiles.some((p) => p.state !== 'dead');
  }
  _atWall() {
    const R = this.game.city.arenaRadius || 60;
    return Math.hypot(this.position.x, this.position.z) >= R - this.radius * 0.5 - 0.6;
  }

  // ---------- input ----------
  _pollInput(c) {
    for (const a of ['light', 'kick', 'heavy', 'sp1', 'sp2', 'super', 'sideL', 'sideR']) if (c.pressed(a)) this.buffer[a] = this.clock;
    this.inp.x = (c.held('right') ? 1 : 0) - (c.held('left') ? 1 : 0);
    this.inp.up = !!c.held('up'); this.inp.down = !!c.held('down');
  }
  _buffered(a) { const t = this.buffer[a]; return t !== undefined && this.clock - t <= BUFFER; }
  _consume(a) { delete this.buffer[a]; }
  _readDir(fwd) {
    const x = this.inp.x;
    let fb = 0;
    if (x) {
      const sr = this.game.cameraRig?.screenRight?.();
      let d = sr ? sr.dot(fwd) : (this.index === 0 ? 1 : -1);
      if (Math.abs(d) < 0.15) d = d >= 0 ? 0.15 : -0.15;
      fb = Math.sign(x * d);
    }
    this.fb = fb; this.holdBack = fb < 0;
  }

  // ---------- main update ----------
  update(dt, opp) {
    this.opp = opp;
    const c = this.controller || this.game.input.controller(this.index);
    const ai = typeof c.think === 'function';
    if (this.locked || this.isKO) { this.inp.x = 0; this.inp.up = false; this.inp.down = false; this.buffer = {}; }
    else if (ai) { if (dt > 0) { c.think(dt, this, opp); this._pollInput(c); } }
    else this._pollInput(c);
    if (!(dt > 0)) { this._animate(0); return; }

    this.clock += dt; this.t += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this._contactCd = Math.max(0, this._contactCd - dt);

    const toOpp = _t4.subVectors(opp.position, this.position); toOpp.y = 0;
    this.dist = toOpp.length();
    const fwd = this._fwdOpp;
    if (this.dist > 1e-4) fwd.copy(toOpp).divideScalar(this.dist); else fwd.copy(this.facing);
    this._readDir(fwd);

    if (TURNABLE.has(this.state) && !this.isKO) this._turnToward(fwd, dt, this.state === 'jump' ? 3 : 7);

    switch (this.state) {
      case 'idle': case 'walk': case 'walkBack': case 'crouch': case 'block':
        this._updateNeutral(dt, fwd, opp); break;
      case 'sidestep': this._updateSidestep(dt, fwd, opp); break;
      case 'jump': if (!this.airAttackUsed && this._tryAttack(true)) break; break;
      case 'attack': this._updateAttack(dt, fwd, opp); break;
      case 'hitstun': case 'blockstun':
        this.stun -= dt;
        if (this.stun <= 0) this._toNeutral();
        break;
      case 'knockdown':
        if (this.t > 0.85) { this.setState('getup'); this.invuln = 0.8; }
        break;
      case 'getup': if (this.t > 0.6) this._toNeutral(); break;
      case 'intro': case 'taunt': if (this.t > this.stateDur) this._toNeutral(); break;
      default: break; // juggle / ko / victory: physics-driven
    }

    this._physics(dt);
    this._pushbox(opp);
    this._arena(dt);
    this._footsteps(dt);
    for (const p of this.projectiles) p.update(dt, opp);
    this.projectiles = this.projectiles.filter((p) => p.state !== 'dead');
    this._animate(dt);
  }

  _turnToward(fwd, dt, rate) {
    const target = Math.atan2(fwd.x, fwd.z);
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += clamp(d, -rate * dt, rate * dt);
    this.facing.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  _snapFacing(fwd) { this.yaw = Math.atan2(fwd.x, fwd.z); this.facing.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  _toNeutral() {
    this.setState('idle');
    this.comboTaken = 0; this.comboDamage = 0; this.juggleHits = 0; this.stun = 0; this.wallBounced = false;
  }

  _approachVel(target, dt, accel) {
    // horizontal velocity approaches target with limited acceleration (weight)
    const dx = target.x - this.vel.x, dz = target.z - this.vel.z;
    const len = Math.hypot(dx, dz), max = accel * dt;
    if (len <= max) { this.vel.x = target.x; this.vel.z = target.z; }
    else { this.vel.x += (dx / len) * max; this.vel.z += (dz / len) * max; }
  }
  _friction(dt, decel) {
    const s = Math.hypot(this.vel.x, this.vel.z);
    if (s < 1e-4) { this.vel.x = this.vel.z = 0; return; }
    const ns = Math.max(0, s - decel * dt);
    this.vel.x *= ns / s; this.vel.z *= ns / s;
  }

  _updateNeutral(dt, fwd, opp) {
    const st = this.stats;
    if (this._tryAttack(false)) return;
    if (this._buffered('sideL') || this._buffered('sideR')) {
      const left = this._buffered('sideL'); this._consume('sideL'); this._consume('sideR');
      this._startSidestep(left ? -1 : 1, fwd, opp); return;
    }
    if (this.inp.up) { this._startJump(fwd); return; }
    if (this.inp.down) {
      this._softState('crouch'); this.crouchBlocking = this.holdBack;
      this._friction(dt, st.decel); return;
    }
    let targetSpeed = 0;
    if (this.fb > 0) { this._softState('walk'); targetSpeed = st.walk; }
    else if (this.fb < 0) {
      if (this._threatened(opp)) { this._softState('block'); targetSpeed = 0; }
      else { this._softState('walkBack'); targetSpeed = -st.back; }
    } else this._softState('idle');
    const tv = _t1.copy(fwd).multiplyScalar(targetSpeed);
    this._approachVel(tv, dt, targetSpeed === 0 ? st.decel : st.accel);
  }

  _tryAttack(air) {
    for (const name of ATTACK_PRIORITY) {
      if (!this._buffered(name)) continue;
      if (air) {
        if (name === 'light' || name === 'kick' || name === 'heavy') {
          this._consume(name); this.airAttackUsed = true; this.startMove('air'); return true;
        }
        continue;
      }
      const m = this.moves[name];
      if (m.cost && this.energy < m.cost) { this._consume(name); continue; } // not enough meter
      this._consume(name);
      return this.startMove(name);
    }
    return false;
  }

  _startJump(fwd) {
    const st = this.stats;
    this.setState('jump');
    this.grounded = false; this.airAttackUsed = false;
    this.vel.y = st.jumpV;
    this.vel.x = fwd.x * st.jumpFwd * this.fb; this.vel.z = fwd.z * st.jumpFwd * this.fb;
    this.airTime = (2 * st.jumpV) / st.gravity;
    this.position.y += 0.01;
    const foot = this.position.clone();
    this.game.fx.dust?.(foot, 0.7 * st.weight);
    this._sfx('whoosh', foot, { volume: 0.5, pitch: 0.7 });
  }

  _startSidestep(dir, fwd, opp) {
    this.setState('sidestep');
    const cf = this.game.cameraRig?.screenForward?.() || _t1.set(0, 0, -1);
    const perp = _t2.set(-fwd.z, 0, fwd.x);
    const into = perp.dot(cf) > 0 ? 1 : -1; // sign whose perpendicular points into the screen
    this.sideDir = dir < 0 ? into : -into; // sideL (Q) = into the screen, sideR (E) = toward camera
    this.animDir = dir;
    this.sideRadius = Math.max(this.dist, this.radius + opp.radius);
    this.vel.x = this.vel.z = 0;
    this._sfx('whoosh', this.position, { volume: 0.45, pitch: 0.8 });
  }

  _updateSidestep(dt, fwd, opp) {
    const st = this.stats;
    const k = this.t / st.sidestepTime;
    if (k >= 1) { this._toNeutral(); return; }
    const sp = Math.sin(Math.PI * k) * st.sidestepSpeed * 1.5708;
    const perp = _t1.set(-fwd.z, 0, fwd.x).multiplyScalar(this.sideDir);
    this.position.addScaledVector(perp, sp * dt);
    // keep circling at constant radius
    const to = _t2.subVectors(this.position, opp.position); to.y = 0;
    const l = to.length();
    if (l > 1e-3) { to.multiplyScalar(this.sideRadius / l); this.position.x = opp.position.x + to.x; this.position.z = opp.position.z + to.z; }
  }

  // ---------- attacks ----------
  startMove(name) {
    const m = this.moves[name];
    if (!m) return false;
    if (m.cost) { if (this.energy < m.cost) return false; this.energy -= m.cost; }
    if (this.state === 'attack') this._endMove();
    this.state = 'attack'; this.t = 0;
    this.move = m; this.moveName = name; this.moveConnected = false; this.moveHit = false; this.sp = {};
    this.attackId++;
    if (this.grounded && this.opp) {
      const d = _t1.subVectors(this.opp.position, this.position); d.y = 0;
      if (d.lengthSq() > 1e-4) this._snapFacing(d.normalize());
      if (!m.lunge) { this.vel.x *= 0.3; this.vel.z *= 0.3; }
    }
    if (m.type === 'super') this._superStart(m);
    else if (m.type === 'special' && m.kind === 'beam') this._sfx('charge', this.position, { volume: 0.8 });
    return true;
  }

  _endMove() {
    const sp = this.sp || {};
    if (sp.beam) { sp.beam.stop(); sp.beam = null; }
    this.beamActive = false;
    if (sp.proj && sp.proj.state === 'held') sp.proj.explode(0.35);
    if (this.move && (this.move.kind === 'beam' || this.move.kind === 'pulse')) this.model.setCharge?.(0);
    this.sp = {};
  }

  _updateAttack(dt, fwd, opp) {
    const m = this.move;
    const f = this.t / F;
    if (!m.kind || m.kind === 'spin') this._normalPipeline(dt, m, f);
    else this._updateSpecial(dt, m, fwd, opp);
    if (this.state !== 'attack' || this.move !== m) return;

    // cancels (chains on hit/block, specials on hit only)
    if (this.canCancelNow()) {
      for (const name of ATTACK_PRIORITY) {
        if (!m.cancel.includes(name) || !this._buffered(name)) continue;
        const target = this.moves[name];
        if (target.type !== 'normal' && !this.moveHit) continue;
        if (target.cost && this.energy < target.cost) continue;
        this._consume(name);
        this.startMove(name);
        return;
      }
    }
    if (this.t >= m.total) {
      if (this.grounded) this._toNeutral();
      else { this.setState('jump'); this.airAttackUsed = true; }
    }
  }

  _normalPipeline(dt, m, f) {
    if (this.grounded) {
      if (m.lunge && f < m.startup + m.active) { this.vel.x = this.facing.x * m.lunge; this.vel.z = this.facing.z * m.lunge; }
      else this._friction(dt, this.stats.decel);
    }
    if (f >= m.startup && !this.sp.whoosh) {
      this.sp.whoosh = true;
      this._sfx('whoosh', this.position, { volume: 0.35 + m.damage / 300, pitch: m.damage > 80 ? 0.7 : 1 });
      if (m.kind === 'spin') this._spinEffect(m);
    }
    if (f >= m.startup && f < m.startup + m.active && !this.sp.done) this._activeCheck(m, m.hitbox);
  }

  _spinEffect(m) {
    const g = this.game, p = this.position.clone();
    g.fx.shockwave?.(p, 26, this.stats.color);
    g.fx.dust?.(p, 1.8);
    g.city.impact?.(p, 18, 1.4);
    g.cameraRig.shake(0.45, 0.45);
    this._sfx('heavy', p, { volume: 0.9, pitch: 0.7 });
    this._sfx('crumble', p, { volume: 0.6 });
  }

  _hitboxContact(hb) {
    const opp = this.opp;
    if (hb.arc) {
      const to = _t1.subVectors(opp.position, this.position); to.y = 0;
      const d = to.length();
      if (d - opp.radius > hb.range) return null;
      if (opp.position.y - this.position.y > hb.maxY) return null;
      if (hb.arc < 360 && d > 1e-3) {
        const ang = THREE.MathUtils.radToDeg(Math.acos(clamp(to.dot(this.facing) / d, -1, 1)));
        const slack = THREE.MathUtils.radToDeg(Math.atan2(opp.radius, Math.max(d, 1)));
        if (ang > hb.arc / 2 + slack) return null;
      }
      const n = d > 1e-3 ? to.divideScalar(d) : this.facing;
      return opp.position.clone().addScaledVector(n, -opp.radius).setY(opp.position.y + Math.min(3, opp.currentHeight() * 0.3));
    }
    // data sphere (authoritative range)
    const c = new THREE.Vector3().copy(this.position).addScaledVector(this.facing, hb.reach);
    c.y = this.position.y + hb.y;
    let p = opp.sphereOverlap(c, hb.radius);
    if (p) return p;
    // socket sphere (follows the animation), clamped to sensible reach
    const s = this._socket(hb.socket, new THREE.Vector3());
    const hd = Math.hypot(s.x - this.position.x, s.z - this.position.z);
    if (hd <= hb.reach + hb.radius + 1.5) { p = opp.sphereOverlap(s, hb.radius); if (p) return p; }
    return null;
  }

  _activeCheck(m, hb) {
    const opp = this.opp;
    if (!opp || opp.isKO) return null;
    const pt = this._hitboxContact(hb);
    if (!pt) return null;
    const dir = _t2.subVectors(opp.position, this.position); dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.copy(this.facing); else dir.normalize();
    const res = opp.receiveHit(this, m, { point: pt, dir: dir.clone() });
    if (res === 'hit' || res === 'block') { this.moveConnected = true; this.sp.done = true; if (res === 'hit') this.moveHit = true; }
    return res;
  }

  // ---------- specials ----------
  _superStart(m) {
    const g = this.game;
    g.hitStop(0.32);
    this.invuln = m.invulnUntil || 0.5;
    const chest = this._socket('chest', new THREE.Vector3());
    g.ui.announce?.(m.name, { style: 'super', duration: 1.6 });
    this._sfx('super', chest, { volume: 1 });
    g.fx.flashLight?.(chest, this.stats.color, 140, 0.5);
    g.fx.sparks?.(chest, this.stats.color, 40, 25);
    g.renderer?.pulse?.(0.6);
    const cf = g.cameraRig.screenForward?.() || new THREE.Vector3(0, 0, -1);
    const offset = new THREE.Vector3().addScaledVector(this.facing, 15).addScaledVector(cf, -9);
    offset.y = 4.5;
    g.cameraRig.cinematic?.({ target: this.position, lookOffset: new THREE.Vector3(0, 9.5, 0), offset, duration: m.kind === 'pulse' ? 1.9 : 1.5, fov: 30, orbit: 0.22, easeIn: 0.25, easeOut: 0.5 });
    if (m.kind === 'pulse') this._sfx('charge', chest, { volume: 1, pitch: 0.7 });
    if (m.kind === 'rush') this._sfx('chestbeat', chest, { volume: 1 });
  }

  _updateSpecial(dt, m, fwd, opp) {
    const g = this.game, sp = this.sp, t = this.t;
    if (this.grounded && !(m.kind === 'rush' && sp.dashing)) this._friction(dt, this.stats.decel);
    switch (m.kind) {
      case 'beam': this._updateBeam(dt, m, opp); break;
      case 'pulse': {
        this.model.setCharge?.(t < 1.6 ? Math.min(1, t / 1.1) : Math.max(0, 1 - (t - 1.6) / 1.2));
        if (t < 1.2) {
          sp.crackle = (sp.crackle || 0) - dt;
          if (sp.crackle <= 0) { sp.crackle = 0.12; g.fx.sparks?.(this._socket('chest', new THREE.Vector3()), this.stats.color, 10, 12); g.cameraRig.shake(0.06, 0.2); }
        }
        if (t >= 1.2 && !sp.blast) { sp.blast = true; this._pulseBlast(m, opp); }
        if (t >= 1.85 && !sp.roar) { sp.roar = true; this._sfx(this.stats.roar, this.position, { volume: 1 }); }
        break;
      }
      case 'projectile': {
        if (t >= m.grabTime && !sp.proj) {
          sp.proj = new Projectile(g, this, m);
          this.projectiles.push(sp.proj);
          const p = this.position.clone().addScaledVector(this.facing, 3.5);
          g.fx.debris?.(p, 1, 0x8a8278); g.fx.dust?.(p, 1.1);
          g.cameraRig.shake(0.15, 0.3);
          this._sfx('crumble', p, { volume: 0.8 });
        }
        if (t >= m.releaseTime && sp.proj && !sp.thrown) {
          sp.thrown = true;
          const target = opp.position.clone(); target.y += opp.currentHeight() * 0.5;
          target.addScaledVector(opp.vel, 0.15).setY(target.y);
          sp.proj.launch(target);
          this._sfx('whoosh', this.position, { volume: 1, pitch: 0.6 });
        }
        break;
      }
      case 'leap': {
        if (!sp.leapt && t >= m.leapAt) {
          sp.leapt = true;
          const d = new THREE.Vector3().subVectors(opp.position, this.position); d.y = 0;
          let len = d.length();
          if (len > 1e-3) d.divideScalar(len); else d.copy(this.facing);
          this._snapFacing(d);
          len = clamp(len - (this.radius + opp.radius) * 0.4, m.minLeap, m.maxLeap);
          const T = m.airTime;
          this.vel.set(d.x * len / T, m.leapGravity * T / 2, d.z * len / T);
          this.grounded = false; this.position.y += 0.02;
          g.fx.dust?.(this.position.clone(), 1.2);
          g.cameraRig.shake(0.2, 0.3);
          this._sfx('whoosh', this.position, { volume: 0.9, pitch: 0.5 });
        }
        if (sp.leapt && sp.landed && !sp.slammed) this._slam(m, opp);
        if (sp.slammed) { this.vel.x = 0; this.vel.z = 0; }
        break;
      }
      case 'rush': this._updateRush(dt, m, fwd, opp); break;
    }
  }

  _updateBeam(dt, m, opp) {
    const g = this.game, sp = this.sp, t = this.t;
    if (t < m.chargeTime) {
      this.model.setCharge?.(t / m.chargeTime);
      sp.crackle = (sp.crackle || 0) - dt;
      if (sp.crackle <= 0) { sp.crackle = 0.1; g.fx.sparks?.(this._socket('chest', new THREE.Vector3()), this.stats.color, 6, 8); }
    } else if (t < m.beamEnd) this.model.setCharge?.(1);
    if (t >= m.beamStart && t < m.beamEnd) {
      const mouth = this._socket('mouth', new THREE.Vector3());
      if (!sp.beam) {
        sp.beam = g.fx.beam ? g.fx.beam(this.stats.color, 1.7) : null;
        this.beamActive = true;
        const aim = opp.position.clone(); aim.y += opp.currentHeight() * 0.55;
        const d = aim.sub(mouth);
        sp.yaw = Math.atan2(d.x, d.z);
        sp.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        sp.pitch = clamp(sp.pitch, -0.5, 0.15);
        sp.nextTick = t; sp.nextImpact = t; sp.nextSnd = t; sp.ticks = 0;
        this._sfx('beamStart', mouth, { volume: 1 });
        g.fx.flashLight?.(mouth, this.stats.color, 120, 0.3);
      }
      const u = (t - m.beamStart) / (m.beamEnd - m.beamStart);
      const yaw = sp.yaw + Math.sin(u * Math.PI * 2) * m.sweep;
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(sp.pitch), Math.sin(sp.pitch), Math.cos(yaw) * Math.cos(sp.pitch));
      let len = m.beamLength;
      if (dir.y < -1e-3) len = Math.min(len, (mouth.y - 0.2) / -dir.y);
      const end = mouth.clone().addScaledVector(dir, len);
      // beam vs opponent capsule
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c1 = new THREE.Vector3(), c2 = new THREE.Vector3();
      opp._capsule(a, b);
      const d = segSegClosest(mouth, end, a, b, c1, c2);
      const touching = !opp.isKO && d < m.beamRadius + opp.radius;
      if (touching) end.copy(c1);
      if (touching && t >= sp.nextTick) {
        sp.nextTick = t + m.tickInterval;
        const last = t + m.tickInterval >= m.beamEnd;
        const hd = new THREE.Vector3(dir.x, 0, dir.z).normalize();
        const res = opp.receiveHit(this, last ? m.finisher : m, { point: end.clone(), dir: hd });
        if (res === 'hit' || res === 'block') { this.moveConnected = true; if (res === 'hit') this.moveHit = true; sp.ticks++; }
      }
      if (t >= sp.nextImpact) {
        sp.nextImpact = t + 0.15;
        g.fx.sparks?.(end, this.stats.color, 14, 22);
        if (!touching) {
          g.city.impact?.(end, 6, 1);
          // anything along the far half of the beam ignites
          if ((sp.imp = (sp.imp || 0) + 1) % 2 === 0) {
            const mid = mouth.clone().addScaledVector(dir, len * 0.75);
            g.city.impact?.(mid, 4, 0.8);
            g.fx.explosion?.(end, 0.6, 0x66ccff);
          }
        }
      }
      if (t >= sp.nextSnd) { sp.nextSnd = t + 0.35; this._sfx('beam', mouth, { volume: 0.7 }); }
      sp.beam?.set(mouth, end);
      g.cameraRig.shake(0.05, 0.2);
    } else if (sp.beam && t >= m.beamEnd) {
      sp.beam.stop(); sp.beam = null; this.beamActive = false;
    }
    if (t >= m.beamEnd) this.model.setCharge?.(Math.max(0, 1 - (t - m.beamEnd) / 0.3));
  }

  _pulseBlast(m, opp) {
    const g = this.game;
    const c = this.position.clone();
    const chest = this._socket('chest', new THREE.Vector3());
    g.fx.shockwave?.(c, 60, this.stats.color);
    g.fx.shockwave?.(c, 34, 0xffffff);
    g.fx.explosion?.(chest, 3, 0x66ccff);
    g.fx.flashLight?.(chest, this.stats.color, 260, 0.7);
    g.city.impact?.(c, 46, 3);
    g.renderer?.pulse?.(1);
    g.hitStop(0.1);
    g.slowMo(0.35, 0.9);
    g.cameraRig.shake(1, 1.4);
    this._sfx('explosion', c, { volume: 1.2, pitch: 0.6 });
    this._sfx('crumble', c, { volume: 1 });
    const to = new THREE.Vector3().subVectors(opp.position, c); to.y = 0;
    const d = to.length();
    if (d - opp.radius <= m.blastRadius && opp.position.y - c.y < 25) {
      const dir = d > 1e-3 ? to.divideScalar(d) : this.facing.clone();
      const pt = opp._socket('chest', new THREE.Vector3());
      const res = opp.receiveHit(this, m, { point: pt, dir });
      if (res === 'hit' || res === 'block') { this.moveConnected = true; this.moveHit = res === 'hit'; }
    }
  }

  _slam(m, opp) {
    const g = this.game, sp = this.sp;
    sp.slammed = true;
    const p = this.position.clone();
    g.fx.shockwave?.(p, 26, this.stats.color);
    g.fx.dust?.(p, 2); g.fx.debris?.(p, 1.2, 0x8a8278);
    g.fx.flashLight?.(p.clone().setY(3), this.stats.color, 60, 0.2);
    g.city.impact?.(p, 16, 1.6);
    g.cameraRig.shake(0.6, 0.5);
    this._sfx('heavy', p, { volume: 1, pitch: 0.6 }); this._sfx('land', p, { volume: 1 });
    const to = new THREE.Vector3().subVectors(opp.position, p); to.y = 0;
    const d = to.length();
    if (d - opp.radius <= m.slamRadius && opp.position.y - p.y < 6) {
      const dir = d > 1e-3 ? to.divideScalar(d) : this.facing.clone();
      const pt = opp.position.clone().addScaledVector(dir, -opp.radius); pt.y += 2;
      const res = opp.receiveHit(this, m, { point: pt, dir });
      if (res === 'hit' || res === 'block') { this.moveConnected = true; this.moveHit = res === 'hit'; }
    }
  }

  _updateRush(dt, m, fwd, opp) {
    const g = this.game, sp = this.sp, t = this.t;
    if (t >= 0.45 && !sp.roar) { sp.roar = true; this._sfx(this.stats.roar, this.position, { volume: 1 }); }
    if (t < m.dashStart) return;
    const inFront = () => {
      const pt = this.position.clone().addScaledVector(this.facing, this.radius + 1);
      pt.y += 9; return pt;
    };
    if (!sp.locked && !sp.failed) {
      if (t < m.dashEnd) {
        sp.dashing = true;
        this._turnToward(fwd, dt, 6);
        this.vel.x = this.facing.x * m.dashSpeed; this.vel.z = this.facing.z * m.dashSpeed;
        if (!sp.dashSnd) { sp.dashSnd = true; this._sfx('whoosh', this.position, { volume: 1, pitch: 0.5 }); g.fx.dust?.(this.position.clone(), 1.2); }
        const d = Math.hypot(opp.position.x - this.position.x, opp.position.z - this.position.z);
        if (d - this.radius - opp.radius <= 3 && Math.abs(opp.position.y - this.position.y) < 8) {
          const res = opp.receiveHit(this, m, { point: inFront(), dir: this.facing.clone() });
          if (res === 'hit') { sp.locked = true; sp.nextHit = t + 0.1; sp.hits = 0; this.moveConnected = this.moveHit = true; }
          else if (res === 'block' || res === 'whiff') { sp.failed = true; this.moveConnected = res === 'block'; }
          if (sp.locked || sp.failed) { sp.dashing = false; this.vel.x *= 0.1; this.vel.z *= 0.1; }
        }
      } else { sp.failed = true; sp.dashing = false; }
    }
    if (sp.failed) {
      sp.dashing = false;
      if (t >= m.dashEnd + 0.55) this._toNeutral();
      return;
    }
    if (sp.locked) {
      this.vel.x = this.vel.z = 0;
      if (opp.grounded && !opp.isKO) {
        const hold = this.position.clone().addScaledVector(this.facing, this.radius + opp.radius + 0.4);
        opp.position.x = hold.x; opp.position.z = hold.z; opp.vel.x = opp.vel.z = 0;
      }
      if (t < m.flurryEnd && t >= sp.nextHit && !opp.isKO) {
        sp.nextHit = t + m.flurryInterval; sp.hits++;
        const s = this._socket(sp.hits % 2 ? 'handL' : 'handR', new THREE.Vector3());
        const pt = opp.sphereOverlap(s, 3) || inFront();
        opp.receiveHit(this, m.flurry, { point: pt, dir: this.facing.clone() });
      }
      if (t >= m.uppercutAt && !sp.upper && !opp.isKO) {
        sp.upper = true;
        const res = opp.receiveHit(this, m.uppercut, { point: inFront(), dir: this.facing.clone() });
        if (res === 'hit') {
          g.slowMo(0.4, 0.7);
          g.fx.flashLight?.(inFront(), this.stats.color, 150, 0.35);
          g.renderer?.pulse?.(0.8);
          const cf = g.cameraRig.screenForward?.() || new THREE.Vector3(0, 0, -1);
          const off = new THREE.Vector3().addScaledVector(cf, -22).addScaledVector(this.facing, 6); off.y = 2;
          g.cameraRig.cinematic?.({ target: opp.position, lookOffset: new THREE.Vector3(0, 8, 0), offset: off, duration: 1.2, fov: 34, easeIn: 0.15, easeOut: 0.45 });
          this._sfx(this.stats.roar, this.position, { volume: 1 });
        }
      }
    }
  }

  // ---------- receiving hits ----------
  receiveHit(att, m, info = {}) {
    if (this.isKO || this.invuln > 0) return 'whiff';
    if (this.state === 'knockdown' || this.state === 'getup') return 'whiff';
    const st = this.stats;
    if (m.linear && this.state === 'sidestep' && this.t >= st.evadeFrom && this.t <= st.evadeTo) { this.evaded = (this.evaded || 0) + 1; return 'evade'; }
    const crouch = this.grounded && (this.state === 'crouch' || (this.state === 'blockstun' && this.inp.down));
    if (m.level === 'high' && crouch) return 'whiff';
    const dir = info.dir ? info.dir.clone() : this.position.clone().sub(att.position).setY(0).normalize();
    const point = info.point ? info.point.clone() : this._socket('chest', new THREE.Vector3());
    const canBlock = !m.unblockable && this.grounded && this.holdBack && BLOCKABLE.has(this.state);
    if (canBlock && (crouch ? m.level === 'low' : m.level !== 'low')) return this._blocked(att, m, dir, point, crouch);
    return this._hit(att, m, dir, point);
  }

  _blocked(att, m, dir, point, crouch) {
    const g = this.game;
    const chip = m.type === 'normal' || !m.type ? 0 : Math.round((m.damage || 0) * (m.chip ?? 0.1));
    if (chip) {
      this.hp = Math.max(m.type === 'super' ? 0 : 1, this.hp - chip);
      if (this.hp <= 0) return this._hit(att, m, dir, point);
    }
    this.setState('blockstun');
    this.stun = (m.blockstun || 10) * F; this.stunTotal = this.stun; this.crouchBlocking = crouch;
    const kb = (m.knockback || 5) * 0.7;
    this.vel.x = dir.x * kb; this.vel.z = dir.z * kb;
    if (this._atWall()) { att.vel.x -= dir.x * kb * 0.7; att.vel.z -= dir.z * kb * 0.7; }
    this._gain(2.5); att._gain((m.meter || 0) * 0.5);
    this.lastResult = 'block';
    g.hitStop(Math.min(0.08, (m.hitstop || 0.05) * 0.6));
    g.cameraRig.shake((m.shake || 0.1) * 0.45, 0.2);
    g.fx.sparks?.(point, 0x9fd8ff, 14, 14);
    this.model.flash?.(0x88bbff, 0.08);
    this._sfx('block', point, { volume: 0.6 + Math.min(0.4, (m.damage || 0) / 250) });
    return 'block';
  }

  _hit(att, m, dir, point) {
    const g = this.game;
    const n = this.comboTaken;
    const scale = n < 2 ? 1 : Math.max(m.minScale ?? 0.3, 1 - 0.1 * (n - 1));
    const dmg = Math.max(1, Math.round((m.damage || 0) * scale * (this.stats.defenseMul || 1)));
    this.hp = Math.max(0, this.hp - dmg);
    this.comboTaken++; this.comboDamage += dmg;
    this.lastResult = 'hit'; this.lastDamage = dmg;
    this._gain(2 + dmg * 0.05); att._gain(m.meter || 0);
    if (this.state === 'attack') this._endMove();
    const kb = m.knockback || 0;
    if (this.hp <= 0) {
      this.isKO = true;
      if (this.state !== 'juggle') this.fallStart = this.clock;
      this.state = 'ko'; this.t = 0; this.move = null;
      this.grounded = false; this.position.y += 0.05;
      this.vel.set(dir.x * Math.max(kb, 18), Math.max(m.launch || 0, 16), dir.z * Math.max(kb, 18));
    } else if (m.launch || m.knockdown || !this.grounded) {
      const jh = this.juggleHits++;
      let vy = m.launch ? m.launch : (m.knockdown ? 10 : 12);
      vy *= Math.max(0.3, 1 - 0.18 * jh);
      if (jh >= 6) vy = Math.min(vy, 4);
      if (this.state !== 'juggle') this.fallStart = this.clock;
      this.state = 'juggle'; this.t = 0; this.move = null;
      this.grounded = false; this.position.y += 0.05;
      const h = m.launch ? kb * 0.5 : kb;
      this.vel.set(dir.x * h, Math.max(vy, this.vel.y > 0 ? this.vel.y * 0.3 : 0, 3), dir.z * h);
    } else {
      this.setState('hitstun');
      this.stun = (m.hitstun || 15) * F; this.stunTotal = this.stun;
      this.hitHeavy = (m.damage || 0) >= 80 || (m.hitstun || 0) >= 26;
      this.vel.x = dir.x * kb; this.vel.z = dir.z * kb;
      if (this._atWall()) { att.vel.x -= dir.x * kb * 0.6; att.vel.z -= dir.z * kb * 0.6; }
    }
    // game feel
    const heavy = dmg >= 80 || m.type === 'super';
    g.hitStop(m.hitstop ?? 0.06);
    g.cameraRig.shake(m.shake ?? 0.15, heavy ? 0.45 : 0.25);
    const col = m.type === 'normal' || !m.type ? 0xffcc66 : att.stats.color;
    g.fx.sparks?.(point, col, Math.round(18 + dmg * 0.35), 16 + dmg * 0.08);
    if (heavy) g.fx.flashLight?.(point, col, 45, 0.15);
    this.model.flash?.(0xffffff, 0.12);
    if (m.sfx) this._sfx(m.sfx, point, { volume: 0.7 + Math.min(0.5, dmg / 200), pitch: 0.92 + Math.random() * 0.16 });
    return 'hit';
  }

  // ---------- physics ----------
  _gravity() {
    const st = this.stats;
    if (this.state === 'attack' && this.move?.kind === 'leap') return this.move.leapGravity;
    if (this.state === 'juggle' || this.state === 'ko') return st.gravity * (1 + 0.12 * this.juggleHits);
    return st.gravity;
  }

  _physics(dt) {
    const city = this.game.city;
    if (!this.grounded) this.vel.y -= this._gravity() * dt;
    const vy = this.vel.y;
    this.position.addScaledVector(this.vel, dt);
    const floor = city.groundHeight ? city.groundHeight(this.position.x, this.position.z) || 0 : 0;
    if (!this.grounded && this.position.y <= floor && vy <= 0) {
      this.position.y = floor; this.grounded = true; this.vel.y = 0;
      this._land(vy);
    }
    if (this.grounded) {
      this.position.y = floor; this.vel.y = 0;
      const s = this.state;
      if (s === 'hitstun' || s === 'blockstun') this._friction(dt, this.stats.decel * 0.9);
      else if (s === 'knockdown' || s === 'getup' || s === 'ko' || s === 'intro' || s === 'victory' || s === 'taunt' || s === 'jump') this._friction(dt, this.stats.decel * 1.5);
    }
  }

  _land(vy) {
    const g = this.game, st = this.stats, p = this.position.clone();
    const impact = Math.min(1.5, Math.abs(vy) / 30);
    if (this.state === 'juggle' || this.state === 'ko') {
      g.fx.dust?.(p, 1.6 * st.weight);
      g.fx.debris?.(p, 0.6, 0x6b6660);
      g.cameraRig.shake(0.35 * st.weight, 0.4);
      g.city.impact?.(p, 5, 0.5);
      this._sfx('land', p, { volume: 1 }); this._sfx('crumble', p, { volume: 0.5 });
      if (this.state === 'juggle') {
        const ft = this.fallStart;
        this.setState('knockdown'); this.fallStart = ft;
        this.comboTaken = 0; this.comboDamage = 0; this.juggleHits = 0; this.wallBounced = false;
      }
      return;
    }
    g.fx.dust?.(p, (0.6 + impact * 0.6) * st.weight);
    g.cameraRig.shake(0.12 * st.weight * (0.5 + impact), 0.25);
    this._sfx('land', p, { volume: 0.5 + impact * 0.4 });
    if (this.state === 'jump') { this.vel.x *= 0.3; this.vel.z *= 0.3; this._toNeutral(); }
    else if (this.state === 'attack') {
      if (this.move?.kind === 'leap') this.sp.landed = true;
      else if (this.move?.key === 'air') this._toNeutral();
    }
  }

  _pushbox(opp) {
    if (!opp) return;
    if (this.state === 'attack' && this.move?.kind === 'leap' && !this.grounded) return;
    const dy = Math.abs(this.position.y - opp.position.y);
    if (dy > Math.min(this.height, opp.height) * 0.6) return;
    let dx = this.position.x - opp.position.x, dz = this.position.z - opp.position.z;
    let d = Math.hypot(dx, dz);
    const min = this.radius + opp.radius;
    if (d >= min) return;
    if (d < 1e-3) { dx = -this.facing.x; dz = -this.facing.z; d = 1; }
    const push = (min - d) * 0.5;
    this.position.x += (dx / d) * push; this.position.z += (dz / d) * push;
  }

  _arena() {
    const g = this.game, city = g.city;
    const R = (city.arenaRadius || 60) - this.radius * 0.5;
    const h = Math.hypot(this.position.x, this.position.z);
    const flying = this.state === 'juggle' || this.state === 'ko' || this.state === 'hitstun';
    if (h > R) {
      const n = _t3.set(this.position.x / h, 0, this.position.z / h);
      this.position.x = n.x * R; this.position.z = n.z * R;
      const vOut = this.vel.x * n.x + this.vel.z * n.z;
      if (vOut > 0) {
        if (flying && vOut > 12 && !this.wallBounced) this._wallImpact(n.clone(), vOut);
        else { this.vel.x -= n.x * vOut; this.vel.z -= n.z * vOut; }
      }
    }
    const hit = city.fighterContact?.(this.position, this.radius, this.vel);
    if (hit) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (flying && hs > 12 && !this.wallBounced) this._wallImpact(new THREE.Vector3(this.vel.x / hs, 0, this.vel.z / hs), hs);
      else if (this._contactCd <= 0) {
        this._contactCd = 0.5;
        g.cameraRig.shake(0.12, 0.25);
        this._sfx('crumble', this.position, { volume: 0.4 });
      }
    }
  }

  _wallImpact(n, speed) {
    const g = this.game;
    this.wallBounced = true;
    const p = this.position.clone().addScaledVector(n, this.radius); p.y += 5;
    g.city.impact?.(p, 10, speed / 14);
    g.fx.debris?.(p, 1.6, 0x8a8278); g.fx.dust?.(p, 1.6);
    g.cameraRig.shake(0.5, 0.45);
    g.hitStop(0.07);
    this._sfx('crumble', p, { volume: 1 }); this._sfx('heavy', p, { volume: 0.6, pitch: 0.6 });
    const vOut = this.vel.x * n.x + this.vel.z * n.z;
    this.vel.x = (this.vel.x - 2 * vOut * n.x) * 0.35; this.vel.z = (this.vel.z - 2 * vOut * n.z) * 0.35;
    this.vel.y = Math.max(this.vel.y, 10);
    if (this.state === 'hitstun') { this.fallStart = this.clock; this.state = 'juggle'; this.t = 0; }
    this.grounded = false; this.position.y += 0.05;
  }

  _footsteps(dt) {
    if (!this.grounded || (this.state !== 'walk' && this.state !== 'walkBack')) { this.stepTimer = Math.min(this.stepTimer, 0.15); return; }
    const st = this.stats;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed < 1) return;
    this.stepTimer -= dt * (speed / st.walk);
    if (this.stepTimer > 0) return;
    this.stepTimer = st.stepInterval;
    this.stepFoot ^= 1;
    const foot = this._socket(this.stepFoot ? 'footL' : 'footR', new THREE.Vector3()); foot.y = this.position.y;
    this.game.fx.dust?.(foot, 0.45 * st.weight);
    this.game.cameraRig.shake(st.stepShake, 0.18);
    this._sfx('step', foot, { volume: 0.5 * st.weight, pitch: 1.2 - st.weight * 0.3 });
  }

  // ---------- animation ----------
  _animate(dt) {
    let state = this.state, t = this.t, progress = 0, dir;
    switch (this.state) {
      case 'attack': state = this.move?.anim || 'idle'; progress = Math.min(1, t / (this.move?.total || 1)); break;
      case 'hitstun': state = this.hitHeavy ? 'hitHeavy' : 'hit'; progress = Math.min(1, t / this.stunTotal); break;
      case 'blockstun': state = this.crouchBlocking ? 'crouch' : 'block'; progress = Math.min(1, t / this.stunTotal); break;
      case 'juggle': case 'knockdown': state = 'knockdown'; t = this.clock - this.fallStart; progress = Math.min(1, t / 0.8); break;
      case 'ko': t = this.clock - this.fallStart; progress = Math.min(1, t / 1.2); break;
      case 'getup': progress = Math.min(1, t / 0.6); break;
      case 'sidestep': dir = this.animDir; progress = Math.min(1, t / this.stats.sidestepTime); break;
      case 'jump': progress = Math.min(1, t / this.airTime); break;
      case 'intro': case 'victory': case 'taunt': progress = Math.min(1, t / this.stateDur); break;
      default: progress = Math.min(1, t);
    }
    this.animState = state;
    this.model.root.rotation.y = this.yaw;
    this.model.update(dt, { state, t, progress, speed: Math.hypot(this.vel.x, this.vel.z), dir });
  }

  dispose() {
    this._endMove();
    for (const p of this.projectiles) p.dispose();
    this.projectiles = [];
    this.game.scene.remove(this.model.root);
    this.model.dispose();
  }
}
