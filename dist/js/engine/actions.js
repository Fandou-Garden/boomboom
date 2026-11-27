/**
 * Pure-JS port of server/game/actions.go — one volley's whole life:
 * fireLocked -> updateFlightLocked -> resolveImpactLocked -> queued shells ->
 * finishFlightLocked -> finishResolveLocked -> next turn. Also carries the
 * heal action.
 *
 * All functions take the Match instance as `m`; they are plain functions
 * (rather than methods) so the state lives in one class and the actions stay
 * readable next to their Go counterparts.
 */
import {
  BLAST_RADIUS, CRITICAL_LUCKY, CRITICAL_REDUCE, ENERGY_MAX, ENERGY_PER_HIT,
  ENERGY_PER_VOLLEY, ENERGY_PER_HEAL, FORCE_MAX, GROUND_BOTTOM, HEAL_AMOUNT,
  HEAL_DELAY, HEALS_PER_ROUND, MAX_FLIGHT_SECONDS, PHYSICS_DT, RESOLVE_DELAY,
  SKILL_DEFS, SKILL_ORDER, WORLD_WIDTH, ballFor, clamp,
} from './constants.js?v=24';
import { blastDamage, launch, muzzlePoint, sourceCriticalDamage, stepProjectile } from './physics.js?v=24';
import { makeImpact } from './json.js?v=24';

export function fireLocked(m, index, angle, force) {
  if (m.phase === 'over' || index < 0 || index > 1) return false;
  const a = m.actors[index];
  const target = m.actors[1 - index];
  if (!a || !target || !a.alive || !target.alive) return false;
  if (index === 0 && m.phase !== 'player') return false;
  if (index === 1 && m.phase !== 'enemy_aim' && m.phase !== 'enemy_move') return false;

  let direction = 1;
  if (target.x < a.x) direction = -1;
  a.facing = direction;
  a.aimAngle = angle;

  const weapon = m.weaponForActor(index);
  let offsets = [0];
  let scales = [1];
  let attackPenalty = 1.0;
  let firedSkill = '';
  let sequential = false;
  const carry = index === 0 && m.carryArmed && m.canCarry;
  const pow = index === 0 && !carry && m.powSelected && m.energy >= ENERGY_MAX;
  // SOURCE: bombconfig.xml Common/Special -> BallList.xml. A normal shot uses
  // the weapon's Common ball; POW fires its Special ball. Shell count, damage
  // multiplier, blast radius and crater all come from that BallList row.
  let ball = ballFor(weapon.ballId);
  if (pow) ball = ballFor(weapon.specialBallId);
  let ballPower = ball.power;
  if (carry) ballPower = 0;
  if (carry) {
    offsets = [0];
    scales = [1];
  } else if (pow && ball.amount > 1) {
    // SOURCE: BallList Amount=3 POW balls (151/171/371/411) fire the same
    // vector sequentially; every scale must be 1 (a zero-filled slice would
    // clamp the force to 1 and drop the shells straight down).
    offsets = new Array(ball.amount).fill(0);
    scales = new Array(ball.amount).fill(1);
    sequential = true;
  } else if (index === 0 && m.selectedSkill !== '') {
    const def = SKILL_DEFS[m.selectedSkill];
    if (def && def.kind === 'attack' && m.skillUses[m.selectedSkill] > 0) {
      offsets = def.offsets;
      scales = def.forceScales;
      sequential = !!def.sequential;
      attackPenalty = def.damageScale;
      firedSkill = def.id;
    }
  }
  let damageBonus = 0;
  if (index === 0 && !pow) {
    for (const id of m.selectedBuffs) {
      const def = SKILL_DEFS[id];
      if (def && def.kind === 'boost' && m.skillUses[id] > 0) damageBonus += def.damageBonus;
    }
  }
  const damageScale = (1 + damageBonus) * attackPenalty;

  const safeForce = clamp(force, 1, FORCE_MAX);
  const baseAngle = clamp(angle, weapon.angleMin, weapon.angleMax);
  const volleyId = `${m.round}-${m.turn}-${Math.trunc(m.time * 1000)}`;
  const shots = [];
  for (let i = 0; i < offsets.length; i += 1) {
    const elevation = baseAngle + offsets[i];
    let scale = 1.0;
    if (i < scales.length) scale = scales[i];
    const f = clamp(safeForce * scale, 1, FORCE_MAX);
    const { x: mx, y: my } = muzzlePoint(a, elevation, direction);
    const { vx, vy } = launch(f, elevation, direction);
    const p = {
      owner: index, x: mx, y: my, prevX: mx, prevY: my, vx, vy, ax: 0, ay: 0,
      age: 0, alive: true, impact: '', direction, elevation, force: f,
      trail: [{ x: mx, y: my }], volleyId, slot: i, shells: offsets.length,
      skill: firedSkill, weapon: weapon.id, craterArt: ball.crater,
      blastRadius: ball.radii, damageScale: damageScale * ballPower,
      pow, carry: false, resolved: false,
    };
    if (carry) {
      // BallList ID=3: Power=0, Crater="" — no damage, no crater; the impact
      // translates the owner to the landing point instead.
      p.carry = true;
      p.damageScale = 0;
      p.craterArt = '';
    }
    shots.push(p);
  }

  let activeShots = shots;
  m.queuedShots = [];
  m.volleyTotal = shots.length;
  if (sequential && shots.length > 1) {
    activeShots = [shots[0]];
    m.queuedShots = shots.slice(1);
  }
  m.shots = activeShots;
  m.shot = activeShots[0];
  m.phase = 'flight';
  m.timer = 0;
  m.flightAccumulator = 0;
  m.pendingWinner = null;
  m.charging = false;
  m.force = 0;
  m.chargeElapsed = 0;
  m.moveDir = 0;
  a.walkDirection = 0;
  a.fireTimer = 0.28;
  m.lastPower = safeForce;

  if (index === 0) {
    m.stats.playerShots += activeShots.length;
    if (carry) {
      // One fly per turn: consume the armed shot and availability.
      m.carryArmed = false;
      m.canCarry = false;
    } else if (pow) {
      m.energy = 0;
      m.powSelected = false;
    } else {
      m.energy = Math.min(ENERGY_MAX, m.energy + ENERGY_PER_VOLLEY);
      if (m.selectedSkill !== '') {
        if (m.skillUses[m.selectedSkill] > 0) m.skillUses[m.selectedSkill] -= 1;
        m.selectedSkill = '';
      }
      for (const id of m.selectedBuffs) {
        if (m.skillUses[id] > 0) m.skillUses[id] -= 1;
      }
      m.selectedBuffs = [];
    }
  } else {
    m.stats.enemyShots += activeShots.length;
  }

  if (pow) m.emit('sound', { name: 'pow' });
  m.emit('sound', { name: 'fire', weapon: weapon.id });
  const fireEvent = {
    actor: index, x: a.x, y: a.y, angle: baseAngle, force: safeForce,
    pow, shells: shots.length, volleyId,
  };
  if (firedSkill) fireEvent.skill = firedSkill;
  fireEvent.weapon = weapon.id;
  if (carry) fireEvent.carry = true;
  m.emit('fire', fireEvent);
  return true;
}

