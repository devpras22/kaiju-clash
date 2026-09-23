// OWNER: models agent. Procedural, tileable PBR texture sets for the monsters (cached — generated once per page).
//   getHideTextures()  → { map, normalMap, roughnessMap, emissiveMap }  craggy scaled saurian hide
//   getFurTextures()   → { map (alpha = strand height for shells), normalMap, roughnessMap, emissiveMap (veins) }
//   getSkinTextures()  → { map, normalMap, roughnessMap, emissiveMap }  leathery wrinkled ape skin
//   getBoneTextures()  → { normalMap, roughnessMap }  spines / claws / teeth
import * as THREE from 'three';

const cache = {};

// ---- tileable 2D value/gradient-ish noise with integer period
function h2(x, y, s) { let n = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; n = (n ^ (n >>> 13)) * 1274126177; n = n ^ (n >>> 16); return (n >>> 0) / 4294967295; }
function vnoise(x, y, per, seed) {
  const xi = Math.floor(x), yi = Math.floor(y); const fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const m = (v) => ((v % per) + per) % per;
  const a = h2(m(xi), m(yi), seed), b = h2(m(xi + 1), m(yi), seed), c = h2(m(xi), m(yi + 1), seed), d = h2(m(xi + 1), m(yi + 1), seed);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}
function tfbm(u, v, per, oct, seed) { // u,v in [0,1)
  let a = 0, amp = 1, n = 0, p = per;
  for (let i = 0; i < oct; i++) { a += vnoise(u * p, v * p, p, seed + i * 17) * amp; n += amp; amp *= 0.5; p *= 2; }
  return a / n;
}
/** Tileable Voronoi: returns [F1, F2, cellId] for point in cell space with `per` cells. */
function voronoi(u, v, per, seed, jitter = 0.9) {
  const x = u * per, y = v * per; const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j; const mx = ((cx % per) + per) % per, my = ((cy % per) + per) % per;
    const px = cx + 0.5 + (h2(mx, my, seed) - 0.5) * jitter, py = cy + 0.5 + (h2(mx, my, seed + 7) - 0.5) * jitter;
    const dx = px - x, dy = py - y; const d = Math.sqrt(dx * dx + dy * dy);
    if (d < f1) { f2 = f1; f1 = d; id = h2(mx, my, seed + 3); } else if (d < f2) f2 = d;
  }
  return [f1, f2, id];
}
const sm = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

function heightToNormal(H, S, strength) {
  const out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const xl = (x - 1 + S) % S, xr = (x + 1) % S, yu = (y - 1 + S) % S, yd = (y + 1) % S;
    const dx = (H[y * S + xr] - H[y * S + xl]) * strength;
    const dy = (H[yd * S + x] - H[yu * S + x]) * strength;
    let nx = -dx, ny = dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (y * S + x) * 4; out[k] = (nx * 0.5 + 0.5) * 255; out[k + 1] = (ny * 0.5 + 0.5) * 255; out[k + 2] = (nz * 0.5 + 0.5) * 255; out[k + 3] = 255;
  }
  return out;
}
function tex(data, S, srgb) {
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
function gray(G, S, alpha) {
  const d = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { const v = Math.min(255, Math.max(0, G[i] * 255)); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = alpha ? Math.min(255, Math.max(0, alpha[i] * 255)) : 255; }
  return d;
}

// ------------------------------------------------------------------ saurian hide
export function getHideTextures() {
  if (cache.hide) return cache.hide;
  const S = 512; const H = new Float32Array(S * S), A = new Float32Array(S * S), R = new Float32Array(S * S), E = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // warp for organic cells
    const wu = u + tfbm(u, v, 4, 3, 11) * 0.035, wv = v + tfbm(u, v, 4, 3, 23) * 0.035;
    const [a1, a2, id] = voronoi(wu, wv, 7, 5);           // big plates / scutes
    const edge = a2 - a1;
    const plate = sm(0.0, 0.28, edge) * (0.75 + 0.25 * id);
    const dome = (1 - Math.min(a1 * 1.3, 1)) * 0.35;
    const [b1, b2] = voronoi(wu, wv, 23, 9);              // small pebbly scales
    const small = sm(0.0, 0.2, b2 - b1) * 0.5 + (1 - Math.min(b1 * 1.5, 1)) * 0.25;
    const crackN = Math.abs(tfbm(wu * 1.0, wv * 1.0, 6, 4, 31));
    const crack = 1 - sm(0.0, 0.06, crackN);              // thin crack lines
    const bump = tfbm(u, v, 16, 3, 41);
    const h = plate * 0.55 + dome * plate + small * 0.3 * (0.4 + 0.6 * plate) - crack * 0.45 + bump * 0.08;
    const i = y * S + x;
    H[i] = h;
    const cav = sm(0.05, 0.5, plate) * (1 - crack * 0.8);
    A[i] = 0.55 + 0.45 * cav * (0.85 + 0.3 * tfbm(u, v, 8, 2, 51)) + 0.1 * id * plate;
    R[i] = 0.92 - 0.42 * cav * plate + crack * 0.08;
    E[i] = Math.max(crack, (1 - sm(0.0, 0.12, edge)) * 0.8);
  }
  const rough = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { rough[i * 4] = 255; rough[i * 4 + 1] = Math.min(255, R[i] * 255); rough[i * 4 + 2] = 0; rough[i * 4 + 3] = 255; }
  cache.hide = {
    map: tex(gray(A, S), S, true),
    normalMap: tex(heightToNormal(H, S, 9), S, false),
    roughnessMap: tex(rough, S, false),
    emissiveMap: tex(gray(E, S), S, true),
  };
  return cache.hide;
}

