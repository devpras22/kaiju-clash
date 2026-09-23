// OWNER: models agent. Procedural geometry toolkit for the monster models.
// Everything is authored in "bind space" (model local space: +Z forward, +Y up, feet at y=0, own-left = +X).
// A Builder collects swept generalized cylinders / plates / blobs into per-material buffers, computes
// smooth skin weights against the rig's bone segments and emits BufferGeometries ready for SkinnedMesh.
import * as THREE from 'three';

// ---------------------------------------------------------------- noise
const PERM = new Uint8Array(512);
{
  let s = 1337;
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const G3 = [1,1,0,-1,1,0,1,-1,0,-1,-1,0,1,0,1,-1,0,1,1,0,-1,-1,0,-1,0,1,1,0,-1,1,0,1,-1,0,-1,-1];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y, z) { const g = (h % 12) * 3; return G3[g] * x + G3[g + 1] * y + G3[g + 2] * z; }
/** Classic improved Perlin noise, range ≈ [-1, 1]. */
export function noise3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z;
  const xi = X & 255, yi = Y & 255, zi = Z & 255;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[xi] + yi, AA = PERM[A] + zi, AB = PERM[A + 1] + zi;
  const B = PERM[xi + 1] + yi, BA = PERM[B] + zi, BB = PERM[B + 1] + zi;
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u), l(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
    l(l(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u), l(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v),
    w) * 1.1;
}
export function fbm3(x, y, z, oct = 4, lac = 2.03, gain = 0.5) {
  let a = 0, amp = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { a += noise3(x * f, y * f, z * f) * amp; n += amp; amp *= gain; f *= lac; }
  return a / n;
}
/** Ridged multifractal (0..1, sharp crests) — good for craggy, cracked hide. */
export function ridged3(x, y, z, oct = 4) {
  let a = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { const n = 1 - Math.abs(noise3(x * f, y * f, z * f)); a += n * n * amp; amp *= 0.5; f *= 2.1; }
  return a;
}
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

// Catmull-Rom on scalars/arrays (uniform) — t in [0, n-1]
function crScalar(vals, t) {
  const n = vals.length;
  const i = Math.min(Math.max(Math.floor(t), 0), n - 2);
  const f = t - i;
  const p0 = vals[Math.max(i - 1, 0)], p1 = vals[i], p2 = vals[i + 1], p3 = vals[Math.min(i + 2, n - 1)];
  const f2 = f * f, f3 = f2 * f;
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
}

// ---------------------------------------------------------------- rig description
/**
 * bones: [{ name, parent, pos:[x,y,z], tip?:[x,y,z] }] in bind space (identity rotations in bind pose).
 */
export class RigDef {
  constructor(bones) {
    this.bones = bones;
    this.index = {};
    bones.forEach((b, i) => { this.index[b.name] = i; });
    // segments for skin weighting: head→(tip | average child pos | head)
    this.seg = bones.map((b) => {
      const kids = bones.filter((c) => c.parent === b.name);
      let tip = b.tip;
      if (!tip) {
        if (kids.length === 1) tip = kids[0].pos;
        else if (kids.length > 1 && b.tipChild) tip = bones.find((c) => c.name === b.tipChild).pos;
        else tip = b.pos;
      }
      return { a: new THREE.Vector3(...b.pos), b: new THREE.Vector3(...tip) };
    });
  }
  id(name) { const i = this.index[name]; if (i === undefined) throw new Error('bone ' + name); return i; }
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
function segDist(p, s) {
  _v.subVectors(s.b, s.a); const L2 = _v.lengthSq();
  let t = L2 > 1e-8 ? _w.subVectors(p, s.a).dot(_v) / L2 : 0;
  t = clamp(t);
  _w.copy(s.a).addScaledVector(_v, t);
  return p.distanceTo(_w);
}

// ---------------------------------------------------------------- builder
export class Builder {
  constructor(rig) { this.rig = rig; this.groups = {}; }

