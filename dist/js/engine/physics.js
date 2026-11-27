/**
 * Pure-JS port of server/game/physics.go.
 *
 * C# / Go int casts truncate toward zero — every `int(...)` in the Go source
 * becomes Math.trunc here, never Math.floor. Getting this wrong flips the sign
 * of velocity components near zero and desyncs the whole determinism chain.
 */
import {
  AIR_RESIST_FACTOR, BALL_MASS, GRAVITY_FACTOR, MAP_DRAG_INDEX,
  MAP_GRAVITY, MOVE_STEP_X, PHYSICS_DT, TARGET_HIT_RADIUS, WEAPON_BARREL_LENGTH,
  WEAPON_GRIP_X, WEAPON_GRIP_Y, WIND_FACTOR, WORLD_HEIGHT, WORLD_WIDTH,
  degToRad,
} from './constants.js?v=31';

/** Mirrors Game.Logic/Phy/Maths/EulerVector; X0 is an int in C#. */
export class Euler {
  constructor(x0 = 0, x1 = 0) {
    this.x0 = x0;
    this.x1 = x1;
    this.x2 = 0;
  }

  step(m, af, f, dt) {
    this.x2 = (f - af * this.x1) / m;
    this.x1 += this.x2 * dt;
    this.x0 = Math.trunc(this.x0 + this.x1 * dt);
  }
}

/** Exact branch shape of BaseGame.GetNextWind (comparison uses the old value). */
export function nextWind(value, target, rng) {
  const num = trunc10(value);
  let nextTarget = target;
  let next;
  if (num > nextTarget) {
    next = num - rng.randomInt(0, 11);
    if (num <= nextTarget) nextTarget = rng.randomInt(-40, 40);
  } else {
    next = num + rng.randomInt(0, 11);
    if (num >= nextTarget) nextTarget = rng.randomInt(-40, 40);
  }
  return { wind: next / 10, target: nextTarget };
}

export function trunc10(v) {
  const scaled = v * 10;
  if (scaled < 0) return Math.ceil(scaled - 1e-7);
  return Math.floor(scaled + 1e-7);
}

/** Launch: int-truncated force*cos/sin; browser Y grows down so up is negated. */
export function launch(force, elevation, direction) {
  const rad = degToRad(elevation);
  const vx = Math.trunc(force * Math.cos(rad)) * direction;
  const vy = -Math.trunc(force * Math.sin(rad));
  return { vx, vy };
}

/** MuzzlePoint: body-slope + weapon-grip transform, then barrel length. */
export function muzzlePoint(actor, elevation, direction) {
  const slope = degToRad(actor.slope);
  const dx = direction * WEAPON_GRIP_X;
  const dy = WEAPON_GRIP_Y;
  const gx = actor.x + dx * Math.cos(slope) - dy * Math.sin(slope);
  const gy = actor.y + dx * Math.sin(slope) + dy * Math.cos(slope);
  const rad = degToRad(elevation);
  return {
    x: gx + direction * Math.cos(rad) * WEAPON_BARREL_LENGTH,
    y: gy - Math.sin(rad) * WEAPON_BARREL_LENGTH,
  };
}

export function isProjectileOut(x, y) {
  return x < -60 || x > WORLD_WIDTH + 60 || y > WORLD_HEIGHT + 80 || y < -WORLD_HEIGHT * 2;
}

export function createProjectile(overrides = {}) {
  return {
    owner: 0, x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, ax: 0, ay: 0,
    age: 0, alive: true, impact: '', direction: 1, elevation: 0, force: 0,
    trail: [], volleyId: '', slot: 0, shells: 1, skill: '', weapon: '',
    craterArt: '', damageScale: 1, pow: false, carry: false, resolved: false,
    ...overrides,
  };
}

/**
 * One 0.04 s Euler step, then BombObject.MoveTo 3 px sub-steps with a 6x6
 * terrain rectangle. Returns 'actor' | 'ground' | 'out' | ''.
 */
