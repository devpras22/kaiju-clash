// OWNER: models agent. GORVOK ('saurian') — Godzilla-style kaiju. Procedural skinned mesh + procedural animation.
// Rig (THREE.Skeleton, identity bind rotations): hips > spine > chest > neck > head > jaw ; hips > tail0..tail7 ;
//   hips > thighL/R > shinL/R > footL/R ; chest > clavL/R > armL/R > foreL/R > handL/R
import * as THREE from 'three';
import { Builder, RigDef, fbm3, ridged3, noise3, smooth, clamp, hash1, lerp } from './geometry.js';
import { MonsterBase, patchMaterial, ease, ramp, bump, gait, clamp01 } from './rig.js';
import { getHideTextures, getBoneTextures } from './textures.js';

const TAIL = [
  [0, 6.9, -2.4], [0, 6.2, -4.6], [0, 5.2, -6.8], [0, 4.1, -9.0], [0, 3.0, -11.1], [0, 2.1, -13.1], [0, 1.4, -15.0], [0, 0.9, -16.8],
];
function boneDefs() {
  const b = [
    { name: 'hips', parent: null, pos: [0, 7.2, -0.6], tip: [0, 8.9, 0.1] },
    { name: 'spine', parent: 'hips', pos: [0, 8.9, 0.1] },
    { name: 'chest', parent: 'spine', pos: [0, 10.4, 0.8], tipChild: 'neck' },
    { name: 'neck', parent: 'chest', pos: [0, 11.7, 1.5] },
    { name: 'head', parent: 'neck', pos: [0, 12.8, 2.3], tip: [0, 12.8, 5.3] },
    { name: 'jaw', parent: 'head', pos: [0, 12.4, 2.3], tip: [0, 12.1, 5.1] },
  ];
  TAIL.forEach((p, i) => b.push({ name: 'tail' + i, parent: i ? 'tail' + (i - 1) : 'hips', pos: p, tip: i === 7 ? [0, 0.7, -18.6] : undefined }));
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R'; const x = (v) => v * s;
    b.push(
      { name: 'thigh' + S, parent: 'hips', pos: [x(1.95), 6.8, -0.5] },
      { name: 'shin' + S, parent: 'thigh' + S, pos: [x(2.35), 3.9, 0.9] },
      { name: 'foot' + S, parent: 'shin' + S, pos: [x(2.45), 1.15, -0.35], tip: [x(2.5), 0.4, 1.9] },
      { name: 'clav' + S, parent: 'chest', pos: [x(1.1), 10.7, 1.3] },
      { name: 'arm' + S, parent: 'clav' + S, pos: [x(2.3), 10.4, 1.9] },
      { name: 'fore' + S, parent: 'arm' + S, pos: [x(2.75), 8.75, 2.55] },
      { name: 'hand' + S, parent: 'fore' + S, pos: [x(2.6), 7.45, 3.6], tip: [x(2.5), 6.8, 4.5] },
    );
  }
  return b;
}
let RIG = null;

// ---------------------------------------------------------------- palette
const PALETTES = {
  default: { hide: [0.034, 0.043, 0.034], belly: [0.075, 0.07, 0.055], back: [0.02, 0.024, 0.021], spineTip: [0.42, 0.44, 0.40], glow: 0x39b6ff, eye: 0xffb347, mouth: [0.16, 0.025, 0.03] },
  alt: { hide: [0.05, 0.028, 0.024], belly: [0.09, 0.06, 0.045], back: [0.022, 0.012, 0.01], spineTip: [0.5, 0.36, 0.3], glow: 0xff3b1f, eye: 0xff5020, mouth: [0.2, 0.03, 0.02] },
};

