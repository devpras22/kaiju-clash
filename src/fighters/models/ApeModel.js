// OWNER: models agent. MAKORA ('ape') — King Kong-style giant ape. Procedural skinned mesh (+ fur shells) + animation.
// Rig (THREE.Skeleton, identity bind rotations): hips > spine > chest > neck > head > jaw ;
//   hips > thighL/R > shinL/R > footL/R ; chest > clavL/R > armL/R > foreL/R > handL/R > fingL/R
import * as THREE from 'three';
import { Builder, RigDef, fbm3, noise3, smooth, clamp, hash1, lerp } from './geometry.js';
import { MonsterBase, patchMaterial, ease, ramp, bump, gait, clamp01 } from './rig.js';
import { getFurTextures, getSkinTextures, getBoneTextures } from './textures.js';

function boneDefs() {
  const b = [
    { name: 'hips', parent: null, pos: [0, 6.2, -0.7], tip: [0, 8.0, -0.5] },
    { name: 'spine', parent: 'hips', pos: [0, 8.0, -0.5] },
    { name: 'chest', parent: 'spine', pos: [0, 9.9, 0.1], tipChild: 'neck' },
    { name: 'neck', parent: 'chest', pos: [0, 11.4, 1.1] },
    { name: 'head', parent: 'neck', pos: [0, 12.3, 1.8], tip: [0, 12.3, 3.8] },
    { name: 'jaw', parent: 'head', pos: [0, 11.8, 2.1], tip: [0, 11.45, 3.6] },
  ];
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R'; const x = (v) => v * s;
    b.push(
      { name: 'thigh' + S, parent: 'hips', pos: [x(1.55), 5.8, -0.7] },
      { name: 'shin' + S, parent: 'thigh' + S, pos: [x(1.85), 3.3, 0.45] },
      { name: 'foot' + S, parent: 'shin' + S, pos: [x(1.95), 0.85, -0.5], tip: [x(2.05), 0.25, 1.5] },
      { name: 'clav' + S, parent: 'chest', pos: [x(0.9), 11.0, 0.4] },
      { name: 'arm' + S, parent: 'clav' + S, pos: [x(3.2), 10.8, 0.4] },
      { name: 'fore' + S, parent: 'arm' + S, pos: [x(4.0), 7.2, 0.8] },
      { name: 'hand' + S, parent: 'fore' + S, pos: [x(4.25), 3.7, 1.4] },
      { name: 'fing' + S, parent: 'hand' + S, pos: [x(4.3), 2.55, 1.8], tip: [x(4.35), 1.35, 2.1] },
    );
  }
  return b;
}
let RIG = null;

const PALETTES = {
  default: { fur: [0.02, 0.012, 0.008], tip: [0.06, 0.036, 0.02], skin: [0.045, 0.033, 0.028], eye: 0xffa326, glow: 0xff7a2f, sheen: 0x8a5a38 },
  alt: { fur: [0.05, 0.05, 0.052], tip: [0.16, 0.16, 0.17], skin: [0.03, 0.03, 0.034], eye: 0x7fd6ff, glow: 0x49c8ff, sheen: 0xb8c0cc },
};