  group(key, attrs = []) {
    if (!this.groups[key]) this.groups[key] = { pos: [], nor: [], uv: [], col: [], si: [], sw: [], idx: [], attrs, extra: Object.fromEntries(attrs.map((a) => [a, []])) };
    return this.groups[key];
  }

  /** Skin weights for a vertex against candidate bones (ids). */
  _weights(p, cands, power, bias) {
    if (cands.length === 1) return [[cands[0], 0, 0, 0], [1, 0, 0, 0]];
    const w = [];
    for (let k = 0; k < cands.length; k++) {
      const d = segDist(p, this.rig.seg[cands[k]]) + 0.05;
      w.push([cands[k], Math.pow(1 / d, power) * (bias ? bias[k] : 1)]);
    }
    w.sort((a, b) => b[1] - a[1]);
    const top = w.slice(0, 4); let s = 0; for (const e of top) s += e[1];
    const idx = [0, 0, 0, 0], wt = [0, 0, 0, 0];
    top.forEach((e, i) => { idx[i] = e[0]; wt[i] = e[1] / s; });
    return [idx, wt];
  }

  /**
   * Swept generalized cylinder.
   * o.pts: [[x,y,z], ...] control points (Catmull-Rom); o.r: [[rx, ryUp, ryDown?], ...] per control point
   * o.segs, o.radial, o.up (dorsal hint), o.capStart/o.capEnd (ring count, 0 = open) o.capLen (dome elongation)
   * o.shape(t, a, P) → radius multiplier (a: 0 = side(+S), PI/2 = dorsal) ; o.disp(P, t, a) → displacement
   * o.color(P, t, a, N) → [r,g,b] ; o.bones: names (smooth skin) or o.bone: rigid ; o.power
   * o.uv: texture repeats per world unit ; o.attr: { name: (P,t,a)=>v }
   */
  sweep(key, o) {
    const G = this.group(key, o.attrList);
    const rig = this.rig;
    const pts = o.pts.map((p) => new THREE.Vector3(...p));
    const n = pts.length;
    const radial = o.radial || 24, segs = o.segs || 24;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    // dense sample → arc length table (curve param u uses its own uniform-in-t mapping over pts)
    const DN = 200; const dense = []; const lens = [0];
    for (let i = 0; i <= DN; i++) { dense.push(curve.getPoint(i / DN)); if (i) lens.push(lens[i - 1] + dense[i].distanceTo(dense[i - 1])); }
    const total = lens[DN];
    const tAtS = (s) => { // s 0..total → curve t
      let lo = 0, hi = DN; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (lens[m] < s) lo = m; else hi = m; }
      const f = (s - lens[lo]) / Math.max(lens[hi] - lens[lo], 1e-9); return (lo + f) / DN;
    };
    const rx = o.r.map((r) => r[0]), ru = o.r.map((r) => r[1] ?? r[0]), rd = o.r.map((r) => r[2] ?? r[1] ?? r[0]);
    // CatmullRomCurve3.getPoint(t) spans control points uniformly in t: segment index = t*(n-1)
    const radAt = (ct) => { const k = ct * (n - 1); return [Math.max(crScalar(rx, k), 0), Math.max(crScalar(ru, k), 0), Math.max(crScalar(rd, k), 0)]; };