// ---------------------------------------------------------------- geometry (built once, cached)
let GEO = null;
function buildGeometry() {
  if (GEO) return GEO;
  const rig = RIG;
  const B = new Builder(rig);
  const pal = PALETTES.default; // palette applied via material colour tint; vertex colours carry value/structure
  const hideCol = (p, base, n, cav) => {
    const m = 0.75 + 0.5 * (fbm3(p.x * 0.25, p.y * 0.25, p.z * 0.25, 3) * 0.5 + 0.5);
    const c = base.map((v) => v * m * (0.55 + 0.45 * cav));
    return c;
  };
  const crag = (p, amp) => {
    const r = ridged3(p.x * 0.55, p.y * 0.55, p.z * 0.55, 3);
    const f = fbm3(p.x * 0.22 + 3, p.y * 0.22, p.z * 0.22, 3);
    return (r * 0.9 + f * 0.8 - 0.35) * amp;
  };
  const cavity = (p) => clamp(0.5 + ridged3(p.x * 0.55, p.y * 0.55, p.z * 0.55, 3) * 1.2 - 0.3);

  // ---- body: tail tip → pelvis → torso → neck (one continuous sweep)
  const bodyPts = [
    [0, 0.7, -18.6], [0, 0.9, -16.8], [0, 1.4, -15.0], [0, 2.1, -13.1], [0, 3.0, -11.1], [0, 4.1, -9.0], [0, 5.2, -6.8], [0, 6.1, -4.7],
    [0, 6.8, -2.8], [0, 7.3, -1.2], [0, 8.2, 0.0], [0, 9.5, 0.6], [0, 10.7, 1.05], [0, 11.6, 1.55], [0, 12.35, 2.05], [0, 12.9, 2.35],
  ];
  const bodyR = [
    [0.1, 0.1, 0.08], [0.32, 0.3, 0.24], [0.55, 0.5, 0.42], [0.8, 0.72, 0.62], [1.05, 0.96, 0.82], [1.35, 1.22, 1.08], [1.7, 1.52, 1.4], [2.1, 1.85, 1.85],
    [2.55, 2.15, 2.4], [2.95, 2.3, 2.9], [3.05, 2.2, 3.05], [2.85, 2.0, 2.85], [2.45, 1.8, 2.45], [1.85, 1.55, 1.85], [1.4, 1.25, 1.45], [1.15, 1.05, 1.1],
  ];
  const bodyBones = ['tail7', 'tail6', 'tail5', 'tail4', 'tail3', 'tail2', 'tail1', 'tail0', 'hips', 'spine', 'chest', 'neck'];
  let bodyInfo;
  bodyInfo = B.sweep('hide', {
    pts: bodyPts, r: bodyR, segs: 120, radial: 56, up: [0, 1, 0], capStart: 3, capEnd: 5, capLen: 0.8, uv: 0.34,
    bones: bodyBones, power: 4.5,
    shape: (t, a) => {
      const sa = Math.sin(a);
      // dorsal keel along tail + back, ventral belly plates slightly flattened
      let m = 1 + 0.1 * Math.exp(-((a - Math.PI / 2) ** 2) / 0.06) * smooth(0.05, 0.4, t);
      if (sa < -0.6) m *= 1 - 0.05 * smooth(0.55, 0.7, t);
      return m;
    },
    disp: (p, t, a) => {
      const sa = Math.sin(a);
      const scale = smooth(0.0, 0.25, t) * 0.8 + 0.2;
      let d = crag(p, 0.32 * scale);
      // belly plates (horizontal ridges on the front of the torso and under the tail)
      if (sa < -0.35) {
        const w = smooth(-0.35, -0.75, sa);
        const band = t > 0.55 ? p.y * 2.3 : p.z * 1.4;
        d += (Math.abs(Math.sin(band)) - 0.6) * 0.12 * w;
      }
      // chest/pectoral mass
      d += 0.35 * Math.exp(-((p.y - 10.3) ** 2) / 0.8) * smooth(0.0, 0.6, -Math.cos(a) * 0 + Math.max(0, -sa)) * Math.min(1, Math.abs(p.x) / 1.2);
      return d;
    },
    color: (p, t, a, n) => {
      const sa = Math.sin(a);
      const belly = smooth(-0.3, -0.8, sa);
      const back = smooth(0.4, 0.95, sa);
      let base = pal.hide.map((v, i) => lerp(lerp(v, pal.back[i], back), pal.belly[i], belly * 0.85));
      return hideCol(p, base, n, cavity(p));
    },
  });
  // ---- thighs, shins, feet, toes (left; mirrored later)
  const mkLeg = () => {
    B.sweep('hide', {
      pts: [[1.5, 7.9, -0.9], [1.95, 6.9, -0.5], [2.25, 5.4, 0.25], [2.4, 4.1, 0.95], [2.4, 3.5, 0.85]],
      r: [[1.8, 1.9, 1.9], [2.15, 2.25, 2.2], [1.95, 2.0, 1.95], [1.45, 1.5, 1.5], [1.35, 1.4, 1.4]],
      segs: 26, radial: 36, up: [0, 0, 1], capStart: 0, capEnd: 3, uv: 0.34,
      bones: ['hips', 'thighL', 'shinL'], power: 6,
      disp: (p) => crag(p, 0.28) + 0.18 * Math.exp(-((p.y - 5.6) ** 2) / 1.2) * Math.max(0, p.z - 0.2),
      color: (p, t, a, n) => hideCol(p, pal.hide.map((v, i) => lerp(v, pal.belly[i], smooth(0.2, -0.8, n.y) * 0.4)), n, cavity(p)),
    });
    B.sweep('hide', {
      pts: [[2.38, 4.6, 1.05], [2.42, 3.8, 0.85], [2.45, 2.5, 0.25], [2.45, 1.3, -0.35], [2.45, 0.85, -0.55]],
      r: [[1.4, 1.45, 1.45], [1.35, 1.4, 1.4], [1.15, 1.2, 1.15], [1.2, 1.25, 1.2], [1.2, 1.2, 1.2]],
      segs: 22, radial: 30, up: [0, 0, 1], capStart: 2, capEnd: 3, uv: 0.34,
      bones: ['thighL', 'shinL', 'footL'], power: 7,
      disp: (p) => crag(p, 0.24),
      color: (p, t, a, n) => hideCol(p, pal.hide, n, cavity(p)),
    });
    B.sweep('hide', { // foot: broad, flat soled, heel behind the ankle
      pts: [[2.45, 0.85, -1.55], [2.45, 0.8, -0.5], [2.5, 0.62, 0.7], [2.55, 0.45, 1.55]],
      r: [[0.95, 0.55, 0.55], [1.3, 0.85, 0.72], [1.35, 0.62, 0.55], [1.15, 0.42, 0.42]],
      segs: 16, radial: 28, up: [0, 1, 0], capStart: 4, capEnd: 3, capLen: 0.8, uv: 0.34,
      bones: ['shinL', 'footL'], power: 9, bias: [0.4, 1],
      disp: (p) => crag(p, 0.14),
      color: (p, t, a, n) => hideCol(p, pal.hide.map((v) => v * 0.85), n, cavity(p)),
    });
    const toes = [[-0.55, 0.28], [0.15, 0.0], [0.8, -0.3]];
    for (const [dx, spread] of toes) {
      const bx = 2.5 + dx, tip = [bx + spread * 0.9 + dx * 0.4, 0.28, 2.75];
      B.sweep('hide', {
        pts: [[bx, 0.55, 1.0], [bx + spread * 0.4 + dx * 0.15, 0.45, 1.9], tip], r: [[0.42, 0.34, 0.34], [0.36, 0.3, 0.28], [0.3, 0.24, 0.22]],
        segs: 8, radial: 14, capEnd: 2, uv: 0.34, bone: 'footL', disp: (p) => crag(p, 0.05),
        color: (p, t, a, n) => hideCol(p, pal.hide.map((v) => v * 0.8), n, cavity(p)),
      });
      B.sweep('bone', {
        pts: [[tip[0], 0.34, tip[2] - 0.15], [tip[0] + spread * 0.1, 0.2, tip[2] + 0.35], [tip[0] + spread * 0.15, 0.03, tip[2] + 0.6]],
        r: [[0.22, 0.22], [0.14, 0.14], [0.02, 0.02]], segs: 6, radial: 10, capStart: 2, bone: 'footL', uv: 1.5,
        color: () => [0.22, 0.2, 0.17],
      });
    }
  };
  // ---- arms + hands + claws (left)
  const mkArm = () => {
    B.sweep('hide', {
      pts: [[1.5, 10.9, 1.4], [2.3, 10.45, 1.95], [2.6, 9.6, 2.25], [2.78, 8.75, 2.55], [2.72, 8.1, 3.05], [2.6, 7.45, 3.6]],
      r: [[1.05, 1.05, 1.0], [0.95, 0.95, 0.95], [0.78, 0.8, 0.8], [0.62, 0.65, 0.65], [0.66, 0.66, 0.66], [0.52, 0.5, 0.5]],
      segs: 26, radial: 22, up: [0, 0, 1], capStart: 0, capEnd: 3, uv: 0.34,
      bones: ['chest', 'armL', 'foreL', 'handL'], power: 6,
      disp: (p) => crag(p, 0.13) + 0.12 * Math.exp(-((p.y - 9.7) ** 2) / 0.3),
      color: (p, t, a, n) => hideCol(p, pal.hide, n, cavity(p)),
    });
    B.sweep('hide', { pts: [[2.6, 7.5, 3.55], [2.58, 7.2, 3.95], [2.55, 6.95, 4.25]], r: [[0.52, 0.34, 0.34], [0.55, 0.3, 0.3], [0.45, 0.25, 0.25]],
      segs: 6, radial: 14, capStart: 2, capEnd: 2, bone: 'handL', uv: 0.34, disp: (p) => crag(p, 0.05), color: (p, t, a, n) => hideCol(p, pal.hide, n, 0.8) });
    const fingers = [[-0.33, 0.0], [0.0, 0.05], [0.33, 0.1], [0.5, -0.4]];
    fingers.forEach(([dx, dz], i) => {
      const thumb = i === 3;
      const b0 = [2.58 + dx, 7.0, 4.2 + dz];
      const b1 = [2.58 + dx * 1.2, thumb ? 6.8 : 6.65, (thumb ? 4.3 : 4.6) + dz];
      const b2 = [2.58 + dx * 1.25, thumb ? 6.55 : 6.2, (thumb ? 4.5 : 4.75) + dz];
      B.sweep('hide', { pts: [b0, b1, b2], r: [[0.15, 0.15], [0.13, 0.13], [0.11, 0.11]], segs: 6, radial: 10, capStart: 1, capEnd: 1, bone: 'handL', uv: 0.34,
        color: (p, t, a, n) => hideCol(p, pal.hide, n, 0.8) });
      B.sweep('bone', { pts: [b2, [b2[0], b2[1] - 0.3, b2[2] + 0.12], [b2[0], b2[1] - 0.55, b2[2] + 0.02]], r: [[0.11, 0.11], [0.07, 0.07], [0.01, 0.01]],
        segs: 6, radial: 8, bone: 'handL', uv: 1.5, color: () => [0.2, 0.18, 0.15] });
    });
  };
  // left side + mirror (hide and bone groups)
  const mH = B.mark('hide'), mB = B.mark('bone');
  mkLeg(); mkArm();
  const toR = (n) => (/L$/.test(n) ? n.slice(0, -1) + 'R' : n);
  B.mirror('hide', mH, toR); B.mirror('bone', mB, toR);

  // ---- head (upper skull + snout) and jaw
  const headInfo = B.sweep('hide', {
    pts: [[0, 12.75, 1.45], [0, 12.95, 2.35], [0, 12.95, 3.35], [0, 12.78, 4.35], [0, 12.62, 5.15]],
    r: [[1.05, 0.95, 0.5], [1.22, 0.95, 0.5], [1.08, 0.72, 0.45], [0.86, 0.54, 0.38], [0.64, 0.4, 0.3]],
    segs: 30, radial: 40, up: [0, 1, 0], capStart: 5, capEnd: 4, capLen: 0.7, uv: 0.5,
    bones: ['head'],
    shape: (t, a) => {
      const sa = Math.sin(a), ca = Math.abs(Math.cos(a));
      let m = 1;
      m += 0.2 * Math.exp(-((t - 0.5) ** 2) / 0.012) * Math.exp(-((sa - 0.6) ** 2) / 0.03); // heavy brow ridge
      m += 0.12 * Math.exp(-((t - 0.18) ** 2) / 0.02) * Math.exp(-((sa + 0.1) ** 2) / 0.1) * ca; // cheek / masseter
      m -= 0.08 * Math.exp(-((sa - 1) ** 2) / 0.04) * smooth(0.3, 0.8, t); // flat snout top
      return m;
    },
    disp: (p, t) => crag(p, 0.1) + 0.05 * noise3(p.x * 4, p.y * 4, p.z * 4) * smooth(0.2, 0.6, t),
    color: (p, t, a, n) => {
      const sa = Math.sin(a), ca = Math.abs(Math.cos(a));
      if (sa < -0.7 && t > 0.12 && ca < 0.7) return pal.mouth;
      let c = hideCol(p, pal.hide, n, cavity(p));
      // nostril pits
      const nd = Math.hypot(Math.abs(p.x) - 0.3, p.y - 12.95, p.z - 5.0);
      if (nd < 0.14) c = c.map((v) => v * 0.2);
      return c;
    },
  });
  B.sweep('hide', {
    pts: [[0, 12.35, 1.75], [0, 12.35, 2.75], [0, 12.25, 3.85], [0, 12.2, 4.95]],
    r: [[0.98, 0.2, 0.62], [0.98, 0.22, 0.55], [0.8, 0.18, 0.42], [0.55, 0.14, 0.28]],
    segs: 24, radial: 32, up: [0, 1, 0], capStart: 4, capEnd: 3, capLen: 0.7, uv: 0.5, bones: ['jaw'],
    disp: (p) => crag(p, 0.07),
    color: (p, t, a, n) => {
      const sa = Math.sin(a), ca = Math.abs(Math.cos(a));
      if (sa > 0.45 && ca < 0.8) return pal.mouth.map((v) => v * 1.2);
      return hideCol(p, pal.hide.map((v, i) => lerp(v, pal.belly[i], 0.4)), n, cavity(p));
    },
  });
  // teeth
  for (let i = 0; i < 9; i++) {
    const z = 2.6 + i * 0.29; const f = i / 8;
    const hx = lerp(0.95, 0.52, f), hy = lerp(12.47, 12.33, f);
    for (const s of [1, -1]) {
      const L = lerp(0.28, 0.2, f) * (0.8 + 0.4 * hash1(i * 3 + s));
      B.sweep('bone', { pts: [[s * hx, hy + 0.05, z], [s * hx * 0.98, hy - L * 0.5, z + 0.03], [s * hx * 0.96, hy - L, z + 0.06]], r: [[0.07, 0.07], [0.05, 0.05], [0.005, 0.005]],
        segs: 3, radial: 6, bone: 'head', uv: 2, color: () => [0.55, 0.52, 0.44] });
      const jx = lerp(0.88, 0.48, f) * 0.97, jy = lerp(12.52, 12.37, f);
      B.sweep('bone', { pts: [[s * jx, jy - 0.08, z + 0.12], [s * jx * 0.98, jy + L * 0.4, z + 0.12], [s * jx * 0.96, jy + L * 0.8, z + 0.1]], r: [[0.06, 0.06], [0.045, 0.045], [0.005, 0.005]],
        segs: 3, radial: 6, bone: 'jaw', uv: 2, color: () => [0.5, 0.47, 0.4] });
    }
  }
  // eyes
  const hr = headInfo.rings[Math.round(headInfo.rings.length * 0.48)];
  const eyeY = hr.C.y + hr.ru * 0.28, eyeZ = hr.C.z + 0.05, eyeX = hr.rx * 0.93;
  for (const s of [1, -1]) {
    B.blob('eye', { a: [s * eyeX, eyeY, eyeZ - 0.17], b: [s * eyeX, eyeY, eyeZ + 0.17], rx: 0.13, ry: 0.11, cap: 5, radial: 12, bone: 'head', uv: 1 });
  }
  // throat glow core (lights up for the breath)
  B.blob('spine', { a: [0, 12.5, 2.1], b: [0, 12.45, 4.3], rx: 0.45, ry: 0.12, cap: 4, radial: 12, bone: 'head', attrList: ['aGlow', 'aEdge'],
    attr: { aGlow: () => 0.97, aEdge: () => 1 }, color: () => [0.3, 0.35, 0.4] });

  // ---- dorsal spines: 3 rows along neck → back → tail, largest mid-back
  const rings = bodyInfo.rings; const total = bodyInfo.total;
  const spineBones = ['tail5', 'tail4', 'tail3', 'tail2', 'tail1', 'tail0', 'hips', 'spine', 'chest', 'neck'].map((n) => rig.id(n));
  const nearest = (p) => { let best = spineBones[0], bd = 1e9; for (const bi of spineBones) { const s = rig.seg[bi]; const d = distSeg(p, s.a, s.b); if (d < bd) { bd = d; best = bi; } } return rig.bones[best].name; };
  const ringAt = (s) => { let r = rings[0]; for (const rg of rings) { if (rg.s <= s) r = rg; else break; } return r; };
  const sStart = total * 0.3, sEnd = total - 0.9;
  const height = (u) => { // u 0 (tail) → 1 (neck)
    const peak = 0.6;
    return u < peak ? lerp(0.35, 2.9, Math.pow(u / peak, 1.35)) : lerp(2.9, 0.75, Math.pow((u - peak) / (1 - peak), 0.9));
  };
  let seed = 0;
  const addSpine = (s, row) => {
    const rg = ringAt(s); const u = (s - sStart) / (sEnd - sStart);
    const side = row === 0 ? 0 : row; // -1,0,1
    const ang = side * 0.5;
    const out = rg.D.clone().multiplyScalar(Math.cos(ang)).addScaledVector(rg.S, Math.sin(ang) * (rg.rx / Math.max(rg.ru, 0.01)) * 0.6).normalize();
    const base = rg.C.clone().addScaledVector(rg.D, rg.ru * Math.cos(ang) * 0.82).addScaledVector(rg.S, rg.rx * Math.sin(ang) * 0.8);
    let h = height(u) * (row === 0 ? 1 : 0.62) * (0.88 + 0.24 * hash1(seed++));
    const w = h * 0.72 + 0.15;
    const V = out.clone().addScaledVector(rg.T, -0.42).normalize();
    const U = rg.T.clone();
    const outline = spineOutline(w, h, seed * 7.3);
    const bn = nearest(base);
    B.plate('spine', {
      base: base.toArray(), uDir: U.toArray(), vDir: V.toArray(), outline, center: [-0.08 * h, h * 0.3], height: h,
      thick: 0.09 + w * 0.09, rings: 3, bone: bn, attrList: ['aGlow', 'aEdge'],
      noise: (p) => noise3(p.x * 3, p.y * 3, p.z * 3) * 0.06,
      attr: { aGlow: (p, v) => clamp(u * 0.85 + (v / h) * 0.15), aEdge: (p, v, e) => e },
      color: (p, v, e) => { const k = smooth(0.0, 0.9, v / h); return pal.hide.map((c, i) => lerp(c * 1.3, pal.spineTip[i], k * (0.7 + 0.3 * e))); },
    });
  };
  const nC = 24;
  for (let i = 0; i < nC; i++) addSpine(lerp(sStart, sEnd, i / (nC - 1)), 0);
  const nS = 17;
  for (let i = 0; i < nS; i++) { const s = lerp(sStart + total * 0.08, sEnd - 0.6, (i + 0.5) / nS); addSpine(s, 1); addSpine(s, -1); }

  GEO = B.build();
  GEO.eyeLocal = [eyeX, eyeY, eyeZ];
  return GEO;
}