let GEO = null;
function buildGeometry() {
  if (GEO) return GEO;
  const B = new Builder(RIG);
  const pal = PALETTES.default;
  const furCol = (p, n) => {
    const v = fbm3(p.x * 0.3, p.y * 0.3, p.z * 0.3, 3) * 0.5 + 0.5;
    const tipK = smooth(0.3, 0.9, n.y) * 0.5 + smooth(0.55, 0.8, v) * 0.5; // lighter on top surfaces
    return pal.fur.map((c, i) => lerp(c, pal.tip[i], tipK * 0.8) * (0.8 + 0.4 * v));
  };
  const skinCol = (p, k = 1) => { const v = fbm3(p.x * 0.8, p.y * 0.8, p.z * 0.8, 3) * 0.5 + 0.5; return pal.skin.map((c) => c * k * (0.8 + 0.4 * v)); };
  const clumps = (p, amp) => { // fur clumping on the silhouette: streaky along gravity
    const n = noise3(p.x * 2.2, p.y * 0.7, p.z * 2.2) * 0.6 + noise3(p.x * 5, p.y * 1.6, p.z * 5) * 0.4;
    return n * amp + fbm3(p.x * 0.35, p.y * 0.35, p.z * 0.35, 2) * amp * 1.2;
  };
  const furAttr = (k = 1) => ({ aFur: () => k });
  const FA = ['aFur'];

  // ---- torso: pelvis → barrel chest → hunched upper back/traps → neck
  B.sweep('fur', {
    pts: [[0, 4.5, -1.0], [0, 5.8, -0.95], [0, 7.3, -0.75], [0, 8.8, -0.35], [0, 10.1, 0.25], [0, 11.1, 0.85], [0, 11.9, 1.45], [0, 12.4, 1.8]],
    r: [[1.6, 1.4, 1.4], [2.35, 1.9, 1.9], [2.45, 1.85, 2.2], [2.85, 2.1, 2.35], [3.25, 2.35, 2.2], [3.0, 2.45, 1.85], [1.7, 1.55, 1.35], [1.25, 1.2, 1.1]],
    segs: 70, radial: 48, up: [0, 0, -1], capStart: 4, capEnd: 3, capLen: 0.8, uv: 0.45, attrList: FA, attr: furAttr(1),
    bones: ['hips', 'spine', 'chest', 'neck'], power: 4,
    shape: (t, a) => { // trapezius mound + lats
      const sa = Math.sin(a), ca = Math.abs(Math.cos(a));
      let m = 1 + 0.16 * Math.exp(-((t - 0.8) ** 2) / 0.006) * Math.exp(-((sa - 0.55) ** 2) / 0.08);
      m += 0.08 * Math.exp(-((t - 0.52) ** 2) / 0.01) * ca * smooth(-0.2, 0.4, sa);
      return m;
    },
    disp: (p) => clumps(p, 0.14),
    color: (p, t, a, n) => furCol(p, n),
  });
  // bare leathery chest + abdomen (skin plates over the fur torso)
  for (const s of [1, -1]) B.blob('skin', { a: [s * 1.25, 10.0, 1.55], b: [s * 1.3, 9.6, 1.85], rx: 1.45, ry: 1.0, cap: 7, capLen: 0.55, radial: 22, bones: ['chest', 'spine'], power: 6, uv: 0.6,
    disp: (p) => noise3(p.x * 2, p.y * 2, p.z * 2) * 0.03, color: (p) => { const c = skinCol(p, 1.15); const sc = Math.abs((p.y - 10.3) + (p.x - 1.2) * 0.8); return sc < 0.05 && p.x > 0.6 && p.x < 2.2 ? c.map((v) => v * 2.4) : c; } });
  B.blob('skin', { a: [0, 8.9, 1.15], b: [0, 7.4, 0.95], rx: 1.55, ry: 0.9, cap: 6, capLen: 0.6, radial: 20, bones: ['spine', 'hips', 'chest'], power: 5, uv: 0.6,
    disp: (p) => -0.06 * Math.abs(Math.sin(p.y * 3.2)) * smooth(0.3, 0, Math.abs(p.x)), color: (p) => skinCol(p, 0.95) });

  // ---- limbs (left, mirrored)
  const mH = { fur: B.mark('fur'), skin: B.mark('skin'), bone: B.mark('bone') };
  // deltoid + upper arm
  B.sweep('fur', {
    pts: [[1.9, 11.25, 0.35], [3.15, 11.0, 0.45], [3.65, 9.1, 0.65], [3.95, 7.3, 0.85], [4.0, 6.9, 0.9]],
    r: [[1.55, 1.55, 1.5], [1.7, 1.65, 1.6], [1.3, 1.3, 1.25], [1.05, 1.05, 1.05], [1.0, 1.0, 1.0]],
    segs: 30, radial: 30, up: [0, 0, 1], capStart: 0, capEnd: 3, uv: 0.45, attrList: FA, attr: furAttr(1.15),
    bones: ['chest', 'clavL', 'armL', 'foreL'], power: 6,
    disp: (p) => clumps(p, 0.14) + 0.18 * Math.exp(-((p.y - 9.3) ** 2) / 0.6) * Math.max(0, p.z - 0.4),
    color: (p, t, a, n) => furCol(p, n),
  });
  // forearm (massive)
  B.sweep('fur', {
    pts: [[4.0, 7.7, 0.8], [4.05, 6.5, 1.05], [4.18, 4.9, 1.28], [4.25, 3.75, 1.42]],
    r: [[1.1, 1.1, 1.1], [1.25, 1.2, 1.2], [0.98, 0.95, 0.95], [0.72, 0.7, 0.7]],
    segs: 26, radial: 28, up: [0, 0, 1], capStart: 2, capEnd: 0, uv: 0.45, attrList: FA, attr: { aFur: (p) => 1.4 - smooth(4.5, 3.8, p.y) * 0.8 },
    bones: ['armL', 'foreL', 'handL'], power: 6,
    disp: (p) => clumps(p, 0.16), color: (p, t, a, n) => furCol(p, n),
  });
  // hand: bare leathery palm + fingers + thumb + nails
  B.sweep('skin', { pts: [[4.25, 3.95, 1.42], [4.28, 3.25, 1.62], [4.3, 2.6, 1.82]], r: [[0.78, 0.5, 0.5], [0.85, 0.48, 0.48], [0.8, 0.42, 0.42]],
    segs: 10, radial: 20, up: [0, 0, 1], capStart: 2, capEnd: 3, capLen: 0.5, uv: 0.8, bones: ['foreL', 'handL'], power: 10, bias: [0.2, 1],
    color: (p) => skinCol(p, 0.9) });
  [[-0.54, 0.95], [-0.18, 1.08], [0.18, 1.02], [0.52, 0.85]].forEach(([dz, len]) => {
    const x0 = 4.3, z0 = 1.82 + dz * 0.5, y0 = 2.65; const off = dz * 0.95;
    const pts = [[x0 - 0.02, y0, z0 + off * 0.1], [x0, y0 - len * 0.5, z0 + off * 0.12 + 0.04], [x0 - 0.08, y0 - len, z0 + off * 0.12 + 0.02]];
    // fingers fan along the hand width (z in hand plane → use x offset along local width)
    const P2 = pts.map((q) => [q[0] + off * 0, q[1], q[2] + off * 0.5]);
    B.sweep('skin', { pts: P2, r: [[0.22, 0.23], [0.2, 0.21], [0.17, 0.18]], segs: 8, radial: 12, capStart: 1, capEnd: 2, uv: 0.8, bones: ['fingL'], color: (p) => skinCol(p, 0.85) });
    const e = P2[2];
    B.blob('bone', { a: [e[0] - 0.1, e[1] + 0.1, e[2]], b: [e[0] - 0.14, e[1] - 0.12, e[2]], rx: 0.13, ry: 0.05, cap: 3, radial: 8, bone: 'fingL', uv: 2, color: () => [0.08, 0.07, 0.06] });
  });
  B.sweep('skin', { pts: [[4.2, 3.3, 2.0], [4.15, 2.85, 2.35], [4.05, 2.45, 2.45]], r: [[0.27, 0.27], [0.23, 0.23], [0.19, 0.19]], segs: 8, radial: 12, capEnd: 2, uv: 0.8, bone: 'handL', color: (p) => skinCol(p, 0.85) });
  // thigh / shin / foot
  B.sweep('fur', {
    pts: [[1.25, 6.7, -0.95], [1.55, 5.85, -0.7], [1.75, 4.5, -0.1], [1.85, 3.35, 0.45], [1.87, 2.9, 0.4]],
    r: [[1.55, 1.6, 1.6], [1.75, 1.8, 1.8], [1.5, 1.55, 1.55], [1.1, 1.15, 1.15], [1.05, 1.05, 1.05]],
    segs: 24, radial: 30, up: [0, 0, 1], capEnd: 3, uv: 0.45, attrList: FA, attr: furAttr(1),
    bones: ['hips', 'thighL', 'shinL'], power: 6, disp: (p) => clumps(p, 0.13), color: (p, t, a, n) => furCol(p, n),
  });
  B.sweep('fur', {
    pts: [[1.86, 3.8, 0.5], [1.9, 2.3, 0.0], [1.95, 1.05, -0.45], [1.95, 0.8, -0.55]],
    r: [[1.1, 1.1, 1.1], [0.95, 0.95, 0.95], [0.78, 0.78, 0.78], [0.72, 0.72, 0.72]],
    segs: 18, radial: 26, up: [0, 0, 1], capStart: 2, capEnd: 0, uv: 0.45, attrList: FA, attr: { aFur: (p) => smooth(0.8, 1.8, p.y) },
    bones: ['thighL', 'shinL', 'footL'], power: 7, disp: (p) => clumps(p, 0.1), color: (p, t, a, n) => furCol(p, n),
  });
  B.sweep('skin', { pts: [[1.95, 0.62, -1.3], [1.98, 0.55, -0.3], [2.03, 0.42, 0.75], [2.06, 0.32, 1.35]], r: [[0.72, 0.5, 0.5], [0.95, 0.6, 0.55], [1.0, 0.45, 0.42], [0.9, 0.32, 0.32]],
    segs: 14, radial: 22, up: [0, 1, 0], capStart: 4, capEnd: 3, capLen: 0.7, uv: 0.8, bones: ['shinL', 'footL'], power: 9, bias: [0.3, 1], color: (p) => skinCol(p, 0.8) });
  for (let i = 0; i < 4; i++) {
    const x = 1.62 + i * 0.26, z = 1.35 + (i === 1 || i === 2 ? 0.1 : 0);
    B.blob('skin', { a: [x, 0.3, z], b: [x + 0.02, 0.24, z + 0.42], rx: 0.16, ry: 0.15, cap: 4, radial: 10, bone: 'footL', uv: 0.8, color: (p) => skinCol(p, 0.8) });
  }
  B.blob('skin', { a: [2.55, 0.35, 0.7], b: [2.85, 0.3, 1.2], rx: 0.24, ry: 0.2, cap: 4, radial: 10, bone: 'footL', uv: 0.8, color: (p) => skinCol(p, 0.8) }); // opposable big toe
  const toR = (n) => (/L$/.test(n) ? n.slice(0, -1) + 'R' : n);
  B.mirror('fur', mH.fur, toR); B.mirror('skin', mH.skin, toR); B.mirror('bone', mH.bone, toR);

  // ---- head: furred cranium with sagittal crest, bare face, heavy brow, muzzle, jaw, canines
  B.sweep('fur', {
    pts: [[0, 11.9, 0.75], [0, 12.45, 1.55], [0, 12.55, 2.35], [0, 12.35, 2.75]],
    r: [[1.15, 1.05, 1.0], [1.4, 1.3, 1.1], [1.3, 1.05, 1.05], [1.05, 0.8, 0.9]],
    segs: 22, radial: 36, up: [0, 1, 0], capStart: 4, capEnd: 3, capLen: 0.6, uv: 0.5, attrList: FA, attr: furAttr(0.8), bones: ['head'],
    shape: (t, a) => 1 + 0.12 * Math.exp(-((Math.sin(a) - 1) ** 2) / 0.02) * Math.exp(-((t - 0.45) ** 2) / 0.05), // sagittal crest
    disp: (p) => clumps(p, 0.08), color: (p, t, a, n) => furCol(p, n),
  });
  B.blob('skin', { a: [0, 12.4, 2.25], b: [0, 12.35, 2.6], rx: 1.0, ry: 0.62, cap: 7, capLen: 0.5, radial: 28, bone: 'head', uv: 0.8, color: (p) => skinCol(p, 1.0) }); // face mask
  B.sweep('skin', { pts: [[-1.1, 12.62, 2.55], [-0.5, 12.8, 3.0], [0, 12.72, 3.05], [0.5, 12.8, 3.0], [1.1, 12.62, 2.55]], r: [[0.2, 0.2], [0.3, 0.24], [0.26, 0.2], [0.3, 0.24], [0.2, 0.2]],
    segs: 20, radial: 14, up: [0, 1, 0], capStart: 2, capEnd: 2, uv: 0.8, bone: 'head', color: (p) => skinCol(p, 0.9) }); // brow ridge
  B.sweep('skin', { pts: [[0, 12.05, 2.35], [0, 11.95, 3.15], [0, 11.9, 3.6]], r: [[1.0, 0.62, 0.5], [0.95, 0.58, 0.45], [0.8, 0.48, 0.38]],
    segs: 14, radial: 28, up: [0, 1, 0], capStart: 0, capEnd: 4, capLen: 0.55, uv: 0.8, bone: 'head',
    color: (p) => { const nd = Math.hypot(Math.abs(p.x) - 0.28, p.y - 12.2, p.z - 3.7); const c = skinCol(p, 1.0); return nd < 0.17 ? c.map((v) => v * 0.15) : p.y < 11.62 ? [0.1, 0.02, 0.025] : c; } }); // muzzle
  for (const s of [1, -1]) B.blob('skin', { a: [s * 0.3, 12.25, 3.55], b: [s * 0.34, 12.2, 3.85], rx: 0.2, ry: 0.15, cap: 4, radial: 10, bone: 'head', uv: 0.8, color: (p) => skinCol(p, 0.9) }); // nostril wings
  B.sweep('skin', { pts: [[0, 11.55, 2.15], [0, 11.5, 3.0], [0, 11.5, 3.55]], r: [[0.95, 0.22, 0.45], [0.85, 0.2, 0.4], [0.68, 0.16, 0.3]],
    segs: 14, radial: 26, up: [0, 1, 0], capStart: 3, capEnd: 3, capLen: 0.6, uv: 0.8, bone: 'jaw',
    color: (p, t, a) => (Math.sin(a) > 0.4 ? [0.12, 0.025, 0.03] : skinCol(p, 0.9)) });
  B.sweep('fur', { pts: [[0, 11.2, 1.6], [0, 11.25, 2.6], [0, 11.35, 3.2]], r: [[0.9, 0.3, 0.4], [0.75, 0.25, 0.3], [0.5, 0.18, 0.2]],
    segs: 10, radial: 18, up: [0, 1, 0], capStart: 2, capEnd: 2, uv: 0.5, attrList: FA, attr: furAttr(1.3), bone: 'jaw', disp: (p) => clumps(p, 0.06), color: (p, t, a, n) => furCol(p, n) }); // beard
  for (const s of [1, -1]) {
    B.sweep('bone', { pts: [[s * 0.5, 11.85, 3.4], [s * 0.5, 11.62, 3.45], [s * 0.47, 11.38, 3.4]], r: [[0.1, 0.1], [0.08, 0.08], [0.01, 0.01]], segs: 4, radial: 8, bone: 'head', uv: 2, color: () => [0.5, 0.46, 0.38] });
    B.sweep('bone', { pts: [[s * 0.42, 11.5, 3.35], [s * 0.42, 11.7, 3.38], [s * 0.4, 11.86, 3.34]], r: [[0.08, 0.08], [0.06, 0.06], [0.01, 0.01]], segs: 4, radial: 8, bone: 'jaw', uv: 2, color: () => [0.48, 0.44, 0.36] });
    for (let i = 0; i < 3; i++) {
      const x = s * (0.12 + i * 0.12);
      B.blob('bone', { a: [x, 11.78, 3.62 - i * 0.04], b: [x, 11.64, 3.62 - i * 0.04], rx: 0.06, ry: 0.035, cap: 2, radial: 6, bone: 'head', uv: 2, color: () => [0.5, 0.46, 0.38] });
    }
    B.blob('eye', { a: [s * 0.46, 12.5, 2.93], b: [s * 0.46, 12.5, 3.07], rx: 0.13, ry: 0.1, cap: 5, radial: 12, bone: 'head', uv: 1 });
  }
  GEO = B.build();
  return GEO;
}

