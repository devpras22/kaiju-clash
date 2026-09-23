// OWNER: world agent. In-reach destructible buildings. Every building is a grid of chunks (levels × column quadrants)
// rendered through ONE InstancedMesh with the procedural facade material. Impacts knock chunks off (ballistic),
// unsupported columns drop and pancake the floors below them, big hits bring whole towers down in a dust wave.
// Rooftop tanks/antennas and neon signs are "attachments" that ride along with their chunk.
import * as THREE from 'three';
import { BodySet, S_STATIC, S_DYN, S_SETTLED, S_HIDDEN, S_ATTACHED } from './Physics.js';
import { addBuildingAttributes } from './BuildingMaterial.js';
import { mulberry32 } from './util.js';

const F_COLUMN = 1;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _ax = new THREE.Vector3();
const NEON_COLORS = [[4, 0.4, 2.6], [0.3, 3.2, 4.5], [4.5, 0.6, 0.4], [4.2, 2.6, 0.5], [2.2, 0.5, 4.5], [0.6, 4.2, 1.2], [4.5, 4.2, 3.6]];

export class Destructibles {
  constructor(scene, material, fx, { neonTex, uTime }) {
    this.scene = scene; this.material = material; this.fx = fx;
    this.neonTex = neonTex; this.uTime = uTime;
    this.buildings = [];
    this.time = 0;
    this.fxBudget = 0;
    this.rng = mulberry32(99);
  }

  // defs: [{ cx, cz, w, d, h, style, seed }]
  build(defs) {
    const rng = mulberry32(1234);
    // --- count chunks first
    const plans = defs.map((d) => this._plan(d, rng));
    const total = plans.reduce((s, p) => s + p.chunks.length, 0);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.attrs = addBuildingAttributes(geo, total);
    const mesh = new THREE.InstancedMesh(geo, this.material, total);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh = mesh; this.scene.add(mesh);
    const B = new BodySet(mesh, total, { gravity: 14, maxDyn: 420, linger: [7, 12], sinkSpeed: 0.5 });
    B.rng = this.rng;
    this.bodies = B;
    this.cBuild = new Int16Array(total); this.cLevel = new Int16Array(total); this.cQuad = new Int16Array(total);
    this.hp = new Float32Array(total); this.heat = new Float32Array(total);
    this.hot = new Set();

    const { aInfo, aInfo2, aState } = this.attrs;
    const attachDefs = [];
    plans.forEach((pl, bi) => {
      const d = pl.def;
      const b = {
        idx: bi, cx: d.cx, cz: d.cz, w: d.w, d: d.d, h: d.h, style: d.style, seed: d.seed,
        minX: d.cx - d.w / 2, maxX: d.cx + d.w / 2, minZ: d.cz - d.d / 2, maxZ: d.cz + d.d / 2,
        levels: pl.levels, nq: pl.nx * pl.nz, grid: new Int32Array(pl.levels * pl.nx * pl.nz).fill(-1),
        first: 0, count: 0, intact: 0, power: 1, flick: 0, lastHit: -9, lastContact: -9, collapse: null, fire: null, mound: 0, moundTarget: 0,
      };
      b.first = B.n;
      for (const c of pl.chunks) {
        const i = B.add(d.cx + c.ox, c.cy, d.cz + c.oz, c.sx, c.sy, c.sz);
        this.cBuild[i] = bi; this.cLevel[i] = c.L; this.cQuad[i] = c.q;
        this.hp[i] = 0.7 + rng() * 0.8;
        aInfo.setXYZW(i, d.seed, d.style, c.hw, c.hd);
        aInfo2.setXYZW(i, c.ox, c.oz, c.cy, 0);
        aState.setXYZW(i, 1, 0, c.top ? 1 : 0, d.h);
        b.grid[c.L * b.nq + c.q] = i;
      }
      b.count = B.n - b.first; b.intact = b.count;
      this.buildings.push(b);
      for (const a of pl.attach) attachDefs.push({ ...a, chunk: b.grid[a.L * b.nq + a.q], b });
    });
    this.origState = aState.array.slice();
    B.floorFn = (i) => this._floor(i);
    B.onLand = (i, sp) => this._onLand(i, sp);
    B.flush();

    this._buildAttachments(attachDefs);
    this._buildMounds();
  }

