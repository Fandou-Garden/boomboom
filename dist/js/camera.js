/**
 * Presentation-only world camera.
 *
 * World coordinates never change here. The camera exposes:
 *   screenX = (worldX - cameraX) * zoom + viewportWidth / 2
 *   screenY = (worldY - cameraY) * zoom + viewportHeight / 2
 *
 * Aim framing always uses one uniform scale. To show both 300 px and 3700 px
 * spawn points, it may zoom below the old cover floor and reveal sky/margin;
 * it never moves the spawn points and never squeezes X/Y independently.
 *
 * UI remains in the DOM outside this transform.
 */
import { WORLD, VIEW } from './config.js?v=22';
import { clamp } from './physics.js?v=22';

export function coverZoom(width, height) {
  return Math.max(1 / WORLD.width, width / WORLD.width, height / WORLD.height);
}

export function baseZoomFor(width, height) {
  const cover = coverZoom(width, height);
  const min = Math.max(cover, VIEW.minZoomFloor);
  const max = Math.max(min, VIEW.maxZoom);
  return clamp(cover * VIEW.baseZoomFactor, Math.max(VIEW.baseZoomMin, min), max);
}

export function zoomLimits(width, height) {
  const cover = coverZoom(width, height);
  const min = Math.max(cover, VIEW.minZoomFloor);
  const max = Math.max(min, VIEW.maxZoom);
  return { min, max, cover };
}

function limitsFor(width, height, allowWide) {
  if (!allowWide) return zoomLimits(width, height);
  const min = Math.max(1 / WORLD.width, VIEW.minZoomWide);
  const max = Math.max(min, VIEW.maxZoom);
  return { min, max, cover: coverZoom(width, height) };
}

export function computeView({
  width,
  height,
  cameraX,
  cameraY,
  zoom,
  allowSky = false,
  allowWide = false,
}) {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const { min, max } = limitsFor(safeW, safeH, allowWide);
  const z = clamp(Number.isFinite(zoom) ? zoom : baseZoomFor(safeW, safeH), min, max);
  const viewW = safeW / z;
  const viewH = safeH / z;

  let cx = Number.isFinite(cameraX) ? cameraX : WORLD.width / 2;
  let cy = Number.isFinite(cameraY) ? cameraY : WORLD.height * 0.68;

  // Wide aim framing can show a sliver beyond the 4000 px map on very narrow
  // phones. Sky and a vignette cover that margin; the alternative would be
  // moving spawns closer or clipping a player, both of which are forbidden.
  if (viewW >= WORLD.width) {
    cx = clamp(cx, -VIEW.skyOverscan, WORLD.width + VIEW.skyOverscan);
  } else {
    cx = clamp(cx, viewW / 2, WORLD.width - viewW / 2);
  }
  if (allowSky || allowWide) {
    cy = clamp(cy, -VIEW.skyOverscan, WORLD.height + VIEW.skyOverscan);
  } else {
    cy = clamp(cy, viewH / 2, WORLD.height - viewH / 2);
  }

  const left = safeW / 2 - cx * z;
  const top = safeH / 2 - cy * z;
  return {
    width: safeW,
    height: safeH,
    topInset: 0,
    bottomInset: 0,
    availH: safeH,
    scale: z,
    zoom: z,
    viewW,
    viewH,
    left,
    top,
    worldLeft: cx - viewW / 2,
    worldTop: cy - viewH / 2,
    cameraX: cx,
    cameraY: cy,
    allowSky,
    allowWide,
  };
}

export function projectPoint(view, x, y) {
  return {
    x: view.left + x * view.zoom,
    y: view.top + y * view.zoom,
  };
}

export function screenToWorld(view, x, y) {
  return {
    x: (x - view.left) / view.zoom,
    y: (y - view.top) / view.zoom,
  };
}

export function fitCamera({ width, height, focusX = WORLD.width / 2, focusY = WORLD.height * 0.7, zoom }) {
  return computeView({
    width,
    height,
    cameraX: focusX,
    cameraY: focusY,
    zoom: zoom ?? baseZoomFor(width, height),
  });
}

/** Critically damped smooth-damp, stable for variable frame rates. */
function smoothDamp(current, velocity, target, smoothTime, dt) {
  const time = Math.max(0.0001, smoothTime);
  const omega = 2 / time;
  const x = omega * Math.max(0, dt);
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * Math.max(0, dt);
  const nextVelocity = (velocity - omega * temp) * exp;
  return {
    value: target + (change + temp) * exp,
    velocity: nextVelocity,
  };
}

export class Camera {
  constructor() {
    this.reset();
  }

  reset() {
    const zoom = baseZoomFor(844, 390);
    this.cameraX = WORLD.width / 2;
    this.cameraY = WORLD.height * 0.68;
    this.zoom = zoom;
    this.velocityX = 0;
    this.velocityY = 0;
    this.velocityZoom = 0;
    this.initialized = false;
    this.mode = VIEW.defaultMode;
    this.manualX = 0;
    this.manualY = 0;
    this.lockedShotZoom = null;
  }

  panBy(dxWorld, dyWorld) {
    if (!Number.isFinite(dxWorld) || !Number.isFinite(dyWorld)) return;
    const limit = 900;
    this.manualX = clamp(this.manualX + dxWorld, -limit, limit);
    this.manualY = clamp(this.manualY + dyWorld, -limit, limit);
  }

