/**
 * Pure-JS port of server/game/match.go — the authoritative duel state machine.
 *
 * One behavior change is forced by the browser: Go charges from time.Now(), JS
 * has no wall clock inside the engine, so the constructor takes a `clock`
 * (seconds). The standalone adapter passes performance.now()/1000; tests can
 * pass a fake clock. Everything else is a straight port.
 */
import {
  ACTOR_WIDTH, ATTACK, BASE_DAMAGE, BASE_GUARD, CHARGE_RATE, COUNTDOWN_SECONDS,
  DAMAGE_PLUS, DEFENCE, ENEMY_AIM_SECONDS, ENEMY_MAX_HP, ENEMY_MOVE_SECONDS,
  ENEMY_MOVE_SPEED, ENEMY_THINK_SECONDS, FIXED_WIND, FALL_GRAVITY, FALL_MAX_SPEED,
  FORCE_MAX, GRADE, GROUND_BOTTOM, HEAL_AMOUNT, HEALS_PER_ROUND, MIN_CHARGE_SECONDS,
  MIN_FIRE_FORCE, MOVE_SPEED, MOVE_STEP_X, MOVE_STEP_Y, PIXELS_PER_METRE, PLAYER_MAX_HP,
  RESOLVE_DELAY, SHOOT_MINUS, SKILL_DEFS, SKILL_ORDER, SPAWN_PROBE_Y, SPAWN_X,
  STAMINA_MAX, STAMINA_MOVE_COST, SKILL_USES_PER_ROUND, WORLD_HEIGHT, WORLD_WIDTH, clamp, weaponFor, WEAPON_DEFS, LUCKY,
} from './constants.js?v=33';
import { nextWind } from './physics.js?v=33';
import { GoRand } from './rng.js?v=33';
import { chooseShotForWeapon, triangularNoise } from './ai.js?v=33';
import {
  beginTurnLocked, finishResolveLocked, fireLocked, healLocked, updateFlightLocked,
} from './actions.js?v=33';
import { buildSnapshot } from './snapshot.js?v=33';
import { aiPlanJson } from './json.js?v=33';

function makeActor(overrides) {
  return {
    index: 0, id: '', name: '', subtitle: '', x: 0, y: 0, hp: 0, maxHp: 0,
    facing: 1, alive: true, walkDirection: 0, walkTime: 0, animTime: 0,
    slope: 0, vy: 0, falling: false, grounded: true, fireTimer: 0,
    hurtTimer: 0, aimAngle: 0, flash: 0, weapon: '',
    baseDamage: 0, attack: 0, baseGuard: 0, defence: 0, grade: 0, lucky: 0,
    damagePlus: 0, shootMinus: 0, worldBossAddDamage: 0,
    walkAccum: 0,
    ...overrides,
  };
}

export function chargeForce(elapsed) {
  return clamp(elapsed * CHARGE_RATE, 0, FORCE_MAX);
}

export class Match {
  constructor({ terrain, seed = 1, lowPower = false, debug = false, clock } = {}) {
    this.terrain = terrain;
    this.playerWeaponId = 'fruit';
    this.enemyWeaponId = 'cannon';
    this.fixedWind = FIXED_WIND;
    this.lowPower = lowPower;
    this.allowDebug = debug;
    this.now = typeof clock === 'function' ? clock : () => Date.now() / 1000;
    this.rng = new GoRand(seed);
    // SOURCE Living.MakeCriticalDamage uses a separate Random.Next(100) stream.
    this.critSeed = Number(BigInt(Math.trunc(seed)) ^ 0x43524954n);
    this.critRng = new GoRand(this.critSeed);
    this.seq = 0;
    this.eventLog = [];
    this.actors = [];
    this.shots = [];
    this.queuedShots = [];
    this.skillUses = {};
    this.stats = emptyStats();
    // Optional host hook (standalone-api installs one when a Web Worker is
    // available): (job, done) => void. Runs the ballistic search off-thread;
    // the match keeps ownership of the RNG and the authoritative plan.
    this.aiSolver = null;
    this.resetLocked();
  }

  setDebug(enabled) { this.allowDebug = !!enabled; }

  reset() { this.resetLocked(); }

