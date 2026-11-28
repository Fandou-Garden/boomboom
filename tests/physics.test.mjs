import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EulerVector,
  accelerationFor,
  blastDamageFor,
  isProjectileOut,
  launchVector,
  nextWind,
  segmentTerrainHit,
  simulateShot,
  sourceDamage,
  stepProjectileWithCollision,
} from '../dist/js/physics.js';
import { COMBAT, PHYSICS, WIND, WORLD } from '../dist/js/config.js';
import { Camera, computeView, fitCamera, projectPoint } from '../dist/js/camera.js';
import { buildExplosionShape, explosionSeed } from '../dist/js/explosion.js';

class FlatTerrain {
  constructor(ground = 1000) {
    this.ground = ground;
  }

  isSolid(_x, y) {
    return y >= this.ground;
  }

  isSolidCircle(x, y, radius = 2.5) {
    return this.isSolid(x, y) || this.isSolid(x, y + radius) || this.isSolid(x, y - radius);
  }

  isSolidRect(_x, y, _w, h) {
    return y + h >= this.ground;
  }
}

class ThinWallTerrain {
  isSolid(_x, y) {
    return y >= 1000 && y <= 1002;
  }

  isSolidCircle(x, y, radius = 2.5) {
    return this.isSolid(x, y) || this.isSolid(x, y + radius) || this.isSolid(x, y - radius);
  }
}

test('EulerVector.ComputeOneEulerStep follows the C# integration order', () => {
  const v = new EulerVector(0, 0, 0);
  v.computeOneEulerStep(2, 0.1, 4, 0.5);
  assert.equal(v.x2, 2);
  assert.equal(v.x1, 1);
  assert.equal(v.x0, 0.5);
});

test('acceleration uses (F - drag*v)/mass with gravity=mass*Weight', () => {
  const a = accelerationFor(0, 0, 2);
  assert.ok(Math.abs(a.ax - 2 * PHYSICS.windFactor / PHYSICS.mass) < 1e-12);
  assert.ok(Math.abs(a.ay - 700) < 1e-9);
  const moving = accelerationFor(100, 100, 0);
  assert.ok(moving.ax < a.ax);
  assert.ok(moving.ay < a.ay);
});

test('launch speed is force * cos/sin(angle), with screen-down Y inverted', () => {
  const v = launchVector(2000, 45, 1);
  assert.ok(Math.abs(v.vx - 1414.213562373095) < 1e-9);
  assert.ok(Math.abs(v.vy + 1414.213562373095) < 1e-9);
  const left = launchVector(2000, 45, -1);
  assert.ok(left.vx < 0);
  assert.ok(left.vy < 0);
});

test('GetNextWind preserves the source steps and the old-num comparison', () => {
  assert.deepEqual(nextWind(1.5, 0.2, () => 0.5), { wind: 1.0, target: 0.2 });
  assert.deepEqual(nextWind(-0.5, 1.2, () => 0), { wind: -0.5, target: 1.2 });
  assert.deepEqual(nextWind(0, 0, () => 0), { wind: 0, target: WIND.targetMin });
});

test('same shot drifts downwind: headwind lands left of tailwind', () => {
  const terrain = new FlatTerrain();
  const common = {
    origin: { x: 400, y: 945 },
    angle: 42,
    force: 900,
    direction: 1,
    target: { x: 1600, y: 1000, hp: 1000 },
    terrain,
    maxSeconds: 5,
  };
  const head = simulateShot({ ...common, wind: -4 });
  const none = simulateShot({ ...common, wind: 0 });
  const tail = simulateShot({ ...common, wind: 4 });
  assert.equal(head.impact, 'ground');
  assert.equal(tail.impact, 'ground');
  assert.ok(head.x < none.x, `${head.x} < ${none.x}`);
  assert.ok(none.x < tail.x, `${none.x} < ${tail.x}`);
  assert.ok(tail.x - head.x > 150, `drift ${tail.x - head.x}`);
});

test('interpolated ground collision never leaves the projectile inside terrain', () => {
  const terrain = new FlatTerrain();
  const r = simulateShot({
    origin: { x: 400, y: 945 }, angle: 20, force: 900, direction: 1, wind: 0,
    target: { x: 1600, y: 1000, hp: 1000 }, terrain, maxSeconds: 5,
  });
  assert.equal(r.impact, 'ground');
  assert.ok(r.y < 1000, `collision recorded above ground: ${r.y}`);
});

test('continuous sweep catches a 3 px wall instead of tunnelling through it', () => {
  const terrain = new ThinWallTerrain();
  const hit = segmentTerrainHit(0, 900, 200, 1200, terrain, 2, 2.5);
  assert.ok(hit, 'expected a terrain hit');
  assert.ok(hit.y >= 995 && hit.y <= 1005, `hit y ${hit.y}`);

  const projectile = {
    x: 0, y: 980, prevX: 0, prevY: 980, vx: 5000, vy: 1200,
    age: 0.1, alive: true, impact: null, owner: 0, direction: 1,
  };
  stepProjectileWithCollision(projectile, null, terrain, 0, PHYSICS);
  assert.equal(projectile.impact, 'ground');
  assert.ok(projectile.y >= 995 && projectile.y <= 1010, `impact y ${projectile.y}`);
});

test('world bounds follow the source 1843×1020 Atlantis map', () => {
  assert.equal(isProjectileOut(WORLD.width + 61, 500), true);
  assert.equal(isProjectileOut(WORLD.width - 100, 500), false);
  assert.equal(isProjectileOut(500, WORLD.height + 81), true);
  assert.equal(isProjectileOut(500, -WORLD.height), false);
});

