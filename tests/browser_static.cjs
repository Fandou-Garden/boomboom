/**
 * Static-host acceptance: serve dist/ without the Go API and verify that the
 * browser falls back to the pure-JS engine (dist/standalone-api.js), plays a
 * full turn and can restart.
 * Requires Chrome + puppeteer-core. No Go server or network access needed.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const ROOT = path.resolve(__dirname, '..', 'dist');
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
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

(async () => {
  const { server, port } = await serve();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const logs = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('404')) logs.push(message.text());
    });
    page.on('pageerror', (error) => logs.push(`PAGEERROR: ${error.message}`));
    await page.goto(`http://127.0.0.1:${port}/?test=1&fresh=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__GUNNY_TEST__?.ready, { timeout: 60000 });
    const backend = await page.evaluate(() => window.__GUNNY_BACKEND__);
    assert.equal(backend, 'js', 'static host must use the pure-JS backend');

    const idle = await page.evaluate(() => window.__GUNNY_TEST__.snapshot());
    assert.equal(idle.phase, 'player');
    assert.ok([0, 8, 9, 10].includes(idle.poses[0].frame), 'static idle must use calm STAND frames');
    assert.equal(idle.poses[0].weaponVisible, false, 'static idle weapon must stay on the back');

    await page.evaluate(() => window.__GUNNY_TEST__.selectWeapon('fire'));
    await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().weapon === 'fire', { timeout: 5000 });

    const fps = await page.evaluate(async () => {
      let frames = 0;
      const start = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          frames += 1;
          if (performance.now() - start >= 2000) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return Math.round(frames / ((performance.now() - start) / 1000));
    });
    assert.ok(fps >= 45, `static build should render smoothly, got ${fps} fps`);

    await page.evaluate(() => window.__GUNNY_TEST__.setEnergy(100));
    const terrainPlan = await page.evaluate(() => {
      const api = window.__GUNNY_TEST__;
      for (const angle of [20, 25, 30, 35, 40, 45, 50]) {
        for (const force of [500, 600, 700, 800, 900, 1000, 1100, 1200, 1400, 1600]) {
          const sim = api.simulate(angle, force);
          if (sim?.impact === 'ground' && sim.x > 300 && sim.x < 1700) return { angle, force, x: sim.x, y: sim.y };
        }
      }
      return null;
    });
    assert.ok(terrainPlan, 'fire weapon must find a terrain impact plan on Atlantis');
    assert.equal(await page.evaluate((plan) => window.__GUNNY_TEST__.firePlayer(plan.angle, plan.force), terrainPlan), true);
    await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().stats.playerShots >= 1, { timeout: 10000 });
    await page.waitForFunction(() => ['resolve', 'over'].includes(window.__GUNNY_TEST__.snapshot().phase), { timeout: 20000 });
    const afterPlayer = await page.evaluate(() => {
      const s = window.__GUNNY_TEST__.snapshot();
      return { craters: s.terrain?.craters ?? 0, impact: s.lastImpact };
    });
    assert.ok(afterPlayer.craters >= 1, 'JS crater must be recorded after impact');
    assert.ok(afterPlayer.impact?.removed > 0, 'JS impact must remove terrain');

    await page.waitForFunction(() => {
      const s = window.__GUNNY_TEST__.snapshot();
      return s.phase === 'player' || s.phase === 'over';
    }, { timeout: 40000 });
    const afterEnemy = await page.evaluate(() => window.__GUNNY_TEST__.snapshot());
    assert.equal(afterEnemy.stats.enemyShots, 1, 'JS AI must take its turn');
    assert.ok(
      afterEnemy.terrain?.craters >= 2 || afterEnemy.stats.playerDamageTaken > 0,
      `AI turn must produce a crater or direct damage: ${JSON.stringify({ phase: afterEnemy.phase, stats: afterEnemy.stats, impact: afterEnemy.lastImpact, craters: afterEnemy.terrain?.craters })}`,
    );

    await page.evaluate(() => window.__GUNNY_TEST__.restart());
    await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().stats.playerShots === 0, { timeout: 5000 });
    const afterRestart = await page.evaluate(() => window.__GUNNY_TEST__.snapshot());
    assert.equal(afterRestart.terrain?.craters ?? 0, 0, 'restart must reset JS terrain');

    await page.screenshot({ path: path.join(SHOTS, 'static-js.png') });
    console.log(JSON.stringify({
      backend,
      fps,
      idlePose: idle.poses[0],
      cratersAfterPlayer: afterPlayer.craters,
      enemyShots: afterEnemy.stats.enemyShots,
      cratersAfterEnemy: afterEnemy.terrain?.craters,
      restartCraters: afterRestart.terrain?.craters ?? 0,
      logs,
    }, null, 2));
    assert.deepEqual(logs, [], `static page errors: ${logs.join(' | ')}`);
    console.log('STATIC JS ACCEPTANCE PASS');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
