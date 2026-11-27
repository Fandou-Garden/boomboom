/** New browser-only opponent. It solves with the same physics/terrain modules. */
import { AI, CONTROLS, PHYSICS, COMBAT, BATTLE } from './config.js?v=27';

const COMBAT_TARGET_RADIUS = COMBAT.targetHitRadius;
import { blastDamageFor, clamp, muzzlePoint, simulateShot } from './physics.js?v=27';

function triangularNoise(random) {
  // Range roughly [-1, 1], denser near zero.
  return (random() + random() + random() - 1.5) / 1.5;
}

function scoreCandidate({ shooter, target, terrain, wind, angle, force, direction }) {
  const muzzle = muzzlePoint(shooter, angle, direction);
  const result = simulateShot({
    origin: { x: muzzle.x, y: muzzle.y },
    angle,
    force,
    direction,
    wind,
    target,
    terrain,
    cfg: PHYSICS,
  });
  let score = result.closest;
  if (result.impact === 'out') score += 600;
  if (!Number.isFinite(score)) score = 9999;
  return { ...result, score, angle, force, muzzle };
}

export function chooseShot({
  shooter,
  target,
  wind,
  terrain,
  random = Math.random,
  noise = true,
  cfg = AI,
  angleMin = CONTROLS.angleMin,
  angleMax = CONTROLS.angleMax,
}) {
  const direction = Math.sign(target.x - shooter.x) || 1;
  let best = { score: Infinity, angle: CONTROLS.startAngle, force: 1200 };

  for (let angle = angleMin; angle <= angleMax; angle += cfg.coarseAngleStep) {
    for (let force = 600; force <= PHYSICS.forceMax; force += cfg.coarseForceStep) {
      const result = scoreCandidate({ shooter, target, terrain, wind, angle, force, direction });
      // A tiny preference for flatter/faster shots only breaks ties.
      const adjusted = result.score + Math.abs(force - 1400) * 0.002;
      if (adjusted < best.score) best = { ...result, score: adjusted };
    }
  }

  const centerAngle = best.angle;
  const centerForce = best.force;
  for (let angle = Math.max(angleMin, centerAngle - 4); angle <= Math.min(angleMax, centerAngle + 4); angle += cfg.fineAngleStep) {
    for (let force = Math.max(300, centerForce - 100); force <= Math.min(PHYSICS.forceMax, centerForce + 100); force += cfg.fineForceStep) {
      const result = scoreCandidate({ shooter, target, terrain, wind, angle, force, direction });
      if (result.score < best.score) best = { ...result, score: result.score };
    }
  }

  let angle = best.angle;
  let force = best.force;
  if (noise) {
    angle += triangularNoise(random) * cfg.angleNoise;
    force += triangularNoise(random) * cfg.forceNoise;
  }
  angle = clamp(angle, angleMin, angleMax);
  force = clamp(force, 420, PHYSICS.forceMax);

  return {
    angle,
    force,
    direction,
    expected: best,
    solvedAngle: best.angle,
    solvedForce: best.force,
  };
}

/** Solve without the intentionally imperfect aim; used by diagnostics. */
export function solvePerfect({ shooter, target, wind, terrain, random = Math.random, angleMin, angleMax }) {
  return chooseShot({ shooter, target, wind, terrain, random, noise: false, angleMin, angleMax });
}

/**
 * Recommend one force for a fixed player angle. This deliberately does not
 * change the angle and never fires: it scans the exact same wind/terrain
 * physics used by live rounds. If no force can reach the opponent at this
 * angle, it returns reachable:false instead of inventing a number.
 */
/**
 * Evaluate one force value with the exact live volley parameters: selected
 * skill offsets, scatter force scale, POW blast radius and per-shell scaling.
 * A shot is only a hit when its actual collision is the target actor, or when
 * it lands on terrain and the real blast formula damages the target.
 */
export function evaluateVolleyForForce({
  shooter,
  target,
  wind,
  terrain,
  angle,
  force,
  skill = null,
  buffs = [],
  angleMin = CONTROLS.angleMin,
  angleMax = CONTROLS.angleMax,
  pow = false,
  cfg = PHYSICS,
  skillDefs = BATTLE.skillDefs,
}) {
  const direction = Math.sign(target.x - shooter.x) || 1;
  const def = skill ? skillDefs[skill] : null;
  const offsets = def?.offsets ?? [0];
  const forceScales = def?.forceScales ?? [def?.forceScale ?? 1];
  const attackPenalty = def?.damageScale ?? 1;
  const damageBonus = buffs.reduce((sum, id) => sum + (skillDefs[id]?.damageBonus ?? 0), 0);
  const damageScale = attackPenalty * (1 + damageBonus);
  const blastCfg = pow ? { ...COMBAT, blastRadius: BATTLE.powBlastRadius } : COMBAT;
  let direct = false;
  let splash = false;
  let closest = Infinity;
  let bestDamage = 0;
  let bestImpact = null;
  let representative = null;

  for (let i = 0; i < offsets.length; i += 1) {
    const offset = offsets[i];
    const elevation = clamp(angle + offset, angleMin, angleMax);
    const muzzle = muzzlePoint(shooter, elevation, direction);
    const result = simulateShot({
      origin: { x: muzzle.x, y: muzzle.y },
      angle: elevation,
      force: force * (forceScales[i] ?? forceScales[0] ?? 1),
      direction,
      wind,
      target,
      terrain,
      cfg,
    });
    closest = Math.min(closest, Number.isFinite(result.closest) ? result.closest : Infinity);
    if (!representative || result.closest < representative.closest) {
      representative = { result, elevation, offset };
    }
    if (result.impact === 'actor') {
      direct = true;
      const blast = blastDamageFor(target, { x: result.x, y: result.y }, shooter, blastCfg);
      bestDamage = Math.max(bestDamage, Math.round(blast.amount * damageScale));
      bestImpact = result.impact;
    } else if (result.impact === 'ground') {
      const blast = blastDamageFor(target, { x: result.x, y: result.y }, shooter, blastCfg);
      const amount = Math.round(blast.amount * damageScale);
      if (amount > 0) {
        splash = true;
        if (amount > bestDamage) {
          bestDamage = amount;
          bestImpact = 'ground';
        }
      }
    }
  }

  return {
    hit: direct || splash,
    hitType: direct ? 'direct' : (splash ? 'splash' : null),
    direct,
    splash,
    damage: bestDamage,
    impact: bestImpact,
    closest,
    result: representative?.result ?? null,
    shells: offsets.length,
  };
}

