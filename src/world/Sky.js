// OWNER: world agent. Storm skydome (fbm clouds, moon glow, orange city horizon glow, lightning-lit clouds),
// distant mountain silhouettes, GPU rain streaks around the camera, lightning bolts + flashes, height fog chunks.
import * as THREE from 'three';
import { GLSL_NOISE, mulberry32, makeNoise2 } from './util.js';

// Exponential height fog, patched into three's fog chunks (applies to every fogged material).
export function installHeightFog() {
  if (THREE.ShaderChunk.__kaijuFog) return;
  THREE.ShaderChunk.__kaijuFog = true;
  THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth; varying vec3 vFogWorld;\n#endif';
  THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z; vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);\n#endif';
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
    uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogWorld;
    #ifdef FOG_EXP2
      uniform float fogDensity;
    #else
      uniform float fogNear; uniform float fogFar;
    #endif
  #endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
    #ifdef FOG_EXP2
      vec3 fRay = vFogWorld - cameraPosition; float fL = length(fRay);
      const float fB = 0.028;
      float kfDy = fRay.y; float fk = abs(kfDy) > 0.01 ? (1.0 - exp(-fB * kfDy)) / (fB * kfDy) : 1.0;
      float fAmt = fogDensity * fL * (exp(-fB * max(cameraPosition.y, 0.0)) * fk * 2.2 + 0.25);
      float fogFactor = 1.0 - exp(-fAmt);
      vec3 fCol = mix(fogColor, fogColor * vec3(1.9, 1.15, 0.75), exp(-max(vFogWorld.y, 0.0) * 0.04) * 0.6);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth); vec3 fCol = fogColor;
    #endif
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fCol, fogFactor);
  #endif`;
}