function makeMaterials(u) {
  const F = getFurTextures(), S = getSkinTextures();
  const fur = new THREE.MeshPhysicalMaterial({
    vertexColors: true, map: F.map, normalMap: F.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughnessMap: F.roughnessMap, roughness: 1, metalness: 0,
    sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0x8a5a38), emissiveMap: F.emissiveMap, emissive: 0xff7a2f, emissiveIntensity: 0,
  });
  patchMaterial(fur, u, { key: 'fur' });
  const shells = [];
  const N = 4;
  for (let k = 1; k <= N; k++) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: F.map, normalMap: F.normalMap, roughnessMap: F.roughnessMap, roughness: 1, metalness: 0,
      alphaTest: 0.3 + 0.5 * (k / N), emissiveMap: F.emissiveMap, emissive: 0xff7a2f, emissiveIntensity: 0 });
    const su = { ...u, uShell: { value: 0.07 * k }, uShellK: { value: k / N } };
    patchMaterial(m, su, {
      key: 'furshell',
      vertDecl: 'attribute float aFur; uniform float uShell; uniform float uShellK;',
      vert: 'transformed += normal * uShell * aFur; transformed.y -= uShell * uShellK * aFur * 0.6; vColor.rgb *= 1.0 + uShellK * 0.6;',
    });
    shells.push(m);
  }
  const skin = new THREE.MeshPhysicalMaterial({ vertexColors: true, map: S.map, normalMap: S.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughnessMap: S.roughnessMap, roughness: 1,
    clearcoat: 0.25, clearcoatRoughness: 0.5, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x553a30), emissiveMap: S.emissiveMap, emissive: 0xff7a2f, emissiveIntensity: 0 });
  patchMaterial(skin, u, { key: 'apeskin' });
  const BT = getBoneTextures();
  const bone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, normalMap: BT.normalMap });
  patchMaterial(bone, u, { key: 'bone' });
  const eye = new THREE.MeshStandardMaterial({ color: 0x2a1000, emissive: 0xffa326, emissiveIntensity: 3, roughness: 0.15 });
  patchMaterial(eye, u, { key: 'eye' });
  return { fur, shells, skin, bone, eye };
}

