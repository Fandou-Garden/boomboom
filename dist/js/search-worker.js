/**
 * Off-thread ballistic search for the static (pure-JS) build.
 *
 * Keeps one replica of the match collision mask — built from the same
 * .fore.map bytes and baked crater bitmaps the engine loads — and answers two
 * request kinds against it:
 *
 *   ai  — the opponent's coarse+fine aim search (engine ai/physics), used by
 *         Match.endEnemyMoveLocked through the optional aiSolver hook.
 *   rec — the player-facing force recommendation (client ai/physics), used by
 *         RemoteMatch.requestRecommendation while an angle settles.
 *
 * The terrain starts empty and is advanced only by crater diffs posted from
 * the main thread, which keeps the replica byte-identical to the authoritative
 * mask. The match RNG never runs here: the main thread applies the aim error
 * itself, so the deterministic wind/AI random stream is unchanged.
 */
import { loadTerrainFromBytes } from './engine/terrain.js?v=32';
import { solveShotForWeapon } from './engine/ai.js?v=32';
import { solveForceForAngle } from './ai.js?v=32';

let terrain = null;
let applied = 0;

// The host posts crater diffs, not the whole list: {reset:true} before a delta
// after a match reset, and {list} holding only craters added since the last
// message. Replaying them in order keeps this mask byte-identical to the
// authoritative one.
function applyCraters(msg) {
  if (!terrain) return false;
  if (msg.reset) {
    terrain.reset();
    applied = 0;
  }
  const list = Array.isArray(msg.list) ? msg.list : [];
  for (const c of list) {
    if (!c) continue;
    terrain.carve(c.x, c.y, c.art, c.kind || 'medium');
    applied += 1;
  }
  return true;
}

function describe(error) {
  return String(error && error.message ? error.message : error);
}

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === 'init') {
    try {
      // SOURCE: the same LE-header bitmask the engine loads; the full art set
      // (50/401/4/121/131/411) is baked into crater-masks.js.
      terrain = loadTerrainFromBytes(new Uint8Array(msg.map));
      applied = 0;
      self.postMessage({ type: 'ready', mapId: msg.mapId || null });
    } catch (error) {
      self.postMessage({ type: 'init-error', error: describe(error) });
    }
    return;
  }
  if (msg.type === 'craters') {
    try {
      applyCraters(msg);
    } catch (error) {
      self.postMessage({ type: 'craters-error', error: describe(error) });
    }
    return;
  }
  if (msg.type === 'ai') {
    const job = msg.job || {};
    if (!terrain) {
      self.postMessage({ type: 'ai', id: msg.id, result: null });
      return;
    }
    try {
      const result = solveShotForWeapon(
        job.shooter, job.target, job.wind, terrain,
        { startAngle: job.startAngle, angleMin: job.angleMin, angleMax: job.angleMax },
        job.maxSeconds, job.forceMax,
      );
      self.postMessage({ type: 'ai', id: msg.id, result });
    } catch (error) {
      self.postMessage({ type: 'ai', id: msg.id, result: null, error: describe(error) });
    }
    return;
  }
  if (msg.type === 'rec') {
    const request = msg.request || {};
    if (!terrain) {
      self.postMessage({ type: 'rec', id: msg.id, value: null });
      return;
    }
    try {
      const value = solveForceForAngle({ ...request, terrain });
      self.postMessage({ type: 'rec', id: msg.id, value });
    } catch (error) {
      self.postMessage({ type: 'rec', id: msg.id, value: null, error: describe(error) });
    }
    return;
  }
  // Debug only: the host can compare this mask against the authoritative one.
  if (msg.type === 'hash') {
    self.postMessage({
      type: 'hash', id: msg.id,
      value: terrain ? { hash: terrain.hash(), applied } : null,
    });
  }
};
