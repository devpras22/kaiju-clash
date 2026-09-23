// OWNER: monster-model agent. Procedural monster meshes + procedural animation.
// CONTRACT (must be preserved):
//   createMonsterModel(id, { skin }) → MonsterModel
//   model.root : THREE.Object3D — placed/rotated by Fighter. Model faces +Z in local space, feet at y=0.
//   model.height : number (world units, approx standing height; target ~14)
//   model.update(dt, anim) where anim = { state, t, progress, speed }
//       state ∈ 'idle' 'walk' 'walkBack' 'sidestep' 'jump' 'crouch' 'block' 'light' 'kick' 'heavy'
//               'sp1' 'sp2' 'super' 'hit' 'hitHeavy' 'knockdown' 'getup' 'ko' 'victory' 'intro' 'taunt'
//       t = seconds since state began, progress = 0..1 through the state (for attacks), speed = ground speed
//   model.getSocket(name, target: Vector3) → world-space position of 'mouth' 'head' 'chest' 'handL' 'handR' 'footL' 'footR'
//   model.flash(color = 0xffffff, duration = 0.12) — hit flash
//   model.setCharge(amount 0..1) — energy glow (dorsal spines / eyes / chest)
//   model.dispose()
// ADDITIONS (optional, backwards compatible):
//   createMonsterModel(id, { skin: 'default' | 'alt' }) ; model.setSkin(variant)
//   model.getSocketDir(name, target: Vector3) → world-space unit direction the socket faces (mouth: breath direction)
//   anim.dir (-1/1) used by 'sidestep'. anim.speed drives walk-cycle cadence (falls back to a default when 0).
//   model.skeleton (THREE.Skeleton), model.bones { name: THREE.Bone } — rig access for FX/debug.
//   If the Fighter does not lift root.position.y during 'jump' / ape 'sp2', the model performs the arc itself.
// Implementation: rig.js (shared skeleton/pose/IK/springs), geometry.js (procedural meshes), textures.js (PBR maps),
// SaurianModel.js (GORVOK), ApeModel.js (MAKORA).
import { SaurianModel } from './SaurianModel.js';
import { ApeModel } from './ApeModel.js';
export { MonsterBase, Pose, patchMaterial, ease, ramp, bump } from './rig.js';

export function createMonsterModel(id, opts = {}) {
  if (id === 'ape') return new ApeModel(opts);
  return new SaurianModel(opts);
}
