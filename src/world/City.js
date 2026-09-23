// OWNER: world/visuals agent. Procedural destructible city, sky, lighting, weather.
// CONTRACT (must be preserved):
//   new City(scene, renderer: THREE.WebGLRenderer, fx: FX)
//   city.arenaRadius : number — fighters are clamped inside this radius around origin (≈ 60)
//   city.update(dt, camera)
//   city.reset() — rebuild/restore all buildings for a new match
//   city.impact(position: Vector3, radius, force) — damage/destroy buildings in radius (attacks, knockdowns, beams). Returns number of buildings hit.
//   city.fighterContact(position: Vector3, radius, velocity: Vector3) — called every frame per fighter; crushes/damages
//       buildings the fighter walks or is knocked into. Returns true if something was hit.
//   city.groundHeight(x, z) → number (0 for flat)
// OPTIONAL EXTRAS (world agent):
//   city.impact(pos, radius, force, { heat }) — heat 0..1 adds scorch/ember glow (beams)
//   city.setFocus(v: Vector3) — point the camera-cutout / shadow frustum at (default: derived from camera ray)
//   city.lightningFlash : number 0..1 (current flash, e.g. for audio thunder / UI)
//   city.collapseAt(pos) — force the nearest in-reach tower to collapse
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createBuildingMaterial, addBuildingAttributes } from './BuildingMaterial.js';
import { Destructibles } from './Destructibles.js';
import { Sky, installHeightFog } from './Sky.js';
import { makeNeonAtlas, makeWaterNormal } from './textures.js';
import { mulberry32, PITCH, SIDEWALK, PLAZA_R, COAST_Z, streetHalf, GLSL_LAYOUT, GLSL_NOISE } from './util.js';

const INNER_R = 80;      // lots closer than this are destructible
const OUTER_R = 720;     // skyline extent

export class City {
  constructor(scene, renderer, fx) {
    installHeightFog();
    this.scene = scene; this.renderer = renderer; this.fx = fx;
    this.arenaRadius = 60;
    this.time = 0; this.lightningFlash = 0;
    this._focus = new THREE.Vector3(); this._focusOverride = null;
    this.shared = { uFocus: { value: new THREE.Vector3() }, uCut: { value: 1 }, uTime: { value: 0 } };

    scene.background = new THREE.Color(0x05080d);
    this.fogBase = new THREE.Color().setRGB(0.028, 0.042, 0.055);
    scene.fog = new THREE.FogExp2(this.fogBase.clone(), 0.0042);

    this._lights();
    this._environment();
    this.sky = new Sky(scene, this.moonDir);
    this.buildingMat = createBuildingMaterial(this.shared);
    this._layout();
    this.destruct = new Destructibles(scene, this.buildingMat, fx, { neonTex: makeNeonAtlas(), uTime: this.shared.uTime });
    this.destruct.build(this.innerDefs);
    this._skyline();
    this._ground();
    this._water();
    this._props();
    this._harbor();
    this._ambientFires();
  }