    // ring list: {C, T, S, D, rx, ru, rd, t, s}
    const rings = [];
    let D = new THREE.Vector3(...(o.up || [0, 1, 0]));
    let prevT = null;
    for (let i = 0; i <= segs; i++) {
      const s = (i / segs) * total; const ct = tAtS(s);
      const C = curve.getPoint(ct);
      const T = curve.getTangent(Math.min(Math.max(ct, 1e-4), 1 - 1e-4)).normalize();
      if (prevT) { // parallel transport
        const q = new THREE.Quaternion().setFromUnitVectors(prevT, T); D.applyQuaternion(q);
      }
      D.addScaledVector(T, -D.dot(T)).normalize();
      prevT = T.clone();
      const S = new THREE.Vector3().crossVectors(T, D).normalize();
      const [a, b, c] = radAt(ct);
      rings.push({ C, T, S, D: D.clone(), rx: a, ru: b, rd: c, t: i / segs, s });
    }
    // caps: dome rings beyond the ends
    const capLen = o.capLen ?? 1;
    const addCap = (ring, dir, count, atStart) => {
      const out = [];
      for (let k = 1; k <= count; k++) {
        const ph = (k / count) * Math.PI / 2;
        const f = Math.cos(ph);
        const ext = Math.sin(ph) * Math.max(ring.rx, ring.ru, ring.rd) * capLen;
        const C = ring.C.clone().addScaledVector(ring.T, dir * ext);
        out.push({ C, T: ring.T, S: ring.S, D: ring.D, rx: ring.rx * f, ru: ring.ru * f, rd: ring.rd * f, t: ring.t, s: ring.s + dir * ext, pole: k === count });
      }
      return atStart ? out.reverse() : out;
    };
    let all = rings;
    if (o.capStart) all = addCap(rings[0], -1, o.capStart, true).concat(all);
    if (o.capEnd) all = all.concat(addCap(rings[rings.length - 1], 1, o.capEnd, false));

