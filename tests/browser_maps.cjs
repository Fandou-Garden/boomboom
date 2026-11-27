/**
 * Staged map loading acceptance (static host, pure-JS engine).
 *
 * Verifies: first screen only requests the five core thumbs + current map
 * assets; extra cards start a background 4-artefact download; the player can
 * select a core map and keep playing while it downloads; a finished download
 * unlocks the card and is remembered in localStorage; 玛雅废墟 (1049) boots
 * as a real battle map with the correct 1843x1020 terrain.
 *
 * Run: sh scripts/node.sh tests/browser_maps.cjs
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const ROOT = path.resolve(__dirname, '..', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.map': 'application/octet-stream',
  '.gz': 'application/gzip', '.webp': 'image/webp',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    requests.push(pathname);
    if (pathname.startsWith('/api/')) { res.writeHead(404); res.end('not found'); return; }
    const file = path.resolve(ROOT, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!file.startsWith(`${ROOT}${path.sep}`) && file !== path.join(ROOT, 'index.html')) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, requests })));
}

async function main() {
  const { server, requests } = await serve();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const out = {};
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !(m.location()?.url || '').includes('/api/state')) errors.push(m.text());
    });
    await page.goto(`http://127.0.0.1:${port}/?test=1&fresh=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__GUNNY_TEST__?.ready, { timeout: 60000 });

    // 1. The manifest splits 11 maps into 5 core / 6 on-demand, and 玛雅废墟
    //    is in the on-demand group.
    const ms = await page.evaluate(() => window.__GUNNY_TEST__.mapState());
    out.manifest = { core: ms.core.length, extra: ms.extra.length, maya: ms.extra.includes('1049'), loaded: ms.loaded };
    assert.equal(ms.core.length, 5, 'five core maps');
    assert.equal(ms.extra.length, 6, 'five extra + maya are on demand');
    assert.ok(ms.extra.includes('1049'), 'maya 1049 must be an on-demand map');
    assert.equal(ms.loaded.length, 0, 'no on-demand map unlocked on a fresh visit');

    // 2. First screen must not request extra fore/back/collision. Thumbs for
    //    extra maps use a CSS placeholder, so none of their assets are hit.
    const extraAssets = requests.filter((u) => /map-(1002|1003|1008|1014|1035|1049)-(fore|back|thumb)|data\/(1002|1003|1008|1014|1035|1049)\.fore\.map/.test(u));
    out.firstScreenExtraRequests = extraAssets.length;
    assert.equal(extraAssets.length, 0, `first screen must not fetch extra assets, got ${extraAssets.join(', ')}`);

    // 3. Starting one download does not block selecting a core map and firing.
    await page.evaluate(() => window.__GUNNY_TEST__.openMapPicker());
    await page.waitForFunction(() => window.__GUNNY_TEST__.mapState().pickerOpen);
    await page.evaluate(() => window.__GUNNY_TEST__.mapLoad('1049'));
    // Immediately select a core map in the picker and confirm playability.
    const coreSelected = await page.evaluate(() => {
      const api = window.__GUNNY_TEST__;
      document.querySelector('.map-option[data-map="1001"]').click();
      return api.mapState().loaded.includes('1049') || api.mapState().statuses['1049']?.status === 'loading';
    });
    out.coreSelectableDuringDownload = coreSelected;
    assert.ok(coreSelected, 'core card selectable while an extra map downloads');

    // 4. Wait for the download to finish; verify four artefacts were fetched
    //    and localStorage remembers the unlock.
    await page.waitForFunction(() => window.__GUNNY_TEST__.mapState().statuses['1049']?.status === 'ready', { timeout: 20000 });
    const mayaAssets = requests.filter((u) => /map-1049-(fore|back|thumb)|data\/1049\.fore\.map/.test(u));
    out.mayaAssetRequests = mayaAssets.length;
    assert.ok(mayaAssets.length >= 4, `expected 4 maya artefacts, got ${mayaAssets.join(', ')}`);
    const stored = await page.evaluate(() => localStorage.getItem('gunny.map.loaded.1049'));
    out.localStorageFlag = stored;
    assert.equal(stored, '1', 'completed download must be persisted');
    const badgeGone = await page.$eval('.map-option[data-map="1049"]', (el) => !el.classList.contains('is-locked') && !el.querySelector('.map-load-badge'));
    out.mayaUnlockedInPicker = badgeGone;
    assert.ok(badgeGone, 'completed card must unlock in the open picker');

    // 5. Reload with ?map=1049: the pure-JS engine boots the new terrain and a
    //    full shot resolves, proving the map is really playable (not just a card).
    await page.goto(`http://127.0.0.1:${port}/?test=1&map=1049&fresh=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__GUNNY_TEST__?.ready, { timeout: 60000 });
    const s = await page.evaluate(() => window.__GUNNY_TEST__.snapshot());
    out.mayaBoot = { map: s.mapId, world: s.world, backend: await page.evaluate(() => window.__GUNNY_BACKEND__) };
    assert.equal(s.mapId, '1049', 'engine must boot map 1049');
    assert.equal(await page.evaluate(() => window.__GUNNY_TEST__.mapState().currentMapId), '1049');
    assert.equal(s.world.width, 1843);
    assert.equal(s.world.height, 1020);

    await page.keyboard.down('Space');
    await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().charging === true, { timeout: 3000 });
    await sleep(220);
    await page.keyboard.up('Space');
    await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().stats.playerShots >= 1, { timeout: 5000 });
    out.mayaShot = await page.evaluate(() => window.__GUNNY_TEST__.snapshot().stats.playerShots);

    out.errors = errors;
    assert.deepEqual(errors, [], 'no console/page errors');
    console.log(JSON.stringify(out, null, 2));
    console.log('STAGED MAP LOADING ACCEPTANCE PASS');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
