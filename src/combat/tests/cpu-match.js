// node tools/shot.mjs /tmp/cpu.png src/combat/tests/cpu-match.js --wait 200
// CPU vs CPU full match, simulated at fixed 1/60 steps (animation loop stopped for speed).
const diff = window.__diff || 'normal';
g.audio.unlock && g.audio.unlock();
g.renderer.renderer.setAnimationLoop(null);
g.startMatch({ p1: 'saurian', p2: 'ape', mode: 'cpu', difficulty: diff });
g.match.setAI(0, diff);
let result = null; g.match.onEnd = (r) => { result = r; };
const stats = { hits: 0, specials: {}, maxCombo: 0, projectiles: 0, beamTicks: 0, supers: 0, rounds: [] };
const errs = [];
let prevRound = 1;
for (let i = 0; i < 60 * 60 * 8 && !result; i++) {
  try {
    const dt = 1 / 60; g.input.update();
    let d = dt * g.timeScale;
    if (g._slowMo) { d *= g._slowMo.scale; g._slowMo.left -= dt; if (g._slowMo.left <= 0) g._slowMo = null; }
    if (g._hitStop > 0) { g._hitStop -= dt; d = 0; }
    g.match.update(d); g.fx.update(d, g.camera); g.city.update(d, g.camera); g.cameraRig.update(dt);
    for (const f of g.match.fighters) {
      if (f.state === 'attack' && f._seen !== f.attackId) { f._seen = f.attackId; stats.specials[f.id + ':' + f.moveName] = (stats.specials[f.id + ':' + f.moveName] || 0) + 1; }
      stats.maxCombo = Math.max(stats.maxCombo, f.comboTaken);
      if (f.projectiles.length) stats.projectiles++; if (!Number.isFinite(f.energy) || !Number.isFinite(f.hp) || !Number.isFinite(f.position.x)) errs.push('NaN state ' + f.id);
    }
    if (g.match.round !== prevRound) { stats.rounds.push(prevRound); prevRound = g.match.round; }
  } catch (e) { errs.push(String(e.stack || e)); break; }
}
const [a, b] = g.match.fighters;
return { result, errs, round: g.match.round, rounds: g.match.rounds, hp: [a.hp, b.hp], timer: g.match.timer, stats };
