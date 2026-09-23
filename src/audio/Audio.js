// OWNER: ui/audio agent. Fully procedural WebAudio SFX + music (no files).
// CONTRACT (must be preserved):
//   new Audio() ; audio.unlock() (call on first user gesture) ; audio.play(name, { volume, pitch, pan }) ;
//   audio.music(trackName | null) — 'title' | 'select' | 'fight' | null ; audio.setMasterVolume(v)
// SFX names: 'punch' 'kick' 'heavy' 'block' 'whoosh' 'step' 'land' 'crumble' 'explosion' 'beam' 'beamStart'
//            'roar_saurian' 'roar_ape' 'chestbeat' 'charge' 'super' 'ko' 'ui_move' 'ui_confirm' 'ui_back'
//            'announce_round' 'announce_fight' 'announce_ko'
// OPTIONAL EXTRAS (added by ui/audio agent, backwards compatible):
//   audio.loop(name, opts) → { stop(fadeSec = 0.3) }   — continuous sounds: 'beam' | 'charge' | 'rumble' (others: one-shot + no-op handle)
//   audio.say(text)            — deep synthesized announcer voice via speechSynthesis (guarded; no-op if unavailable / muted)
//   audio.setMuted(bool) ; audio.toggleMute() → muted ; audio.muted ; audio.masterVolume
//   audio.musicDuck(bool)      — lower music (used while paused)
//   audio.play(...) returns true if the sound was started (false if locked / throttled / unknown)

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // midi → Hz
// D minor helpers (midi numbers)
const D2 = 38, F2 = 41, G2 = 43, A2 = 45, Bb1 = 34, C2 = 36, D3 = 50;

