// OWNER: combat agent. CPU opponent brain (difficulty levels).
// CONTRACT: new AIController(game, difficulty 'easy'|'normal'|'hard') — virtual controller with the same API as Input's
//   Controller: held(a) pressed(a) released(a). Fighter calls think(dt, self, opp) once per simulated frame before reading it.
import { F } from './moves.js';

const DIFF = {
  easy:   { reaction: 0.45, jitter: 0.2,  block: 0.3,  lowRead: 0.3,  aggression: 0.35, think: 0.34, combo: 0.25, confirm: 0.2, punish: 0.1, antiAir: 0.15, evade: 0.2,  special: 0.2, superUse: 0.4, sidestep: 0.04, mistakes: 0.3 },
  normal: { reaction: 0.26, jitter: 0.12, block: 0.6,  lowRead: 0.55, aggression: 0.55, think: 0.2,  combo: 0.6,  confirm: 0.55, punish: 0.45, antiAir: 0.45, evade: 0.5, special: 0.45, superUse: 0.8, sidestep: 0.08, mistakes: 0.12 },
  hard:   { reaction: 0.15, jitter: 0.06, block: 0.88, lowRead: 0.85, aggression: 0.7,  think: 0.12, combo: 0.92, confirm: 0.9, punish: 0.9, antiAir: 0.8, evade: 0.85, special: 0.6, superUse: 1, sidestep: 0.12, mistakes: 0.03 },
};
const ACTIONS = ['left', 'right', 'up', 'down', 'sideL', 'sideR', 'light', 'kick', 'heavy', 'sp1', 'sp2', 'super', 'start'];
const roll = (p) => Math.random() < p;

export class AIController {
  constructor(game, difficulty = 'normal') {
    this.game = game; this.difficulty = DIFF[difficulty] ? difficulty : 'normal';
    this.p = DIFF[this.difficulty];
    this.cur = {}; this.prev = {};
    for (const a of ACTIONS) { this.cur[a] = false; this.prev[a] = false; }
    this.t = 0; this.nextThink = 0.5; this.intent = 0; this.intentUntil = 0; this.crouchUntil = 0;
    this.plan = []; this.planUntil = 0; this.defend = null; this.seenAttack = -1; this.pending = null;
    this.lastAttackT = -10;
  }
  held(a) { return !!this.cur[a]; }
  pressed(a) { return !!this.cur[a] && !this.prev[a]; }
  released(a) { return !this.cur[a] && !!this.prev[a]; }
  _press(a) { if (!this.prev[a]) this.cur[a] = true; }

