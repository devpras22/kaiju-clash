// OWNER: world agent. Shared PBR building material: fully procedural facades with thousands of lit/unlit windows,
// storefronts, pilasters, roofs, broken-concrete interior faces (exposed when chunks break off), scorch/heat glow,
// and a camera "cutout" that dithers away geometry between the camera and the fight focus.
//
// Per-instance attributes (InstancedBufferAttribute, itemSize 4):
//   aInfo  = (seed, style, halfWidthX, halfDepthZ)       — building-level constants
//   aInfo2 = (offX, offZ, centreY, _)                     — chunk centre in building-local space (for continuous windows)
//   aState = (lightsOn 0..1, heat 0..1, isTop 0/1, buildingHeight)
// Geometry: unit box centred at the origin; the instance matrix scales it to the chunk size.
import * as THREE from 'three';
import { GLSL_NOISE } from './util.js';

export function createBuildingMaterial(shared) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFocus = shared.uFocus;
    shader.uniforms.uCut = shared.uCut;
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aInfo; attribute vec4 aInfo2; attribute vec4 aState;
        varying vec3 vB; varying vec3 vBN; varying vec4 vInfo; varying vec4 vState; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #else
          vec3 sc = vec3(1.0);
        #endif
        vB = vec3(position.x * sc.x + aInfo2.x, position.y * sc.y + aInfo2.z, position.z * sc.z + aInfo2.y);
        vBN = normal; vInfo = aInfo; vState = aState;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uFocus; uniform float uCut; uniform float uTime;
        varying vec3 vB; varying vec3 vBN; varying vec4 vInfo; varying vec4 vState; varying vec3 vWPos;
        ${GLSL_NOISE}
        float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      `)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        // ---- camera cutout: dither away fragments that sit between the camera and the fight focus
        {
          vec3 cd = uFocus - cameraPosition; float L = length(cd); cd /= max(L, 1e-3);
          vec3 rel = vWPos - cameraPosition; float s = dot(rel, cd);
          if (uCut > 0.5 && s > 0.0 && s < L - 16.0) {
            float r = length(rel - cd * s);
            float rad = min(4.0 + s * 0.45, 16.0);
            float edge = (rad - r) / 3.0;
            if (edge > ign(gl_FragCoord.xy)) discard;
          }
          if (length(rel) < 5.0) discard;
        }
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float seed = vInfo.x; float st = floor(vInfo.y + 0.5);
        vec3 nB = normalize(vBN);
        bool side = abs(nB.y) < 0.5;
        bool faceX = abs(nB.x) > 0.5;
        float halfFace = faceX ? vInfo.w : vInfo.z;
        float u = faceX ? vB.z * sign(nB.x) : -vB.x * sign(nB.z);
        float v = vB.y;
        float H = vState.w;
        bool exterior = side ? (faceX ? abs(vB.x) > vInfo.z - 0.06 : abs(vB.z) > vInfo.w - 0.06) : (nB.y > 0.5 && vState.z > 0.5);
        float bh = hash12(vec2(seed, 7.13));
        vec3 facade; vec2 cell; vec2 win; float litP; float fRough; vec3 glassCol; float glassMetal; float band;
        if (st < 0.5) {        // glass curtain-wall tower
          facade = mix(vec3(0.03, 0.045, 0.06), vec3(0.06, 0.07, 0.07), bh); cell = vec2(1.1, 0.95); win = vec2(0.9, 0.8); litP = 0.30; fRough = 0.35;
          glassCol = mix(vec3(0.18, 0.28, 0.32), vec3(0.28, 0.3, 0.34), bh); glassMetal = 0.9; band = 0.0;
        } else if (st < 1.5) { // brick mid-rise
          facade = mix(vec3(0.20, 0.075, 0.045), vec3(0.28, 0.14, 0.08), bh); cell = vec2(1.5, 0.95); win = vec2(0.42, 0.58); litP = 0.48; fRough = 0.92;
          glassCol = vec3(0.12, 0.14, 0.16); glassMetal = 0.6; band = 4.0;
        } else if (st < 2.5) { // concrete modernist (ribbon windows)
          facade = mix(vec3(0.20, 0.20, 0.21), vec3(0.30, 0.29, 0.27), bh); cell = vec2(1.25, 0.95); win = vec2(0.92, 0.46); litP = 0.38; fRough = 0.85;
          glassCol = vec3(0.14, 0.17, 0.2); glassMetal = 0.75; band = 0.0;
        } else if (st < 3.5) { // art-deco stone (vertical piers)
          facade = mix(vec3(0.34, 0.28, 0.20), vec3(0.42, 0.36, 0.28), bh); cell = vec2(0.95, 1.0); win = vec2(0.5, 0.72); litP = 0.42; fRough = 0.8;
          glassCol = vec3(0.12, 0.13, 0.14); glassMetal = 0.7; band = 6.0;
        } else {               // dark office slab
          facade = mix(vec3(0.025, 0.028, 0.032), vec3(0.05, 0.05, 0.055), bh); cell = vec2(1.0, 0.95); win = vec2(0.96, 0.5); litP = 0.33; fRough = 0.5;
          glassCol = vec3(0.16, 0.2, 0.26); glassMetal = 0.9; band = 0.0;
        }
        vec2 gpos = vec2(u, v - 0.1) / cell;
        vec2 cid = floor(gpos); vec2 cf = fract(gpos);
        vec2 fw = fwidth(gpos);
        vec2 dd = abs(cf - 0.5) - win * 0.5;
        float wm = (1.0 - smoothstep(-fw.x, fw.x, dd.x)) * (1.0 - smoothstep(-fw.y, fw.y, dd.y));
        float detail = 1.0 - smoothstep(0.25, 0.7, max(fw.x, fw.y));
        wm = mix(win.x * win.y, wm, detail);
        // solid pilasters at corners, parapet at top, slab bands
        float solid = step(halfFace - 0.55, abs(u)) + step(H - 0.6, v);
        if (band > 0.5) solid += step(mod(cid.y, band), 0.0) * 0.0; // reserved
        wm *= 1.0 - clamp(solid, 0.0, 1.0);
        float store = 1.0 - step(1.35, v);
        float faceId = faceX ? sign(nB.x) : 2.0 + sign(nB.z);
        float hA = hash13(vec3(cid, seed * 13.7 + faceId * 3.1));
        float hB = hash13(vec3(floor(cid.x / 3.0), cid.y, seed * 5.3 + faceId));
        float hC = hash13(vec3(cid.yx, seed + 91.0));
        float isLit = step(hA * 0.45 + hB * 0.55, litP) * step(hC, vState.x);
        // storefront band at street level
        if (store > 0.5) {
          float sfm = step(0.2, v) * (1.0 - smoothstep(1.1, 1.15, v)) * (1.0 - step(halfFace - 0.4, abs(u)));
          wm = sfm; isLit = step(hash12(vec2(floor(u / 2.5), seed)), 0.7) * step(0.3, vState.x);
        }
        float tone = hash13(vec3(cid, seed + 3.0));
        vec3 wc = tone < 0.55 ? vec3(1.0, 0.58, 0.26) : tone < 0.82 ? vec3(1.0, 0.82, 0.6) : tone < 0.95 ? vec3(0.7, 0.85, 1.0) : vec3(0.35, 0.6, 1.0);
        float wI = (1.2 + 2.2 * hash13(vec3(cid, seed + 11.0))) * (0.75 + 0.25 * cf.y);
        if (store > 0.5) { wc = mix(vec3(1.0, 0.7, 0.4), vec3(0.5, 0.9, 1.0), step(0.75, hash12(vec2(floor(u / 2.5), seed + 4.0)))); wI = 3.0; }
        vec3 winEmit = wc * wI;
        vec3 avgEmit = vec3(1.0, 0.7, 0.42) * 2.0 * litP * vState.x;
        vec3 emitW = mix(avgEmit * wm, winEmit * isLit * wm, detail);
        float glassAmt = wm;
        vec3 baseCol = facade * (0.85 + 0.3 * vnoise(vec2(u, v) * 1.7 + seed));
        float roughV = fRough; float metalV = 0.0;
        vec3 emitV = vec3(0.0);
        if (!side) {
          // roof or exposed slab
          if (exterior) { baseCol = vec3(0.07, 0.07, 0.075) * (0.6 + 0.8 * vnoise(vB.xz * 2.0 + seed)); roughV = 0.95; }
          else { baseCol = vec3(0.24, 0.23, 0.22) * (0.5 + 0.7 * fbm3(vB.xz * 1.3 + seed)); roughV = 1.0; }
          glassAmt = 0.0; emitW = vec3(0.0);
        } else if (!exterior) {
          // broken interior: raw concrete, floor slabs, dark voids
          float slab = step(0.82, fract(v / 0.95));
          float n = fbm3(vec2(u, v) * 1.6 + seed);
          baseCol = mix(vec3(0.05, 0.045, 0.04), vec3(0.3, 0.29, 0.27), max(slab, smoothstep(0.35, 0.65, n)));
          roughV = 1.0; glassAmt = 0.0; emitW = vec3(0.0);
        } else {
          // warm uplight from the street at the base, cool rim near the top
          emitV += vec3(1.0, 0.55, 0.25) * 0.06 * exp(-v * 0.35) * (1.0 - glassAmt);
        }
        // heat / scorch
        float heat = vState.y;
        if (heat > 0.001) {
          float hn = fbm3(vec2(u, v) * 2.3 + seed + uTime * 0.3);
          baseCol *= 1.0 - 0.85 * smoothstep(0.0, 0.6, heat);
          emitV += vec3(3.0, 0.8, 0.12) * smoothstep(0.35, 1.0, heat) * smoothstep(0.45, 0.8, hn) * heat;
          emitW *= 1.0 - smoothstep(0.1, 0.5, heat);
        }
        diffuseColor.rgb = mix(baseCol, glassCol, glassAmt * (1.0 - store * 0.5));
        float bRough = mix(roughV, 0.12, glassAmt);
        float bMetal = mix(metalV, glassMetal, glassAmt);
        vec3 bEmit = emitW + emitV;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = bRough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = bMetal;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += bEmit;`);
  };
  mat.customProgramCacheKey = () => 'kaiju-building-v1';
  return mat;
}

// Helper: allocate the three per-instance attributes on a geometry for `count` instances.
export function addBuildingAttributes(geometry, count) {
  const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const aInfo = mk(), aInfo2 = mk(), aState = mk();
  geometry.setAttribute('aInfo', aInfo);
  geometry.setAttribute('aInfo2', aInfo2);
  geometry.setAttribute('aState', aState);
  return { aInfo, aInfo2, aState };
}
