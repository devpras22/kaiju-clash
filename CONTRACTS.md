# KAIJU CLASH — team contracts

Stack: Vite 6 + Three.js r186, plain ES modules, zero asset files (everything procedural: geometry, textures via canvas/DataTexture/shaders, audio via WebAudio).
Dev server: already running at http://localhost:5173 (HMR). Do NOT start another. Build check: `npx vite build --outDir /tmp/kb-<you>`.
Screenshots: `node tools/shot.mjs /tmp/<name>.png [pageScript.js] --wait 1500` (own headless Chromium w/ GPU; page script gets `g` = window.__game and `sleep`). See tools/fight.js.
Debug hook: window.__game. Input injection: g.input.virtual[0].light = true (player index 0/1, any action name).

## World scale
Units ≈ meters/4. Monsters ≈ 14 tall. Arena: fighters clamped within city.arenaRadius (~60) of origin. Fighting starts at x=±15.
Buildings 8–45 tall. Camera side-on, 40° FOV, ~40–70 units away.

## File ownership (edit ONLY your files; others work in parallel)
- core (orchestrator): src/main.js, src/core/Game.js, src/core/Input.js, src/fighters/roster.js, index.html, tools/
- MODELS agent: src/fighters/models/**
- WORLD agent: src/world/**, src/fx/**, src/core/Renderer.js
- COMBAT agent: src/combat/**, src/core/CameraRig.js
- UI agent: src/ui/**, src/audio/**
Each file's header comment holds its CONTRACT. Preserve it. You may ADD optional methods/params (backwards compatible); list them in your final report. If you need something from another module that doesn't exist, guard with optional chaining (e.g. `model.setCharge?.(x)`) and report it.

## Move list (shared vocabulary — models animate these, combat times them, audio voices them)
Animation states (anim.state): idle walk walkBack sidestep jump crouch block light kick heavy sp1 sp2 super hit hitHeavy knockdown getup ko victory intro taunt.
anim = { state, t (sec in state), progress (0..1 through state), speed (ground speed), dir (optional: -1/1 for sidestep) }

GORVOK (id 'saurian', Godzilla-style, heavy, slow, atomic blue #39b6ff):
- light: claw swipe (right arm diagonal slash) ~0.45s
- kick: tail whip — body twists, tail sweeps forward low ~0.7s
- heavy: lunging headbutt / body slam ~0.9s
- sp1: ATOMIC BREATH — spines light up bottom→top (charge ~0.6s), head rears then beam from mouth ~1.4s, total ~2.2s
- sp2: TAIL QUAKE — full 360° spin with tail + ground shockwave ~1.1s
- super: NUCLEAR PULSE — crouch, spines/body blaze, radial nuclear shockwave blast, then roar ~3.0s
- intro/taunt/victory: head-back roar
MAKORA (id 'ape', King Kong-style, fast, agile, fire orange #ff7a2f):
- light: jab ~0.35s
- kick: stomp front kick ~0.55s
- heavy: double-fist overhead hammer ~0.85s
- sp1: BUILDING HURL — reaches down, rips up a chunk of concrete, throws it (projectile released at progress≈0.6) ~1.3s
- sp2: LEAPING SMASH — big jump arc, both fists slam ground → shockwave ~1.4s
- super: PRIMAL FURY — chest beat, rapid punch flurry, finishing uppercut ~3.2s
- intro/taunt/victory: chest beat + roar

## Visual direction
Cinematic, AAA, "Pacific Rim / Godzilla (2014) at night": a burning coastal megacity at dusk→night under a storm. Deep blue-teal atmospheric fog, orange fire glow,
thousands of lit windows, rain, lightning, volumetric-feeling light shafts, bloom on emissives (atomic breath, spines, fire, neon). Monsters read via strong rim/back light.
Never flat colors, never pixel art. Physically based materials, ACES tonemapping, high-res (pixel ratio up to 2). Must hold ~60fps on a MacBook: prefer InstancedMesh/merged geometry, few lights, one shadow-casting light.