// ------------------------------------------------------------------ ape fur
export function getFurTextures() {
  if (cache.fur) return cache.fur;
  const S = 512; const H = new Float32Array(S * S), A = new Float32Array(S * S), AL = new Float32Array(S * S), R = new Float32Array(S * S), E = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // clumps: voronoi elongated along v (fur flows along the limb axis = v)
    const flow = tfbm(u, v, 3, 3, 7) * 0.08;
    const cu = u + flow, cv = v;
    const [c1, c2, cid] = voronoi(cu, cv, 14, 3, 1.0);
    const clump = 1 - Math.min(c1 * 1.6, 1);
    // strands: high-frequency across (u), low along (v)
    const st = tfbm(cu * 1.0, cv * 1.0, 64, 2, 19) * 0.6 + tfbm(cu, cv, 128, 1, 29) * 0.4;
    const strand = st * 0.5 + 0.5;
    const i = y * S + x;
    H[i] = clump * 0.6 + strand * 0.55 + (c2 - c1) * 0.2;
    A[i] = 0.55 + 0.35 * strand + 0.25 * clump * (0.6 + 0.4 * cid) + 0.1 * tfbm(u, v, 4, 2, 61);
    // shell alpha: tall at clump centres, strand noise on top
    AL[i] = Math.min(1, clump * 0.8 + strand * 0.45) ;
    R[i] = 0.62 + 0.25 * (1 - strand);
    // veins for charge glow: sparse ridged lines
    const vn = Math.abs(tfbm(u, v * 0.5 + 0.1, 5, 4, 71));
    E[i] = (1 - sm(0.0, 0.035, vn)) * (0.6 + 0.4 * tfbm(u, v, 3, 2, 77));
  }
  // directional strand normals: stretch height gradient across u
  const HS = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S; const flow = tfbm(u, v, 3, 3, 7) * 0.08;
    HS[y * S + x] = H[y * S + x] + tfbm((u + flow), v * 0.12, 96, 2, 83) * 0.5;
  }
  const rough = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { rough[i * 4] = 255; rough[i * 4 + 1] = R[i] * 255; rough[i * 4 + 2] = 0; rough[i * 4 + 3] = 255; }
  cache.fur = {
    map: tex(gray(A, S, AL), S, true),
    normalMap: tex(heightToNormal(HS, S, 6), S, false),
    roughnessMap: tex(rough, S, false),
    emissiveMap: tex(gray(E, S), S, true),
  };
  return cache.fur;
}

// ------------------------------------------------------------------ ape bare skin
export function getSkinTextures() {
  if (cache.skin) return cache.skin;
  const S = 256; const H = new Float32Array(S * S), A = new Float32Array(S * S), R = new Float32Array(S * S), E = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // wrinkles: anisotropic ridged lines + pores
    const w = Math.abs(tfbm(u * 1.0 + tfbm(u, v, 4, 2, 5) * 0.1, v * 0.35, 12, 3, 13));
    const wr = 1 - sm(0.0, 0.1, w);
    const [p1] = voronoi(u, v, 48, 17);
    const pore = 1 - sm(0.0, 0.18, p1);
    const i = y * S + x;
    H[i] = -wr * 0.6 - pore * 0.15 + tfbm(u, v, 8, 3, 21) * 0.25;
    A[i] = 0.8 + 0.2 * tfbm(u, v, 6, 3, 31) - wr * 0.25;
    R[i] = 0.55 + wr * 0.3 + 0.1 * tfbm(u, v, 5, 2, 41);
    const vn = Math.abs(tfbm(u, v, 4, 4, 91));
    E[i] = 1 - sm(0.0, 0.05, vn);
  }
  const rough = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { rough[i * 4] = 255; rough[i * 4 + 1] = R[i] * 255; rough[i * 4 + 2] = 0; rough[i * 4 + 3] = 255; }
  cache.skin = {
    map: tex(gray(A, S), S, true),
    normalMap: tex(heightToNormal(H, S, 5), S, false),
    roughnessMap: tex(rough, S, false),
    emissiveMap: tex(gray(E, S), S, true),
  };
  return cache.skin;
}

// ------------------------------------------------------------------ bone / keratin (spines, claws, teeth)
export function getBoneTextures() {
  if (cache.bone) return cache.bone;
  const S = 256; const H = new Float32Array(S * S); const R = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const ridges = Math.abs(tfbm(u * 0.3, v, 24, 3, 3));
    const i = y * S + x;
    H[i] = tfbm(u, v, 8, 4, 9) * 0.5 - (1 - sm(0, 0.12, ridges)) * 0.5;
    R[i] = 0.5 + 0.3 * tfbm(u, v, 6, 2, 12);
  }
  const rough = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { rough[i * 4] = 255; rough[i * 4 + 1] = Math.max(0, Math.min(255, R[i] * 255)); rough[i * 4 + 2] = 0; rough[i * 4 + 3] = 255; }
  cache.bone = { normalMap: tex(heightToNormal(H, S, 4), S, false), roughnessMap: tex(rough, S, false) };
  return cache.bone;
}
