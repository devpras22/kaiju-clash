# KAIJU CLASH — Titans of the City

A 3D monster fighting game in the browser: **Godzilla vs King Kong** in a destructible, storm-lit city at night.
Built with Three.js, and **100% procedural**: every model, texture, building, particle, sound effect and music track is generated in code. There are no asset files.

> 🏆 Built at **Claude Build Day, Mumbai** (Claude Community India, 23 Sep 2026, K J Somaiya School of Engineering) for the **Delight** track: *"build something surprising, beautiful, or fun. The bar is that you could not have made it this good, this fast, before."*

## How it was built
Built in one evening with **Claude Code**, working as a team of AI sub-agents:
- **The main session planned and coordinated.** It wrote a playable skeleton first (Milestone 1) and defined the rules between modules in [CONTRACTS.md](CONTRACTS.md): who owns which files, a shared move list, the world scale and the visual direction.
- **Four specialist sub-agents then built in parallel** (Milestone 2), each in its own files:
  - Monster models and procedural animation
  - Destructible city, VFX and post-processing
  - Combat, AI and cinematic camera
  - UI and procedural audio
- **The main session then joined their work together** and smoke-tested a full CPU-vs-CPU match (Milestone 3).
- The game stayed playable at every milestone.
- Result: about **7,800 lines** of JavaScript, with no asset files and no dependencies other than Three.js.

## Play
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/ (deploy anywhere, e.g. Vercel: framework "Vite")
```

## Features
- Two fighters, each with a procedural skeletal rig and animations for 21 states
  - GODZILLA: atomic breath beam, tail quake, and the Nuclear Pulse super
  - KING KONG: building hurl, leaping smash, and the Primal Fury super
- Fighting-game systems: frame data, chain combos, cancels, juggles, high/low blocking, sidestep, knockdowns, and an energy meter for specials and supers
- Best-of-3 rounds with a 99s timer, a combo counter, and a K.O. / PERFECT / time-over announcer
- CPU opponent (easy / normal / hard) and local 2-player versus
- Destructible city: buildings break apart chunk by chunk and towers collapse. Plus rain, lightning, fires, bloom and cinematic color grading.
- Procedural WebAudio sound: impacts, roars, the beam, an announcer, and dynamic music

## Controls
| | P1 (keyboard) | P2 (keyboard) | Gamepad |
|---|---|---|---|
| Move / jump / crouch | A D / W / S | ← → / ↑ / ↓ | D-pad / stick |
| Block | hold back (away from the opponent) | hold back | hold back |
| Sidestep | Q / E | Num7 / Num9 | LB / LT |
| Light / Kick / Heavy | J / K / L | Num1 / Num2 / Num3 | X / A / Y |
| Special 1 / 2 / Super | U / I / O | Num4 / Num5 / Num6 | B / RB / RT |
| Pause / Mute | Esc / M | | Start |

## Project layout
See [CONTRACTS.md](CONTRACTS.md). In short:
- `src/fighters/models`: monster models
- `src/world` and `src/fx`: city, destruction and particle effects
- `src/combat`: fighters, AI and camera
- `src/ui` and `src/audio`: screens and sound
- `src/core`: game loop, input and renderer

Fan-made hackathon project. Godzilla and King Kong are trademarks of their respective owners; this project is not affiliated with them.