// ---------------------------------------------------------------- poses
const STANCE = {
  hipsPos: [0, -0.45, 0], hips: [0.12, 0, 0], spine: [0.16, 0, 0], chest: [0.14, 0, 0], neck: [-0.3, 0, 0], head: [-0.08, 0, 0],
  armL: [-0.28, 0.1, 0.1], armR: [-0.28, 0.1, 0.1], foreL: [-0.2, 0, 0], foreR: [-0.2, 0, 0], handL: [-0.1, 0, 0], handR: [-0.1, 0, 0],
  fingL: [0, 0, -0.7], fingR: [0, 0, -0.7], clavL: [0, 0, 0.05], clavR: [0, 0, 0.05],
};
const FIST = (s) => ({ ['fing' + s]: [0, 0, -1.0], ['hand' + s]: [0.1, 0, 0] });
const GUARD = { armL: [-0.75, -0.1, -0.15], foreL: [-1.5, 0, 0], armR: [-0.7, -0.1, -0.1], foreR: [-1.55, 0, 0], ...FIST('L'), ...FIST('R'), chest: [0.05, 0, 0] };
const add = (...objs) => { const o = {}; for (const x of objs) for (const k in x) { const v = x[k]; o[k] = o[k] ? (typeof v === 'number' ? o[k] + v : o[k].map((q, i) => q + v[i])) : (typeof v === 'number' ? v : v.slice()); } return o; };
const JAB = [
  [0, {}],
  [0.22, add(GUARD, { chest: [0, 0.22, 0], spine: [0, 0.1, 0], armL: [-0.25, 0, 0.1], foreL: [-0.1, 0, 0] })],
  [0.42, add(GUARD, { hipsPos: [0, -0.2, 0.7], chest: [0.1, -0.5, 0], spine: [0.05, -0.2, 0], hips: [0, -0.1, 0], armL: [-0.95, 0.15, 0.2], foreL: [1.45, 0, 0], head: [0, 0.25, 0], neck: [0.1, 0.1, 0], jaw: [0.3, 0, 0] })],
  [0.62, add(GUARD, { hipsPos: [0, -0.2, 0.6], chest: [0.1, -0.45, 0], armL: [-0.9, 0.15, 0.2], foreL: [1.35, 0, 0], head: [0, 0.2, 0] })],
  [1, {}],
];
const KICK = [
  [0, {}],
  [0.3, add(GUARD, { ikW: [0, -1], thighR: [-1.55, 0, 0.1], shinR: [1.7, 0, 0], footR: [0.2, 0, 0], hipsPos: [0, 0.1, -0.3], chest: [-0.25, 0, 0], spine: [-0.15, 0, 0], armL: [0.3, 0, 0.5], armR: [0.3, 0, 0.5] })],
  [0.5, add(GUARD, { ikW: [0, -1], thighR: [-1.35, 0, 0.1], shinR: [0.25, 0, 0], footR: [-0.5, 0, 0], hipsPos: [0, 0.0, 0.3], hips: [-0.2, 0, 0], chest: [-0.2, 0, 0], armL: [0.5, 0, 0.7], armR: [0.4, 0, 0.6], jaw: [0.4, 0, 0] })],
  [0.72, add(GUARD, { ikR: [0, 0, 2.2], hipsPos: [0, -0.9, 1.1], chest: [0.2, 0, 0], spine: [0.15, 0, 0], jaw: [0.3, 0, 0] })],
  [0.86, add(GUARD, { ikR: [0, 1.0, 1.1], hipsPos: [0, -0.5, 0.5] })],
  [1, {}],
];
const HEAVY = [
  [0, {}],
  [0.4, { armL: [-2.95, 0, -0.25], armR: [-2.95, 0, -0.25], foreL: [-0.7, 0, 0], foreR: [-0.7, 0, 0], ...FIST('L'), ...FIST('R'), clavL: [0, 0, 0.35], clavR: [0, 0, 0.35], spine: [-0.3, 0, 0], chest: [-0.4, 0, 0], neck: [0.15, 0, 0], head: [-0.2, 0, 0], hipsPos: [0, 0.5, -0.5], jaw: [0.55, 0, 0] }],
  [0.56, { armL: [-1.1, 0, -0.3], armR: [-1.1, 0, -0.3], foreL: [-0.15, 0, 0], foreR: [-0.15, 0, 0], ...FIST('L'), ...FIST('R'), spine: [0.45, 0, 0], chest: [0.55, 0, 0], hips: [0.15, 0, 0], neck: [-0.35, 0, 0], head: [-0.2, 0, 0], hipsPos: [0, -2.0, 1.3], jaw: [0.75, 0, 0] }],
  [0.74, { armL: [-1.0, 0, -0.3], armR: [-1.0, 0, -0.3], foreL: [-0.1, 0, 0], foreR: [-0.1, 0, 0], ...FIST('L'), ...FIST('R'), spine: [0.45, 0, 0], chest: [0.5, 0, 0], hips: [0.15, 0, 0], neck: [-0.3, 0, 0], hipsPos: [0, -2.1, 1.3], jaw: [0.4, 0, 0] }],
  [1, {}],
];
const HURL = [
  [0, {}],
  [0.25, { hipsPos: [0, -2.5, 0.7], spine: [0.5, 0.15, 0], chest: [0.45, 0.25, 0], neck: [-0.55, 0, 0], armR: [-0.85, 0, 0.25], foreR: [-0.2, 0, 0], fingR: [0, 0, 0.5], armL: [-0.3, 0, 0.3] }],
  [0.4, { hipsPos: [0, -1.3, 0.3], spine: [0.2, 0.1, 0], chest: [0.15, 0.1, 0], neck: [-0.3, 0, 0], armR: [-1.3, 0, 0.2], foreR: [-1.0, 0, 0], fingR: [0, 0, -0.9], armL: [-1.1, 0, 0.1], foreL: [-0.9, 0, 0], jaw: [0.6, 0, 0] }],
  [0.56, { hipsPos: [0, 0.2, -0.5], spine: [-0.25, -0.2, 0], chest: [-0.2, -0.55, 0], neck: [-0.1, 0.3, 0], armR: [-2.6, 0.1, 0.55], foreR: [-1.5, 0, 0], fingR: [0, 0, -0.9], armL: [-1.3, 0, 0.3], foreL: [-0.2, 0, 0], jaw: [0.4, 0, 0] }],
  [0.64, { hipsPos: [0, -0.7, 1.1], spine: [0.25, 0.25, 0], chest: [0.35, 0.65, 0], neck: [-0.2, -0.3, 0], armR: [-1.65, 0, 0.1], foreR: [-0.1, 0, 0], fingR: [0, 0, 0.2], armL: [0.3, 0, 0.5], foreL: [-0.4, 0, 0], jaw: [0.9, 0, 0] }],
  [0.8, { hipsPos: [0, -0.9, 1.0], spine: [0.3, 0.25, 0], chest: [0.4, 0.6, 0], armR: [-0.7, 0, -0.3], foreR: [-0.2, 0, 0], armL: [0.3, 0, 0.4], jaw: [0.5, 0, 0] }],
  [1, {}],
];
const LEAP = [
  [0, {}],
  [0.14, { hipsPos: [0, -2.4, -0.2], spine: [0.4, 0, 0], chest: [0.3, 0, 0], neck: [-0.4, 0, 0], armL: [0.9, 0, 0.3], armR: [0.9, 0, 0.3], foreL: [-0.2, 0, 0], foreR: [-0.2, 0, 0] }],
  [0.26, { hipsPos: [0, 0.4, 0], spine: [-0.2, 0, 0], chest: [-0.25, 0, 0], armL: [-2.8, 0, 0.1], armR: [-2.8, 0, 0.1], foreL: [-0.4, 0, 0], foreR: [-0.4, 0, 0], ...FIST('L'), ...FIST('R'), ikW: [-0.7, -0.7], jaw: [0.6, 0, 0] }],
  [0.5, { hipsPos: [0, 0.2, 0], spine: [-0.3, 0, 0], chest: [-0.35, 0, 0], armL: [-3.0, 0, -0.2], armR: [-3.0, 0, -0.2], foreL: [-0.6, 0, 0], foreR: [-0.6, 0, 0], ...FIST('L'), ...FIST('R'), ikW: [-1, -1], thighL: [-1.1, 0, 0.15], shinL: [1.5, 0, 0], thighR: [-0.9, 0, 0.15], shinR: [1.4, 0, 0], jaw: [0.8, 0, 0] }],
  [0.6, { hipsPos: [0, -0.2, 0.4], spine: [0.1, 0, 0], chest: [0.1, 0, 0], armL: [-2.2, 0, -0.2], armR: [-2.2, 0, -0.2], ...FIST('L'), ...FIST('R'), ikW: [-0.5, -0.5], thighL: [-0.6, 0, 0], shinL: [0.8, 0, 0], thighR: [-0.5, 0, 0], shinR: [0.8, 0, 0], jaw: [0.8, 0, 0] }],
  [0.68, { hipsPos: [0, -2.4, 1.2], spine: [0.55, 0, 0], chest: [0.55, 0, 0], hips: [0.2, 0, 0], neck: [-0.4, 0, 0], armL: [-0.9, 0, -0.25], armR: [-0.9, 0, -0.25], foreL: [0, 0, 0], foreR: [0, 0, 0], ...FIST('L'), ...FIST('R'), jaw: [0.9, 0, 0] }],
  [0.85, { hipsPos: [0, -2.2, 1.1], spine: [0.5, 0, 0], chest: [0.5, 0, 0], hips: [0.2, 0, 0], neck: [-0.4, 0, 0], armL: [-0.85, 0, -0.2], armR: [-0.85, 0, -0.2], ...FIST('L'), ...FIST('R'), jaw: [0.5, 0, 0] }],
  [1, {}],
];
const BEAT_BASE = { hipsPos: [0, 0.55, -0.3], hips: [-0.12, 0, 0], spine: [-0.26, 0, 0], chest: [-0.28, 0, 0], neck: [0.1, 0, 0], head: [-0.22, 0, 0],
  armL: [-0.8, -0.35, -0.3], armR: [-0.8, -0.35, -0.3], foreL: [-1.75, 0, 0], foreR: [-1.75, 0, 0], fingL: [0, 0, 0.5], fingR: [0, 0, 0.5], jaw: [0.35, 0, 0] };