// Max simultaneous voices per sound + minimum retrigger interval (seconds)
const LIMITS = {
  punch: [5, 0.03], kick: [4, 0.03], heavy: [3, 0.05], block: [4, 0.03], whoosh: [4, 0.04], step: [6, 0.05], land: [3, 0.06],
  crumble: [4, 0.08], explosion: [4, 0.06], beam: [2, 0.2], beamStart: [2, 0.2], roar_saurian: [2, 0.3], roar_ape: [2, 0.3],
  chestbeat: [2, 0.2], charge: [2, 0.15], super: [2, 0.15], ko: [1, 0.5], ui_move: [3, 0.02], ui_confirm: [2, 0.05], ui_back: [2, 0.05],
  announce_round: [1, 0.3], announce_fight: [1, 0.3], announce_ko: [1, 0.3],
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.masterVolume = 0.9;
    this.muted = false;
    this._active = {}; this._last = {};
    this._tracks = []; this._wantTrack = null; this._curTrack = null;
    this._voice = null;
  }

  // ---------------------------------------------------------------- setup
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this._build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (this._wantTrack && !this._curTrack) this.music(this._wantTrack);
  }

  _build() {
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : this.masterVolume;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 8; this.comp.ratio.value = 5; this.comp.attack.value = 0.004; this.comp.release.value = 0.22;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -2; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.1;
    this.master.connect(this.comp).connect(this.limiter).connect(c.destination);

    this.reverb = c.createConvolver(); this.reverb.buffer = this._impulse(3.2, 2.6);
    this.revOut = c.createGain(); this.revOut.gain.value = 0.55;
    this.reverb.connect(this.revOut).connect(this.master);

    this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.sfxSend = c.createGain(); this.sfxSend.gain.value = 0.35; this.sfxBus.connect(this.sfxSend).connect(this.reverb);
    this.musicBus = c.createGain(); this.musicBus.gain.value = 0.42; this.musicBus.connect(this.master);
    this.musicSend = c.createGain(); this.musicSend.gain.value = 0.5; this.musicBus.connect(this.musicSend).connect(this.reverb);

    // shared buffers / curves
    const len = c.sampleRate * 2;
    this.white = c.createBuffer(1, len, c.sampleRate);
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const r = Math.random() * 2 - 1; w[i] = r;
      last = (last + 0.02 * r) / 1.02; b[i] = last * 3.5;
    }
    this.curves = { soft: this._curve(2.5), hard: this._curve(8), crush: this._curve(25) };

    this._sched = setInterval(() => this._schedule(), 25);
  }

  _impulse(seconds, decay) {
    const c = this.ctx, rate = c.sampleRate, len = Math.floor(rate * seconds);
    const buf = c.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections cluster + exponential diffuse tail, progressively darker
        const early = i < rate * 0.08 && Math.random() < 0.012 ? (Math.random() * 2 - 1) * 0.9 : 0;
        const n = Math.random() * 2 - 1;
        const k = 0.25 + 0.7 * (1 - t); lp += (n - lp) * k;
        d[i] = (lp * Math.pow(1 - t, decay) + early) * 0.6;
      }
    }
    return buf;
  }

  _curve(k) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
    return curve;
  }

  setMasterVolume(v) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.05);
  }
  setMuted(m) {
    this.muted = !!m;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.masterVolume, this.ctx.currentTime, 0.05);
    if (this.muted && window.speechSynthesis) try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    return this.muted;
  }
  toggleMute() { return this.setMuted(!this.muted); }
  musicDuck(on) { if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.12 : 0.42, this.ctx.currentTime, 0.15); }

  // ---------------------------------------------------------------- primitives
  // Oscillator with pitch glide + AD envelope. f may be a number or [from, to].
  _tone(out, { type = 'sine', f = 100, t, a = 0.004, d = 0.3, g = 1, glide, curve = 'exp', detune = 0, hold = 0 }) {
    const c = this.ctx, o = c.createOscillator(), e = c.createGain();
    o.type = type; o.detune.value = detune;
    const [f0, f1] = Array.isArray(f) ? f : [f, f];
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 !== f0) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + (glide ?? d));
      else o.frequency.linearRampToValueAtTime(f1, t + (glide ?? d));
    }
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(g, t + a);
    if (hold) e.gain.setValueAtTime(g, t + a + hold);
    e.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
    o.connect(e).connect(out);
    o.start(t); o.stop(t + a + hold + d + 0.05);
    return o;
  }

  // Filtered noise burst. f = filter freq or [from, to].
  _noise(out, { t, a = 0.002, d = 0.2, g = 1, type = 'bandpass', f = 1000, Q = 1, buf = 'white', hold = 0, rate = 1 }) {
    const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), e = c.createGain();
    s.buffer = buf === 'brown' ? this.brown : this.white; s.loop = true; s.playbackRate.value = rate;
    fl.type = type; fl.Q.value = Q;
    const [f0, f1] = Array.isArray(f) ? f : [f, f];
    fl.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + hold + d);
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(g, t + a);
    if (hold) e.gain.setValueAtTime(g, t + a + hold);
    e.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
    s.connect(fl).connect(e).connect(out);
    s.start(t, Math.random() * 1.5); s.stop(t + a + hold + d + 0.05);
    return fl;
  }

  _shaper(out, kind = 'hard', drive = 1) {
    const c = this.ctx, pre = c.createGain(), ws = c.createWaveShaper(), post = c.createGain();
    pre.gain.value = drive; ws.curve = this.curves[kind]; ws.oversample = '2x'; post.gain.value = 1 / Math.max(1, Math.sqrt(drive));
    pre.connect(ws).connect(post).connect(out);
    return pre;
  }

  _filter(out, type, freq, Q = 0.7) {
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q; f.connect(out); return f;
  }

  // Granular debris: many tiny filtered noise grains
  _grains(out, t, dur, count, P = 1, g = 0.5, fLo = 400, fHi = 4000) {
    for (let i = 0; i < count; i++) {
      const u = Math.pow(Math.random(), 1.8); // denser at start
      const tt = t + u * dur;
      this._noise(out, { t: tt, a: 0.001, d: 0.02 + Math.random() * 0.07, g: g * (1 - u * 0.7) * (0.4 + Math.random() * 0.6),
        type: 'bandpass', f: (fLo + Math.random() * (fHi - fLo)) * P, Q: 2 + Math.random() * 6 });
    }
  }

  // ---------------------------------------------------------------- SFX
  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state === 'closed') return false;
    const gen = this['_sfx_' + name];
    if (!gen) return false;
    const now = this.ctx.currentTime;
    const [maxV, minGap] = LIMITS[name] || [4, 0.03];
    if ((this._active[name] || 0) >= maxV) return false;
    if (this._last[name] !== undefined && now - this._last[name] < minGap) return false;
    this._last[name] = now;
    const c = this.ctx;
    const out = c.createGain(); out.gain.value = Math.max(0, opts.volume ?? 1);
    let head = out;
    if (opts.pan && c.createStereoPanner) {
      const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, opts.pan)); out.connect(p); p.connect(this.sfxBus);
    } else out.connect(this.sfxBus);
    const P = Math.max(0.25, Math.min(4, opts.pitch ?? 1));
    let dur = 1;
    try { dur = gen.call(this, head, now + 0.005, P, opts) || 1; } catch (e) { console.warn('[audio]', name, e); return false; }
    this._active[name] = (this._active[name] || 0) + 1;
    setTimeout(() => { this._active[name]--; try { out.disconnect(); } catch (e) { /* ignore */ } }, (dur + 0.4) * 1000);
    return true;
  }

  _sfx_punch(o, t, P) {
    const crush = this._shaper(o, 'hard', 3);
    this._tone(crush, { type: 'sine', f: [180 * P, 48 * P], t, d: 0.22, g: 0.9, glide: 0.12 });
    this._tone(crush, { type: 'triangle', f: [420 * P, 90 * P], t, d: 0.07, g: 0.5, glide: 0.05 });
    this._noise(crush, { t, d: 0.09, g: 0.8, type: 'bandpass', f: [2600 * P, 700 * P], Q: 0.8 });
    this._noise(o, { t, d: 0.03, g: 0.5, type: 'highpass', f: 5000 * P }); // snap
    this._grains(o, t + 0.01, 0.12, 6, P, 0.35, 1200, 5000); // bone crunch
    this._tone(o, { type: 'sine', f: [70 * P, 32 * P], t, d: 0.35, g: 0.7 }); // sub
    return 0.5;
  }
  _sfx_kick(o, t, P) {
    const crush = this._shaper(o, 'hard', 3.5);
    this._noise(o, { t: t - 0.002, a: 0.05, d: 0.05, g: 0.25, type: 'bandpass', f: [500 * P, 1800 * P], Q: 1.2 });
    this._tone(crush, { type: 'sine', f: [150 * P, 38 * P], t: t + 0.04, d: 0.3, g: 1, glide: 0.15 });
    this._noise(crush, { t: t + 0.04, d: 0.14, g: 0.9, type: 'lowpass', f: [3200 * P, 400 * P], Q: 1 });
    this._grains(o, t + 0.05, 0.18, 9, P, 0.35, 800, 4000);
    this._tone(o, { type: 'sine', f: [60 * P, 28 * P], t: t + 0.04, d: 0.5, g: 0.8 });
    return 0.7;
  }
  _sfx_heavy(o, t, P) {
    const crush = this._shaper(o, 'crush', 4);
    this._tone(crush, { type: 'sine', f: [130 * P, 30 * P], t, d: 0.55, g: 1, glide: 0.3 });
    this._tone(crush, { type: 'square', f: [240 * P, 60 * P], t, d: 0.12, g: 0.35 });
    this._noise(crush, { t, d: 0.35, g: 1, type: 'lowpass', f: [5000 * P, 250 * P], Q: 1.5 });
    this._noise(o, { t, d: 0.04, g: 0.6, type: 'highpass', f: 4000 * P });
    this._grains(o, t + 0.02, 0.45, 22, P, 0.45, 600, 5000);
    this._tone(o, { type: 'sine', f: [55 * P, 22 * P], t, a: 0.01, d: 1.0, g: 1 });
    this._noise(o, { t: t + 0.05, a: 0.05, d: 0.9, g: 0.35, type: 'lowpass', f: 180 * P, buf: 'brown' });
    return 1.2;
  }
  _sfx_block(o, t, P) {
    this._noise(o, { t, d: 0.12, g: 0.6, type: 'bandpass', f: 2400 * P, Q: 5 });
    this._tone(o, { type: 'square', f: [620 * P, 540 * P], t, d: 0.09, g: 0.12 });
    this._tone(o, { type: 'triangle', f: [1480 * P, 1400 * P], t, d: 0.25, g: 0.12 }); // metallic ring
    this._tone(o, { type: 'triangle', f: [2210 * P, 2150 * P], t, d: 0.2, g: 0.07 });
    this._tone(o, { type: 'sine', f: [110 * P, 60 * P], t, d: 0.18, g: 0.6 });
    return 0.4;
  }
  _sfx_whoosh(o, t, P) {
    this._noise(o, { t, a: 0.12, d: 0.26, g: 0.55, type: 'bandpass', f: [350 * P, 2200 * P], Q: 1.6 });
    this._noise(o, { t: t + 0.04, a: 0.1, d: 0.22, g: 0.35, type: 'bandpass', f: [900 * P, 300 * P], Q: 2 });
    this._tone(o, { type: 'sine', f: [90 * P, 50 * P], t, a: 0.1, d: 0.2, g: 0.25 });
    return 0.45;
  }
  _sfx_step(o, t, P) {
    this._tone(o, { type: 'sine', f: [62 * P, 26 * P], t, a: 0.008, d: 0.55, g: 1 });
    this._tone(this._shaper(o, 'soft', 2), { type: 'sine', f: [120 * P, 45 * P], t, d: 0.18, g: 0.6 });
    this._noise(o, { t, d: 0.4, g: 0.7, type: 'lowpass', f: [600 * P, 90 * P], buf: 'brown' });
    this._grains(o, t + 0.05, 0.35, 5, P, 0.12, 300, 1500);
    return 0.8;
  }
  _sfx_land(o, t, P) {
    const crush = this._shaper(o, 'hard', 3);
    this._tone(crush, { type: 'sine', f: [90 * P, 24 * P], t, a: 0.005, d: 0.8, g: 1 });
    this._noise(crush, { t, d: 0.5, g: 0.9, type: 'lowpass', f: [2400 * P, 120 * P], buf: 'brown' });
    this._tone(o, { type: 'sine', f: [45 * P, 20 * P], t, a: 0.01, d: 1.2, g: 0.9 });
    this._grains(o, t + 0.04, 0.9, 26, P, 0.3, 300, 3000);
    return 1.4;
  }
  _sfx_crumble(o, t, P) {
    this._grains(o, t, 1.4, 55, P, 0.45, 250, 3500);
    this._grains(o, t + 0.2, 1.2, 25, P * 0.5, 0.4, 200, 1200);
    this._noise(o, { t, a: 0.08, d: 1.4, g: 0.55, type: 'lowpass', f: [900 * P, 120 * P], buf: 'brown' });
    this._tone(o, { type: 'sine', f: [48 * P, 30 * P], t, a: 0.1, d: 1.2, g: 0.45 });
    return 1.8;
  }
  _sfx_explosion(o, t, P) {
    const crush = this._shaper(o, 'crush', 5);
    this._noise(crush, { t, a: 0.004, d: 1.6, g: 1, type: 'lowpass', f: [6000 * P, 140 * P], Q: 0.8 });
    this._tone(crush, { type: 'sine', f: [110 * P, 28 * P], t, d: 0.8, g: 1, glide: 0.4 });
    this._tone(o, { type: 'sine', f: [52 * P, 18 * P], t, a: 0.01, d: 2.2, g: 1 });
    this._noise(o, { t: t + 0.1, a: 0.2, d: 2.2, g: 0.6, type: 'lowpass', f: 160 * P, buf: 'brown' });
    this._grains(o, t + 0.05, 1.8, 40, P, 0.35, 800, 6000); // crackle
    return 2.6;
  }
  _sfx_beamStart(o, t, P) {
    // spines charging: rising electrical whine + crackles, ends in ignition burst
    const d = 0.65;
    this._tone(o, { type: 'sawtooth', f: [90 * P, 520 * P], t, a: d * 0.8, d: 0.25, g: 0.18, glide: d });
    this._tone(o, { type: 'sine', f: [180 * P, 1400 * P], t, a: d * 0.8, d: 0.2, g: 0.18, glide: d });
    this._noise(o, { t, a: d, d: 0.2, g: 0.35, type: 'bandpass', f: [400 * P, 5000 * P], Q: 3 });
    this._grains(o, t, d, 18, P, 0.25, 3000, 9000);
    // ignition
    const crush = this._shaper(o, 'crush', 5);
    this._noise(crush, { t: t + d, d: 0.5, g: 0.9, type: 'lowpass', f: [7000 * P, 600 * P] });
    this._tone(crush, { type: 'sine', f: [160 * P, 40 * P], t: t + d, d: 0.5, g: 0.9 });
    return 1.3;
  }
  _beamVoice(o, t, P, dur) {
    // dense, crackling, roaring beam: detuned saws + ring-ish modulation + hiss + sub
    const c = this.ctx, nodes = [];
    const body = c.createGain(); body.gain.value = 0; body.connect(o);
    const env = body.gain; env.setValueAtTime(0.0001, t); env.exponentialRampToValueAtTime(1, t + 0.08);
    if (dur) { env.setValueAtTime(1, t + dur - 0.3); env.exponentialRampToValueAtTime(0.0001, t + dur); }
    const drive = this._shaper(body, 'hard', 2.5);
    const lp = this._filter(drive, 'lowpass', 1400 * P, 3);
    const lfo = c.createOscillator(), lfoG = c.createGain(); lfo.frequency.value = 7.3; lfoG.gain.value = 500 * P; lfo.connect(lfoG).connect(lp.frequency); nodes.push(lfo);
    [55, 55.7, 82.4, 110.9, 164.2].forEach((f, i) => {
      const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.value = f * P; s.detune.value = (i - 2) * 9;
      const sg = c.createGain(); sg.gain.value = 0.16; s.connect(sg).connect(lp); nodes.push(s);
    });
    // hiss / plasma
    const n = c.createBufferSource(); n.buffer = this.white; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600 * P; bp.Q.value = 0.9;
    const trem = c.createGain(); trem.gain.value = 0.3;
    const tl = c.createOscillator(), tlg = c.createGain(); tl.frequency.value = 23; tlg.gain.value = 0.2; tl.connect(tlg).connect(trem.gain); nodes.push(tl);
    n.connect(bp).connect(trem).connect(body); nodes.push(n);
    // sub
    const sub = c.createOscillator(); sub.frequency.value = 38 * P; const subG = c.createGain(); subG.gain.value = 0.6; sub.connect(subG).connect(body); nodes.push(sub);
    nodes.forEach((x) => { x.start(t); if (dur) x.stop(t + dur + 0.05); });
    return { body, nodes };
  }
  _sfx_beam(o, t, P) {
    const dur = 1.5;
    this._noise(this._shaper(o, 'crush', 4), { t, d: 0.3, g: 0.6, type: 'lowpass', f: [5000 * P, 500 * P] });
    this._beamVoice(o, t, P, dur);
    return dur;
  }
  _roarCore(o, t, P, { dur, base, contour, formants, noiseF, metal, vib, drive, gain = 1 }) {
    const c = this.ctx;
    const env = c.createGain(); env.connect(o);
    env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(gain, t + dur * 0.12);
    env.gain.setValueAtTime(gain, t + dur * 0.6); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // formant bank
    const bank = c.createGain(); bank.gain.value = 1;
    formants.forEach(([f, q, g]) => { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * P; bp.Q.value = q; const fg = c.createGain(); fg.gain.value = g; bank.connect(bp).connect(fg).connect(env); });
    const shaper = this._shaper(bank, 'hard', drive);
    // ring modulator for metallic grit
    const ring = c.createGain(); ring.gain.value = metal ? 0.6 : 1;
    ring.connect(shaper);
    const nodes = [];
    if (metal) { const rm = c.createOscillator(); rm.type = 'sine'; rm.frequency.value = metal * P; const rmg = c.createGain(); rmg.gain.value = 0.5; rm.connect(rmg).connect(ring.gain); nodes.push(rm); }
    const vibO = c.createOscillator(); vibO.frequency.value = vib[0]; const vibG = c.createGain(); vibG.gain.value = vib[1]; vibO.connect(vibG); nodes.push(vibO);
    [0, 7, -9, 1203].forEach((det, i) => {
      const s = c.createOscillator(); s.type = 'sawtooth'; s.detune.value = det + (Math.random() - 0.5) * 6;
      vibG.connect(s.detune);
      contour.forEach(([u, f], k) => { if (k === 0) s.frequency.setValueAtTime(f * base * P, t); else s.frequency.exponentialRampToValueAtTime(f * base * P, t + u * dur); });
      const g = c.createGain(); g.gain.value = i === 3 ? 0.15 : 0.35; s.connect(g).connect(ring); nodes.push(s);
    });
    // breath noise through the same formants
    const n = c.createBufferSource(); n.buffer = this.white; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = noiseF * P; nf.Q.value = 0.8;
    const ng = c.createGain(); ng.gain.value = 0.5; n.connect(nf).connect(ng).connect(bank); nodes.push(n);
    nodes.forEach((x) => { x.start(t); x.stop(t + dur + 0.05); });
    return env;
  }
  _sfx_roar_saurian(o, t, P) {
    // Iconic screech: rising metallic scream that sustains then groans down, layered with a deep throat bellow.
    const dur = 2.6;
    this._roarCore(o, t, P, { dur, base: 1, contour: [[0, 190], [0.18, 420], [0.45, 470], [0.7, 380], [1, 150]],
      formants: [[820, 6, 1], [1350, 7, 0.9], [2700, 9, 0.6], [3900, 10, 0.3]], noiseF: 2400, metal: 93, vib: [6.5, 35], drive: 5, gain: 0.9 });
    this._roarCore(o, t + 0.05, P, { dur: dur * 0.95, base: 1, contour: [[0, 62], [0.2, 90], [0.6, 85], [1, 45]],
      formants: [[300, 3, 1], [650, 4, 0.7]], noiseF: 500, metal: 0, vib: [4, 20], drive: 3, gain: 0.7 });
    this._tone(o, { type: 'sine', f: [45 * P, 30 * P], t, a: 0.3, d: 2.2, g: 0.5 });
    return dur + 0.2;
  }
  _sfx_roar_ape(o, t, P) {
    // Deep guttural bellow with growl amplitude modulation
    const c = this.ctx, dur = 2.0;
    const growl = c.createGain(); growl.gain.value = 0.7; growl.connect(o);
    const am = c.createOscillator(); am.frequency.value = 31; const amg = c.createGain(); amg.gain.value = 0.35; am.connect(amg).connect(growl.gain);
    am.start(t); am.stop(t + dur + 0.05);
    this._roarCore(growl, t, P, { dur, base: 1, contour: [[0, 70], [0.15, 118], [0.5, 110], [0.8, 92], [1, 55]],
      formants: [[380, 4, 1], [720, 5, 0.8], [1150, 6, 0.4]], noiseF: 700, metal: 0, vib: [5, 30], drive: 6, gain: 1 });
    this._roarCore(o, t + 0.08, P, { dur: dur * 0.85, base: 1, contour: [[0, 140], [0.2, 230], [0.6, 210], [1, 110]],
      formants: [[900, 6, 0.6], [1700, 8, 0.3]], noiseF: 1400, metal: 0, vib: [7, 40], drive: 4, gain: 0.35 });
    this._tone(o, { type: 'sine', f: [40 * P, 30 * P], t, a: 0.2, d: 1.8, g: 0.5 });
    return dur + 0.2;
  }
  _sfx_chestbeat(o, t, P) {
    const c = this.ctx; const n = 6;
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.14 + (i % 2 ? 0.01 : 0);
      const pan = c.createStereoPanner ? c.createStereoPanner() : null; let dst = o;
      if (pan) { pan.pan.value = i % 2 ? 0.35 : -0.35; pan.connect(o); dst = pan; }
      const acc = i === n - 1 ? 1.3 : 1;
      this._tone(dst, { type: 'sine', f: [105 * P, 58 * P], t: tt, d: 0.22, g: 0.9 * acc, glide: 0.08 });
      this._noise(dst, { t: tt, d: 0.12, g: 0.55 * acc, type: 'bandpass', f: 320 * P, Q: 2.5 });
      this._noise(dst, { t: tt, d: 0.03, g: 0.25, type: 'highpass', f: 2500 * P });
    }
    return n * 0.14 + 0.4;
  }
  _sfx_charge(o, t, P) {
    const d = 1.1, c = this.ctx;
    const trem = c.createGain(); trem.gain.value = 0.6; trem.connect(o);
    const lfo = c.createOscillator(); lfo.frequency.setValueAtTime(5, t); lfo.frequency.exponentialRampToValueAtTime(28, t + d);
    const lg = c.createGain(); lg.gain.value = 0.4; lfo.connect(lg).connect(trem.gain); lfo.start(t); lfo.stop(t + d + 0.2);
    this._tone(trem, { type: 'sawtooth', f: [110 * P, 880 * P], t, a: d, d: 0.12, g: 0.14, glide: d });
    this._tone(trem, { type: 'sine', f: [220 * P, 1760 * P], t, a: d, d: 0.12, g: 0.25, glide: d });
    this._noise(trem, { t, a: d, d: 0.1, g: 0.25, type: 'bandpass', f: [600 * P, 6000 * P], Q: 4 });
    return d + 0.3;
  }
  _sfx_super(o, t, P) {
    // massive impact + bright shimmer chord + sub drop
    this._sfx_heavy(o, t, P * 0.85);
    const crush = this._shaper(o, 'crush', 6);
    this._noise(crush, { t, d: 1.2, g: 0.7, type: 'lowpass', f: [8000 * P, 200 * P] });
    [D3, D3 + 7, D3 + 12, D3 + 15, D3 + 19].forEach((m, i) => this._tone(o, { type: 'sawtooth', f: NOTE(m + 12) * P, t: t + 0.02, a: 0.01, d: 1.4, g: 0.05, detune: (i - 2) * 7 }));
    this._tone(o, { type: 'sine', f: [70 * P, 20 * P], t, a: 0.01, d: 2.0, g: 1 });
    return 2.2;
  }
  _sfx_ko(o, t, P) {
    const crush = this._shaper(o, 'crush', 6);
    this._noise(crush, { t, d: 2.0, g: 1, type: 'lowpass', f: [7000 * P, 90 * P] });
    this._tone(crush, { type: 'sine', f: [140 * P, 26 * P], t, d: 1.0, g: 1, glide: 0.5 });
    this._tone(o, { type: 'sine', f: [48 * P, 16 * P], t, a: 0.01, d: 3.2, g: 1 });
    this._noise(o, { t: t + 0.1, a: 0.3, d: 3.0, g: 0.5, type: 'lowpass', f: 140 * P, buf: 'brown' });
    this._grains(o, t, 1.5, 30, P, 0.3, 500, 5000);
    return 3.4;
  }
  _sfx_ui_move(o, t, P) {
    this._tone(o, { type: 'sine', f: 1320 * P, t, d: 0.05, g: 0.18 });
    this._tone(o, { type: 'triangle', f: [1980 * P, 2400 * P], t, d: 0.04, g: 0.08 });
    this._noise(o, { t, d: 0.02, g: 0.1, type: 'highpass', f: 6000 });
    return 0.1;
  }
  _sfx_ui_confirm(o, t, P) {
    this._tone(o, { type: 'triangle', f: 880 * P, t, d: 0.12, g: 0.2 });
    this._tone(o, { type: 'triangle', f: 1320 * P, t: t + 0.06, d: 0.25, g: 0.2 });
    this._tone(o, { type: 'sine', f: [160 * P, 50 * P], t, d: 0.25, g: 0.6 });
    this._noise(o, { t, d: 0.25, g: 0.2, type: 'bandpass', f: [1500, 5000], Q: 1 });
    return 0.4;
  }
  _sfx_ui_back(o, t, P) {
    this._tone(o, { type: 'triangle', f: [900 * P, 500 * P], t, d: 0.14, g: 0.2 });
    this._tone(o, { type: 'sine', f: [120 * P, 60 * P], t, d: 0.12, g: 0.35 });
    return 0.25;
  }
  // announcer stingers: taiko hit + brass chord
  _stinger(o, t, P, chord, { rise = false, fall = false, dur = 1.6, hit = 1 } = {}) {
    this._taiko(o, t, hit, P);
    this._tone(o, { type: 'sine', f: [70 * P, 28 * P], t, a: 0.005, d: 1.4, g: 0.8 * hit });
    this._noise(o, { t, d: 1.2, g: 0.3 * hit, type: 'highpass', f: 3000 }); // cymbal wash
    this._brass(o, t + 0.02, chord.map((m) => NOTE(m) * P), dur, 0.16, { rise, fall });
  }
  _sfx_announce_round(o, t, P) { this._stinger(o, t, P, [D2, D2 + 7, D3, D3 + 3, D3 + 7], { dur: 1.3 }); return 1.8; }
  _sfx_announce_fight(o, t, P) {
    this._noise(o, { t: t - 0.002, a: 0.25, d: 0.02, g: 0.25, type: 'bandpass', f: [400, 4000], Q: 1 });
    this._stinger(o, t + 0.2, P, [D2, D2 + 7, D3, D3 + 4, D3 + 7, D3 + 12], { rise: true, dur: 1.6, hit: 1.3 });
    this._taiko(o, t + 0.2 + 0.18, 0.7, P);
    return 2.2;
  }
  _sfx_announce_ko(o, t, P) {
    this._sfx_ko(o, t, P);
    this._brass(o, t + 0.05, [D2, D2 + 6, D3, D3 + 3].map((m) => NOTE(m) * P), 2.2, 0.16, { fall: true });
    return 3.4;
  }

  // ---------------------------------------------------------------- loops
  loop(name, opts = {}) {
    const noop = { stop() {} };
    if (!this.ctx) return noop;
    const c = this.ctx, t = c.currentTime + 0.01, P = opts.pitch ?? 1;
    const out = c.createGain(); out.gain.value = opts.volume ?? 1;
    let tail = out;
    if (opts.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = opts.pan; out.connect(p); tail = p; }
    tail.connect(this.sfxBus);
    let nodes = [];
    if (name === 'beam') {
      nodes = this._beamVoice(out, t, P, 0).nodes;
    } else if (name === 'charge') {
      const trem = c.createGain(); trem.gain.value = 0.6; trem.connect(out);
      const lfo = c.createOscillator(); lfo.frequency.setValueAtTime(4, t); lfo.frequency.linearRampToValueAtTime(26, t + 2.5);
      const lg = c.createGain(); lg.gain.value = 0.4; lfo.connect(lg).connect(trem.gain);
      const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.setValueAtTime(110 * P, t); s.frequency.exponentialRampToValueAtTime(700 * P, t + 2.5);
      const sg = c.createGain(); sg.gain.value = 0.12; s.connect(sg).connect(trem);
      const s2 = c.createOscillator(); s2.frequency.setValueAtTime(220 * P, t); s2.frequency.exponentialRampToValueAtTime(1400 * P, t + 2.5);
      const s2g = c.createGain(); s2g.gain.value = 0.2; s2.connect(s2g).connect(trem);
      nodes = [lfo, s, s2];
    } else if (name === 'rumble') {
      const n = c.createBufferSource(); n.buffer = this.brown; n.loop = true;
      const lp = this._filter(out, 'lowpass', 140 * P, 1); n.connect(lp);
      const sub = c.createOscillator(); sub.frequency.value = 32 * P; const sg = c.createGain(); sg.gain.value = 0.4; sub.connect(sg).connect(out);
      nodes = [n, sub];
    } else {
      this.play(name, opts); out.disconnect(); return noop;
    }
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(opts.volume ?? 1, t + 0.08);
    if (name !== 'beam') nodes.forEach((n) => n.start(t)); // _beamVoice starts its own nodes
    let stopped = false;
    const safety = setTimeout(() => handle.stop(), 20000); // never leak a drone
    const handle = {
      stop: (fade = 0.3) => {
        if (stopped) return; stopped = true; clearTimeout(safety);
        const now = c.currentTime;
        out.gain.cancelScheduledValues(now); out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), now); out.gain.exponentialRampToValueAtTime(0.0001, now + fade);
        nodes.forEach((n) => { try { n.stop(now + fade + 0.05); } catch (e) { /* ignore */ } });
        setTimeout(() => { try { tail.disconnect(); } catch (e) { /* ignore */ } }, (fade + 0.2) * 1000);
      },
    };
    return handle;
  }

  // ---------------------------------------------------------------- voice
  say(text) {
    const ss = window.speechSynthesis;
    if (!ss || this.muted || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      ss.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = ss.getVoices() || [];
      const pref = ['Daniel', 'Fred', 'Alex', 'Ralph', 'Google UK English Male', 'Microsoft David', 'Aaron', 'Arthur'];
      this._voice = this._voice || pref.map((n) => voices.find((v) => v.name.includes(n))).find(Boolean) || voices.find((v) => /en/i.test(v.lang)) || null;
      if (this._voice) u.voice = this._voice;
      u.rate = 0.78; u.pitch = 0.05; u.volume = Math.min(1, this.masterVolume * 1.1);
      ss.speak(u);
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- music instruments
  _taiko(o, t, g = 1, P = 1) {
    this._tone(o, { type: 'sine', f: [120 * P, 48 * P], t, a: 0.002, d: 0.55, g: 0.9 * g, glide: 0.12 });
    this._tone(o, { type: 'triangle', f: [220 * P, 90 * P], t, d: 0.08, g: 0.3 * g });
    this._noise(o, { t, d: 0.16, g: 0.45 * g, type: 'lowpass', f: [1400 * P, 200 * P], Q: 1 });
  }
  _snare(o, t, g = 1) {
    this._noise(o, { t, d: 0.2, g: 0.5 * g, type: 'bandpass', f: 1900, Q: 0.7 });
    this._tone(o, { type: 'triangle', f: [260, 170], t, d: 0.1, g: 0.35 * g });
  }
  _hat(o, t, g = 1, open = false) { this._noise(o, { t, d: open ? 0.18 : 0.035, g: 0.18 * g, type: 'highpass', f: 7500 }); }
  _bass(o, t, f, dur, g = 1) {
    const c = this.ctx, lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(220, t + dur * 0.9); lp.connect(o);
    this._tone(lp, { type: 'sawtooth', f, t, a: 0.004, d: dur, g: 0.45 * g });
    this._tone(lp, { type: 'square', f: f * 0.5, t, a: 0.004, d: dur, g: 0.2 * g });
  }
  _brass(o, t, freqs, dur, g = 0.12, { rise = false, fall = false, attack = 0.04 } = {}) {
    const c = this.ctx, lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.5;
    lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(2600, t + attack + 0.08);
    lp.frequency.exponentialRampToValueAtTime(rise ? 3800 : 900, t + dur); lp.connect(o);
    const env = c.createGain(); env.connect(lp);
    env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(g, t + attack);
    env.gain.setValueAtTime(g * 0.8, t + dur * 0.6); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    freqs.forEach((f) => [-9, 0, 8].forEach((det) => {
      const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.setValueAtTime(f, t); s.detune.value = det;
      if (rise) s.frequency.exponentialRampToValueAtTime(f * 1.06, t + dur);
      if (fall) s.frequency.exponentialRampToValueAtTime(f * 0.7, t + dur);
      s.connect(env); s.start(t); s.stop(t + dur + 0.05);
    }));
  }
  _pad(o, t, freqs, dur, g = 0.05) {
    const c = this.ctx, lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(1100, t + dur * 0.5); lp.frequency.linearRampToValueAtTime(500, t + dur); lp.connect(o);
    const env = c.createGain(); env.connect(lp);
    env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(g, t + Math.min(1.8, dur * 0.4));
    env.gain.setValueAtTime(g, t + dur * 0.75); env.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
    freqs.forEach((f) => [-12, 0, 11].forEach((det) => {
      const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.value = f; s.detune.value = det;
      s.connect(env); s.start(t); s.stop(t + dur + 0.7);
    }));
  }
  _pluck(o, t, f, g = 0.1, d = 0.18) {
    const c = this.ctx, lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(300, t + d); lp.connect(o);
    this._tone(lp, { type: 'square', f, t, a: 0.002, d, g });
  }

  // ---------------------------------------------------------------- music
  music(track) {
    this._wantTrack = track;
    if (!this.ctx) return;
    if (track === this._curTrack) return;
    this._curTrack = track;
    const now = this.ctx.currentTime;
    for (const tr of this._tracks) {
      if (tr.dead) continue;
      tr.dead = true;
      tr.gain.gain.cancelScheduledValues(now); tr.gain.gain.setValueAtTime(tr.gain.gain.value, now); tr.gain.gain.linearRampToValueAtTime(0.0001, now + 1.6);
      tr.stopAt = now + 1.7;
    }
    if (!track || !TRACKS[track]) return;
    const def = TRACKS[track];
    const gain = this.ctx.createGain(); gain.gain.setValueAtTime(0.0001, now); gain.gain.linearRampToValueAtTime(1, now + 1.2); gain.connect(this.musicBus);
    this._tracks.push({ name: track, def, gain, i: 0, next: now + 0.1, dead: false, spb: 60 / def.bpm / 4 });
  }

  _schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime, ahead = now + 0.14;
    this._tracks = this._tracks.filter((tr) => {
      if (tr.dead && now > tr.stopAt) { setTimeout(() => { try { tr.gain.disconnect(); } catch (e) { /* ignore */ } }, 3000); return false; }
      if (tr.next < now - 0.5) tr.next = now + 0.02; // tab was throttled: resync
      while (tr.next < ahead && !(tr.dead && tr.next > tr.stopAt)) {
        try { tr.def.step(this, tr.i % tr.def.steps, tr.next, tr.gain, tr.spb, Math.floor(tr.i / tr.def.steps)); } catch (e) { console.warn('[music]', e); }
        tr.next += tr.spb; tr.i++;
      }
      return true;
    });
  }
}