export function updateFlightLocked(m, dt) {
  m.flightAccumulator += dt;
  let steps = 0;
  while (m.flightAccumulator >= PHYSICS_DT && steps < 8) {
    m.flightAccumulator -= PHYSICS_DT;
    steps += 1;
    for (const p of m.shots) {
      if (!p || !p.alive) continue;
      const target = m.actors[1 - p.owner];
      stepProjectile(p, target, m.terrain, m.wind);
      const last = p.trail[p.trail.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 2) {
        if (p.trail.length < 600) p.trail.push({ x: p.x, y: p.y });
      }
      if (!p.alive) {
        resolveImpactLocked(m, p);
      } else if (p.age >= MAX_FLIGHT_SECONDS) {
        p.alive = false;
        p.impact = 'out';
        resolveImpactLocked(m, p);
      }
    }
  }

  let alive = false;
  for (const p of m.shots) {
    if (p && p.alive) {
      alive = true;
      m.shot = p;
      break;
    }
  }
  if (!alive) finishFlightLocked(m);
}

function resolveCarryImpactLocked(m, p, ix, iy, impactType) {
  const owner = m.actors[p.owner];
  let tx = ix;
  let ty = iy;
  if (impactType === 'ground' || impactType === 'actor') {
    const length = Math.hypot(p.vx, p.vy);
    if (length > 0.0001) {
      tx -= (p.vx / length) * 5;
      ty -= (p.vy / length) * 5;
    }
  }
  const lx = Math.trunc(Math.round(clamp(tx, 70, WORLD_WIDTH - 70)));
  let landY;
  const fromY = Math.trunc(Math.max(0, Math.min(m.terrain.height - 1, ty - 8)));
  let g = m.terrain.findGroundY(lx, fromY, m.terrain.height - 1);
  if (!g.ok) g = m.terrain.findGroundY(lx, 0, m.terrain.height - 1);
  landY = g.ok ? g.y : GROUND_BOTTOM;
  if (owner && owner.alive) {
    owner.x = lx;
    owner.y = landY;
    owner.vy = 0;
    owner.falling = false;
    owner.grounded = true;
    owner.slope = m.terrain.slopeAt(owner.x, owner.y, 22);
    owner.walkDirection = 0;
    owner.walkAccum = 0;
    m.refreshSupportLocked(owner);
  }
  const impact = makeImpact({ x: lx, y: landY, type: 'carry', owner: p.owner, shell: p.slot, shells: p.shells });
  m.lastImpact = impact;
  if (p.owner === 0) m.lastPlayerSummary = `第 ${m.round} 回合 · 传送到落点`;
  m.emit('translate', { actor: p.owner, x: lx, y: landY, shell: p.slot });
  m.emit('sound', { name: 'carry' });
  m.emit('impact', impact);
}

