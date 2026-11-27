/**
 * JSON projections matching server/game struct tags byte-for-byte where the
 * client cares (Snapshot, Event data, Impact, Projectile, Actor).
 *
 * Watch the tags: Snapshot/Projectile/Actor/Impact/AIPlan use lowerCamel JSON
 * names, but SimResult in physics.go has NO tags, so its keys stay capitalised
 * (X, Y, Impact, ...). Reproduce that exactly — the debug panel reads
 * `expected.closest` off these objects.
 */

export function copyProjectile(p) {
  const c = {
    owner: p.owner, x: p.x, y: p.y, prevX: p.prevX, prevY: p.prevY,
    vx: p.vx, vy: p.vy, ax: p.ax, ay: p.ay, age: p.age, alive: p.alive,
    direction: p.direction, elevation: p.elevation, force: p.force,
    trail: p.trail.map((t) => ({ x: t.x, y: t.y })),
    volleyId: p.volleyId, slot: p.slot, shells: p.shells,
    damageScale: p.damageScale, pow: p.pow, resolved: p.resolved,
  };
  if (p.impact) c.impact = p.impact;
  if (p.skill) c.skill = p.skill;
  if (p.weapon) c.weapon = p.weapon;
  if (p.craterArt) c.craterArt = p.craterArt;
  if (p.carry) c.carry = true;
  return c;
}

export function makeImpact(fields) {
  const impact = {
    x: fields.x, y: fields.y, type: fields.type, owner: fields.owner,
    damage: fields.damage || 0, distance: fields.distance || 0,
    removed: fields.removed || 0, craterKind: fields.craterKind || '',
    craterArt: fields.craterArt || '', shell: fields.shell || 0, shells: fields.shells || 0,
  };
  if (fields.critical) impact.critical = fields.critical;
  return impact;
}

export function simResultJson(r) {
  return {
    X: r.x, Y: r.y, Impact: r.impact, Closest: r.closest,
    ClosestX: r.closestX, ClosestY: r.closestY, Age: r.age,
    Path: r.path ? r.path.map((pt) => ({ x: pt.x, y: pt.y })) : null,
    HitActor: r.hitActor, HitGround: r.hitGround, OutOfWorld: r.outOfWorld,
  };
}

export function aiPlanJson(plan) {
  if (!plan) return null;
  return {
    angle: plan.angle, force: plan.force, direction: plan.direction,
    expected: simResultJson(plan.expected),
    solvedAngle: plan.solvedAngle, solvedForce: plan.solvedForce,
  };
}

export function actorJson(a) {
  return {
    index: a.index, id: a.id, name: a.name, subtitle: a.subtitle,
    x: a.x, y: a.y, hp: a.hp, maxHp: a.maxHp, facing: a.facing,
    alive: a.alive, walkDirection: a.walkDirection, walkTime: a.walkTime,
    animTime: a.animTime, slope: a.slope, vy: a.vy, falling: a.falling,
    grounded: a.grounded, fireTimer: a.fireTimer, hurtTimer: a.hurtTimer,
    aimAngle: a.aimAngle, flash: a.flash, weapon: a.weapon,
    baseDamage: a.baseDamage, attack: a.attack, baseGuard: a.baseGuard,
    defence: a.defence, grade: a.grade, lucky: a.lucky,
    damagePlus: a.damagePlus, shootMinus: a.shootMinus,
    worldBossAddDamage: a.worldBossAddDamage,
  };
}
