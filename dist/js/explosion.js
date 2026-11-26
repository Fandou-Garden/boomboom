/**
 * Deterministic crater shaping.
 *
 * The source client digs with a pre-authored crater bitmap (BaseBomb._shape).
 * The browser keeps an original Gunny crater bitmap as the base alpha shape,
 * then adds a few seeded lobes so two shots at the same point do not look like
 * a rubber-stamped circle. All randomness is derived from the shot parameters,
 * never from Math.random(), so the same impact always produces the same hole.
 */

export function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function explosionSeed({
  x, y, radius, owner = 0, weapon = '70322', angle = 0, force = 0, kind = 'medium',
}) {
  const payload = [
    kind,
    owner,
    weapon,
    radius.toFixed(2),
    x.toFixed(2),
    y.toFixed(2),
    Number(angle).toFixed(1),
    Number(force).toFixed(1),
  ].join('|');
  return fnv1a32(payload);
}

/** Small, fast PRNG with a stable sequence for a 32-bit seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the extra cut circles around the original crater bitmap.
 * `depth` > 1 pushes the core downward (ground impact) and `velocityY` can
 * bias the deepest cut along the projectile direction.
 */
export function buildExplosionShape({
  x, y, radius, seed, lobes = 5, depth = 1, velocityX = 0, velocityY = 0,
}) {
  const random = mulberry32(seed);
  const lobeCount = Math.max(0, Math.min(9, Math.round(lobes)));
  const circles = [];
  const downBias = depth > 1 ? Math.min(radius * 0.22, radius * (depth - 1) * 0.2) : 0;
  const travel = Math.hypot(velocityX, velocityY) || 1;
  const biasX = Math.max(-0.28, Math.min(0.28, velocityX / travel)) * radius * 0.1;
  const biasY = Math.max(-0.2, Math.min(0.35, velocityY / travel)) * radius * 0.1 + downBias;

  for (let i = 0; i < lobeCount; i += 1) {
    const baseAngle = (i / Math.max(1, lobeCount)) * Math.PI * 2;
    const angle = baseAngle + (random() - 0.5) * 0.55;
    const distance = radius * (0.58 + random() * 0.28);
    const r = radius * (0.13 + random() * 0.17) * (0.75 + depth * 0.25);
    circles.push({
      dx: Math.cos(angle) * distance + biasX,
      dy: Math.sin(angle) * distance * (0.72 + random() * 0.18) + biasY,
      r,
      role: 'lobe',
    });
  }

  const coreCount = depth > 1.2 ? 3 : 2;
  for (let i = 0; i < coreCount; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = radius * random() * 0.16;
    circles.push({
      dx: Math.cos(angle) * distance + biasX * 0.5,
      dy: Math.sin(angle) * distance + biasY * 1.35,
      r: radius * (0.36 + random() * 0.18),
      role: 'core',
    });
  }

  const extent = radius * 1.38 + Math.max(0, downBias);
  return {
    x, y, radius, seed, depth, downBias,
    circles,
    bounds: {
      x0: x - extent,
      y0: y - extent,
      x1: x + extent,
      y1: y + extent + downBias,
    },
  };
}
