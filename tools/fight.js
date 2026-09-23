// Example page script: go straight into a CPU match. Usage: node tools/shot.mjs /tmp/fight.png tools/fight.js --wait 3000
g.audio.unlock && g.audio.unlock();
g.startMatch({ p1: 'saurian', p2: 'ape', mode: 'cpu', difficulty: 'normal' });
await sleep(2500);
return { state: g.state };