  _plan(def, rng) {
    const { w, d, h, style } = def;
    const lh0 = style === 1 ? 3.8 : 4.6;
    const levels = Math.max(2, Math.round(h / lh0));
    const lh = h / levels;
    const nx = w > 15 ? 3 : w > 7 ? 2 : 1, nz = d > 15 ? 3 : d > 7 ? 2 : 1;
    // tier (setback) footprint factor per level
    const tiers = [];
    const t1 = style === 3 ? Math.floor(levels * 0.62) : style === 0 && def.seed % 2 < 1 ? Math.floor(levels * 0.78) : 999;
    const t2 = style === 3 ? Math.floor(levels * 0.84) : 999;
    for (let L = 0; L < levels; L++) tiers.push(L >= t2 ? 0.5 : L >= t1 ? (style === 3 ? 0.74 : 0.8) : 1);
    const chunks = [];
    for (let L = 0; L < levels; L++) {
      const f = tiers[L];
      const top = L === levels - 1 || tiers[L + 1] !== f;
      const W = w * f, D = d * f, cw = W / nx, cd = D / nz;
      for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
        chunks.push({ L, q: ix + iz * nx, ox: -W / 2 + cw * (ix + 0.5), oz: -D / 2 + cd * (iz + 0.5), cy: lh * (L + 0.5), sx: cw, sy: lh, sz: cd, hw: W / 2, hd: D / 2, top });
      }
    }
    // attachments
    const attach = [];
    const topL = levels - 1, fTop = tiers[topL];
    const topQ = Math.floor(nx / 2) + Math.floor(nz / 2) * nx;
    const topChunk = chunks.find((c) => c.L === topL && c.q === topQ);
    if ((style === 1 || style === 2) && rng() < 0.8) {
      const r = 0.9 + rng() * 0.6, th = 1.6 + rng() * 1.2;
      attach.push({ kind: 'tank', L: topL, q: topQ, x: (rng() - 0.5) * topChunk.sx * 0.4, y: lh / 2 + th / 2 + 0.6, z: (rng() - 0.5) * topChunk.sz * 0.4, sx: r, sy: th, sz: r });
    }
    if (style === 0 || style === 3 || style === 4 || rng() < 0.25) {
      const ah = 3 + rng() * (style === 3 ? 10 : 6);
      attach.push({ kind: 'antenna', L: topL, q: topQ, x: 0, y: lh / 2 + ah / 2, z: 0, sx: 0.18, sy: ah, sz: 0.18 });
    }
    // neon signs on facades, low-mid levels
    const nSigns = style === 0 ? (rng() < 0.4 ? 1 : 0) : 1 + Math.floor(rng() * 2.2);
    for (let k = 0; k < nSigns; k++) {
      const L = Math.min(levels - 1, 1 + Math.floor(rng() * Math.min(3, levels - 1)));
      const face = Math.floor(rng() * 4); // 0:+x 1:-x 2:+z 3:-z
      const ix = face === 0 ? nx - 1 : face === 1 ? 0 : Math.floor(rng() * nx);
      const iz = face === 2 ? nz - 1 : face === 3 ? 0 : Math.floor(rng() * nz);
      const c = chunks.find((cc) => cc.L === L && cc.q === ix + iz * nx);
      const blade = rng() < 0.45;
      const nrm = [[1, 0], [-1, 0], [0, 1], [0, -1]][face];
      const fx = nrm[0] * (c.sx / 2), fz = nrm[1] * (c.sz / 2);
      const along = (rng() - 0.5) * 0.5;
      const cell = Math.floor(rng() * 16);
      const col = NEON_COLORS[Math.floor(rng() * NEON_COLORS.length)];
      if (blade) {
        attach.push({ kind: 'neon', L, q: ix + iz * nx, x: fx + nrm[0] * 1.1 + (nrm[1] ? along * c.sx : 0), y: (rng() - 0.5) * 0.8, z: fz + nrm[1] * 1.1 + (nrm[0] ? along * c.sz : 0),
          sx: 2.2, sy: 2.2, sz: 1, rotY: nrm[0] ? 0 : Math.PI / 2, cell, col, flick: rng() < 0.2 ? 6 + rng() * 10 : 0 });
      } else {
        const sw = 2.6 + rng() * 1.6;
        attach.push({ kind: 'neon', L, q: ix + iz * nx, x: fx + nrm[0] * 0.06 + (nrm[1] ? along * c.sx : 0), y: (rng() - 0.5) * 0.6, z: fz + nrm[1] * 0.06 + (nrm[0] ? along * c.sz : 0),
          sx: sw, sy: sw * 0.55, sz: 1, rotY: face === 0 ? Math.PI / 2 : face === 1 ? -Math.PI / 2 : face === 2 ? 0 : Math.PI, cell, col, flick: rng() < 0.2 ? 6 + rng() * 10 : 0 });
      }
    }
    return { def, levels, nx, nz, chunks, attach };
  }

  _buildAttachments(defs) {
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.6, metalness: 0.7 });
    const tankGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.85, metalness: 0.1 });
    const antGeo = new THREE.BoxGeometry(1, 1, 1);
    const neonGeo = new THREE.PlaneGeometry(1, 1);
    const neonMat = new THREE.MeshBasicMaterial({ map: this.neonTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: true });
    const neonTime = this.uTime;
    neonMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = neonTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aCell; varying float vFlick;\nuniform float uTime;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vMapUv = (uv + vec2(mod(aCell.x, 4.0), 3.0 - floor(aCell.x / 4.0))) * 0.25;
          float fl = aCell.y;
          vFlick = fl > 0.0 ? step(0.25, fract(sin(floor(uTime * fl) * 12.9898 + aCell.x * 78.2) * 43758.5)) : 1.0;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFlick;\nuniform float uTime;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb *= vFlick * (0.85 + 0.15 * sin(uTime * 60.0));`);
    };
    const kinds = { tank: [], antenna: [], neon: [] };
    for (const d of defs) kinds[d.kind].push(d);
    const mk = (geo, mat, list, cast) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      m.count = list.length; m.castShadow = cast; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m); return m;
    };
    this.tanks = mk(tankGeo, tankMat, kinds.tank, true);
    this.antennas = mk(antGeo, metal, kinds.antenna, true);
    this.neon = mk(neonGeo, neonMat, kinds.neon, false);
    const cells = new Float32Array(Math.max(1, kinds.neon.length) * 2);
    kinds.neon.forEach((d, k) => { cells[k * 2] = d.cell; cells[k * 2 + 1] = d.flick; this.neon.setColorAt(k, new THREE.Color(d.col[0], d.col[1], d.col[2])); });
    neonGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    this.neonColors = this.neon.instanceColor ? this.neon.instanceColor.array.slice() : null;
    this.attachments = [];
    for (const [kind, mesh] of [['tank', this.tanks], ['antenna', this.antennas], ['neon', this.neon]]) {
      kinds[kind].forEach((d, k) => {
        const local = new THREE.Matrix4().compose(new THREE.Vector3(d.x, d.y, d.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.rotY || 0), new THREE.Vector3(d.sx, d.sy, d.sz));
        this.attachments.push({ mesh, k, chunk: d.chunk, local, kind, live: true });
      });
    }
    this._writeAttachments(true);
  }

  _writeAttachments(all) {
    const B = this.bodies;
    for (const a of this.attachments) {
      const st = B.state[a.chunk];
      if (!all && st === S_STATIC) continue;
      if (!all && !a.live) continue;
      if (st === S_HIDDEN || (a.kind === 'neon' && (st === S_SETTLED))) {
        _m.makeScale(0, 0, 0); a.live = false;
      } else {
        _p.fromArray(B.pos, a.chunk * 3); _q.fromArray(B.quat, a.chunk * 4);
        _m2.compose(_p, _q, _s); _m.multiplyMatrices(_m2, a.local);
        if (a.kind === 'neon' && st !== S_STATIC && this.rng() < 0.3) _m.scale(_v.set(0.001, 0.001, 0.001));
      }
      a.mesh.setMatrixAt(a.k, _m); a.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _buildMounds() {
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const pos = geo.attributes.position; const col = [];
    const r = mulberry32(5);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      const n = 0.75 + 0.5 * Math.sin(_v.x * 5.1 + _v.z * 3.3) * Math.cos(_v.z * 4.7 - _v.y * 2) + (r() - 0.5) * 0.35;
      _v.multiplyScalar(n); _v.y = Math.max(0, _v.y) * 0.8 - 0.05;
      pos.setXYZ(i, _v.x, _v.y, _v.z);
      const c = 0.25 + r() * 0.35; col.push(c, c * 0.96, c * 0.92);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a6660, roughness: 1, vertexColors: true, flatShading: true });
    this.mounds = new THREE.InstancedMesh(geo, mat, this.buildings.length);
    this.mounds.receiveShadow = true; this.mounds.castShadow = true; this.mounds.frustumCulled = false;
    this.scene.add(this.mounds);
    for (const b of this.buildings) { b.mound = 0; this._writeMound(b); }
  }
  _writeMound(b) {
    const s = b.mound;
    _m.compose(_p.set(b.cx, 0, b.cz), _q.setFromAxisAngle(_ax.set(0, 1, 0), b.seed), _v.set(s > 0 ? b.w * 0.62 + s * 0.3 : 0, s, s > 0 ? b.d * 0.62 + s * 0.3 : 0));
    this.mounds.setMatrixAt(b.idx, _m); this.mounds.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------------------------
  reset() {
    this.bodies.reset();
    this.attrs.aState.array.set(this.origState); this.attrs.aState.needsUpdate = true;
    this.heat.fill(0); this.hot.clear();
    const rng = mulberry32(1234);
    for (let i = 0; i < this.bodies.n; i++) this.hp[i] = 0.7 + rng() * 0.8;
    for (const b of this.buildings) {
      b.intact = b.count; b.power = 1; b.flick = 0; b.collapse = null; b.lastHit = -9; b.lastContact = -9;
      if (b.fire) { b.fire.stop(); b.fire = null; }
      b.mound = 0; b.moundTarget = 0; this._writeMound(b);
    }
    for (const a of this.attachments) a.live = true;
    this._writeAttachments(true);
    if (this.neonColors) { this.neon.instanceColor.array.set(this.neonColors); this.neon.instanceColor.needsUpdate = true; }
  }

  // Support: find floor for column-falling chunks = top of highest intact chunk below in the same column.
  _floor(i) {
    const B = this.bodies;
    if (!(B.flags[i] & F_COLUMN)) return 0;
    const b = this.buildings[this.cBuild[i]], q = this.cQuad[i];
    for (let L = this.cLevel[i] - 1; L >= 0; L--) {
      const j = b.grid[L * b.nq + q];
      if (B.state[j] === S_STATIC) return B.pos[j * 3 + 1] + B.scl[j * 3 + 1] * 0.5;
    }
    return 0;
  }
  _onLand(i, speed) {
    const B = this.bodies;
    if (B.flags[i] & F_COLUMN) {
      const b = this.buildings[this.cBuild[i]], q = this.cQuad[i];
      for (let L = this.cLevel[i] - 1; L >= 0; L--) {
        const j = b.grid[L * b.nq + q];
        if (B.state[j] === S_STATIC) {
          if (speed > 2.5 && this.rng() < (L === 0 ? 0.55 : 0.85)) {
            this._detach(j, _v.set(b.cx, B.pos[j * 3 + 1] + 3, b.cz), 0.6 + speed * 0.08, true);
            this._dust(B.pos[j * 3], Math.max(0.5, B.pos[j * 3 + 1] - 1), B.pos[j * 3 + 2], 1.6);
            this._checkSupport(b);
            return true;
          }
          break;
        }
      }
      B.flags[i] &= ~F_COLUMN;
    }
    if (speed > 6 && this.fxBudget > 0) { this.fxBudget--; this._dust(B.pos[i * 3], 0.3, B.pos[i * 3 + 2], 0.9 + B.scl[i * 3 + 1] * 0.2); }
    return false;
  }

  _dust(x, y, z, s) { this.fx.dust(_p.set(x, y, z), s); }

  // knock chunk i off, flying away from `from`
  _detach(i, from, force, crushed = false) {
    const B = this.bodies;
    if (B.state[i] !== S_STATIC && B.state[i] !== S_ATTACHED) return;
    const x = B.pos[i * 3], y = B.pos[i * 3 + 1], z = B.pos[i * 3 + 2];
    let dx = x - from.x, dy = y - from.y, dz = z - from.z;
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const r = this.rng;
    const sp = (crushed ? 2 : 4) + force * (4 + r() * 5);
    const ok = B.launch(i, dx * sp + (r() - 0.5) * 3, Math.max(dy, 0.1) * sp * 0.6 + 2 + r() * 4, dz * sp + (r() - 0.5) * 3,
      (r() - 0.5) * 5, (r() - 0.5) * 5, (r() - 0.5) * 5);
    if (!ok) { B.hide(i); this._dust(x, y, z, 1.2); }
    this.attrs.aState.setX(i, 0); this.attrs.aState.needsUpdate = true;
    const b = this.buildings[this.cBuild[i]]; b.intact--;
    if (this.fxBudget > 0) {
      this.fxBudget--;
      _p.set(x, y, z);
      this.fx.shards?.(_p, _v.set(dx, dy, dz), 10);
      if (r() < 0.5) this.fx.dust(_p, 1.1);
      if (r() < 0.3) this.fx.sparks(_p, 0xffaa55, 10, 12);
    }
  }
  _drop(i) {
    const B = this.bodies, r = this.rng;
    if (B.state[i] !== S_STATIC) return;
    if (!B.launch(i, (r() - 0.5) * 1.2, -0.5, (r() - 0.5) * 1.2, (r() - 0.5) * 0.4, (r() - 0.5) * 0.2, (r() - 0.5) * 0.4)) { B.hide(i); }
    B.flags[i] |= F_COLUMN;
    this.attrs.aState.setX(i, 0); this.attrs.aState.needsUpdate = true;
    this.buildings[this.cBuild[i]].intact--;
  }
  _checkSupport(b) {
    const B = this.bodies;
    for (let q = 0; q < b.nq; q++) {
      let broken = false;
      for (let L = 0; L < b.levels; L++) {
        const i = b.grid[L * b.nq + q];
        if (!broken) { if (B.state[i] !== S_STATIC) broken = true; }
        else if (B.state[i] === S_STATIC) this._drop(i);
      }
    }
    if (b.nq > 1) {
      for (let L = 0; L < b.levels - 1; L++) {
        let c = 0;
        for (let q = 0; q < b.nq; q++) if (B.state[b.grid[L * b.nq + q]] === S_STATIC) c++;
        if (c <= Math.floor(b.nq * 0.34)) {
          for (let L2 = L + 1; L2 < b.levels; L2++) for (let q = 0; q < b.nq; q++) this._drop(b.grid[L2 * b.nq + q]);
          break;
        }
      }
    }
  }

  _hitBuilding(b, force) {
    b.lastHit = this.time;
    b.power = Math.max(0, b.power - 0.15 * force);
    b.flick = 0.5 + force * 0.25;
  }

  // Collapse the entire tower (sinks + tilts into a dust wave)
  collapseBuilding(b, from) {
    if (b.collapse) return;
    const B = this.bodies;
    let dx = b.cx - from.x, dz = b.cz - from.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    b.collapse = { t: 0, dir: new THREE.Vector3(dx, 0, dz), axis: new THREE.Vector3(dz, 0, -dx), tilt: 0.12 + this.rng() * 0.2, dustT: 0, left: 0 };
    let left = 0;
    for (let k = 0; k < b.count; k++) {
      const i = b.first + k;
      if (B.state[i] === S_STATIC) { B.state[i] = S_ATTACHED; left++; }
    }
    b.collapse.left = left;
    b.power = 0; b.flick = 1.2;
    const base = _p.set(b.cx, 0.5, b.cz);
    this.fx.dustWave?.(base, Math.max(b.w, b.d) * 2.2 + b.h * 0.6, 1.6);
    this.fx.shockwave(base, Math.max(b.w, b.d) * 1.6, 0xffc890);
  }

  _updateCollapse(b, dt) {
    const c = b.collapse, B = this.bodies, r = this.rng;
    c.t += dt;
    const drop = 0.5 * 5.5 * c.t * c.t;
    const tilt = c.tilt * Math.min(1, c.t / 3) * Math.min(1, c.t / 3);
    _q.setFromAxisAngle(c.axis, tilt);
    const px = b.cx + c.dir.x * b.w * 0.5, pz = b.cz + c.dir.z * b.d * 0.5;
    let left = 0;
    for (let k = 0; k < b.count; k++) {
      const i = b.first + k;
      if (B.state[i] !== S_ATTACHED) continue;
      _v.set(B.oPos[i * 3] - px, B.oPos[i * 3 + 1], B.oPos[i * 3 + 2] - pz).applyQuaternion(_q);
      const y = _v.y - drop, hy = B.scl[i * 3 + 1] * 0.5;
      B.pos[i * 3] = _v.x + px; B.pos[i * 3 + 1] = y; B.pos[i * 3 + 2] = _v.z + pz;
      _q.toArray(B.quat, i * 4);
      if (y + hy < 0.1) { B.state[i] = S_HIDDEN; B.write(i); b.intact--; continue; }
      if (y - hy < 0.6 && r() < dt * 2.5 && B.canLaunch()) {
        B.state[i] = S_STATIC; this._detach(i, _v.set(b.cx, y + 2, b.cz), 0.8);
        continue;
      }
      if (y > b.h * 0.4 && r() < dt * 0.25) { B.state[i] = S_STATIC; this._detach(i, _v.set(b.cx, y - 3, b.cz), 0.5); continue; }
      B.write(i); left++;
    }
    c.dustT -= dt;
    if (c.dustT <= 0 && left > 0) {
      c.dustT = 0.07;
      const a = r() * Math.PI * 2, rr = Math.max(b.w, b.d) * 0.6;
      this._dust(b.cx + Math.cos(a) * rr, 0.5, b.cz + Math.sin(a) * rr, 2.6 + r() * 1.5);
      if (r() < 0.35) this._dust(b.cx + (r() - 0.5) * b.w, Math.max(1, b.h - drop) * r(), b.cz + (r() - 0.5) * b.d, 2.2);
    }
    this.attrs.aState.needsUpdate = true;
    if (left === 0) { b.collapse = null; this._maybeFire(b, true); }
  }

  _maybeFire(b, force) {
    if (b.fire || !this.fx.fire) return;
    const destroyed = 1 - b.intact / b.count;
    if (force || destroyed > 0.35) {
      if (this.activeFires >= 8) return;
      const r = this.rng;
      b.fire = this.fx.fire(new THREE.Vector3(b.cx + (r() - 0.5) * b.w * 0.5, 0.5 + b.mound * 0.6, b.cz + (r() - 0.5) * b.d * 0.5), 1.2 + destroyed * 1.2);
    }
  }
  get activeFires() { let n = 0; for (const b of this.buildings) if (b.fire) n++; return n; }

  // ---------------------------------------------------------------------------------------------
  impact(p, radius, force, opts = {}) {
    const B = this.bodies;
    let hitB = 0;
    const heatAdd = opts.heat ?? force * 0.12;
    for (const b of this.buildings) {
      if (b.intact <= 0 || b.collapse) continue;
      const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX), dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ), dy = Math.max(0 - p.y, 0, p.y - b.h);
      const dist = Math.hypot(dx, dy, dz);
      if (dist > radius) continue;
      hitB++;
      this._hitBuilding(b, force);
      if (force > 3 && dist < radius * 0.75 && b.h > 12) { this.collapseBuilding(b, p); continue; }
      for (let k = 0; k < b.count; k++) {
        const i = b.first + k;
        if (B.state[i] !== S_STATIC) continue;
        const cx = B.pos[i * 3], cy = B.pos[i * 3 + 1], cz = B.pos[i * 3 + 2];
        const hx = B.scl[i * 3] / 2, hy = B.scl[i * 3 + 1] / 2, hz = B.scl[i * 3 + 2] / 2;
        const ex = Math.max(cx - hx - p.x, 0, p.x - cx - hx), ey = Math.max(cy - hy - p.y, 0, p.y - cy - hy), ez = Math.max(cz - hz - p.z, 0, p.z - cz - hz);
        const d = Math.hypot(ex, ey, ez);
        if (d > radius) continue;
        const fall = 1 - d / radius;
        if (heatAdd > 0) { this.heat[i] = Math.min(1, this.heat[i] + heatAdd * fall); this.hot.add(i); }
        this.hp[i] -= force * fall * 1.3;
        if (this.hp[i] <= 0) this._detach(i, p, force);
      }
      this._checkSupport(b);
      this._maybeFire(b, false);
    }
    return hitB;
  }

  fighterContact(p, radius, vel) {
    const sp = Math.hypot(vel.x, vel.z), s = Math.max(sp, -vel.y);
    if (s < 2.5) return false;
    const B = this.bodies;
    let hit = false;
    const top = p.y + 13;
    for (const b of this.buildings) {
      if (b.intact <= 0 || b.collapse) continue;
      const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX), dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
      if (dx * dx + dz * dz > radius * radius) continue;
      hit = true;
      if (this.time - b.lastContact < 0.1) continue;
      b.lastContact = this.time;
      const force = Math.min(4, s / 9);
      this._hitBuilding(b, force * 0.6);
      let n = 0;
      for (let k = 0; k < b.count; k++) {
        const i = b.first + k;
        if (B.state[i] !== S_STATIC) continue;
        const cx = B.pos[i * 3], cy = B.pos[i * 3 + 1], cz = B.pos[i * 3 + 2];
        const hx = B.scl[i * 3] / 2, hy = B.scl[i * 3 + 1] / 2, hz = B.scl[i * 3 + 2] / 2;
        if (cy - hy > top || cy + hy < p.y) continue;
        const ex = Math.max(cx - hx - p.x, 0, p.x - cx - hx), ez = Math.max(cz - hz - p.z, 0, p.z - cz - hz);
        if (ex * ex + ez * ez > radius * radius) continue;
        this.hp[i] -= force * 1.5;
        if (this.hp[i] > 0) continue;
        const r = this.rng;
        if (B.launch(i, vel.x * 0.9 + (cx - p.x) * 0.6 + (r() - 0.5) * 3, 2 + r() * 5 + Math.max(0, vel.y) * 0.5, vel.z * 0.9 + (cz - p.z) * 0.6 + (r() - 0.5) * 3,
          (r() - 0.5) * 4, (r() - 0.5) * 4, (r() - 0.5) * 4)) {
          this.attrs.aState.setX(i, 0); this.attrs.aState.needsUpdate = true; b.intact--; n++;
          if (this.fxBudget > 0) { this.fxBudget--; _p.set(cx, cy, cz); this.fx.shards?.(_p, _v.set(vel.x, 2, vel.z).normalize(), 8); }
        } else { B.hide(i); b.intact--; this.attrs.aState.setX(i, 0); this.attrs.aState.needsUpdate = true; }
      }
      if (n > 0) {
        this._dust(p.x + vel.x * 0.1, 1, p.z + vel.z * 0.1, 1.5 + force * 0.5);
        this._checkSupport(b); this._maybeFire(b, false);
      }
    }
    return hit;
  }

  // ---------------------------------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    this.fxBudget = 8;
    const B = this.bodies;
    B.step(dt);
    for (const b of this.buildings) {
      if (b.collapse) this._updateCollapse(b, dt);
      // window power flicker
      if (b.flick > 0) {
        b.flick -= dt;
        const on = b.flick > 0 ? (this.rng() < 0.55 ? b.power : b.power * 0.15) : b.power;
        const st = this.attrs.aState;
        for (let k = 0; k < b.count; k++) {
          const i = b.first + k;
          if (B.state[i] === S_STATIC || B.state[i] === S_ATTACHED) st.array[i * 4] = on;
        }
        st.needsUpdate = true;
      }
      const target = Math.min(b.h * 0.22, 7) * (1 - b.intact / b.count);
      if (Math.abs(b.mound - target) > 0.01) { b.mound += (target - b.mound) * Math.min(1, dt * 0.8); this._writeMound(b); }
    }
    if (this.hot.size) {
      const st = this.attrs.aState;
      for (const i of this.hot) {
        this.heat[i] = Math.max(0, this.heat[i] - dt * 0.07);
        st.array[i * 4 + 1] = this.heat[i];
        if (this.heat[i] <= 0) this.hot.delete(i);
      }
      st.needsUpdate = true;
    }
    this._writeAttachments(false);
    B.flush();
  }

  // Occupied footprints (for prop placement / queries)
  nearestBuildingDist(x, z) {
    let best = Infinity;
    for (const b of this.buildings) {
      if (b.intact <= 0) continue;
      const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
  }
}