test('SimpleBomb.MakeDamage falloff and edge behavior', () => {
  const pointBlank = sourceDamage(0, COMBAT.blastRadius);
  const halfway = sourceDamage(COMBAT.blastRadius / 2, COMBAT.blastRadius);
  assert.equal(pointBlank, 340);
  assert.ok(pointBlank > halfway);
  assert.ok(halfway > 0);
  assert.equal(sourceDamage(COMBAT.blastRadius, COMBAT.blastRadius), 0);
  assert.equal(sourceDamage(COMBAT.blastRadius + 1, COMBAT.blastRadius), 0);

  const target = { x: 1000, y: 1000, hp: 1000 };
  const direct = blastDamageFor(target, { x: 1000, y: 962 }, target, COMBAT);
  const edge = blastDamageFor(target, { x: 1000 + COMBAT.blastRadius - 0.1, y: 962 }, target, COMBAT);
  assert.equal(direct.amount, pointBlank);
  assert.ok(edge.amount >= 1);
  assert.ok(direct.amount > edge.amount);
});

test('seeded crater shape is reproducible and spans multiple lobes', () => {
  const seed = explosionSeed({ x: 1200, y: 1300, radius: 58, owner: 0, angle: 42, force: 980, kind: 'medium' });
  const a = buildExplosionShape({ x: 1200, y: 1300, radius: 58, seed, lobes: 5, depth: 1 });
  const b = buildExplosionShape({ x: 1200, y: 1300, radius: 58, seed, lobes: 5, depth: 1 });
  assert.deepEqual(a, b);
  assert.equal(a.circles.filter((c) => c.role === 'lobe').length, 5);
  assert.ok(a.circles.every((c) => c.r > 0));
  const other = explosionSeed({ x: 1201, y: 1300, radius: 58, owner: 0, angle: 42, force: 980, kind: 'medium' });
  assert.notEqual(seed, other);
  assert.ok(a.bounds.x1 - a.bounds.x0 > 100);
  assert.ok(a.bounds.y1 - a.bounds.y0 > 100);
});

test('world camera keeps the viewport inside the source 1843×1020 Atlantis map', () => {
  const view = fitCamera({ width: 844, height: 390, focusX: 240, focusY: 389 });
  assert.ok(view.zoom >= 844 / WORLD.width - 1e-9);
  assert.ok(view.zoom >= 390 / WORLD.height - 1e-9);
  assert.equal(view.topInset, 0);
  assert.equal(view.bottomInset, 0);
  assert.ok(view.worldLeft >= 0);
  assert.ok(view.worldTop >= 0);
  assert.ok(view.worldLeft + view.viewW <= WORLD.width + 1e-6);
  assert.ok(view.worldTop + view.viewH <= WORLD.height + 1e-6);
  const p = projectPoint(view, 240, 389);
  assert.ok(p.x > 0 && p.x < view.width);
  assert.ok(p.y > 0 && p.y < view.height);
});

test('camera clamps at world edges and smooths instead of jumping', () => {
  const actors = [
    { x: 240, y: 389, alive: true, walkDirection: 1, facing: 1 },
    { x: 1640, y: 522, alive: true, walkDirection: 0, facing: -1 },
  ];
  const camera = new Camera();
  const first = camera.update({ width: 844, height: 390, mode: 'player', actors, activeIndex: 0, dt: 1 / 60 });
  assert.ok(first.cameraX < 900);
  actors[0].x = 1400;
  actors[0].walkDirection = 1;
  const second = camera.update({ width: 844, height: 390, mode: 'player', actors, activeIndex: 0, dt: 1 / 60 });
  assert.ok(second.cameraX > first.cameraX);
  assert.ok(second.cameraX < 1400, 'camera must ease toward the target');
  const left = computeView({ width: 844, height: 390, cameraX: -9999, cameraY: -9999, zoom: first.zoom });
  assert.ok(left.worldLeft >= -1e-6);
  assert.ok(left.worldTop >= -1e-6);
});

test('shot mode follows the shell with bounded sky and wide overscan', () => {
  const camera = new Camera();
  const actors = [
    { x: 240, y: 389, alive: true },
    { x: 1500, y: 522, alive: true },
  ];
  const view = camera.update({
    width: 844, height: 390, mode: 'shot', actors, activeIndex: 0,
    shot: { x: 900, y: 100, vx: 900, vy: -300 }, dt: 0.016,
  });
  assert.equal(view.allowSky, true, '飞弹视角允许天空 overscan');
  assert.ok(view.worldTop < 0);

  // 依据（2026-11-28 实测）：v33 起 shot 模式使用独立的 lockedShotZoom
  // （本例 zoom=0.4465、viewW=1890.26 > WORLD.width=1843），
  // camera.js 的 _desired() 明确设置 allowWide=true，让镜头跟随飞弹时
  // 不被地图边界夹住。旧断言 worldLeft+viewW <= WORLD.width 与该设计冲突，
  // 属过时期望；改为约束 overscan 有界，并保留「锁人与缩放独立、不放大地图」。
  assert.equal(view.allowWide, true, '飞弹视角允许横向宽视野');
  assert.ok(view.worldLeft >= 0, '左边界不得越出世界');
  assert.ok(view.viewW <= WORLD.width * 1.2, '视野宽度不得远超地图，不能把地图放得过大');
  assert.ok(view.worldLeft + view.viewW <= WORLD.width * 1.2 + 1e-6,
    '横向 overscan 必须有限，不能无限露出地图外');
  assert.ok(view.zoom < 1, 'shot 模式为缩小视野，不是锁人放大');
});