export function resolveImpactLocked(m, p) {
  if (!p || p.resolved) return;
  p.resolved = true;
  let impactType = p.impact;
  if (impactType === '') impactType = 'out';
  const ix = Math.trunc(p.x);
  const iy = Math.trunc(p.y);
  p.x = ix;
  p.y = iy;
  if (p.carry) {
    resolveCarryImpactLocked(m, p, ix, iy, impactType);
    return;
  }
  const attacker = m.actors[p.owner];
  const target = m.actors[1 - p.owner];
  const impact = makeImpact({
    x: ix, y: iy, type: impactType, owner: p.owner, shell: p.slot, shells: p.shells,
  });
  if (impactType === 'ground' || impactType === 'actor') {
    // SOURCE: BallList.xml — the crater and blast radius belong to the shell
    // (BallList Radii/Crater), not to a global POW override.
    let art = p.craterArt;
    if (!art) art = m.weaponForActor(p.owner).craterArt;
    let kind = 'medium';
    let radius = p.blastRadius;
    if (!(radius > 0)) radius = BLAST_RADIUS;
    if (radius >= 60) kind = 'large';
    const carved = m.terrain.carve(ix, iy, art, kind);
    impact.removed = carved.removed;
    impact.craterKind = kind;
    impact.craterArt = art;
    for (const a of m.actors) m.refreshSupportLocked(a);
    // SOURCE: SimpleBomb.MakeDamage — the ball Power is folded into
    // DamageScale at launch (normal 1.0, POW 1.5/1.3/0.6/0.5, carry 0).
    const blast = blastDamage(target, ix, iy, attacker, radius);
    let damage = Math.trunc(blast.damage * p.damageScale);
    if (damage < 0) damage = 0;
    let critical = 0;
    if (damage > 0 && target.alive) {
      let roll = 99;
      if (m.critRng) roll = m.critRng.intn(100);
      critical = sourceCriticalDamage(CRITICAL_LUCKY, CRITICAL_REDUCE, damage, roll);
    }
    const total = damage + critical;
    impact.damage = damage;
    if (critical) impact.critical = critical;
    impact.distance = blast.distance;
    if (total > 0 && target.alive) {
      target.hp -= total;
      target.flash = 1;
      target.hurtTimer = 0.5;
      if (p.owner === 0) {
        m.stats.playerHits += 1;
        m.stats.playerDamageDealt += total;
        m.energy = Math.min(ENERGY_MAX, m.energy + ENERGY_PER_HIT);
      } else {
        m.stats.enemyHits += 1;
        m.stats.playerDamageTaken += total;
      }
      m.emit('sound', { name: 'hit' });
      if (critical > 0) m.emit('sound', { name: 'critical' });
      if (target.hp <= 0) {
        target.hp = 0;
        target.alive = false;
        target.falling = false;
        target.vy = 0;
        m.pendingWinner = p.owner;
        m.emit('sound', { name: 'death' });
      }
    }
    m.emit('sound', { name: 'explosion', weapon: p.weapon });
  } else {
    m.emit('sound', { name: 'out' });
  }
  if (p.owner === 0) {
    if (impact.damage > 0) {
      if (impact.critical > 0) {
        m.lastPlayerSummary = `第 ${m.round} 回合 · 暴击 ${impact.damage}+${impact.critical} 伤害`;
      } else {
        m.lastPlayerSummary = `第 ${m.round} 回合 · 命中 ${impact.damage} 伤害`;
      }
    } else {
      m.lastPlayerSummary = `第 ${m.round} 回合 · 未命中`;
    }
  }
  m.lastImpact = impact;
  m.emit('impact', impact);
}

export function launchQueuedShotLocked(m) {
  if (!m.queuedShots.length) return false;
  const p = m.queuedShots.shift();
  m.shots = [p];
  m.shot = p;
  m.phase = 'flight';
  m.timer = 0;
  m.flightAccumulator = 0;
  if (p.owner === 0) m.stats.playerShots += 1;
  else m.stats.enemyShots += 1;
  m.emit('sound', { name: 'fire', weapon: p.weapon });
  const fireEvent = {
    actor: p.owner, x: p.x, y: p.y, angle: p.elevation, force: p.force,
    pow: p.pow, shells: p.shells, shell: p.slot, followup: true, volleyId: p.volleyId,
  };
  if (p.skill) fireEvent.skill = p.skill;
  fireEvent.weapon = p.weapon;
  m.emit('fire', fireEvent);
  return true;
}