  resetLocked() {
    this.terrain.reset();
    this.time = 0;
    this.round = 1;
    this.turn = 0;
    this.phase = 'player';
    this.timer = 0;
    this.critRng = new GoRand(this.critSeed);
    if (!WEAPON_DEFS[this.playerWeaponId]) this.playerWeaponId = 'fruit';
    if (!WEAPON_DEFS[this.enemyWeaponId]) this.enemyWeaponId = 'cannon';
    const playerWeapon = this.playerWeapon();
    const enemyWeapon = this.enemyWeapon();
    this.angle = playerWeapon.startAngle;
    this.force = 0;
    this.charging = false;
    this.chargeStarted = 0;
    this.chargeElapsed = 0;
    this.selectedSkill = '';
    this.selectedBuffs = [];
    this.powSelected = false;
    this.carryArmed = false;
    this.canCarry = true;
    this.energy = 0;
    this.stamina = STAMINA_MAX;
    this.skillUses = {};
    for (const id of SKILL_ORDER) this.skillUses[id] = SKILL_USES_PER_ROUND;
    // How many cards of each skill have already been played this turn. Drives
    // the "already played" highlight on the skill bar.
    this.skillPlayed = {};
    // Attack cards stack: playing two "attack +1" cards fires two volleys.
    this.attackStacks = 0;
    this.healsRemaining = HEALS_PER_ROUND;
    this.shots = [];
    this.shot = null;
    this.queuedShots = [];
    this.volleyTotal = 0;
    this.flightAccumulator = 0;
    this.lastImpact = null;
    this.lastPlayerSummary = '—';
    this.lastPower = null;
    this.winner = null;
    this.pendingWinner = null;
    this.stats = emptyStats();
    this.countdown = COUNTDOWN_SECONDS;
    // 出手倒计时默认显示（含服务端模式，服务端关闭 debug 命令也能看到）。
    // countdownEnabled 是玩家开关，beginTurn 只重置本回合读数，不覆盖开关。
    this.countdownEnabled = true;
    this.showCountdown = true;
    this.moveDir = 0;
    this.aiPlan = null;
    this.aiPending = false;
    // Invalidate any in-flight worker search from a previous match/turn.
    this.aiToken = (this.aiToken || 0) + 1;
    this.aiWait = 0;
    this.aiMoveTarget = 0;
    this.enemyAimAngle = enemyWeapon.startAngle;
    this.enemyAimFrom = enemyWeapon.startAngle;
    this.enemyAimTo = enemyWeapon.startAngle;
    this.enemyAimElapsed = 0;

    const spawn = [this.spawnColumnLocked(0), this.spawnColumnLocked(1)];
    this.actors = [
      makeActor({
        index: 0, id: 'player', name: '蓝波', subtitle: '你',
        x: spawn[0][0], y: spawn[0][1], hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
        facing: 1, alive: true, grounded: true, aimAngle: playerWeapon.startAngle,
        weapon: playerWeapon.id, baseDamage: BASE_DAMAGE, attack: ATTACK,
        baseGuard: BASE_GUARD, defence: DEFENCE, grade: GRADE, lucky: LUCKY,
        damagePlus: DAMAGE_PLUS, shootMinus: SHOOT_MINUS,
      }),
      makeActor({
        index: 1, id: 'enemy', name: '芽芽', subtitle: '电脑',
        x: spawn[1][0], y: spawn[1][1], hp: ENEMY_MAX_HP, maxHp: ENEMY_MAX_HP,
        facing: -1, alive: true, grounded: true, aimAngle: enemyWeapon.startAngle,
        weapon: enemyWeapon.id, baseDamage: BASE_DAMAGE, attack: ATTACK,
        baseGuard: BASE_GUARD, defence: DEFENCE, grade: GRADE, lucky: LUCKY,
        damagePlus: DAMAGE_PLUS, shootMinus: SHOOT_MINUS,
      }),
    ];
    this.actors[0].slope = this.terrain.slopeAt(this.actors[0].x, this.actors[0].y, 22);
    this.actors[1].slope = this.terrain.slopeAt(this.actors[1].x, this.actors[1].y, 22);

    // SOURCE BaseGame leaves map wind and m_nextWind at 0.
    this.wind = 0;
    this.windTarget = 0;

    this.emit('reset', {});
    this.emit('turn', { turn: 0, round: 1 });
    this.emit('wind', { wind: 0.0 });
    this.emit('toast', { text: '按住左右移动 · 上/下调角度 · 按住发射蓄力，松手开炮' });
  }