    const R = all.length, J = radial;
    const P = new Float32Array(R * J * 3);
    const RD = new Float32Array(R * J * 3); // radial dirs
    const tmp = new THREE.Vector3(), nrm = new THREE.Vector3();
    const avgCirc = rings.reduce((acc, r) => acc + Math.PI * (r.rx + (r.ru + r.rd) / 2), 0) / rings.length;
    const uvScale = o.uv ?? 0.5;
    const uRep = Math.max(1, Math.round(avgCirc * uvScale));
    const a0 = o.seamAngle ?? -Math.PI / 2; // seam on the ventral side by default
    for (let i = 0; i < R; i++) {
      const rg = all[i];
      for (let j = 0; j < J; j++) {
        const a = a0 + (j / J) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const ry = sa > 0 ? rg.ru : rg.rd;
        let m = o.shape ? o.shape(rg.t, a, rg) : 1;
        tmp.copy(rg.C).addScaledVector(rg.S, ca * rg.rx * m).addScaledVector(rg.D, sa * ry * m);
        // ellipse normal as displacement direction
        nrm.copy(rg.S).multiplyScalar(ca / Math.max(rg.rx, 1e-3)).addScaledVector(rg.D, sa / Math.max(ry, 1e-3));
        if (rg.pole || nrm.lengthSq() < 1e-8) nrm.copy(rg.T).multiplyScalar(Math.sign(rg.s - rings[0].s - total / 2) || 1);
        nrm.normalize();
        if (o.disp) { const d = o.disp(tmp, rg.t, a, rg); tmp.addScaledVector(nrm, d); }
        const k = (i * J + j) * 3;
        P[k] = tmp.x; P[k + 1] = tmp.y; P[k + 2] = tmp.z;
        RD[k] = nrm.x; RD[k + 1] = nrm.y; RD[k + 2] = nrm.z;
      }
    }
    // normals by finite differences over the grid (seam-safe via wrap)
    const N = new Float32Array(R * J * 3);
    const tu = new THREE.Vector3(), tv = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3();
    const get = (i, j, out) => { const k = (i * J + ((j + J) % J)) * 3; return out.set(P[k], P[k + 1], P[k + 2]); };
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < J; j++) {
        get(i, j + 1, pa); get(i, j - 1, pb); tu.subVectors(pa, pb);
        get(Math.min(i + 1, R - 1), j, pa); get(Math.max(i - 1, 0), j, pb); tv.subVectors(pa, pb);
        nrm.crossVectors(tu, tv);
        const k = (i * J + j) * 3;
        if (nrm.lengthSq() < 1e-10) nrm.set(RD[k], RD[k + 1], RD[k + 2]);
        nrm.normalize();
        if (nrm.x * RD[k] + nrm.y * RD[k + 1] + nrm.z * RD[k + 2] < 0) nrm.negate();
        N[k] = nrm.x; N[k + 1] = nrm.y; N[k + 2] = nrm.z;
      }
    }
    // pole normals: average of neighbour ring (avoids pinching artifacts)
    for (let i = 0; i < R; i++) {
      if (!all[i].pole) continue;
      const ni = i === 0 ? 1 : i - 1; pa.set(0, 0, 0);
      for (let j = 0; j < J; j++) { const k = (ni * J + j) * 3; pa.x += N[k]; pa.y += N[k + 1]; pa.z += N[k + 2]; }
      pa.normalize();
      for (let j = 0; j < J; j++) { const k = (i * J + j) * 3; N[k] = pa.x; N[k + 1] = pa.y; N[k + 2] = pa.z; }
    }

    const cands = o.bone ? [rig.id(o.bone)] : (o.bones || []).map((b) => rig.id(b));
    const power = o.power ?? 6;
    const base = G.pos.length / 3;
    const pv = new THREE.Vector3();
    for (let i = 0; i < R; i++) {
      const rg = all[i];
      for (let jj = 0; jj <= J; jj++) {
        const j = jj % J; const k = (i * J + j) * 3;
        pv.set(P[k], P[k + 1], P[k + 2]);
        G.pos.push(pv.x, pv.y, pv.z);
        G.nor.push(N[k], N[k + 1], N[k + 2]);
        G.uv.push((jj / J) * uRep, rg.s * uvScale);
        const a = a0 + (jj / J) * Math.PI * 2;
        nrm.set(N[k], N[k + 1], N[k + 2]);
        const c = o.color ? o.color(pv, rg.t, a, nrm) : [1, 1, 1];
        G.col.push(c[0], c[1], c[2]);
        const [si, sw] = this._weights(pv, cands, power, o.bias);
        G.si.push(...si); G.sw.push(...sw);
        for (const an of G.attrs) G.extra[an].push(o.attr && o.attr[an] ? o.attr[an](pv, rg.t, a) : (o.attrDefault?.[an] ?? 0));
      }
    }
    const W = J + 1;
    for (let i = 0; i < R - 1; i++) {
      for (let j = 0; j < J; j++) {
        const a = base + i * W + j, b = a + 1, c = a + W, d = c + 1;
        G.idx.push(a, c, b, b, c, d);
      }
    }
    this._fixWinding(G, base, R * W);
    return { rings, total };
  }

  _fixWinding(G, base, count) {
    // choose the winding whose face normal agrees with vertex normals (checks a few triangles)
    let agree = 0;
    const start = G.idx.length - (Math.floor((count / 1)) > 0 ? 0 : 0);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
    const idx = G.idx; const firstTri = this._triStart ?? 0;
    for (let t = firstTri; t < idx.length; t += 3 * 7) {
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
      a.fromArray(G.pos, i0 * 3); b.fromArray(G.pos, i1 * 3); c.fromArray(G.pos, i2 * 3);
      fn.subVectors(b, a).cross(c.sub(a));
      if (fn.lengthSq() < 1e-12) continue;
      const nx = G.nor[i0 * 3], ny = G.nor[i0 * 3 + 1], nz = G.nor[i0 * 3 + 2];
      agree += fn.x * nx + fn.y * ny + fn.z * nz > 0 ? 1 : -1;
    }
    if (agree < 0) for (let t = firstTri; t < idx.length; t += 3) { const tmpi = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmpi; }
    this._triStart = idx.length;
    void start; void base;
  }

  /** Ellipsoid blob (rigid or smooth skinned) — axis from a to b, radii rx (side) ry (up). */
  blob(key, o) {
    const a = new THREE.Vector3(...o.a), b = new THREE.Vector3(...o.b);
    const mid = a.clone().lerp(b, 0.5);
    return this.sweep(key, { ...o, pts: [o.a, mid.toArray(), o.b], r: [[o.rx * 0.999, o.ry], [o.rx, o.ry], [o.rx * 0.999, o.ry]],
      capStart: o.cap ?? 6, capEnd: o.cap ?? 6, capLen: o.capLen ?? 1, segs: o.segs ?? 4 });
  }

  /**
   * Jagged dorsal plate (star-shaped fan, lens-thick). base: [x,y,z]; axis vectors built from `up` & `back`.
   * outline: [[u, v], ...] in plate plane (u along back→front, v up), centre `c` inside the shape.
   */
  plate(key, o) {
    const G = this.group(key, o.attrList);
    const base = new THREE.Vector3(...o.base);
    const U = new THREE.Vector3(...o.uDir).normalize(); // along plate (front)
    const V = new THREE.Vector3(...o.vDir).normalize(); // up the plate
    const Nn = new THREE.Vector3().crossVectors(U, V).normalize(); // plate normal
    const outline = o.outline; const m = outline.length;
    const cands = [this.rig.id(o.bone)];
    const thick = o.thick ?? 0.25;
    const rings = o.rings ?? 3; // concentric rings from centre to edge
    const c = o.center || [0, 0.35];
    const verts = []; // [pos, normal, edge]
    const P = (u, v, side, e) => {
      const p = base.clone().addScaledVector(U, u).addScaledVector(V, v);
      const th = thick * Math.pow(1 - e, 0.7) * (0.8 + 0.4 * (1 - clamp(v / (o.height || 1))));
      const nz = (o.noise ? o.noise(p) : 0);
      p.addScaledVector(Nn, side * (th + nz * (1 - e) * 0.5));
      return p;
    };
    const baseIdx = G.pos.length / 3;
    // build 2 faces (side = +1, -1); ring 0 = centre point
    for (const side of [1, -1]) {
      for (let r = 0; r <= rings; r++) {
        const e = r / rings;
        const cnt = r === 0 ? 1 : m;
        for (let j = 0; j < cnt; j++) {
          const u = r === 0 ? c[0] : lerp(c[0], outline[j][0], e);
          const v = r === 0 ? c[1] : lerp(c[1], outline[j][1], e);
          const p = P(u, v, side, e);
          verts.push({ p, side, e, v });
        }
      }
    }
    const perFace = 1 + rings * m;
    // positions
    for (const vx of verts) {
      G.pos.push(vx.p.x, vx.p.y, vx.p.z);
      G.nor.push(0, 0, 0);
      G.uv.push(0, 0);
      const cc = o.color ? o.color(vx.p, vx.v, vx.e) : [1, 1, 1];
      G.col.push(cc[0], cc[1], cc[2]);
      G.si.push(cands[0], 0, 0, 0); G.sw.push(1, 0, 0, 0);
      for (const an of G.attrs) G.extra[an].push(o.attr && o.attr[an] ? o.attr[an](vx.p, vx.v, vx.e) : 0);
    }
    const idxOf = (face, r, j) => baseIdx + face * perFace + (r === 0 ? 0 : 1 + (r - 1) * m + ((j + m) % m));
    const tris = [];
    for (let face = 0; face < 2; face++) {
      for (let r = 0; r < rings; r++) {
        for (let j = 0; j < m; j++) {
          if (r === 0) tris.push([idxOf(face, 0, 0), idxOf(face, 1, j), idxOf(face, 1, j + 1)]);
          else {
            const a = idxOf(face, r, j), b = idxOf(face, r, j + 1), cc = idxOf(face, r + 1, j), d = idxOf(face, r + 1, j + 1);
            tris.push([a, cc, b], [b, cc, d]);
          }
        }
      }
    }
    // stitch outer edges of both faces (thin rim)
    for (let j = 0; j < m; j++) {
      const a = idxOf(0, rings, j), b = idxOf(0, rings, j + 1), cc = idxOf(1, rings, j), d = idxOf(1, rings, j + 1);
      tris.push([a, b, cc], [b, d, cc]);
    }
    // orient by face side and accumulate normals
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), F = new THREE.Vector3(), ctr = new THREE.Vector3();
    for (const t of tris) {
      A.fromArray(G.pos, t[0] * 3); B.fromArray(G.pos, t[1] * 3); C.fromArray(G.pos, t[2] * 3);
      F.subVectors(B, A).cross(ctr.subVectors(C, A));
      // outward reference: from plate mid-plane
      ctr.copy(A).add(B).add(C).multiplyScalar(1 / 3);
      const rel = ctr.sub(base);
      const off = rel.dot(Nn);
      const outward = Math.abs(off) > 1e-4 ? Nn.clone().multiplyScalar(Math.sign(off)) : rel.addScaledVector(Nn, -off).addScaledVector(V, -0.0).normalize();
      if (F.dot(outward) < 0) { const x = t[1]; t[1] = t[2]; t[2] = x; F.negate(); }
      for (const i of t) { G.nor[i * 3] += F.x; G.nor[i * 3 + 1] += F.y; G.nor[i * 3 + 2] += F.z; }
      G.idx.push(t[0], t[1], t[2]);
    }
    for (let i = baseIdx; i < G.pos.length / 3; i++) {
      F.fromArray(G.nor, i * 3).normalize(); G.nor[i * 3] = F.x; G.nor[i * 3 + 1] = F.y; G.nor[i * 3 + 2] = F.z;
    }
    this._triStart = G.idx.length;
  }

  /** Mirror everything added to `key` since `mark` across X, remapping bones via fn(name). */
  mark(key) { const G = this.group(key); return { v: G.pos.length / 3, i: G.idx.length }; }
  mirror(key, mk, boneMap) {
    const G = this.group(key); const rig = this.rig;
    const v0 = mk.v, v1 = G.pos.length / 3, i0 = mk.i, i1 = G.idx.length;
    const remap = rig.bones.map((b, i) => { const nm = boneMap(b.name); return nm === b.name ? i : rig.id(nm); });
    for (let v = v0; v < v1; v++) {
      G.pos.push(-G.pos[v * 3], G.pos[v * 3 + 1], G.pos[v * 3 + 2]);
      G.nor.push(-G.nor[v * 3], G.nor[v * 3 + 1], G.nor[v * 3 + 2]);
      G.uv.push(G.uv[v * 2] + 0.37, G.uv[v * 2 + 1] + 0.53);
      G.col.push(G.col[v * 3], G.col[v * 3 + 1], G.col[v * 3 + 2]);
      for (let k = 0; k < 4; k++) G.si.push(remap[G.si[v * 4 + k]]);
      for (let k = 0; k < 4; k++) G.sw.push(G.sw[v * 4 + k]);
      for (const an of G.attrs) G.extra[an].push(G.extra[an][v]);
    }
    const off = v1 - v0;
    for (let i = i0; i < i1; i += 3) G.idx.push(G.idx[i] + off, G.idx[i + 2] + off, G.idx[i + 1] + off);
    this._triStart = G.idx.length;
  }

  build() {
    const out = {};
    for (const [key, G] of Object.entries(this.groups)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(G.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(G.col, 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(G.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(G.sw, 4));
      for (const an of G.attrs) g.setAttribute(an, new THREE.Float32BufferAttribute(G.extra[an], 1));
      g.setIndex(G.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(G.idx, 1) : new THREE.Uint16BufferAttribute(G.idx, 1));
      g.computeBoundingSphere();
      out[key] = g;
    }
    return out;
  }
}