  think(dt, self, opp) {
    for (const a of ACTIONS) { this.prev[a] = this.cur[a]; this.cur[a] = false; }
    this.t += dt;
    const p = this.p, t = this.t, dist = self.dist;
    const range = self.stats.idealRange;

    // ---- perception: notice new opponent attacks after a reaction delay ----
    if (opp.state === 'attack' && opp.attackId !== this.seenAttack) {
      this.seenAttack = opp.attackId;
      this.pending = { at: t + p.reaction + Math.random() * p.jitter, id: opp.attackId, move: opp.move };
    }
    const flying = opp.projectiles.find((pr) => pr.state === 'flying');
    if (flying && !this.pending && !this.defend && !this._projSeen) {
      this._projSeen = flying;
      this.pending = { at: t + p.reaction, id: -1, move: flying.move, proj: true };
    }
    if (!flying) this._projSeen = null;
    if (this.pending && t >= this.pending.at) {
      const pe = this.pending; this.pending = null;
      const m = pe.move;
      const stillActive = pe.proj || (opp.state === 'attack' && opp.attackId === pe.id);
      const reach = m && m.type === 'normal' ? 24 : 200;
      if (stillActive && dist < reach) {
        if (m.kind === 'beam' && roll(p.evade)) this.defend = { sidestep: true, until: t + 2.2, id: pe.id };
        else if (roll(p.block)) this.defend = { low: m.level === 'low' ? roll(p.lowRead) : (m.level === 'high' && roll(p.lowRead * 0.3)), until: t + (pe.proj ? 1.2 : 3.5), id: pe.id, proj: pe.proj };
      }
    }
    if (this.defend) {
      const d = this.defend;
      const oppDone = d.proj ? !opp.projectiles.some((pr) => pr.state === 'flying') : !(opp.state === 'attack' && opp.attackId === d.id);
      if (t > d.until || (oppDone && !d.linger)) { if (oppDone && !d.linger) d.linger = t + 0.12; }
      if (t > d.until || (d.linger && t > d.linger)) this.defend = null;
    }

    const fwdHold = (fb) => this._dir(fb, self, opp);

    // ---- executing a combo plan ----
    if (this.plan.length && t < this.planUntil) {
      if (self.state === 'attack' && self.moveConnected && self.canCancelNow()) {
        const next = this.plan[0];
        const nm = self.moves[next];
        const special = nm.type !== 'normal';
        if (special && !self.moveHit && !roll(1 - p.confirm)) { this.plan = []; }
        else if (nm.cost && self.energy < nm.cost) this.plan = [];
        else { this.plan.shift(); if (!roll(p.mistakes)) this._press(next); }
      } else if (self.isActionable() && t - this.lastAttackT > 0.15) this.plan = [];
      else if (self.state === 'attack' && !self.moveConnected && self.t > (self.move.startup + self.move.active) * F) this.plan = [];
      return;
    }
    this.plan = [];

    if (!self.isActionable()) {
      if (self.state === 'jump' && dist < 12 && !self.airAttackUsed && self.vel.y < 4 && roll(0.2)) this._press('heavy');
      return;
    }

    // ---- defence ----
    if (this.defend) {
      const d = this.defend;
      if (d.sidestep) {
        const bm = opp.move;
        if (opp.state === 'attack' && bm && bm.kind === 'beam' && opp.t > bm.beamStart - 0.3) { this._press(Math.random() < 0.5 ? 'sideL' : 'sideR'); this.defend = null; }
        else fwdHold(-1);
      } else { fwdHold(-1); if (d.low) this.cur.down = true; }
      return;
    }

    // ---- offence / spacing ----
    const oppRecovering = opp.state === 'attack' && opp.move && !opp.moveConnected && opp.t > (opp.move.startup + opp.move.active) * F && opp.move.type === 'normal';
    if (oppRecovering && dist < range + 5 && roll(p.punish * dt * 20)) { this._startPlan(self, ['heavy', self.energy >= 25 ? 'sp2' : null]); return; }
    if (!opp.grounded && opp.state === 'jump' && dist < 16 && roll(p.antiAir * dt * 12)) { this._startPlan(self, ['heavy']); return; }

    if (t < this.nextThink) { this._hold(fwdHold); return; }
    this.nextThink = t + p.think * (0.6 + Math.random() * 0.8);

    const isSaurian = self.id === 'saurian';
    if (self.energy >= 100 && roll(p.superUse * 0.5) && ((isSaurian && dist < 24) || (!isSaurian && dist < 30))) { this._press('super'); this.lastAttackT = t; return; }
    if (dist > range + 8) {
      if (self.energy >= 25 && roll(p.special * 0.35) && dist > 16) { this._press('sp1'); this.lastAttackT = t; return; }
      if (!isSaurian && self.energy >= 25 && dist < 28 && roll(p.special * 0.15)) { this._press('sp2'); this.lastAttackT = t; return; }
      if (roll(0.05)) { this.intent = 1; this.cur.up = true; fwdHold(1); return; }
      this._setIntent(1, 0.4);
    } else if (dist <= range + 2.5) {
      if (roll(p.sidestep)) { this._press(Math.random() < 0.5 ? 'sideL' : 'sideR'); return; }
      if (roll(p.aggression) && t - this.lastAttackT > p.think * 1.5) {
        const r = Math.random();
        const sp = self.energy >= 25 && roll(p.combo) ? (Math.random() < 0.5 ? 'sp2' : 'sp1') : null;
        if (r < 0.45) this._startPlan(self, ['light', roll(p.combo) ? 'kick' : null, roll(p.combo) ? 'heavy' : null, sp]);
        else if (r < 0.7) this._startPlan(self, ['kick', roll(p.combo) ? 'heavy' : null, sp]);
        else if (r < 0.85) this._startPlan(self, ['heavy', sp]);
        else { this.crouchUntil = t + 0.4 + Math.random() * 0.5; }
        return;
      }
      this._setIntent(dist < range - 2.5 ? -1 : (Math.random() < 0.5 ? 0 : -1), 0.25 + Math.random() * 0.3);
    } else {
      this._setIntent(Math.random() < 0.75 ? 1 : 0, 0.3 + Math.random() * 0.3);
    }
    this._hold(fwdHold);
  }

  _setIntent(fb, dur) { this.intent = fb; this.intentUntil = this.t + dur; }
  _hold(fwdHold) {
    if (this.t < this.crouchUntil) { this.cur.down = true; return; }
    if (this.t < this.intentUntil && this.intent) fwdHold(this.intent);
  }
  _startPlan(self, list) {
    this.plan = list.filter(Boolean);
    const first = this.plan.shift();
    if (!first) return;
    this._press(first);
    this.planUntil = this.t + 2.5; this.lastAttackT = this.t;
  }
  // hold forward (+1) / back (-1) translated to screen left/right, exactly like a human would press
  _dir(fb, self, opp) {
    if (!fb) return;
    const sr = this.game.cameraRig?.screenRight?.();
    const fx = opp.position.x - self.position.x, fz = opp.position.z - self.position.z;
    let d = sr ? sr.x * fx + sr.z * fz : (self.index === 0 ? 1 : -1);
    if (Math.abs(d) < 1e-3) d = self.index === 0 ? 1 : -1;
    const right = Math.sign(d) * fb > 0;
    this.cur[right ? 'right' : 'left'] = true;
  }
}
