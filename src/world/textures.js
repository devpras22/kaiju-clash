// OWNER: world agent. Canvas-generated textures for the city (neon sign atlas, water normals).
import * as THREE from 'three';
import { makeNoise2 } from './util.js';

// 4x4 atlas of neon signs, white glyphs with soft glow (tinted per instance, additive).
export function makeNeonAtlas() {
  const S = 256, N = 4;
  const c = document.createElement('canvas'); c.width = c.height = S * N;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  const signs = [
    { t: 'HOTEL', f: 'bold 64px Arial' }, { t: 'BAR', f: 'bold 110px Georgia' }, { t: 'カイジュウ', f: 'bold 50px sans-serif' }, { t: '24H', f: 'bold 110px Arial' },
    { t: 'ラーメン', f: 'bold 60px sans-serif' }, { t: 'CLUB', f: 'italic bold 84px Georgia' }, { t: 'OPEN', f: 'bold 80px Arial' }, { t: '寿司', f: 'bold 120px serif' },
    { t: 'NEO', f: 'bold 100px Arial', box: 1 }, { t: 'CAFE', f: 'italic 84px Georgia' }, { t: '→', f: 'bold 170px Arial' }, { t: 'TOKYO', f: 'bold 58px Arial', box: 1 },
    { t: '電気', f: 'bold 120px serif' }, { t: 'MOTEL', f: 'bold 62px Georgia' }, { t: '★', f: '160px Arial' }, { t: 'DRUGS', f: 'bold 60px Arial', box: 1 },
  ];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  signs.forEach((s, i) => {
    const x = (i % N) * S + S / 2, y = Math.floor(i / N) * S + S / 2;
    g.save();
    g.beginPath(); g.rect(x - S / 2, y - S / 2, S, S); g.clip();
    for (const [blur, alpha, lw] of [[28, 0.55, 10], [12, 0.8, 6], [0, 1, 2.5]]) {
      g.shadowColor = '#fff'; g.shadowBlur = blur; g.globalAlpha = alpha;
      g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = lw; g.font = s.f;
      if (s.box) { g.strokeRect(x - S * 0.43, y - S * 0.3, S * 0.86, S * 0.6); }
      if (blur > 0) g.strokeText(s.t, x, y); else g.fillText(s.t, x, y);
    }
    g.restore();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// Tileable water normal map from summed value-noise octaves.
export function makeWaterNormal(size = 256) {
  const n = makeNoise2(7);
  const h = new Float32Array(size * size);
  const per = 8; // periodic sampling for tiling
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let s = 0, a = 1, f = 1;
    for (let o = 0; o < 4; o++) {
      const P = per * f;
      // periodic noise via wrap of integer lattice
      const fx = u * P, fy = v * P;
      const xi = Math.floor(fx), yi = Math.floor(fy), xf = fx - xi, yf = fy - yi;
      const w = (ix, iy) => n(((ix % P) + P) % P + o * 37, ((iy % P) + P) % P + o * 91);
      const uu = xf * xf * (3 - 2 * xf), vv = yf * yf * (3 - 2 * yf);
      const val = (w(xi, yi) * (1 - uu) + w(xi + 1, yi) * uu) * (1 - vv) + (w(xi, yi + 1) * (1 - uu) + w(xi + 1, yi + 1) * uu) * vv;
      s += val * a; a *= 0.5; f *= 2;
    }
    h[y * size + x] = s;
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
    const hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
    const nx = -hx * 3, ny = -hy * 3, nz = 1; const l = Math.hypot(nx, ny, nz);
    const i = (y * size + x) * 4;
    data[i] = (nx / l * 0.5 + 0.5) * 255; data[i + 1] = (ny / l * 0.5 + 0.5) * 255; data[i + 2] = (nz / l * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
