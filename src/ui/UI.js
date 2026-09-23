// OWNER: ui/audio agent. All DOM UI: title, character select, HUD, announcer, pause, results.
// CONTRACT (called by Game / Match — must be preserved):
//   new UI(rootEl, game)
//   ui.showTitle(onStart)                                   — onStart()
//   ui.showSelect(onConfirm, onBack)                        — onConfirm({ p1, p2, mode: 'cpu'|'versus', difficulty: 'easy'|'normal'|'hard' })
//        may call game.previewSelection(p1Id, p2Id) to show the 3D models behind the menu
//   ui.showHUD()
//   ui.updateHUD({ p1: {name,hp,maxHp,energy,maxEnergy,rounds,color, combo}, p2: {...}, timer, round })  — called every frame
//   ui.announce(text, { style: 'round'|'fight'|'ko'|'perfect'|'combo'|'super'|'info', duration })
//   ui.showPause(onResume, onQuit) ; ui.hidePause()
//   ui.showResults({ winner, p1, p2, rounds }, onRematch, onMenu)
//   ui.update(dt) — called every frame (menus read game.input.menuPressed(...) for keyboard/gamepad navigation)
// OPTIONAL EXTRAS (ui/audio agent, backwards compatible):
//   announce opts: { side: 0|1 (combo/super placement), color: css colour (super streak / combo), sound: false (silence) }
//   announce() infers style from text when omitted (ROUND / FIGHT / K.O. / PERFECT / TIME / HITS)
//   ui.mode — 'cpu'|'versus' chosen on the title menu ; M key / corner button toggles audio mute
import { ROSTER } from '../fighters/roster.js';