const ROAR = { hipsPos: [0, 0.5, -0.3], hips: [-0.1, 0, 0], spine: [-0.25, 0, 0], chest: [-0.3, 0, 0], neck: [-0.25, 0, 0], head: [-0.35, 0, 0], jaw: [0.9, 0, 0],
  armL: [-0.9, 0, 1.0], armR: [-0.9, 0, 1.0], foreL: [-1.2, 0, 0], foreR: [-1.2, 0, 0], ...FIST('L'), ...FIST('R'), clavL: [0, 0, 0.3], clavR: [0, 0, 0.3] };
const HIT = { hipsPos: [0, -0.2, -0.5], spine: [-0.15, 0, 0.05], chest: [-0.25, 0.12, 0], neck: [-0.1, 0, 0], head: [-0.45, 0.2, 0.1], jaw: [0.5, 0, 0], armL: [0.35, 0, 0.4], armR: [0.3, 0, 0.3], foreL: [0.2, 0, 0] };
const HIT_HEAVY = { hipsPos: [0, -0.7, -1.4], spine: [-0.3, 0, 0.1], chest: [-0.35, 0.25, 0], neck: [-0.2, 0, 0], head: [-0.5, 0.3, 0.15], jaw: [0.75, 0, 0], armL: [0.7, 0, 0.8], armR: [0.5, 0, 0.7], foreL: [0.2, 0, 0], ikR: [0, 0, -0.9] };
const ON_BACK = { ikW: [-1, -1], hipsPos: [0, -4.1, -1.6], hips: [-1.45, 0, 0], spine: [0.1, 0, 0], chest: [0.12, 0, 0], neck: [0.35, 0.2, 0], head: [0.2, 0.3, 0], jaw: [0.3, 0, 0],
  thighL: [-0.45, 0, 0.25], shinL: [0.9, 0, 0], thighR: [-0.2, 0, 0.15], shinR: [0.5, 0, 0], armL: [-0.5, 0, 1.25], foreL: [-0.4, 0, 0], armR: [-0.9, 0, 1.0], foreR: [-0.6, 0, 0], fingL: [0, 0, 0.3], fingR: [0, 0, 0.3] };