function distSeg(p, a, b) {
  const ab = b.clone().sub(a); const L2 = ab.lengthSq(); let t = L2 > 1e-8 ? p.clone().sub(a).dot(ab) / L2 : 0; t = clamp(t);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/** Jagged maple-leaf / flame dorsal plate outline in (u = along body toward head, v = up). */
function spineOutline(w, h, sd) {
  const pts = [];
  const tip = [-0.32 * h, h];
  const nF = 4, nR = 3;
  const rnd = (k) => hash1(sd + k * 13.1);
  // front edge: from base-front up to tip (bulging forward), with lobes
  for (let i = 0; i <= nF * 2; i++) {
    const f = i / (nF * 2);
    const bx = lerp(w * 0.5, tip[0], f), by = lerp(0, tip[1], Math.pow(f, 0.85));
    const bulge = Math.sin(f * Math.PI) * w * 0.3;
    const lobe = i % 2 === 1 ? w * (0.1 + 0.06 * rnd(i)) * (1 - f * 0.6) : -w * 0.02;
    pts.push([bx + bulge + lobe, by + (i % 2 === 1 ? h * 0.05 : 0)]);
  }
  // rear edge: from tip down to base-rear, sharper lobes pointing back/up
  for (let i = 1; i <= nR * 2; i++) {
    const f = i / (nR * 2);
    const bx = lerp(tip[0], -w * 0.5, f), by = lerp(tip[1], 0, Math.pow(f, 1.2));
    const lobe = i % 2 === 1 ? -w * (0.14 + 0.06 * rnd(i + 9)) : w * 0.04;
    pts.push([bx + lobe - Math.sin(f * Math.PI) * w * 0.08, by + (i % 2 === 1 ? h * 0.06 : 0)]);
  }
  // base (buried in the back)
  pts.push([-w * 0.25, -0.35], [w * 0.25, -0.35]);
  return pts;
}

// ---------------------------------------------------------------- materials
function makeMaterials(u) {
  const T = getHideTextures(); const BT = getBoneTextures();
  const hide = new THREE.MeshPhysicalMaterial({
    vertexColors: true, map: T.map, normalMap: T.normalMap, normalScale: new THREE.Vector2(1.3, 1.3), roughnessMap: T.roughnessMap,
    roughness: 1, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.5, emissiveMap: T.emissiveMap, emissive: 0x39b6ff, emissiveIntensity: 0,
    sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x4a5a58),
  });
  patchMaterial(hide, u, { key: 'hide' });
  const bone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0, normalMap: BT.normalMap, roughnessMap: BT.roughnessMap });
  patchMaterial(bone, u, { key: 'bone' });
  const spine = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, normalMap: BT.normalMap, normalScale: new THREE.Vector2(1.5, 1.5), clearcoat: 0.2, clearcoatRoughness: 0.4 });
  patchMaterial(spine, u, {
    key: 'spine',
    vertDecl: 'attribute float aGlow; attribute float aEdge; varying float vGlow; varying float vEdge;',
    vert: 'vGlow = aGlow; vEdge = aEdge;',
    fragDecl: 'uniform float uCharge; uniform float uTime; uniform vec3 uGlowColor; uniform float uGlowInt; varying float vGlow; varying float vEdge;',
    emissive: `
      float lit = smoothstep(vGlow - 0.1, vGlow + 0.02, uCharge * 1.12);
      float flick = 0.82 + 0.18 * sin(uTime * 23.0 + vGlow * 31.0) * sin(uTime * 7.0 + vGlow * 11.0);
      float edge = mix(0.45, 1.6, vEdge * vEdge);
      float blaze = smoothstep(1.0, 1.5, uCharge);
      totalEmissiveRadiance += uGlowColor * (lit * edge * flick * uGlowInt * (1.0 + blaze * 1.5) + 0.05 * edge);
      diffuseColor.rgb = mix(diffuseColor.rgb, uGlowColor * 0.6 + 0.4, lit * 0.35);
    `,
  });
  spine.defines = { ...(spine.defines || {}) };
  const eye = new THREE.MeshStandardMaterial({ color: 0x2a1000, emissive: 0xffb347, emissiveIntensity: 3, roughness: 0.15 });
  patchMaterial(eye, u, { key: 'eye' });
  return { hide, bone, spine, eye };
}

