/*
 * Static-host adapter: when /api is not a real JSON backend, this file
 * replaces EventSource + /api/command with the same Go match compiled to WASM.
 * The local development server never loads this file (see index.html probe).
 */
(() => {
  const API_COMMAND = '/api/command';
  let bootPromise = null;
  let activeSource = null;
  let lastSeq = 0;

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
    if (!source || !source._started || !window.GunnyWasm) return;
    const eventsJson = window.GunnyWasm.events();
    if (eventsJson && eventsJson !== '[]') {
      for (const event of JSON.parse(eventsJson)) {
        lastSeq = Math.max(lastSeq, event.seq || 0);
        emit(source, 'game', JSON.stringify(event));
      }
    }
    const snapshot = window.GunnyWasm.snapshot();
    if (snapshot && snapshot !== 'null') {
      const data = JSON.parse(snapshot);
      emit(source, 'state', JSON.stringify({ seq: data.seq, type: 'state', data }));
    }
  }

  async function loadBytes(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      if (typeof window.Go !== 'function') throw new Error('wasm_exec.js 未加载');
      const go = new window.Go();
      const response = await fetch('wasm/gunny.wasm?v=22', { cache: 'force-cache' });
      if (!response.ok) throw new Error(`gunny.wasm: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      let instantiated;
      try {
        instantiated = await WebAssembly.instantiate(bytes, go.importObject);
      } catch (error) {
        throw new Error(`WASM 实例化失败: ${error.message}`);
      }
      // main() blocks forever by design; run() resolves only on exit.
      go.run(instantiated.instance).catch((error) => {
        console.error('WASM runtime stopped', error);
      });
      for (let i = 0; i < 200 && !window.GunnyWasm; i += 1) await sleep(10);
      if (!window.GunnyWasm) throw new Error('WASM 引擎未挂载 GunnyWasm');
      const [map, crater50, crater401, crater4] = await Promise.all([
        loadBytes('data/1156.fore.map?v=22'),
        loadBytes('assets/crater-50.png?v=22'),
        loadBytes('assets/crater-401.png?v=22'),
        loadBytes('assets/crater-4.png?v=22'),
      ]);
      const params = new URLSearchParams(location.search);
      const debug = params.get('test') === '1' || params.get('cheat') === '1';
      const error = window.GunnyWasm.init(map, crater50, crater401, crater4, debug);
      if (error) throw new Error(error);
      lastSeq = 0;
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
        if (this._closed || !window.GunnyWasm) return;
        const now = performance.now();
        let dt = (now - last) / 1000;
        last = now;
        if (dt > 0.12) dt = 0.04;
        window.GunnyWasm.update(dt);
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
      const error = window.GunnyWasm.command(JSON.stringify(body));
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
})();
