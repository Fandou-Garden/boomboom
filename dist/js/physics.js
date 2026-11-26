/**
 * Ballistics ported from Game.Logic/Phy/Maths/EulerVector.cs,
 * BombObject.cs, SimpleBomb.cs, Living.ShootImp and BaseGame.GetNextWind.
 *
 * World Y grows downward. The client UI exposes a positive elevation angle;
 * internally the launch is the equivalent of the original signed angle
 * (positive unit vector toward the opponent, negative screen Y).
 */
import { PHYSICS, WIND, COMBAT, WORLD } from './config.js?v=14';

export const TAU = Math.PI * 2;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;

/** C# int cast truncates toward zero. */
function trunc10(value) {
  const scaled = value * 10;
  return scaled < 0 ? Math.ceil(scaled - 1e-7) : Math.floor(scaled + 1e-7);
}

function randomInt(random, minInclusive, maxExclusive) {
  const t = clamp(Number(random()) || 0, 0, 0.999999999999);
  return minInclusive + Math.floor(t * (maxExclusive - minInclusive));
}

/**
 * Exact branch shape of BaseGame.GetNextWind().
 * It intentionally preserves the original comparison against `num`
 * instead of the newly computed value.
 */
export function nextWind(value, target, random = Math.random, options = WIND) {
  const num = trunc10(value || 0);
  let nextTarget = Number.isFinite(target) ? target : 0;
  let next;
  if (num > nextTarget) {
    next = num - randomInt(random, 0, options.stepInclusiveMax + 1);
    // The source compares the *old* num here. Preserve it.
    if (num <= nextTarget) {
      nextTarget = randomInt(random, options.targetMin, options.targetMax);
    }
  } else {
    next = num + randomInt(random, 0, options.stepInclusiveMax + 1);
    if (num >= nextTarget) {
      nextTarget = randomInt(random, options.targetMin, options.targetMax);
    }
  }
  return { wind: next / 10, target: nextTarget };
}

/** Port of EulerVector.ComputeOneEulerStep(m, af, f, dt). */
export class EulerVector {
  constructor(x0 = 0, x1 = 0, x2 = 0) {
    this.x0 = x0;
    this.x1 = x1;
    this.x2 = x2;
  }

  clear() {
    this.x0 = 0;
    this.x1 = 0;
    this.x2 = 0;
  }

  clearMotion() {
    this.x1 = 0;
    this.x2 = 0;
  }

  computeOneEulerStep(m, af, f, dt) {
    this.x2 = (f - af * this.x1) / m;
    this.x1 += this.x2 * dt;
    this.x0 += this.x1 * dt;
    return this;
  }
}

/** BombObject.UpdateAGW() plus EulerVector.ComputeOneEulerStep. */
export function accelerationFor(vx, vy, wind, cfg = PHYSICS) {
  const arf = cfg.mapDragIndex * cfg.airResistFactor;
  const gf = cfg.mapGravity * cfg.gravityFactor * cfg.mass;
  const wf = wind * cfg.windFactor;
  return {
    ax: (wf - arf * vx) / cfg.mass,
    ay: (gf - arf * vy) / cfg.mass,
  };
}

export function stepProjectile(projectile, wind, cfg = PHYSICS) {
  const { ax, ay } = accelerationFor(projectile.vx, projectile.vy, wind, cfg);
  projectile.ax = ax;
  projectile.ay = ay;
  projectile.vx += ax * cfg.dt;
  projectile.vy += ay * cfg.dt;
  projectile.x += projectile.vx * cfg.dt;
  projectile.y += projectile.vy * cfg.dt;
  projectile.age += cfg.dt;
  return projectile;
}

export function launchVector(force, elevationDegrees, direction, cfg = PHYSICS) {
  const rad = elevationDegrees * Math.PI / 180;
  const speed = force * cfg.forceToVelocity;
  return {
    vx: direction * speed * Math.cos(rad),
    vy: -speed * Math.sin(rad),
  };
}

/**
 * SOURCE: GamePlayer.shootPoint() converts the equipped weapon's local muzzle
 * point through the body transform. The body is tilted by calcObjectAngle()
 * to follow the terrain, so the grip rotates with the local slope while the
 * barrel itself is aimed at the player's chosen elevation.
 */