export function finishFlightLocked(m) {
  if (m.phase !== 'flight') return;
  if (m.pendingWinner === null && launchQueuedShotLocked(m)) return;
  let shotCount = m.volleyTotal;
  if (shotCount === 0) shotCount = m.shots.length;
  m.shot = null;
  m.shots = [];
  m.queuedShots = [];
  m.volleyTotal = 0;
  m.flightAccumulator = 0;
  m.phase = 'resolve';
  m.timer = RESOLVE_DELAY;
  m.refreshSupportLocked(m.actors[0]);
  m.refreshSupportLocked(m.actors[1]);
  m.emit('volley-resolve', { pendingWinner: m.pendingWinner, shots: shotCount });
}

export function finishResolveLocked(m) {
  if (m.pendingWinner !== null) {
    m.winner = m.pendingWinner;
    m.phase = 'over';
    m.timer = 0;
    m.countdown = 0;
    m.showCountdown = false;
    m.emit('gameover', { winner: m.winner });
    return;
  }
  if (!m.actors[0].alive || !m.actors[1].alive) {
    if (m.actors[0].alive) m.winner = 0;
    else if (m.actors[1].alive) m.winner = 1;
    m.phase = 'over';
    m.emit('gameover', { winner: m.winner });
    return;
  }
  const next = 1 - m.turn;
  if (next === 0) m.round += 1;
  beginTurnLocked(m, next, true);
}

export function beginTurnLocked(m, index, rollWind) {
  m.turn = index;
  m.force = 0;
  m.charging = false;
  m.chargeElapsed = 0;
  m.moveDir = 0;
  m.aiPlan = null;
  m.aiMoveTarget = 0;
  m.shots = [];
  m.shot = null;
  for (const a of m.actors) {
    a.walkDirection = 0;
    a.walkAccum = 0;
    m.refreshSupportLocked(a);
    if (a.alive && !a.falling) a.slope = m.terrain.slopeAt(a.x, a.y, 22);
  }
  m.actors[0].facing = 1;
  m.actors[1].facing = -1;
  if (m.actors[1].x < m.actors[0].x) {
    m.actors[0].facing = -1;
    m.actors[1].facing = 1;
  }
  if (rollWind && !m.fixedWind) {
    const next = m.nextWind();
    m.wind = next.wind;
    m.windTarget = next.target;
    m.emit('wind', { wind: m.wind, label: m.windLabel() });
  }
  if (index === 0) {
    m.phase = 'player';
    m.timer = 0;
    m.healsRemaining = HEALS_PER_ROUND;
    for (const id of SKILL_ORDER) m.skillUses[id] = 1;
    m.selectedSkill = '';
    m.selectedBuffs = [];
    m.powSelected = false;
    m.carryArmed = false;
    m.canCarry = true;
    m.stamina = 100;
    const pw = m.playerWeapon();
    m.angle = clamp(m.angle, pw.angleMin, pw.angleMax);
    m.actors[0].aimAngle = m.angle;
    m.actors[0].weapon = pw.id;
    m.actors[1].weapon = m.enemyWeapon().id;
    m.countdown = 30.0;
    m.showCountdown = false;
    m.emit('turn', { turn: 0, round: m.round });
    m.emit('toast', { text: '你的回合：瞄准、蓄力、开炮' });
  } else {
    m.phase = 'enemy_move';
    m.timer = 0.72;
    m.aiMoveTarget = m.chooseEnemyMoveTargetLocked();
    m.enemyAimAngle = m.actors[1].aimAngle;
    m.emit('turn', { turn: 1, round: m.round });
    m.emit('toast', { text: '电脑的回合' });
  }
  m.showCountdown = false;
}

export function canHealLocked(m) {
  const p = m.actors[0];
  return m.phase === 'player' && !m.charging && p.alive && m.healsRemaining > 0 && p.hp < p.maxHp;
}

export function healLocked(m) {
  if (!canHealLocked(m)) return false;
  const p = m.actors[0];
  const amount = Math.min(HEAL_AMOUNT, p.maxHp - p.hp);
  if (amount <= 0) return false;
  p.hp += amount;
  p.flash = 0.5;
  m.healsRemaining -= 1;
  m.stats.playerHeals += 1;
  m.stats.playerHealed += amount;
  m.energy = Math.min(ENERGY_MAX, m.energy + ENERGY_PER_HEAL);
  m.charging = false;
  m.moveDir = 0;
  m.phase = 'heal';
  m.timer = HEAL_DELAY;
  m.emit('heal', { amount, hp: p.hp, maxHp: p.maxHp, heals: m.healsRemaining });
  m.emit('sound', { name: 'heal' });
  return true;
}
