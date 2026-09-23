// OWNER: world/visuals agent. Renderer + post-processing chain.
// CONTRACT: new Renderer(container); .renderer (THREE.WebGLRenderer); .render(scene, camera); .resize(); .setBloom(strength)
// OPTIONAL EXTRAS (world agent):
//   .setGrade({ exposure, saturation, contrast, vignette, grain, aberration }) — any subset
//   .pulse(amount = 1, color = 0xcfe4ff) — quick additive white/blue screen flash for big hits (decays ~0.25s)
//   .quality — current pixel ratio (adaptive: drops when frame time is bad, recovers when good)
// Chain: RenderPass (HDR half-float) → UnrealBloom → OutputPass (ACES + sRGB) → SMAA → Grade (teal/orange split tone,
// saturation/contrast, vignette, grain, chromatic aberration, pulse flash). No SSAO (kept for 60fps budget).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uSat: { value: 1.12 }, uContrast: { value: 1.08 }, uVignette: { value: 0.42 },
    uGrain: { value: 0.035 }, uCA: { value: 0.0018 }, uPulse: { value: 0 }, uPulseColor: { value: new THREE.Color(0xcfe4ff) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uSat, uContrast, uVignette, uGrain, uCA, uPulse; uniform vec3 uPulseColor; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 7.13) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 off = c * uCA * (1.0 + r2 * 4.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // split tone: teal shadows, warm highlights
      col = mix(col, col * vec3(0.86, 1.02, 1.1), (1.0 - smoothstep(0.0, 0.45, l)) * 0.5);
      col = mix(col, col * vec3(1.08, 1.0, 0.9), smoothstep(0.5, 1.0, l) * 0.4);
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      col *= 1.0 - uVignette * smoothstep(0.1, 0.75, r2 * 1.6);
      col += uPulseColor * uPulse;
      col += (h(vUv * 1000.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class Renderer {
  constructor(container) {
    this.container = container;
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.maxPR = Math.min(window.devicePixelRatio || 1, 2);
    this.quality = this.maxPR;
    r.setPixelRatio(this.quality);
    r.setSize(window.innerWidth, window.innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    r.info.autoReset = false;
    this.renderer = r;
    this.composer = null;
    this._pulse = 0; this._t = 0; this._last = performance.now();
    this._ft = 16.7; this._adaptT = 0;
    window.addEventListener('resize', () => this.resize());
    Renderer.instance = this;
  }

  _ensureComposer(scene, camera) {
    if (this.composer && this._scene === scene && this._camera === camera) return;
    this._scene = scene; this._camera = camera;
    const w = window.innerWidth, h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.quality);
    this.composer.setSize(w, h);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setBloom(strength) { if (this.bloom) this.bloom.strength = strength; }

  setGrade({ exposure, saturation, contrast, vignette, grain, aberration } = {}) {
    if (exposure !== undefined) this.renderer.toneMappingExposure = exposure;
    const u = (this.grade || { uniforms: GradeShader.uniforms }).uniforms;
    if (saturation !== undefined) u.uSat.value = saturation;
    if (contrast !== undefined) u.uContrast.value = contrast;
    if (vignette !== undefined) u.uVignette.value = vignette;
    if (grain !== undefined) u.uGrain.value = grain;
    if (aberration !== undefined) u.uCA.value = aberration;
  }

  pulse(amount = 1, color = 0xcfe4ff) {
    this._pulse = Math.max(this._pulse, amount * 0.6);
    if (this.grade) this.grade.uniforms.uPulseColor.value.set(color);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.quality);
    this.renderer.setSize(w, h);
    if (this.composer) { this.composer.setPixelRatio(this.quality); this.composer.setSize(w, h); }
    if (this._camera) { this._camera.aspect = w / h; this._camera.updateProjectionMatrix(); }
  }

  _adapt(dtMs) {
    this._ft += (dtMs - this._ft) * 0.05;
    this._adaptT += dtMs;
    if (this._adaptT < 2000) return;
    this._adaptT = 0;
    let q = this.quality;
    if (this._ft > 22 && q > 1) q = Math.max(1, q - 0.25);
    else if (this._ft < 13 && q < this.maxPR) q = Math.min(this.maxPR, q + 0.25);
    if (q !== this.quality) { this.quality = q; this.resize(); }
  }

  render(scene, camera) {
    this._ensureComposer(scene, camera);
    const now = performance.now(), dt = Math.min(100, now - this._last); this._last = now;
    this._adapt(dt);
    this._t += dt / 1000;
    this._pulse *= Math.exp(-dt / 1000 * 9);
    const u = this.grade.uniforms; u.uTime.value = this._t % 100; u.uPulse.value = this._pulse;
    this.renderer.info.reset();
    this.composer.render();
  }
}
