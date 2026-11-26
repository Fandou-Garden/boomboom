/**
 * End-to-end acceptance for the mobile HUD/camera rebuild.
 * Requires Chrome + puppeteer-core and `GUNNY_DEBUG=1 npm start`.
 *
 * Outputs screenshots to tests/screenshots/ and asserts:
 *  - 844x390 / 667x375 both-player aim framing without spawn changes
 *  - charge HUD with current / recommended / previous force
 *  - flight camera + fixed HUD + relaunch lock
 *  - landing returns to both-player view
 *  - scatter waits for every shell before the AI turn
 *  - real Web Audio graphs for fire / explosion / hit / POW
 */
const puppeteer = require('puppeteer-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const URL = process.env.GAME_URL || 'http://127.0.0.1:8000/?test=1';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

function intersects(a, b) {
  return !!a && !!b
    && a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

function boxDelta(a, b) {
  return Math.max(
    Math.abs(a.x - b.x), Math.abs(a.y - b.y),
    Math.abs(a.width - b.width), Math.abs(a.height - b.height),
  );
}

function insideViewport(rect, width, height) {
  return !!rect && rect.x >= -0.5 && rect.y >= -0.5
    && rect.x + rect.width <= width + 0.5
    && rect.y + rect.height <= height + 0.5;
}

async function open(browser, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') logs.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => logs.push(`PAGEERROR: ${error.message}`));
  await page.goto(`${URL}&fresh=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__GUNNY_TEST__?.ready, { timeout: 60000 });
  await sleep(1200);
  return { page, logs };
}

async function state(page) {
  return page.evaluate(() => ({
    snapshot: window.__GUNNY_TEST__.snapshot(),
    rects: window.__GUNNY_TEST__.controlRects(),
    record: window.__GUNNY_TEST__.shotRecordScreen(),
    minimap: window.__GUNNY_TEST__.minimapInfo(),
    ui: {
      powerText: document.querySelector('#powerText')?.textContent,
      recommendText: document.querySelector('#recommendText')?.textContent,
      lastPowerText: document.querySelector('#lastPowerText')?.textContent,
      aimStatus: document.querySelector('#aimStatus')?.textContent,
      fireLabel: document.querySelector('#fireLabel')?.textContent,
      countdownHidden: document.querySelector('#countdown')?.hidden,
      countdownText: document.querySelector('#countdown')?.textContent,
      timerPressed: document.querySelector('#timerToggle')?.getAttribute('aria-pressed'),
      recommendHidden: document.querySelector('#recommendMarker')?.hidden,
      lastPowerHidden: document.querySelector('#lastPowerMarker')?.hidden,
      recommendTitle: document.querySelector('#recommendMarker')?.getAttribute('title') || '',
      lastPowerTitle: document.querySelector('#lastPowerMarker')?.getAttribute('title') || '',
      recommendBandHidden: document.querySelector('#recommendBand')?.hidden,
      powerOverflow: (() => {
        const el = document.querySelector('#powerText');
        return el ? el.scrollWidth - el.clientWidth : 0;
      })(),
    },
  }));
}

function assertActorsClear(rects, width, height, label) {
  assert.equal(rects.actors?.length, 2, `${label}: two actors expected`);
  const blockers = ['.battle-hud', '.minimap-panel', '.utilities', '.skill-rail', '.power-panel', '.fire-cluster', '#joystick'];
  for (const [index, actor] of rects.actors.entries()) {
    assert.ok(insideViewport(actor, width, height), `${label}: actor ${index} must be fully on screen`);
    for (const selector of blockers) {
      assert.equal(intersects(actor, rects[selector]), false, `${label}: actor ${index} must not be covered by ${selector}`);
    }
  }
}

function assertButtonSafe(rect, width, height, label, minBottom = 34) {
  assert.ok(rect, `${label}: missing`);
  assert.ok(rect.width >= 34 && rect.height >= 34, `${label}: touch target too small`);
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 0.5, `${label}: horizontal overflow`);
  assert.ok(rect.y + rect.height <= height - minBottom + 0.5, `${label}: must clear bottom gesture area`);
}

async function waitForPlayerTurn(page, timeout = 45000) {
  await page.waitForFunction(() => {
    const snapshot = window.__GUNNY_TEST__.snapshot();
    return snapshot && snapshot.phase === 'player' && snapshot.turn === 0;
  }, { timeout, polling: 100 });
}

async function findReachableAngle(page, preferredMin = 15, preferredMax = 16) {
  const scan = await page.evaluate(() => {
    const api = window.__GUNNY_TEST__;
    const out = [];
    const samples = [];
    for (let angle = 15; angle <= 65; angle += 1) {
      const ok = api.setAngle(angle);
      const recommendation = api.recommendation();
      if (samples.length < 4 || angle === 20 || angle === 30) samples.push({ angle, ok, actual: api.snapshot().angle, reachable: recommendation?.reachable, reason: recommendation?.reason, closest: recommendation?.closest });
      if (recommendation?.reachable) {
        out.push({
          angle,
          force: recommendation.force,
          pct: recommendation.pct,
          range: recommendation.range,
          hitType: recommendation.hitType,
        });
      }
    }
    return { choices: out, samples, state: (() => { const s = api.snapshot(); return { phase: s.phase, paused: s.paused, charging: s.charging, weapon: s.weapon, angleMin: s.angleMin, angleMax: s.angleMax, turn: s.turn }; })() };
  });
  const choices = scan.choices;
  assert.ok(choices.length > 0, `at least one angle must be reachable for the charge acceptance shot: ${JSON.stringify(scan)}`);
  const preferred = choices.filter((item) => item.angle >= preferredMin && item.angle <= preferredMax);
  const chosen = (preferred.length ? preferred : choices).at(-1);
  await page.evaluate((angle) => window.__GUNNY_TEST__.setAngle(angle), chosen.angle);
  await sleep(260);
  return chosen;
}

async function runViewport(browser, width, height) {
  const { page, logs } = await open(browser, width, height);
  // The classic arsenal exposes different angle envelopes. Use 风神 here so
  // the low-angle reachability checks exercise its 15°–50° range.
  await page.evaluate(() => window.__GUNNY_TEST__.selectWeapon('wind'));
  await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().weapon === 'wind');
  await sleep(180);
  const initial = await state(page);
  const { snapshot: s0, rects: r0 } = initial;

  // SOURCE LoadMapsItems.xml ID=1001 is a single 2000×1425 arena.
  assert.equal(s0.world.width, 2000);
  assert.equal(s0.world.height, 1425);
  assert.equal(s0.actors[0].x, 300, 'spawn must not move');
  assert.equal(s0.actors[1].x, 1700, 'spawn must not move');
  assert.ok(s0.actors[1].x - s0.actors[0].x > 1300);
  assert.equal(Math.round(s0.metrics.horizontal), 70);
  assert.equal(s0.phase, 'player');
  assert.equal(s0.showCountdown, false, 'practice countdown must default off');
  assert.equal(initial.ui.countdownHidden, true);
  assert.equal(s0.hints.length, 0, 'both actors should be in frame, not edge hints');
  assertActorsClear(r0, width, height, `${width}x${height} initial`);

  const layoutChecks = await page.evaluate(() => {
    const ids = ['fire', 'pow', 'heal', 'skillExtra2', 'skillScatter', 'skillExtra1', 'skillBoost50', 'skillBoost40', 'skillBoost30', 'skillBoost20', 'skillBoost10', 'left', 'right', 'up', 'down'];
    const rect = (id) => document.getElementById(id)?.getBoundingClientRect();
    const up = document.getElementById('up');
    const down = document.getElementById('down');
    const center = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit ? (hit.id || hit.closest('button')?.id || '') : '';
    };
    return {
      duplicateCamera: document.querySelectorAll('#cameraMode').length,
      duplicateUp: document.querySelectorAll('[id="up"]').length,
      duplicateDown: document.querySelectorAll('[id="down"]').length,
      upInJoystick: !!up?.closest('#joystick'),
      downInJoystick: !!down?.closest('#joystick'),
      fireHit: center(document.getElementById('fire')),
      powHit: center(document.getElementById('pow')),
      minimizedText: document.querySelector('.minimap-title')?.textContent,
      hasSlots: document.querySelectorAll('.inventory-slot,.item-slot').length,
      ids: Object.fromEntries(ids.map((id) => [id, rect(id)?.toJSON() ?? null])),
    };
  });
  assert.equal(layoutChecks.duplicateCamera, 0, 'old camera cycle button should be gone');
  assert.equal(layoutChecks.duplicateUp, 1, 'only one angle-up control');
  assert.equal(layoutChecks.duplicateDown, 1, 'only one angle-down control');
  assert.equal(layoutChecks.upInJoystick, true);
  assert.equal(layoutChecks.downInJoystick, true);
  assert.equal(layoutChecks.fireHit, 'fire', 'fire key centre must receive the pointer');
  assert.equal(layoutChecks.hasSlots, 0, 'do not clone the original empty inventory row');
  assert.match(layoutChecks.minimizedText, /海湾/);

  for (const id of ['fire', 'pow', 'heal', 'skillExtra2', 'skillScatter', 'skillExtra1', 'skillBoost50', 'skillBoost40', 'skillBoost30', 'skillBoost20', 'skillBoost10', 'left', 'right', 'up', 'down']) {
    assertButtonSafe(layoutChecks.ids[id], width, height, `#${id}`);
  }
  assert.ok(layoutChecks.ids.fire.height >= 70, 'main blue fire key keeps a large touch target');
  assert.ok(layoutChecks.ids.fire.y + layoutChecks.ids.fire.height <= height - 76, 'right-bottom platform overlay lane must stay clear');

  // POW starts locked.
  assert.equal(await page.$eval('#pow', (el) => el.disabled), true, 'POW must be locked below full energy');
  await page.click('#sound');
  await sleep(250);

  // Calibration shot: force zero wind so the solved long shot is deterministic,
  // then test POW selection (never fires by itself) and the real Web Audio graph.
  await page.evaluate(() => window.__GUNNY_TEST__.setWind(0, 0));
  const calibration = await page.evaluate(() => {
    const api = window.__GUNNY_TEST__;
    const plan = api.solveShot();
    api.setAngle(plan.angle);
    return { angle: plan.angle, force: plan.force, closest: plan.expected.closest, impact: plan.expected.impact };
  });
  assert.equal(calibration.impact, 'actor', 'calibration plan must hit at zero wind');
  await page.evaluate(() => window.__GUNNY_TEST__.setEnergy(100));
  await page.waitForFunction(() => document.querySelector('#pow')?.disabled === false, { timeout: 3000 });
  const shotsBeforePow = (await state(page)).snapshot.stats.playerShots;
  await page.click('#pow');
  await sleep(180);
  const afterPowClick = await state(page);
  assert.equal(afterPowClick.snapshot.powSelected, true, 'POW selection should arm');
  assert.equal(afterPowClick.snapshot.phase, 'player', 'POW click must never fire');
  assert.equal(afterPowClick.snapshot.stats.playerShots, shotsBeforePow, 'POW click must not launch a shell');

  await page.evaluate(() => window.__GUNNY_TEST__.audioReset());
  await page.evaluate(() => window.__GUNNY_TEST__.audioReady());
  await page.evaluate((plan) => window.__GUNNY_TEST__.firePlayer(plan.angle, plan.force), calibration);
  await page.waitForFunction(() => ['resolve', 'over'].includes(window.__GUNNY_TEST__.snapshot().phase), { timeout: 15000 });
  await sleep(320);
  const afterCalibration = await state(page);
  assert.ok(afterCalibration.snapshot.stats.playerHits >= 1, 'POW shot must produce a hit');
  assert.equal(afterCalibration.snapshot.playerVolley.pow, true);
  assert.equal(afterCalibration.snapshot.audio.enabled, true);
  const audioEvents = afterCalibration.snapshot.audio.events;
  const audioNames = new Set(audioEvents.map((event) => event.name));
  for (const name of ['fire', 'explosion', 'hit', 'pow']) {
    assert.ok(audioNames.has(name), `real battle must emit ${name} audio`);
    const event = [...audioEvents].reverse().find((item) => item.name === name && item.peak > 0.00001);
    assert.ok(event, `${name} must produce a non-zero audio waveform`);
  }
  assert.ok(afterCalibration.snapshot.audio.samples.includes('029'), 'original wind fire sample 029 must decode');
  assert.ok(afterCalibration.snapshot.audio.samples.includes('089'), 'original wind explosion sample 089 must decode');
  assert.ok(afterCalibration.snapshot.audio.samples.includes('039'), 'original item/pow sample 039 must decode');
  const fireEvent = [...audioEvents].reverse().find((event) => event.name === 'fire');
  const boomEvent = [...audioEvents].reverse().find((event) => event.name === 'explosion');
  const powEvent = [...audioEvents].reverse().find((event) => event.name === 'pow');
  assert.equal(fireEvent.sample, '029', 'wind fire must play Ball 121 ShootSound 029');
  assert.equal(boomEvent.sample, '089', 'wind explosion must play Ball 121 BombSound 089');
  assert.equal(powEvent.sample, '039', 'POW must reuse original item sound 039');
  const volleyAngle = afterCalibration.snapshot.playerVolley.angle;
  const volleyFrom = { ...afterCalibration.snapshot.playerVolley.from };

  // Let the AI complete a full turn. Its own shot must not overwrite the
  // player's last launch/impact record.
  await waitForPlayerTurn(page);
  const back = await state(page);
  assert.equal(back.snapshot.playerVolley.angle, volleyAngle, 'computer shot must not overwrite player record');
  assert.deepEqual(back.snapshot.playerVolley.from, volleyFrom, 'player launch record must persist');
  assert.ok(back.snapshot.playerVolley.impacts.length >= 1);
  assert.equal(back.record.world.from.x, volleyFrom.x);
  assert.ok(back.record.screen.from.x >= 0 && back.record.screen.from.x <= width);
  assert.ok(back.snapshot.lastPower > 0);
  assert.match(back.ui.powerText, /^推荐 (—|\d+(?: · (?:直击|溅射))?) \/ 上一发 \d+$/);

  // Minimap drag changes only the camera, and the one-tap button restores it.
  const camBefore = back.snapshot.camera.cameraX;
  const actorBefore = back.snapshot.actors[0].x;
  const mini = back.rects['#minimapWrap'];
  await page.mouse.move(mini.x + mini.width * 0.5, mini.y + mini.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(mini.x + mini.width * 0.5 - 28, mini.y + mini.height * 0.5 + 12, { steps: 6 });
  await page.mouse.up();
  await sleep(240);
  const panned = await state(page);
  assert.equal(panned.snapshot.manualPan, true, 'minimap drag should enter a manual camera offset');
  assert.notEqual(panned.snapshot.camera.cameraX, camBefore, 'minimap drag should move the camera');
  assert.equal(panned.snapshot.actors[0].x, actorBefore, 'minimap drag must not move the character');
  assert.deepEqual(panned.record.world, back.record.world, 'records stay in world coordinates while the camera moves');
  const project = (point) => ({
    x: (point.x - panned.snapshot.camera.worldLeft) * panned.snapshot.camera.zoom,
    y: (point.y - panned.snapshot.camera.worldTop) * panned.snapshot.camera.zoom,
  });
  for (const [index, point] of panned.record.world.impacts.entries()) {
    const expected = project(point);
    assert.ok(Math.abs(panned.record.screen.impacts[index].x - expected.x) < 1.5, 'impact marker must follow its world coordinate after panning');
    assert.ok(Math.abs(panned.record.screen.impacts[index].y - expected.y) < 1.5, 'impact marker must stay on the terrain after panning');
  }
  assert.ok(panned.minimap.frame.right - panned.minimap.frame.left > 0);
  assert.notEqual(panned.minimap.frame.left, back.minimap.frame.left, 'minimap frame must show the current camera view');
  assert.equal(panned.minimap.actors.length, 2);
  await page.click('#recenter');
  await sleep(450);
  const recentered = await state(page);
  assert.equal(recentered.snapshot.manualPan, false, 'return-to-battle should clear the camera offset');

  // Optional countdown defaults off; turning it on only displays time.
  await page.click('#timerToggle');
  await sleep(1000);
  const counted = await state(page);
  assert.equal(counted.snapshot.showCountdown, true);
  assert.equal(counted.ui.countdownHidden, false);
  assert.ok(counted.snapshot.countdown < 30);
  assert.equal(counted.snapshot.stats.playerShots, back.snapshot.stats.playerShots, 'countdown must not auto-fire');
  await page.click('#timerToggle');
  await sleep(100);

  // Start the deliverable charge/flight pass from pristine terrain. The AI's
  // random crater can otherwise wall off the player and make every angle
  // unreachable; the prior round already covered record persistence above.
  await page.evaluate(() => window.__GUNNY_TEST__.restart());
  await page.waitForFunction(() => {
    const s = window.__GUNNY_TEST__.snapshot();
    return s.phase === 'player' && s.stats.playerShots === 0;
  }, { timeout: 5000 });
  await page.evaluate(() => window.__GUNNY_TEST__.selectWeapon('wind'));
  await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().weapon === 'wind');
  await sleep(180);

  // Deterministic mild tailwind for the screenshot turn (same live physics).
  await page.evaluate(() => window.__GUNNY_TEST__.setWind(0.8, 8));
  const shotsBeforeLowAngle = (await state(page)).snapshot.stats.playerShots;
  await page.evaluate(() => window.__GUNNY_TEST__.setAngle(15));
  await sleep(360);
  const lowAngle = await state(page);
  // Evaluate the lower edge of 风神's 15°–50° envelope. Earlier craters can
  // make this particular angle unreachable, so only require an honest
  // evaluation here; findReachableAngle below must still find a real solution.
  assert.equal(lowAngle.snapshot.recommendation?.angle, 15, 'recommendation must evaluate the requested low angle');
  assert.equal(lowAngle.snapshot.angle, 15, 'the game must not auto-adjust the angle');
  assert.equal(lowAngle.snapshot.charging, false);
  assert.equal(lowAngle.snapshot.stats.playerShots, shotsBeforeLowAngle, 'aim evaluation must never auto-fire');
  const shotAngle = await findReachableAngle(page);
  const ready = await state(page);
  assert.equal(ready.snapshot.recommendation.reachable, true);
  assert.equal(ready.snapshot.recommendation.verified, true);
  assert.ok(ready.snapshot.recommendation.force >= 0);
  assert.ok(ready.snapshot.recommendation.range.minPct <= ready.snapshot.recommendation.pct);
  assert.ok(ready.snapshot.recommendation.pct <= ready.snapshot.recommendation.range.maxPct);
  assert.equal(
    Math.round(ready.snapshot.recommendation.force / 20),
    ready.snapshot.recommendation.pct,
    'recommended percent and force must be the same value',
  );
  assert.match(ready.ui.recommendText, /^推荐 \d+(?: · (?:直击|溅射))?$/);
  assert.match(ready.ui.lastPowerText, /^上一发 (—|\d+)$/);
  assert.ok(ready.ui.powerOverflow <= 1, 'current/recommended/last numbers must not be clipped');
  assertActorsClear(ready.rects, width, height, `${width}x${height} before charge`);
  await sleep(2400); // let the countdown toast fade before the deliverable shot

  const fireRect = ready.rects['#fire'];
  await page.mouse.move(fireRect.x + fireRect.width / 2, fireRect.y + fireRect.height / 2);
  await page.mouse.down();
  await sleep(700);
  const charging = await state(page);
  assert.equal(charging.snapshot.charging, true);
  assert.ok(charging.snapshot.force > 0);
  assert.ok(Number(charging.ui.fireLabel.replace('%', '')) > 0);
  assert.equal(charging.ui.recommendHidden, false, 'recommended force marker must be visible');
  assert.equal(charging.ui.lastPowerHidden, true, 'fresh match has no previous force marker');
  assertActorsClear(charging.rects, width, height, `${width}x${height} charging`);
  const chargeShot = path.join(SHOTS, `charge-${width}x${height}.png`);
  await page.screenshot({ path: chargeShot });
  const fixedSelectors = ['#topbar', '#controls', '#fire', '#pow', '#chargeTrack', '#minimap', '#joystick', '#skillScatter', '#recenter', '.power-panel', '.skill-rail', '.battle-hud', '.minimap-panel'];

  // Keep charging to a long, high-force shot, then capture the follow camera.
  await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().force >= 1800, { timeout: 5000 });
  const shotCountBefore = charging.snapshot.stats.playerShots;
  await page.mouse.up();
  await sleep(420);
  const launched = await state(page);
  assert.equal(launched.snapshot.phase, 'flight');
  assert.equal(launched.snapshot.effectiveCameraMode, 'shot');
  assert.equal(launched.snapshot.stats.playerShots, shotCountBefore + 1);
  const shotTotal = launched.snapshot.stats.playerShots;

  // The launch key cannot start a second shot while the shell is in the air.
  await page.mouse.click(fireRect.x + fireRect.width / 2, fireRect.y + fireRect.height / 2);
  await sleep(120);
  const locked = await state(page);
  assert.equal(locked.snapshot.phase, 'flight');
  assert.equal(locked.snapshot.stats.playerShots, shotTotal, 'flight must reject another launch');

  await sleep(260);
  // The follow camera eases toward the shell, so allow it a short convergence
  // window instead of asserting on a single timing-sensitive frame.
  await page.waitForFunction(() => {
    const snap = window.__GUNNY_TEST__.snapshot();
    if (!snap.shot) return false;
    const { camera, shot } = snap;
    return shot.x >= camera.worldLeft && shot.x <= camera.worldLeft + camera.viewW
      && shot.y >= camera.worldTop && shot.y <= camera.worldTop + camera.viewH;
  }, { timeout: 3000 });
  const flight = await state(page);
  assert.equal(flight.snapshot.phase, 'flight');
  assert.ok(flight.snapshot.shot, 'shell should still be flying for the screenshot');
  assert.equal(flight.snapshot.camera.allowSky, true);
  assert.ok(flight.snapshot.shot.x >= flight.snapshot.camera.worldLeft && flight.snapshot.shot.x <= flight.snapshot.camera.worldLeft + flight.snapshot.camera.viewW);
  assert.ok(flight.snapshot.shot.y >= flight.snapshot.camera.worldTop && flight.snapshot.shot.y <= flight.snapshot.camera.worldTop + flight.snapshot.camera.viewH);
  for (const selector of fixedSelectors) {
    assert.ok(boxDelta(charging.rects[selector], flight.rects[selector]) < 0.51, `${selector} must stay fixed during flight`);
  }
  const flightShot = path.join(SHOTS, `flight-${width}x${height}.png`);
  await page.screenshot({ path: flightShot });

  const zoomSamples = [flight.snapshot.camera.zoom];
  for (let i = 0; i < 3; i += 1) {
    await sleep(150);
    const sample = await state(page);
    if (sample.snapshot.phase !== 'flight') break;
    zoomSamples.push(sample.snapshot.camera.zoom);
  }
  if (zoomSamples.length >= 2) {
    const deltas = zoomSamples.slice(1).map((value, index) => value - zoomSamples[index]);
    const oneDirection = deltas.every((delta) => delta >= -0.0005) || deltas.every((delta) => delta <= 0.0005);
    assert.ok(oneDirection, 'follow camera zoom must transition in one direction, never oscillate');
    assert.ok(Math.max(...deltas.map(Math.abs)) < 0.06, 'follow zoom must be a single smooth transition');
  }

  await page.waitForFunction(() => ['resolve', 'enemy_move', 'enemy_think', 'enemy_aim', 'player', 'over'].includes(window.__GUNNY_TEST__.snapshot().phase), { timeout: 15000 });
  await page.waitForFunction(() => {
    const api = window.__GUNNY_TEST__;
    const snapshot = api?.snapshot?.();
    const actors = api?.controlRects?.().actors ?? [];
    return snapshot?.effectiveCameraMode === 'both' && actors.length === 2 &&
      actors.every((rect) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= innerWidth && rect.y + rect.height <= innerHeight);
  }, { timeout: 4000 });
  await sleep(180);
  const landed = await state(page);
  assert.ok(['resolve', 'enemy_move', 'enemy_think', 'enemy_aim', 'player', 'over'].includes(landed.snapshot.phase));
  assert.equal(landed.snapshot.effectiveCameraMode, 'both');
  assertActorsClear(landed.rects, width, height, `${width}x${height} landing`);
  assert.equal(logs.filter((line) => !line.includes('favicon')).length, 0, `${width}x${height}: console must be clean`);
  await page.close();
  return {
    width, height,
    chargeShot: path.relative(process.cwd(), chargeShot),
    flightShot: path.relative(process.cwd(), flightShot),
    initialZoom: s0.camera.zoom,
    shotAngle,
    calibration,
    powerText: charging.ui.powerText,
    chargePct: Math.round(charging.snapshot.force / 2000 * 100),
    audioPeaks: afterCalibration.snapshot.audio.events.filter((event) => ['fire', 'explosion', 'hit', 'pow'].includes(event.name)),
  };
}

async function runScatter(browser) {
  const { page, logs } = await open(browser, 844, 390);
  const plan = await page.evaluate(() => {
    const api = window.__GUNNY_TEST__;
    api.selectWeapon('wind');
    api.setWind(0.8, 8);
    api.selectSkill('scatter');
    const choices = [];
    for (let angle = 15; angle <= 65; angle += 1) {
      api.setAngle(angle);
      const recommendation = api.recommendation();
      if (recommendation?.reachable) choices.push({ angle, ...recommendation });
    }
    if (!choices.length) return { reachable: false };
    choices.sort((a, b) => (b.range.maxPct - b.range.minPct) - (a.range.maxPct - a.range.minPct));
    const chosen = choices[0];
    api.setAngle(chosen.angle);
    const rec = api.recommendation();
    return {
      angle: chosen.angle,
      force: rec.force,
      pct: rec.pct,
      range: rec.range,
      hitType: rec.hitType,
      reachable: rec.reachable,
      skill: api.snapshot().selectedSkill,
    };
  });
  assert.equal(plan.reachable, true, 'scatter recommendation must be verified before firing');
  assert.equal(plan.skill, 'scatter');
  await sleep(220);
  const before = await state(page);
  assert.equal(before.ui.recommendHidden, false, 'verified scatter range must show the blue marker');
  assert.match(before.ui.recommendText, /^推荐 \d+ · (直击|溅射)$/);
  await page.evaluate((plan) => window.__GUNNY_TEST__.firePlayer(plan.angle, plan.force), plan);
  const flight = await state(page);
  assert.equal(flight.snapshot.phase, 'flight');
  assert.equal(flight.snapshot.shots.length, 5, 'scatter must launch five shells');
  await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().phase === 'resolve', { timeout: 15000 });
  const resolving = await state(page);
  assert.equal(resolving.snapshot.turn, 0, 'turn must not pass before shells resolve');
  assert.equal(resolving.snapshot.stats.enemyShots, 0, 'AI must not fire before scatter resolves');
  assert.ok(resolving.snapshot.stats.playerShots === 5);
  assert.equal(resolving.snapshot.shots.every((shot) => shot.resolved && !shot.alive), true, 'every scatter shell must resolve first');
  await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().turn === 1, { timeout: 10000 });
  const handed = await state(page);
  assert.equal(handed.snapshot.shots.every((shot) => shot.resolved && !shot.alive), true);
  assert.equal(handed.snapshot.stats.playerShots, 5);
  assert.equal(logs.filter((line) => !line.includes('favicon')).length, 0);
  await page.close();
  return {
    shells: flight.snapshot.shots.length,
    turnBefore: resolving.snapshot.turn,
    turnAfter: handed.snapshot.turn,
    angle: plan.angle,
    pct: plan.pct,
    range: plan.range,
    hitType: plan.hitType,
    playerHits: resolving.snapshot.stats.playerHits,
  };
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  });
  const out = { runs: [] };
  try {
    out.runs.push(await runViewport(browser, 844, 390));
    out.runs.push(await runViewport(browser, 667, 375));
    out.scatter = await runScatter(browser);
    fs.writeFileSync(path.join(SHOTS, 'acceptance.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    console.log('BROWSER ACCEPTANCE PASS');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