const MOVES = {
  saurian: [['CLAW SWIPE', 'light'], ['TAIL WHIP', 'kick'], ['HEADBUTT SLAM', 'heavy'], ['ATOMIC BREATH', 'sp1'], ['TAIL QUAKE', 'sp2'], ['NUCLEAR PULSE', 'super']],
  ape: [['JAB', 'light'], ['STOMP KICK', 'kick'], ['HAMMER FIST', 'heavy'], ['BUILDING HURL', 'sp1'], ['LEAPING SMASH', 'sp2'], ['PRIMAL FURY', 'super']],
};
const KEYCAP = {
  p1: { light: 'J', kick: 'K', heavy: 'L', sp1: 'U', sp2: 'I', super: 'O' },
  p2: { light: 'NUM1', kick: 'NUM2', heavy: 'NUM3', sp1: 'NUM4', sp2: 'NUM5', super: 'NUM6' },
  pad: { light: 'X', kick: 'A', heavy: 'Y', sp1: 'B', sp2: 'RB', super: 'RT' },
};
const CONTROLS = [
  ['MOVE', 'A / D', '← / →', 'D-PAD / L-STICK'],
  ['JUMP', 'W', '↑', 'UP'],
  ['CROUCH', 'S', '↓', 'DOWN'],
  ['BLOCK', 'HOLD BACK', 'HOLD BACK', 'HOLD BACK'],
  ['SIDESTEP', 'Q / E', 'NUM7 / NUM9', 'LB / LT'],
  ['LIGHT', 'J', 'NUM1', 'X'],
  ['KICK', 'K', 'NUM2', 'A'],
  ['HEAVY', 'L', 'NUM3', 'Y'],
  ['SPECIAL 1', 'U', 'NUM4', 'B'],
  ['SPECIAL 2', 'I', 'NUM5', 'RB'],
  ['SUPER', 'O', 'NUM6', 'RT'],
  ['PAUSE', 'ESC', 'NUM ENTER', 'START'],
];
const TILES = ['saurian', 'random', 'ape'];
const DIFFS = ['easy', 'normal', 'hard'];
const NUMWORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const def = (id) => ROSTER.find((f) => f.id === id) || ROSTER[0];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ inline SVG silhouettes
function silhouette(id, color, uid) {
  const g = `kc-g-${uid}`, r = `kc-r-${uid}`;
  const defs = `<defs>
    <radialGradient id="${r}" cx="50%" cy="55%" r="60%"><stop offset="0" stop-color="${color}" stop-opacity=".55"/><stop offset=".6" stop-color="${color}" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c232c"/><stop offset=".55" stop-color="#07090c"/><stop offset="1" stop-color="#000"/></linearGradient>
  </defs><rect width="200" height="200" fill="url(#${r})"/>`;
  if (id === 'saurian') {
    return `<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMax meet">${defs}
      <g fill="${color}" class="glow">
        <path d="M88 128 L66 112 L93 117Z M95 108 L72 90 L99 97Z M103 92 L82 70 L109 81Z M111 78 L94 54 L117 67Z M119 66 L108 44 L125 57Z M80 150 L58 140 L85 144Z M64 166 L42 160 L68 161Z M46 177 L26 175 L48 173Z"/>
      </g>
      <path fill="url(#${g})" stroke="${color}" stroke-width="1.6" stroke-opacity=".9" d="M8 188 C40 186 70 176 84 160 C86 140 88 118 96 100 C102 84 110 70 118 60 C122 50 128 42 138 40 L160 42 L174 50 L169 56 L153 58 L165 64 L147 69 C140 76 138 82 140 88 L156 96 L166 108 L171 117 L163 112 L165 121 L157 113 L147 105 C146 120 144 132 138 142 C144 156 150 170 152 184 L165 190 L165 196 L124 196 L126 184 C122 172 116 166 108 164 C104 176 104 186 106 192 L113 196 L84 196 L86 186 C70 190 40 194 8 188Z"/>
      <circle cx="151" cy="48" r="2.4" fill="#fff"/><circle cx="151" cy="48" r="5" fill="${color}" opacity=".6"/>
    </svg>`;
  }
  if (id === 'ape') {
    return `<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMax meet">${defs}
      <path fill="url(#${g})" stroke="${color}" stroke-width="1.6" stroke-opacity=".9" d="M100 20 C116 20 124 32 122 46 C140 44 164 50 174 66 C184 82 186 104 184 124 C184 146 188 168 190 184 L194 196 L166 196 L168 186 C164 168 160 148 156 130 C154 122 150 116 148 112 C150 130 148 146 140 156 C144 170 146 184 146 196 L118 196 L118 184 C114 176 106 172 100 172 C94 172 86 176 82 184 L82 196 L54 196 C54 184 56 170 60 156 C52 146 50 130 52 112 C50 116 46 122 44 130 C40 148 36 168 32 186 L34 196 L6 196 L10 184 C12 168 16 146 16 124 C14 104 16 82 26 66 C36 50 60 44 78 46 C76 32 84 20 100 20Z"/>
      <path d="M72 78 C86 90 114 90 128 78 M80 104 C92 110 108 110 120 104" stroke="${color}" stroke-opacity=".35" stroke-width="1.4" fill="none"/>
      <path d="M86 35 L96 38 L86 40Z M114 35 L104 38 L114 40Z" fill="#fff"/><circle cx="92" cy="38" r="5" fill="${color}" opacity=".55"/><circle cx="108" cy="38" r="5" fill="${color}" opacity=".55"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 200 200">${defs}<text x="100" y="138" text-anchor="middle" font-size="120" font-family="Impact, 'Arial Black', sans-serif" fill="url(#${g})" stroke="${color}" stroke-width="2">?</text></svg>`;
}

const SPEAKER_ON = `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;
const SPEAKER_OFF = `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

export class UI {
  constructor(root, game) {
    this.root = root; this.game = game;
    this.mode = 'cpu';
    this._guard = 0; this._screenTick = null; this._overlays = [];
    this._keysPrev = new Set(); this._keyEdges = new Set(); this._anyKey = false;
    this._uid = 0;
    root.classList.add('kc-root');
    root.innerHTML = `
      <div class="kc-layer kc-screen"></div>
      <div class="kc-layer kc-hud-layer"></div>
      <div class="kc-layer kc-vignette"></div>
      <div class="kc-layer kc-ann"></div>
      <div class="kc-layer kc-flash"></div>
      <div class="kc-layer kc-pause"></div>
      <div class="kc-layer kc-overlay"></div>
      <button class="kc-mute" title="Mute (M)">${SPEAKER_ON}</button>`;
    const q = (s) => root.querySelector(s);
    this.el = { screen: q('.kc-screen'), hud: q('.kc-hud-layer'), vig: q('.kc-vignette'), ann: q('.kc-ann'), flash: q('.kc-flash'), pause: q('.kc-pause'), overlay: q('.kc-overlay'), mute: q('.kc-mute') };

    // audio unlock on first gesture + any-key detection + mute + pause key capture
    const unlock = () => this.game.audio.unlock?.();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', (e) => {
      unlock();
      if (e.repeat) return;
      if (e.code === 'KeyM') { this._toggleMute(); return; }
      this._anyKey = true;
      // Enter is also P1 'start' (Game toggles pause on it). While paused, route Enter to the pause menu instead.
      if (this._pauseOpen && e.code === 'Enter') { e.stopPropagation(); e.preventDefault(); this._pauseKeyConfirm = true; }
      if (this._pauseOpen && e.code === 'Escape' && this._overlays.length > 1) { e.stopPropagation(); e.preventDefault(); this._pauseKeyBack = true; }
    }, true);
    this.el.mute.addEventListener('click', (e) => { e.stopPropagation(); this._toggleMute(); });
  }

  _toggleMute() {
    const m = this.game.audio.toggleMute ? this.game.audio.toggleMute() : false;
    this.el.mute.innerHTML = m ? SPEAKER_OFF : SPEAKER_ON;
    this.el.mute.classList.toggle('muted', m);
    this._toast(m ? 'AUDIO MUTED' : 'AUDIO ON');
  }
  _toast(text) {
    const t = document.createElement('div'); t.className = 'kc-toast'; t.textContent = text;
    this.root.appendChild(t); setTimeout(() => t.remove(), 1400);
  }
  _sfx(n, o) { this.game.audio.play?.(n, o); }

  _setScreen(html, cls = '') {
    this.el.screen.className = 'kc-layer kc-screen ' + cls;
    this.el.screen.innerHTML = html;
    this._screenTick = null; this._guard = 0.2;
    return this.el.screen;
  }

  // Generic vertical/horizontal menu. items: element list. Returns tick fn.
  _menu(items, { index = 0, onSelect, onBack, onMove } = {}) {
    const m = { index, items };
    const setIdx = (i, sound = true) => {
      i = (i + items.length) % items.length;
      if (i !== m.index && sound) this._sfx('ui_move');
      m.index = i; items.forEach((it, k) => it.classList.toggle('sel', k === i)); onMove?.(i);
    };
    const choose = (i) => { this._sfx('ui_confirm'); items[i].classList.add('pressed'); onSelect?.(i); };
    items.forEach((it, k) => {
      it.addEventListener('mouseenter', () => setIdx(k));
      it.addEventListener('click', (e) => { e.stopPropagation(); setIdx(k, false); choose(k); });
    });
    setIdx(index, false);
    m.tick = (mp) => {
      if (mp('up') || mp('left')) setIdx(m.index - 1);
      else if (mp('down') || mp('right')) setIdx(m.index + 1);
      else if (mp('confirm')) choose(m.index);
      else if (mp('back') && onBack) { this._sfx('ui_back'); onBack(); }
    };
    m.setIdx = setIdx; m.choose = choose;
    return m;
  }

  // ================================================================= TITLE
  showTitle(onStart) {
    this.hideHUD(); this._closeAllOverlays();
    const s = this._setScreen(`
      <div class="kc-title">
        <div class="kc-title-shade"></div>
        <div class="kc-scan"></div>
        <div class="kc-logo">
          <div class="kc-logo-slash"></div>
          <div class="kc-logo-word w1" data-t="KAIJU">KAIJU</div>
          <div class="kc-logo-word w2" data-t="CLASH">CLASH</div>
          <div class="kc-sub"><span></span>TITANS OF THE CITY<span></span></div>
        </div>
        <div class="kc-press">PRESS START <small>ENTER</small></div>
        <div class="kc-tmenu">
          <div class="kc-mi" data-a="cpu"><b>VS CPU</b><em>Battle the machine</em></div>
          <div class="kc-mi" data-a="versus"><b>VS PLAYER</b><em>Local 2-player showdown</em></div>
          <div class="kc-mi" data-a="controls"><b>CONTROLS</b><em>Keyboard &amp; gamepad</em></div>
        </div>
        <div class="kc-foot"><span>↑↓ SELECT</span><span>ENTER / J CONFIRM</span><span>ESC BACK</span><span>M MUTE</span></div>
      </div>`, 'on');
    const title = s.querySelector('.kc-title');
    let stage = 'press';
    const items = [...s.querySelectorAll('.kc-mi')];
    const menu = this._menu(items, {
      index: this.mode === 'versus' ? 1 : 0,
      onSelect: (i) => {
        const a = items[i].dataset.a;
        if (a === 'controls') { this._showControls(); items[i].classList.remove('pressed'); return; }
        this.mode = a; title.classList.add('leaving');
        this._screenTick = null;
        setTimeout(() => onStart(), 260);
      },
      onBack: () => { stage = 'press'; title.classList.remove('menu'); this._guard = 0.2; },
    });
    const toMenu = () => {
      if (stage !== 'press') return;
      stage = 'menu'; title.classList.add('menu'); this._sfx('ui_confirm'); this._guard = 0.15;
    };
    title.addEventListener('click', () => toMenu());
    this._anyKey = false;
    this._screenTick = (mp) => {
      if (stage === 'press') { if (this._anyKey || mp('confirm')) toMenu(); this._anyKey = false; return; }
      menu.tick(mp);
    };
  }

  // ================================================================= CONTROLS PANEL
  _controlsHTML() {
    return `<table class="kc-ctab"><thead><tr><th></th><th>P1 KEYBOARD</th><th>P2 KEYBOARD</th><th>GAMEPAD</th></tr></thead><tbody>
      ${CONTROLS.map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((k) => `<td>${k.split(' / ').map((x) => `<kbd>${x}</kbd>`).join('<i>/</i>')}</td>`).join('')}</tr>`).join('')}
      </tbody></table><div class="kc-cnote">SUPER needs a full 4-bar energy meter &middot; hold BACK (away from opponent) to block &middot; M toggles audio</div>`;
  }
  _showControls() {
    const o = this.el.overlay;
    o.className = 'kc-layer kc-overlay on';
    o.innerHTML = `<div class="kc-panel"><div class="kc-ph">CONTROLS</div>${this._controlsHTML()}<div class="kc-mi sel kc-back"><b>BACK</b></div></div>`;
    const close = () => { this._sfx('ui_back'); o.className = 'kc-layer kc-overlay'; o.innerHTML = ''; this._overlays.pop(); this._guard = 0.15; };
    o.querySelector('.kc-back').onclick = (e) => { e.stopPropagation(); close(); };
    this._overlays.push((mp) => { if (mp('back') || mp('confirm')) close(); });
    this._guard = 0.15;
  }
  _closeAllOverlays() {
    this._overlays = []; this._pauseOpen = false;
    this.el.overlay.className = 'kc-layer kc-overlay'; this.el.overlay.innerHTML = '';
    this.el.pause.className = 'kc-layer kc-pause'; this.el.pause.innerHTML = '';
  }

  // ================================================================= SELECT
  showSelect(onConfirm, onBack) {
    this.hideHUD(); this._closeAllOverlays();
    const mode = this.mode;
    const last = this.game.lastSelection;
    const st = {
      cur: [last ? TILES.indexOf(last.p1) : 0, last ? TILES.indexOf(last.p2) : 2].map((v, i) => (v < 0 ? i * 2 : v)),
      locked: [null, null], stage: 'p1', diff: Math.max(0, DIFFS.indexOf(last?.difficulty || 'normal')), done: false,
    };
    const tag2 = mode === 'cpu' ? 'CPU' : '2P';
    const side = (i) => `
      <div class="kc-side s${i + 1}">
        <div class="kc-side-bg"></div>
        <div class="kc-ptag">${i === 0 ? '1P' : tag2}</div>
        <div class="kc-fname"></div>
        <div class="kc-ftitle"></div>
        <div class="kc-blurb"></div>
        <div class="kc-stats"></div>
        <div class="kc-moves"></div>
        <div class="kc-ready">READY</div>
      </div>`;
    const s = this._setScreen(`
      <div class="kc-select">
        <div class="kc-sel-shade"></div>
        <div class="kc-sel-top"><div class="kc-sel-title">SELECT YOUR TITAN</div><div class="kc-sel-mode">${mode === 'cpu' ? 'VS CPU' : 'VS PLAYER'}</div></div>
        ${side(0)}${side(1)}
        <div class="kc-sel-vs">VS</div>
        <div class="kc-roster">${TILES.map((id, k) => {
          const d = id === 'random' ? { name: 'RANDOM', color: '#c9d3df' } : def(id);
          return `<div class="kc-tile" data-k="${k}" style="--c:${d.color}"><div class="kc-tile-art">${silhouette(id, d.color, 't' + k + ++this._uid)}</div><div class="kc-tile-name">${d.name}</div><div class="kc-cur c1">1P</div><div class="kc-cur c2">${tag2}</div></div>`;
        }).join('')}</div>
        <div class="kc-diff"><div class="kc-diff-l">CPU DIFFICULTY</div><div class="kc-diff-row">${DIFFS.map((d) => `<div class="kc-dopt" data-d="${d}">${d.toUpperCase()}</div>`).join('')}</div></div>
        <div class="kc-sel-hint"></div>
      </div>`, 'on');
    const tiles = [...s.querySelectorAll('.kc-tile')];
    const sides = [s.querySelector('.s1'), s.querySelector('.s2')];
    const hint = s.querySelector('.kc-sel-hint');
    const diffEl = s.querySelector('.kc-diff');
    const dopts = [...s.querySelectorAll('.kc-dopt')];
    const shown = [null, null];
    const resolved = [ROSTER[0].id, ROSTER[1]?.id || ROSTER[0].id];

    const fillSide = (i, id, random) => {
      const el = sides[i];
      if (el.dataset.id === (random ? 'random' : id)) return;
      el.dataset.id = random ? 'random' : id;
      const d = random ? { name: '? ? ?', title: 'Fate decides', blurb: 'Let the city choose your champion.', color: '#c9d3df', stats: { power: 0, speed: 0, defense: 0, range: 0 } } : def(id);
      el.style.setProperty('--c', d.color);
      el.querySelector('.kc-fname').textContent = d.name;
      el.querySelector('.kc-ftitle').textContent = d.title;
      el.querySelector('.kc-blurb').textContent = d.blurb;
      el.querySelector('.kc-stats').innerHTML = ['power', 'speed', 'defense', 'range'].map((k) => `<div class="kc-stat"><span>${k.toUpperCase()}</span><div class="kc-sbar">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= (d.stats[k] || 0) ? 'on' : ''}" style="animation-delay:${n * 40}ms"></i>`).join('')}</div></div>`).join('');
      const keys = i === 0 || mode === 'cpu' ? KEYCAP.p1 : KEYCAP.p2;
      el.querySelector('.kc-moves').innerHTML = random ? '' : `<div class="kc-mh">SPECIAL MOVES</div>` + MOVES[id].slice(3).map(([n, a]) => `<div class="kc-mv ${a === 'super' ? 'sup' : ''}"><span>${n}</span><kbd>${keys[a]}</kbd>${a === 'super' ? '<em>SUPER</em>' : ''}</div>`).join('');
      el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
    };
    const render = () => {
      tiles.forEach((t, k) => { t.classList.toggle('h1', st.cur[0] === k); t.classList.toggle('h2', st.cur[1] === k && (mode === 'versus' || st.stage !== 'p1')); t.classList.toggle('lk1', st.locked[0] && st.cur[0] === k); t.classList.toggle('lk2', st.locked[1] && st.cur[1] === k); });
      for (let i = 0; i < 2; i++) {
        const tid = TILES[st.cur[i]], rnd = tid === 'random';
        const id = st.locked[i] || (rnd ? shown[i] || resolved[i] : tid);
        fillSide(i, st.locked[i] || id, !st.locked[i] && rnd);
        sides[i].classList.toggle('locked', !!st.locked[i]);
        if (!rnd || st.locked[i]) shown[i] = id;
      }
      sides[1].classList.toggle('dim', mode === 'cpu' && st.stage === 'p1');
      diffEl.classList.toggle('on', st.stage === 'diff');
      dopts.forEach((d, k) => d.classList.toggle('sel', k === st.diff));
      const p1 = shown[0] || resolved[0], p2 = shown[1] || resolved[1];
      this.game.previewSelection?.(p1, p2);
      hint.innerHTML = mode === 'cpu'
        ? { p1: '<b>CHOOSE YOUR TITAN</b> &nbsp; ←/→ SELECT &nbsp; ENTER / J CONFIRM &nbsp; ESC BACK', p2: '<b>CHOOSE CPU OPPONENT</b> &nbsp; ←/→ SELECT &nbsp; ENTER CONFIRM &nbsp; ESC BACK', diff: '<b>SET DIFFICULTY</b> &nbsp; ←/→ &nbsp; ENTER TO FIGHT', go: '' }[st.stage]
        : '<b>1P</b> A/D + J / ENTER &nbsp;&nbsp;·&nbsp;&nbsp; <b>2P</b> ←/→ + NUM1 / R-SHIFT &nbsp;&nbsp;·&nbsp;&nbsp; K / NUM2 CANCEL';
    };
    const lock = (i) => {
      const tid = TILES[st.cur[i]];
      const id = tid === 'random' ? ROSTER[Math.floor(Math.random() * ROSTER.length)].id : tid;
      st.locked[i] = id; shown[i] = id;
      this._sfx('ui_confirm'); this._sfx(id === 'ape' ? 'chestbeat' : 'heavy', { volume: 0.5 });
      sides[i].classList.remove('lockfx'); void sides[i].offsetWidth; sides[i].classList.add('lockfx');
    };
    const go = () => {
      st.stage = 'go'; st.done = true; render();
      this._screenTick = null;
      this._vsSplash(st.locked[0], st.locked[1], mode, () => onConfirm({ p1: st.locked[0], p2: st.locked[1], mode, difficulty: DIFFS[st.diff] }));
    };
    const move = (i, d) => { st.cur[i] = (st.cur[i] + d + TILES.length) % TILES.length; this._sfx('ui_move'); render(); };

    // mouse
    tiles.forEach((t, k) => {
      t.addEventListener('mouseenter', () => {
        const i = mode === 'cpu' ? (st.stage === 'p1' ? 0 : st.stage === 'p2' ? 1 : -1) : (!st.locked[0] ? 0 : !st.locked[1] ? 1 : -1);
        if (i >= 0 && st.cur[i] !== k) { st.cur[i] = k; this._sfx('ui_move'); render(); }
      });
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        if (mode === 'cpu') {
          if (st.stage === 'p1') { st.cur[0] = k; lock(0); st.stage = 'p2'; render(); } else if (st.stage === 'p2') { st.cur[1] = k; lock(1); st.stage = 'diff'; render(); }
        } else {
          const i = !st.locked[0] ? 0 : !st.locked[1] ? 1 : -1; if (i < 0) return;
          st.cur[i] = k; lock(i); render(); if (st.locked[0] && st.locked[1]) setTimeout(go, 350);
        }
      });
    });
    dopts.forEach((d, k) => d.addEventListener('click', (e) => { e.stopPropagation(); if (st.stage !== 'diff') return; st.diff = k; render(); this._sfx('ui_confirm'); go(); }));

    const inp = this.game.input;
    this._screenTick = (mp) => {
      if (st.done) return;
      if (mode === 'cpu') {
        if (st.stage === 'p1' || st.stage === 'p2') {
          const i = st.stage === 'p1' ? 0 : 1;
          if (mp('left')) move(i, -1); else if (mp('right')) move(i, 1);
          else if (mp('confirm')) { lock(i); st.stage = i === 0 ? 'p2' : 'diff'; render(); }
          else if (mp('back')) {
            this._sfx('ui_back');
            if (i === 0) { st.done = true; onBack(); return; }
            st.locked[0] = null; st.stage = 'p1'; render();
          }
        } else if (st.stage === 'diff') {
          if (mp('left')) { st.diff = Math.max(0, st.diff - 1); this._sfx('ui_move'); render(); } else if (mp('right')) { st.diff = Math.min(2, st.diff + 1); this._sfx('ui_move'); render(); }
          else if (mp('confirm')) { this._sfx('ui_confirm'); go(); } else if (mp('back')) { this._sfx('ui_back'); st.locked[1] = null; st.stage = 'p2'; render(); }
        }
      } else {
        const c = [inp.controller(0), inp.controller(1)], k = this._keyEdges;
        const conf = [c[0].pressed('light') || k.has('Enter') || k.has('Space'), c[1].pressed('light') || k.has('NumpadEnter') || k.has('ShiftRight')];
        const back = [c[0].pressed('kick') || k.has('Escape') || k.has('Backspace'), c[1].pressed('kick')];
        for (let i = 0; i < 2; i++) {
          if (!st.locked[i]) {
            if (c[i].pressed('left')) move(i, -1); else if (c[i].pressed('right')) move(i, 1);
            else if (conf[i]) { lock(i); render(); }
            else if (back[i] && i === 0) { this._sfx('ui_back'); st.done = true; onBack(); return; }
          } else if (back[i]) { st.locked[i] = null; this._sfx('ui_back'); render(); }
        }
        if (st.locked[0] && st.locked[1] && !st.done) { st.done = true; setTimeout(go, 400); }
      }
    };
    render();
  }

  _vsSplash(p1, p2, mode, done) {
    const a = def(p1), b = def(p2);
    const el = document.createElement('div');
    el.className = 'kc-vs';
    el.innerHTML = `
      <div class="kc-vs-half l" style="--c:${a.color}"><div class="kc-vs-art">${silhouette(p1, a.color, 'v1' + ++this._uid)}</div><div class="kc-vs-name"><small>1P</small>${a.name}<em>${a.title}</em></div></div>
      <div class="kc-vs-half r" style="--c:${b.color}"><div class="kc-vs-art">${silhouette(p2, b.color, 'v2' + ++this._uid)}</div><div class="kc-vs-name"><small>${mode === 'cpu' ? 'CPU' : '2P'}</small>${b.name}<em>${b.title}</em></div></div>
      <div class="kc-vs-bolt"></div>
      <div class="kc-vs-word">VS</div>`;
    this.el.screen.appendChild(el);
    this._sfx('whoosh');
    setTimeout(() => { this._sfx('explosion', { volume: 0.7 }); this._sfx('announce_round', { volume: 0.6 }); }, 420);
    setTimeout(() => this._sfx(p1 === 'ape' ? 'roar_ape' : 'roar_saurian', { volume: 0.55, pan: -0.5 }), 700);
    setTimeout(() => { el.classList.add('out'); }, 2100);
    setTimeout(() => done(), 2400);
  }

  // ================================================================= HUD
  showHUD() {
    this._closeAllOverlays();
    this._setScreen('', '');
    const side = (i) => `
      <div class="kc-pl p${i + 1}">
        <div class="kc-hpwrap"><div class="kc-hp"><div class="kc-hp-drain"></div><div class="kc-hp-fill"></div><div class="kc-hp-gloss"></div></div></div>
        <div class="kc-plate"><span class="kc-tagp">${i === 0 ? '1P' : (this.game.lastSelection?.mode === 'versus' ? '2P' : 'CPU')}</span><span class="kc-pname"></span><span class="kc-pips"><i></i><i></i></span></div>
        <div class="kc-en"><div class="kc-segs">${'<div class="kc-seg"><b></b></div>'.repeat(4)}</div><span class="kc-en-l">SUPER READY</span></div>
      </div>`;
    this.el.hud.className = 'kc-layer kc-hud-layer on';
    this.el.hud.innerHTML = `
      <div class="kc-hudtop">${side(0)}<div class="kc-timer"><div class="kc-tnum">99</div><div class="kc-tround">ROUND 1</div></div>${side(1)}</div>
      <div class="kc-combo c1"><div class="kc-cn">0</div><div class="kc-cl">HITS</div></div>
      <div class="kc-combo c2"><div class="kc-cn">0</div><div class="kc-cl">HITS</div></div>`;
    const h = this.el.hud;
    this._hud = {
      p: [0, 1].map((i) => {
        const r = h.querySelector('.p' + (i + 1));
        return { root: r, hp: r.querySelector('.kc-hp'), fill: r.querySelector('.kc-hp-fill'), drain: r.querySelector('.kc-hp-drain'), name: r.querySelector('.kc-pname'),
          pips: [...r.querySelectorAll('.kc-pips i')], segs: [...r.querySelectorAll('.kc-seg')], segb: [...r.querySelectorAll('.kc-seg b')], en: r.querySelector('.kc-en'),
          combo: h.querySelector('.kc-combo.c' + (i + 1)), comboN: h.querySelector('.kc-combo.c' + (i + 1) + ' .kc-cn'),
          v: { hp: -1, en: -1, name: '', color: '', rounds: -1, combo: 0, low: null, hitFlip: false, comboFlip: false, segFull: -1 } };
      }),
      timer: h.querySelector('.kc-timer'), tnum: h.querySelector('.kc-tnum'), tround: h.querySelector('.kc-tround'), vt: null, vr: null, vig: -1,
    };
  }
  hideHUD() { this._hud = null; this.el.hud.className = 'kc-layer kc-hud-layer'; this.el.hud.innerHTML = ''; this.el.vig.style.opacity = 0; }

  updateHUD(s) {
    const H = this._hud; if (!H || !s) return;
    let lowest = 1;
    for (let i = 0; i < 2; i++) {
      const d = i === 0 ? s.p1 : s.p2, P = H.p[i], v = P.v; if (!d) continue;
      if (d.name !== v.name) { v.name = d.name; P.name.textContent = d.name; }
      if (d.color && d.color !== v.color) { v.color = d.color; P.root.style.setProperty('--c', d.color); P.combo.style.setProperty('--c', d.color); }
      const hp = Math.max(0, Math.min(1, d.hp / (d.maxHp || 1)));
      lowest = Math.min(lowest, hp);
      if (hp !== v.hp) {
        const q = Math.round(hp * 1000) / 1000;
        P.fill.style.transform = `scaleX(${q})`;
        if (hp < v.hp) { // damage: drain lags behind, flash
          v.hitFlip = !v.hitFlip; P.hp.classList.toggle('hitA', v.hitFlip); P.hp.classList.toggle('hitB', !v.hitFlip);
          P.drain.style.transition = ''; P.drain.style.transform = `scaleX(${q})`;
        } else { P.drain.style.transition = 'none'; P.drain.style.transform = `scaleX(${q})`; }
        v.hp = hp;
        const low = hp > 0 && hp < 0.25;
        if (low !== v.low) { v.low = low; P.hp.classList.toggle('low', low); }
        P.hp.classList.toggle('mid', hp < 0.5 && !low);
      }
      const en = Math.max(0, Math.min(100, (d.energy / (d.maxEnergy || 100)) * 100));
      if (Math.abs(en - v.en) > 0.2) {
        v.en = en;
        let full = 0;
        for (let k = 0; k < 4; k++) { const f = Math.max(0, Math.min(1, (en - k * 25) / 25)); P.segb[k].style.transform = `scaleX(${f})`; if (f >= 1) full++; }
        if (full !== v.segFull) {
          if (full > v.segFull && v.segFull >= 0) this._sfx('ui_move', { pitch: 0.5 + full * 0.15, volume: 0.6 });
          v.segFull = full; P.segs.forEach((sg, k) => sg.classList.toggle('full', k < full)); P.en.classList.toggle('ready', full === 4);
        }
      }
      if (d.rounds !== v.rounds) { v.rounds = d.rounds; P.pips.forEach((p, k) => p.classList.toggle('on', k < d.rounds)); }
      const combo = d.combo | 0;
      if (combo !== v.combo) {
        if (combo >= 2) {
          P.comboN.textContent = combo; v.comboFlip = !v.comboFlip;
          P.combo.classList.remove('out'); P.combo.classList.toggle('popA', v.comboFlip); P.combo.classList.toggle('popB', !v.comboFlip); P.combo.classList.add('on');
          P.combo.classList.toggle('big', combo >= 5);
        } else if (v.combo >= 2) P.combo.classList.add('out');
        v.combo = combo;
      }
    }
    const t = Number.isFinite(s.timer) ? Math.max(0, Math.ceil(s.timer)) : '∞';
    if (t !== H.vt) { H.vt = t; H.tnum.textContent = t; H.timer.classList.toggle('urgent', typeof t === 'number' && t <= 10); }
    if (s.round !== H.vr) { H.vr = s.round; H.tround.textContent = 'ROUND ' + (s.round ?? 1); }
    const vig = lowest < 0.3 ? Math.round((1 - lowest / 0.3) * 20) / 20 : 0;
    if (vig !== H.vig) { H.vig = vig; this.el.vig.style.opacity = vig * 0.85; }
  }

  // ================================================================= ANNOUNCER
  announce(text, opts = {}) {
    text = String(text ?? '');
    const T = text.toUpperCase();
    const style = opts.style || (/ROUND/.test(T) ? 'round' : /FIGHT/.test(T) ? 'fight' : /K\.?\s?O\b|KNOCK/.test(T) ? 'ko' : /PERFECT/.test(T) ? 'perfect' : /TIME/.test(T) ? 'ko' : /HIT|COMBO/.test(T) ? 'combo' : 'info');
    const dur = opts.duration ?? { round: 1.5, fight: 1.1, ko: 2.4, perfect: 2.2, combo: 1.2, super: 1.7, info: 1.8 }[style] ?? 1.5;
    const layer = this.el.ann;
    if (style !== 'combo' && style !== 'super') layer.querySelectorAll('.kc-a:not(.kc-a-combo):not(.kc-a-super)').forEach((e) => e.remove());
    const el = document.createElement('div');
    el.className = `kc-a kc-a-${style}` + (opts.side === 1 ? ' right' : '');
    if (opts.color) el.style.setProperty('--c', opts.color);
    el.style.setProperty('--d', dur + 's');
    const t = esc(text);
    if (style === 'super') el.innerHTML = `<div class="kc-streak"></div><div class="kc-a-t" data-t="${t}">${t}</div><div class="kc-a-s">SUPER MOVE</div>`;
    else if (style === 'round') el.innerHTML = `<div class="kc-a-bar"></div><div class="kc-a-t" data-t="${t}">${t}</div>`;
    else if (style === 'ko') el.innerHTML = `<div class="kc-a-ring"></div><div class="kc-a-t" data-t="${t}">${t}</div>`;
    else el.innerHTML = `<div class="kc-a-t" data-t="${t}">${t}</div>`;
    layer.appendChild(el);
    if (style === 'ko' || style === 'fight' || style === 'super') {
      const f = this.el.flash; f.className = 'kc-layer kc-flash'; void f.offsetWidth;
      f.className = 'kc-layer kc-flash ' + (style === 'ko' ? 'red' : style === 'super' ? 'col' : 'white');
      if (opts.color) f.style.setProperty('--c', opts.color);
      layer.classList.remove('shake'); void layer.offsetWidth; layer.classList.add('shake');
    }
    setTimeout(() => el.classList.add('out'), dur * 1000);
    setTimeout(() => el.remove(), dur * 1000 + 450);
    // audio
    if (opts.sound === false) return;
    const a = this.game.audio;
    if (style === 'round') {
      a.play?.('announce_round');
      const m = T.match(/ROUND\s*(\d+)/);
      a.say?.(/FINAL/.test(T) ? 'Final round' : m ? 'Round ' + (NUMWORD[+m[1]] || m[1]) : text.toLowerCase());
    } else if (style === 'fight') { a.play?.('announce_fight'); a.say?.('Fight!'); }
    else if (style === 'ko') { a.play?.('announce_ko'); a.say?.(/TIME/.test(T) ? 'Time!' : 'K. O.'); }
    else if (style === 'perfect') { a.play?.('announce_round', { pitch: 1.12 }); a.say?.('Perfect!'); }
    else if (style === 'super') a.play?.('whoosh', { volume: 0.9, pitch: 0.7 });
    else if (style === 'combo') a.play?.('ui_confirm', { volume: 0.5, pitch: 0.8 });
  }

  // ================================================================= PAUSE
  showPause(onResume, onQuit) {
    const p = this.el.pause;
    this._pauseOpen = true;
    p.className = 'kc-layer kc-pause on';
    p.innerHTML = `<div class="kc-pause-dim"></div><div class="kc-pause-box">
      <div class="kc-ph">PAUSED</div>
      <div class="kc-pmenu">
        <div class="kc-mi"><b>RESUME</b></div><div class="kc-mi"><b>MOVE LIST</b></div><div class="kc-mi"><b>CONTROLS</b></div><div class="kc-mi"><b>QUIT TO SELECT</b></div>
      </div><div class="kc-psub"></div></div>`;
    this._sfx('ui_back', { pitch: 0.8 });
    this.game.audio.musicDuck?.(true);
    const sub = p.querySelector('.kc-psub'), box = p.querySelector('.kc-pause-box');
    const items = [...p.querySelectorAll('.kc-mi')];
    const closeSub = () => { box.classList.remove('sub'); sub.innerHTML = ''; this._overlays.length = 1; this._sfx('ui_back'); this._guard = 0.12; };
    const openSub = (html) => {
      box.classList.add('sub'); sub.innerHTML = html + `<div class="kc-mi sel kc-back"><b>BACK</b></div>`;
      sub.querySelector('.kc-back').onclick = (e) => { e.stopPropagation(); closeSub(); };
      this._overlays.push((mp) => { if (mp('back') || mp('confirm') || this._pauseKeyConfirm || this._pauseKeyBack) closeSub(); });
      this._guard = 0.12;
    };
    const menu = this._menu(items, {
      onSelect: (i) => {
        setTimeout(() => items[i].classList.remove('pressed'), 150);
        if (i === 0) onResume();
        else if (i === 1) openSub(this._moveListHTML());
        else if (i === 2) openSub(this._controlsHTML());
        else if (i === 3) onQuit();
      },
      onBack: () => onResume(),
    });
    this._pauseMenu = menu;
    this._overlays = [(mp) => { if (this._pauseKeyConfirm) { menu.choose(menu.index); return; } menu.tick(mp); }];
    this._guard = 0.2;
  }
  hidePause() {
    if (!this._pauseOpen) return;
    this._pauseOpen = false; this._overlays = [];
    this.el.pause.className = 'kc-layer kc-pause'; this.el.pause.innerHTML = '';
    this.game.audio.musicDuck?.(false);
    this._guard = 0.1;
  }
  _moveListHTML() {
    const sel = this.game.lastSelection || { p1: ROSTER[0].id, p2: ROSTER[1]?.id, mode: 'cpu' };
    const col = (id, keys, who) => {
      const d = def(id);
      return `<div class="kc-mlcol" style="--c:${d.color}"><div class="kc-mlh"><small>${who}</small>${d.name}</div>${MOVES[id].map(([n, a]) => `<div class="kc-mv ${a === 'super' ? 'sup' : ''} ${a.startsWith('sp') ? 'spc' : ''}"><span>${n}</span><kbd>${keys[a]}</kbd><kbd class="pad">${KEYCAP.pad[a]}</kbd></div>`).join('')}</div>`;
    };
    return `<div class="kc-ml">${col(sel.p1, KEYCAP.p1, '1P')}${col(sel.p2, sel.mode === 'versus' ? KEYCAP.p2 : KEYCAP.p1, sel.mode === 'versus' ? '2P' : 'CPU')}</div><div class="kc-cnote">SUPER costs a full energy meter (4 bars)</div>`;
  }

  // ================================================================= RESULTS
  showResults(r, onRematch, onMenu) {
    this.hideHUD(); this._closeAllOverlays();
    const ids = [r.p1, r.p2], w = r.winner;
    const wd = w === 0 || w === 1 ? def(ids[w]) : null;
    const rounds = r.rounds || [0, 0];
    const who = (i) => (i === 0 ? 'PLAYER 1' : this.game.lastSelection?.mode === 'versus' ? 'PLAYER 2' : 'CPU');
    const s = this._setScreen(`
      <div class="kc-results" style="--c:${wd ? wd.color : '#c9d3df'}">
        <div class="kc-res-wash"></div>
        <div class="kc-res-art">${wd ? silhouette(ids[w], wd.color, 'r' + ++this._uid) : ''}</div>
        <div class="kc-res-main">
          <div class="kc-res-who">${wd ? who(w) : 'NO CONTEST'}</div>
          <div class="kc-res-name" data-t="${wd ? wd.name : 'DRAW'}">${wd ? wd.name : 'DRAW'}</div>
          ${wd ? '<div class="kc-res-wins" data-t="WINS">WINS</div>' : ''}
          <div class="kc-res-tally">
            <div style="--c:${def(ids[0]).color}"><small>${who(0)}</small>${def(ids[0]).name}</div>
            <b>${rounds[0]}<i>–</i>${rounds[1]}</b>
            <div style="--c:${def(ids[1]).color}"><small>${who(1)}</small>${def(ids[1]).name}</div>
          </div>
          <div class="kc-res-menu"><div class="kc-mi"><b>REMATCH</b></div><div class="kc-mi"><b>CHARACTER SELECT</b></div></div>
        </div>
      </div>`, 'on');
    const items = [...s.querySelectorAll('.kc-res-menu .kc-mi')];
    let done = false;
    const menu = this._menu(items, {
      onSelect: (i) => { if (done) return; done = true; this._screenTick = null; setTimeout(() => (i === 0 ? onRematch() : onMenu()), 180); },
      onBack: () => { if (done) return; done = true; this._screenTick = null; onMenu(); },
    });
    this._screenTick = (mp) => menu.tick(mp);
    this._guard = 1.0; // don't let a mashed attack button skip the results
    if (wd) setTimeout(() => this._sfx(ids[w] === 'ape' ? 'roar_ape' : 'roar_saurian', { volume: 0.6 }), 350);
  }

  // ================================================================= FRAME
  update(dt) {
    // own key-edge tracking (for per-player keys the Input menu API merges)
    const keys = this.game.input.keys;
    this._keyEdges.clear();
    if (keys) { for (const k of keys) if (!this._keysPrev.has(k)) this._keyEdges.add(k); this._keysPrev = new Set(keys); }
    const tick = this._overlays.length ? this._overlays[this._overlays.length - 1] : this._screenTick;
    if (this._guard > 0) { this._guard -= dt; this._anyKey = false; this._pauseKeyConfirm = this._pauseKeyBack = false; return; }
    if (tick) {
      const mp = (a) => this.game.input.menuPressed(a);
      tick(mp);
    }
    this._pauseKeyConfirm = this._pauseKeyBack = false;
  }
}
