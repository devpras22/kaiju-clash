// OWNER: world/visuals agent. GPU-friendly particle + VFX system.
// CONTRACT (must be preserved):
//   new FX(scene)
//   fx.update(dt, camera)
//   fx.sparks(pos, color = 0xffcc66, count = 30, speed = 20)
//   fx.dust(pos, scale = 1)            — rolling dust cloud (footsteps, landings, collapses)
//   fx.debris(pos, scale = 1, color)   — flying chunks of concrete/glass
//   fx.explosion(pos, scale = 1, color)
//   fx.shockwave(pos, radius = 20, color = 0xffffff)  — expanding ground ring
//   fx.beam(color = 0x44ccff, width = 1.5) → handle { set(start: Vector3, end: Vector3), stop() } — continuous energy beam
//   fx.flashLight(pos, color, intensity = 50, duration = 0.2) — transient point light
//   fx.clear()
// OPTIONAL EXTRAS (world agent):
//   fx.shards(pos, dir, count)         — glinting glass shards
//   fx.dustWave(pos, radius, scale)    — huge expanding ground-hugging dust ring (building collapse)
//   fx.fire(pos, scale, { plume }) → handle { pos, scale, setPos(v), stop() } — persistent fire + smoke emitter
//   fx.embers(pos, count)
//
// Implementation: ONE instanced billboard draw call for all particles (premultiplied alpha → additive and alpha
// particles mix in the same batch), procedural canvas atlas (glow / 2 smoke puffs / star), velocity-stretched
// streaks for sparks. Shockwave rings and beams are small pooled meshes. Max 4 pooled flash point lights.
import * as THREE from 'three';

const MAX = 9000;
const STRIDE = 24;
// field offsets
const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, LIFE = 6, MAXL = 7, S0 = 8, S1 = 9, R0 = 10, G0 = 11, B0 = 12, A0 = 13,
  R1 = 14, G1 = 15, B1 = 16, ROT = 17, ROTV = 18, DRAG = 19, GRAV = 20, FRAME = 21, STRETCH = 22, ADD = 23;