  clearPan() {
    this.manualX = 0;
    this.manualY = 0;
  }

  hasManualPan() {
    return Math.abs(this.manualX) > 0.5 || Math.abs(this.manualY) > 0.5;
  }

  _desired({ width, height, mode, shot, actors, activeIndex = 0, focusPoint = null }) {
    const { max } = zoomLimits(width, height);
    const base = baseZoomFor(width, height);
    let targetX = actors?.[0]?.x ?? WORLD.width / 2;
    let targetY = actors?.[0]?.y ?? WORLD.height * 0.7;
    let targetZoom = base;
    let allowSky = false;
    let allowWide = false;

    if (mode === 'shot' && shot) {
      targetZoom = this.lockedShotZoom ?? clamp(base * 0.78, 0.3, 0.62);
      targetX = shot.x + shot.vx * VIEW.shotLookAheadSeconds;
      targetY = shot.y + shot.vy * VIEW.shotLookAheadSeconds;
      allowSky = true;
      allowWide = true;
    } else if (mode === 'both' && actors?.length) {
      const alive = actors.filter((actor) => actor && actor.alive !== false);
      const list = alive.length ? alive : actors;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const actor of list) {
        minX = Math.min(minX, actor.x);
        maxX = Math.max(maxX, actor.x);
        minY = Math.min(minY, actor.y);
        maxY = Math.max(maxY, actor.y);
      }
      const dx = Math.max(1, maxX - minX);
      const dy = Math.max(1, maxY - minY);
      const padX = clamp(width * 0.07, 18, 58);
      const padY = clamp(height * 0.12, 24, 56);
      const fitZoom = Math.min(
        base,
        (width - padX * 2) / (dx + VIEW.bothActorMarginX),
        (height - padY * 2) / (dy + VIEW.bothActorMarginY),
      );
      targetZoom = clamp(fitZoom, VIEW.minZoomWide, max);
      targetX = (minX + maxX) / 2 + (VIEW.bothHudRightBias || 0) / targetZoom;
      const viewHAtTarget = height / targetZoom;
      // Keep the feet/terrain in the lower-middle and preserve throw space.
      // Atlantis has a 133 px spawn-height difference, so lift the framing a
      // little more than before to clear the bottom-right fire cluster.
      targetY = (minY + maxY) / 2 + viewHAtTarget * (VIEW.bothCameraShift ?? -0.06);
      allowSky = true;
      allowWide = targetZoom < Math.max(coverZoom(width, height), VIEW.minZoomFloor);
    } else {
      const actor = actors?.[activeIndex] ?? actors?.[0];
      if (actor) {
        targetX = actor.x + (actor.walkDirection || 0) * 70;
        targetY = actor.y;
      }
      const viewHAtBase = height / base;
      targetY -= (VIEW.focusBottomFraction - 0.5) * viewHAtBase;
      allowSky = true;
    }

    // Manual minimap drag affects only the camera. Flight always clears it so
    // the camera can follow the shell without the HUD moving.
    if (mode !== 'shot') {
      targetX += this.manualX;
      targetY += this.manualY;
    }

    const actualZoom = targetZoom;
    const viewW = width / actualZoom;
    const viewH = height / actualZoom;
    if (viewW < WORLD.width && !allowWide) targetX = clamp(targetX, viewW / 2, WORLD.width - viewW / 2);
    if (viewH < WORLD.height && !allowSky && !allowWide) {
      targetY = clamp(targetY, viewH / 2, WORLD.height - viewH / 2);
    }
    return { targetX, targetY, targetZoom: clamp(targetZoom, VIEW.minZoomWide, max), allowSky, allowWide };
  }

  update({
    width,
    height,
    mode = VIEW.defaultMode,
    shot = null,
    actors = [],
    activeIndex = 0,
    focusPoint = null,
    dt = 1 / 60,
    reducedMotion = false,
  }) {
    if (mode !== this.mode) {
      if (mode === 'shot') {
        const base = baseZoomFor(width, height);
        this.lockedShotZoom = clamp(base * 0.78, 0.3, 0.62);
        this.clearPan();
      }
      this.mode = mode;
    }
    const desired = this._desired({ width, height, mode, shot, actors, activeIndex, focusPoint });
    if (!this.initialized || reducedMotion) {
      this.cameraX = desired.targetX;
      this.cameraY = desired.targetY;
      this.zoom = desired.targetZoom;
      this.velocityX = 0;
      this.velocityY = 0;
      this.velocityZoom = 0;
      this.initialized = true;
    } else {
      const x = smoothDamp(this.cameraX, this.velocityX, desired.targetX, VIEW.smoothTime, dt);
      this.cameraX = x.value;
      this.velocityX = x.velocity;
      const y = smoothDamp(this.cameraY, this.velocityY, desired.targetY, VIEW.smoothTime, dt);
      this.cameraY = y.value;
      this.velocityY = y.velocity;
      const z = smoothDamp(this.zoom, this.velocityZoom, desired.targetZoom, VIEW.zoomSmoothTime, dt);
      this.zoom = z.value;
      this.velocityZoom = z.velocity;
    }
    return computeView({
      width,
      height,
      cameraX: this.cameraX,
      cameraY: this.cameraY,
      zoom: this.zoom,
      allowSky: desired.allowSky,
      allowWide: desired.allowWide,
    });
  }
}