const FACE_DOWN = { ikW: [-1, -1], hipsPos: [0, -4.3, 2.0], hips: [1.42, 0, 0.05], spine: [0.05, 0, 0], chest: [0.05, 0, 0], neck: [-0.35, 0.9, 0], head: [-0.1, 0.4, 0.3], jaw: [0.35, 0, 0],
  thighL: [-0.35, 0, 0.2], shinL: [0.3, 0, 0], thighR: [-0.25, 0, 0.1], shinR: [0.5, 0, 0], footL: [0.8, 0, 0], footR: [0.8, 0, 0],
  armL: [-2.2, 0, 0.6], foreL: [-0.5, 0, 0], armR: [0.3, 0, 0.3], foreR: [-0.2, 0, 0], fingL: [0, 0, 0.3], fingR: [0, 0, 0.3] };
const CROUCH = { hipsPos: [0, -2.4, -0.2], hips: [0.2, 0, 0], spine: [0.3, 0, 0], chest: [0.25, 0, 0], neck: [-0.5, 0, 0], head: [-0.1, 0, 0], armL: [-0.5, 0, 0.2], armR: [-0.5, 0, 0.2], foreL: [-0.2, 0, 0], foreR: [-0.2, 0, 0] };
const BLOCK = add(GUARD, { hipsPos: [0, -0.8, -0.3], chest: [0.15, -0.2, 0], neck: [0.1, 0, 0], head: [0.3, 0, 0], armL: [-0.6, -0.2, -0.3], foreL: [-0.2, 0, 0], armR: [-0.6, -0.2, -0.3], foreR: [-0.2, 0, 0] });
const JUMP = [
  [0, {}],
  [0.14, { hipsPos: [0, -2.0, 0], spine: [0.3, 0, 0], armL: [0.7, 0, 0.3], armR: [0.7, 0, 0.3] }],
  [0.28, { hipsPos: [0, 0.4, 0], spine: [-0.15, 0, 0], armL: [-1.6, 0, 0.5], armR: [-1.6, 0, 0.5], ikW: [-0.6, -0.6] }],
  [0.45, { thighL: [-1.0, 0, 0.15], shinL: [1.4, 0, 0], thighR: [-0.8, 0, 0.15], shinR: [1.3, 0, 0], ikW: [-1, -1], armL: [-1.2, 0, 0.9], armR: [-1.2, 0, 0.9], foreL: [-0.6, 0, 0], foreR: [-0.6, 0, 0] }],
  [0.8, { thighL: [-0.7, 0, 0.1], shinL: [1.0, 0, 0], thighR: [-0.6, 0, 0.1], shinR: [0.9, 0, 0], ikW: [-1, -1], armL: [-0.8, 0, 0.9], armR: [-0.8, 0, 0.9] }],
  [0.9, { hipsPos: [0, -2.2, 0.3], spine: [0.35, 0, 0], chest: [0.2, 0, 0], neck: [-0.3, 0, 0], armL: [-0.5, 0, 0.3], armR: [-0.5, 0, 0.3] }],
  [1, {}],
];

// ---------------------------------------------------------------- model
export class ApeModel extends MonsterBase {
  constructor(opts = {}) {
    if (!RIG) RIG = new RigDef(boneDefs());
    super('ape', RIG, opts);
    const geo = buildGeometry();
    this.mats = makeMaterials(this.uniforms);
    this.addSkinned(geo.fur, this.mats.fur);
    this.mats.shells.forEach((m, i) => this.addSkinned(geo.fur, m, { shadow: false, order: i + 1 }));
    this.addSkinned(geo.skin, this.mats.skin);
    this.addSkinned(geo.bone, this.mats.bone);
    this.addSkinned(geo.eye, this.mats.eye, { shadow: false });
    this.materials = [this.mats.fur, ...this.mats.shells, this.mats.skin, this.mats.bone, this.mats.eye];
    this.geometries = []; // shared cached geometry
    this.addLeg('L'); this.addLeg('R');
    const loc = (bone, p) => { const bp = RIG.bones[RIG.index[bone]].pos; return [p[0] - bp[0], p[1] - bp[1], p[2] - bp[2]]; };
    this.sockets = {
      mouth: ['head', loc('head', [0, 11.7, 3.9]), [0, 0, 1]],
      head: ['head', loc('head', [0, 12.5, 2.6]), [0, 0, 1]],
      chest: ['chest', loc('chest', [0, 9.9, 2.6]), [0, 0, 1]],
      handL: ['fingL', loc('fingL', [4.25, 2.0, 1.95]), [0, -1, 0]], handR: ['fingR', loc('fingR', [-4.25, 2.0, 1.95]), [0, -1, 0]],
      footL: ['footL', loc('footL', [2.0, 0.3, 0.6]), [0, 0, 1]], footR: ['footR', loc('footR', [-2.0, 0.3, 0.6]), [0, 0, 1]],
    };
    const idx = RIG.index;
    this.springs.push({ ch: idx.jaw * 3, k: 300, d: 18 });
    for (const s of ['L', 'R']) { this.springs.push({ ch: idx['fore' + s] * 3, k: 260, d: 20 }); this.springs.push({ ch: idx['hand' + s] * 3, k: 200, d: 14 }); }
    this.setSkin(opts.skin || 'default');
  }

