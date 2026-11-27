/**
 * Browser client for the authoritative Go battle server.
 *
 * The page no longer owns `Match` simulation. It renders the latest server
 * snapshot and sends intent commands over HTTP; server events arrive through
 * SSE. Local physics remains only for the non-firing aim recommendation.
 */
import { WORLD, PHYSICS, CONTROLS, BATTLE } from './config.js?v=29';
import { solveForceForAngle } from './ai.js?v=29';
import { muzzlePoint } from './physics.js?v=29';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const FIRE_ANIM_SECONDS = 0.28;
const HURT_ANIM_SECONDS = 0.5;
const SHOT_EXTRAPOLATE_MAX = 0.06;
const ACTOR_SMOOTH_TAU = 22;

function emptyEffects() {
  return { particles: [], floats: [], muzzle: [], heal: [], shake: 0, flash: 0 };
}

function signTo(fromX, toX) {
  return Math.sign(toX - fromX) || 1;
}

export class RemoteMatch {
  constructor({ terrain, onEvent = () => {}, lowPower = false } = {}) {
    this.terrain = terrain;
    this.onEvent = onEvent;
    this.lowPower = lowPower;

    this.phase = 'loading';
    this.turn = 0;
    this.round = 1;
    this.actors = [];
    this.player = null;
    this.enemy = null;
    this.wind = { value: 0, target: 0, label: '无风' };
    this.angle = CONTROLS.startAngle;
    this.angleMin = CONTROLS.angleMin;
    this.angleMax = CONTROLS.angleMax;
    this.weapon = null;
    this.enemyWeapon = null;
    this.weapons = [];
    // Locally chosen weapon awaiting server confirmation. A snapshot captured
    // before the select_weapon command was processed must not revert the HUD
    // back to the previous (default "fruit") weapon. Cleared once a snapshot
    // reports the chosen weapon or after a short timeout.
    this._pendingWeapon = null;
    this._pendingWeaponUntil = 0;
    this.force = 0;
    this.charging = false;
    this.chargeElapsed = 0;
    this.lastImpact = null;
    this.lastPlayerSummary = '—';
    this.lastPower = null;
    this.winner = null;
    this.shots = [];
    this.shot = null;
    this.selectedSkill = null;
    this.selectedBuffs = [];
    this.skillUses = {};
    this.powSelected = false;
    // SOURCE: FlyCommand / UseFlySkill — carry (fly/teleport) ball state.
    this.carryArmed = false;
    this.canCarry = true;
    this.energy = 0;
    this.stamina = BATTLE.staminaMax;
    this.healsRemaining = BATTLE.healsPerRound;
    this.countdown = BATTLE.countdownSeconds;
    this.showCountdown = false;
    this.stats = {};
    this.time = 0;
    this.visualTime = 0;
    this.actorAnim = [
      { fireAt: -Infinity, hurtAt: -Infinity },
      { fireAt: -Infinity, hurtAt: -Infinity },
    ];
    this.effects = emptyEffects();
    this.playerVolley = null;
    this.recommendationCache = null;
    this._recommendationPendingKey = null;

    this.connected = false;
    this.connectionError = '';
    this._chargeStartedAt = 0;
    this._releaseAt = 0;
    this._localCharging = false;
    this._pendingAngle = null;
    this._lastAngleSent = 0;
    this._angleDirtyUntil = 0;
    this._lastMoveDir = 0;
    this._lastMoveSent = 0;
    this._appliedCraters = 0;
    this._freshReset = false;
    this._resetEventSeen = false;
    this._windOverride = null;
    this._energyOverride = null;
    this._hpOverride = null;
    this._readyResolve = null;
    this._readyReject = null;
    this._readyPromise = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });
    this._readyTimer = window.setTimeout(() => {
      if (this.phase === 'loading') {
        this._readyReject?.(new Error('连接战斗引擎超时：本地请确认 npm start；静态站请检查 standalone-api.js 与 data/*.fore.map 是否可访问'));
      }
    }, 30000);

    this._source = null;
    this._connect();
  }

  ready() {
    return this._readyPromise;
  }

  _connect() {
    if (typeof EventSource === 'undefined' || location.protocol === 'file:') {
      this.connectionError = '请通过 Go 服务端（HTTP）打开页面，而不是 file://';
      this._readyReject?.(new Error(this.connectionError));
      return;
    }
    this._source = new EventSource('/api/events');
    this._source.addEventListener('open', () => {
      this.connected = true;
      this.connectionError = '';
    });
    this._source.addEventListener('state', (event) => {
      try {
        this._applyState(JSON.parse(event.data));
      } catch (error) {
        console.error('bad server state', error);
      }
    });
    this._source.addEventListener('game', (event) => {
      try {
        this._applyGameEvent(JSON.parse(event.data));
      } catch (error) {
        console.error('bad server event', error);
      }
    });
    this._source.addEventListener('error', () => {
      this.connected = false;
      this.connectionError = '战斗引擎连接中断，正在重连…';
      if (this.phase === 'loading') {
        this._readyReject?.(new Error('无法连接战斗引擎：本地请先运行 npm start'));
      }
    });
  }

  _applyState(ev) {
    const s = ev?.data;
    if (!s || !Array.isArray(s.actors) || s.actors.length < 2) return;
    const now = performance.now();
    this.phase = s.phase;
    this.turn = s.turn;
    this.round = s.round;
    const nowMs = performance.now();
    if (this._windOverride && nowMs < this._windOverride.until) {
      this.wind = { value: this._windOverride.value, target: this._windOverride.target, label: this.windLabel() };
      if (s.wind === this._windOverride.value && s.windTarget === this._windOverride.target) this._windOverride = null;
    } else {
      this._windOverride = null;
      this.wind = { value: s.wind, target: s.windTarget, label: s.windLabel || this.windLabel() };
    }
    const prevActors = this.actors;
    this.actors = s.actors;
    this.player = s.actors[0];
    this.enemy = s.actors[1];
    for (let i = 0; i < this.actors.length; i += 1) {
      const actor = this.actors[i];
      const prev = prevActors[i];
      actor.renderX = prev?.renderX ?? actor.x;
      actor.renderY = prev?.renderY ?? actor.y;
      actor.walkPhase = prev?.walkPhase ?? 0;
    }
    if (this._hpOverride && nowMs < this._hpOverride.until) {
      const a = this.actors[this._hpOverride.index];
      if (a) {
        a.maxHp = Math.max(a.maxHp, this._hpOverride.hp + BATTLE.healAmount);
        a.hp = this._hpOverride.hp;
        a.alive = true;
      }
      if (s.actors[this._hpOverride.index]?.hp >= this._hpOverride.hp) this._hpOverride = null;
    } else {
      this._hpOverride = null;
    }
    this.shots = Array.isArray(s.shots) ? s.shots : [];
    for (const shot of this.shots) shot.stateAt = nowMs;
    const tracked = s.shot
      ? this.shots.find((shot) => shot.slot === s.shot.slot && shot.volleyId === s.shot.volleyId)
      : null;
    this.shot = tracked || s.shot || null;
    if (this.shot && !Number.isFinite(this.shot.stateAt)) this.shot.stateAt = nowMs;
    this._syncShotVisuals(nowMs);
    this._syncActorAnimations(nowMs);
    this.lastImpact = s.lastImpact || null;
    this.lastPlayerSummary = s.lastPlayerSummary || '—';
    this.lastPower = s.lastPower ?? null;
    this.winner = s.winner ?? null;
    this.selectedSkill = s.selectedSkill || null;
    this.selectedBuffs = Array.isArray(s.selectedBuffs) ? s.selectedBuffs : [];
    this.skillUses = s.skillUses || {};
    this.skillPlayed = s.skillPlayed || {};
    this.attackStacks = s.attackStacks || 0;
    // Keep a just-selected weapon stable against in-flight stale snapshots.
    if (this._pendingWeapon && nowMs < this._pendingWeaponUntil && s.weapon !== this._pendingWeapon) {
      // ignore the stale weapon from this snapshot
    } else {
      if (this._pendingWeapon && s.weapon === this._pendingWeapon) {
        this._pendingWeapon = null;
      }
      this.weapon = s.weapon || this.weapon;
    }
    this.enemyWeapon = s.enemyWeapon || this.enemyWeapon;
    this.weapons = Array.isArray(s.weapons) ? s.weapons : this.weapons;
    if (Number.isFinite(s.angleMin)) this.angleMin = s.angleMin;
    if (Number.isFinite(s.angleMax)) this.angleMax = s.angleMax;
    this.powSelected = !!s.powSelected;
    this.carryArmed = !!s.carryArmed;
    this.canCarry = s.canCarry !== false;
    if (this._energyOverride && nowMs < this._energyOverride.until) {
      this.energy = this._energyOverride.value;
      if (s.energy >= this._energyOverride.value) this._energyOverride = null;
    } else {
      this._energyOverride = null;
      this.energy = s.energy || 0;
    }
    // Stamina is a real resource now (skills spend it); mirror the engine value.
    this.stamina = Number.isFinite(s.stamina) ? s.stamina : BATTLE.staminaMax;
    this.healsRemaining = s.healsRemaining ?? 0;
    this.countdown = s.countdown ?? 0;
    this.showCountdown = !!s.showCountdown;
    this.stats = s.stats || {};
    this.time = s.time || 0;

    if (this._localCharging) {
      this.charging = true;
      this.chargeElapsed = Math.max(0, (now - this._chargeStartedAt) / 1000);
      this.force = this.forceForElapsed(this.chargeElapsed);
    } else if (now < this._releaseAt + 350) {
      this.charging = false;
      this.force = 0;
      this.chargeElapsed = 0;
    } else {
      this.charging = !!s.charging;
      this.force = s.force || 0;
      this.chargeElapsed = s.chargeElapsed || 0;
      if (s.charging) {
        this._chargeStartedAt = now - this.chargeElapsed * 1000;
      }
    }
    if (now >= this._angleDirtyUntil) {
      this.angle = s.angle;
    }
    this._syncCraters(s.craters || []);

    if (this.phase !== 'loading') {
      const wantsFresh = new URLSearchParams(location.search).has('fresh');
      if (wantsFresh && !this._freshReset) {
        this._freshReset = true;
        this._post({ type: 'restart' });
        return;
      }
      if (this._freshReset && !this._resetEventSeen) return;
      window.clearTimeout(this._readyTimer);
      this._readyResolve?.();
      this._readyResolve = null;
    }
  }

  _syncCraters(craters) {
    if (!this.terrain) return;
    if (craters.length < this._appliedCraters) {
      this.terrain.reset();
      this._appliedCraters = 0;
      this.recommendationCache = null;
    }
    for (let i = this._appliedCraters; i < craters.length; i += 1) {
      const c = craters[i];
      const result = this.terrain.carveSource(c.x, c.y, c.art, c.kind || 'medium');
      this.lastCraterRemoved = result?.removed ?? 0;
    }
    if (craters.length !== this._appliedCraters) this.recommendationCache = null;
    this._appliedCraters = craters.length;
  }

  _applyGameEvent(ev) {
    const type = ev?.type;
    const data = ev?.data || {};
    if (type === 'state') return;
    if (type === 'reset') {
      this._resetEventSeen = true;
      this.terrain?.reset();
      this._appliedCraters = 0;
      this.playerVolley = null;
      this.effects = emptyEffects();
      this.recommendationCache = null;
      this._localCharging = false;
      this.charging = false;
      this.force = 0;
      this.actorAnim = [
        { fireAt: -Infinity, hurtAt: -Infinity },
        { fireAt: -Infinity, hurtAt: -Infinity },
      ];
      this.angle = this.weapons.find((w) => w.id === this.weapon)?.startAngle ?? CONTROLS.startAngle;
      this.onEvent('reset', data);
      return;
    }
    if (type === 'fire') {
      this._markFire(data.actor);
      this._spawnMuzzle(data);
      if (data.actor === 0 && !data.followup) {
        this.playerVolley = {
          from: { x: data.x, y: data.y },
          impacts: [],
          skill: data.skill || null,
          weapon: data.weapon || this.weapon,
          pow: !!data.pow,
          force: data.force,
          angle: data.angle,
          shells: data.shells,
        };
      }
      this.onEvent('fire', {
        owner: data.actor,
        shells: data.shells,
        shell: data.shell || 0,
        followup: !!data.followup,
        skill: data.skill,
        weapon: data.weapon,
        pow: data.pow,
        force: data.force,
        angle: data.angle,
      });
      return;
    }
    if (type === 'impact') {
      if (data.damage > 0 || data.critical > 0) this._markHurt(1 - data.owner);
      this._spawnImpact(data);
      if (data.owner === 0 && this.playerVolley) {
        this.playerVolley.impacts.push({ x: data.x, y: data.y, type: data.type, damage: data.damage || 0, critical: data.critical || 0 });
        if (this.playerVolley.impacts.length > 8) this.playerVolley.impacts.shift();
      }
      this.onEvent('impact', data);
      return;
    }
    if (type === 'heal') {
      const p = this.player;
      if (p) this.effects.heal.push({ x: p.x, y: p.y - 20, life: 0.9, maxLife: 0.9 });
      this.effects.floats.push({
        x: p?.x ?? 0, y: (p?.y ?? 0) - 80, text: `+${data.amount}`,
        color: '#7dffab', life: 1.2, maxLife: 1.2,
      });
      this.onEvent('heal', { ...data, maxHp: data.maxHp ?? p?.maxHp });
      return;
    }
    if (type === 'turn') {
      this.onEvent('turn', data);
      return;
    }
    if (type === 'gameover') {
      this.onEvent('gameover', { ...data, stats: { ...this.stats }, round: this.round });
      return;
    }
    if (type === 'toast' || type === 'sound' || type === 'skill-select' || type === 'weapon-select' || type === 'pow-select'
      || type === 'volley-resolve' || type === 'wind' || type === 'carry' || type === 'translate') {
      this.onEvent(type, data);
    }
  }

  _spawnMuzzle(data) {
    const actor = this.actors[data.actor];
    if (!actor) return;
    const direction = signTo(actor.x, this.actors[1 - data.actor]?.x ?? actor.x);
    const muzzle = muzzlePoint(actor, data.angle, direction);
    this.effects.muzzle.push({
      x: muzzle.x, y: muzzle.y, angle: data.angle, direction, life: 0.2, maxLife: 0.2,
    });
    this.effects.shake = Math.max(this.effects.shake, 3);
  }

  _spawnImpact(data) {
    const count = this.lowPower ? 12 : 26;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 35 + Math.random() * 190;
      const smoke = i % 3 === 0;
      this.effects.particles.push({
        x: data.x + (Math.random() - 0.5) * 18,
        y: data.y + (Math.random() - 0.5) * 12,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        size: smoke ? 10 + Math.random() * 18 : 2 + Math.random() * 5,
        color: smoke ? 'rgba(91, 74, 58, 0.75)' : (i % 2 ? '#7a5a3d' : '#c49a6c'),
        shape: smoke ? 'smoke' : (i % 2 ? 'rock' : 'dirt'),
        smoke,
        life: 0.5 + Math.random() * 0.75,
        maxLife: 0.5 + Math.random() * 0.75,
      });
    }
    // SOURCE: SimpleBomb.BombImp -> Living.TakeDamage(source, ref damage,
    // ref critical, "Fire"). The victim loses damage + critical and the
    // original client draws the critical as a second, larger number.
    const total = (data.damage || 0) + (data.critical || 0);
    if (total > 0) {
      this.effects.floats.push({
        x: data.x, y: data.y - 42, text: `-${total}`,
        color: '#ffd36a', life: 1.15, maxLife: 1.15,
      });
      if (data.critical > 0) {
        this.effects.floats.push({
          x: data.x, y: data.y - 86, text: `暴击 -${data.critical}`,
          color: '#ff6b4a', life: 1.35, maxLife: 1.35, size: 30, weight: 900,
        });
      }
      this.effects.shake = Math.min(22, 7 + total / 35);
    } else if (data.type !== 'out') {
      this.effects.floats.push({
        x: data.x, y: data.y - 34, text: 'MISS', color: '#ffb38b', life: 0.9, maxLife: 0.9,
      });
    }
    this.effects.flash = Math.min(0.7, 0.28 + total / 1200);
  }

  _markFire(index) {
    if (!Number.isInteger(index) || index < 0 || index > 1) return;
    this.actorAnim[index].fireAt = performance.now();
    const actor = this.actors[index];
    if (actor) actor.fireTimer = FIRE_ANIM_SECONDS;
  }

  _markHurt(index) {
    if (!Number.isInteger(index) || index < 0 || index > 1) return;
    this.actorAnim[index].hurtAt = performance.now();
    const actor = this.actors[index];
    if (actor) actor.hurtTimer = HURT_ANIM_SECONDS;
  }

  _syncShotVisuals(nowMs) {
    for (const shot of this.shots) {
      if (!Number.isFinite(shot.stateAt)) shot.stateAt = nowMs;
      const age = clamp((nowMs - shot.stateAt) / 1000, 0, SHOT_EXTRAPOLATE_MAX);
      shot.renderX = shot.x + (shot.vx || 0) * age + 0.5 * (shot.ax || 0) * age * age;
      shot.renderY = shot.y + (shot.vy || 0) * age + 0.5 * (shot.ay || 0) * age * age;
    }
    if (this.shot && !this.shots.includes(this.shot)) {
      if (!Number.isFinite(this.shot.stateAt)) this.shot.stateAt = nowMs;
      const age = clamp((nowMs - this.shot.stateAt) / 1000, 0, SHOT_EXTRAPOLATE_MAX);
      this.shot.renderX = this.shot.x + (this.shot.vx || 0) * age + 0.5 * (this.shot.ax || 0) * age * age;
      this.shot.renderY = this.shot.y + (this.shot.vy || 0) * age + 0.5 * (this.shot.ay || 0) * age * age;
    }
  }

  _syncActorAnimations(nowMs) {
    for (let i = 0; i < this.actors.length; i += 1) {
      const actor = this.actors[i];
      const anim = this.actorAnim[i];
      if (!actor || !anim) continue;
      const fireLeft = FIRE_ANIM_SECONDS - (nowMs - anim.fireAt) / 1000;
      if (fireLeft > 0) actor.fireTimer = fireLeft;
      const hurtLeft = HURT_ANIM_SECONDS - (nowMs - anim.hurtAt) / 1000;
      if (hurtLeft > 0) actor.hurtTimer = hurtLeft;
    }
  }

  update(dt) {
    const now = performance.now();
    this.visualTime += dt;

    const smooth = 1 - Math.exp(-ACTOR_SMOOTH_TAU * dt);
    for (const actor of this.actors) {
      if (!Number.isFinite(actor.renderX)) actor.renderX = actor.x;
      if (!Number.isFinite(actor.renderY)) actor.renderY = actor.y;
      const jump = Math.hypot(actor.x - actor.renderX, actor.y - actor.renderY);
      if (jump > 140) {
        actor.renderX = actor.x;
        actor.renderY = actor.y;
      } else {
        actor.renderX += (actor.x - actor.renderX) * smooth;
        // Vertical smoothing is disabled while airborne: the character must
        // land exactly on the authoritative terrain, not sink into it.
        actor.renderY = actor.falling || actor.grounded === false
          ? actor.y
          : actor.renderY + (actor.y - actor.renderY) * smooth;
      }
      actor.walkPhase = (actor.walkPhase || 0) + (actor.walkDirection ? dt * 7.2 : 0);
    }
    this._syncActorAnimations(now);

    this._syncShotVisuals(now);

    if (this._localCharging) {
      this.chargeElapsed = Math.max(0, (now - this._chargeStartedAt) / 1000);
      this.force = this.forceForElapsed(this.chargeElapsed);
    }
    if (this._pendingAngle != null && now - this._lastAngleSent >= 34) {
      this._post({ type: 'aim_absolute', value: this._pendingAngle });
      this._lastAngleSent = now;
      this._pendingAngle = null;
    }
    const e = this.effects;
    for (const p of e.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 620 * dt;
      p.vx *= 0.985;
    }
    e.particles = e.particles.filter((p) => p.life > 0);
    for (const f of e.floats) { f.life -= dt; f.y -= 26 * dt; }
    e.floats = e.floats.filter((f) => f.life > 0);
    for (const m of e.muzzle) m.life -= dt;
    e.muzzle = e.muzzle.filter((m) => m.life > 0);
    for (const h of e.heal) h.life -= dt;
    e.heal = e.heal.filter((h) => h.life > 0);
    e.shake *= Math.exp(-5.5 * dt);
    e.flash = Math.max(0, e.flash - dt * 1.8);
  }

  forceForElapsed(elapsedSeconds) {
    return clamp(elapsedSeconds * PHYSICS.chargeRate, 0, PHYSICS.forceMax);
  }

  _post(body) {
    return fetch('/api/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (response) => {
      if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
      return response.json().catch(() => ({}));
    }).catch((error) => {
      console.warn('server command failed', body.type, error);
      return null;
    });
  }

  movePlayer(direction, dt) {
    const dir = Math.sign(direction) || 0;
    const now = performance.now();
    if (dir === this._lastMoveDir && now - this._lastMoveSent < 500) return;
    this._lastMoveDir = dir;
    this._lastMoveSent = now;
    if (dir) this._post({ type: 'move', dir });
  }

  stopMoving() {
    if (this._lastMoveDir === 0) return;
    this._lastMoveDir = 0;
    this._lastMoveSent = performance.now();
    this._post({ type: 'move', dir: 0 });
  }

  setAngle(delta) {
    if (this.phase !== 'player' || this.charging) return;
    this.angle = clamp(this.angle + delta, this.angleMin, this.angleMax);
    this._pendingAngle = this.angle;
    this._angleDirtyUntil = performance.now() + 320;
  }

  setAngleAbsolute(value) {
    if (this.phase !== 'player' || this.charging) return false;
    this.angle = clamp(value, this.angleMin, this.angleMax);
    this._pendingAngle = this.angle;
    this._angleDirtyUntil = performance.now() + 320;
    return true;
  }

  startCharge() {
    if (this.phase !== 'player' || this.charging || !this.player?.alive) return false;
    if (this._pendingAngle != null) {
      this._post({ type: 'aim_absolute', value: this._pendingAngle });
      this._lastAngleSent = performance.now();
      this._pendingAngle = null;
    }
    this._localCharging = true;
    this.charging = true;
    this._chargeStartedAt = performance.now();
    this.chargeElapsed = 0;
    this.force = 0;
    this._post({ type: 'charge_start' });
    return true;
  }

  releaseCharge() {
    if (!this.charging) return false;
    const elapsed = Math.max(0, (performance.now() - this._chargeStartedAt) / 1000);
    this._localCharging = false;
    this.charging = false;
    this._releaseAt = performance.now();
    this.chargeElapsed = 0;
    this.force = 0;
    this._post({ type: 'charge_release', value: elapsed });
    return true;
  }

  cancelCharge() {
    if (!this.charging) return false;
    this._localCharging = false;
    this.charging = false;
    this.chargeElapsed = 0;
    this.force = 0;
    this._post({ type: 'charge_cancel' });
    return true;
  }

  // A skill is a CARD: every call plays one card and spends one use plus its
  // stamina cost. Calling the same slot again plays another card instead of
  // cancelling (the old toggle behaviour).
  toggleSkill(id) {
    if (this.phase !== 'player' || this.charging) return false;
    const uses = this.skillUses?.[id] ?? 0;
    if (uses <= 0) return false;
    const def = BATTLE.skillDefs[id];
    const cost = def?.staminaCost || 0;
    if (Number.isFinite(this.stamina) && this.stamina < cost) return false;
    // Optimistic local update; the authoritative snapshot echoes the same maths.
    this.skillUses[id] = uses - 1;
    if (Number.isFinite(this.stamina)) this.stamina = Math.max(0, this.stamina - cost);
    this.skillPlayed = { ...(this.skillPlayed || {}) };
    this.skillPlayed[id] = (this.skillPlayed[id] || 0) + 1;
    if (def?.kind === 'boost') {
      this.selectedBuffs = [...this.selectedBuffs, id];
    } else {
      this.selectedSkill = id;
      this.attackStacks = (this.attackStacks || 0) + 1;
    }
    this._post({ type: 'skill', skill: id });
    return true;
  }

  selectWeapon(id) {
    if (this.phase !== 'player' || this.charging) return false;
    if ((this.stats?.playerShots ?? 0) > 0) return false;
    const def = this.weapons.find((w) => w.id === id);
    if (!def) return false;
    this.weapon = id;
    // Hold this choice against stale snapshots until the server echoes it.
    this._pendingWeapon = id;
    this._pendingWeaponUntil = performance.now() + 1500;
    this.angleMin = def.angleMin;
    this.angleMax = def.angleMax;
    this.angle = def.startAngle;
    this._post({ type: 'select_weapon', weapon: id });
    return true;
  }

  togglePow() {
    if (this.phase !== 'player' || this.charging) return false;
    if (this.energy < BATTLE.energyMax && !this.powSelected) return false;
    this.powSelected = !this.powSelected;
    this._post({ type: 'pow', value: this.energy });
    return true;
  }

  // SOURCE: FlyCommand.cs (cmd 40) / Player.UseFlySkill() -> SetBall(3).
  // Arms the next shot as a zero-damage teleport ball; once per own turn.
  toggleCarry() {
    if (this.phase !== 'player' || this.charging || !this.canCarry) return false;
    this.carryArmed = !this.carryArmed;
    this._post({ type: 'carry' });
    return true;
  }

  // SOURCE: ActionType.TRANSLATE -> Living.transmit() + TransmissionGate
  // ("asset.game.transmitted"). A short ring of pale-blue sparks marks the
  // spot the owner was teleported to by the carry ball.
  spawnTranslateEffect(x, y) {
    for (let i = 0; i < 22; i += 1) {
      const angle = (i / 22) * Math.PI * 2;
      this.effects.particles.push({
        x, y: y - 32,
        vx: Math.cos(angle) * (60 + Math.random() * 40),
        vy: Math.sin(angle) * (60 + Math.random() * 40) - 30,
        size: 2 + Math.random() * 4,
        color: i % 2 ? '#bff0ff' : '#6fd0f5',
        shape: 'dirt', smoke: false,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.9,
      });
    }
    this.effects.flash = Math.max(this.effects.flash, 0.22);
  }

  canHeal() {
    return this.phase === 'player' && !this.charging && !!this.player?.alive
      && this.healsRemaining > 0 && this.player.hp < this.player.maxHp;
  }

  healPlayer() {
    if (!this.canHeal()) return false;
    this._post({ type: 'heal', actor: 0, hp: this.player.hp });
    return true;
  }

  async fire(actor = 0, angle = this.angle, force = this.force) {
    if (actor === 0 && this.phase !== 'player') return false;
    const ok = await this._post({ type: 'fire', actor, angle, force, wind: this.wind.value, windSet: true });
    if (!ok) return false;
    const deadline = performance.now() + 900;
    while (performance.now() < deadline && this.phase === 'player') {
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return true;
  }

  setWind(value, target = Math.round(value * 10)) {
    this.wind = { value, target, label: value > 0 ? '向右' : value < 0 ? '向左' : '无风' };
    this._windOverride = { value, target, until: performance.now() + 1200 };
    this.recommendationCache = null;
    this._post({ type: 'debug_set_wind', value, target });
  }

  setHp(index, hp) {
    const actor = this.actors[index];
    if (actor) {
      actor.maxHp = Math.max(actor.maxHp, hp + BATTLE.healAmount);
      actor.hp = Math.max(1, hp);
      actor.alive = true;
    }
    this._hpOverride = { index, hp, until: performance.now() + 1200 };
    this._post({ type: 'debug_set_hp', actor: index, hp });
  }

  setEnergy(value) {
    this.energy = clamp(value, 0, BATTLE.energyMax);
    this._energyOverride = { value: this.energy, until: performance.now() + 1200 };
    this._post({ type: 'debug_set_energy', value });
  }

  setStamina(value) {
    this.stamina = clamp(value, 0, BATTLE.staminaMax);
    this._post({ type: 'debug_set_stamina', value });
  }

  setCountdown(enabled, seconds = BATTLE.countdownSeconds) {
    this.showCountdown = !!enabled;
    this.countdown = seconds;
    this._post({ type: 'debug_set_countdown', enabled: !!enabled, seconds });
  }

  setPosition(actorIndex, x) {
    const actor = this.actors[actorIndex];
    const safeX = clamp(x, 70, WORLD.width - 70);
    const ground = this.terrain?.findGroundY(safeX, WORLD.spawnProbeY, WORLD.groundBottom);
    if (actor && ground != null) {
      actor.x = safeX;
      actor.y = ground;
      actor.vy = 0;
      actor.falling = false;
      actor.grounded = true;
    }
    this._post({ type: 'debug_set_position', dir: actorIndex, x: safeX });
  }

  carveAt(x, y, kind = 'medium') {
    const art = kind === 'large' ? '4' : kind === 'small' ? '50' : '401';
    this.terrain?.carveSource(x, y, art, kind);
    this._appliedCraters = this.terrain?.craters?.length ?? this._appliedCraters;
    this._post({ type: 'debug_carve', x, y, art, kind });
    return { x, y, art, kind };
  }

  reset() {
    this.terrain?.reset();
    this._appliedCraters = 0;
    this.playerVolley = null;
    this.effects = emptyEffects();
    this.recommendationCache = null;
    this._localCharging = false;
    this.charging = false;
    this.force = 0;
    this.angle = this.weapons.find((w) => w.id === this.weapon)?.startAngle ?? CONTROLS.startAngle;
    this._post({ type: 'restart' });
  }

  metrics() {
    if (!this.player || !this.enemy) return { horizontal: 0, elevation: 0 };
    return {
      horizontal: Math.abs(this.enemy.x - this.player.x) / WORLD.pixelsPerMetre,
      elevation: (this.player.y - this.enemy.y) / WORLD.pixelsPerMetre,
    };
  }

  windLabel() {
    const v = this.wind?.value ?? 0;
    if (Math.abs(v) < 0.05) return '无风';
    return v > 0 ? '向右' : '向左';
  }

  recommendationKey() {
    const powActive = this.powSelected && this.energy >= BATTLE.energyMax;
    return [this.angle.toFixed(2), this.wind.value.toFixed(2),
      this.player?.x.toFixed(1), this.player?.y.toFixed(1),
      this.enemy?.x.toFixed(1), this.enemy?.y.toFixed(1),
      this.terrain?.craters?.length ?? 0, this.selectedSkill || '-',
      this.selectedBuffs.join(',') || '-', this.weapon || '-',
      powActive ? 'pow' : '-'].join('|');
  }

  recommendationRequest() {
    const powActive = this.powSelected && this.energy >= BATTLE.energyMax;
    return {
      shooter: { x: this.player.x, y: this.player.y, slope: this.player.slope || 0 },
      target: { x: this.enemy.x, y: this.enemy.y, alive: this.enemy.alive },
      wind: this.wind.value,
      angle: this.angle,
      skill: this.selectedSkill || null,
      buffs: [...this.selectedBuffs],
      angleMin: this.angleMin,
      angleMax: this.angleMax,
      pow: powActive,
    };
  }

  recommendation() {
    if (this.phase !== 'player' || !this.player?.alive || !this.enemy?.alive) {
      return { reachable: false, force: null, reason: 'not-player' };
    }
    const key = this.recommendationKey();
    if (this.recommendationCache?.key === key) return this.recommendationCache.value;
    const value = solveForceForAngle({
      ...this.recommendationRequest(),
      terrain: this.terrain,
    });
    this.recommendationCache = { key, value };
    return value;
  }

  /**
   * UI-path recommendation: uses the Web Worker replica when the static host
   * provides one, so the angle sweep never blocks the animation frame. Returns
   * the cached value for the current aim state, or null while the worker is
   * still computing (the caller shows a neutral "calculating" state). Falls
   * back to the synchronous sweep on the Go backend or if the worker died.
   */
  requestRecommendation() {
    if (this.phase !== 'player' || !this.player?.alive || !this.enemy?.alive) {
      return { reachable: false, force: null, reason: 'not-player' };
    }
    const key = this.recommendationKey();
    if (this.recommendationCache?.key === key) return this.recommendationCache.value;
    const search = typeof window !== 'undefined' ? window.__GUNNY_SEARCH__ : null;
    if (!search || !search.ready?.()) {
      this._recommendationPendingKey = null;
      return this.recommendation();
    }
    if (this._recommendationPendingKey !== key) {
      this._recommendationPendingKey = key;
      const request = this.recommendationRequest();
      search.recommend(request, (value) => {
        if (this._recommendationPendingKey === key) this._recommendationPendingKey = null;
        // Only accept a result that still describes the current aim state.
        if (!value || this.recommendationKey() !== key) return;
        this.recommendationCache = { key, value };
      });
    }
    return null;
  }

  /** True while an off-thread recommendation for the current aim is in flight. */
  recommendationPending() {
    return this._recommendationPendingKey != null;
  }
}