export function weaponGripPoint(actor, direction, cfg = COMBAT) {
  const slope = (actor.slope || 0) * Math.PI / 180;
  const dx = direction * cfg.weaponGripX;
  const dy = cfg.weaponGripY;
  return {
    x: actor.x + dx * Math.cos(slope) - dy * Math.sin(slope),
    y: actor.y + dx * Math.sin(slope) + dy * Math.cos(slope),
  };
}

export function muzzlePoint(actor, elevationDegrees, direction, cfg = COMBAT) {
  const rad = elevationDegrees * Math.PI / 180;
  const grip = weaponGripPoint(actor, direction, cfg);
  return {
    pivotX: grip.x,
    pivotY: grip.y,
    x: grip.x + direction * Math.cos(rad) * cfg.weaponBarrelLength,
    y: grip.y - Math.sin(rad) * cfg.weaponBarrelLength,
  };
}

export function createProjectile({ actor, target, force, elevation, wind, cfg = PHYSICS }) {
  const direction = Math.sign(target.x - actor.x) || 1;
  const muzzle = muzzlePoint(actor, elevation, direction);
  const velocity = launchVector(force, elevation, direction, cfg);
  return {
    owner: actor.index,
    x: muzzle.x,
    y: muzzle.y,
    prevX: muzzle.x,
    prevY: muzzle.y,
    vx: velocity.vx,
    vy: velocity.vy,
    age: 0,
    direction,
    elevation,
    force,
    trail: [{ x: muzzle.x, y: muzzle.y }],
    alive: true,
    impact: null,
  };
}

function solidProbe(terrain, x, y, radius = 2.5) {
  if (!terrain) return false;
  if (typeof terrain.isSolidCircle === 'function') {
    return terrain.isSolidCircle(x, y, radius);
  }
  if (typeof terrain.isSolidRect === 'function') {
    return terrain.isSolidRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  return terrain.isSolid(Math.round(x), Math.round(y));
}

export function isProjectileOut(x, y, world = WORLD) {
  return x < -60
    || x > world.width + 60
    || y > world.height + 80
    || y < -world.height * 2;
}

/**
 * Sweep the previous→current line at a fixed spatial step and return the first
 * terrain sample. Two pixels is smaller than any usable terrain lip, so a
 * fast shell cannot tunnel through a thin ridge between two Euler steps.
 */
export function segmentTerrainHit(startX, startY, endX, endY, terrain, step = 2, radius = 2.5) {
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.hypot(dx, dy);
  const substeps = Math.max(1, Math.ceil(distance / step));
  for (let i = 1; i <= substeps; i += 1) {
    const t = i / substeps;
    const x = startX + dx * t;
    const y = startY + dy * t;
    if (solidProbe(terrain, x, y, radius)) return { x, y, t, substeps };
  }
  return null;
}

function hitTarget(x, y, target, offsetY) {
  if (!target || target.hp <= 0) return false;
  const tx = target.x;
  const ty = target.y - offsetY;
  const dx = x - tx;
  const dy = y - ty;
  return dx * dx + dy * dy <= (COMBAT.targetHitRadius * COMBAT.targetHitRadius);
}

/**
 * Move one 0.04 s Euler step, but sweep the 3 px sub-steps used by
 * BombObject.MoveTo(). Returns {impact: 'actor'|'ground'|'out'|null}.
 */
export function stepProjectileWithCollision(projectile, target, terrain, wind, cfg = PHYSICS) {
  const startX = projectile.x;
  const startY = projectile.y;
  projectile.prevX = startX;
  projectile.prevY = startY;
  stepProjectile(projectile, wind, cfg);
  const dx = projectile.x - startX;
  const dy = projectile.y - startY;
  const distance = Math.hypot(dx, dy);
  const substeps = Math.max(1, Math.ceil(distance / 2));

  for (let i = 1; i <= substeps; i += 1) {
    const t = i / substeps;
    const x = startX + dx * t;
    const y = startY + dy * t;

    if (projectile.age > 0.07 && hitTarget(x, y, target, 38)) {
      projectile.x = x;
      projectile.y = y;
      projectile.impact = 'actor';
      projectile.alive = false;
      return projectile;
    }

    if (solidProbe(terrain, x, y, 2.5)) {
      projectile.x = x;
      projectile.y = y;
      projectile.impact = 'ground';
      projectile.alive = false;
      return projectile;
    }

    if (isProjectileOut(x, y)) {
      projectile.x = x;
      projectile.y = y;
      projectile.impact = 'out';
      projectile.alive = false;
      return projectile;
    }
  }

  projectile.x = startX + dx;
  projectile.y = startY + dy;
  return projectile;
}

/**
 * Simulate a full shot for the AI and for deterministic tests.
 * `terrain` needs isSolidRect(x,y,w,h), or isSolid(x,y).
 */
export function simulateShot({
  origin,
  angle,
  force,
  direction,
  wind,
  target,
  terrain,
  cfg = PHYSICS,
  maxSeconds = cfg.maxFlightSeconds,
  includePath = false,
}) {
  const velocity = launchVector(force, angle, direction, cfg);
  const p = {
    x: origin.x,
    y: origin.y,
    vx: velocity.vx,
    vy: velocity.vy,
    age: 0,
    alive: true,
    impact: null,
  };
  let closest = Infinity;
  let closestX = p.x;
  let closestY = p.y;
  let path = includePath ? [{ x: p.x, y: p.y }] : null;
  const centerY = target ? target.y - 38 : 0;
  const maxSteps = Math.ceil(maxSeconds / cfg.dt);

  for (let step = 0; step < maxSteps && p.alive; step += 1) {
    const startX = p.x;
    const startY = p.y;
    stepProjectile(p, wind, cfg);
    const dx = p.x - startX;
    const dy = p.y - startY;
    const substeps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));

    for (let i = 1; i <= substeps; i += 1) {
      const t = i / substeps;
      const x = startX + dx * t;
      const y = startY + dy * t;
      if (target) {
        const d = Math.hypot(x - target.x, y - centerY);
        if (d < closest) {
          closest = d;
          closestX = x;
          closestY = y;
        }
      }
      if (p.age > 0.07 && target) {
        const d = Math.hypot(x - target.x, y - centerY);
        if (d <= COMBAT.targetHitRadius) {
          p.x = x;
          p.y = y;
          p.impact = 'actor';
          p.alive = false;
          break;
        }
      }
      if (solidProbe(terrain, x, y, 2.5)) {
        p.x = x;
        p.y = y;
        p.impact = 'ground';
        p.alive = false;
        break;
      }
      if (isProjectileOut(x, y)) {
        p.x = x;
        p.y = y;
        p.impact = 'out';
        p.alive = false;
        break;
      }
    }
    if (path) path.push({ x: p.x, y: p.y });
  }

  return {
    x: p.x,
    y: p.y,
    impact: p.impact,
    closest,
    closestX,
    closestY,
    path,
    age: p.age,
  };
}