const _c = new THREE.Color(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const rnd = Math.random, rr = (a, b) => a + (b - a) * rnd();

function makeAtlas() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S * 2;
  const g = c.getContext('2d');
  const img = g.createImageData(S * 2, S * 2), d = img.data;
  // value noise for puffs
  const P = new Float32Array(64 * 64).map(() => Math.random());
  const n = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const at = (a, b) => P[((b & 63) << 6) | (a & 63)]; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return (at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - v) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * v; };
  const fbm = (x, y) => { let s = 0, a = 0.5; for (let o = 0; o < 5; o++) { s += a * n(x, y); x *= 2.1; y *= 2.1; a *= 0.5; } return s; };
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * S, oy = Math.floor(cell / 2) * S;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1, r = Math.hypot(u, v);
      let lum = 1, a = 0;
      if (cell === 0) { a = Math.exp(-r * r * 4.5) * (1 - Math.min(1, r)); }
      else if (cell === 3) { a = Math.max(Math.exp(-r * r * 18), Math.exp(-Math.abs(u) * 30) * Math.exp(-v * v * 3) * 0.8, Math.exp(-Math.abs(v) * 30) * Math.exp(-u * u * 3) * 0.8) * (1 - Math.min(1, r)); }
      else {
        const s = cell * 7.3;
        const f = fbm(u * 2.2 + s, v * 2.2 + s);
        const edge = 1 - Math.min(1, r * (0.9 + 0.5 * (f - 0.5) * 2));
        a = Math.max(0, Math.min(1, edge * 1.6)) * (0.55 + 0.6 * f);
        lum = 0.55 + 0.45 * (-v * 0.5 + 0.5) * (0.7 + 0.6 * f); // lighter top, darker bottom
      }
      const i = ((oy + y) * S * 2 + ox + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.min(255, lum * 255); d[i + 3] = Math.min(255, a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true;
  return t;
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.data = new Float32Array(MAX * STRIDE); this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aP = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iVel', this.aVel); g.setAttribute('iCol', this.aCol); g.setAttribute('iP', this.aP);
    g.instanceCount = 0;
    this.uniforms = { map: { value: makeAtlas() }, uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0 }, uLight: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: `attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iCol; attribute vec4 iP;
        uniform float uFogDensity; varying vec2 vUv; varying vec4 vCol; varying float vFrame; varying float vFog; varying float vAdd;
        void main(){
          vec4 mv = viewMatrix * vec4(iPos, 1.0);
          vec2 q = position.xy;
          float size = abs(iP.x);
          if (iP.w > 0.0) {
            vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz; vec2 d = vv.xy; float l = length(d);
            d = l > 1e-4 ? d / l : vec2(0.0, 1.0); vec2 nn = vec2(-d.y, d.x);
            mv.xy += d * q.y * (size + l * iP.w) + nn * q.x * size * 0.35;
          } else { float c = cos(iP.y), s = sin(iP.y); mv.xy += mat2(c, s, -s, c) * q * size; }
          gl_Position = projectionMatrix * mv;
          vUv = position.xy + 0.5; vCol = iCol; vFrame = iP.z - floor(iP.z / 8.0) * 8.0; vAdd = step(8.0, iP.z);
          float L = -mv.z; vFog = 1.0 - exp(-uFogDensity * L * 0.6);
        }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 uFogColor; uniform float uLight;
        varying vec2 vUv; varying vec4 vCol; varying float vFrame; varying float vFog; varying float vAdd;
        void main(){
          vec2 cell = vec2(mod(vFrame, 2.0), floor(vFrame / 2.0));
          vec4 t = texture2D(map, (vUv + cell) * 0.5);
          float a = t.a * vCol.a;
          vec3 c;
          if (vAdd > 0.5) { c = vCol.rgb * a * (1.0 - vFog); gl_FragColor = vec4(c, 0.0); }
          else { c = vCol.rgb * t.rgb * uLight; c = mix(c, uFogColor, vFog); gl_FragColor = vec4(c * a, a); }
        }`,
    });
    this.points = new THREE.Mesh(g, mat); this.points.frustumCulled = false; this.points.renderOrder = 10;
    scene.add(this.points);
    this.geo = g;

    // pooled flash lights (constant count → no shader recompiles)
    this.lights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffffff, 0, 120, 1.3); l.position.set(0, -200, 0); scene.add(l); this.lights.push({ l, t: 0, dur: 1, peak: 0, hold: false }); }

    // shockwave ring pool
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.75, 1, 96, 1); ringGeo.rotateX(-Math.PI / 2);
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true); wallGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 6; i++) {
      const u = { uColor: { value: new THREE.Color() }, uA: { value: 0 } };
      const rm = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: 'varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 uColor; uniform float uA; varying vec3 vP;
          void main(){ float r = length(vP.xz); float k = smoothstep(0.75, 0.93, r) * (1.0 - smoothstep(0.93, 1.0, r)); gl_FragColor = vec4(uColor * k * uA, 1.0); }` });
      const wm = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 wp = modelMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
        fragmentShader: 'uniform vec3 uColor; uniform float uA; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0); float h = pow(1.0 - vUv.y, 2.0); gl_FragColor = vec4(uColor * f * h * uA * 0.8, 1.0); }' });
      const ring = new THREE.Mesh(ringGeo, rm), wall = new THREE.Mesh(wallGeo, wm);
      ring.visible = wall.visible = false; ring.frustumCulled = wall.frustumCulled = false;
      scene.add(ring, wall);
      this.rings.push({ ring, wall, u, t: 0, dur: 1, R: 1, active: false, pos: new THREE.Vector3() });
    }

    // debris chunk pool (instanced, lit)
    const DB = 220;
    const dg = new THREE.DodecahedronGeometry(0.5, 0);
    this.debrisMesh = new THREE.InstancedMesh(dg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), DB);
    this.debrisMesh.castShadow = true; this.debrisMesh.frustumCulled = false; this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < DB; i++) { this.debrisMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); this.debrisMesh.setColorAt(i, _c.set(0x777777)); }
    scene.add(this.debrisMesh);
    this.debris_ = Array.from({ length: DB }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: 1, life: 0 }));
    this.debrisNext = 0;

    this.beams = new Set();
    this.fires = new Set();
    this._m = new THREE.Matrix4();
  }

  // ---- core emitter ----------------------------------------------------------------------------
  // o: { pos, vel, life, s0, s1, col:[r,g,b], a, col1, rot, rotV, drag, grav, frame, stretch, add }
  _emit(px, py, pz, vx, vy, vz, life, s0, s1, r0, g0, b0, a0, r1, g1, b1, frame, add, drag = 0, grav = 0, stretch = 0, rot = rnd() * 6.28, rotV = 0) {
    if (this.n >= MAX) return;
    const d = this.data, o = this.n++ * STRIDE;
    d[o + PX] = px; d[o + PY] = py; d[o + PZ] = pz; d[o + VX] = vx; d[o + VY] = vy; d[o + VZ] = vz;
    d[o + LIFE] = life; d[o + MAXL] = life; d[o + S0] = s0; d[o + S1] = s1;
    d[o + R0] = r0; d[o + G0] = g0; d[o + B0] = b0; d[o + A0] = a0; d[o + R1] = r1; d[o + G1] = g1; d[o + B1] = b1;
    d[o + ROT] = rot; d[o + ROTV] = rotV; d[o + DRAG] = drag; d[o + GRAV] = grav; d[o + FRAME] = frame; d[o + STRETCH] = stretch; d[o + ADD] = add;
  }

  sparks(pos, color = 0xffcc66, count = 30, speed = 20) {
    _c.set(color);
    const r = _c.r * 5, g = _c.g * 5, b = _c.b * 5;
    for (let i = 0; i < count; i++) {
      _v.set(rnd() - 0.5, rnd() * 0.9 - 0.2, rnd() - 0.5).normalize().multiplyScalar(speed * rr(0.3, 1.1));
      this._emit(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, rr(0.25, 0.6), rr(0.12, 0.25), 0.05, r, g, b, 1, r * 0.6, g * 0.3, b * 0.1, 0, 1, 1.8, 22, 0.06);
    }
    this._emit(pos.x, pos.y, pos.z, 0, 0, 0, 0.12, 5, 7, r * 1.2, g * 1.2, b * 1.2, 1, r, g, b, 3, 1);
    this._emit(pos.x, pos.y, pos.z, 0, 0, 0, 0.18, 3, 6, r * 0.6, g * 0.6, b * 0.6, 0.8, r * 0.2, g * 0.2, b * 0.2, 0, 1);
  }

  dust(pos, scale = 1) {
    const n = Math.min(26, Math.round(7 + 6 * scale));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, sp = rr(2, 7) * scale;
      const c = rr(0.18, 0.3);
      this._emit(pos.x + Math.cos(a) * scale, pos.y + rr(0, 1) * scale, pos.z + Math.sin(a) * scale, Math.cos(a) * sp, rr(0.5, 2.5) * scale, Math.sin(a) * sp,
        rr(2.2, 4.2), rr(2, 3.5) * scale, rr(7, 12) * scale, c * 1.1, c, c * 0.88, rr(0.35, 0.6), c * 0.8, c * 0.78, c * 0.75, 1 + (rnd() < 0.5 ? 1 : 0), 0, 1.6, -0.4, 0, undefined, rr(-0.4, 0.4));
    }
  }

  dustWave(pos, radius = 40, scale = 1.5) {
    const n = 60;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.1, sp = radius * rr(0.9, 1.4);
      const c = rr(0.2, 0.3);
      this._emit(pos.x + Math.cos(a) * 3, pos.y + rr(0.5, 3), pos.z + Math.sin(a) * 3, Math.cos(a) * sp, rr(0.5, 2), Math.sin(a) * sp,
        rr(4, 6.5), 5 * scale, rr(14, 22) * scale, c * 1.1, c, c * 0.88, 0.55, c * 0.8, c * 0.77, c * 0.72, 1 + (i & 1), 0, 1.3, -0.3, 0, undefined, rr(-0.3, 0.3));
    }
  }

  shards(pos, dir, count = 10) {
    for (let i = 0; i < count; i++) {
      _v.copy(dir).multiplyScalar(rr(4, 12)).add(_v2.set(rr(-5, 5), rr(0, 6), rr(-5, 5)));
      const b = rr(1.5, 4);
      this._emit(pos.x + rr(-1, 1), pos.y + rr(-1, 1), pos.z + rr(-1, 1), _v.x, _v.y, _v.z, rr(0.8, 1.6), rr(0.15, 0.3), 0.1, b * 0.8, b * 0.95, b * 1.1, 1, 0.1, 0.12, 0.15, 3, 1, 0.4, 16, 0, undefined, rr(-12, 12));
    }
  }

  embers(pos, count = 12) {
    for (let i = 0; i < count; i++) {
      this._emit(pos.x + rr(-2, 2), pos.y + rr(0, 2), pos.z + rr(-2, 2), rr(-2, 2), rr(3, 9), rr(-2, 2), rr(1.2, 2.8), rr(0.12, 0.25), 0.05, 6, 2.2, 0.4, 1, 2, 0.3, 0, 0, 1, 0.6, -1, 0.03);
    }
  }

  debris(pos, scale = 1, color = 0x777777) {
    const n = Math.round(10 + 6 * scale);
    for (let i = 0; i < n; i++) {
      const d = this.debris_[this.debrisNext]; const idx = this.debrisNext; this.debrisNext = (this.debrisNext + 1) % this.debris_.length;
      d.p.copy(pos).add(_v.set(rr(-1, 1), rr(0, 1), rr(-1, 1)).multiplyScalar(scale));
      d.v.set(rr(-1, 1), rr(0.6, 1.6), rr(-1, 1)).normalize().multiplyScalar(rr(6, 16) * Math.sqrt(scale));
      d.w.set(rr(-8, 8), rr(-8, 8), rr(-8, 8)); d.q.identity(); d.s = rr(0.25, 0.8) * scale; d.life = rr(3, 5);
      this.debrisMesh.setColorAt(idx, _c.set(color).multiplyScalar(rr(0.6, 1.2)));
    }
    this.debrisMesh.instanceColor.needsUpdate = true;
    for (let i = 0; i < n * 2; i++) {
      _v.set(rr(-1, 1), rr(0.4, 1.5), rr(-1, 1)).multiplyScalar(rr(4, 14) * scale);
      this._emit(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, rr(0.8, 1.6), rr(0.1, 0.25) * scale, 0.1, 0.12, 0.11, 0.1, 1, 0.1, 0.1, 0.1, 0, 0, 0.3, 20);
    }
    this.dust(pos, scale * 0.8);
  }

  explosion(pos, scale = 1, color = 0xff8833) {
    _c.set(color);
    const r = _c.r, g = _c.g, b = _c.b;
    for (let i = 0; i < 26; i++) {
      _v.set(rnd() - 0.5, rnd() * 0.8, rnd() - 0.5).normalize().multiplyScalar(rr(4, 14) * scale);
      this._emit(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, rr(0.5, 1.0), rr(2, 3.5) * scale, rr(6, 10) * scale, r * 7 + 2, g * 6 + 1, b * 4, 1, r * 1.5, g * 0.4, b * 0.1, 1 + (i & 1), 1, 3.0, -3);
    }
    for (let i = 0; i < 18; i++) {
      _v.set(rnd() - 0.5, rnd() * 0.6 + 0.3, rnd() - 0.5).normalize().multiplyScalar(rr(3, 8) * scale);
      const c = rr(0.04, 0.09);
      this._emit(pos.x, pos.y + scale, pos.z, _v.x, _v.y, _v.z, rr(3, 5.5), rr(3, 5) * scale, rr(10, 16) * scale, c, c, c, 0.75, c * 0.7, c * 0.7, c * 0.7, 1 + (i & 1), 0, 1.4, -2.5, 0, undefined, rr(-0.5, 0.5));
    }
    this._emit(pos.x, pos.y, pos.z, 0, 0, 0, 0.25, 8 * scale, 22 * scale, 12, 9, 6, 1, r * 3, g * 2, b, 0, 1);
    this.sparks(pos, color, 40, 28 * scale);
    this.embers(pos, 16);
    this.flashLight(pos, color, 120 * scale, 0.35);
    this.shockwave(_v2.set(pos.x, 0.2, pos.z), 10 * scale, color);
  }

  shockwave(pos, radius = 20, color = 0xffffff) {
    const r = this.rings.find((x) => !x.active) || this.rings.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    r.active = true; r.t = 0; r.dur = 0.45 + radius * 0.012; r.R = radius; r.pos.set(pos.x, Math.max(0.15, pos.y), pos.z);
    r.u.uColor.value.set(color).multiplyScalar(3);
    r.ring.visible = r.wall.visible = true;
    // dust ring hugging the ground
    const n = Math.min(40, Math.round(radius * 1.4));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, sp = radius * rr(1.2, 1.8);
      const c = rr(0.2, 0.28);
      this._emit(pos.x + Math.cos(a) * 2, 0.8, pos.z + Math.sin(a) * 2, Math.cos(a) * sp, rr(0.3, 1.5), Math.sin(a) * sp, rr(1.5, 2.6), rr(2, 3), rr(6, 10), c * 1.1, c, c * 0.9, 0.5, c * 0.8, c * 0.8, c * 0.75, 1 + (i & 1), 0, 2.6, 0);
    }
  }

  flashLight(pos, color, intensity = 50, duration = 0.2) {
    const L = this.lights.find((x) => !x.hold && x.t >= x.dur) || this.lights.filter((x) => !x.hold).sort((a, b) => b.t / b.dur - a.t / a.dur)[0];
    if (!L) return;
    L.l.position.copy(pos); L.l.color.set(color); L.peak = intensity * 10; L.t = 0; L.dur = duration;
  }

  fire(pos, scale = 1, { plume = false } = {}) {
    const h = { pos: pos.clone(), scale, plume, acc: 0, sacc: 0, alive: true, setPos: (v) => h.pos.copy(v), stop: () => { h.alive = false; this.fires.delete(h); } };
    this.fires.add(h);
    return h;
  }

  beam(color = 0x44ccff, width = 1.5) {
    const b = new Beam(this, color, width);
    this.beams.add(b);
    return { set: (a, e) => b.set(a, e), stop: () => b.stop() };
  }

  clear() {
    this.n = 0; this.geo.instanceCount = 0;
    for (const b of this.beams) b.dispose();
    this.beams.clear();
    for (const r of this.rings) { r.active = false; r.ring.visible = r.wall.visible = false; }
    for (const L of this.lights) { L.t = L.dur; L.hold = false; L.l.intensity = 0; }
    for (const d of this.debris_) d.life = 0;
    // persistent fires (ambient city fires) survive clear(); city.reset() restarts them
  }

  // ---- update ----------------------------------------------------------------------------------
  update(dt, camera) {
    const fog = this.scene.fog;
    if (fog) { this.uniforms.uFogColor.value.copy(fog.color); this.uniforms.uFogDensity.value = fog.density || 0; }
    // fires emit
    for (const h of this.fires) {
      if (dt <= 0) break;
      const s = h.scale;
      h.acc += dt * 28 * Math.sqrt(s);
      while (h.acc > 1) {
        h.acc--;
        this._emit(h.pos.x + rr(-1, 1) * s, h.pos.y + rr(0, 0.5) * s, h.pos.z + rr(-1, 1) * s, rr(-0.5, 0.5), rr(2, 5) * Math.sqrt(s), rr(-0.5, 0.5),
          rr(0.6, 1.2), rr(1.2, 2.2) * s, rr(0.3, 0.8) * s, 7, 2.6, 0.5, 1, 1.2, 0.15, 0.02, 1 + (rnd() < 0.5 ? 1 : 0), 1, 0.5, -3, 0, undefined, rr(-1, 1));
      }
      h.sacc += dt * (h.plume ? 7 : 5);
      while (h.sacc > 1) {
        h.sacc--;
        const c = rr(0.03, 0.06);
        this._emit(h.pos.x + rr(-1, 1) * s, h.pos.y + s * 1.5, h.pos.z + rr(-1, 1) * s, rr(0.5, 2) + 1.5, rr(3, 5) * Math.sqrt(s), rr(-0.5, 0.5) + 0.6,
          h.plume ? rr(9, 14) : rr(4, 7), s * 1.8, s * (h.plume ? 14 : 7), c * 1.4, c * 1.1, c, 0.6, c, c, c, 1 + (rnd() < 0.5 ? 1 : 0), 0, 0.15, -0.6, 0, undefined, rr(-0.3, 0.3));
      }
      if (rnd() < dt * 3) this.embers(h.pos, 3);
    }
    for (const b of this.beams) b.update(dt);

    // particles
    const d = this.data, P = this.aPos.array, V = this.aVel.array, C = this.aCol.array, Q = this.aP.array;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * STRIDE;
      let life = d[o + LIFE] - dt;
      if (life <= 0) continue;
      d[o + LIFE] = life;
      const drag = Math.exp(-d[o + DRAG] * dt);
      d[o + VX] *= drag; d[o + VY] = d[o + VY] * drag - d[o + GRAV] * dt; d[o + VZ] *= drag;
      d[o + PX] += d[o + VX] * dt; d[o + PY] += d[o + VY] * dt; d[o + PZ] += d[o + VZ] * dt;
      if (d[o + PY] < 0.05 && d[o + GRAV] > 0) { d[o + PY] = 0.05; d[o + VY] *= -0.3; d[o + VX] *= 0.6; d[o + VZ] *= 0.6; }
      d[o + ROT] += d[o + ROTV] * dt;
      const t = 1 - life / d[o + MAXL];
      const ease = 1 - (1 - t) * (1 - t);
      const size = d[o + S0] + (d[o + S1] - d[o + S0]) * ease;
      const fade = Math.min(1, t * 8) * (1 - t) * (d[o + ADD] > 0 ? 1 : (1 - t));
      if (w !== i) d.copyWithin(w * STRIDE, o, o + STRIDE);
      const o2 = w * STRIDE;
      P[w * 3] = d[o2 + PX]; P[w * 3 + 1] = d[o2 + PY]; P[w * 3 + 2] = d[o2 + PZ];
      V[w * 3] = d[o2 + VX]; V[w * 3 + 1] = d[o2 + VY]; V[w * 3 + 2] = d[o2 + VZ];
      C[w * 4] = d[o2 + R0] + (d[o2 + R1] - d[o2 + R0]) * t; C[w * 4 + 1] = d[o2 + G0] + (d[o2 + G1] - d[o2 + G0]) * t; C[w * 4 + 2] = d[o2 + B0] + (d[o2 + B1] - d[o2 + B0]) * t;
      C[w * 4 + 3] = d[o2 + A0] * fade;
      Q[w * 4] = size; Q[w * 4 + 1] = d[o2 + ROT]; Q[w * 4 + 2] = d[o2 + FRAME] + (d[o2 + ADD] > 0 ? 8 : 0); Q[w * 4 + 3] = d[o2 + STRETCH];
      w++;
    }
    this.n = w; this.geo.instanceCount = w;
    for (const a of [this.aPos, this.aVel, this.aCol, this.aP]) { a.clearUpdateRanges(); a.addUpdateRange(0, w * a.itemSize); a.needsUpdate = true; }

    // lights
    for (const L of this.lights) {
      if (L.hold) continue;
      L.t += dt;
      const k = Math.max(0, 1 - L.t / L.dur);
      L.l.intensity = L.peak * k * k;
    }
    // rings
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt; const k = r.t / r.dur;
      if (k >= 1) { r.active = false; r.ring.visible = r.wall.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3), R = Math.max(0.01, r.R * e);
      r.ring.position.copy(r.pos); r.ring.scale.set(R, 1, R);
      r.wall.position.copy(r.pos).setY(0); r.wall.scale.set(R * 0.98, 2 + r.R * 0.12 * (1 - k), R * 0.98);
      r.u.uA.value = (1 - k) * (1 - k);
    }
    // debris chunks
    const M = this._m; let any = false;
    for (let i = 0; i < this.debris_.length; i++) {
      const b = this.debris_[i];
      if (b.life <= 0) { if (b.s !== 0) { b.s = 0; this.debrisMesh.setMatrixAt(i, M.makeScale(0, 0, 0)); any = true; } continue; }
      b.life -= dt; b.v.y -= 22 * dt; b.p.addScaledVector(b.v, dt);
      if (b.p.y < b.s * 0.4) { b.p.y = b.s * 0.4; b.v.y *= -0.35; b.v.x *= 0.6; b.v.z *= 0.6; b.w.multiplyScalar(0.6); }
      const wl = b.w.length(); if (wl > 0.01) b.q.premultiply(new THREE.Quaternion().setFromAxisAngle(_v.copy(b.w).divideScalar(wl), wl * dt));
      const s = b.life < 0.6 ? b.s * (b.life / 0.6) : b.s;
      M.compose(b.p, b.q, _v2.set(s, s, s)); this.debrisMesh.setMatrixAt(i, M); any = true;
    }
    if (any) this.debrisMesh.instanceMatrix.needsUpdate = true;
  }
}

// ---- ATOMIC BREATH style beam ------------------------------------------------------------------
class Beam {
  constructor(fx, color, width) {
    this.fx = fx; this.width = width; this.color = new THREE.Color(color);
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3(1, 0, 0); this.hasPos = false;
    this.t = 0; this.amp = 0; this.stopping = false; this.acc = 0;
    this.u = { uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uW: { value: width }, uColor: { value: this.color.clone() }, uTime: { value: 0 }, uAmp: { value: 0 } };
    const vs = (wMul) => `uniform vec3 uA; uniform vec3 uB; uniform float uW; uniform float uAmp; uniform float uTime; varying vec2 vUv; varying float vLen;
      void main(){
        vec3 dir = uB - uA; float L = length(dir); dir /= max(L, 1e-4);
        vec3 mid = uA + dir * L * position.y;
        vec3 toC = normalize(cameraPosition - mid);
        vec3 side = normalize(cross(dir, toC));
        float taper = smoothstep(0.0, 0.04, position.y) * 0.6 + 0.4;
        float wob = 1.0 + 0.12 * sin(position.y * L * 0.8 - uTime * 40.0);
        vec3 p = mid + side * position.x * uW * ${wMul.toFixed(2)} * uAmp * taper * wob;
        vUv = vec2(position.x, position.y); vLen = L;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`;
    const strip = new THREE.BufferGeometry();
    const pos = [], idx = [], SEG = 48;
    for (let i = 0; i <= SEG; i++) { pos.push(-1, i / SEG, 0, 1, i / SEG, 0); if (i < SEG) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
    strip.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); strip.setIndex(idx);
    const mk = (wMul, frag) => {
      const m = new THREE.Mesh(strip, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: vs(wMul), fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.frustumCulled = false; fx.scene.add(m); return m;
    };
    const noise = `float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }`;
    this.glow = mk(3.0, `uniform vec3 uColor; uniform float uTime; varying vec2 vUv; varying float vLen; ${noise}
      void main(){ float x = abs(vUv.x); float g = exp(-x * x * 5.0) * (1.0 - x); float n = n2(vec2(vUv.y * vLen * 0.25 - uTime * 18.0, vUv.x * 3.0));
        gl_FragColor = vec4(uColor * g * (0.6 + 0.5 * n) * 0.45, 1.0); }`);
    this.mid = mk(1.8, `uniform vec3 uColor; uniform float uTime; varying vec2 vUv; varying float vLen; ${noise}
      void main(){ float x = abs(vUv.x); float n = n2(vec2(vUv.y * vLen * 0.6 - uTime * 30.0, vUv.x * 4.0 + uTime * 5.0));
        float g = smoothstep(1.0, 0.2, x + (n - 0.5) * 0.6); gl_FragColor = vec4(uColor * g * 1.6, 1.0); }`);
    this.core = mk(0.55, `uniform vec3 uColor; varying vec2 vUv; void main(){ float x = abs(vUv.x); float g = smoothstep(1.0, 0.0, x); gl_FragColor = vec4(mix(uColor * 4.0, vec3(9.0), 0.7) * g, 1.0); }`);
    // end-point flares (camera-facing sprites via Sprite)
    const flareMat = new THREE.SpriteMaterial({ map: fx.uniforms.map.value, color: this.color.clone().multiplyScalar(2.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    flareMat.map = makeGlowTex();
    this.flareA = new THREE.Sprite(flareMat); this.flareB = new THREE.Sprite(flareMat.clone());
    fx.scene.add(this.flareA, this.flareB);
    // held light at impact
    this.light = fx.lights.find((l) => !l.hold) || null;
    if (this.light) { this.light.hold = true; this.light.l.color.copy(this.color); }
    this.meshes = [this.glow, this.mid, this.core, this.flareA, this.flareB];
    this.meshes.forEach((m) => (m.visible = false));
  }
  set(a, b) { this.a.copy(a); this.b.copy(b); this.hasPos = true; }
  stop() { this.stopping = true; }
  update(dt) {
    this.t += dt;
    this.amp = this.stopping ? Math.max(0, this.amp - dt * 7) : Math.min(1, this.amp + dt * 10);
    if (this.stopping && this.amp <= 0) { this.dispose(); this.fx.beams.delete(this); return; }
    const vis = this.hasPos;
    this.meshes.forEach((m) => (m.visible = vis));
    if (!vis) return;
    const u = this.u; u.uA.value.copy(this.a); u.uB.value.copy(this.b); u.uTime.value = this.t; u.uAmp.value = this.amp;
    const fl = 0.85 + 0.3 * Math.random();
    this.flareA.position.copy(this.a); this.flareA.scale.setScalar(this.width * 5 * this.amp * fl);
    this.flareB.position.copy(this.b); this.flareB.scale.setScalar(this.width * 9 * this.amp * fl);
    if (this.light) { this.light.l.position.copy(this.b).y += 2; this.light.l.intensity = 450 * this.amp * fl; }
    if (dt <= 0) return;
    // particles: motes along the beam + impact splash
    const fx = this.fx, c = this.color;
    this.acc += dt * 60 * this.amp;
    const dir = _v.copy(this.b).sub(this.a); const L = dir.length(); dir.divideScalar(L || 1);
    while (this.acc > 1) {
      this.acc--;
      const s = rnd();
      const px = this.a.x + dir.x * L * s, py = this.a.y + dir.y * L * s, pz = this.a.z + dir.z * L * s;
      fx._emit(px, py, pz, rr(-2, 2) + dir.x * 10, rr(-2, 2) + dir.y * 10, rr(-2, 2) + dir.z * 10, rr(0.3, 0.6), rr(0.2, 0.5) * this.width, 0.05, c.r * 5, c.g * 5, c.b * 5, 1, c.r, c.g, c.b, 0, 1, 1, 0, 0.04);
      // splash at end
      _v2.set(rr(-1, 1), rr(0.2, 1.5), rr(-1, 1)).normalize().multiplyScalar(rr(8, 22));
      fx._emit(this.b.x, this.b.y, this.b.z, _v2.x - dir.x * 6, _v2.y, _v2.z - dir.z * 6, rr(0.3, 0.7), rr(0.15, 0.35), 0.05, c.r * 6 + 1, c.g * 6 + 1, c.b * 6 + 1, 1, c.r, c.g, c.b, 0, 1, 1.5, 18, 0.07);
    }
    if (rnd() < dt * 14) fx.dust(this.b, 1.0);
    if (rnd() < dt * 10) {
      const k = rr(0.08, 0.14);
      fx._emit(this.b.x, this.b.y + 1, this.b.z, rr(-2, 2), rr(3, 6), rr(-2, 2), rr(2, 3.5), 3, 12, k, k, k * 1.1, 0.6, k * 0.7, k * 0.7, k * 0.8, 1, 0, 0.8, -1.5);
    }
  }
  dispose() {
    for (const m of this.meshes) { this.fx.scene.remove(m); m.material.dispose(); }
    this.glow.geometry.dispose();
    if (this.light) { this.light.hold = false; this.light.t = this.light.dur; this.light.l.intensity = 0; }
  }
}

let _glowTex = null;
function makeGlowTex() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.7)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.15)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}