  setSkin(variant = 'default') {
    this.skin = PALETTES[variant] ? variant : 'default';
    const p = PALETTES[this.skin], d = PALETTES.default;
    const tint = new THREE.Color(p.fur[0] / d.fur[0], p.fur[1] / d.fur[1], p.fur[2] / d.fur[2]);
    for (const m of [this.mats.fur, ...this.mats.shells]) { m.color.copy(tint); m.emissive.set(p.glow); }
    this.mats.fur.sheenColor.set(p.sheen);
    this.mats.skin.color.setRGB(p.skin[0] / d.skin[0], p.skin[1] / d.skin[1], p.skin[2] / d.skin[2]); this.mats.skin.emissive.set(p.glow);
    this.mats.eye.emissive.set(p.eye);
  }

  fadeFor(state, prev) {
    if (state === 'hit' || state === 'hitHeavy') return 0.05;
    if (state === 'knockdown' || state === 'ko') return 0.08;
    if (prev === 'walk' || prev === 'walkBack' || state === 'walk' || state === 'idle') return 0.16;
    return 0.1;
  }

  _beat(P, t, k, rate = 7) { // alternating chest beats with open palms
    const ph = t * rate;
    const l = Math.max(0, Math.sin(ph * Math.PI)), r = Math.max(0, -Math.sin(ph * Math.PI));
    P.addObj(BEAT_BASE, k);
    P.add('armL', -0.45 * r * k + 0.25 * l * k, 0, 0.15 * r * k).add('foreL', 0.35 * r * k, 0, 0);
    P.add('armR', -0.45 * l * k + 0.25 * r * k, 0, 0.15 * l * k).add('foreR', 0.35 * l * k, 0, 0);
    P.add('chest', 0.03 * (l + r) * k, 0.06 * (l - r) * k, 0);
  }