  /**
   * Mirrors match.go spawnColumnLocked: walk outward from the preferred column
   * in 10 px steps and take the first one with ground underfoot, 110 px of
   * head clearance and shoulder support two pixels either side. Falls back to
   * the preferred column, then to the sky, exactly like the Go code.
   */
  spawnColumnLocked(index) {
    const prefer = Math.trunc(SPAWN_X[index]);
    const width = this.terrain.width;
    const offsets = [0];
    for (let d = 10; d <= 360; d += 10) offsets.push(d, -d);
    for (const d of offsets) {
      const x = prefer + d;
      if (x < 80 || x > width - 80) continue;
      const g = this.terrain.findGroundY(x, SPAWN_PROBE_Y, GROUND_BOTTOM);
      if (!g.ok) continue;
      let clear = true;
      for (let y = g.y - 110; y < g.y; y += 1) {
        if (this.terrain.isSolid(x, y)) { clear = false; break; }
      }
      if (!clear) continue;
      let supported = false;
      for (let y = g.y + 1; y <= g.y + 8 && y < this.terrain.height; y += 1) {
        if (this.terrain.isSolid(x - 16, y) || this.terrain.isSolid(x + 16, y)) {
          supported = true;
          break;
        }
      }
      if (!supported) continue;
      return [x, g.y];
    }
    const g = this.terrain.findGroundY(prefer, SPAWN_PROBE_Y, GROUND_BOTTOM);
    if (g.ok) return [prefer, g.y];
    return [prefer, WORLD_HEIGHT - 60];
  }

  playerWeapon() { return weaponFor(this.playerWeaponId); }

  enemyWeapon() { return weaponFor(this.enemyWeaponId); }

  weaponForActor(index) { return index === 1 ? this.enemyWeapon() : this.playerWeapon(); }

  windLabel() {
    const v = this.wind;
    if (Math.abs(v) < 0.05) return '无风';
    return v > 0 ? '向右' : '向左';
  }

  metrics() {
    const p = this.actors[0];
    const e = this.actors[1];
    return { x: Math.abs(e.x - p.x) / PIXELS_PER_METRE, y: (p.y - e.y) / PIXELS_PER_METRE };
  }

  canPlayerControl() {
    return this.phase === 'player' && this.actors[0].alive && !this.charging;
  }

  nextWind() {
    return nextWind(this.wind, this.windTarget, this.rng);
  }

