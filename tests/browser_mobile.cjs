/**
 * Mobile layout acceptance: a 1024×386 iPhone viewport (the short landscape
 * area left by in-app browser chrome) must keep every control on screen, and
 * the unsupported Fullscreen API must produce a non-blocking tip instead of a
 * red alert over the aiming controls. Portrait is a deliberate preview gate.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const ROOT = path.resolve(__dirname, '..', 'dist');
const SHOTS = path.join(__dirname, 'screenshots');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
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

async function openPage(browser, port, width, height, tag) {
  const page = await browser.newPage();
  const logs = [];
  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent(UA);
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404')) logs.push(message.text());
  });
  page.on('pageerror', (error) => logs.push(`PAGEERROR: ${error.message}`));
  await page.goto(`http://127.0.0.1:${port}/?test=1&mobile=${tag}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__GUNNY_TEST__?.ready, { timeout: 60000 });
  return { page, logs };
}

(async () => {
  const { server, port } = await serve();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox'],
  });
  try {
    const landscape = await openPage(browser, port, 1024, 386, 'landscape');
    const page = landscape.page;
    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      return {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        app: rect('#app'),
        power: rect('.power-panel'),
        fire: rect('#fire'),
        fullscreenTitle: document.querySelector('#fullscreen').title,
      };
    });
    assert.equal(layout.scrollWidth, layout.width, 'landscape must not overflow horizontally');
    assert.equal(layout.scrollHeight, layout.height, 'landscape must not overflow vertically');
    assert.ok(layout.app.width === layout.width && layout.app.height === layout.height, 'app must fill the visual viewport');
    for (const [name, rect] of Object.entries({ power: layout.power, fire: layout.fire })) {
      assert.ok(rect.x >= 0 && rect.right <= layout.width + 0.5, `${name} must stay inside the width`);
      assert.ok(rect.y >= 0 && rect.bottom <= layout.height + 0.5, `${name} must stay inside the height`);
    }
    const overlaps = !(layout.power.right <= layout.fire.x
      || layout.fire.right <= layout.power.x
      || layout.power.bottom <= layout.fire.y
      || layout.fire.bottom <= layout.power.y);
    assert.equal(overlaps, false, 'power ruler and fire key must not overlap');
    assert.equal(layout.fullscreenTitle, '如何全屏', 'iPhone fullscreen control must explain instead of fail');

    await page.evaluate(() => {
      document.documentElement.requestFullscreen = undefined;
      document.documentElement.webkitRequestFullscreen = undefined;
      document.getElementById('fullscreen').click();
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const tip = await page.evaluate(() => {
      const el = document.getElementById('displayTip');
      const r = el.getBoundingClientRect();
      const power = document.querySelector('.power-panel').getBoundingClientRect();
      return {
        hidden: el.hidden,
        text: document.getElementById('displayTipText').textContent,
        top: r.top,
        bottom: r.bottom,
        powerTop: power.top,
        toastAlert: document.getElementById('toast').classList.contains('alert'),
      };
    });
    assert.equal(tip.hidden, false, 'fullscreen guidance must be visible');
    assert.match(tip.text, /添加到主屏幕/, 'guidance must offer the iPhone install path');
    assert.doesNotMatch(tip.text, /请横屏/, 'landscape guidance must not ask the player to rotate again');
    assert.ok(tip.top < 120, 'guidance must stay under the top HUD, not cover the aiming area');
    assert.ok(tip.bottom < tip.powerTop, 'guidance must not overlap the bottom power panel');
    assert.equal(tip.toastAlert, false, 'guidance must not use the red alert toast');
    await page.screenshot({ path: path.join(SHOTS, 'mobile-landscape.png') });
    assert.deepEqual(landscape.logs, []);
    await page.close();

    const portrait = await openPage(browser, port, 390, 844, 'portrait');
    const gate = await portrait.page.evaluate(() => {
      const controls = getComputedStyle(document.querySelector('.controls'));
      return {
        noticeHidden: document.getElementById('rotateNotice').hidden,
        fullLabel: document.getElementById('rotateFull').textContent,
        dismissLabel: document.getElementById('rotateDismiss').textContent,
        hintHidden: document.getElementById('portraitHint').hidden,
        controlsOpacity: controls.opacity,
        controlsEvents: controls.pointerEvents,
      };
    });
    assert.equal(gate.noticeHidden, false, 'portrait must show the rotate gate');
    assert.equal(gate.fullLabel, '如何全屏');
    assert.equal(gate.dismissLabel, '先看看战场');
    assert.equal(gate.hintHidden, true);
    assert.equal(gate.controlsEvents, 'none', 'portrait preview controls must not pretend to be playable');
    await portrait.page.screenshot({ path: path.join(SHOTS, 'mobile-portrait-gate.png') });

    await portrait.page.click('#rotateFull');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const portraitTip = await portrait.page.evaluate(() => ({
      hidden: document.getElementById('displayTip').hidden,
      text: document.getElementById('displayTipText').textContent,
    }));
    assert.equal(portraitTip.hidden, false, 'portrait fullscreen help must open');
    assert.match(portraitTip.text, /添加到主屏幕/);
    await portrait.page.click('#displayTipClose');
    await portrait.page.click('#rotateDismiss');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const preview = await portrait.page.evaluate(() => ({
      noticeHidden: document.getElementById('rotateNotice').hidden,
      hintHidden: document.getElementById('portraitHint').hidden,
      hint: document.getElementById('portraitHint').textContent,
      className: document.documentElement.className,
    }));
    assert.equal(preview.noticeHidden, true);
    assert.equal(preview.hintHidden, false, 'dismissed portrait must keep a persistent preview hint');
    assert.match(preview.hint, /竖屏仅预览/);
    assert.match(preview.className, /portrait-preview/);
    await portrait.page.screenshot({ path: path.join(SHOTS, 'mobile-portrait-preview.png') });
    assert.deepEqual(portrait.logs, []);
    await portrait.page.close();

    console.log(JSON.stringify({
      landscape: {
        viewport: [layout.width, layout.height],
        fullscreenTitle: layout.fullscreenTitle,
        tip: { top: tip.top, bottom: tip.bottom, powerTop: tip.powerTop, text: tip.text },
      },
      portrait: { gate, portraitTip, preview },
      logs: [],
    }, null, 2));
    console.log('MOBILE ADAPTATION PASS');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
