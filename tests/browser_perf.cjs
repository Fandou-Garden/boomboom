/**
 * Battle-scene frame-time baseline / regression.
 *
 * Serves dist/ statically (no Go, no real /api) and records rAF frame intervals
 * plus Chromium long-task entries during the three scenes named in the brief:
 *   1. continuous angle drag
 *   2. computer turn (AI search + aim + flight + resolve)
 *   3. scatter / POW cratering
 * It also times one cold recommendation solve.
 *
 * Usage: CHROME_PATH="..." sh scripts/node.sh tests/browser_perf.cjs [--json]
 * Output: tests/screenshots/perf.json
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const ROOT = path.resolve(__dirname, '..', 'dist');
const OUT = path.join(__dirname, 'screenshots', 'perf.json');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.map': 'application/octet-stream',
  '.gz': 'application/gzip',
  '.webp': 'image/webp',
};

function serve() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    if (pathname.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(`${ROOT}${path.sep}`) && file !== path.join(ROOT, 'index.html')) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, port: server.address().port });
  }));
}

function pct(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1));
  return sorted[index];
}

function summarize(label, frames, longTasks) {
  const durations = frames.map((f) => f.ms);
  return {
    label,
    frames: durations.length,
    fps: durations.length ? Math.round(1000 / (durations.reduce((a, b) => a + b, 0) / durations.length)) : 0,
    p50: +pct(durations, 50).toFixed(1),
    p95: +pct(durations, 95).toFixed(1),
    max: +Math.max(0, ...durations).toFixed(1),
    over33: durations.filter((d) => d > 33.4).length,
    longTasks: longTasks.map((t) => ({ start: Math.round(t.start), ms: Math.round(t.ms) })),
  };
}

(async () => {
  const throttle = Math.max(1, Number(process.argv.find((a) => a.startsWith('--throttle='))?.split('=')[1] || 1));
  // A/B the same build: --search=sync drops the off-thread solver so the AI
  // search and the recommendation sweep run in-thread, exactly as before the
  // worker landed. Default is the shipped worker path.
  const searchMode = process.argv.includes('--search=sync') ? 'sync' : 'worker';
  const { server, port } = await serve();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const result = { throttle, search: searchMode };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
    if (throttle > 1) {
      const cdp = await page.createCDPSession();
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    }
    await page.goto(`http://127.0.0.1:${port}/?test=1&fresh=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__GUNNY_TEST__?.ready, { timeout: 60000 });

    if (searchMode === 'sync') {
      await page.evaluate(() => {
        const state = window.__GUNNY_SEARCH__;
        try { state?.worker?.worker?.terminate?.(); } catch { /* already gone */ }
        delete window.__GUNNY_SEARCH__;
        window.__GUNNY_ENGINE__?.setAISolver?.(null);
      });
    }
    result.searchWorkerReadyEarly = await page.evaluate(() => !!window.__GUNNY_SEARCH__?.ready?.());

    // Frame recorder + long task observer.
    await page.evaluate(() => {
      const rec = { frames: [], long: [], running: false, startedAt: 0, last: 0 };
      window.__perf = rec;
      const tick = (now) => {
        if (rec.running) {
          rec.frames.push({ t: now, ms: now - rec.last });
          rec.last = now;
        }
        if (rec.running) requestAnimationFrame(tick);
      };
      window.__perf.start = () => {
        rec.frames = [];
        rec.long = [];
        rec.startedAt = performance.now();
        rec.last = performance.now();
        rec.running = true;
        requestAnimationFrame(tick);
      };
      window.__perf.stop = () => {
        rec.running = false;
        return { frames: rec.frames.slice(), long: rec.long.slice(), startedAt: rec.startedAt };
      };
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            rec.long.push({ start: entry.startTime - rec.startedAt, ms: entry.duration });
          }
        }).observe({ entryTypes: ['longtask'] });
      } catch { /* longtask unsupported */ }
    });

    // --- Scene 1: continuous angle drag (real key events, 2 s) ---------------
    await page.evaluate(() => { window.__GUNNY_TEST__.setAngle(45); window.__perf.start(); });
    await page.keyboard.down('ArrowUp');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await page.keyboard.up('ArrowUp');
    const drag = await page.evaluate(() => window.__perf.stop());
    result.angleDrag = summarize('angle drag', drag.frames, drag.long);
    result.searchWorkerReady = await page.evaluate(() => !!window.__GUNNY_SEARCH__?.ready?.());
    result.aiSolverOffThread = await page.evaluate(() => !!window.__GUNNY_ENGINE__?.match?.aiSolver);

    // --- recommendation latency (cold, several angles) -----------------------
    const recLatency = await page.evaluate(() => {
      const api = window.__GUNNY_TEST__;
      const out = [];
      // The default weapon allows 15..50°, so stay inside it or the clamp makes
      // later angles a cache hit instead of a cold solve.
      for (const angle of [18, 26, 34, 42, 50]) {
        // Set the angle and solve in the same task so the cache cannot answer.
        const applied = api.setAngle(angle);
        const start = performance.now();
        const value = api.recommendation();
        const ms = performance.now() - start;
        out.push({
          set: angle,
          applied,
          used: api.snapshot().angle,
          reachable: value?.reachable ?? null,
          ms: +ms.toFixed(1),
        });
      }
      return out;
    });
    result.recommendation = {
      ms: recLatency.map((v) => v.ms),
      max: +Math.max(...recLatency.map((v) => v.ms)).toFixed(1),
      angles: recLatency,
    };

    // --- recommendation via the UI path (worker round-trip vs sync call) ------
    result.recommendationUI = await page.evaluate(async () => {
      const api = window.__GUNNY_TEST__;
      const out = [];
      for (const angle of [22, 34, 46]) {
        api.setAngle(angle);
        const start = performance.now();
        const first = api.requestRecommendation();
        const blocking = performance.now() - start;
        // In worker mode the first call returns null and the answer arrives on a
        // later frame; in sync mode it is already computed here.
        let value = first;
        let waited = 0;
        while (!value && api.recommendationPending() && waited < 3000) {
          await new Promise((resolve) => setTimeout(resolve, 8));
          waited += 8;
          value = api.requestRecommendation();
        }
        out.push({
          angle,
          ms: +(performance.now() - start).toFixed(1),
          blocking: +blocking.toFixed(1),
          reachable: value?.reachable ?? null,
          queued: !first,
        });
      }
      return out;
    });

    // --- Scene 2: computer turn ---------------------------------------------
    await page.evaluate(() => { window.__GUNNY_TEST__.setWind(0); window.__GUNNY_TEST__.selectWeapon('fire'); });
    const plan = await page.evaluate(() => {
      const shot = window.__GUNNY_TEST__.solveShot();
      return { angle: shot.angle, force: shot.force };
    });
    await page.evaluate((p) => {
      window.__perf.start();
      window.__GUNNY_TEST__.firePlayer(p.angle, p.force);
    }, plan);
    await page.waitForFunction(() => {
      const s = window.__GUNNY_TEST__.snapshot();
      return s.phase === 'over' || (s.phase === 'player' && s.stats.enemyShots >= 1);
    }, { timeout: 60000 });
    const enemy = await page.evaluate(() => window.__perf.stop());
    result.enemyTurn = summarize('computer turn', enemy.frames, enemy.long);

    // --- Scene 3: scatter cratering -----------------------------------------
    const scatterReady = await page.evaluate(() => {
      const used = window.__GUNNY_TEST__.selectSkill('scatter');
      return used;
    });
    if (scatterReady) {
      const scatterPlan = await page.evaluate(() => {
        const shot = window.__GUNNY_TEST__.solveShot();
        return { angle: shot.angle, force: shot.force, before: window.__GUNNY_TEST__.terrainCraters() };
      });
      await page.evaluate((p) => {
        window.__perf.start();
        window.__GUNNY_TEST__.firePlayer(p.angle, p.force);
      }, scatterPlan);
      await page.waitForFunction((before) => {
        const s = window.__GUNNY_TEST__.snapshot();
        const done = s.phase === 'over'
          || ((s.phase === 'resolve' || s.phase === 'player') && (s.terrain?.craters ?? 0) > before);
        return done;
      }, { timeout: 60000 }, scatterPlan.before);
      await new Promise((resolve) => setTimeout(resolve, 600));
      const scatter = await page.evaluate(() => window.__perf.stop());
      result.scatter = summarize('scatter cratering', scatter.frames, scatter.long);
      result.scatterState = await page.evaluate(() => {
        const s = window.__GUNNY_TEST__.snapshot();
        return { phase: s.phase, craters: s.terrain?.craters ?? 0, shots: s.stats };
      });
    } else {
      result.scatter = { skipped: true };
    }

    // --- replica parity: the worker mask must equal the authoritative mask ---
    await new Promise((resolve) => setTimeout(resolve, 200));
    result.searchReplica = await page.evaluate(async () => {
      const search = window.__GUNNY_SEARCH__;
      const match = window.__GUNNY_ENGINE__?.match;
      if (!search?.hash || !match) return { skipped: true };
      const replica = await search.hash();
      const main = { hash: match.terrain.hash(), craters: match.terrain.craters.length };
      return { replica, main, match: replica ? replica.hash === main.hash : null };
    });

    // --- Scene 4: isolated carve cost (debug API, cold terrain point) --------
    result.carve = await page.evaluate(() => {
      const api = window.__GUNNY_TEST__;
      const ctxProto = CanvasRenderingContext2D.prototype;
      const origRead = ctxProto.getImageData;
      let readMs = 0;
      let readCalls = 0;
      ctxProto.getImageData = function (...args) {
        const start = performance.now();
        const out = origRead.apply(this, args);
        readMs += performance.now() - start;
        readCalls += 1;
        return out;
      };
      const points = [[700, 860], [900, 880], [1100, 900], [1300, 860], [500, 900]];
      const total = [];
      for (const [x, y] of points) {
        const start = performance.now();
        api.carveAt(x, y, 'large');
        total.push(+(performance.now() - start).toFixed(1));
      }
      ctxProto.getImageData = origRead;
      return { ms: total, max: Math.max(...total), readMs: +readMs.toFixed(1), readCalls };
    });

    // --- Scene 5: engine snapshot / AI search internal cost ------------------
    result.engine = await page.evaluate(async () => {
      const eng = window.__GUNNY_ENGINE__;
      if (!eng?.match) return { skipped: true };
      const m = eng.match;
      const snap = [];
      for (let i = 0; i < 5; i += 1) {
        const start = performance.now();
        eng.snapshot();
        snap.push(+(performance.now() - start).toFixed(1));
      }
      const hash = [];
      for (let i = 0; i < 3; i += 1) {
        m.terrain._hashCache = null;
        const start = performance.now();
        m.terrain.hash();
        hash.push(+(performance.now() - start).toFixed(1));
      }
      const ai = await import('./js/engine/ai.js?v=25');
      const plan = [];
      for (let i = 0; i < 3; i += 1) {
        const start = performance.now();
        ai.chooseShotForWeapon(m.actors[1], m.actors[0], m.wind, m.terrain, m.rng, m.enemyWeapon(), 14.0, 2000);
        plan.push(+(performance.now() - start).toFixed(1));
      }
      return { snapshotMs: snap, hashMs: hash, aiSearchMs: plan };
    });

    result.searchWorkerReadyAtEnd = await page.evaluate(() => !!window.__GUNNY_SEARCH__?.ready?.());
    result.aiSolverOffThreadAtEnd = await page.evaluate(() => typeof window.__GUNNY_ENGINE__?.match?.aiSolver);

    const outFile = OUT.replace(/\.json$/, `-${throttle}x${searchMode === 'sync' ? '-sync' : ''}.json`);
    fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
