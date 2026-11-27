/*
 * Static-host adapter (pure JS): when /api is not a real JSON backend, this
 * module installs LocalEventSource + a /api/command shim backed by the pure-JS
 * engine in js/engine/. It replaces offline-api.js, which ran the same rules
 * compiled to WASM. The Go HTTP server remains the source of truth for
 * local/online play; this path only runs on static hosting.
 */
import { GunnyEngine } from './js/engine/index.js?v=24';

const API_COMMAND = '/api/command';
const MAP_IDS = ['1156', '1001', '1002', '1003', '1008', '1014', '1035', '1038', '1157', '1190', '1192', '1049'];

let bootPromise = null;
let activeSource = null;
let lastSeq = 0;
const engine = new GunnyEngine();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function emit(source, type, data) {
  if (!source || source._closed) return;
  let event;
  if (typeof MessageEvent === 'function') {
    event = new MessageEvent(type, { data });
  } else {
    event = new Event(type);
    event.data = data;
  }
  source.dispatchEvent(event);
}

function flush(source) {
  if (!source || !source._started) return;
  const eventsJson = engine.events();
  if (eventsJson && eventsJson !== '[]') {
    for (const event of JSON.parse(eventsJson)) {
      lastSeq = Math.max(lastSeq, event.seq || 0);
      emit(source, 'game', JSON.stringify(event));
    }
  }
  const snapshot = engine.snapshot();
  if (snapshot && snapshot !== 'null') {
    const data = JSON.parse(snapshot);
    emit(source, 'state', JSON.stringify({ seq: data.seq, type: 'state', data }));
  }
}

async function loadBytes(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const raw = await response.arrayBuffer();
  // The cache-busting query (?v=24) rides on the same URL, so test the path.
  if (!/\.gz(\?|$)/.test(url)) return new Uint8Array(raw);
  // Static hosts usually transfer without content-encoding, so the map is
  // shipped pre-gzipped (232KB -> ~10KB) and inflated in the browser.
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream unavailable for pre-gzipped map');
  }
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function loadMapBytes(mapId) {
  try {
    return await loadBytes(`data/${mapId}.fore.map.gz?v=24`);
  } catch (error) {
    console.warn('pre-gzipped map unavailable, falling back to raw bitmask', error);
    return loadBytes(`data/${mapId}.fore.map?v=24`);
  }
}

async function boot() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    const params = new URLSearchParams(location.search);
    // The selected map id is shared with the client (main.js). All map
    // bitmasks are resampled to the engine's fixed 1843x1020 world, so the
    // authoritative match can be initialised with any of them unchanged.
    const mapId = MAP_IDS.includes(params.get('map')) ? params.get('map') : '1156';
    window.__GUNNY_MAP_ID__ = mapId;
    const map = await loadMapBytes(mapId);
    const debug = params.get('test') === '1' || params.get('cheat') === '1';
    const error = engine.init(map, null, null, null, debug);
    if (error) throw new Error(error);
    lastSeq = 0;
    // Give the first full state a moment to settle before the UI reads it.
    await sleep(0);
  })();
  return bootPromise;
}

class LocalEventSource extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this._closed = false;
    this._started = false;
    this._timer = null;
    activeSource = this;
    this._boot = boot().then(() => {
      if (this._closed) return;
      this.readyState = 1;
      this._started = true;
      emit(this, 'open', '');
      flush(this);
      this._startTimer();
    }).catch((error) => {
      console.error('offline game boot failed', error);
      this.readyState = 2;
      this.dispatchEvent(new Event('error'));
      emit(this, 'error', error.message);
    });
  }

  _startTimer() {
    let last = performance.now();
    const tick = () => {
      if (this._closed) return;
      const now = performance.now();
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.12) dt = 0.04;
      engine.update(dt);
      flush(this);
    };
    this._timer = window.setInterval(tick, 40);
  }

  close() {
    this._closed = true;
    this.readyState = 2;
    if (this._timer) window.clearInterval(this._timer);
  }
}

window.EventSource = LocalEventSource;

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (!url.includes(API_COMMAND)) return nativeFetch(input, init);
  return boot().then(() => {
    let body = {};
    try { body = JSON.parse(init.body || '{}'); } catch { /* handled below */ }
    const error = engine.command(JSON.stringify(body));
    if (error) {
      return new Response(error, {
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    flush(activeSource);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
};

window.__GUNNY_OFFLINE__ = true;
