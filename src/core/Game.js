// OWNER: core (orchestrator). Top-level loop + screen flow. Sub-systems plug in via their CONTRACT headers.
import * as THREE from 'three';
import { Renderer } from './Renderer.js';
import { Input } from './Input.js';
import { CameraRig } from './CameraRig.js';
import { City } from '../world/City.js';
import { FX } from '../fx/FX.js';
import { Audio } from '../audio/Audio.js';
import { UI } from '../ui/UI.js';
import { Match } from '../combat/Match.js';
import { createMonsterModel } from '../fighters/models/MonsterModel.js';

export class Game {
  constructor(container, uiRoot) {
    this.renderer = new Renderer(container);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.5, 3000);
    this.input = new Input();
    this.audio = new Audio();
    this.fx = new FX(this.scene);
    this.city = new City(this.scene, this.renderer.renderer, this.fx);
    this.cameraRig = new CameraRig(this.camera);
    this.ui = new UI(uiRoot, this);
    this._last = performance.now(); this.elapsed = 0;
    this.match = null; this.paused = false;
    this.timeScale = 1; this._hitStop = 0; this._slowMo = null;
    this.preview = [];
    this.state = 'boot';
    this.lastSelection = null;
  }

  start() {
    this.toTitle();
    this.renderer.renderer.setAnimationLoop(() => this.frame());
  }

  // --- time control helpers (used by combat for game feel) ---
  hitStop(seconds) { this._hitStop = Math.max(this._hitStop, seconds); }
  slowMo(scale, duration) { this._slowMo = { scale, left: duration }; }

  // --- screen flow ---
  _clearMatch() { if (this.match) { this.match.dispose(); this.match = null; } this.fx.clear(); }
  _clearPreview() { for (const m of this.preview) { this.scene.remove(m.root); m.dispose(); } this.preview = []; }

  toTitle() {
    this.state = 'title'; this._clearMatch(); this._clearPreview(); this.paused = false;
    this.cameraRig.setMode('orbit');
    this.audio.music('title');
    this.ui.showTitle(() => this.toSelect());
  }

  toSelect() {
    this.state = 'select'; this._clearMatch(); this.paused = false;
    this.audio.music('select');
    this.ui.showSelect((sel) => this.startMatch(sel), () => this.toTitle());
  }

  // Show the two chosen monsters facing each other behind the select menu.
  previewSelection(p1, p2) {
    const ids = [p1, p2];
    if (this.preview.length === 2 && this.preview.every((m, i) => m.id === ids[i])) return;
    this._clearPreview();
    const targets = [];
    ids.forEach((id, i) => {
      if (!id) return;
      const m = createMonsterModel(id);
      m.id = id;
      m.root.position.set(i === 0 ? -14 : 14, 0, 0);
      m.root.lookAt(0, 0, 0);
      this.scene.add(m.root);
      this.preview.push(m);
      targets.push(m.root.position);
    });
    this.cameraRig.setMode('select', { targets });
  }

  startMatch(sel) {
    this._clearPreview(); this._clearMatch();
    this.lastSelection = sel;
    this.state = 'fight'; this.paused = false;
    this.city.reset();
    this.ui.showHUD();
    this.audio.music('fight');
    this.match = new Match(this, sel);
    this.match.onEnd = (result) => {
      this.state = 'results';
      this.ui.showResults(result, () => this.startMatch(this.lastSelection), () => this.toSelect());
    };
  }

  togglePause() {
    if (this.state !== 'fight') return;
    this.paused = !this.paused;
    if (this.paused) this.ui.showPause(() => this.togglePause(), () => { this.paused = false; this.ui.hidePause(); this.toSelect(); });
    else this.ui.hidePause();
  }

  frame() {
    const now = performance.now(); const rawDt = Math.min((now - this._last) / 1000, 1 / 20); this._last = now; this.elapsed += rawDt;
    this.input.update();
    if (this.state === 'fight' && (this.input.controller(0).pressed('start') || this.input.controller(1).pressed('start'))) this.togglePause();

    let dt = rawDt * this.timeScale;
    if (this._slowMo) { dt *= this._slowMo.scale; this._slowMo.left -= rawDt; if (this._slowMo.left <= 0) this._slowMo = null; }
    if (this._hitStop > 0) { this._hitStop -= rawDt; dt = 0; }
    if (this.paused) dt = 0;

    if (this.match) this.match.update(dt);
    for (const m of this.preview) m.update(rawDt, { state: 'idle', t: this.elapsed, progress: 0, speed: 0 });
    this.city.update(dt, this.camera);
    this.fx.update(dt, this.camera);
    this.cameraRig.update(this.paused ? 0 : rawDt);
    this.ui.update(rawDt);
    this.renderer.render(this.scene, this.camera);
  }
}
