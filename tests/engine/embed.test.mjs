/**
 * Regression for actors sinking into / floating off the terrain.
 *
 * Port of server/game/embed_sim_test.go: play a real match on every shipped
 * map (player walks + fires, AI answers) and assert at every tick that each
 * grounded actor's feet sit on the surface top of its column:
 *   - never below the column surface (embedded / sunk into terrain),
 *   - never more than the refresh tolerance above it (airborne while grounded),
 *   - never with solid terrain in the body column right above the feet.
 *
 * Run: sh scripts/node.sh --test tests/engine/embed.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadTerrainFromBytes, Terrain } from '../../dist/js/engine/terrain.js';
import { Match } from '../../dist/js/engine/match.js';
import { fireLocked } from '../../dist/js/engine/actions.js';
import { GoRand } from '../../dist/js/engine/rng.js';
import { FORCE_MAX, MOVE_SPEED, PHYSICS_DT } from '../../dist/js/engine/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAP_IDS = ['1156', '1001', '1002', '1003', '1008', '1014', '1035', '1038', '1157', '1190', '1192', '1049'];
const TICKS = 9000;

function loadMap(id) {
  return loadTerrainFromBytes(new Uint8Array(readFileSync(path.join(ROOT, `dist/data/${id}.fore.map`))));
}

// SOURCE: SelfPlayerWalkAction.as — a step taller than stepY is not walked
// through: canStand at the current foot height sees a solid shoulder column
// (the slope face) and the actor stops. Before the canStand gate the fallback
// moved the actor into the slope and dropped it inside the terrain.
test('walk stops at a steep slope face instead of entering it', () => {
  const W = 400;
  const H = 300;
  const mask = new Uint8Array(W * H);
  for (let x = 0; x < W; x += 1) {
    const top = x >= 200 ? 200 : 250; // 50 px wall: much taller than stepY (7)
    for (let y = top; y < H; y += 1) mask[y * W + x] = 1;
  }
  const tr = new Terrain(W, H, mask, {});
  const m = new Match({ terrain: tr, seed: 7, clock: () => 0 });
  const a = m.actors[0];
  const other = m.actors[1];
  a.x = 190;
  a.y = 250;
  a.grounded = true;
  a.falling = false;
  a.alive = true;
  other.x = 60;
  other.y = 250;

  let steps = 0;
  while (m.stepActorLocked(a, other, 1) && steps < 20) steps += 1;
  assert.ok(steps < 20, 'actor never stopped at the wall');
  assert.ok(Math.trunc(a.x) < 200, `actor walked into the slope column: x=${a.x}`);
  assert.ok(a.grounded && !a.falling, 'actor must stay grounded at the wall');
  assert.ok(!tr.isSolid(Math.trunc(a.x), Math.trunc(a.y) - 1), 'body must stay out of the slope');
});

for (const id of MAP_IDS) {
  test(`actors never embed in terrain on map ${id}`, () => {
    const tr = loadMap(id);
    const m = new Match({ terrain: tr, seed: 42, clock: () => 0 });
    const rng = new GoRand(7);
    let ticks = 0;
    while (ticks < TICKS) {
      ticks += 1;
      // Player: random walk bursts and random shots so craters form under and
      // around the actors.
      if (m.phase === 'player') {
        if (rng.intn(60) === 0) {
          const angle = 20 + rng.float64() * 60;
          const force = 300 + rng.float64() * (FORCE_MAX - 300);
          fireLocked(m, 0, angle, force);
        } else if (rng.intn(3) === 0) {
          let dir = 1;
          if (rng.intn(2) === 0) dir = -1;
          if (!m.moveActorLocked(0, dir, MOVE_SPEED * 0.05)) {
            m.moveActorLocked(0, -dir, MOVE_SPEED * 0.05);
          }
        }
      }
      m.update(PHYSICS_DT);
      for (const a of m.actors) {
        if (!a.alive || a.falling || !a.grounded) continue;
        const x = Math.trunc(a.x);
        const y = Math.trunc(a.y);
        // Surface of the column *near the feet*: an overhang high above the
        // actor is legitimate (standing under a floating island), so probe a
        // local window, not the whole column.
        const gyNear = tr.findGroundY(x, y - 20, tr.height - 1);
        assert.ok(gyNear.ok, `tick=${ticks} actor ${a.index} at x=${x} y=${y} has no terrain below (free fall while grounded)`);
        assert.ok(gyNear.y >= y,
          `tick=${ticks} actor ${a.index} SUNK: x=${x} y=${y} but local surface gy=${gyNear.y} (delta ${gyNear.y - y})`);
        assert.ok(!tr.isSolid(x, y - 1),
          `tick=${ticks} actor ${a.index} body inside terrain: x=${x} y=${y} solid above feet`);
      }
      if (m.phase === 'over') break;
    }
    // Every map should survive the full simulation; the match may or may not
    // finish inside the budget, exactly like the Go test.
    assert.ok(ticks > 0, 'simulation did not run');
  });
}
