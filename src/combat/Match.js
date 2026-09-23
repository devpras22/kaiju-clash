// OWNER: combat agent. Rounds, timer, win conditions, match flow.
// CONTRACT (used by Game):
//   new Match(game, { p1, p2, mode: 'cpu' | 'versus', difficulty }) ; .update(dt) ; .dispose()
//   .onEnd = (result: { winner: 0|1|null, p1, p2, rounds: [w0,w1] }) => {}
//   Match drives UI via game.ui.updateHUD(...) / game.ui.announce(...)
// ADDITIONS: match.setAI(index, difficulty|null) — make any fighter CPU-controlled (tests / attract mode)
//   .phase 'intro'|'fight'|'ko'|'over' ; .fighters ; .round ; .rounds ; .timer
import * as THREE from 'three';
import { Fighter } from './Fighter.js';
import { AIController } from './AI.js';

const START = [new THREE.Vector3(-15, 0, 0), new THREE.Vector3(15, 0, 0)];

export class Match {
  constructor(game, { p1, p2, mode = 'cpu', difficulty = 'normal' } = {}) {
    this.game = game; this.mode = mode; this.difficulty = difficulty;
    this.fighters = [new Fighter(game, { id: p1, index: 0, isAI: false }), new Fighter(game, { id: p2, index: 1, isAI: mode === 'cpu' })];
    if (mode === 'cpu') this.setAI(1, difficulty);
    this.rounds = [0, 0]; this.round = 1; this.timer = 99; this.phase = 'intro'; this.phaseT = 0;
    this.onEnd = null; this.prevCombo = [0, 0]; this._camTarget = new THREE.Vector3();
    game.cameraRig.setMode('fight', { fighters: this.fighters });
    this.startRound();
  }

  setAI(index, difficulty) {
    const f = this.fighters[index];
    f.controller = difficulty ? new AIController(this.game, difficulty) : null;
    f.isAI = !!difficulty;
  }

  startRound() {
    const [a, b] = this.fighters;
    a.reset(START[0], START[1], { keepEnergy: this.round > 1 });
    b.reset(START[1], START[0], { keepEnergy: this.round > 1 });
    this.timer = 99; this.phase = 'intro'; this.phaseT = 0; this.events = {};
    this.prevCombo = [0, 0];
    this.introLen = this.round === 1 ? 4.4 : 2.2;
    for (const f of this.fighters) { f.locked = true; if (this.round === 1) f.playState('intro', 2.6); }
    const g = this.game;
    if (this.round === 1) {
      const cf = g.cameraRig.screenForward?.() || new THREE.Vector3(0, 0, -1);
      const off = new THREE.Vector3(10, 3, 0).addScaledVector(cf, -18);
      g.cameraRig.cinematic?.({ target: a.position, lookOffset: new THREE.Vector3(0, 9, 0), offset: off, duration: 1.7, fov: 32, orbit: 0.25, easeIn: 0.01, easeOut: 0.4 });
    }
  }

  _once(key) { if (this.events[key]) return false; this.events[key] = true; return true; }