// ---------------------------------------------------------------- key poses (deltas on top of STANCE)
const STANCE = {
  hipsPos: [0, -0.35, 0], spine: [0.06, 0, 0], chest: [0.06, 0, 0], neck: [-0.08, 0, 0], head: [0.06, 0, 0],
  armL: [-0.3, 0, 0.12], armR: [-0.3, 0, 0.12], foreL: [-0.45, 0, 0], foreR: [-0.45, 0, 0], handL: [0.25, 0, 0.1], handR: [0.25, 0, 0.1],
  tail0: [-0.04, 0, 0], tail4: [0.03, 0, 0], tail6: [0.05, 0, 0],
};
const ROAR = {
  hipsPos: [0, 0.3, -0.3], spine: [-0.12, 0, 0], chest: [-0.22, 0, 0], neck: [-0.5, 0, 0], head: [-0.45, 0, 0], jaw: [0.85, 0, 0],
  armL: [-0.35, 0, 0.55], armR: [-0.35, 0, 0.55], foreL: [-0.55, 0, 0], foreR: [-0.55, 0, 0], handL: [-0.3, 0, 0], handR: [-0.3, 0, 0],
  tail0: [0.18, 0, 0], tail1: [0.08, 0, 0], clavL: [0, 0, 0.15], clavR: [0, 0, 0.15],
};
const LIGHT = [
  [0, {}],
  [0.3, { chest: [0.0, -0.5, 0.05], spine: [0, -0.22, 0], hips: [0, -0.1, 0], armR: [-2.25, 0.2, 0.95], foreR: [-0.9, 0, 0], clavR: [0, 0, 0.25], head: [0, 0.2, 0], neck: [0, 0.1, 0], armL: [0.2, 0, 0.2], jaw: [0.25, 0, 0], tail0: [0, 0.15, 0] }],
  [0.46, { hipsPos: [0, -0.2, 0.6], chest: [0.18, 0.6, -0.05], spine: [0.1, 0.25, 0], hips: [0, 0.12, 0], armR: [-0.8, 0.1, -0.55], foreR: [-0.05, 0, 0], handR: [-0.3, 0, 0], clavR: [0, 0.2, 0], head: [0.1, -0.15, 0], jaw: [0.4, 0, 0], tail0: [0, -0.2, 0] }],
  [0.64, { hipsPos: [0, -0.3, 0.5], chest: [0.2, 0.7, -0.05], spine: [0.1, 0.25, 0], armR: [-0.35, 0.1, -0.8], foreR: [-0.15, 0, 0], head: [0.1, -0.2, 0], jaw: [0.2, 0, 0] }],
  [1, {}],
];
const KICK = [ // tail whip
  [0, {}],
  [0.25, { bodyRot: [0, -0.4, 0], hipsPos: [0, -0.5, 0], chest: [0.15, -0.2, 0], neck: [0, 0.2, 0], tail0: [0.05, -0.12, 0], tail1: [0, -0.12, 0], tail2: [0, -0.12, 0], armL: [-0.3, 0, 0.3], armR: [-0.3, 0, 0.3] }],
  [0.58, { bodyRot: [0, 2.3, 0], hipsPos: [0, -0.9, 0], hips: [0, 0.15, 0], chest: [0.2, 0.25, 0], neck: [0.1, -0.55, 0], head: [0, -0.55, 0], jaw: [0.35, 0, 0],
    tail0: [-0.12, 0.12, 0], tail1: [0.02, 0.1, 0], tail2: [0.04, 0.1, 0], tail3: [0.04, 0.12, 0], tail4: [0.04, 0.12, 0], armL: [-0.4, 0, 0.6], armR: [-0.1, 0, 0.5] }],
  [0.72, { bodyRot: [0, 2.4, 0], hipsPos: [0, -0.8, 0], chest: [0.15, 0.2, 0], neck: [0.1, -0.5, 0], head: [0, -0.5, 0], tail0: [-0.1, 0, 0] }],
  [1, {}],
];
const HEAVY = [ // lunging headbutt / body slam
  [0, {}],
  [0.34, { hipsPos: [0, 0.1, -1.1], spine: [-0.25, 0, 0], chest: [-0.25, 0, 0], neck: [-0.35, 0, 0], head: [-0.25, 0, 0], jaw: [0.35, 0, 0], armL: [0.45, 0, 0.55], armR: [0.45, 0, 0.55], tail0: [0.28, 0, 0], tail1: [0.1, 0, 0], ikL: [0, 0, 0] }],
  [0.45, { hipsPos: [0, -0.4, 0.8], spine: [0.1, 0, 0], chest: [0.1, 0, 0], neck: [0.1, 0, 0], head: [0.1, 0, 0], jaw: [0.2, 0, 0], armL: [-0.2, 0, 0.4], armR: [-0.2, 0, 0.4], ikL: [0, 1.4, 1.2] }],
  [0.56, { hipsPos: [0, -1.3, 2.4], spine: [0.42, 0, 0], chest: [0.42, 0, 0], neck: [0.25, 0, 0], head: [0.35, 0, 0], jaw: [0.1, 0, 0], armL: [-0.9, 0, 0.3], armR: [-0.9, 0, 0.3], tail0: [-0.2, 0, 0], ikL: [0, 0, 2.3] }],
  [0.72, { hipsPos: [0, -1.45, 2.45], spine: [0.45, 0, 0], chest: [0.42, 0, 0], neck: [0.2, 0, 0], head: [0.3, 0, 0], armL: [-0.8, 0, 0.35], armR: [-0.8, 0, 0.35], tail0: [-0.15, 0, 0], ikL: [0, 0, 2.3] }],
  [0.86, { hipsPos: [0, -0.6, 1.2], spine: [0.2, 0, 0], chest: [0.2, 0, 0], ikL: [0, 1.0, 1.1] }],
  [1, {}],
];
const SP1 = [ // atomic breath
  [0, {}],
  [0.24, { hipsPos: [0, -0.9, -0.2], spine: [0.12, 0, 0], chest: [0.18, 0, 0], neck: [0.35, 0, 0], head: [0.28, 0, 0], armL: [-0.2, 0, 0.45], armR: [-0.2, 0, 0.45], foreL: [-0.8, 0, 0], foreR: [-0.8, 0, 0], tail0: [0.18, 0, 0], tail1: [0.08, 0, 0] }],
  [0.33, { hipsPos: [0, -0.3, -0.3], spine: [-0.1, 0, 0], chest: [-0.28, 0, 0], neck: [-0.55, 0, 0], head: [-0.5, 0, 0], jaw: [0.45, 0, 0], armL: [0.1, 0, 0.6], armR: [0.1, 0, 0.6], tail0: [0.25, 0, 0] }],
  [0.39, { hipsPos: [0, -1.0, -0.5], spine: [0.1, 0, 0], chest: [0.1, 0, 0], neck: [-0.05, 0, 0], head: [-0.2, 0, 0], jaw: [0.85, 0, 0], armL: [0.3, 0, 0.55], armR: [0.3, 0, 0.55], foreL: [-0.3, 0, 0], foreR: [-0.3, 0, 0], tail0: [0.22, 0, 0], tail1: [0.1, 0, 0] }],
  [0.9, { hipsPos: [0, -1.1, -0.8], spine: [0.1, 0, 0], chest: [0.1, 0, 0], neck: [-0.05, 0, 0], head: [-0.2, 0, 0], jaw: [0.85, 0, 0], armL: [0.3, 0, 0.55], armR: [0.3, 0, 0.55], foreL: [-0.3, 0, 0], foreR: [-0.3, 0, 0], tail0: [0.22, 0, 0], tail1: [0.1, 0, 0] }],
  [1, {}],
];
const SP2 = [ // tail quake — 360° spin + slam
  [0, {}],
  [0.12, { bodyRot: [0, -0.35, 0], hipsPos: [0, -1.1, 0], chest: [0.2, -0.2, 0], tail0: [0.1, -0.1, 0], armL: [-0.4, 0, 0.5], armR: [-0.4, 0, 0.5] }],
  [0.62, { bodyRot: [0, Math.PI * 2, 0], hipsPos: [0, -1.3, 0], chest: [0.25, 0.15, 0], neck: [0.1, -0.3, 0], tail0: [0.28, 0.1, 0], tail1: [0.12, 0.1, 0], tail2: [0.05, 0.1, 0], tail3: [0.0, 0.05, 0], armL: [-0.3, 0, 0.9], armR: [-0.3, 0, 0.9] }],
  [0.72, { bodyRot: [0, Math.PI * 2, 0], hipsPos: [0, 0.6, -0.2], spine: [-0.15, 0, 0], chest: [-0.2, 0, 0], neck: [-0.3, 0, 0], head: [-0.2, 0, 0], jaw: [0.6, 0, 0], tail0: [0.45, 0, 0], tail1: [0.2, 0, 0], armL: [-1.3, 0, 0.6], armR: [-1.3, 0, 0.6], ikL: [0, 0.8, 0] }],
  [0.79, { bodyRot: [0, Math.PI * 2, 0], hipsPos: [0, -1.9, 0.3], spine: [0.35, 0, 0], chest: [0.35, 0, 0], neck: [0.1, 0, 0], head: [0.15, 0, 0], jaw: [0.5, 0, 0], tail0: [-0.25, 0, 0], tail1: [-0.1, 0, 0], armL: [-0.2, 0, 0.8], armR: [-0.2, 0, 0.8], ikL: [0, 0, 0] }],
  [0.9, { bodyRot: [0, Math.PI * 2, 0], hipsPos: [0, -1.6, 0.2], spine: [0.3, 0, 0], chest: [0.3, 0, 0], jaw: [0.3, 0, 0], armL: [-0.2, 0, 0.7], armR: [-0.2, 0, 0.7] }],
  [1, { bodyRot: [0, Math.PI * 2, 0] }],
];
const SUPER = [ // nuclear pulse
  [0, {}],
  [0.32, { hipsPos: [0, -2.0, -0.2], spine: [0.35, 0, 0], chest: [0.35, 0, 0], neck: [0.05, 0, 0], head: [0.15, 0, 0], jaw: [0.2, 0, 0], armL: [-0.7, 0, -0.25], armR: [-0.7, 0, -0.25], foreL: [-1.3, 0, 0], foreR: [-1.3, 0, 0], handL: [0.6, 0, 0], handR: [0.6, 0, 0], tail0: [-0.05, 0.15, 0], tail1: [0, 0.12, 0], tail2: [0, 0.12, 0] }],
  [0.37, { hipsPos: [0, 0.5, -0.4], spine: [-0.3, 0, 0], chest: [-0.35, 0, 0], neck: [-0.5, 0, 0], head: [-0.4, 0, 0], jaw: [0.95, 0, 0], armL: [-0.6, 0, 1.25], armR: [-0.6, 0, 1.25], foreL: [0.1, 0, 0], foreR: [0.1, 0, 0], handL: [-0.4, 0, 0], handR: [-0.4, 0, 0], tail0: [0.4, 0, 0], tail1: [0.2, 0, 0], clavL: [0, 0, 0.3], clavR: [0, 0, 0.3] }],
  [0.8, { hipsPos: [0, 0.4, -0.4], spine: [-0.25, 0, 0], chest: [-0.3, 0, 0], neck: [-0.45, 0, 0], head: [-0.4, 0, 0], jaw: [0.9, 0, 0], armL: [-0.5, 0, 1.1], armR: [-0.5, 0, 1.1], foreL: [0.0, 0, 0], foreR: [0.0, 0, 0], tail0: [0.35, 0, 0], tail1: [0.15, 0, 0], clavL: [0, 0, 0.25], clavR: [0, 0, 0.25] }],
  [1, {}],
];
const HIT = { hipsPos: [0, -0.25, -0.45], spine: [-0.1, 0, 0.04], chest: [-0.22, 0.1, 0], neck: [-0.3, 0, 0], head: [-0.4, 0.15, 0.1], jaw: [0.45, 0, 0], armL: [0.35, 0, 0.45], armR: [0.25, 0, 0.35], foreL: [0.3, 0, 0], tail0: [0.12, 0, 0] };
const HIT_HEAVY = { hipsPos: [0, -0.7, -1.4], spine: [-0.2, 0, 0.08], chest: [-0.35, 0.2, 0], neck: [-0.45, 0, 0], head: [-0.45, 0.25, 0.15], jaw: [0.7, 0, 0], armL: [0.6, 0, 0.8], armR: [0.4, 0, 0.6], foreL: [0.4, 0, 0], foreR: [0.2, 0, 0], tail0: [0.25, 0, 0], tail1: [0.1, 0, 0], ikR: [0, 0, -0.8] };
const LYING = { // on its right side, tail trailing
  ikW: [-1, -1], hipsPos: [-0.6, -4.1, -0.8], hips: [-0.15, 0.1, 1.42], spine: [0.1, 0, 0.05], chest: [0.15, 0, 0.05], neck: [0.1, 0.2, -0.25], head: [0.1, 0.1, -0.35], jaw: [0.25, 0, 0],
  thighL: [-0.6, 0, -0.55], shinL: [0.8, 0, 0], footL: [0.4, 0, 0], thighR: [-0.35, 0, 0.2], shinR: [0.7, 0, 0], footR: [0.3, 0, 0],
  armL: [-0.5, 0, 0.5], foreL: [-0.4, 0, 0], armR: [-0.9, 0, 0.2], foreR: [-0.3, 0, 0], tail0: [0.05, 0, -0.2], tail1: [0, 0.1, 0], tail2: [0, 0.1, 0],
};
const JUMP = [
  [0, {}],
  [0.14, { hipsPos: [0, -1.9, 0], spine: [0.25, 0, 0], chest: [0.15, 0, 0], neck: [-0.15, 0, 0], armL: [0.4, 0, 0.3], armR: [0.4, 0, 0.3], tail0: [-0.1, 0, 0] }],
  [0.26, { hipsPos: [0, 0.5, 0], spine: [-0.1, 0, 0], armL: [-0.8, 0, 0.5], armR: [-0.8, 0, 0.5], tail0: [0.1, 0, 0], ikW: [-0.6, -0.6] }],
  [0.42, { hipsPos: [0, 0.2, 0], thighL: [-0.8, 0, 0.1], shinL: [1.1, 0, 0], thighR: [-0.6, 0, 0.1], shinR: [1.0, 0, 0], footL: [-0.2, 0, 0], footR: [-0.2, 0, 0], ikW: [-1, -1], armL: [-0.9, 0, 0.6], armR: [-0.9, 0, 0.6], tail0: [0.25, 0, 0], tail1: [0.1, 0, 0] }],
  [0.8, { hipsPos: [0, 0.2, 0], thighL: [-0.6, 0, 0.1], shinL: [0.8, 0, 0], thighR: [-0.5, 0, 0.1], shinR: [0.7, 0, 0], ikW: [-1, -1], armL: [-0.6, 0, 0.7], armR: [-0.6, 0, 0.7], tail0: [0.15, 0, 0] }],
  [0.9, { hipsPos: [0, -2.2, 0.2], spine: [0.3, 0, 0], chest: [0.2, 0, 0], neck: [-0.2, 0, 0], armL: [0.2, 0, 0.6], armR: [0.2, 0, 0.6], tail0: [-0.15, 0, 0] }],
  [1, {}],
];
const CROUCH = { hipsPos: [0, -2.3, -0.3], hips: [0.12, 0, 0], spine: [0.2, 0, 0], chest: [0.2, 0, 0], neck: [-0.25, 0, 0], head: [-0.15, 0, 0], armL: [-0.5, 0, 0.1], armR: [-0.5, 0, 0.1], foreL: [-0.5, 0, 0], foreR: [-0.5, 0, 0], tail0: [-0.15, 0, 0], tail1: [-0.05, 0, 0], tail3: [0.1, 0, 0] };
const BLOCK = { hipsPos: [0, -0.9, -0.3], chest: [0.12, -0.25, 0], spine: [0.08, -0.1, 0], neck: [0.25, 0.1, 0], head: [0.25, 0.1, 0], armL: [-1.45, 0.1, -0.35], foreL: [-1.25, 0, 0], armR: [-1.25, 0.1, -0.2], foreR: [-1.35, 0, 0], handL: [0.3, 0, 0], handR: [0.3, 0, 0], tail0: [0.08, 0.1, 0], jaw: [0.15, 0, 0] };