  /** Returns '' on success, an error message otherwise (Go wasm bridge shape). */
  command(c) {
    if (!c || typeof c !== 'object') return 'invalid command';
    switch (c.type) {
      case 'restart':
        this.resetLocked();
        return '';
      case 'select_weapon': {
        if (!WEAPON_DEFS[c.weapon]) return 'unknown weapon';
        if (this.phase !== 'player' || this.charging) return '';
        if (this.stats.playerShots > 0 && !this.allowDebug) return 'weapon locked after first shot';
        this.playerWeaponId = c.weapon;
        const def = this.playerWeapon();
        this.angle = def.startAngle;
        this.actors[0].weapon = def.id;
        this.actors[0].aimAngle = this.angle;
        this.emit('weapon-select', {
          weapon: def.id, label: def.label, angleMin: def.angleMin, angleMax: def.angleMax,
        });
        return '';
      }
      case 'move': {
        if (this.phase !== 'player' || this.charging) return '';
        let dir = c.dir | 0;
        if (dir > 1) dir = 1;
        if (dir < -1) dir = -1;
        this.moveDir = dir;
        return '';
      }
      case 'aim_delta': {
        if (this.phase !== 'player' || this.charging) return '';
        const def = this.playerWeapon();
        this.angle = clamp(this.angle + (c.delta || 0), def.angleMin, def.angleMax);
        this.actors[0].aimAngle = this.angle;
        return '';
      }
      case 'aim_absolute': {
        if (this.phase !== 'player' || this.charging) return '';
        const def = this.playerWeapon();
        this.angle = clamp(c.value || 0, def.angleMin, def.angleMax);
        this.actors[0].aimAngle = this.angle;
        return '';
      }
      case 'charge_start': {
        if (!this.canPlayerControl()) return '';
        this.charging = true;
        this.chargeStarted = this.time;
        this.chargeElapsed = 0;
        this.chargeDir = 1;
        this.force = 0;
        this.moveDir = 0;
        this.actors[0].walkDirection = 0;
        this.emit('charge-start', {});
        return '';
      }
      case 'charge_release': {
        if (!this.charging) return '';
        const elapsed = this.time - this.chargeStarted;
        // SOURCE: EnergyView.__enterFrame() fires with the live `this._force`
        // (which includes any rebound drain), not the elapsed-time maximum.
        const force = this.force;
    this.charging = false;
    this.chargeDir = 1;
    this.force = 0;
        this.chargeElapsed = 0;
        this.emit('charge-end', {});
        if (elapsed < MIN_CHARGE_SECONDS || force < MIN_FIRE_FORCE) {
          this.emit('toast', { text: '蓄力不足：按住发射键更久一些' });
          return '';
        }
        fireLocked(this, 0, this.angle, force);
        return '';
      }
      case 'charge_cancel': {
        if (!this.charging) return '';
    this.charging = false;
    this.chargeDir = 1;
    this.force = 0;
        this.chargeElapsed = 0;
        this.emit('charge-cancel', {});
        return '';
      }
      case 'skill': {
        // A skill is a CARD, not a toggle: every press plays one card. Pressing
        // the same slot again does not cancel it — it plays another card of the
        // same kind, spending one more use and another slice of stamina.
        if (this.phase !== 'player' || this.charging) return '';
        const def = SKILL_DEFS[c.skill];
        if (!def || (this.skillUses[c.skill] ?? 0) <= 0) return '';
        const cost = def.staminaCost || 0;
        if (this.stamina < cost) {
          this.emit('toast', { text: `体力不足：${def.label} 需要 ${cost}`, alert: true });
          return '';
        }
        this.skillUses[c.skill] -= 1;
        this.stamina = Math.max(0, this.stamina - cost);
        this.skillPlayed[c.skill] = (this.skillPlayed[c.skill] || 0) + 1;
        if (def.kind === 'boost') {
          this.selectedBuffs.push(c.skill);
        } else {
          this.selectedSkill = c.skill;
          this.attackStacks += 1;
        }
        this.emit('skill-select', {
          skill: this.selectedSkill,
          buffs: this.selectedBuffs.length ? [...this.selectedBuffs] : null,
          stamina: Math.round(this.stamina),
        });
        return '';
      }
      case 'carry': {
        if (this.phase !== 'player' || this.charging || !this.canCarry) return '';
        this.carryArmed = !this.carryArmed;
        this.emit('carry', { armed: this.carryArmed, available: this.canCarry });
        return '';
      }
      case 'pow': {
        if (this.phase !== 'player' || this.charging) return '';
        if (this.allowDebug && c.value >= 100.0) this.energy = 100.0;
        if (this.energy < 100.0 && !this.powSelected) return '';
        this.powSelected = !this.powSelected;
        this.emit('pow-select', { selected: this.powSelected, energy: this.energy });
        return '';
      }
      case 'heal': {
        if (this.allowDebug && c.hp > 0 && c.actor >= 0 && c.actor < this.actors.length) {
          const a = this.actors[c.actor];
          if (c.hp > a.maxHp) a.maxHp = c.hp + HEAL_AMOUNT;
          a.hp = c.hp;
          a.alive = true;
        }
        healLocked(this);
        return '';
      }
      case 'fire': {
        if (!this.allowDebug) return 'fire command is debug-only';
        let actor = c.actor | 0;
        if (actor < 0 || actor > 1) actor = 0;
        if (this.allowDebug && c.windSet) this.wind = clamp(c.wind || 0, -5, 5);
        fireLocked(this, actor, c.angle || 0, c.force || 0);
        return '';
      }
      case 'debug_set_position': {
        if (!this.allowDebug) return 'debug command disabled';
        if (c.dir >= 0 && c.dir < this.actors.length) {
          const a = this.actors[c.dir];
          a.x = clamp(c.x || 0, 70, WORLD_WIDTH - 70);
          const g = this.terrain.findGroundY(Math.trunc(a.x), SPAWN_PROBE_Y, GROUND_BOTTOM);
          if (g.ok) a.y = g.y;
          a.vy = 0;
          a.falling = false;
          a.grounded = true;
          a.slope = this.terrain.slopeAt(a.x, a.y, 22);
        }
        return '';
      }
      case 'debug_set_wind': {
        if (!this.allowDebug) return 'debug command disabled';
        this.wind = clamp(c.value || 0, -4, 4);
        this.windTarget = c.target || 0;
        this.emit('wind', { wind: this.wind, label: this.windLabel() });
        return '';
      }
      case 'debug_set_hp': {
        if (!this.allowDebug) return 'debug command disabled';
        if (c.actor >= 0 && c.actor < this.actors.length) {
          const a = this.actors[c.actor];
          if (c.hp > a.maxHp) a.maxHp = c.hp + HEAL_AMOUNT;
          a.hp = Math.max(1, c.hp | 0);
          a.alive = true;
          if (a.hp <= 0) { a.hp = 0; a.alive = false; }
        }
        return '';
      }
      case 'debug_set_energy': {
        if (!this.allowDebug) return 'debug command disabled';
        this.energy = clamp(c.value || 0, 0, 100.0);
        return '';
      }
      case 'debug_set_stamina': {
        if (!this.allowDebug) return 'debug command disabled';
        this.stamina = clamp(c.value || 0, 0, STAMINA_MAX);
        return '';
      }
      case 'debug_set_countdown': {
        if (!this.allowDebug) return 'debug command disabled';
        this.countdownEnabled = !!c.enabled;
        this.showCountdown = this.countdownEnabled;
        if (c.seconds > 0) this.countdown = c.seconds;
        return '';
      }
      case 'debug_carve': {
        if (!this.allowDebug) return 'debug command disabled';
        const art = c.art || '401';
        const kind = c.kind || 'debug';
        this.terrain.carve(Math.trunc(c.x || 0), Math.trunc(c.y || 0), art, kind);
        this.refreshSupportLocked(this.actors[0]);
        this.refreshSupportLocked(this.actors[1]);
        return '';
      }
      default:
        return `unknown command "${c.type}"`;
    }
  }

