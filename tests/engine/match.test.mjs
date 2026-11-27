/**
 * Pure-JS engine acceptance tests — port of server/game/game_test.go.
 *
 * The engine in dist/js/engine/ is what the static build ships (the Go server
 * stays behind /api for the online path), so every behaviour the Go test suite
 * pinned down is asserted again here against the same map and constants.
 *
 * Run: sh scripts/node.sh --test tests/engine/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadTerrainFromBytes } from '../../dist/js/engine/terrain.js';
import { Match } from '../../dist/js/engine/match.js';
import {
  beginTurnLocked, fireLocked, finishFlightLocked, resolveImpactLocked,
} from '../../dist/js/engine/actions.js';
import { nextWind, simulateShot, sourceCriticalDamage, sourceDamage } from '../../dist/js/engine/physics.js';
import { chooseShotInRange } from '../../dist/js/engine/ai.js';
import { GoRand } from '../../dist/js/engine/rng.js';
import {
  ANGLE_MAX, ANGLE_MIN, BALL_DEFS, BEDROCK_Y, CRITICAL_LUCKY, CRITICAL_REDUCE,
  ENERGY_MAX, FIXED_WIND, FORCE_MAX, MAX_FLIGHT_SECONDS, MOVE_STEP_Y, PHYSICS_DT,
  SKILL_DEFS, SPAWN_PROBE_Y, START_ANGLE, WEAPON_DEFS, WEAPON_ORDER, ballFor,
} from '../../dist/js/engine/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAP_FILE = path.join(ROOT, 'dist/data/1156.fore.map');

function testTerrain() {
  return loadTerrainFromBytes(new Uint8Array(readFileSync(MAP_FILE)));
}

function newMatch(seed = 7) {
  return new Match({ terrain: testTerrain(), seed, clock: () => 0 });
}

function runFlight(m, limit = 2000) {
  for (let i = 0; i < limit && m.phase === 'flight'; i += 1) m.update(PHYSICS_DT);
}

test('terrain header matches source', () => {
  const tr = testTerrain();
  assert.equal(tr.width, 1843);
  assert.equal(tr.height, 1020);
  assert.ok(tr.isSolid(240, 389) && !tr.isSolid(240, 388), 'player spawn ground');
  assert.ok(tr.isSolid(1640, 522) && !tr.isSolid(1640, 521), 'enemy spawn ground');
  assert.ok(tr.solidCount() > 0, 'empty collision mask');
});

test('crater carve uses original art and reset restores the mask', () => {
  const tr = testTerrain();
  const before = tr.solidCount();
  const res = tr.carve(240, 389, '401', 'medium');
  assert.ok(res.ok && res.removed > 0, `carve removed=${res.removed} ok=${res.ok}`);
  assert.ok(res.bounds[0] >= 0 && res.bounds[1] >= 0, 'bad bounds');
  assert.equal(tr.solidCount(), before - res.removed);
  assert.equal(tr.craters.length, 1);
  assert.equal(tr.craters[0].art, '401');
  tr.reset();
  assert.equal(tr.solidCount(), before);
  assert.equal(tr.craters.length, 0);
});

test('wind stays in source range', () => {
  const rng = new GoRand(42);
  let wind = 0;
  let target = 0;
  for (let i = 0; i < 2000; i += 1) {
    ({ wind, target } = nextWind(wind, target, rng));
    // SOURCE GetNextWind adds 0..10 tenths to an already-at-target value, so
    // 4.0 can step to 4.1 before the target is re-rolled.
    assert.ok(wind >= -5 && wind <= 5, `wind out of range: ${wind}`);
    assert.ok(target >= -40 && target < 40, `target out of range: ${target}`);
  }
});

test('classic skill bar matches the source tables', () => {
  const extra1 = SKILL_DEFS.extra1;
  assert.deepEqual(extra1.offsets, [0, 0]);
  assert.equal(extra1.damageScale, 0.9);
  assert.ok(extra1.source && extra1.sequential);

  const extra2 = SKILL_DEFS.extra2;
  assert.equal(extra2.offsets.length, 3);
  assert.equal(extra2.damageScale, 0.6);
  assert.ok(extra2.source && extra2.sequential);

  const scatter = SKILL_DEFS.scatter;
  assert.deepEqual(scatter.offsets, [0, -5, 5]);
  assert.deepEqual(scatter.forceScales, [1, 0.9, 1.1]);
  assert.equal(scatter.damageScale, 0.5);
  assert.ok(scatter.source);

  ['boost50', 'boost40', 'boost30', 'boost20', 'boost10'].forEach((id, i) => {
    const def = SKILL_DEFS[id];
    assert.equal(def.kind, 'boost');
    assert.equal(def.damageBonus, [0.5, 0.4, 0.3, 0.2, 0.1][i]);
  });
});

test('classic attack items apply the source damage penalty', () => {
  const cases = [
    { id: 'extra2', buffs: [], shots: 3, scale: 0.6 },
    { id: 'scatter', buffs: [], shots: 3, scale: 0.5 },
    { id: 'extra1', buffs: [], shots: 2, scale: 0.9 },
    // AddAttackSpell scales ShootMinus; AddWoudSpell adds DamagePlus.
    { id: 'extra2', buffs: ['boost50'], shots: 3, scale: 0.9 },
  ];
  for (const tc of cases) {
    const m = newMatch();
    m.selectedSkill = tc.id;
    m.selectedBuffs = [...tc.buffs];
    assert.ok(fireLocked(m, 0, 45, FORCE_MAX), `${tc.id} fire rejected`);
    const sequential = tc.id !== 'scatter';
    assert.equal(m.shots.length, sequential ? 1 : tc.shots, `${tc.id} active`);
    assert.equal(m.queuedShots.length, sequential ? tc.shots - 1 : 0, `${tc.id} queued`);
    for (const shot of [...m.shots, ...m.queuedShots]) {
      assert.equal(shot.skill, tc.id);
      assert.ok(Math.abs(shot.damageScale - tc.scale) < 1e-9, `${tc.id} scale ${shot.damageScale}`);
    }
  }
});

test('sequential attack replays the same launch vector', () => {
  const m = newMatch();
  m.selectedSkill = 'extra2';
  assert.ok(fireLocked(m, 0, 45, FORCE_MAX), 'fire rejected');
  const all = [...m.shots, ...m.queuedShots];
  assert.equal(all.length, 3);
  const first = all[0];
  for (const shot of all.slice(1)) {
    assert.equal(shot.elevation, first.elevation);
    assert.equal(shot.force, first.force);
    assert.equal(shot.vx, first.vx);
    assert.equal(shot.vy, first.vy);
    assert.equal(shot.x, first.x);
    assert.equal(shot.y, first.y);
  }
  assert.equal(m.volleyTotal, 3);
});

test('sequential attack launches the next shell on finishFlight', () => {
  const m = newMatch();
  m.selectedSkill = 'extra1';
  assert.ok(fireLocked(m, 0, 45, FORCE_MAX), 'fire rejected');
  assert.equal(m.shots.length, 1);
  assert.equal(m.queuedShots.length, 1);
  assert.equal(m.stats.playerShots, 1);
  const first = { ...m.shots[0] };
  m.shots[0].alive = false;
  finishFlightLocked(m);
  assert.equal(m.phase, 'flight');
  assert.equal(m.shots.length, 1);
  assert.equal(m.shots[0].slot, 1);
  assert.equal(m.queuedShots.length, 0);
  assert.equal(m.volleyTotal, 2);
  assert.equal(m.stats.playerShots, 2);
  const next = m.shots[0];
  assert.equal(next.elevation, first.elevation);
  assert.equal(next.force, first.force);
  assert.equal(next.vx, first.vx);
  assert.equal(next.vy, first.vy);
  assert.equal(next.x, first.x);
  assert.equal(next.y, first.y);
});

test('damage buffs stack and spend', () => {
  const m = newMatch();
  m.selectedBuffs = ['boost50', 'boost20'];
  assert.ok(fireLocked(m, 0, 45, FORCE_MAX), 'fire rejected');
  for (const shot of m.shots) assert.ok(Math.abs(shot.damageScale - 1.7) < 1e-9);
  assert.equal(m.skillUses.boost50, 0);
  assert.equal(m.skillUses.boost20, 0);
  assert.equal(m.selectedBuffs.length, 0);
});

test('weapon locks after the first shot', () => {
  const m = newMatch();
  assert.equal(m.command({ type: 'select_weapon', weapon: 'wind' }), '');
  assert.equal(m.playerWeaponId, 'wind');
  assert.ok(fireLocked(m, 0, m.playerWeapon().startAngle, FORCE_MAX), 'fire rejected');
  // Selection is ignored while the shell is in flight; verify the lock once
  // control returns to the player.
  m.phase = 'player';
  assert.notEqual(m.command({ type: 'select_weapon', weapon: 'fire' }), '');
  assert.equal(m.playerWeaponId, 'wind');
});

test('classic weapon profiles match the source', () => {
  const checks = [
    { id: 'fire', pic: 'bombpack', ball: '161', min: 20, max: 50 },
    { id: 'cannon', pic: 'bomb', ball: '101', min: 55, max: 70 },
    { id: 'fruit', pic: 'fruit', ball: '401', min: 20, max: 50 },
    { id: 'appliance', pic: 'television', ball: '321', min: 50, max: 70 },
    { id: 'wind', pic: 'dart', ball: '121', min: 15, max: 50 },
  ];
  for (const c of checks) {
    const def = WEAPON_DEFS[c.id];
    assert.equal(def.pic, c.pic, `${c.id} pic`);
    assert.equal(def.ballId, c.ball, `${c.id} ball`);
    assert.equal(def.angleMin, c.min, `${c.id} angleMin`);
    assert.equal(def.angleMax, c.max, `${c.id} angleMax`);
  }
  for (const id of WEAPON_ORDER) assert.ok(WEAPON_DEFS[id], `missing weapon ${id}`);
});

test('source damage: centre, edge and half radius', () => {
  const attacker = {
    baseDamage: 360, attack: 100, grade: 10, lucky: 0, damagePlus: 1, shootMinus: 1,
    worldBossAddDamage: 0,
  };
  const defender = { baseGuard: 80, defence: 40 };
  assert.ok(sourceDamage(0, 55, attacker, defender) > 0);
  assert.equal(sourceDamage(55, 55, attacker, defender), 0);
  assert.ok(sourceDamage(27.5, 55, attacker, defender) > 0);
});

test('source critical damage follows MakeCriticalDamage', () => {
  const lucky = CRITICAL_LUCKY;
  const base = 400;
  const rate = (lucky * 45) / (800 + lucky);
  const crit = Math.trunc((0.5 + lucky * 0.00015) * base);
  assert.equal(sourceCriticalDamage(lucky, CRITICAL_REDUCE, base, 0), crit);
  assert.equal(sourceCriticalDamage(lucky, CRITICAL_REDUCE, base, Math.ceil(rate)), 0);
  assert.equal(sourceCriticalDamage(lucky, CRITICAL_REDUCE, base, 99), 0);
  assert.equal(sourceCriticalDamage(lucky, 50, base, 0), Math.trunc(crit / 2));
  assert.equal(sourceCriticalDamage(lucky, CRITICAL_REDUCE, 0, 0), 0);
});

test('critical damage is applied on impact', () => {
  const tr = testTerrain();
  // Deterministic crit stream whose first Intn(100) is the requested roll.
  function rngWithFirstRoll(want) {
    for (let seed = 0; seed < 10000; seed += 1) {
      const r = new GoRand(seed);
      if (r.intn(100) === want) return new GoRand(seed);
    }
    throw new Error(`no seed for roll ${want}`);
  }
  const makeImpact = (forceCrit) => {
    const m = new Match({ terrain: tr, seed: 7, clock: () => 0 });
    m.critRng = rngWithFirstRoll(forceCrit ? 0 : 99);
    const target = m.actors[1];
    const hpBefore = target.hp;
    const p = {
      owner: 0, x: target.x, y: target.y - 38, impact: 'actor', alive: false,
      damageScale: 1, weapon: m.playerWeapon().id, craterArt: '401', shells: 1, slot: 0,
      resolved: false, pow: false, carry: false,
    };
    resolveImpactLocked(m, p);
    assert.ok(m.lastImpact, 'missing impact');
    return { m, hpBefore, loss: m.lastImpact.damage + (m.lastImpact.critical || 0) };
  };

  const crit = makeImpact(true);
  assert.ok(crit.m.lastImpact.critical > 0, 'forced crit produced no critical');
  assert.equal(crit.m.actors[1].hp, crit.hpBefore - crit.loss);
  assert.equal(crit.m.stats.playerDamageDealt, crit.loss);

  const plain = makeImpact(false);
  assert.equal(plain.m.lastImpact.critical || 0, 0);
  assert.ok(crit.loss > plain.loss);
  assert.equal(crit.loss - plain.loss, crit.m.lastImpact.critical);
  assert.equal(plain.m.actors[1].hp, plain.hpBefore - plain.loss);
});

test('match starts on ground', () => {
  const m = newMatch();
  const s = m.snapshot();
  assert.equal(s.phase, 'player');
  assert.equal(s.turn, 0);
  assert.equal(s.round, 1);
  assert.equal(s.actors[0].x, 240);
  assert.equal(s.actors[1].x, 1640);
  assert.equal(s.actors[0].y, 389);
  assert.equal(s.actors[1].y, 522);
  assert.equal(s.wind, 0);
  assert.equal(s.windTarget, 0);
});

test('fire volley and resolve', () => {
  const m = newMatch();
  assert.ok(fireLocked(m, 0, 45, FORCE_MAX), 'fire rejected');
  assert.equal(m.shots.length, 1);
  assert.equal(m.phase, 'flight');
  runFlight(m, 500);
  assert.notEqual(m.phase, 'flight', 'flight did not resolve');
  assert.ok(m.lastImpact, 'missing impact');
  assert.ok(m.phase === 'resolve' || m.phase === 'player', `unexpected phase ${m.phase}`);
});

// SOURCE: BallList.xml + bombconfig.xml — POW uses the Special ball's own
// Amount/Power/Radii/Crater (fruit 411: three shells, Power 0.5, Radii 65,
// Crater 411). Port of TestPowVolleyUsesSpecialBall.
test('POW volley uses the weapon special ball', () => {
  const b411 = ballFor('411');
  assert.deepEqual(
    { power: b411.power, radii: b411.radii, crater: b411.crater, amount: b411.amount },
    { power: 0.5, radii: 65, crater: '411', amount: 3 },
  );
  for (const [id, want] of Object.entries({ 171: [3, 0.6, 45], 151: [3, 0.6], 371: [3, 0.5] })) {
    const b = BALL_DEFS[id];
    assert.equal(b.amount, want[0], `ball ${id} amount`);
    assert.equal(b.power, want[1], `ball ${id} power`);
    if (want.length > 2) assert.equal(b.radii, want[2], `ball ${id} radii`);
  }
  const fruit = WEAPON_DEFS.fruit;
  assert.equal(fruit.specialBallId, '411');
  assert.equal(fruit.actionType, 0);
  assert.equal(fruit.specialActionType, 0);
  const bow = WEAPON_DEFS.bow;
  assert.equal(bow.actionType, 1);
  assert.equal(bow.specialActionType, 1);

  const m = newMatch();
  m.playerWeaponId = 'fruit';
  m.energy = ENERGY_MAX;
  m.powSelected = true;
  assert.ok(fireLocked(m, 0, 45, 1200), 'pow fire rejected');
  assert.equal(m.volleyTotal, 3);
  assert.equal(m.queuedShots.length, 2);
  assert.equal(m.shot.craterArt, '411');
  assert.equal(m.shot.blastRadius, 65);
  assert.equal(m.shot.damageScale, 0.5);
  assert.ok(m.shot.pow, 'shell must be flagged pow');

  const m2 = newMatch();
  m2.playerWeaponId = 'wind';
  assert.ok(fireLocked(m2, 0, 40, 1200), 'wind fire rejected');
  assert.equal(m2.shot.craterArt, '121');
  assert.equal(m2.shot.blastRadius, 55);
  assert.equal(m2.shot.damageScale, 1);

  const m3 = newMatch();
  m3.playerWeaponId = 'cannon';
  m3.energy = ENERGY_MAX;
  m3.powSelected = true;
  assert.ok(fireLocked(m3, 0, 65, 1200), 'cannon pow fire rejected');
  assert.equal(m3.volleyTotal, 1);
  assert.equal(m3.shot.craterArt, '401');
  assert.equal(m3.shot.blastRadius, 65);
  assert.equal(m3.shot.damageScale, 1.3);
});

// SOURCE: BaseGame.cs PosX/PosX1 spawn columns. Maps like 1157 have floating
// foreground above the fixed column, so spawning must scan for a column with
// ground underfoot and 110 px of head clearance. Port of
// TestSpawnColumnAvoidsFloatingTerrain.
test('spawn columns avoid floating terrain on every map', () => {
  for (const id of ['1156', '1001', '1002', '1003', '1008', '1014', '1035', '1038', '1157', '1190', '1192']) {
    const bytes = new Uint8Array(readFileSync(path.join(ROOT, `dist/data/${id}.fore.map`)));
    const tr = loadTerrainFromBytes(bytes);
    const m = new Match({ terrain: tr, seed: 7, clock: () => 0 });
    for (let i = 0; i < m.actors.length; i += 1) {
      const a = m.actors[i];
      const x = Math.trunc(a.x);
      const y = Math.trunc(a.y);
      assert.ok(y >= SPAWN_PROBE_Y && y < tr.height - 20, `${id} actor ${i} spawns out of bounds (${x},${y})`);
      for (let sy = y - 110; sy < y; sy += 1) {
        if (sy < 0) continue;
        assert.ok(!tr.isSolid(x, sy), `${id} actor ${i} embedded at (${x},${sy})`);
      }
      assert.ok(tr.isSolid(x, y), `${id} actor ${i} has no ground under (${x},${y})`);
    }
  }
});

test('AI plan is reachable', () => {
  const tr = testTerrain();
  const m = newMatch();
  const plan = chooseShotInRange(
    m.actors[1], m.actors[0], 0, tr, new GoRand(7),
    START_ANGLE, ANGLE_MIN, ANGLE_MAX, MAX_FLIGHT_SECONDS, FORCE_MAX,
  );
  assert.ok(plan.angle >= ANGLE_MIN && plan.angle <= ANGLE_MAX, `angle ${plan.angle}`);
  assert.ok(plan.force >= 420 && plan.force <= FORCE_MAX, `force ${plan.force}`);
  assert.ok(plan.expected.closest !== Infinity, 'AI found no trajectory');
});

test('crater reseats the actor and walking stays on the surface', () => {
  const tr = testTerrain();
  const m = new Match({ terrain: tr, seed: 7, clock: () => 0 });
  const a = m.actors[0];

  const feetX = Math.trunc(a.x);
  const feetY = Math.trunc(a.y);
  tr.carve(feetX, feetY, '401', 'medium');
  m.refreshSupportLocked(a);
  if (!a.falling) {
    const g = tr.findGroundY(feetX, feetY - 4, tr.height - 1);
    assert.ok(g.ok, 'no ground below carved feet');
    assert.ok(a.y >= g.y - 1, `actor left floating above new ground: y=${a.y} ground=${g.y}`);
  }

  for (let i = 0; i < 200 && a.falling; i += 1) m.update(PHYSICS_DT);
  assert.ok(!a.falling, 'actor never landed after crater');
  for (let step = 0; step < 12; step += 1) {
    m.stepActorLocked(a, m.actors[1], 1);
    const g = tr.findGroundY(Math.trunc(a.x), Math.trunc(a.y) - MOVE_STEP_Y - 2, Math.trunc(a.y) + MOVE_STEP_Y + 2);
    if (g.ok) {
      assert.ok(a.y >= g.y - 1, `step ${step}: feet sink below surface at x=${Math.trunc(a.x)}`);
    }
  }
});

test('bedrock floor cannot be carved', () => {
  const tr = testTerrain();
  tr.carve(300, BEDROCK_Y - 10, '4', 'large');
  for (const y of [BEDROCK_Y, BEDROCK_Y + 1, tr.height - 1]) {
    assert.ok(tr.isSolid(300, y), `bedrock breached at y=${y}`);
  }
  for (let x = 260; x <= 340; x += 10) {
    for (const y of [BEDROCK_Y, tr.height - 1]) {
      assert.ok(tr.isSolid(x, y), `bedrock breached at (${x},${y})`);
    }
  }
});

test('fixed-wind trajectory is deterministic', (t) => {
  if (!FIXED_WIND) return t.skip('FixedWind disabled');
  const tr = testTerrain();
  const m = newMatch();
  const r1 = simulateShot(300, 1186, 35, 800, 1, m.wind, null, tr, MAX_FLIGHT_SECONDS, true);
  const r2 = simulateShot(300, 1186, 35, 800, 1, m.wind, null, tr, MAX_FLIGHT_SECONDS, true);
  assert.ok(Math.abs(r1.x - r2.x) <= 1e-9 && Math.abs(r1.y - r2.y) <= 1e-9,
    `same shot diverged: (${r1.x},${r1.y}) vs (${r2.x},${r2.y})`);
});

test('carry ball teleports the owner without damage or crater', () => {
  const m = newMatch();
  m.allowDebug = true;
  assert.ok(m.canCarry, 'CanCarry should start true');
  assert.equal(m.command({ type: 'carry' }), '');
  assert.ok(m.carryArmed, 'carry should be armed after command');
  const before = m.terrain.solidCount();
  const startX = m.actors[0].x;
  const hpBefore = m.actors[1].hp;
  assert.ok(fireLocked(m, 0, 45, 1200), 'carry fire rejected');
  assert.equal(m.shots.length, 1);
  assert.ok(m.shots[0].carry, 'expected a carry shell');
  assert.equal(m.shots[0].damageScale, 0);
  assert.equal(m.shots[0].craterArt, '');
  assert.ok(!m.carryArmed && !m.canCarry, 'carry must be consumed after firing');

  runFlight(m);
  assert.equal(m.actors[1].hp, hpBefore, 'carry ball dealt damage');
  assert.equal(m.terrain.solidCount(), before, 'carry ball carved terrain');
  assert.ok(Math.abs(m.actors[0].x - startX) >= 1, 'owner was not translated');

  assert.equal(m.command({ type: 'carry' }), '');
  assert.ok(!m.carryArmed, 'carry must not re-arm in the same turn');
});

test('carry is available again on the next player turn', () => {
  const m = newMatch();
  m.allowDebug = true;
  assert.equal(m.command({ type: 'carry' }), '');
  fireLocked(m, 0, 45, 1200);
  assert.ok(!m.canCarry, 'consumed');
  beginTurnLocked(m, 0, false);
  assert.ok(m.canCarry && !m.carryArmed, 'new player turn should restore canCarry');
});