  pose(state, a, P, dt) {
    const t = a.t || 0; const T = this.time;
    const prog = (dur) => (a.progress !== undefined && a.progress !== null && (a.progress > 0 || t === 0) ? clamp01(a.progress) : clamp01(t / dur));
    const standing = !(state === 'knockdown' || state === 'ko' || state === 'getup');
    if (standing) P.addObj(STANCE);
    const br = Math.sin(T * 1.9);
    P.add('chest', br * 0.03, 0, 0).add('hipsPos', 0, br * 0.05, 0).add('clavL', 0, 0, br * 0.02).add('clavR', 0, 0, br * 0.02);
    let glow = 0;
    switch (state) {
      case 'idle': {
        const look = Math.sin(T * 0.45) * 0.15;
        P.add('neck', 0, look * 0.5, 0).add('head', Math.sin(T * 0.6) * 0.04, look * 0.6, Math.sin(T * 0.33) * 0.05);
        P.add('armL', Math.sin(T * 0.8) * 0.04, 0, 0).add('armR', Math.sin(T * 0.75 + 1) * 0.04, 0, 0);
        P.add('hipsPos', Math.sin(T * 0.6) * 0.12, 0, 0);
        P.add('jaw', Math.max(0, Math.sin(T * 0.5) - 0.9) * 2.5, 0, 0);
        break;
      }
      case 'walk': case 'walkBack': case 'sidestep': {
        const lateral = state === 'sidestep';
        const dir = state === 'walkBack' ? -1 : lateral ? (a.dir || 1) : 1;
        const sp = Math.abs(a.speed || 0) || (lateral ? 6 : 7.5);
        const stride = lateral ? 5.0 : 7.0;
        this.walkPhase += (dt * sp / stride) * dir;
        const ph = this.walkPhase;
        gait(P, ph, { stride, lift: 1.0, stance: 0.6, lateral, bob: 0.4, sway: 0.3, yaw: 0.14, roll: 0.05 });
        const s = Math.sin(ph * Math.PI * 2);
        P.add('spine', 0.08, -s * 0.1, 0).add('chest', 0.06, -s * 0.18, s * 0.04).add('neck', 0, s * 0.12, 0).add('head', 0, s * 0.08, 0);
        P.add('armL', s * 0.35, 0, 0.05).add('armR', -s * 0.35, 0, 0.05).add('foreL', -Math.max(0, -s) * 0.3, 0, 0).add('foreR', -Math.max(0, s) * 0.3, 0, 0);
        P.add('clavL', 0, -s * 0.08, 0).add('clavR', 0, s * 0.08, 0);
        break;
      }
      case 'crouch': P.addObj(CROUCH); break;
      case 'block': P.addObj(BLOCK); break;
      case 'jump': {
        const p = prog(0.9); P.keys(p, JUMP);
        if (this.root.position.y < 0.05) P.add('bodyPos', 0, Math.sin(Math.PI * clamp01((p - 0.2) / 0.68)) * 7, 0);
        break;
      }
      case 'light': P.keys(prog(0.35), JAB); break;
      case 'kick': P.keys(prog(0.55), KICK); break;
      case 'heavy': P.keys(prog(0.85), HEAVY); break;
      case 'sp1': P.keys(prog(1.3), HURL); break;
      case 'sp2': {
        const p = prog(1.4); P.keys(p, LEAP);
        if (this.root.position.y < 0.05) P.add('bodyPos', 0, Math.sin(Math.PI * clamp01((p - 0.22) / 0.44)) * 9, 1.5 * ramp(p, 0.22, 0.66));
        break;
      }
      case 'super': {
        const p = prog(3.2);
        glow = ramp(p, 0, 0.1) * (1 - ramp(p, 0.95, 1));
        const beatK = ramp(p, 0, 0.05) * (1 - ramp(p, 0.26, 0.31));
        this._beat(P, t, beatK, 8);
        const fl = ramp(p, 0.28, 0.32) * (1 - ramp(p, 0.78, 0.82));
        if (fl > 0) {
          P.addObj(GUARD, fl); P.add('hipsPos', 0, -0.4 * fl, 0.6 * fl);
          const q = clamp01((p - 0.3) / 0.5) * 9; const i = Math.floor(q), f = q - i;
          const hit = Math.pow(Math.sin(Math.PI * f), 0.6) * fl; const L = i % 2 === 0;
          const S = L ? 'L' : 'R';
          P.add('arm' + S, -0.85 * hit, 0.15 * hit, 0.2 * hit).add('fore' + S, 1.45 * hit, 0, 0);
          P.add('chest', 0.1 * hit, (L ? -0.45 : 0.45) * hit, 0).add('spine', 0, (L ? -0.15 : 0.15) * hit, 0).add('jaw', 0.5 * hit, 0, 0);
        }
        P.keys(p, [
          [0.8, {}],
          [0.88, { hipsPos: [0, -1.8, 0.2], spine: [0.35, -0.2, 0], chest: [0.3, -0.45, 0], armR: [0.4, 0, 0.15], foreR: [-1.6, 0, 0], ...FIST('R'), armL: [-0.7, 0, 0], foreL: [-1.5, 0, 0], ...FIST('L') }],
          [0.93, { hipsPos: [0, 1.0, 0.8], spine: [-0.25, 0.2, 0], chest: [-0.35, 0.55, 0], neck: [0.1, 0, 0], head: [-0.35, 0, 0], armR: [-2.9, 0, 0.1], foreR: [-0.7, 0, 0], ...FIST('R'), armL: [0.3, 0, 0.4], foreL: [-0.8, 0, 0], jaw: [0.9, 0, 0] }],
          [0.97, { hipsPos: [0, 0.8, 0.8], spine: [-0.2, 0.2, 0], chest: [-0.3, 0.5, 0], head: [-0.3, 0, 0], armR: [-2.8, 0, 0.1], foreR: [-0.6, 0, 0], ...FIST('R'), armL: [0.3, 0, 0.4], jaw: [0.7, 0, 0] }],
          [1, {}],
        ]);
        P.add('jaw', 0.5 * beatK, 0, 0);
        break;
      }
      case 'hit': P.keys(prog(0.3), [[0, {}], [0.15, HIT], [1, {}]], 1, ease.out); break;
      case 'hitHeavy': P.keys(prog(0.55), [[0, {}], [0.12, HIT_HEAVY], [0.55, HIT_HEAVY], [1, {}]], 1, ease.out); break;
      case 'knockdown': {
        const f = ramp(t, 0.05, 0.6);
        P.addObj(STANCE, 1 - f); P.addObj(HIT_HEAVY, bump(t, 0, 0.08, 0.18, 0.4)); P.addObj(ON_BACK, f);
        const bounce = t > 0.6 ? Math.exp(-(t - 0.6) * 7) * Math.sin((t - 0.6) * 18) * 0.3 : 0;
        P.add('hipsPos', 0, bounce, 0).add('chest', Math.sin(T * 1.6) * 0.03 * f, 0, 0);
        break;
      }
      case 'getup': {
        const p = prog(0.8);
        P.keys(p, [
          [0, { ...ON_BACK }],
          [0.35, { ikW: [-1, -1], hipsPos: [0, -3.6, -0.8], hips: [-0.5, 0, 0.1], spine: [0.5, 0, 0], chest: [0.4, 0, 0], neck: [-0.3, 0, 0], thighL: [-1.3, 0, 0.3], shinL: [1.8, 0, 0], thighR: [-1.1, 0, 0.3], shinR: [1.7, 0, 0], armL: [0.6, 0, 0.35], foreL: [-0.2, 0, 0], armR: [0.6, 0, 0.35], foreR: [-0.2, 0, 0], fingL: [0, 0, 0.4], fingR: [0, 0, 0.4] }],
          [0.7, add(STANCE, CROUCH, { hipsPos: [0, -0.2, 0], armL: [0.1, 0, 0.1], armR: [0.1, 0, 0.1] })],
          [1, { ...STANCE }],
        ]);
        break;
      }
      case 'ko': {
        const buckle = ramp(t, 0.05, 0.5), fall = ramp(t, 0.45, 1.25);
        P.addObj(STANCE, 1 - fall); P.addObj(HIT_HEAVY, bump(t, 0, 0.08, 0.2, 0.45));
        P.addObj({ hipsPos: [0, -2.6, 0.4], spine: [0.4, 0, 0], chest: [0.4, 0, 0], neck: [0.3, 0, 0], armL: [0.1, 0, 0], armR: [0.1, 0, 0], jaw: [0.4, 0, 0] }, buckle * (1 - fall));
        P.addObj(FACE_DOWN, fall);
        const bounce = t > 1.25 ? Math.exp(-(t - 1.25) * 6) * Math.sin((t - 1.25) * 16) * 0.25 : 0;
        P.add('hipsPos', 0, bounce, 0);
        break;
      }
      case 'victory': {
        const c = t % 4.5;
        const beat = bump(c, 0.1, 0.35, 2.0, 2.3), roar = bump(c, 2.1, 2.5, 3.9, 4.4);
        this._beat(P, t, beat, 6.5);
        P.addObj(ROAR, roar); P.add('jaw', Math.sin(T * 25) * 0.05 * roar, 0, 0);
        break;
      }
      case 'intro': case 'taunt': {
        const p = state === 'taunt' ? prog(1.6) : clamp01(t / 3.2);
        const beat = bump(p, 0.05, 0.15, 0.55, 0.65), roar = bump(p, 0.58, 0.7, 0.9, 1.0);
        this._beat(P, t, beat, 7);
        P.addObj(ROAR, roar); P.add('jaw', Math.sin(T * 25) * 0.05 * roar, 0, 0).add('head', 0, Math.sin(T * 1.7) * 0.15 * roar, 0);
        break;
      }
      default: break;
    }
    P.set('glow', glow);
  }

  afterUpdate(dt, a) {
    const g = Math.max(this.charge, this._glow);
    const pulse = 0.8 + 0.2 * Math.sin(this.time * 10);
    const ev = smooth(0.1, 1.0, g) * pulse;
    this.mats.fur.emissiveIntensity = ev * 1.6;
    for (const m of this.mats.shells) m.emissiveIntensity = ev * 1.2;
    this.mats.skin.emissiveIntensity = ev * 2.2;
    const dim = a.state === 'ko' ? 1 - ramp(a.t || 0, 0.6, 1.6) * 0.92 : 1;
    this.mats.eye.emissiveIntensity = (2.4 + g * 5) * dim;
  }
}
