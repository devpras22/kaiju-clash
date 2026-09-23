// OWNER: combat agent. Frame data / move definitions per fighter.
// CONTRACT: getMoveset(id) → { stats, light, kick, heavy, air, sp1, sp2, super } ; F = seconds per frame (1/60)
// Frame data is in 60fps frames (startup / active / recovery / hitstun / blockstun). Distances in world units.
// Fields:
//   anim           model anim state to play
//   type           'normal' | 'special' | 'super'
//   kind           special behaviour: 'beam' | 'spin' | 'pulse' | 'projectile' | 'leap' | 'rush' (normals: undefined)
//   damage, chip   chip = fraction of damage taken on block (specials/supers only)
//   level          'high' (ducked by crouch, blocked standing) | 'mid' (blocked standing only) | 'low' (blocked crouching only)
//   hitstun, blockstun, knockback (units/s), launch (vertical velocity → juggle), knockdown (bool)
//   meter          energy gained by attacker on hit (half on block)
//   hitbox         { socket, radius, reach, y }  sphere at model socket + data sphere at (forward*reach, y)
//                  { arc: degrees, range, maxY } sweep arc around the attacker (tail whip / 360 spin)
//   cancel         moves this can cancel into after connecting; normals chain on hit/block, specials only on hit
//   cancelWindow   frames after active end where cancel is allowed
//   hitstop, shake, sfx   game-feel
//   linear         true = can be evaded by sidestep i-frames
//   lunge          forward velocity during startup+active
//   cost           energy cost
export const F = 1 / 60;

const SAURIAN = {
  stats: {
    walk: 8.5, back: 6.5, accel: 30, decel: 45, jumpV: 30, jumpFwd: 9, gravity: 66,
    radius: 3.4, height: 14, crouchHeight: 8.5,
    sidestepSpeed: 30, sidestepTime: 0.42, evadeFrom: 0.03, evadeTo: 0.3,
    stepInterval: 0.62, stepShake: 0.14, weight: 1.35, idealRange: 11, defenseMul: 0.9,
    color: 0x39b6ff, roar: 'roar_saurian',
  },
  light: {
    name: 'Claw Swipe', anim: 'light', type: 'normal', startup: 10, active: 4, recovery: 13,
    damage: 45, level: 'high', hitstun: 19, blockstun: 12, knockback: 9, meter: 6,
    hitbox: { socket: 'handR', radius: 2.8, reach: 6.2, y: 9.5 },
    cancel: ['kick', 'heavy', 'sp1', 'sp2', 'super'], cancelWindow: 12,
    hitstop: 0.07, shake: 0.16, sfx: 'punch', linear: true,
  },
  kick: {
    name: 'Tail Whip', anim: 'kick', type: 'normal', startup: 15, active: 6, recovery: 21,
    damage: 70, level: 'low', hitstun: 22, blockstun: 14, knockback: 12, meter: 8,
    hitbox: { arc: 150, range: 14, maxY: 5 },
    cancel: ['heavy', 'sp1', 'sp2', 'super'], cancelWindow: 10,
    hitstop: 0.09, shake: 0.25, sfx: 'kick', linear: false,
  },
  heavy: {
    name: 'Leviathan Ram', anim: 'heavy', type: 'normal', startup: 20, active: 6, recovery: 28,
    damage: 110, level: 'mid', hitstun: 28, blockstun: 16, knockback: 16, launch: 24, meter: 11,
    hitbox: { socket: 'head', radius: 3.4, reach: 6.5, y: 9 }, lunge: 14,
    cancel: ['sp1', 'sp2', 'super'], cancelWindow: 12,
    hitstop: 0.14, shake: 0.45, sfx: 'heavy', linear: true,
  },
  air: {
    name: 'Falling Claw', anim: 'light', type: 'normal', startup: 6, active: 10, recovery: 10,
    damage: 60, level: 'mid', hitstun: 22, blockstun: 14, knockback: 10, meter: 6,
    hitbox: { socket: 'handR', radius: 3, reach: 5, y: 6 },
    hitstop: 0.09, shake: 0.2, sfx: 'punch', linear: true,
  },
  sp1: {
    name: 'ATOMIC BREATH', anim: 'sp1', type: 'special', kind: 'beam', cost: 25,
    startup: 48, active: 72, recovery: 18, // 2.3s total: charge 0.6s, rear 0.2s, beam 1.2s, recover 0.3s
    chargeTime: 0.6, beamStart: 0.8, beamEnd: 2.0, sweep: 0.1, beamRadius: 1.9, beamLength: 130, tickInterval: 0.1,
    damage: 13, level: 'mid', hitstun: 12, blockstun: 9, knockback: 5, chip: 0.3, meter: 1.2, minScale: 0.5,
    hitstop: 0.012, shake: 0.08, sfx: null, linear: true,
    finisher: { damage: 40, level: 'mid', hitstun: 30, blockstun: 16, knockback: 26, launch: 10, knockdown: true, chip: 0.3, meter: 3, hitstop: 0.1, shake: 0.4, sfx: 'heavy', linear: true, type: 'special', minScale: 0.5 },
  },
  sp2: {
    name: 'TAIL QUAKE', anim: 'sp2', type: 'special', kind: 'spin', cost: 25,
    startup: 18, active: 14, recovery: 34,
    damage: 130, level: 'low', hitstun: 30, blockstun: 18, knockback: 22, launch: 14, knockdown: true, chip: 0.15, meter: 5,
    hitbox: { arc: 360, range: 14.5, maxY: 10 },
    hitstop: 0.15, shake: 0.55, sfx: 'heavy', linear: false,
  },
  super: {
    name: 'NUCLEAR PULSE', anim: 'super', type: 'super', kind: 'pulse', cost: 100,
    startup: 72, active: 6, recovery: 102, // 3.0s
    blastRadius: 30, invulnUntil: 1.35,
    damage: 340, level: 'mid', hitstun: 40, blockstun: 30, knockback: 34, launch: 34, knockdown: true, chip: 0.25, meter: 0, minScale: 0.6,
    hitstop: 0.18, shake: 1, sfx: 'explosion', linear: false,
  },
};