export function stepProjectile(p, target, terrain, wind) {
  const startX = p.x;
  const startY = p.y;
  p.prevX = startX;
  p.prevY = startY;
  const arf = MAP_DRAG_INDEX * AIR_RESIST_FACTOR;
  const gf = MAP_GRAVITY * GRAVITY_FACTOR * BALL_MASS;
  const wf = wind * WIND_FACTOR;
  p.ax = (wf - arf * p.vx) / BALL_MASS;
  p.ay = (gf - arf * p.vy) / BALL_MASS;
  p.vx += p.ax * PHYSICS_DT;
  p.vy += p.ay * PHYSICS_DT;
  p.x = Math.trunc(p.x + p.vx * PHYSICS_DT);
  p.y = Math.trunc(p.y + p.vy * PHYSICS_DT);
  p.age += PHYSICS_DT;

  const dx = p.x - startX;
  const dy = p.y - startY;
  const dist = Math.hypot(dx, dy);
  let substeps = Math.ceil(dist / MOVE_STEP_X);
  if (substeps < 1) substeps = 1;
  for (let i = 1; i <= substeps; i += 1) {
    const t = i / substeps;
    const x = startX + dx * t;
    const y = startY + dy * t;
    if (p.age > 0.07 && target && target.alive) {
      const tx = target.x;
      const ty = target.y - 38;
      if ((x - tx) * (x - tx) + (y - ty) * (y - ty) <= TARGET_HIT_RADIUS * TARGET_HIT_RADIUS) {
        p.x = x; p.y = y; p.impact = 'actor'; p.alive = false;
        return 'actor';
      }
    }
    if (terrain.isSolidRect(Math.floor(x) - 3, Math.floor(y) - 3, 6, 6)) {
      p.x = x; p.y = y; p.impact = 'ground'; p.alive = false;
      return 'ground';
    }
    if (isProjectileOut(x, y)) {
      p.x = x; p.y = y; p.impact = 'out'; p.alive = false;
      return 'out';
    }
  }
  p.x = startX + dx;
  p.y = startY + dy;
  return '';
}

/**
 * Deterministic AI/acceptance simulator: same Euler + 3 px collision model as a
 * live shell, but never mutates terrain.
 */
export function simulateShot(originX, originY, angle, force, direction, wind, target, terrain, maxSeconds, includePath) {
  const { vx, vy } = launch(force, angle, direction);
  const p = createProjectile({
    x: originX, y: originY, vx, vy, alive: true, direction, elevation: angle, force,
  });
  const r = {
    x: 0, y: 0, impact: '', closest: Infinity, closestX: originX, closestY: originY,
    // Go leaves Path nil unless includePath; a nil slice marshals to null, so
    // the AI-plan JSON must not emit [] here.
    age: 0, path: includePath ? [{ x: originX, y: originY }] : null,
    hitActor: false, hitGround: false, outOfWorld: false,
  };
  let centerY = 0;
  if (target) centerY = target.y - 38;
  const maxSteps = Math.ceil(maxSeconds / PHYSICS_DT);
  for (let step = 0; step < maxSteps && p.alive; step += 1) {
    stepProjectile(p, target, terrain, wind);
    if (target) {
      const d = Math.hypot(p.x - target.x, p.y - centerY);
      if (d < r.closest) { r.closest = d; r.closestX = p.x; r.closestY = p.y; }
    }
    if (includePath) r.path.push({ x: p.x, y: p.y });
  }
  r.x = p.x; r.y = p.y; r.impact = p.impact; r.age = p.age;
  r.hitActor = p.impact === 'actor';
  r.hitGround = p.impact === 'ground';
  r.outOfWorld = p.impact === 'out';
  return r;
}

/** MakeDamage from SimpleBomb.cs; negative formula clamps to 1, 0 stays 0. */
export function sourceDamage(distance, radius, attacker, defender) {
  if (Number.isNaN(distance) || distance >= radius) return 0;
  const baseGuard = defender.baseGuard;
  const defence = defender.defence;
  const attack = attacker.attack;
  const baseDamage = attacker.baseDamage;
  const grade = attacker.grade;
  const lucky = attacker.lucky;
  const damagePlus = attacker.damagePlus;
  const shootMinus = attacker.shootMinus;

  const dr1 = (0.95 * (baseGuard - 3 * grade)) / (500 + baseGuard - 3 * grade);
  let dr2 = 0;
  if (defence - lucky >= 0) dr2 = (0.95 * (defence - lucky)) / (600 + defence - lucky);
  const dr3 = attacker.worldBossAddDamage * (1 - (baseGuard / 200 + defence * 0.003));
  const raw = (dr3 + baseDamage * (1 + attack * 0.001) * (1 - (dr1 + dr2 - dr1 * dr2))) * damagePlus * shootMinus;
  const falloff = 1 - distance / radius / 4;
  const value = Math.trunc(raw * falloff);
  if (value < 0) return 1;
  return value;
}

/**
 * MakeCriticalDamage: roll (0..99) comes from the match's dedicated crit RNG so
 * crits never perturb the wind / AI random streams.
 */
export function sourceCriticalDamage(lucky, reduce, baseDamage, roll) {
  const critRate = (lucky * 45.0) / (800.0 + lucky);
  if (critRate < roll || baseDamage <= 0) return 0;
  const crit = Math.trunc((0.5 + lucky * 0.00015) * baseDamage);
  return Math.trunc((crit * Math.trunc(100 - reduce)) / 100);
}

export function blastDamage(target, impactX, impactY, attacker, radius) {
  const dx = impactX - target.x;
  const dy = impactY - (target.y - 38);
  const distance = Math.hypot(dx, dy);
  return { damage: sourceDamage(distance, radius, attacker, target), distance };
}
