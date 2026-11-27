/**
 * Pure-JS engine façade — the drop-in replacement for the Go WASM bridge
 * (server/wasm/main.go). Same five methods, same string-error convention:
 *
 *   init(mapBytes, crater50, crater401, crater4, debug) -> '' | error text
 *   command(jsonString)                                 -> '' | error text
 *   update(dt)                                          -> null
 *   snapshot()                                          -> JSON string | 'null'
 *   events()                                            -> JSON array string
 *
 * The Go bridge decoded the three crater PNGs at init. The JS engine ships those
 * masks pre-baked (scripts/gen_engine_assets.go), so the crater buffers are
 * accepted for signature compatibility but no longer required.
 */
import { loadTerrainFromBytes } from './terrain.js?v=32';
import { Match } from './match.js?v=32';

let seedCounter = 0;

function toBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v) && v.length > 0) return Uint8Array.from(v);
  return null;
}

export class GunnyEngine {
  constructor() {
    this.match = null;
    this.lastSeq = 0;
    // Optional off-thread search hook, installed by the static host once its
    // Web Worker replica is ready. See Match.aiSolver.
    this.aiSolver = null;
  }

  init(mapBytes, crater50, crater401, crater4, debug) {
    const map = toBytes(mapBytes);
    if (!map) return 'gunnyInit requires a map buffer';
    let terrain;
    try {
      terrain = loadTerrainFromBytes(map);
    } catch (error) {
      return String(error && error.message ? error.message : error);
    }
    const seed = Date.now() * 1000 + (seedCounter += 1);
    this.match = new Match({
      terrain,
      seed,
      lowPower: true,
      debug: !!debug,
      clock: () => (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000),
    });
    this.match.aiSolver = this.aiSolver;
    this.lastSeq = 0;
    return '';
  }

  /** Install or clear the async AI search hook (null = synchronous search). */
  setAISolver(fn) {
    this.aiSolver = typeof fn === 'function' ? fn : null;
    if (this.match) this.match.aiSolver = this.aiSolver;
  }

  command(json) {
    if (!this.match) return 'match not initialized';
    if (typeof json !== 'string') return 'missing command JSON';
    let cmd;
    try {
      cmd = JSON.parse(json);
    } catch (error) {
      return `invalid command: ${error.message}`;
    }
    return this.match.command(cmd);
  }

  update(dt) {
    if (this.match) this.match.update(dt);
    return null;
  }

  snapshot() {
    if (!this.match) return 'null';
    try {
      return JSON.stringify(this.match.snapshot());
    } catch (error) {
      console.error('snapshot failed', error);
      return 'null';
    }
  }

  events() {
    if (!this.match) return '[]';
    const list = this.match.eventsSince(this.lastSeq);
    if (!list.length) return '[]';
    this.lastSeq = list[list.length - 1].seq;
    try {
      return JSON.stringify(list);
    } catch (error) {
      console.error('events failed', error);
      return '[]';
    }
  }
}