const APE = {
  stats: {
    walk: 13.5, back: 10.5, accel: 60, decel: 70, jumpV: 34, jumpFwd: 13, gravity: 72,
    radius: 3.1, height: 13, crouchHeight: 8,
    sidestepSpeed: 36, sidestepTime: 0.34, evadeFrom: 0.02, evadeTo: 0.26,
    stepInterval: 0.42, stepShake: 0.07, weight: 1.0, idealRange: 8.5, defenseMul: 1.0,
    color: 0xff7a2f, roar: 'roar_ape',
  },
  light: {
    name: 'Jab', anim: 'light', type: 'normal', startup: 6, active: 3, recovery: 12,
    damage: 32, level: 'high', hitstun: 17, blockstun: 11, knockback: 7, meter: 5,
    hitbox: { socket: 'handL', radius: 2.4, reach: 5.2, y: 9 },
    cancel: ['kick', 'heavy', 'sp1', 'sp2', 'super'], cancelWindow: 12,
    hitstop: 0.06, shake: 0.12, sfx: 'punch', linear: true,
  },
  kick: {
    name: 'Stomp Kick', anim: 'kick', type: 'normal', startup: 10, active: 4, recovery: 19,
    damage: 55, level: 'mid', hitstun: 21, blockstun: 13, knockback: 11, meter: 7,
    hitbox: { socket: 'footR', radius: 2.6, reach: 5.8, y: 4 },
    cancel: ['heavy', 'sp1', 'sp2', 'super'], cancelWindow: 12,
    hitstop: 0.08, shake: 0.2, sfx: 'kick', linear: true,
  },
  heavy: {
    name: 'Hammer Fist', anim: 'heavy', type: 'normal', startup: 18, active: 5, recovery: 28,
    damage: 95, level: 'mid', hitstun: 26, blockstun: 15, knockback: 12, launch: 26, meter: 10,
    hitbox: { socket: 'handR', radius: 3.4, reach: 6, y: 7 }, lunge: 10,
    cancel: ['sp1', 'sp2', 'super'], cancelWindow: 14,
    hitstop: 0.13, shake: 0.4, sfx: 'heavy', linear: true,
  },
  air: {
    name: 'Diving Stomp', anim: 'kick', type: 'normal', startup: 5, active: 10, recovery: 8,
    damage: 50, level: 'mid', hitstun: 20, blockstun: 13, knockback: 9, meter: 6,
    hitbox: { socket: 'footR', radius: 3, reach: 4.5, y: 4 },
    hitstop: 0.08, shake: 0.18, sfx: 'kick', linear: true,
  },
  sp1: {
    name: 'BUILDING HURL', anim: 'sp1', type: 'special', kind: 'projectile', cost: 25,
    startup: 47, active: 1, recovery: 30, // 1.3s, release at progress 0.6
    grabTime: 0.3, releaseTime: 0.78, speed: 52, gravity: 34, projRadius: 2.6,
    damage: 105, level: 'mid', hitstun: 30, blockstun: 18, knockback: 18, chip: 0.15, meter: 8,
    hitstop: 0.12, shake: 0.45, sfx: 'explosion', linear: true,
  },
  sp2: {
    name: 'LEAPING SMASH', anim: 'sp2', type: 'special', kind: 'leap', cost: 25,
    startup: 15, active: 6, recovery: 27, // total 1.4s (84f) enforced by `total`
    total: 1.4, leapAt: 0.25, airTime: 0.65, leapGravity: 80, maxLeap: 30, minLeap: 4, slamRadius: 12.5,
    damage: 140, level: 'low', hitstun: 30, blockstun: 20, knockback: 16, launch: 14, knockdown: true, chip: 0.15, meter: 8,
    hitstop: 0.15, shake: 0.6, sfx: 'heavy', linear: false,
  },
  super: {
    name: 'PRIMAL FURY', anim: 'super', type: 'super', kind: 'rush', cost: 100,
    startup: 54, active: 60, recovery: 78, // 3.2s
    total: 3.2, dashStart: 0.9, dashEnd: 1.3, dashSpeed: 78, flurryStart: 1.3, flurryEnd: 2.55, flurryInterval: 0.14, uppercutAt: 2.7, invulnUntil: 0.95,
    damage: 25, level: 'mid', hitstun: 20, blockstun: 24, knockback: 2, chip: 0.25, meter: 0, minScale: 0.6,
    hitstop: 0.05, shake: 0.25, sfx: 'punch', linear: true,
    flurry: { damage: 22, level: 'mid', hitstun: 18, blockstun: 10, knockback: 0, unblockable: true, meter: 0, minScale: 0.6, hitstop: 0.04, shake: 0.22, sfx: 'punch', type: 'super' },
    uppercut: { damage: 130, level: 'mid', hitstun: 40, blockstun: 20, knockback: 16, launch: 38, knockdown: true, unblockable: true, meter: 0, minScale: 0.6, hitstop: 0.18, shake: 0.9, sfx: 'heavy', type: 'super' },
  },
};

export const MOVES = { saurian: SAURIAN, ape: APE };

export function getMoveset(id) {
  const set = MOVES[id] || SAURIAN;
  for (const k of ['light', 'kick', 'heavy', 'air', 'sp1', 'sp2', 'super']) {
    const m = set[k];
    if (!m.total) m.total = (m.startup + m.active + m.recovery) * F;
    m.key = k;
  }
  return set;
}
