// OWNER: world agent. Shared helpers: seeded RNG, city street layout (mirrored in GLSL), value noise.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Street grid -------------------------------------------------------------------------------
// Streets run along both axes every PITCH units. The two streets through the origin are wide avenues.
export const PITCH = 48;
export const SIDEWALK = 3;
export const PLAZA_R = 36;
export const COAST_Z = -400; // water beyond (z < COAST_Z)
export function streetHalf(k) { return k === 0 ? 13 : 7; }

// GLSL mirror of the layout (keep in sync with the JS above).
export const GLSL_LAYOUT = /* glsl */`
  const float PITCH = 48.0;
  const float SIDEWALK = 3.0;
  const float PLAZA_R = 36.0;
  const float COAST_Z = -400.0;
  // returns local offset from nearest street centre line in .x, street half width in .y, street index in .z
  vec3 streetAxis(float x) {
    float k = floor((x + PITCH * 0.5) / PITCH);
    float l = x - PITCH * k;
    float hw = abs(k) < 0.5 ? 13.0 : 7.0;
    return vec3(l, hw, k);
  }
`;

export const GLSL_NOISE = /* glsl */`
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
  float fbm3(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

// Simple JS value noise (for canvas textures / terrain)
export function makeNoise2(seed = 1) {
  const r = mulberry32(seed); const P = new Float32Array(256 * 256);
  for (let i = 0; i < P.length; i++) P[i] = r();
  const at = (x, y) => P[((y & 255) << 8) | (x & 255)];
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  n.fbm = (x, y, oct = 5) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); f *= 2.03; a *= 0.5; } return s; };
  return n;
}