// ------------------------------------------------------------------ tracks
// step(audio, stepIndex, time, out, secondsPer16th, loopCount)
const chord = (root, q = 'm') => (q === 'm' ? [0, 7, 12, 15, 19] : [0, 7, 12, 16, 19]).map((i) => NOTE(root + i));
const TRACKS = {
  // Brooding orchestral-ish pads + taiko, 76 bpm, 8 bars
  title: {
    bpm: 76, steps: 128,
    step(a, i, t, o, spb) {
      const bar = Math.floor(i / 16), s = i % 16;
      const prog = [[D2, 'm'], [Bb1, 'M'], [G2 - 12, 'm'], [A2 - 12, 'M']];
      if (s === 0 && bar % 2 === 0) {
        const [r, q] = prog[bar / 2];
        a._pad(o, t, chord(r + 12, q), spb * 32, 0.028);
        a._tone(o, { type: 'sine', f: NOTE(r), t, a: 0.3, d: spb * 30, g: 0.35 }); // drone
        a._taiko(o, t, 1.1, 0.7);
        a._tone(o, { type: 'sine', f: [55, 25], t, a: 0.01, d: 1.8, g: 0.6 });
      }
      if (s === 8) a._taiko(o, t, 0.6, 0.9);
      if (bar % 2 === 1 && (s === 12 || s === 14)) a._taiko(o, t, 0.35, 1.2);
      if (bar % 2 === 1 && s === 15) a._taiko(o, t, 0.5, 1.1);
      // horn call every 4 bars
      if (bar % 4 === 1 && s === 4) a._brass(o, t, [NOTE(D3), NOTE(D3 - 12)], spb * 10, 0.05);
      if (bar % 4 === 1 && s === 14) a._brass(o, t, [NOTE(D3 + 7), NOTE(D3 - 5)], spb * 14, 0.05);
      if (bar % 4 === 3 && s === 4) a._brass(o, t, [NOTE(D3 + 5), NOTE(D3 - 7)], spb * 8, 0.045, { fall: true });
    },
  },
  // Tense pulse, 112 bpm, 4 bars
  select: {
    bpm: 112, steps: 64,
    step(a, i, t, o, spb) {
      const bar = Math.floor(i / 16), s = i % 16;
      const root = bar < 2 ? D2 : D2 + 1; // Dm → Eb (phrygian tension)
      a._pluck(o, t, NOTE(root + (s % 4 === 2 ? 12 : 0)), s % 4 === 0 ? 0.09 : 0.05, 0.14);
      if (s === 0 && bar % 2 === 0) a._pad(o, t, chord(root + 12, 'm').slice(1), spb * 32, 0.022);
      if (s === 0) { a._taiko(o, t, 0.9, 0.8); a._bass(o, t, NOTE(root - 12), spb * 6, 0.8); }
      if (s === 6 || s === 10) a._taiko(o, t, 0.45, 1);
      if (s === 12 && bar === 3) a._snare(o, t, 0.8);
      if (s % 2 === 1) a._hat(o, t, 0.4);
      if (bar === 3 && s === 0) a._noise(o, { t, a: spb * 14, d: 0.05, g: 0.12, type: 'bandpass', f: [400, 5000], Q: 2 }); // riser
    },
  },
  // Driving 144 bpm taiko + bass ostinato + brass stabs, 8 bars, loops seamlessly
  fight: {
    bpm: 144, steps: 128,
    step(a, i, t, o, spb, loop) {
      const bar = Math.floor(i / 16), s = i % 16;
      const roots = [D2, D2, Bb1, C2, D2, D2, Bb1, A2 - 12];
      const quals = ['m', 'm', 'M', 'M', 'm', 'm', 'M', 'M'];
      const r = roots[bar];
      // drums
      const taikoPat = { 0: 1.1, 3: 0.6, 6: 0.8, 8: 1, 10: 0.4, 11: 0.6, 14: 0.7 };
      if (taikoPat[s]) a._taiko(o, t, taikoPat[s], s % 8 === 0 ? 0.8 : 1);
      if (s === 4 || s === 12) a._snare(o, t, 1);
      if (bar % 4 === 3 && s >= 12) a._snare(o, t, 0.4 + (s - 12) * 0.15);
      a._hat(o, t, s % 4 === 2 ? 0.9 : 0.4, s === 14 && bar % 2 === 1);
      if (s === 0 && bar % 4 === 0) a._noise(o, { t, d: 1.4, g: 0.25, type: 'highpass', f: 4000 });
      // bass ostinato (16ths)
      const pat = [0, 0, 12, 0, 3, 0, 0, 5, 0, 0, 12, 0, 7, 5, 3, 2];
      a._bass(o, t, NOTE(r + pat[s] - (quals[bar] === 'M' && pat[s] === 3 ? -1 : 0)), spb * 0.9, s % 4 === 0 ? 1 : 0.7);
      if (s === 0) a._tone(o, { type: 'sine', f: NOTE(r - 12), t, a: 0.005, d: spb * 7, g: 0.5 });
      // brass stabs
      const ch = chord(r + 12, quals[bar]).slice(0, 4);
      if (s === 0) a._brass(o, t, ch, bar % 4 === 0 ? spb * 6 : spb * 2.5, 0.075, { rise: bar % 4 === 0 });
      if (s === 6 || (s === 10 && bar % 2 === 1)) a._brass(o, t, ch, spb * 1.6, 0.06);
      if (bar === 7 && s === 12) a._brass(o, t, chord(A2, 'M').slice(0, 4), spb * 4, 0.07, { rise: true });
      // counter melody on second half of loop, every other loop
      if (loop % 2 === 1 && bar >= 4 && s % 4 === 0) {
        const mel = [D3 + 12, D3 + 10, D3 + 12, D3 + 15, D3 + 14, D3 + 12, D3 + 10, D3 + 7];
        a._brass(o, t, [NOTE(mel[((bar - 4) * 4 + s / 4) % 8])], spb * 3.5, 0.03);
      }
    },
  },
};