  update(dt) {
    const g = this.game, [a, b] = this.fighters;
    this.phaseT += dt;
    if (this.phase === 'intro') {
      if (this.round === 1) {
        if (this.phaseT > 0.3 && this._once('roarA')) g.audio.play?.(a.stats.roar, { pan: -0.5 });
        if (this.phaseT > 1.5 && this._once('camB')) {
          const cf = g.cameraRig.screenForward?.() || new THREE.Vector3(0, 0, -1);
          const off = new THREE.Vector3(-10, 3, 0).addScaledVector(cf, -18);
          g.cameraRig.cinematic?.({ target: b.position, lookOffset: new THREE.Vector3(0, 9, 0), offset: off, duration: 1.7, fov: 32, orbit: -0.25, easeIn: 0.3, easeOut: 0.5 });
        }
        if (this.phaseT > 1.7 && this._once('roarB')) g.audio.play?.(b.stats.roar, { pan: 0.5 });
      }
      if (this.phaseT > this.introLen - 1.3 && this._once('round')) {
        g.ui.announce?.(`ROUND ${this.round}`, { style: 'round', duration: 1.1 }); g.audio.play?.('announce_round');
      }
      if (this.phaseT > this.introLen) {
        g.ui.announce?.('FIGHT!', { style: 'fight', duration: 0.9 }); g.audio.play?.('announce_fight');
        this.phase = 'fight'; this.phaseT = 0;
        for (const f of this.fighters) { f.locked = false; if (f.state === 'intro') f.setState('idle'); }
      }
      a.update(dt, b); b.update(dt, a);
    } else if (this.phase === 'fight') {
      this.timer = Math.max(0, this.timer - dt);
      a.update(dt, b); b.update(dt, a);
      if (a.isKO || b.isKO || this.timer <= 0) this._endRound();
    } else {
      a.update(dt, b); b.update(dt, a);
      if (this.phase === 'ko') this._updateKO(dt);
    }
    // combo tracking
    for (let i = 0; i < 2; i++) {
      const c = this.fighters[1 - i].comboTaken;
      if (c < this.prevCombo[i] && this.prevCombo[i] >= 3) g.ui.announce?.(`${this.prevCombo[i]} HIT COMBO`, { style: 'combo', duration: 1.2 });
      this.prevCombo[i] = c;
    }
    const hud = (f, i) => ({ name: f.def.name, hp: f.hp, maxHp: f.maxHp, energy: f.energy, maxEnergy: f.maxEnergy, rounds: this.rounds[i], color: f.def.color, combo: this.fighters[1 - i].comboTaken });
    g.ui.updateHUD({ p1: hud(a, 0), p2: hud(b, 1), timer: Math.ceil(this.timer), round: this.round });
  }

  _endRound() {
    const g = this.game, [a, b] = this.fighters;
    const timeOver = !a.isKO && !b.isKO;
    let w;
    if (a.isKO && b.isKO) w = null;
    else if (a.isKO) w = 1; else if (b.isKO) w = 0;
    else w = a.hp === b.hp ? null : (a.hp > b.hp ? 0 : 1);
    this.lastWinner = w; this.timeOver = timeOver;
    if (w === null) { this.rounds[0]++; this.rounds[1]++; } else this.rounds[w]++;
    this.phase = 'ko'; this.phaseT = 0; this.events = {};
    for (const f of this.fighters) f.locked = true;
    if (timeOver) {
      g.ui.announce?.('TIME OVER', { style: 'ko', duration: 1.6 }); g.audio.play?.('announce_ko');
    } else {
      const loser = w === null ? a : this.fighters[1 - w];
      g.slowMo(0.3, 1.8);
      g.hitStop(0.12);
      g.ui.announce?.(w === null ? 'DOUBLE K.O.' : 'K.O.', { style: 'ko', duration: 1.8 });
      g.audio.play?.('announce_ko'); g.audio.play?.('ko');
      g.cameraRig.shake(0.6, 0.8);
      const cf = g.cameraRig.screenForward?.() || new THREE.Vector3(0, 0, -1);
      const off = new THREE.Vector3().addScaledVector(cf, -26); off.y = 3;
      g.cameraRig.cinematic?.({ target: loser.position, lookOffset: new THREE.Vector3(0, 5, 0), offset: off, duration: 2.6, fov: 34, orbit: 0.15, easeIn: 0.3, easeOut: 0.6 });
    }
  }

  _updateKO() {
    const g = this.game, w = this.lastWinner;
    const winner = w === null ? null : this.fighters[w];
    if (winner && this.phaseT > 1.6 && this._once('victory')) {
      if (!winner.isKO) { winner.playState('victory', 3); g.audio.play?.(winner.stats.roar); }
    }
    if (winner && this.phaseT > 2.1 && this._once('perfect') && winner.hp >= winner.maxHp && !this.timeOver) g.ui.announce?.('PERFECT', { style: 'perfect', duration: 1.4 });
    if (w === null && this.timeOver && this.phaseT > 1.8 && this._once('draw')) g.ui.announce?.('DRAW', { style: 'info', duration: 1.2 });
    if (this.phaseT > 4.2) {
      const [r0, r1] = this.rounds;
      if (r0 >= 2 || r1 >= 2 || this.round >= 5) {
        this.phase = 'over';
        const winnerIdx = r0 === r1 ? null : (r0 > r1 ? 0 : 1);
        const [a, b] = this.fighters;
        this.onEnd && this.onEnd({ winner: winnerIdx, p1: a.id, p2: b.id, rounds: [...this.rounds] });
      } else { this.round++; this.startRound(); }
    }
  }

  dispose() { this.fighters.forEach((f) => f.dispose()); }
}