// ---------------------------------------------------------------- model
export class SaurianModel extends MonsterBase {
  constructor(opts = {}) {
    if (!RIG) RIG = new RigDef(boneDefs());
    super('saurian', RIG, opts);
    const geo = buildGeometry();
    this.mats = makeMaterials(this.uniforms);
    this.meshHide = this.addSkinned(geo.hide, this.mats.hide);
    this.addSkinned(geo.bone, this.mats.bone);
    this.addSkinned(geo.spine, this.mats.spine);
    this.addSkinned(geo.eye, this.mats.eye, { shadow: false });
    this.geometries = []; // geometry is shared/cached across instances — do not dispose
    this.addLeg('L'); this.addLeg('R');
    // sockets: [bone, bind-space point → converted to bone-local, facing dir]
    const loc = (bone, p) => { const bp = RIG.bones[RIG.index[bone]].pos; return [p[0] - bp[0], p[1] - bp[1], p[2] - bp[2]]; };
    this.sockets = {
      mouth: ['head', loc('head', [0, 12.42, 5.55]), [0, 0, 1]],
      head: ['head', loc('head', [0, 13.1, 3.4]), [0, 0, 1]],
      chest: ['chest', loc('chest', [0, 10.2, 3.2]), [0, 0, 1]],
      handL: ['handL', loc('handL', [2.6, 6.9, 4.3]), [0, -0.5, 1]], handR: ['handR', loc('handR', [-2.6, 6.9, 4.3]), [0, -0.5, 1]],
      footL: ['footL', loc('footL', [2.5, 0.3, 0.8]), [0, 0, 1]], footR: ['footR', loc('footR', [-2.5, 0.3, 0.8]), [0, 0, 1]],
      tail: ['tail7', [0, -0.1, -1.5], [0, 0, -1]],
    };
    // tail springs: lag + whip
    const idx = RIG.index;
    for (let i = 0; i < 8; i++) {
      const k = lerp(140, 38, i / 7), d = 2 * Math.sqrt(k) * lerp(0.5, 0.32, i / 7);
      this.springs.push({ ch: idx['tail' + i] * 3 + 1, k, d, lagYaw: lerp(0.05, 0.12, i / 7), max: 0.7 });
      this.springs.push({ ch: idx['tail' + i] * 3, k: k * 1.2, d: d * 1.2, lagPitch: lerp(0.05, 0.1, i / 7), max: 0.5 });
    }
    this.springs.push({ ch: idx.jaw * 3, k: 260, d: 16 });
    this.setSkin(opts.skin || 'default');
  }

