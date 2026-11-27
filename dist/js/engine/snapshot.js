/**
 * Pure-JS port of server/game/snapshot.go. Field order follows the Go struct
 * so the emitted JSON matches what the Go server/SSE and WASM bridge produce.
 */
import { WEAPON_DEFS, WEAPON_ORDER } from './constants.js?v=24';
import { actorJson, copyProjectile } from './json.js?v=24';

export function buildSnapshot(m) {
  const weapon = m.playerWeapon();
  const metrics = m.metrics();
  return {
    seq: m.seq,
    phase: m.phase,
    turn: m.turn,
    round: m.round,
    wind: m.wind,
    windTarget: m.windTarget,
    windLabel: m.windLabel(),
    angle: m.angle,
    angleMin: weapon.angleMin,
    angleMax: weapon.angleMax,
    force: m.force,
    charging: m.charging,
    chargeElapsed: m.chargeElapsed,
    weapon: m.playerWeaponId,
    enemyWeapon: m.enemyWeaponId,
    weapons: WEAPON_ORDER.map((id) => ({ ...WEAPON_DEFS[id] })),
    actors: m.actors.map(actorJson),
    shots: m.shots.length ? m.shots.map(copyProjectile) : null,
    shot: m.shot ? copyProjectile(m.shot) : null,
    lastImpact: m.lastImpact,
    lastPlayerSummary: m.lastPlayerSummary,
    lastPower: m.lastPower,
    winner: m.winner,
    stats: { ...m.stats },
    healsRemaining: m.healsRemaining,
    skillUses: { ...m.skillUses },
    selectedSkill: m.selectedSkill,
    selectedBuffs: [...m.selectedBuffs],
    powSelected: m.powSelected,
    carryArmed: m.carryArmed,
    canCarry: m.canCarry,
    energy: m.energy,
    stamina: m.stamina,
    countdown: m.countdown,
    showCountdown: m.showCountdown,
    enemyAimAngle: m.enemyAimAngle,
    metricsX: metrics.x,
    metricsY: metrics.y,
    craters: m.terrain.craters.length ? m.terrain.cratersCopy() : null,
    time: m.time,
    terrainWidth: m.terrain.width,
    terrainHeight: m.terrain.height,
    terrainHash: m.terrain.hash(),
  };
}
