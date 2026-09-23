# KAIJU CLASH — Titans of the City

A 3D monster fighting game in the browser: **Godzilla vs King Kong** in a destructible, storm-lit city at night.
Built with Three.js, and **100% procedural**: every model, texture, building, particle, sound effect and music track is generated in code. There are no asset files.

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