export class Sky {
  constructor(scene, moonDir) {
    this.scene = scene;
    this.uniforms = {
      uTime: { value: 0 }, uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector3(1, 0.3, 0).normalize() },
      uMoon: { value: moonDir.clone().normalize() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform float uTime; uniform float uFlash; uniform vec3 uFlashDir; uniform vec3 uMoon; varying vec3 vDir;
        ${GLSL_NOISE}
        void main(){
          vec3 d = normalize(vDir); float h = d.y;
          vec3 zen = vec3(0.004, 0.007, 0.018), hor = vec3(0.03, 0.055, 0.07);
          vec3 col = mix(hor, zen, smoothstep(0.0, 0.55, h));
          float glow = exp(-max(h, 0.0) * 9.0);
          float az = 0.6 + 0.4 * sin(atan(d.z, d.x) * 2.0 + 1.0);
          col += vec3(0.55, 0.2, 0.06) * glow * az * 0.55;
          vec2 cp = d.xz / (max(h, 0.02) + 0.18) * 1.3;
          float cl = fbm(cp + vec2(uTime * 0.012, uTime * 0.005));
          float cl2 = fbm(cp * 2.2 - vec2(uTime * 0.02, 0.0));
          float dens = smoothstep(0.35, 0.8, cl * 0.75 + cl2 * 0.35);
          float md = max(dot(d, uMoon), 0.0);
          vec3 moon = vec3(0.6, 0.75, 1.0) * (pow(md, 900.0) * 30.0 * (1.0 - dens * 0.85) + pow(md, 40.0) * 0.5 + pow(md, 6.0) * 0.06);
          vec3 cloudCol = mix(vec3(0.012, 0.018, 0.028), vec3(0.06, 0.07, 0.09), cl2) + vec3(0.35, 0.13, 0.04) * glow * az * 0.8 + vec3(0.25, 0.3, 0.4) * pow(md, 8.0) * 0.4;
          col = mix(col + moon, cloudCol, dens * smoothstep(-0.02, 0.1, h));
          float fl = uFlash * (pow(max(dot(d, uFlashDir), 0.0), 6.0) * 2.5 + 0.25);
          col += vec3(0.6, 0.7, 1.0) * fl * (0.25 + dens * 1.5);
          if (h < 0.0) col = mix(hor * 0.6, col, exp(h * 30.0));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(2500, 48, 24), mat);
    this.dome.frustumCulled = false; this.dome.renderOrder = -10;
    scene.add(this.dome);
    this._mountains();
    this._rain();
    this._lightning();
  }

  _mountains() {
    const n = makeNoise2(3), segs = 360, pos = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2, R = 2000;
      const h = 40 + 230 * Math.pow(n.fbm(i * 0.035, 0.5, 5), 2.2) * (1.2 + Math.sin(a * 3) * 0.4);
      pos.push(Math.cos(a) * R, -30, Math.sin(a) * R, Math.cos(a) * R, h, Math.sin(a) * R);
      if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.ShaderMaterial({ side: THREE.DoubleSide, fog: false, uniforms: { uFlash: this.uniforms.uFlash },
      vertexShader: 'varying float vH; void main(){ vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float uFlash; varying float vH; void main(){ vec3 c = mix(vec3(0.03,0.045,0.055), vec3(0.012,0.018,0.026), smoothstep(0.0,150.0,vH)); c += vec3(0.1,0.12,0.16)*uFlash; gl_FragColor = vec4(c,1.0); }' });
    this.mountains = new THREE.Mesh(g, m); this.mountains.renderOrder = -9; this.mountains.frustumCulled = false;
    this.scene.add(this.mountains);
  }

  _rain() {
    const N = 9000, r = mulberry32(8);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const off = new Float32Array(N * 4); for (let i = 0; i < N * 4; i++) off[i] = r();
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = N;
    this.rainU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uFlash: this.uniforms.uFlash };
    const m = new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `uniform float uTime; uniform vec3 uCam; attribute vec4 aOff; varying float vA; varying float vX;
        void main(){
          vec3 box = vec3(90.0, 60.0, 90.0);
          vec3 wind = vec3(6.0, -55.0, 2.5) * (0.85 + 0.3 * aOff.w);
          vec3 p = aOff.xyz * box + wind * uTime;
          p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
          vec3 dir = normalize(wind);
          vec3 toC = normalize(cameraPosition - p);
          vec3 side = normalize(cross(dir, toC));
          float dist = length(cameraPosition - p);
          vec3 wp = p + side * position.x * 0.045 * (1.0 + dist * 0.02) - dir * position.y * 1.6;
          vA = smoothstep(2.0, 8.0, dist) * (1.0 - smoothstep(25.0, 45.0, dist)) * (1.0 - position.y * 0.8);
          vX = position.x;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `uniform float uFlash; varying float vA; varying float vX;
        void main(){ float e = 1.0 - abs(vX) * 2.0; gl_FragColor = vec4(vec3(0.55, 0.65, 0.8) * (0.22 + uFlash * 1.5) * vA * e, 1.0); }`,
    });
    this.rain = new THREE.Mesh(g, m); this.rain.frustumCulled = false; this.rain.renderOrder = 5;
    this.scene.add(this.rain);
  }

  _lightning() {
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 9, 14), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
    this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), this.boltMat);
    this.bolt.frustumCulled = false; this.bolt.visible = false;
    this.scene.add(this.bolt);
    this.nextStrike = 3; this.strikeT = -1; this.flash = 0;
    this.seq = [];
  }
  _makeBolt(camera) {
    const r = Math.random;
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const a = Math.atan2(fwd.z, fwd.x) + (r() - 0.5) * 1.6, dist = 500 + r() * 700;
    const base = new THREE.Vector3(camera.position.x + Math.cos(a) * dist, 0, camera.position.z + Math.sin(a) * dist);
    const top = base.clone().add(new THREE.Vector3((r() - 0.5) * 200, 420 + r() * 150, (r() - 0.5) * 200));
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const pos = [];
    const addStrip = (from, to, w, segs, depth) => {
      let prev = from.clone();
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const p = from.clone().lerp(to, t);
        if (i < segs) p.addScaledVector(side, (r() - 0.5) * 40 * (depth ? 0.6 : 1)).add(new THREE.Vector3(0, (r() - 0.5) * 12, 0));
        const ww = w * (1 - t * 0.5);
        pos.push(prev.x - side.x * ww, prev.y, prev.z - side.z * ww, prev.x + side.x * ww, prev.y, prev.z + side.z * ww, p.x + side.x * ww, p.y, p.z + side.z * ww,
          prev.x - side.x * ww, prev.y, prev.z - side.z * ww, p.x + side.x * ww, p.y, p.z + side.z * ww, p.x - side.x * ww, p.y, p.z - side.z * ww);
        if (!depth && r() < 0.18) {
          const end = p.clone().add(new THREE.Vector3((r() - 0.5) * 160, -60 - r() * 100, (r() - 0.5) * 60));
          addStrip(p, end, ww * 0.5, 6, 1);
        }
        prev = p;
      }
    };
    addStrip(top, base, 1.6, 22, 0);
    this.bolt.geometry.dispose();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.bolt.geometry = g;
    this.uniforms.uFlashDir.value.copy(top).sub(camera.position).normalize();
    return base;
  }

  // returns current flash intensity (0..~1)
  update(dt, camera, time) {
    this.uniforms.uTime.value = time;
    this.rainU.uTime.value = time; this.rainU.uCam.value.copy(camera.position);
    this.dome.position.copy(camera.position);
    this.nextStrike -= dt;
    if (this.nextStrike <= 0) {
      this.nextStrike = 5 + Math.random() * 10;
      this.strikePos = this._makeBolt(camera);
      this.seq = [[0, 1], [0.06, 0.15], [0.12, 0.9], [0.2, 0.1], [0.3, 0.6], [0.45, 0]];
      this.strikeT = 0;
    }
    let f = 0;
    if (this.strikeT >= 0) {
      this.strikeT += dt;
      for (const [t, v] of this.seq) if (this.strikeT >= t) f = v;
      if (this.strikeT > 0.6) { this.strikeT = -1; f = 0; }
    }
    this.flash = f;
    this.bolt.visible = f > 0.05;
    this.boltMat.opacity = f;
    this.uniforms.uFlash.value = f;
    return f;
  }
}
