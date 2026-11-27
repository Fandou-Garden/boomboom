/**
 * Chunked, destructible foreground terrain.
 *
 * Display and collision are two views of the same pixels:
 *   - each 256×256 chunk owns a cached canvas (the visible alpha),
 *   - each chunk owns a Uint8Array mask built from that canvas (A > 100),
 *   - an explosion erases with destination-out, then only the affected chunk
 *     rectangles are read back to refresh the mask.
 *
 * Source rules: Game.Logic/Phy/Maps/Tile.cs treats alpha <= 100 as empty;
 * BaseBomb.DigMap() removes a pre-authored crater shape. The browser keeps an
 * original Gunny crater bitmap as the base and adds seeded lobes.
 */
import { WORLD, TERRAIN } from './config.js?v=22';
import { buildExplosionShape, explosionSeed } from './explosion.js?v=22';

export const SOLID_ALPHA_THRESHOLD = TERRAIN.solidAlphaThreshold;

export function alphaByteToSolid(alpha) {
  return alpha > SOLID_ALPHA_THRESHOLD ? 1 : 0;
}

export function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      // Safari fallback.
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const ASSET_VERSION = '14';

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`图片加载失败：${src}`));
    const url = /^(data:|blob:|https?:)/.test(src) ? src : `${src}${src.includes('?') ? '&' : '?'}v=${ASSET_VERSION}`;
    image.src = url;
  });
}