  setSkin(variant = 'default') {
    this.skin = PALETTES[variant] ? variant : 'default';
    const p = PALETTES[this.skin]; const d = PALETTES.default;
    const tint = new THREE.Color(p.hide[0] / d.hide[0], p.hide[1] / d.hide[1], p.hide[2] / d.hide[2]);
    this.mats.hide.color.copy(tint); this.mats.hide.emissive.set(p.glow);
    this.mats.spine.color.setRGB(p.spineTip[0] / d.spineTip[0], p.spineTip[1] / d.spineTip[1], p.spineTip[2] / d.spineTip[2]);
    this.uniforms.uGlowColor.value.set(p.glow);
    this.mats.eye.emissive.set(p.eye);
  }

  fadeFor(state, prev) {
    if (state === 'hit' || state === 'hitHeavy') return 0.05;
    if (state === 'knockdown' || state === 'ko') return 0.08;
    if (prev === 'walk' || prev === 'walkBack' || state === 'walk' || state === 'idle') return 0.2;
    return 0.12;
  }

  pose(state, a, P, dt) {
    const t = a.t || 0; const T = this.time;
    const prog = (dur) => (a.progress !== undefined && a.progress !== null && (a.progress > 0 || t === 0) ? clamp01(a.progress) : clamp01(t / dur));
    const standing = !(state === 'knockdown' || state === 'ko' || state === 'getup');
    if (standing) P.addObj(STANCE);
    // breathing + idle life (always on, subtle)
    const br = Math.sin(T * 1.5);
    P.add('chest', br * 0.025, 0, 0).add('neck', -br * 0.02, 0, 0).add('hipsPos', 0, br * 0.06, 0);
    P.add('armL', br * 0.03, 0, 0).add('armR', br * 0.03, 0, 0);
    for (let i = 0; i < 8; i++) P.add('tail' + i, 0, Math.sin(T * 0.9 - i * 0.55) * 0.035 * (0.4 + i * 0.12), 0);
    let glow = 0;

    switch (state) {
      case 'idle': {
        const look = Math.sin(T * 0.37) * 0.12;
        P.add('neck', 0, look * 0.5, 0).add('head', Math.sin(T * 0.53) * 0.04, look * 0.6, Math.sin(T * 0.29) * 0.04);
        P.add('jaw', Math.max(0, Math.sin(T * 0.7) - 0.85) * 1.2, 0, 0);
        P.add('handL', 0, 0, Math.sin(T * 1.1) * 0.05).add('handR', 0, 0, Math.sin(T * 1.2 + 1) * 0.05);
        break;
      }
      case 'walk': case 'walkBack': case 'sidestep': {
        const lateral = state === 'sidestep';
        const dir = state === 'walkBack' ? -1 : lateral ? (a.dir || 1) : 1;
        const sp = Math.max(Math.abs(a.speed || 0), 0) || (lateral ? 4.5 : 5.5);
        const stride = lateral ? 5.0 : 7.5;
        this.walkPhase += (dt * sp / stride) * dir;
        const ph = this.walkPhase;
        gait(P, ph, { stride, lift: 1.25, stance: 0.62, lateral, bob: 0.45, sway: 0.4, yaw: 0.1, roll: 0.05 });
        const s = Math.sin(ph * Math.PI * 2), c = Math.cos(ph * Math.PI * 2);
        P.add('chest', 0.06, -s * 0.12, 0).add('spine', 0.04, -s * 0.06, c * 0.03);
        P.add('neck', 0, s * 0.08, 0).add('head', Math.abs(c) * 0.04, s * 0.06, 0);
        P.add('armL', s * 0.22, 0, 0).add('armR', -s * 0.22, 0, 0);
        for (let i = 0; i < 8; i++) P.add('tail' + i, 0, Math.sin(ph * Math.PI * 2 - 0.8 - i * 0.45) * 0.07, 0);
        if (state === 'walkBack') P.add('hipsPos', 0, 0, -0.3).add('neck', 0.1, 0, 0);
        break;
      }
      case 'crouch': P.addObj(CROUCH); break;
      case 'block': P.addObj(BLOCK); P.add('chest', Math.sin(T * 9) * 0.01, 0, 0); break;
      case 'jump': {
        const p = prog(1.0); P.keys(p, JUMP);
        if (this.root.position.y < 0.05) P.add('bodyPos', 0, Math.sin(Math.PI * clamp01((p - 0.2) / 0.68)) * 5.5, 0);
        break;
      }
      case 'light': P.keys(prog(0.45), LIGHT); break;
      case 'kick': P.keys(prog(0.7), KICK); break;
      case 'heavy': P.keys(prog(0.9), HEAVY); break;
      case 'sp1': {
        const p = prog(2.2); P.keys(p, SP1);
        glow = ramp(p, 0.0, 0.27) * (1 - ramp(p, 0.9, 1));
        const beam = bump(p, 0.37, 0.4, 0.88, 0.93);
        P.add('head', Math.sin(T * 41) * 0.012 * beam, Math.sin(T * 33) * 0.015 * beam, 0).add('chest', Math.sin(T * 29) * 0.012 * beam, 0, 0);
        P.add('chest', Math.sin(T * 50) * 0.01 * ramp(p, 0.05, 0.25), 0, 0);
        break;
      }
      case 'sp2': P.keys(prog(1.1), SP2); break;
      case 'super': {
        const p = prog(3.0); P.keys(p, SUPER);
        glow = ramp(p, 0.02, 0.33) * 1.5 * (1 - 0.6 * ramp(p, 0.4, 0.85)) * (1 - ramp(p, 0.88, 1));
        const trem = ramp(p, 0.1, 0.33) * (1 - ramp(p, 0.34, 0.36));
        P.add('chest', Math.sin(T * 47) * 0.025 * trem, Math.sin(T * 39) * 0.02 * trem, 0).add('head', Math.sin(T * 53) * 0.03 * trem, 0, 0);
        P.add('jaw', Math.sin(T * 30) * 0.05 * bump(p, 0.37, 0.4, 0.8, 0.9), 0, 0);
        break;
      }
      case 'hit': P.keys(prog(0.3), [[0, {}], [0.15, HIT], [1, {}]], 1, ease.out); break;
      case 'hitHeavy': P.keys(prog(0.55), [[0, {}], [0.12, HIT_HEAVY], [0.55, HIT_HEAVY], [1, {}]], 1, ease.out); break;
      case 'knockdown': {
        const f = ramp(t, 0.05, 0.7); const hitK = bump(t, 0, 0.08, 0.2, 0.45);
        P.addObj(STANCE, 1 - f); P.addObj(HIT_HEAVY, hitK);
        P.addObj(LYING, f);
        const bounce = Math.exp(-(t - 0.7) * 7) * Math.sin(Math.max(0, t - 0.7) * 18) * 0.35 * (t > 0.7 ? 1 : 0);
        P.add('hipsPos', 0, bounce, 0).add('hips', 0, 0, -bounce * 0.08);
        P.add('chest', Math.sin(T * 1.2) * 0.02 * f, 0, 0);
        break;
      }
      case 'getup': {
        const p = prog(1.0);
        P.keys(p, [
          [0, { ...LYING }],
          [0.4, { ikW: [-1, -1], hipsPos: [-0.3, -3.2, -0.3], hips: [0.45, 0, 0.6], spine: [0.35, 0, 0.1], chest: [0.3, 0, 0], neck: [-0.4, 0, 0], head: [-0.2, 0, 0], thighL: [-1.2, 0, -0.3], shinL: [1.6, 0, 0], thighR: [-0.7, 0, 0.3], shinR: [1.3, 0, 0], armR: [-0.6, 0, -0.1], foreR: [0.2, 0, 0], armL: [-0.5, 0, 0.3], tail0: [0, 0, -0.2] }],
          [0.72, { ...STANCE, ...CROUCH, hipsPos: [0, -2.4, -0.2], spine: [0.3, 0, 0], chest: [0.3, 0, 0] }],
          [1, { ...STANCE }],
        ]);
        break;
      }
      case 'ko': {
        const buckle = ramp(t, 0.1, 0.55); const fall = ramp(t, 0.5, 1.35);
        P.addObj(STANCE, 1 - fall);
        P.addObj(HIT_HEAVY, bump(t, 0, 0.1, 0.25, 0.5));
        P.addObj({ hipsPos: [0, -2.2, -0.3], spine: [0.3, 0, 0], chest: [0.2, 0, 0], neck: [0.4, 0, 0], head: [0.3, 0, 0], jaw: [0.35, 0, 0], armL: [0.2, 0, 0], armR: [0.2, 0, 0] }, buckle * (1 - fall));
        P.addObj(LYING, fall);
        P.addObj({ head: [0.15, 0, -0.2], jaw: [0.2, 0, 0], neck: [0.1, 0, -0.1] }, fall);
        const bounce = t > 1.35 ? Math.exp(-(t - 1.35) * 6) * Math.sin((t - 1.35) * 16) * 0.3 : 0;
        P.add('hipsPos', 0, bounce, 0);
        break;
      }
      case 'victory': {
        const c = t % 4.2;
        P.addObj(ROAR, bump(c, 0.2, 0.75, 2.6, 3.4));
        P.add('jaw', Math.sin(T * 26) * 0.04 * bump(c, 0.7, 0.9, 2.4, 2.8), 0, 0);
        P.add('head', 0.3 * bump(c, 0, 0.2, 0.3, 0.7), 0, 0);
        break;
      }
      case 'intro': case 'taunt': {
        const p = state === 'taunt' ? prog(1.6) : clamp01(t / 3.2);
        const pre = bump(p, 0, 0.12, 0.18, 0.3);
        P.addObj({ neck: [0.35, 0, 0], head: [0.3, 0, 0], chest: [0.15, 0, 0], hipsPos: [0, -0.6, 0], jaw: [0.15, 0, 0] }, pre);
        const k = bump(p, 0.2, 0.34, 0.8, 0.97);
        P.addObj(ROAR, k);
        P.add('jaw', Math.sin(T * 24) * 0.05 * k, 0, 0).add('head', Math.sin(T * 17) * 0.02 * k, Math.sin(T * 1.3) * 0.12 * k, 0);
        break;
      }
      default: break;
    }
    P.set('glow', glow);
  }

  afterUpdate(dt, a) {
    const g = Math.max(this.charge, this._glow);
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 12);
    this.uniforms.uCharge.value = g;
    this.uniforms.uGlowInt.value = 3.2 * pulse;
    this.mats.hide.emissiveIntensity = smooth(0.6, 1.5, g) * 2.2 * pulse + smooth(0.85, 1.0, g) * 0.25;
    const dim = a.state === 'ko' ? 1 - ramp(a.t || 0, 0.6, 1.6) * 0.92 : 1;
    this.mats.eye.emissiveIntensity = (2.6 + g * 3) * dim;
  }
}