  // ---------------------------------------------------------------------------------------------
  _lights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0x4a6a90, 0x2a1a10, 0.55); s.add(this.hemi);
    this.moonDir = new THREE.Vector3(-0.45, 0.55, -0.7).normalize();
    const moon = new THREE.DirectionalLight(0x9db8ff, 1.3);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 400 });
    moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.04;
    s.add(moon); s.add(moon.target); this.moon = moon;
    this.rim = new THREE.DirectionalLight(0x6fd0ff, 1.6); s.add(this.rim); s.add(this.rim.target);
    this.flashDir = new THREE.DirectionalLight(0xbfd4ff, 0); s.add(this.flashDir); s.add(this.flashDir.target);
    // warm fire lights (fixed count so shaders never recompile)
    this.fireLights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff7a30, 0, 90, 1.4); l.position.set(0, -100, 0); s.add(l); this.fireLights.push(l);
    }
  }

  _environment() {
    // Procedural night-city environment for PBR reflections: dark teal dome, orange horizon band, warm light panels.
    const env = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; void main(){ vec3 d = normalize(vP); float h = d.y;
        vec3 c = mix(vec3(0.05,0.08,0.11), vec3(0.01,0.015,0.03), smoothstep(0.0,0.6,h));
        c += vec3(1.1,0.45,0.15) * exp(-abs(h) * 10.0) * 0.35;
        if (h < 0.0) c = mix(c, vec3(0.02,0.018,0.016), smoothstep(0.0,-0.2,h));
        gl_FragColor = vec4(c,1.0); }`,
    }));
    env.add(dome);
    const r = mulberry32(3);
    for (let i = 0; i < 24; i++) {
      const a = r() * Math.PI * 2, y = 1 + r() * 8;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4 + r() * 6, 1 + r() * 4), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.06 + r() * 0.08, 0.8, 0.5).multiplyScalar(0.6 + r() * 1.2), side: THREE.DoubleSide }));
      m.position.set(Math.cos(a) * 40, y, Math.sin(a) * 40); m.lookAt(0, y, 0); env.add(m);
    }
    const moonP = new THREE.Mesh(new THREE.CircleGeometry(4, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.6, 5) }));
    moonP.position.copy(this.moonDir).multiplyScalar(45); moonP.lookAt(0, 0, 0); env.add(moonP);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pm.fromScene(env, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.4;
    pm.dispose();
    void RoomEnvironment;
  }

  // ---------------------------------------------------------------------------------------------
  _layout() {
    const rng = mulberry32(2024);
    this.innerDefs = []; this.skyDefs = []; this.lotRects = [];
    const K = Math.ceil(OUTER_R / PITCH);
    let seed = 1;
    for (let i = -K; i < K; i++) for (let j = -K; j < K; j++) {
      const x0 = PITCH * i + streetHalf(i) + SIDEWALK, x1 = PITCH * (i + 1) - streetHalf(i + 1) - SIDEWALK;
      const z0 = PITCH * j + streetHalf(j) + SIDEWALK, z1 = PITCH * (j + 1) - streetHalf(j + 1) - SIDEWALK;
      if (z0 < COAST_Z + 8) continue;
      const bc = Math.hypot((x0 + x1) / 2, (z0 + z1) / 2);
      if (bc > OUTER_R) continue;
      const nx = 1 + Math.floor(rng() * 2.6), nz = 1 + Math.floor(rng() * 2.6);
      const lw = (x1 - x0) / nx, ld = (z1 - z0) / nz;
      for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
        const lx0 = x0 + a * lw, lz0 = z0 + b * ld;
        const setX = 0.6 + rng() * 1.6, setZ = 0.6 + rng() * 1.6;
        const w = lw - setX * 2, d = ld - setZ * 2;
        if (w < 4 || d < 4) continue;
        const cx = lx0 + lw / 2, cz = lz0 + ld / 2;
        // nearest point of footprint to origin
        const nxp = Math.max(Math.abs(cx) - w / 2, 0), nzp = Math.max(Math.abs(cz) - d / 2, 0);
        const near = Math.hypot(nxp, nzp);
        if (near < PLAZA_R + 1) continue;
        const dist = Math.hypot(cx, cz);
        if (dist > 300 && rng() < (dist - 300) / 600) continue;
        seed++;
        const styleR = rng();
        const style = styleR < 0.22 ? 0 : styleR < 0.45 ? 1 : styleR < 0.65 ? 2 : styleR < 0.82 ? 3 : 4;
        const hr = rng();
        let h;
        if (near < INNER_R) {
          h = style === 1 ? 10 + hr * 10 : style === 0 ? 26 + hr * 19 : style === 3 ? 22 + hr * 20 : 14 + hr * 18;
          this.innerDefs.push({ cx, cz, w, d, h, style, seed });
        } else {
          const downtown = Math.max(0, 1 - Math.hypot(cx - 260, cz + 180) / 260);
          h = (style === 1 ? 10 + hr * 14 : 14 + hr * 34) * (1 + downtown * 2.2 * rng()) + (dist < 140 ? 0 : rng() * 10);
          this.skyDefs.push({ cx, cz, w, d, h, style, seed, rnd: rng() });
        }
      }
    }
  }

  _skyline() {
    // Stepped towers become 1-3 stacked tiers; all share one InstancedMesh with the facade shader.
    const tiers = [];
    const rng = mulberry32(77);
    for (const s of this.skyDefs) {
      const nT = s.style === 3 ? 3 : s.h > 50 && s.rnd < 0.6 ? 2 : 1;
      let y = 0, f = 1;
      for (let t = 0; t < nT; t++) {
        const th = nT === 1 ? s.h : t === 0 ? s.h * 0.6 : (s.h * 0.4) / (nT - 1);
        tiers.push({ x: s.cx, z: s.cz, w: s.w * f, d: s.d * f, y, h: th, s, H: y + th });
        y += th; f *= s.style === 3 ? 0.72 : 0.8;
      }
      s.top = y;
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const { aInfo, aInfo2, aState } = addBuildingAttributes(geo, tiers.length);
    const mesh = new THREE.InstancedMesh(geo, this.buildingMat, tiers.length);
    const m = new THREE.Matrix4();
    tiers.forEach((t, i) => {
      m.makeScale(t.w, t.h, t.d).setPosition(t.x, t.y + t.h / 2, t.z);
      mesh.setMatrixAt(i, m);
      aInfo.setXYZW(i, t.s.seed, t.s.style, t.w / 2, t.d / 2);
      aInfo2.setXYZW(i, 0, 0, t.y + t.h / 2, 0);
      aState.setXYZW(i, 1, 0, 1, t.H);
    });
    mesh.frustumCulled = false; mesh.receiveShadow = true;
    this.scene.add(mesh); this.skyline = mesh;
    // rooftop details: antennas + tanks + red aircraft beacons
    const ants = [], tanks = [], beacons = [];
    for (const s of this.skyDefs) {
      if (s.top > 40 && rng() < 0.7) { const ah = 5 + rng() * 18; ants.push([s.cx, s.top + ah / 2, s.cz, 0.3, ah]); beacons.push(s.cx, s.top + ah, s.cz); }
      else if (s.top < 40 && rng() < 0.5) tanks.push([s.cx + (rng() - 0.5) * s.w * 0.4, s.top + 1.4, s.cz + (rng() - 0.5) * s.d * 0.4]);
      if (s.top > 30 && rng() < 0.35) beacons.push(s.cx + s.w * 0.45, s.top + 0.3, s.cz + s.d * 0.45);
    }
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.6, metalness: 0.7 });
    const am = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), metal, ants.length);
    ants.forEach((a, i) => { m.makeScale(a[3], a[4], a[3]).setPosition(a[0], a[1], a[2]); am.setMatrixAt(i, m); });
    const tm = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 2.2, 10), new THREE.MeshStandardMaterial({ color: 0x3e3026, roughness: 0.9 }), tanks.length);
    tanks.forEach((a, i) => { m.makeTranslation(a[0], a[1], a[2]); tm.setMatrixAt(i, m); });
    am.frustumCulled = tm.frustumCulled = false;
    this.scene.add(am, tm);
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(beacons, 3));
    const bph = new Float32Array(beacons.length / 3).map(() => rng());
    bg.setAttribute('aPh', new THREE.BufferAttribute(bph, 1));
    this.beaconMat = new THREE.ShaderMaterial({ uniforms: { uTime: this.shared.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float aPh; uniform float uTime; varying float vB; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vB = step(0.55, fract(uTime*0.7 + aPh)); gl_PointSize = clamp(2400.0 / -mv.z, 2.0, 14.0); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vB; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(6.0,0.3,0.15) * a * a * vB, 1.0); }' });
    const pts = new THREE.Points(bg, this.beaconMat); pts.frustumCulled = false; this.scene.add(pts);
  }

  _ground() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
    this.craters = Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, 0, -1));
    this.craterIdx = 0;
    const U = { uTime: this.shared.uTime, uCraters: { value: this.craters } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vGW; uniform float uTime; uniform vec4 uCraters[12];
        ${GLSL_LAYOUT}
        ${GLSL_NOISE}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 P = vGW.xz;
          vec3 ax = streetAxis(P.x), az = streetAxis(P.y);
          float inX = step(abs(ax.x), ax.y), inZ = step(abs(az.x), az.y);        // on N-S street / E-W street
          float swX = step(abs(ax.x), ax.y + SIDEWALK), swZ = step(abs(az.x), az.y + SIDEWALK);
          float street = max(inX, inZ);
          float side = max(swX, swZ) * (1.0 - street);
          float n = fbm(P * 0.35);
          float fine = vnoise(P * 6.0);
          vec3 asphalt = vec3(0.035, 0.036, 0.04) * (0.7 + 0.5 * fine) * (0.8 + 0.4 * n);
          vec3 walk = vec3(0.16, 0.155, 0.15) * (0.8 + 0.3 * fine);
          vec2 tile = abs(fract(P / 1.2) - 0.5); walk *= 0.75 + 0.25 * smoothstep(0.44, 0.47, 0.5 - max(tile.x, tile.y) + 0.45);
          vec3 lot = vec3(0.09, 0.088, 0.085) * (0.7 + 0.5 * n);
          vec3 col = mix(lot, walk, side);
          col = mix(col, asphalt, street);
          float mark = 0.0; vec3 markCol = vec3(0.9);
          // N-S street markings
          if (inX > 0.5 && inZ < 0.5 && abs(az.x) > az.y + SIDEWALK + 0.2) {
            if (ax.z == 0.0) { float yl = step(abs(abs(ax.x) - 0.3), 0.1); mark = yl; markCol = vec3(0.9, 0.62, 0.1); float dl = step(abs(abs(ax.x) - 6.5), 0.1) * step(0.5, fract(P.y / 5.0)); if (dl > 0.0) { mark = 1.0; markCol = vec3(0.85); } }
            else mark = step(abs(ax.x), 0.1) * step(0.5, fract(P.y / 5.0));
          }
          if (inZ > 0.5 && inX < 0.5 && abs(ax.x) > ax.y + SIDEWALK + 0.2) {
            if (az.z == 0.0) { float yl = step(abs(abs(az.x) - 0.3), 0.1); if (yl > 0.0) { mark = 1.0; markCol = vec3(0.9, 0.62, 0.1); } float dl = step(abs(abs(az.x) - 6.5), 0.1) * step(0.5, fract(P.x / 5.0)); if (dl > 0.0) { mark = 1.0; markCol = vec3(0.85); } }
            else mark = max(mark, step(abs(az.x), 0.1) * step(0.5, fract(P.x / 5.0)));
          }
          // crosswalks
          float cwZ = inX * step(az.y + 0.4, abs(az.x)) * step(abs(az.x), az.y + 2.6) * step(0.5, fract(P.x / 0.9));
          float cwX = inZ * step(ax.y + 0.4, abs(ax.x)) * step(abs(ax.x), ax.y + 2.6) * step(0.5, fract(P.y / 0.9));
          if (street > 0.5 && max(cwZ, cwX) > 0.5) { mark = 1.0; markCol = vec3(0.8); }
          mark *= 0.55 + 0.45 * smoothstep(0.3, 0.6, fbm(P * 1.3));
          col = mix(col, markCol * 0.5, mark);
          // plaza
          float r = length(P);
          if (r < PLAZA_R + 1.5) {
            float ang = atan(P.y, P.x);
            vec2 pv = vec2(r / 1.6, ang * r / 1.6);
            vec2 pf = abs(fract(pv) - 0.5);
            vec3 pav = vec3(0.13, 0.125, 0.12) * (0.75 + 0.35 * hash12(floor(pv))) * (0.8 + 0.2 * smoothstep(0.42, 0.47, 0.5 - max(pf.x, pf.y) + 0.45));
            pav = mix(pav, vec3(0.05), step(abs(r - 12.0), 0.3) + step(abs(r - 24.0), 0.3));
            col = mix(col, pav, 1.0 - smoothstep(PLAZA_R, PLAZA_R + 1.5, r));
            col = mix(col, vec3(0.22), step(abs(r - PLAZA_R - 0.5), 0.35));
          }
          // wetness / puddles
          float puddle = smoothstep(0.52, 0.6, fbm(P * 0.12 + 3.0) * 0.7 + n * 0.35);
          float wet = 0.6 + 0.4 * street;
          col *= mix(1.0, 0.45, max(puddle, wet * 0.4));
          // craters from impacts
          float crater = 0.0; float ember = 0.0;
          for (int i = 0; i < 12; i++) {
            vec4 c = uCraters[i]; if (c.w < 0.0) continue;
            float d = length(P - c.xy) / c.z;
            float cr = 1.0 - smoothstep(0.55, 1.0, d + (vnoise(P * 1.5) - 0.5) * 0.35);
            float cracks = step(0.9, 1.0 - abs(vnoise(vec2(atan(P.y - c.y, P.x - c.x) * 6.0, d * 3.0)) - 0.5) * 2.0) * (1.0 - smoothstep(0.8, 1.6, d));
            crater = max(crater, max(cr * 0.85, cracks));
            ember += cr * exp(-c.w * 0.5) * smoothstep(0.5, 0.8, vnoise(P * 3.0 + c.w));
          }
          col = mix(col, vec3(0.012, 0.01, 0.009), crater);
          float gRough = mix(mix(0.9, 0.6, wet * street + side * 0.2), 0.12, puddle);
          gRough = mix(gRough, 0.95, crater);
          float gSpec = mix(0.18, 1.0, puddle) * (1.0 - crater * 0.8);
          diffuseColor.rgb = col;
          vec3 gEmit = vec3(3.0, 0.9, 0.2) * ember;
          // sodium street-lamp pools
          vec2 lampA = vec2(ax.x - sign(ax.x) * (ax.y + 1.2), mod(P.y - 8.0, 16.0) - 8.0);
          vec2 lampB = vec2(mod(P.x - 8.0, 16.0) - 8.0, az.x - sign(az.x) * (az.y + 1.2));
          float pool = exp(-dot(lampA, lampA) * 0.08) * step(abs(ax.x), ax.y + 6.0) + exp(-dot(lampB, lampB) * 0.08) * step(abs(az.x), az.y + 6.0);
          pool *= 1.0 - smoothstep(PLAZA_R - 6.0, PLAZA_R, 60.0 - r + 24.0) * 0.0;
          gEmit += vec3(1.0, 0.5, 0.2) * pool * 0.03 * (0.6 + puddle);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
        .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor *= gSpec; material.specularF90 *= gSpec;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;');
    };
    mat.customProgramCacheKey = () => 'kaiju-ground-v1';
    const g = new THREE.PlaneGeometry(1600, 1600, 1, 1); g.rotateX(-Math.PI / 2);
    g.translate(0, 0, COAST_Z + 800); // ground spans z ∈ [COAST_Z, COAST_Z+1600]
    const ground = new THREE.Mesh(g, mat);
    ground.receiveShadow = true;
    this.scene.add(ground); this.ground = ground;
  }

  _water() {
    const nrm = makeWaterNormal();
    nrm.repeat.set(60, 30);
    const mat = new THREE.MeshStandardMaterial({ color: 0x03080b, roughness: 0.06, metalness: 0.1, normalMap: nrm, normalScale: new THREE.Vector2(0.35, 0.35) });
    this.waterNormal = nrm;
    const g = new THREE.PlaneGeometry(5000, 2600); g.rotateX(-Math.PI / 2); g.translate(0, -1.2, COAST_Z - 1300);
    const w = new THREE.Mesh(g, mat); this.scene.add(w);
    // sea wall
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1600, 3, 4), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 }));
    wall.position.set(0, -0.6, COAST_Z - 1); this.scene.add(wall);
  }

  _props() {
    const rng = mulberry32(55), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    // cars along streets near the arena (static; some burning)
    const body = new THREE.BoxGeometry(0.48, 0.3, 1.15); body.translate(0, 0.22, 0);
    const cab = new THREE.BoxGeometry(0.42, 0.22, 0.6); cab.translate(0, 0.46, -0.05);
    const carGeo = mergeGeometries([body, cab]);
    const cars = [], carLights = [];
    for (let k = -5; k <= 5; k++) for (const axis of [0, 1]) {
      const c = PITCH * k, hw = streetHalf(k);
      for (let t = -300; t < 300; t += 2.2 + rng() * 6) {
        if (rng() < 0.45) continue;
        const lane = (rng() < 0.5 ? -1 : 1) * (hw - 1.2 - rng() * (hw > 10 ? 8 : 3));
        let x = axis ? t : c + lane, z = axis ? c + lane : t;
        if (Math.hypot(x, z) < PLAZA_R - 2 && rng() < 0.8) continue;
        if (z < COAST_Z + 4) continue;
        // skip intersections
        const other = axis ? x : z; const ko = Math.round(other / PITCH); if (Math.abs(other - ko * PITCH) < streetHalf(ko) + 2) continue;
        const yaw = (axis ? Math.PI / 2 : 0) + (lane > 0 ? Math.PI : 0) + (rng() - 0.5) * 0.15;
        cars.push({ x, z, yaw, burn: Math.hypot(x, z) < 150 && rng() < 0.05 });
      }
    }
    const carMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.6 });
    const carMesh = new THREE.InstancedMesh(carGeo, carMat, cars.length);
    const palette = [0x8a1010, 0x101014, 0xc8c8c8, 0x1a2a4a, 0x3a3a3a, 0xb09020, 0x204030, 0xdcdcdc];
    const col = new THREE.Color();
    cars.forEach((c, i) => {
      q.setFromAxisAngle(up, c.yaw); m.compose(new THREE.Vector3(c.x, 0, c.z), q, new THREE.Vector3(1, 1, 1));
      carMesh.setMatrixAt(i, m);
      carMesh.setColorAt(i, c.burn ? col.setRGB(0.02, 0.02, 0.02) : col.set(palette[Math.floor(rng() * palette.length)]));
      if (!c.burn && rng() < 0.5) {
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        carLights.push(c.x + fx * 0.6, 0.3, c.z + fz * 0.6, 1, c.x - fx * 0.6, 0.3, c.z - fz * 0.6, 0);
      }
    });
    carMesh.castShadow = true; carMesh.receiveShadow = true; carMesh.frustumCulled = false;
    this.scene.add(carMesh); this.carMesh = carMesh; this.cars = cars;
    // head/tail lights as points
    const lp = [], lt = [];
    for (let i = 0; i < carLights.length; i += 4) { lp.push(carLights[i], carLights[i + 1], carLights[i + 2]); lt.push(carLights[i + 3]); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setAttribute('aT', new THREE.Float32BufferAttribute(lt, 1));
    const lm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float aT; varying vec3 vC; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vC = aT > 0.5 ? vec3(3.0,2.6,2.0) : vec3(3.0,0.15,0.05); gl_PointSize = clamp(600.0 / -mv.z, 1.5, 10.0); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'varying vec3 vC; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vC*a*a,1.0); }' });
    this.carLights = new THREE.Points(lg, lm); this.carLights.frustumCulled = false; this.scene.add(this.carLights);

    // street lamps: pole + arm + glowing head in one instanced geometry (head flagged via aGlow)
    const pole = new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6); pole.translate(0, 1.6, 0);
    const arm = new THREE.BoxGeometry(0.08, 0.08, 1.0); arm.translate(0, 3.15, 0.45);
    const head = new THREE.BoxGeometry(0.28, 0.1, 0.45); head.translate(0, 3.1, 0.9);
    for (const [g, v] of [[pole, 0], [arm, 0], [head, 1]]) g.setAttribute('aGlow', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1));
    const lampGeo = mergeGeometries([pole, arm, head]);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.8 });
    lampMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * vec3(6.0, 3.4, 1.4);');
    };
    const lamps = [];
    for (let k = -4; k <= 4; k++) for (const axis of [0, 1]) {
      const c = PITCH * k, hw = streetHalf(k);
      for (let t = -200; t <= 200; t += 16) {
        for (const s of [-1, 1]) {
          const off = s * (hw + 1.2);
          const x = axis ? t + 8 : c + off, z = axis ? c + off : t + 8;
          if (z < COAST_Z + 4) continue;
          if (Math.hypot(x, z) < PLAZA_R) continue;
          lamps.push({ x, z, yaw: axis ? (s > 0 ? Math.PI : 0) : (s > 0 ? -Math.PI / 2 : Math.PI / 2) });
        }
      }
    }
    const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, lamps.length);
    lamps.forEach((l, i) => { q.setFromAxisAngle(up, l.yaw); m.compose(new THREE.Vector3(l.x, 0, l.z), q, new THREE.Vector3(1.4, 1.4, 1.4)); lampMesh.setMatrixAt(i, m); });
    lampMesh.frustumCulled = false; this.scene.add(lampMesh); this.lampMesh = lampMesh; this.lamps = lamps;
    this.lampOrig = lampMesh.instanceMatrix.array.slice();
  }

  _harbor() {
    const s = this.scene, dark = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.7, metalness: 0.5 });
    const parts = [], lights = [];
    // suspension bridge across the bay
    const bz = COAST_Z - 420;
    const deck = new THREE.BoxGeometry(1400, 3, 14); deck.translate(0, 22, bz); parts.push(deck);
    for (const tx of [-300, 300]) {
      for (const dz of [-6, 6]) { const t = new THREE.BoxGeometry(5, 110, 4); t.translate(tx, 55, bz + dz); parts.push(t); }
      const cb = new THREE.BoxGeometry(5, 5, 16); cb.translate(tx, 100, bz); parts.push(cb);
    }
    for (let x = -700; x <= 700; x += 14) {
      const tx = x < -300 ? -300 : x > 300 ? 300 : 0;
      const span = x < -300 || x > 300 ? 400 : 300;
      const u = Math.abs(x - tx) / span; const y = x < -300 || x > 300 ? 108 - u * 84 : 24 + Math.pow((x / 300), 2) * 84;
      const hang = new THREE.BoxGeometry(0.4, y - 22, 0.4); hang.translate(x, 22 + (y - 22) / 2, bz - 6); parts.push(hang);
      lights.push(x, y, bz - 6, x, 24, bz + 7);
    }
    // cranes on the waterfront
    for (let i = 0; i < 6; i++) {
      const x = -520 + i * 70 + (i > 2 ? 520 : 0), z = COAST_Z - 12;
      for (const dx of [-5, 5]) { const l = new THREE.BoxGeometry(1.5, 40, 1.5); l.translate(x + dx, 20, z); parts.push(l); }
      const boom = new THREE.BoxGeometry(3, 3, 70); boom.translate(x, 42, z - 20); parts.push(boom);
      const cab = new THREE.BoxGeometry(12, 5, 6); cab.translate(x, 38, z); parts.push(cab);
      lights.push(x, 44, z - 55, x, 44, z + 14);
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), dark); s.add(mesh);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lights, 3));
    const lm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: this.shared.uTime },
      vertexShader: 'uniform float uTime; varying float vR; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vR = position.y > 40.0 ? step(0.5, fract(uTime*0.6 + position.x*0.01)) : 0.0; gl_PointSize = clamp(3000.0 / -mv.z, 2.0, 9.0); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'varying float vR; void main(){ float a = smoothstep(0.5,0.0,length(gl_PointCoord-0.5)); vec3 c = mix(vec3(3.0,2.2,1.2), vec3(6.0,0.3,0.1), vR); gl_FragColor = vec4(c*a*a,1.0); }' });
    const pts = new THREE.Points(lg, lm); pts.frustumCulled = false; s.add(pts);
  }

  _ambientFires() {
    // persistent burning spots: a few skyline fires with huge smoke plumes + burning cars
    this.ambient = [];
    const rng = mulberry32(31);
    const cand = this.skyDefs.filter((s) => { const d = Math.hypot(s.cx, s.cz); return d > 110 && d < 380; });
    for (let i = 0; i < 4; i++) {
      const s = cand[Math.floor(rng() * cand.length)];
      if (s) this.ambient.push({ pos: new THREE.Vector3(s.cx, s.top * (0.4 + rng() * 0.5), s.cz), scale: 3 + rng() * 2, plume: true });
    }
    for (const c of this.cars) if (c.burn) this.ambient.push({ pos: new THREE.Vector3(c.x, 0.4, c.z), scale: 0.6, plume: false });
    this.ambient = this.ambient.slice(0, 10);
    this._startAmbient();
  }
  _startAmbient() {
    if (!this.fx.fire) return;
    for (const a of this.ambient) { a.handle?.stop(); a.handle = this.fx.fire(a.pos, a.scale, { plume: a.plume }); }
  }

  // ---------------------------------------------------------------------------------------------
  reset() {
    this.destruct.reset();
    for (const c of this.craters) c.w = -1;
    this._startAmbient();
  }
  impact(position, radius, force, opts) {
    const n = this.destruct.impact(position, radius, force, opts);
    if (position.y < 3 && force >= 1.5) {
      const c = this.craters[this.craterIdx++ % this.craters.length];
      c.set(position.x, position.z, Math.min(18, radius * 0.5 + force * 1.5), 0);
    }
    return n;
  }
  collapseAt(pos) {
    let best = null, bd = Infinity;
    for (const b of this.destruct.buildings) { if (b.intact <= 0) continue; const d = Math.hypot(b.cx - pos.x, b.cz - pos.z); if (d < bd) { bd = d; best = b; } }
    if (best) this.destruct.collapseBuilding(best, pos);
    return !!best;
  }
  fighterContact(position, radius, velocity) { return this.destruct.fighterContact(position, radius, velocity); }
  groundHeight() { return 0; }
  setFocus(v) { this._focusOverride = v ? v.clone() : null; }

  update(dt, camera) {
    this.time += dt;
    const t = this.time;
    this.shared.uTime.value = t;
    for (const c of this.craters) if (c.w >= 0) c.w += dt;
    // camera focus: override or intersection of view ray with the y=8 plane
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    if (this._focusOverride) this._focus.copy(this._focusOverride);
    else {
      let d = fwd.y < -0.01 ? (camera.position.y - 8) / -fwd.y : 60;
      d = THREE.MathUtils.clamp(d, 20, 150);
      this._focus.copy(camera.position).addScaledVector(fwd, d);
    }
    this.shared.uFocus.value.copy(this._focus);
    // shadow frustum follows focus (texel-snapped)
    const f = this._focus, snap = 110 / 2048;
    const fx = Math.round(f.x / snap) * snap, fz = Math.round(f.z / snap) * snap;
    this.moon.target.position.set(fx, 0, fz);
    this.moon.position.set(fx, 0, fz).addScaledVector(this.moonDir, 200);
    // rim light from behind the subject relative to camera
    const back = new THREE.Vector3(f.x - camera.position.x, 0, f.z - camera.position.z).normalize();
    this.rim.target.position.set(f.x, 6, f.z);
    this.rim.position.set(f.x + back.x * 60, 45, f.z + back.z * 60);
    // weather / lightning
    const flash = this.sky.update(dt, camera, t);
    this.lightningFlash = flash;
    this.flashDir.intensity = flash * 6;
    if (flash > 0 && this.sky.strikePos) { this.flashDir.position.copy(this.sky.strikePos).setY(400); this.flashDir.target.position.set(f.x, 0, f.z); }
    this.hemi.intensity = 0.55 + flash * 1.2;
    this.scene.fog.color.copy(this.fogBase).lerp(new THREE.Color(0.2, 0.24, 0.32), flash * 0.5);
    this.waterNormal.offset.set(t * 0.004, t * 0.002);
    // fire lights follow the nearest active fires to the focus
    const fires = [];
    for (const b of this.destruct.buildings) if (b.fire) fires.push(b.fire);
    for (const a of this.ambient) if (a.handle && !a.plume) fires.push(a.handle);
    fires.sort((a, b) => a.pos.distanceToSquared(f) - b.pos.distanceToSquared(f));
    this.fireLights.forEach((l, i) => {
      const h = fires[i];
      if (h) { l.position.copy(h.pos).setY(h.pos.y + 3); l.intensity = (h.scale * 260) * (0.8 + 0.2 * Math.sin(t * 17 + i * 3) * Math.sin(t * 7.3 + i)); }
      else l.intensity = 0;
    });
    this.destruct.update(dt);
  }
}