function imageAlphaBounds(image) {
  const canvas = makeCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = canvas.width;
  let y0 = canvas.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    const row = y * canvas.width * 4;
    for (let x = 0; x < canvas.width; x += 1) {
      if (data[row + x * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function chunkKey(terrain, x, y) {
  return `${terrain.width}:${terrain.height}:${terrain.chunkSize}:${x},${y}`;
}

export class Terrain {
  constructor({
    width,
    height,
    sourceWidth,
    sourceImage,
    deadImage = null,
    chunkSize = TERRAIN.chunkSize,
    craterArt = {},
  }) {
    this.width = width;
    this.height = height;
    this.sourceWidth = sourceWidth ?? Math.floor(width / 2);
    this.mirrorAxis = this.sourceWidth;
    this.chunkSize = chunkSize;
    this.sourceImage = sourceImage;
    this.deadImage = deadImage;
    this.craterArt = craterArt;
    this.cols = Math.ceil(width / chunkSize);
    this.rows = Math.ceil(height / chunkSize);
    this.chunks = [];
    this.dirtyChunks = new Set();
    this.surfaceY = new Int16Array(width);
    this.craters = [];
    this.scratch = makeCanvas(chunkSize, chunkSize);
    this.scratchCtx = this.scratch.getContext('2d', { willReadFrequently: true });
    this._buildChunks();
    this.reset();
  }

  static async load({
    foregroundUrl,
    deadUrl = null,
    chunkSize = TERRAIN.chunkSize,
    width = WORLD.width,
    height = WORLD.height,
    sourceWidth = WORLD.sourceWidth,
    craterArtUrls = {},
  }) {
    const [sourceImage, deadImage] = await Promise.all([
      loadImage(foregroundUrl),
      deadUrl ? loadImage(deadUrl) : Promise.resolve(null),
    ]);
    const craterArt = {};
    await Promise.all(Object.entries(craterArtUrls).map(async ([id, pair]) => {
      const [shape, brink] = await Promise.all([
        loadImage(pair.shape),
        loadImage(pair.brink),
      ]);
      // The Go server carves with a binary alpha>100 mask (Tile.cs rule).
      // Build the same mask once so replayed craters match the server mask.
      const sw = shape.naturalWidth || shape.width;
      const sh = shape.naturalHeight || shape.height;
      const maskCanvas = makeCanvas(sw, sh);
      const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
      mctx.drawImage(shape, 0, 0);
      const src = mctx.getImageData(0, 0, sw, sh);
      for (let i = 3; i < src.data.length; i += 4) {
        const solid = src.data[i] > SOLID_ALPHA_THRESHOLD;
        src.data[i - 3] = 255;
        src.data[i - 2] = 255;
        src.data[i - 1] = 255;
        src.data[i] = solid ? 255 : 0;
      }
      mctx.putImageData(src, 0, 0);
      craterArt[id] = {
        shape,
        brink,
        maskCanvas,
        bbox: imageAlphaBounds(shape),
        brinkBbox: imageAlphaBounds(brink),
      };
    }));
    return new Terrain({
      width,
      height,
      sourceWidth,
      sourceImage,
      deadImage,
      chunkSize,
      craterArt,
    });
  }

  _buildChunks() {
    this.chunks.length = 0;
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const x = col * this.chunkSize;
        const y = row * this.chunkSize;
        const w = Math.min(this.chunkSize, this.width - x);
        const h = Math.min(this.chunkSize, this.height - y);
        const canvas = makeCanvas(w, h);
        const deadCanvas = this.deadImage ? makeCanvas(w, h) : null;
        const holeCanvas = makeCanvas(w, h);
        const chunk = {
          index: row * this.cols + col,
          col,
          row,
          x,
          y,
          w,
          h,
          canvas,
          ctx: canvas.getContext('2d', { willReadFrequently: true }),
          deadCanvas,
          deadCtx: deadCanvas?.getContext('2d', { willReadFrequently: false }) ?? null,
          holeCanvas,
          holeCtx: holeCanvas.getContext('2d', { willReadFrequently: true }),
          mask: new Uint8Array(w * h),
        };
        this.chunks.push(chunk);
      }
    }
    this.chunksByRow = Array.from({ length: this.rows }, () => []);
    for (const chunk of this.chunks) this.chunksByRow[chunk.row].push(chunk);
  }

  reset() {
    for (const chunk of this.chunks) this._rebuildChunk(chunk);
    this._rebuildSurface();
    this.craters.length = 0;
    this.dirtyChunks.clear();
  }

  _drawSourceComposition(ctx, width, height) {
    // SOURCE map 1156 already fills the world width. Only legacy widened
    // compositions need the mirrored second copy; drawing it at width=source
    // would overwrite the original with a mirror image.
    ctx.drawImage(this.sourceImage, 0, 0);
    if (this.width > this.sourceWidth) {
      ctx.save();
      ctx.translate(this.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.sourceImage, 0, 0);
      ctx.restore();
    }
  }

  _rebuildChunk(chunk) {
    const ctx = chunk.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, chunk.w, chunk.h);
    ctx.save();
    ctx.translate(-chunk.x, -chunk.y);
    this._drawSourceComposition(ctx, this.width, this.height);
    ctx.restore();

    if (chunk.deadCtx && this.deadImage) {
      const dctx = chunk.deadCtx;
      dctx.setTransform(1, 0, 0, 1, 0, 0);
      dctx.clearRect(0, 0, chunk.w, chunk.h);
      dctx.save();
      dctx.translate(-chunk.x, -chunk.y);
      dctx.drawImage(this.deadImage, 0, 0);
      dctx.save();
      dctx.translate(this.width, 0);
      dctx.scale(-1, 1);
      dctx.drawImage(this.deadImage, 0, 0);
      dctx.restore();
      dctx.restore();
    }

    const holeCtx = chunk.holeCtx;
    holeCtx.setTransform(1, 0, 0, 1, 0, 0);
    holeCtx.clearRect(0, 0, chunk.w, chunk.h);

    const data = ctx.getImageData(0, 0, chunk.w, chunk.h).data;
    for (let i = 0, p = 3; i < chunk.mask.length; i += 1, p += 4) {
      chunk.mask[i] = data[p] > SOLID_ALPHA_THRESHOLD ? 1 : 0;
    }
  }

  _rebuildSurface() {
    this.surfaceY.fill(this.height);
    for (const chunk of this.chunks) {
      for (let lx = 0; lx < chunk.w; lx += 1) {
        for (let ly = 0; ly < chunk.h; ly += 1) {
          if (chunk.mask[ly * chunk.w + lx]) {
            const wx = chunk.x + lx;
            const wy = chunk.y + ly;
            if (wy < this.surfaceY[wx]) this.surfaceY[wx] = wy;
            break;
          }
        }
      }
    }
  }

  _chunkAt(x, y) {
    const col = Math.floor(x / this.chunkSize);
    const row = Math.floor(y / this.chunkSize);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return null;
    return this.chunks[row * this.cols + col] ?? null;
  }

  isSolid(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return false;
    const chunk = this._chunkAt(ix, iy);
    if (!chunk) return false;
    const lx = ix - chunk.x;
    const ly = iy - chunk.y;
    return chunk.mask[ly * chunk.w + lx] === 1;
  }

  /** Conservative 6×6-style BombObject rectangle check. */
  isSolidRect(x, y, width, height) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.floor(x + width - 1);
    const y1 = Math.floor(y + height - 1);
    const step = Math.max(1, Math.floor(Math.min(width, height) / 2));
    for (let py = y0; py <= y1; py += step) {
      for (let px = x0; px <= x1; px += step) {
        if (this.isSolid(px, py)) return true;
      }
    }
    return this.isSolid(x1, y1) || this.isSolid(x0, y1) || this.isSolid(x1, y0);
  }

  /** Projectile probe: center + eight perimeter samples, not a single pixel. */
  isSolidCircle(x, y, radius = 2.5) {
    if (this.isSolid(x, y)) return true;
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      if (this.isSolid(x + Math.cos(a) * radius, y + Math.sin(a) * radius)) return true;
    }
    return false;
  }

  alphaAt(x, y) {
    const chunk = this._chunkAt(Math.floor(x), Math.floor(y));
    if (!chunk) return 0;
    const lx = Math.floor(x) - chunk.x;
    const ly = Math.floor(y) - chunk.y;
    return chunk.ctx.getImageData(lx, ly, 1, 1).data[3];
  }

  /** Test/diagnostic only: read the pixels actually drawn for a chunk. */
  displayAlphaAt(x, y) {
    const chunk = this._chunkAt(Math.floor(x), Math.floor(y));
    if (!chunk) return 0;
    const lx = Math.floor(x) - chunk.x;
    const ly = Math.floor(y) - chunk.y;
    return chunk.ctx.getImageData(lx, ly, 1, 1).data[3];
  }

  /** FNV-1a over every collision byte. Used to prove reset/state equality. */
  maskHash() {
    let hash = 0x811c9dc5;
    for (const chunk of this.chunks) {
      for (let i = 0; i < chunk.mask.length; i += 1) {
        hash ^= chunk.mask[i];
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
    }
    return hash >>> 0;
  }

  /** Full local consistency check for tests; never called by the frame loop. */
  verifyDisplaySync() {
    let checked = 0;
    let mismatches = 0;
    for (const chunk of this.chunks) {
      const data = chunk.ctx.getImageData(0, 0, chunk.w, chunk.h).data;
      for (let i = 0, p = 3; i < chunk.mask.length; i += 1, p += 4) {
        checked += 1;
        if (chunk.mask[i] !== (data[p] > SOLID_ALPHA_THRESHOLD ? 1 : 0)) mismatches += 1;
      }
    }
    return { checked, mismatches };
  }

  info() {
    let solid = 0;
    for (const chunk of this.chunks) {
      for (let i = 0; i < chunk.mask.length; i += 1) solid += chunk.mask[i];
    }
    return {
      width: this.width,
      height: this.height,
      chunkSize: this.chunkSize,
      cols: this.cols,
      rows: this.rows,
      chunks: this.chunks.length,
      dirtyChunks: this.dirtyChunks.size,
      craters: this.craters.length,
      solidPixels: solid,
      sourceWidth: this.sourceWidth,
    };
  }

  surfaceAt(x) {
    const ix = Math.floor(x);
    if (ix < 0 || ix >= this.width) return null;
    const y = this.surfaceY[ix];
    return y >= this.height ? null : y;
  }

  findGroundY(x, fromY = 0, toY = this.height - 1) {
    const ix = Math.floor(x);
    if (ix < 0 || ix >= this.width) return null;
    const start = Math.max(0, Math.floor(fromY));
    const end = Math.min(this.height - 1, Math.floor(toY));
    for (let y = start; y <= end; y += 1) {
      if (this.isSolid(ix, y)) return y;
    }
    return null;
  }

  /**
   * SOURCE-inspired: PhysicalObj.calcObjectAngle(16) averages the first empty
   * pixels within ±10 px of the actor, on both sides, then returns the slope
   * between the left and right averages.
   */
  slopeAt(x, y, maxDegrees = 22) {
    let leftSum = 0;
    let rightSum = 0;
    let leftCount = 0;
    let rightCount = 0;
    for (let offset = 2; offset <= 16; offset += 2) {
      const left = this.findGroundY(x - offset, y - 10, y + 10);
      if (left != null) { leftSum += left; leftCount += 1; }
      const right = this.findGroundY(x + offset, y - 10, y + 10);
      if (right != null) { rightSum += right; rightCount += 1; }
    }
    if (!leftCount || !rightCount) return 0;
    const leftY = leftSum / leftCount;
    const rightY = rightSum / rightCount;
    const angle = Math.atan2(rightY - leftY, 16) * 180 / Math.PI;
    return Math.max(-maxDegrees, Math.min(maxDegrees, angle));
  }

  canStandAt(x, groundY) {
    return this.isSolid(x - 10, groundY) || this.isSolid(x + 10, groundY);
  }

  _artFor(kind, radius) {
    const template = TERRAIN.craterTemplates[kind] ?? TERRAIN.craterTemplates.medium;
    const art = this.craterArt[template.art] ?? Object.values(this.craterArt)[0] ?? null;
    return { template, art, radius: radius ?? template.radius };
  }

  _affectedChunks(x0, y0, x1, y1) {
    const col0 = Math.max(0, Math.floor(x0 / this.chunkSize));
    const col1 = Math.min(this.cols - 1, Math.floor(x1 / this.chunkSize));
    const row0 = Math.max(0, Math.floor(y0 / this.chunkSize));
    const row1 = Math.min(this.rows - 1, Math.floor(y1 / this.chunkSize));
    const out = [];
    for (let row = row0; row <= row1; row += 1) {
      for (let col = col0; col <= col1; col += 1) out.push(this.chunks[row * this.cols + col]);
    }
    return out;
  }

  /**
   * Remove terrain and refresh only affected chunks.
   * The original crater bitmap supplies the base silhouette; seeded lobes and
   * core circles are unioned with it. Backing fill is clipped to the terrain
   * alpha that existed before the cut, so an explosion in open air cannot
   * create a free-standing dark circle.
   */
  carve(cx, cy, options = {}) {
    const kind = options.kind ?? 'medium';
    const { template, art, radius } = this._artFor(kind, options.radius);
    if (!art) return { removed: 0, chunks: 0, bounds: null };
    const seed = options.seed ?? explosionSeed({
      x: cx,
      y: cy,
      radius,
      owner: options.owner ?? 0,
      weapon: options.weapon ?? '70322',
      angle: options.angle ?? 0,
      force: options.force ?? 0,
      kind,
    });
    const shape = buildExplosionShape({
      x: cx,
      y: cy,
      radius,
      seed,
      lobes: options.lobes ?? template.lobes,
      depth: options.depth ?? template.depth,
      velocityX: options.velocityX ?? 0,
      velocityY: options.velocityY ?? 0,
    });
    const bbox = art.bbox;
    const targetShapeWidth = radius * 2.18;
    const scale = targetShapeWidth / Math.max(1, bbox.w);
    const drawW = art.shape.width * scale;
    const drawH = art.shape.height * scale;
    const drawX = cx - (bbox.x + bbox.w / 2) * scale;
    const drawY = cy - (bbox.y + bbox.h / 2) * scale;
    const brinkScale = scale * 1.16;
    const brinkW = art.brink.width * brinkScale;
    const brinkH = art.brink.height * brinkScale;
    const bx = cx - (art.brinkBbox.x + art.brinkBbox.w / 2) * brinkScale;
    const by = cy - (art.brinkBbox.y + art.brinkBbox.h / 2) * brinkScale;

    let x0 = Math.min(shape.bounds.x0, drawX);
    let y0 = Math.min(shape.bounds.y0, drawY);
    let x1 = Math.max(shape.bounds.x1, drawX + drawW);
    let y1 = Math.max(shape.bounds.y1, drawY + drawH);
    for (const c of shape.circles) {
      x0 = Math.min(x0, cx + c.dx - c.r);
      y0 = Math.min(y0, cy + c.dy - c.r);
      x1 = Math.max(x1, cx + c.dx + c.r);
      y1 = Math.max(y1, cy + c.dy + c.r);
    }
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(this.width - 1, Math.ceil(x1));
    y1 = Math.min(this.height - 1, Math.ceil(y1));
    if (x1 < x0 || y1 < y0) return { removed: 0, chunks: 0, bounds: null };

    const affected = this._affectedChunks(x0, y0, x1, y1);
    if (!affected.length) return { removed: 0, chunks: 0, bounds: null };

    // An air burst that has no solid pixel in its bounding box must not even
    // dirty a chunk. This is the common case for shots exploding above ground.
    let hasTerrain = false;
    for (const chunk of affected) {
      const lx0 = Math.max(0, x0 - chunk.x);
      const ly0 = Math.max(0, y0 - chunk.y);
      const lx1 = Math.min(chunk.w - 1, x1 - chunk.x);
      const ly1 = Math.min(chunk.h - 1, y1 - chunk.y);
      for (let y = ly0; y <= ly1 && !hasTerrain; y += 1) {
        const row = y * chunk.w;
        for (let x = lx0; x <= lx1; x += 1) {
          if (chunk.mask[row + x]) { hasTerrain = true; break; }
        }
      }
      if (hasTerrain) break;
    }
    if (!hasTerrain) return { removed: 0, chunks: 0, bounds: null };

    for (const chunk of affected) {
      const tctx = chunk.ctx;
      // Scorch the existing edge with the original craterbrink art.
      tctx.save();
      tctx.translate(-chunk.x, -chunk.y);
      tctx.globalCompositeOperation = 'source-atop';
      tctx.globalAlpha = 0.58;
      tctx.drawImage(art.brink, bx, by, brinkW, brinkH);
      tctx.globalAlpha = 1;
      tctx.restore();

      // Build a dark crater backing clipped to the terrain that existed just
      // before this explosion. Reuses one scratch canvas for every chunk.
      const sctx = this.scratchCtx;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.globalCompositeOperation = 'source-over';
      sctx.clearRect(0, 0, this.scratch.width, this.scratch.height);
      sctx.save();
      sctx.translate(-chunk.x, -chunk.y);
      sctx.drawImage(art.shape, drawX, drawY, drawW, drawH);
      sctx.fillStyle = '#2b1912';
      for (const c of shape.circles) {
        sctx.beginPath();
        sctx.arc(cx + c.dx, cy + c.dy, c.r, 0, Math.PI * 2);
        sctx.fill();
      }
      sctx.restore();
      sctx.globalCompositeOperation = 'source-in';
      const grad = sctx.createRadialGradient(
        cx - chunk.x, cy - chunk.y, radius * 0.12,
        cx - chunk.x, cy - chunk.y, radius * 1.15,
      );
      grad.addColorStop(0, 'rgba(20, 10, 7, 0.98)');
      grad.addColorStop(0.62, 'rgba(51, 29, 18, 0.95)');
      grad.addColorStop(1, 'rgba(87, 52, 29, 0.82)');
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, chunk.w, chunk.h);
      sctx.globalCompositeOperation = 'destination-in';
      sctx.drawImage(chunk.canvas, 0, 0);
      sctx.globalCompositeOperation = 'source-over';
      chunk.holeCtx.drawImage(this.scratch, 0, 0);

      // Actual cut. destination-out keeps the authored bitmap's antialiased
      // edge; the mask is refreshed from these pixels below. Clipped above the
      // source bedrock floor so the arena bottom can never be dug through.
      tctx.save();
      tctx.translate(-chunk.x, -chunk.y);
      tctx.beginPath();
      tctx.rect(x0, y0, x1 - x0 + 1, Math.min(y1, WORLD.bedrockY - 1) - y0 + 1);
      tctx.clip();
      tctx.globalCompositeOperation = 'destination-out';
      tctx.drawImage(art.shape, drawX, drawY, drawW, drawH);
      for (const c of shape.circles) {
        tctx.beginPath();
        tctx.arc(cx + c.dx, cy + c.dy, c.r, 0, Math.PI * 2);
        tctx.fill();
      }
      tctx.restore();
    }

    // Refresh collision only inside the local chunk rectangles.
    let removed = 0;
    for (const chunk of affected) {
      const lx0 = Math.max(0, x0 - chunk.x);
      const ly0 = Math.max(0, y0 - chunk.y);
      const lx1 = Math.min(chunk.w - 1, x1 - chunk.x);
      const ly1 = Math.min(chunk.h - 1, y1 - chunk.y);
      if (lx1 < lx0 || ly1 < ly0) continue;
      const w = lx1 - lx0 + 1;
      const h = ly1 - ly0 + 1;
      const data = chunk.ctx.getImageData(lx0, ly0, w, h).data;
      let changed = false;
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const idx = (ly0 + y) * chunk.w + (lx0 + x);
          const next = data[(y * w + x) * 4 + 3] > SOLID_ALPHA_THRESHOLD ? 1 : 0;
          if (chunk.mask[idx] !== next) changed = true;
          if (chunk.mask[idx] && !next) removed += 1;
          chunk.mask[idx] = next;
        }
      }
      chunk.holeCtx.globalCompositeOperation = 'source-over';
      if (changed) this.dirtyChunks.add(chunk.index);
    }

    // Topmost solid can only move downward after a cut.
    for (let x = x0; x <= x1; x += 1) {
      let y = Math.max(0, this.surfaceY[x]);
      while (y < this.height && !this.isSolid(x, y)) y += 1;
      this.surfaceY[x] = y < this.height ? y : this.height;
    }

    const record = {
      x: cx,
      y: cy,
      radius,
      kind,
      seed,
      artId: template.art,
      removed,
      bounds: { x0, y0, x1, y1 },
      circles: shape.circles,
    };
    // An air burst that touched no terrain is not a crater.
    if (removed > 0) {
      this.craters.push(record);
      if (this.craters.length > TERRAIN.maxCraters) this.craters.shift();
    }
    return { removed, chunks: affected.length, bounds: record.bounds, record };
  }

  /**
   * SOURCE-exact replay of one server crater: center the original bitmap,
   * remove only pixels whose alpha is >100, then refresh the local mask.
   * No procedural lobes or dark fill are added.
   */
  carveSource(cx, cy, artId, kind = 'medium') {
    const art = this.craterArt[artId];
    if (!art?.maskCanvas) return { removed: 0, bounds: null };
    const mask = art.maskCanvas;
    const w = mask.width;
    const h = mask.height;
    const x0 = Math.trunc(cx - w / 2);
    const y0 = Math.trunc(cy - h / 2);
    const x1 = x0 + w - 1;
    const y1 = y0 + h - 1;
    const affected = this._affectedChunks(x0, y0, x1, y1);
    if (!affected.length) return { removed: 0, bounds: null };
    // Protect the source bedrock floor: clip the erase to rows above bedrockY.
    const cutBottom = Math.min(y1, WORLD.bedrockY - 1);
    for (const chunk of affected) {
      const ctx = chunk.ctx;
      ctx.save();
      ctx.translate(-chunk.x, -chunk.y);
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0 + 1, cutBottom - y0 + 1);
      ctx.clip();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(mask, x0, y0);
      ctx.restore();
    }
    let removed = 0;
    for (const chunk of affected) {
      const lx0 = Math.max(0, x0 - chunk.x);
      const ly0 = Math.max(0, y0 - chunk.y);
      const lx1 = Math.min(chunk.w - 1, x1 - chunk.x);
      const ly1 = Math.min(chunk.h - 1, cutBottom - chunk.y);
      if (lx1 < lx0 || ly1 < ly0) continue;
      const rw = lx1 - lx0 + 1;
      const rh = ly1 - ly0 + 1;
      const data = chunk.ctx.getImageData(lx0, ly0, rw, rh).data;
      for (let y = 0; y < rh; y += 1) {
        for (let x = 0; x < rw; x += 1) {
          const idx = (ly0 + y) * chunk.w + (lx0 + x);
          const next = data[(y * rw + x) * 4 + 3] > SOLID_ALPHA_THRESHOLD ? 1 : 0;
          if (chunk.mask[idx] && !next) removed += 1;
          chunk.mask[idx] = next;
        }
      }
      this.dirtyChunks.add(chunk.index);
    }
    for (let x = Math.max(0, x0); x <= Math.min(this.width - 1, x1); x += 1) {
      let y = Math.max(0, this.surfaceY[x]);
      while (y < this.height && !this.isSolid(x, y)) y += 1;
      this.surfaceY[x] = y < this.height ? y : this.height;
    }
    if (removed > 0) {
      this.craters.push({ x: cx, y: cy, artId, kind, removed, bounds: { x0, y0, x1, y1 } });
    }
    return { removed, bounds: { x0, y0, x1, y1 } };
  }

  drawDead(ctx, view) {
    if (!this.deadImage) return;
    const x0 = Math.max(0, Math.floor(view.worldLeft));
    const x1 = Math.min(this.width, Math.ceil(view.worldLeft + view.viewW));
    const y0 = Math.max(0, Math.floor(view.worldTop));
    const y1 = Math.min(this.height, Math.ceil(view.worldTop + view.viewH));
    for (const chunk of this.chunks) {
      if (chunk.x + chunk.w < x0 || chunk.x > x1 || chunk.y + chunk.h < y0 || chunk.y > y1) continue;
      ctx.drawImage(chunk.deadCanvas, chunk.x, chunk.y);
    }
  }

  draw(ctx, view) {
    const x0 = Math.max(0, Math.floor(view.worldLeft));
    const x1 = Math.min(this.width, Math.ceil(view.worldLeft + view.viewW));
    const y0 = Math.max(0, Math.floor(view.worldTop));
    const y1 = Math.min(this.height, Math.ceil(view.worldTop + view.viewH));
    const visible = [];
    for (const chunk of this.chunks) {
      if (chunk.x + chunk.w < x0 || chunk.x > x1 || chunk.y + chunk.h < y0 || chunk.y > y1) continue;
      visible.push(chunk);
    }
    // Hole backing first, then all foreground pixels, so overlapping chunks
    // cannot paint terrain over a neighbouring crater backing.
    for (const chunk of visible) ctx.drawImage(chunk.holeCanvas, chunk.x, chunk.y);
    for (const chunk of visible) ctx.drawImage(chunk.canvas, chunk.x, chunk.y);
  }

  dispose() {
    for (const chunk of this.chunks) {
      chunk.canvas.width = 1;
      chunk.canvas.height = 1;
      chunk.holeCanvas.width = 1;
      chunk.holeCanvas.height = 1;
      if (chunk.deadCanvas) {
        chunk.deadCanvas.width = 1;
        chunk.deadCanvas.height = 1;
      }
    }
    this.chunks.length = 0;
    this.dirtyChunks.clear();
    this.craters.length = 0;
    this.scratch.width = 1;
    this.scratch.height = 1;
    this.sourceImage = null;
    this.deadImage = null;
    this.craterArt = {};
  }
}