  update(dt) {
    const raw = Number.isFinite(dt) ? dt : 0;
    const step = clamp(raw, 0, 0.08);
    this.time += step;

    if (this.charging) {
      // SOURCE: EnergyView.calcForce() — force rises at SHOOT_FORCE_STEP per
      // frame, flips to drain (dir = -1) once it reaches FORCE_MAX, and
      // skipping the turn (`this._self.skip()`) when it drains back to 0
      // while the key is still held.
      this.chargeElapsed = this.time - this.chargeStarted;
      this.force += this.chargeDir * CHARGE_RATE * step;
      if (this.force >= FORCE_MAX) {
        this.force = FORCE_MAX;
        this.chargeDir = -1;
      } else if (this.force <= 0) {
        this.force = 0;
        this.charging = false;
        this.chargeElapsed = 0;
        this.emit('charge-end', {});
        this.emit('toast', { text: '力度回弹到 0：按满未松手，本回合跳过（原版蓄力规则）' });
        beginTurnLocked(this, 1, true);
      }
    }
    this.updateFallingLocked(step);

    switch (this.phase) {
      case 'player': {
        if (this.moveDir !== 0 && !this.charging) this.movePlayerLocked(step);
        else this.actors[0].walkDirection = 0;
        // Stamina no longer tops itself up while standing still: it is restored
        // once per turn (STAMINA_TURN_RESTORE) so skill cards have a real price.
        if (this.showCountdown) this.countdown = Math.max(0, this.countdown - step);
        break;
      }
      case 'enemy_move':
        this.updateEnemyMoveLocked(step);
        break;
      case 'flight':
        updateFlightLocked(this, step);
        break;
      case 'enemy_think': {
        if (this.aiPending) {
          // A worker search is in flight; hold the turn until it lands. The
          // hard deadline keeps the match playable if the worker dies.
          this.aiWait += step;
          if (this.aiWait > 5) this.aiFallbackLocked();
          break;
        }
        this.timer -= step;
        if (this.timer <= 0) {
          this.phase = 'enemy_aim';
          this.timer = ENEMY_AIM_SECONDS;
          this.enemyAimElapsed = 0;
          this.enemyAimFrom = this.enemyAimAngle;
          this.enemyAimTo = this.aiPlan ? this.aiPlan.angle : this.enemyWeapon().startAngle;
          this.emit('enemy-aim', { plan: aiPlanJson(this.aiPlan) });
        }
        break;
      }
      case 'enemy_aim': {
        this.timer -= step;
        this.enemyAimElapsed += step;
        const t = clamp(1 - this.timer / ENEMY_AIM_SECONDS, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        this.enemyAimAngle = this.enemyAimFrom + (this.enemyAimTo - this.enemyAimFrom) * eased;
        this.actors[1].aimAngle = this.enemyAimAngle;
        if (this.timer <= 0) {
          const plan = this.aiPlan || { angle: this.enemyWeapon().startAngle, force: 1200 };
          fireLocked(this, 1, plan.angle, plan.force);
        }
        break;
      }
      case 'resolve': {
        if (this.anyFallingLocked()) {
          this.timer = Math.max(this.timer, 0.25);
        } else {
          this.timer -= step;
          if (this.timer <= 0) finishResolveLocked(this);
        }
        break;
      }
      case 'heal':
        this.timer -= step;
        if (this.timer <= 0) beginTurnLocked(this, 1, true);
        break;
      default:
        break;
    }

    for (const a of this.actors) {
      a.flash = Math.max(0, a.flash - step * 2.2);
      a.fireTimer = Math.max(0, a.fireTimer - step);
      a.hurtTimer = Math.max(0, a.hurtTimer - step);
      a.animTime += step;
      if (a.walkDirection === 0 && !a.falling) {
        a.slope = this.terrain.slopeAt(a.x, a.y, 22);
      }
    }
  }

  anyFallingLocked() {
    return this.actors.some((a) => a.alive && a.falling);
  }

  movePlayerLocked(dt) {
    const a = this.actors[0];
    if (!a.alive || a.falling || this.moveDir === 0) {
      a.walkDirection = 0;
      return;
    }
    if (this.moveActorLocked(0, this.moveDir, MOVE_SPEED * dt)) {
      // Walking is the only drain on stamina. Standing still never regenerates
      // it, so the cost of a reposition is real for the rest of the turn.
      this.stamina = Math.max(0, this.stamina - STAMINA_MOVE_COST * dt);
    }
  }

  moveActorLocked(index, direction, distance) {
    const a = this.actors[index];
    const other = this.actors[1 - index];
    if (!a.alive || a.falling || direction === 0) {
      a.walkDirection = 0;
      return false;
    }
    a.walkAccum += distance;
    let moved = false;
    while (a.walkAccum >= MOVE_STEP_X) {
      if (!this.stepActorLocked(a, other, direction)) {
        a.walkAccum = 0;
        break;
      }
      a.walkAccum -= MOVE_STEP_X;
      moved = true;
    }
    return moved;
  }

  stepActorLocked(a, other, direction) {
    const nextX = clamp(a.x + direction * MOVE_STEP_X, 70, WORLD_WIDTH - 70);
    if (Math.abs(nextX - other.x) < ACTOR_WIDTH * 0.72) {
      a.walkDirection = 0;
      a.facing = direction;
      return false;
    }
    const probeX = Math.trunc(nextX) + (15 + 2) * direction;
    if (probeX < 0 || probeX > this.terrain.width) {
      a.walkDirection = 0;
      return false;
    }
    const walk = this.terrain.findNextWalkPoint(Math.trunc(a.x), Math.trunc(a.y), direction, MOVE_STEP_X, MOVE_STEP_Y);
    if (walk.ok) {
      let y2 = walk.y;
      const g = this.terrain.findGroundY(walk.x, Math.trunc(a.y) - MOVE_STEP_Y - 2, Math.trunc(a.y) + MOVE_STEP_Y + 2);
      if (g.ok) y2 = g.y;
      a.x = walk.x;
      a.y = y2;
      a.vy = 0;
      a.falling = false;
      a.grounded = true;
      a.slope = this.terrain.slopeAt(a.x, a.y, 22);
      a.walkDirection = direction;
      a.facing = direction;
      a.walkTime += MOVE_STEP_X * 0.09;
      return true;
    }
    // SOURCE: SelfPlayerWalkAction.as — when findNextWalkPoint is empty (the
    // step is taller than stepY) the original does not keep walking: canStand
    // at the current foot height decides. A solid shoulder column means a steep
    // slope face blocks the way; only two empty columns mean a cliff to fall
    // off. Skipping this gate walked the actor into the slope body.
    if (this.terrain.isSolid(Math.trunc(nextX) - 1, Math.trunc(a.y)) ||
        this.terrain.isSolid(Math.trunc(nextX) + 1, Math.trunc(a.y))) {
      a.walkDirection = 0;
      a.facing = direction;
      return false;
    }
    // Walking off a ledge is allowed; gravity takes over next tick.
    // SOURCE: findYLineNotEmptyPointDown(x2, y - stepY, height)。
    const g = this.terrain.findGroundY(Math.trunc(nextX), Math.trunc(a.y) - MOVE_STEP_Y, this.terrain.height - 1);
    if (g.ok) {
      a.x = nextX;
      a.facing = direction;
      a.walkTime += MOVE_STEP_X * 0.09;
      this.startFallingLocked(a);
      return true;
    }
    a.walkDirection = 0;
    return false;
  }

  startFallingLocked(a) {
    if (!a || !a.alive) return;
    a.falling = true;
    a.grounded = false;
    a.vy = 0;
    a.walkDirection = 0;
  }

  refreshSupportLocked(a) {
    if (!a || !a.alive || a.falling) return;
    const g = this.terrain.findGroundY(Math.trunc(a.x), Math.trunc(a.y) - 4, this.terrain.height - 1);
    if (!g.ok || g.y > Math.trunc(a.y) + 7) {
      this.startFallingLocked(a);
      return;
    }
    if (g.y < Math.trunc(a.y)) {
      a.y = g.y;
      a.slope = this.terrain.slopeAt(a.x, a.y, 22);
    }
    a.grounded = true;
  }

  updateFallingLocked(dt) {
    for (const a of this.actors) {
      if (!a.alive || !a.falling) continue;
      const prevY = a.y;
      a.vy = Math.min(FALL_MAX_SPEED, a.vy + FALL_GRAVITY * dt);
      const nextY = a.y + a.vy * dt;
      const toY = Math.trunc(Math.max(prevY + 1, nextY + 2));
      const g = this.terrain.findGroundY(Math.trunc(a.x), Math.trunc(prevY) + 1, toY);
      if (g.ok) {
        a.y = g.y;
        a.vy = 0;
        a.falling = false;
        a.grounded = true;
        a.slope = this.terrain.slopeAt(a.x, a.y, 22);
        this.emit('land', { actor: a.index, x: a.x, y: a.y });
        this.emit('sound', { name: 'land' });
        continue;
      }
      a.y = nextY;
      a.slope = 0;
      if (a.y > WORLD_HEIGHT + 70) this.fallOutLocked(a);
    }
  }

  fallOutLocked(a) {
    if (!a.alive) return;
    a.alive = false;
    a.hp = 0;
    a.falling = false;
    a.vy = 0;
    this.pendingWinner = 1 - a.index;
    this.emit('sound', { name: 'out' });
    if (this.phase !== 'flight' && this.phase !== 'resolve' && this.phase !== 'over') {
      this.phase = 'resolve';
      this.timer = RESOLVE_DELAY;
    }
  }

  updateEnemyMoveLocked(dt) {
    const e = this.actors[1];
    const targetX = this.aiMoveTarget;
    let dir = 0;
    if (targetX > e.x) dir = 1;
    else if (targetX < e.x) dir = -1;
    if (dir !== 0 && Math.abs(targetX - e.x) > 3 && this.timer > 0) {
      this.moveActorLocked(1, dir, ENEMY_MOVE_SPEED * dt);
    } else {
      e.walkDirection = 0;
    }
    this.timer -= dt;
    if (this.timer <= 0) this.endEnemyMoveLocked();
  }

  endEnemyMoveLocked() {
    const e = this.actors[1];
    e.walkDirection = 0;
    e.facing = -1;
    if (e.x < this.actors[0].x) e.facing = 1;
    e.slope = this.terrain.slopeAt(e.x, e.y, 22);
    this.aiMoveTarget = 0;
    if (this.aiSolver) {
      const target = this.actors[0];
      const weapon = this.enemyWeapon();
      const token = (this.aiToken = (this.aiToken || 0) + 1);
      this.aiPending = true;
      this.aiWait = 0;
      this.aiPlan = null;
      try {
        this.aiSolver({
          shooter: { x: e.x, y: e.y, slope: e.slope, alive: e.alive },
          target: { x: target.x, y: target.y, alive: target.alive },
          wind: this.wind,
          startAngle: weapon.startAngle,
          angleMin: weapon.angleMin,
          angleMax: weapon.angleMax,
          maxSeconds: 14.0,
          forceMax: FORCE_MAX,
          craters: this.terrain.craters.length,
        }, (best) => this.applyAISearchLocked(token, best));
      } catch (error) {
        console.warn('AI solver hook failed, using synchronous search', error);
        this.aiPending = false;
        this.aiPlan = chooseShotForWeapon(
          e, target, this.wind, this.terrain, this.rng, weapon, 14.0, FORCE_MAX,
        );
      }
    } else {
      this.aiPlan = chooseShotForWeapon(
        e, this.actors[0], this.wind, this.terrain, this.rng, this.enemyWeapon(),
        14.0, FORCE_MAX,
      );
    }
    this.enemyAimFrom = this.enemyAimAngle;
    this.enemyAimTo = this.aiPlan ? this.aiPlan.angle : this.enemyWeapon().startAngle;
    this.phase = 'enemy_think';
    this.timer = ENEMY_THINK_SECONDS;
    this.emit('toast', { text: '电脑正在测算风向与弹道…' });
  }

  /**
   * Accept a worker search result. The aim error (triangular noise) is applied
   * here, on the match's own RNG, so the random stream is identical to the
   * synchronous search — the worker only decides the solved angle/force.
   */
  applyAISearchLocked(token, best) {
    if (!this.aiPending || token !== this.aiToken) return;
    if (!best || !Number.isFinite(best.angle) || !Number.isFinite(best.force)) {
      this.aiFallbackLocked();
      return;
    }
    const weapon = this.enemyWeapon();
    let angle = best.angle + triangularNoise(this.rng) * 1.6;
    let force = best.force + triangularNoise(this.rng) * 28;
    angle = clamp(angle, weapon.angleMin, weapon.angleMax);
    force = clamp(force, 420, FORCE_MAX);
    this.aiPlan = {
      angle, force,
      direction: best.direction,
      expected: best.expected ?? null,
      solvedAngle: best.solvedAngle,
      solvedForce: best.solvedForce,
    };
    this.enemyAimTo = angle;
    this.aiPending = false;
  }

  aiFallbackLocked() {
    const weapon = this.enemyWeapon();
    this.aiPlan = { angle: weapon.startAngle, force: 1200 };
    this.enemyAimTo = this.aiPlan.angle;
    this.aiPending = false;
  }

  chooseEnemyMoveTargetLocked() {
    const e = this.actors[1];
    const p = this.actors[0];
    const sign = p.x > e.x ? 1 : -1;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const toward = this.rng.float64() < 0.65;
      const distance = 50 + this.rng.float64() * 220;
      let candidate = clamp(e.x + sign * distance, 110, WORLD_WIDTH - 110);
      if (!toward) candidate = clamp(e.x - sign * distance, 110, WORLD_WIDTH - 110);
      const g = this.terrain.findGroundY(Math.trunc(candidate), Math.trunc(e.y) - 36, Math.trunc(e.y) + 36);
      if (g.ok) return candidate;
    }
    return e.x;
  }

  emit(type, data) {
    this.seq += 1;
    this.eventLog.push({ seq: this.seq, type, data });
    if (this.eventLog.length > 512) this.eventLog = this.eventLog.slice(this.eventLog.length - 512);
  }

  eventsSince(seq) {
    return this.eventLog.filter((ev) => ev.seq > seq);
  }

  snapshot() {
    return buildSnapshot(this);
  }
}

function emptyStats() {
  return {
    playerShots: 0, playerHits: 0, enemyShots: 0, enemyHits: 0,
    playerDamageDealt: 0, playerDamageTaken: 0, playerHeals: 0, playerHealed: 0,
  };
}
