// OWNER: core (orchestrator). Keyboard + gamepad → per-player virtual controllers.
// CONTRACT: input.update() once per frame; input.controller(i) → Controller
// Controller: .held(action) .pressed(action) (edge, this frame) .released(action)
// Actions: left right up down sideL sideR light kick heavy sp1 sp2 super start
// Also input.anyPressed(action) for menus (any player / any device), and input.menuPressed('confirm'|'back'|'left'|'right'|'up'|'down').
export const ACTIONS = ['left', 'right', 'up', 'down', 'sideL', 'sideR', 'light', 'kick', 'heavy', 'sp1', 'sp2', 'super', 'start'];

const KEYMAPS = [
  { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], sideL: ['KeyQ'], sideR: ['KeyE'],
    light: ['KeyJ'], kick: ['KeyK'], heavy: ['KeyL'], sp1: ['KeyU'], sp2: ['KeyI'], super: ['KeyO'], start: ['Escape', 'Enter'] },
  { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], sideL: ['Numpad7'], sideR: ['Numpad9'],
    light: ['Numpad1'], kick: ['Numpad2'], heavy: ['Numpad3'], sp1: ['Numpad4'], sp2: ['Numpad5'], super: ['Numpad6'], start: ['NumpadEnter'] },
];
// Standard gamepad mapping
const PADMAP = { light: [2], kick: [0], heavy: [3], sp1: [1], sp2: [5], super: [7], sideL: [4], sideR: [6], start: [9],
  up: [12], down: [13], left: [14], right: [15] };

class Controller {
  constructor() { this.cur = {}; this.prev = {}; for (const a of ACTIONS) { this.cur[a] = false; this.prev[a] = false; } }
  held(a) { return this.cur[a]; }
  pressed(a) { return this.cur[a] && !this.prev[a]; }
  released(a) { return !this.cur[a] && this.prev[a]; }
}

export class Input {
  constructor() {
    this.keys = new Set();
    this.controllers = [new Controller(), new Controller()];
    this.menu = { confirm: false, back: false, left: false, right: false, up: false, down: false };
    this.menuPrev = { ...this.menu };
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.virtual = [{}, {}]; // for automated tests / AI injection: input.virtual[0].light = true
  }

  update() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    this.controllers.forEach((c, i) => {
      const km = KEYMAPS[i];
      const pad = pads[i];
      for (const a of ACTIONS) {
        c.prev[a] = c.cur[a];
        let v = km[a].some((k) => this.keys.has(k)) || !!this.virtual[i][a];
        if (pad) {
          v = v || (PADMAP[a] || []).some((b) => pad.buttons[b] && pad.buttons[b].pressed);
          const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
          if (a === 'left' && ax < -0.5) v = true;
          if (a === 'right' && ax > 0.5) v = true;
          if (a === 'up' && ay < -0.6) v = true;
          if (a === 'down' && ay > 0.6) v = true;
        }
        c.cur[a] = v;
      }
    });
    this.menuPrev = { ...this.menu };
    const any = (a) => this.controllers.some((c) => c.held(a));
    this.menu.confirm = any('light') || this.keys.has('Enter') || this.keys.has('Space');
    this.menu.back = this.keys.has('Escape') || this.keys.has('Backspace') || any('kick');
    this.menu.left = any('left'); this.menu.right = any('right'); this.menu.up = any('up'); this.menu.down = any('down');
  }

  controller(i) { return this.controllers[i]; }
  menuPressed(a) { return this.menu[a] && !this.menuPrev[a]; }
}