/**
 * NEW browser-only aid: fixed angle, exact live volley physics, force sweep
 * from minimum to maximum whole-percent values. It does not choose an angle.
 * When a contiguous verified hit interval exists, the returned point is its
 * centre; the point is evaluated again before being returned as reachable.
 */
export function solveForceForAngle({
  shooter,
  target,
  wind,
  terrain,
  angle,
  skill = null,
  buffs = [],
  angleMin = CONTROLS.angleMin,
  angleMax = CONTROLS.angleMax,
  pow = false,
  cfg = PHYSICS,
}) {
  const direction = Math.sign(target.x - shooter.x) || 1;
  const minPct = clamp(Math.ceil(CONTROLS.minFireForce / cfg.forceMax * 100), 1, 100);
  // A 1% sweep costs 100 exact trajectories and blocks the animation frame on
  // phones. Most angles produce a wide hit window, so scan every 2% first and
  // only fall back to the full 1% sweep when the coarse pass misses entirely.
  // The returned point is always evaluated; the band is a verified 2% window.
  const scan = (step) => {
    const out = [];
    for (let pct = minPct; pct <= 100; pct += step) {
      const force = pct / 100 * cfg.forceMax;
      const value = evaluateVolleyForForce({
        shooter, target, wind, terrain, angle, force, skill,
        buffs, angleMin, angleMax, pow, cfg,
      });
      out.push({ pct, force, ...value });
    }
    if (out[out.length - 1]?.pct !== 100) {
      const pct = 100;
      const force = cfg.forceMax;
      const value = evaluateVolleyForForce({
        shooter, target, wind, terrain, angle, force, skill,
        buffs, angleMin, angleMax, pow, cfg,
      });
      out.push({ pct, force, ...value });
    }
    return out;
  };
  let evals = scan(2);
  if (!evals.some((item) => item.hit)) evals = scan(1);

  const runsOf = (hitType) => {
    const runs = [];
    let current = null;
    for (const item of evals) {
      if (item.hitType === hitType) {
        if (!current) current = [];
        current.push(item);
      } else if (current) {
        runs.push(current);
        current = null;
      }
    }
    if (current) runs.push(current);
    return runs;
  };
  const rank = (run) => {
    const maxDamage = Math.max(...run.map((item) => item.damage));
    const span = run.length;
    // Prefer a longer verified window, then the harder hit, then centre closeness.
    return span * 10000 + maxDamage;
  };
  const directRuns = runsOf('direct');
  const splashRuns = runsOf('splash');
  const mode = directRuns.length ? 'direct' : (splashRuns.length ? 'splash' : null);
  const runs = mode === 'direct' ? directRuns : splashRuns;
  if (runs.length) {
    runs.sort((a, b) => rank(b) - rank(a));
    const run = runs[0];
    const minPctWin = run[0].pct;
    const maxPctWin = run[run.length - 1].pct;
    const pct = Math.round((minPctWin + maxPctWin) / 2);
    let chosen = evals.find((item) => item.pct === pct);
    if (!chosen) {
      const force = pct / 100 * cfg.forceMax;
      chosen = {
        pct, force,
        ...evaluateVolleyForForce({
          shooter, target, wind, terrain, angle, force, skill,
          buffs, angleMin, angleMax, pow, cfg,
        }),
      };
    }
    // Never expose a recommendation that was not re-evaluated as a hit.
    if (chosen?.hit) {
      return {
        reachable: true,
        verified: true,
        pct,
        force: chosen.force,
        range: { minPct: minPctWin, maxPct: maxPctWin },
        closest: chosen.closest,
        impact: chosen.impact,
        hitType: chosen.hitType,
        damage: chosen.damage,
        shells: chosen.shells,
        angle,
        direction,
      };
    }
  }

  const best = evals.reduce((a, b) => (b.closest < a.closest ? b : a), evals[0]);
  return {
    reachable: false,
    verified: true,
    force: null,
    pct: null,
    range: null,
    closest: best?.closest ?? Infinity,
    impact: best?.impact ?? null,
    hitType: null,
    angle,
    direction,
  };
}