/** MakeDamage() from SimpleBomb.cs with the DB-derived stats supplied by config. */
export function sourceDamage(distance, radius, attacker = COMBAT, defender = COMBAT, cfg = COMBAT) {
  if (!Number.isFinite(distance) || distance >= radius) return 0;
  const baseGuard = defender.baseGuard ?? cfg.baseGuard;
  const defence = defender.defence ?? cfg.defence;
  const attack = attacker.attack ?? cfg.attack;
  const baseDamage = attacker.baseDamage ?? cfg.baseDamage;
  const grade = attacker.grade ?? cfg.grade;
  const lucky = attacker.lucky ?? cfg.lucky;
  const damagePlus = attacker.damagePlus ?? cfg.damagePlus;
  const shootMinus = attacker.shootMinus ?? cfg.shootMinus;
  const worldBossAddDamage = attacker.worldBossAddDamage || 0;

  const dr1 = 0.95 * (baseGuard - 3 * grade) / (500 + baseGuard - 3 * grade);
  const dr2 = defence - lucky >= 0
    ? 0.95 * (defence - lucky) / (600 + defence - lucky)
    : 0;
  const dr3 = worldBossAddDamage * (1 - (baseGuard / 200 + defence * 0.003));
  const raw = (dr3 + baseDamage * (1 + attack * 0.001) * (1 - (dr1 + dr2 - dr1 * dr2)))
    * damagePlus * shootMinus;
  const falloff = 1 - distance / radius / 4;
  const value = Math.trunc(raw * falloff);
  return value <= 0 ? 1 : value;
}

export function blastDamageFor(target, impact, attacker, cfg = COMBAT) {
  const dx = impact.x - target.x;
  const dy = impact.y - (target.y - 38);
  const distance = Math.hypot(dx, dy);
  const amount = sourceDamage(distance, cfg.blastRadius, attacker, target, cfg);
  return { amount, distance };
}
