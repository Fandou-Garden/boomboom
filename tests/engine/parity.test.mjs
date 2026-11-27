/**
 * Golden parity test: the expected values below were dumped from the Go engine
 * (server/game) with the same map, seed and commands before it was retired as
 * the shipped offline backend. Any drift in ballistics, damage, crits, carving
 * or the AI turn shows up here without needing Go installed.
 *
 * Known, accepted deviation: Go's math.Sin and V8's Math.sin can differ by one
 * ulp, so raw (untruncated) muzzle coordinates may differ in the last bit. The
 * first flight checkpoint of the duel is compared with a 1e-9 tolerance for
 * that reason; every integer-valued result is exact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadTerrainFromBytes } from '../../dist/js/engine/terrain.js';
import { Match } from '../../dist/js/engine/match.js';
import { PHYSICS_DT } from '../../dist/js/engine/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadTerrain() {
  return loadTerrainFromBytes(new Uint8Array(readFileSync(path.join(ROOT, 'dist/data/1156.fore.map'))));
}

function runScenario({ seed = 42, setup, angle, force }) {
  const m = new Match({ terrain: loadTerrain(), seed, debug: true, clock: () => 0 });
  const start = m.seq;
  if (setup) setup(m);
  m.command({ type: 'fire', actor: 0, angle, force });
  for (let i = 0; i < 4000 && m.phase === 'flight'; i += 1) m.update(PHYSICS_DT);
  const s = m.snapshot();
  return {
    seq: s.seq,
    phase: s.phase,
    a0: s.actors[0],
    a1: s.actors[1],
    lastImpact: s.lastImpact,
    summary: s.lastPlayerSummary,
    energy: s.energy,
    craters: s.craters ? s.craters.length : 0,
    events: m.eventsSince(start).map((e) => `${e.seq}:${e.type}`),
  };
}

test('parity: straight shot goes out of the arena', () => {
  const r = runScenario({ angle: 45, force: 1200 });
  assert.equal(r.seq, 9);
  assert.equal(r.phase, 'resolve');
  assert.deepEqual(r.lastImpact, {
    x: 1904, y: 458, type: 'out', owner: 0, damage: 0, distance: 0,
    removed: 0, craterKind: '', craterArt: '', shell: 0, shells: 1,
  });
  assert.equal(r.summary, '第 1 回合 · 未命中');
  assert.equal(r.energy, 12);
  assert.deepEqual(r.events, ['5:sound', '6:fire', '7:sound', '8:impact', '9:volley-resolve']);
});

test('parity: connecting shot damage and distance', () => {
  const r = runScenario({ angle: 22, force: 1125 });
  // No extra 'sound' event on hit: the browser-only synth chime was removed
  // because the original Flash build has no standalone hit SoundID.
  assert.equal(r.seq, 9);
  assert.equal(r.a1.hp, 1712);
  assert.equal(r.lastImpact.damage, 288);
  assert.equal(r.lastImpact.type, 'actor');
  assert.equal(r.lastImpact.distance, 33.24154027718932);
  assert.equal(r.lastImpact.craterArt, '401');
  assert.equal(r.lastImpact.removed, 0);
  assert.equal(r.summary, '第 1 回合 · 命中 288 伤害');
  assert.equal(r.energy, 32);
});

test('parity: seeded critical adds damage and changes the summary', () => {
  const r = runScenario({ seed: 62, angle: 22, force: 1125 });
  assert.equal(r.seq, 10);
  assert.equal(r.lastImpact.damage, 288);
  assert.equal(r.lastImpact.critical, 151);
  assert.equal(r.a1.hp, 1561);
  assert.equal(r.summary, '第 1 回合 · 暴击 288+151 伤害');
});

// SOURCE: BallList.xml — fruit's Special ball is 411 (three-shell POW volley,
// Power 0.5, Radii 65, Crater 411). The three shells fire sequentially and
// all three connect at this angle/force, so the last impact is shell 2 of 3.
test('parity: POW fires the special ball volley', () => {
  const r = runScenario({
    setup: (m) => m.command({ type: 'pow', value: 100 }),
    angle: 22, force: 1125,
  });
  // Three connecting shells used to emit three fake 'hit' sound events.
  assert.equal(r.seq, 19);
  assert.equal(r.lastImpact.damage, 148);
  assert.equal(r.lastImpact.type, 'actor');
  assert.equal(r.lastImpact.shell, 2);
  assert.equal(r.lastImpact.shells, 3);
  assert.equal(r.lastImpact.removed, 0);
  assert.equal(r.lastImpact.craterKind, 'large');
  assert.equal(r.lastImpact.craterArt, '411');
  assert.equal(r.craters, 0);
  assert.equal(r.a1.hp, 1556);
  assert.equal(r.energy, 60);
  assert.equal(r.events.filter((e) => e.endsWith(':fire')).length, 3);
});

test('parity: carry teleport lands on the same point', () => {
  const r = runScenario({
    setup: (m) => m.command({ type: 'carry' }),
    angle: 45, force: 1200,
  });
  assert.equal(r.seq, 11);
  assert.equal(r.a0.x, 1773);
  assert.equal(r.a0.y, 524);
  assert.equal(r.lastImpact.type, 'carry');
  assert.equal(r.lastImpact.x, 1773);
  assert.equal(r.lastImpact.y, 524);
  assert.equal(r.summary, '第 1 回合 · 传送到落点');
  assert.deepEqual(r.events, [
    '5:carry', '6:sound', '7:fire', '8:translate', '9:sound', '10:impact', '11:volley-resolve',
  ]);
});

test('parity: full AI exchange (move, aim, fire, resolve, next turn)', () => {
  const m = new Match({ terrain: loadTerrain(), seed: 42, debug: true, clock: () => 0 });
  m.command({ type: 'fire', actor: 0, angle: 45, force: 1200 });
  const phases = [];
  let lastPhase = '';
  let steps = 0;
  for (; steps < 6000; steps += 1) {
    const s = m.snapshot();
    if (s.phase !== lastPhase) {
      lastPhase = s.phase;
      phases.push([steps, s.phase, s.seq]);
      if (s.phase === 'enemy_aim') {
        assert.equal(s.actors[1].x, 1595);
        assert.equal(s.actors[1].y, 528);
      }
      if (s.phase === 'flight' && s.turn === 1) {
        // Muzzle spawn: raw float, 1-ulp tolerance (see file header).
        assert.ok(Math.abs(s.shots[0].y - 426.85003917085572) < 1e-9, `enemy muzzle y ${s.shots[0].y}`);
      }
    }
    if (s.phase === 'player' && steps > 0) break;
    if (s.phase === 'over') break;
    m.update(PHYSICS_DT);
  }
  assert.equal(steps, 286);
  assert.deepEqual(phases, [
    [0, 'flight', 6], [61, 'resolve', 9], [111, 'enemy_move', 11], [129, 'enemy_think', 12],
    [152, 'enemy_aim', 13], [165, 'flight', 15], [236, 'resolve', 18], [286, 'player', 20],
  ]);
  const s = m.snapshot();
  assert.equal(s.phase, 'player');
  assert.equal(s.actors[0].hp, 1714);
  assert.equal(s.actors[1].hp, 2000);
  assert.equal(s.lastImpact.damage, 286);
  assert.equal(s.lastImpact.owner, 1);

  const fires = m.eventsSince(0).filter((e) => e.type === 'fire');
  assert.equal(fires.length, 2);
  assert.equal(fires[0].data.volleyId, '1-0-0');
  assert.equal(fires[1].data.angle, 63.31384641409352);
  assert.equal(fires[1].data.force, 1301.502970668103);
  assert.equal(fires[1].data.volleyId, '1-1-6600');
});
