/**
 * Pure-JS port of server/game/terrain.go.
 *
 * The map file is [int32 LE width][int32 LE height][MSB-first row bytes],
 * exactly the format read by Game.Logic/Phy/Maps/Tile.cs (and note: the header
 * really is LITTLE-endian — dist/data/1156.fore.map starts 33 07 00 00 fc 03).
 * Crater art comes from baked alpha bitmasks generated out of the original PNGs.
 */
import { BEDROCK_Y } from './constants.js?v=32';
import { CRATER_MASKS } from './crater-masks.js?v=32';

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeCraterArt(id) {
  const art = CRATER_MASKS[id];
  if (!art) throw new Error(`missing crater art ${id}`);
  const bits = base64ToBytes(art.bits);
  const mask = new Uint8Array(art.w * art.h);
  for (let i = 0; i < mask.length; i += 1) {
    if (bits[i >> 3] & (0x80 >> (i & 7))) mask[i] = 1;
  }
  return { id, w: art.w, h: art.h, mask };
}

export function loadTerrainFromBytes(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 8) throw new Error(`map file too short: ${bytes.length}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = view.getUint32(0, true);
  const h = view.getUint32(4, true);
  const bw = Math.floor(w / 8) + 1;
  if (w <= 0 || h <= 0 || bytes.length < 8 + bw * h) {
    throw new Error(`invalid map header ${w}x${h}, bytes ${bytes.length}`);
  }
  const mask = new Uint8Array(w * h);
  const raw = bytes.subarray(8);
  for (let y = 0; y < h; y += 1) {
    const row = y * bw;
    for (let x = 0; x < w; x += 1) {
      if (raw[row + (x >> 3)] & (0x80 >> (x & 7))) mask[y * w + x] = 1;
    }
  }
  // SOURCE: BallList.xml Crater column — every baked crater bitmap is
  // registered (50/401/4 plus the original 121/131/411), so a shell only
  // misses its own art if that asset never shipped.
  const art = {};
  for (const id of Object.keys(CRATER_MASKS)) art[id] = decodeCraterArt(id);
  return new Terrain(w, h, mask, art);
}

export class Terrain {
  constructor(width, height, mask, art) {
    this.width = width;
    this.height = height;
    this.mask = mask;
    this.base = new Uint8Array(mask);
    this.craters = [];
    this.art = art;
    this._hashCache = null;
  }

  reset() {
    this.mask.set(this.base);
    this.craters.length = 0;
    this._hashCache = null;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isSolid(x, y) {
    return this.inBounds(x, y) && this.mask[y * this.width + x] === 1;
  }

  isSolidF(x, y) {
    return this.isSolid(Math.floor(x), Math.floor(y));
  }

  /** Browser bomb probe: center + eight perimeter samples. */
  isSolidCircle(x, y, radius) {
    if (this.isSolidF(x, y)) return true;
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      if (this.isSolidF(x + Math.cos(a) * radius, y + Math.sin(a) * radius)) return true;
    }
    return false;
  }

  /** Source 6x6 rectangle test. */
  isSolidRect(x, y, w, h) {
    for (let py = y; py < y + h; py += 1) {
      for (let px = x; px < x + w; px += 1) {
        if (this.isSolid(px, py)) return true;
      }
    }
    return false;
  }

  findGroundY(x, fromY, toY) {
    if (x < 0 || x >= this.width) return { y: 0, ok: false };
    const start = Math.max(0, fromY);
    const end = Math.min(this.height - 1, toY);
    for (let y = start; y <= end; y += 1) {
      if (this.mask[y * this.width + x] === 1) return { y, ok: true };
    }
    return { y: 0, ok: false };
  }

  /**
   * Direct port of Game.Logic/Phy/Maps/Map.cs: scans the two shoulder columns
   * x2-1 / x2+1, never the centre pixel.
   */
  findNextWalkPoint(x, y, direction, stepX, stepY) {
    if (direction !== 1 && direction !== -1) return { x: 0, y: 0, ok: false };
    const x2 = x + direction * stepX;
    if (x2 < 0 || x2 > this.width) return { x: 0, y: 0, ok: false };
    for (let py = y - stepY - 1; py < this.height; py += 1) {
      if (py < 0) continue;
      if (this.isSolid(x2 - 1, py) || this.isSolid(x2 + 1, py)) {
        if (Math.abs(py - y) > stepY) return { x: 0, y: 0, ok: false };
        return { x: x2, y: py, ok: true };
      }
    }
    return { x: 0, y: 0, ok: false };
  }

  /** calcObjectAngle(16) average, clamped to ±maxDegrees. */
  slopeAt(x, y, maxDegrees) {
    let leftSum = 0;
    let rightSum = 0;
    let leftCount = 0;
    let rightCount = 0;
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    for (let offset = 2; offset <= 16; offset += 2) {
      const l = this.findGroundY(ix - offset, iy - 10, iy + 10);
      if (l.ok) { leftSum += l.y; leftCount += 1; }
      const r = this.findGroundY(ix + offset, iy - 10, iy + 10);
      if (r.ok) { rightSum += r.y; rightCount += 1; }
    }
    if (leftCount === 0 || rightCount === 0) return 0;
    const leftY = leftSum / leftCount;
    const rightY = rightSum / rightCount;
    const angle = (Math.atan2(rightY - leftY, 16) * 180) / Math.PI;
    if (angle < -maxDegrees) return -maxDegrees;
    if (angle > maxDegrees) return maxDegrees;
    return angle;
  }

  /**
   * Mirrors Tile.cs Dig(cx, cy, surface, border): the crater bitmap is centred
   * on the impact and only existing solid pixels are removed. The last rows
   * (y >= BEDROCK_Y) are never carved so stacked craters cannot dig through
   * the arena floor.
   */
  carve(cx, cy, artId, kind) {
    const art = this.art[artId];
    const x0 = cx - (art ? Math.trunc(art.w / 2) : 0);
    const y0 = cy - (art ? Math.trunc(art.h / 2) : 0);
    const bounds = [x0, y0, x0 + (art ? art.w : 0), y0 + (art ? art.h : 0)];
    if (!art) return { removed: 0, bounds, ok: false };
    let removed = 0;
    let any = false;
    for (let ay = 0; ay < art.h; ay += 1) {
      const wy = y0 + ay;
      if (wy < 0 || wy >= this.height || wy >= BEDROCK_Y) continue;
      const row = wy * this.width;
      const arow = ay * art.w;
      for (let ax = 0; ax < art.w; ax += 1) {
        if (art.mask[arow + ax] === 0) continue;
        const wx = x0 + ax;
        if (wx < 0 || wx >= this.width) continue;
        if (this.mask[row + wx] === 1) {
          this.mask[row + wx] = 0;
          removed += 1;
          any = true;
        }
      }
    }
    if (!any) return { removed: 0, bounds, ok: false };
    this.craters.push({ x: cx, y: cy, art: artId, kind });
    this._hashCache = null;
    return { removed, bounds, ok: true };
  }

  solidCount() {
    let n = 0;
    for (let i = 0; i < this.mask.length; i += 1) if (this.mask[i] === 1) n += 1;
    return n;
  }

  /**
   * FNV-1a 64 over the collision mask — the same fnv.New64a() Hash() the Go
   * server reports. Split into two 32-bit lanes so every intermediate stays an
   * exact double, then hand the exact 64-bit value to Number() (the same
   * rounding JSON.parse applies to Go's full-precision digits). Cached: the
   * mask only changes on carve/reset.
   */
  hash() {
    if (this._hashCache !== null) return this._hashCache;
    let hi = 0xcbf29ce4;
    let lo = 0x84222325;
    const MOD = 4294967296;
    const mask = this.mask;
    for (let i = 0; i < mask.length; i += 1) {
      lo = (lo ^ mask[i]) >>> 0;
      const loProd = lo * 0x1b3;
      const newLo = loProd % MOD;
      const carry = Math.floor(loProd / MOD);
      const hiProd = hi * 0x1b3 + carry + ((lo << 8) >>> 0);
      hi = hiProd % MOD;
      lo = newLo;
    }
    this._hashCache = Number((BigInt(hi) << 32n) | BigInt(lo));
    return this._hashCache;
  }

  cratersCopy() {
    return this.craters.map((c) => ({ ...c }));
  }
}
