/**
 * Pure-JS port of server/game/ai.go — the browser-only opponent brain.
 *
 * Search policy is a NEW addition (the original checkout has no aiming AI), but
 * it runs against the same source ballistics, so a fixed seed reproduces it.
 */
import { clamp } from './constants.js?v=32';
import { muzzlePoint, simulateShot } from './physics.js?v=32';

function scoreCandidate(shooter, target, terrain, wind, angle, force, direction, maxSeconds, forceMax) {
  const { x: mx, y: my } = muzzlePoint(shooter, angle, direction);
  const r = simulateShot(mx, my, angle, force, direction, wind, target, terrain, maxSeconds, false);
  let score = r.closest;
  if (r.impact === 'out') score += 600;
  if (!Number.isFinite(score)) score = 9999;
  return { angle, force, muzzleX: mx, muzzleY: my, result: r, score };
}

/**
 * Search-only half of the AI aim: coarse sweep, fine refinement, no RNG. The
 * result feeds either the synchronous chooseShotInRange (which adds the
 * triangular aim error) or the async host solver — keeping the search itself
 * free of the match RNG means a Web Worker can run it without perturbing the
 * deterministic wind/AI random stream.
 */
export function solveShotInRange(shooter, target, wind, terrain, startAngle, angleMin, angleMax, maxSeconds, forceMax) {
  const direction = target.x < shooter.x ? -1 : 1;
  let best = { score: Infinity, angle: startAngle, force: 1200 };

  for (let angle = angleMin; angle <= angleMax; angle += 3) {
    for (let force = 300.0; force <= forceMax; force += 40) {
      const c = scoreCandidate(shooter, target, terrain, wind, angle, force, direction, maxSeconds, forceMax);
      const adjusted = c.score + Math.abs(force - 1400) * 0.002;
      if (adjusted < best.score) {
        c.score = adjusted;
        best = c;
      }
    }
  }

  const centerAngle = best.angle;
  const centerForce = best.force;
  for (let angle = Math.max(angleMin, centerAngle - 4); angle <= Math.min(angleMax, centerAngle + 4); angle += 1) {
    for (let force = Math.max(300, centerForce - 100); force <= Math.min(forceMax, centerForce + 100); force += 10) {
      const c = scoreCandidate(shooter, target, terrain, wind, angle, force, direction, maxSeconds, forceMax);
      if (c.score < best.score) best = c;
    }
  }

  return {
    angle: best.angle, force: best.force, direction,
    expected: best.result, solvedAngle: best.angle, solvedForce: best.force,
  };
}

export function chooseShotInRange(shooter, target, wind, terrain, rng, startAngle, angleMin, angleMax, maxSeconds, forceMax) {
  const best = solveShotInRange(
    shooter, target, wind, terrain, startAngle, angleMin, angleMax, maxSeconds, forceMax,
  );
  let angle = best.angle + triangularNoise(rng) * 1.6;
  let force = best.force + triangularNoise(rng) * 28;
  angle = clamp(angle, angleMin, angleMax);
  force = clamp(force, 420, forceMax);
  return {
    angle, force, direction: best.direction,
    expected: best.expected, solvedAngle: best.solvedAngle, solvedForce: best.solvedForce,
  };
}

export function chooseShotForWeapon(shooter, target, wind, terrain, rng, weapon, maxSeconds, forceMax) {
  return chooseShotInRange(
    shooter, target, wind, terrain, rng,
    weapon.startAngle, weapon.angleMin, weapon.angleMax, maxSeconds, forceMax,
  );
}

export function solveShotForWeapon(shooter, target, wind, terrain, weapon, maxSeconds, forceMax) {
  return solveShotInRange(
    shooter, target, wind, terrain,
    weapon.startAngle, weapon.angleMin, weapon.angleMax, maxSeconds, forceMax,
  );
}

export function triangularNoise(rng) {
  return (rng.float64() + rng.float64() + rng.float64() - 1.5) / 1.5;
}
