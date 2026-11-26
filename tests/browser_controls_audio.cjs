/**
 * Real-input acceptance for the focus fix, fixed skill slots, POW shortcut and
 * source-audio bridge. Run with Chrome + `GUNNY_DEBUG=1 npm start`.
 */
const puppeteer = require('puppeteer-core');
const assert = require('node:assert/strict');

const URL = process.env.GAME_URL || 'http://127.0.0.1:8000/?test=1';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function open(browser, { width = 844, height = 390, hasTouch = false, blockAudio = false, breakAudio = false, weapon = 'fruit' } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, hasTouch, isMobile: hasTouch });
  const logs = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('ERR_FAILED')) logs.push(message.text());
  });
  page.on('pageerror', (error) => logs.push(`PAGEERROR: ${error.message}`));
  if (blockAudio) {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().includes('/assets/audio/')) request.abort();
      else request.continue();
    });
  }
  if (breakAudio) {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true });
      Object.defineProperty(window, 'webkitAudioContext', { value: undefined, configurable: true });
    });
  }
  await page.goto(`${URL}&fresh=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__GUNNY_TEST__?.ready, { timeout: 60000 });
  await sleep(500);
  if (weapon) {
    await page.evaluate((id) => window.__GUNNY_TEST__.selectWeapon(id), weapon);
    await page.waitForFunction(
      (id) => window.__GUNNY_TEST__.snapshot().weapon === id,
      { timeout: 3000 },
      weapon,
    );
  }
  return { page, logs };
}

async function snapshot(page) {
  return page.evaluate(() => window.__GUNNY_TEST__.snapshot());
}

async function center(page, selector) {
  return page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
}

async function audioEvents(page, name = null) {
  const s = await snapshot(page);
  return name ? s.audio.events.filter((event) => event.name === name) : s.audio.events;
}

async function holdSpaceUntil(page, predicate, timeout = 5000) {
  await page.keyboard.down('Space');
  await page.waitForFunction(predicate, { timeout, polling: 16 });
  await page.keyboard.up('Space');
}

/** Release on the exact animation frame at which the requested force appears. */
async function releaseSpaceAtForce(page, target, timeout = 5000) {
  const reached = await page.evaluate((targetForce) => new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      const api = window.__GUNNY_TEST__;
      const force = api.force();
      if (force != null && force >= targetForce) {
        window.dispatchEvent(new KeyboardEvent('keyup', {
          key: ' ', code: 'Space', bubbles: true,
        }));
        resolve(force);
        return;
      }
      if (performance.now() - started > 5000) {
        resolve(null);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  }), target, { timeout });
  await page.keyboard.up('Space');
  assert.notEqual(reached, null, 'charge target was not reached');
  return reached;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  });
  const out = {};
  try {
    // A. Mouse-select a skill, then the very first Space must charge. Selection
    // must not play fire/POW early, and one volley must emit one launch sound.
    {
      const { page, logs } = await open(browser);
      await page.evaluate(() => window.__GUNNY_TEST__.audioReset());
      const idle = await snapshot(page);
      assert.ok([0, 8, 9, 10].includes(idle.poses[0].frame), `idle player must use STAND, got ${idle.poses[0].frame}`);
      assert.equal(idle.poses[0].weaponVisible, false, 'idle player weapon must stay on the back');
      assert.equal(idle.poses[1].weaponVisible, false, 'idle enemy weapon must stay on the back');
      const p = await center(page, '#skillExtra2');
      await page.mouse.click(p.x, p.y);
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().selectedSkill === 'extra2');
      const selected = await snapshot(page);
      assert.equal(selected.charging, false);
      assert.equal(selected.stats.playerShots, 0, 'selecting a skill must not fire');
      assert.equal((await audioEvents(page, 'fire')).length, 0, 'selection must not play fire');
      assert.equal((await audioEvents(page, 'pow')).length, 0, 'selection must not play POW');
      assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'skillExtra2', 'skill button must release focus');

      await page.keyboard.down('Space');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().charging === true, { timeout: 800 });
      const charging = await snapshot(page);
      assert.equal(charging.charging, true, 'first Space after mouse skill selection must charge');
      assert.equal(charging.selectedSkill, 'extra2');
      assert.equal(charging.poses[0].weaponVisible, true, 'charging must raise the weapon');
      assert.ok([19, 20, 21].includes(charging.poses[0].frame), `charging must use SHOWGUN, got ${charging.poses[0].frame}`);
      await sleep(260);
      await page.keyboard.up('Space');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().stats.playerShots >= 3, { timeout: 3000 });
      await page.waitForFunction(() => {
        const pose = window.__GUNNY_TEST__.snapshot().poses?.[0];
        return pose?.weaponVisible && [22, 23, 26, 27].includes(pose.frame);
      }, { timeout: 1200 });
      const fired = await snapshot(page);
      assert.equal(fired.phase, 'flight');
      assert.equal(fired.stats.playerShots, 3, 'extra2 must launch three shells');
      assert.equal(fired.selectedSkill, null, 'skill is spent only after the volley starts');
      assert.equal(fired.poses[0].weaponVisible, true, 'firing must keep the weapon raised');
      assert.ok([22, 23, 26, 27].includes(fired.poses[0].frame), `firing must use SHOT, got ${fired.poses[0].frame}`);
      await page.evaluate(() => window.__GUNNY_TEST__.audioReady());
      const fire = await audioEvents(page, 'fire');
      assert.equal(fire.length, 1, 'one extra2 volley must emit one launch sound');
      assert.equal(fire[0].sample, '114', 'fruit launch must use Ball 401 ShootSound 114');
      assert.equal((await audioEvents(page, 'pow')).length, 0);
      assert.equal(logs.length, 0, `A console: ${logs.join(' | ')}`);
      out.focusSkillSpace = { selected: 'extra2', shells: fired.stats.playerShots, fireEvents: fire.length, fireSample: fire[0].sample };
      await page.close();
    }

    // B. Fixed number slot, key repeat guard, R energy failure / selection,
    // and a real POW volley (R must never auto-fire). POW reuses item sound 039.
    {
      const { page, logs } = await open(browser);
      await page.evaluate(() => window.__GUNNY_TEST__.audioReady());
      await page.evaluate(() => {
        const api = window.__GUNNY_TEST__;
        api.setWind(0, 0);
        api.setAngle(26);
        api.audioReset();
      });
      await page.keyboard.press('2');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().selectedSkill === 'scatter');
      let s = await snapshot(page);
      assert.equal(s.stats.playerShots, 0, 'number key must only select');
      assert.equal((await audioEvents(page, 'fire')).length, 0);
      assert.equal((await audioEvents(page, 'skill-select'))[0].sample, '008', 'selection must use original UI sound 008');

      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {
        key: '2', code: 'Digit2', bubbles: true, repeat: true,
      })));
      s = await snapshot(page);
      assert.equal(s.selectedSkill, 'scatter', 'held number key must not toggle repeatedly');

      await page.evaluate(() => window.__GUNNY_TEST__.setEnergy(0));
      await page.keyboard.press('r');
      await sleep(80);
      s = await snapshot(page);
      assert.equal(s.powSelected, false);
      assert.equal(s.selectedSkill, 'scatter', 'failed POW shortcut must preserve the current skill');
      assert.match(await page.$eval('#toast', (el) => el.textContent), /能量不足/);

      await page.evaluate(() => window.__GUNNY_TEST__.setEnergy(100));
      await page.keyboard.press('r');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().powSelected === true);
      s = await snapshot(page);
      assert.equal(s.selectedSkill, 'scatter', 'R must not clear the selected skill');
      assert.equal(s.phase, 'player', 'R must not fire');
      assert.equal(s.stats.playerShots, 0, 'R must not launch a shell');
      assert.equal((await audioEvents(page, 'fire')).length, 0, 'R selection must not play launch sound');
      assert.equal((await audioEvents(page, 'pow')).length, 0, 'R selection must not play POW impact sound');

      await page.keyboard.press('r');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().powSelected === false);
      assert.equal((await snapshot(page)).stats.playerShots, 0, 'R cancel must not fire');
      await page.keyboard.press('r');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().powSelected === true);

      await page.keyboard.press('2'); // deselect scatter, keep POW armed
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().selectedSkill === null);
      const plan = await page.evaluate(() => window.__GUNNY_TEST__.recommendation());
      assert.equal(plan.reachable, true, 'POW recommendation must verify');
      await page.evaluate(() => window.__GUNNY_TEST__.audioReset());
      await page.evaluate((p) => window.__GUNNY_TEST__.firePlayer(p.angle, p.force), plan);
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().stats.playerShots === 1, { timeout: 3000 });
      s = await snapshot(page);
      assert.equal(s.playerVolley.pow, true);
      assert.equal(s.stats.playerShots, 1, 'one blue-key press must launch one POW shell');
      await page.waitForFunction(() => ['resolve', 'over'].includes(window.__GUNNY_TEST__.snapshot().phase), { timeout: 15000 });
      s = await snapshot(page);
      assert.ok(s.stats.playerHits >= 1, `POW at solved angle must hit: ${JSON.stringify({ volley: s.playerVolley, last: s.lastImpact, actors: s.actors.map((a) => ({ x: a.x, y: a.y, hp: a.hp })) })}`);
      const fire = await audioEvents(page, 'fire');
      const pow = await audioEvents(page, 'pow');
      assert.equal(fire.length, 1, 'POW volley must emit launch sound once');
      assert.equal(pow.length, 1, 'POW activation must emit item sound once');
      assert.equal(fire[0].sample, '114');
      assert.equal(pow[0].sample, '039');
      assert.ok(fire[0].peak > 0 && pow[0].peak > 0, 'source samples must produce audio');
      assert.equal(logs.length, 0, `B console: ${logs.join(' | ')}`);
      out.numberAndPow = {
        preselectShots: 0,
        shells: 1,
        hit: s.stats.playerHits,
        fireSample: fire[0].sample,
        powSample: pow[0].sample,
      };
      await page.close();
    }

    // B2. R + a real Space press must launch exactly one POW shell.
    {
      const { page, logs } = await open(browser);
      await page.evaluate(() => {
        const api = window.__GUNNY_TEST__;
        api.setWind(0, 0);
        api.setAngle(26);
        api.setEnergy(100);
        api.audioReset();
      });
      await page.keyboard.press('r');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().powSelected === true);
      assert.equal((await snapshot(page)).stats.playerShots, 0, 'R alone must not fire');
      await page.keyboard.down('Space');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().charging === true, { timeout: 800 });
      await sleep(250);
      await page.keyboard.up('Space');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().stats.playerShots === 1, { timeout: 3000 });
      const s = await snapshot(page);
      assert.equal(s.phase, 'flight');
      assert.equal(s.playerVolley.pow, true, 'Space after R must fire the selected POW');
      assert.equal(s.stats.playerShots, 1, 'R + Space must launch one shell');
      await page.evaluate(() => window.__GUNNY_TEST__.audioReady());
      assert.equal((await audioEvents(page, 'fire')).length, 1);
      assert.equal((await audioEvents(page, 'pow')).length, 1);
      assert.equal(logs.length, 0, `B2 console: ${logs.join(' | ')}`);
      out.powByKeyboard = { shots: s.stats.playerShots, pow: s.playerVolley.pow };
      await page.close();
    }

    // B3. Per-weapon fire/boom matrix from BombConfig.xml + BallList.xml.
    {
      const { page, logs } = await open(browser);
      await page.evaluate(() => window.__GUNNY_TEST__.audioEnable());
      await page.evaluate(() => window.__GUNNY_TEST__.audioReady());
      const expected = {
        fire: { fire: '025', cannon: '023', fruit: '114', appliance: '110', wind: '029' },
        explosion: { fire: '087', cannon: '087', fruit: '102', appliance: '100', wind: '089' },
      };
      const matrix = {};
      for (const [name, byWeapon] of Object.entries(expected)) {
        matrix[name] = {};
        for (const [weapon, sample] of Object.entries(byWeapon)) {
          await page.evaluate(({ soundName, weaponId }) => {
            const api = window.__GUNNY_TEST__;
            api.audioReset();
            api.audioPlay(soundName, weaponId);
          }, { soundName: name, weaponId: weapon });
          await sleep(140);
          const event = (await audioEvents(page, name)).at(-1);
          assert.ok(event, `${weapon} ${name} must emit an audio event`);
          assert.equal(event.sample, sample, `${weapon} ${name} must use Sound${sample}`);
          assert.ok(event.peak > 0.00001, `${weapon} ${name} must produce a waveform`);
          matrix[name][weapon] = event.sample;
        }
      }
      assert.equal(logs.length, 0, `B3 console: ${logs.join(' | ')}`);
      out.weaponSoundMatrix = matrix;
      await page.close();
    }

    // C. Ordinary cannon via the real mouse fire button: one launch, original
    // explosion at ground contact, synth replacement at actual HP loss.
    {
      const { page, logs } = await open(browser);
      await page.evaluate(() => {
        const api = window.__GUNNY_TEST__;
        api.setWind(0, 0);
        api.setAngle(26);
        api.audioReset();
      });
      await page.evaluate(() => window.__GUNNY_TEST__.audioEnable());
      await page.evaluate(() => window.__GUNNY_TEST__.audioReady());
      const plan = await page.evaluate(() => window.__GUNNY_TEST__.recommendation());
      assert.equal(plan.reachable, true, 'ordinary cannon recommendation must verify');
      await page.evaluate((p) => window.__GUNNY_TEST__.firePlayer(p.angle, p.force), plan);
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().phase === 'flight', { timeout: 2000 });
      let s = await snapshot(page);
      assert.equal(s.stats.playerShots, 1);
      assert.equal(s.playerVolley.pow, false);
      await page.waitForFunction(() => ['resolve', 'over'].includes(window.__GUNNY_TEST__.snapshot().phase), { timeout: 15000 });
      s = await snapshot(page);
      assert.ok(s.stats.playerHits >= 1, 'ordinary cannon at solved angle must hit');
      await page.evaluate(() => window.__GUNNY_TEST__.audioReady());
      const launches = await audioEvents(page, 'fire');
      const booms = await audioEvents(page, 'explosion');
      const hits = await audioEvents(page, 'hit');
      assert.equal(launches.length, 1, 'normal shot must play launch once');
      assert.equal(launches[0].sample, '114');
      assert.ok(booms.length >= 1 && booms[0].sample === '102', 'ground contact must play fruit BombSound 102');
      assert.ok(hits.length >= 1, 'actual HP loss must emit hit');
      assert.equal(hits[0].sample, null, 'hit is the documented synth replacement (no original ID)');
      assert.ok(hits[0].peak > 0, 'hit replacement must produce audio');
      assert.equal(logs.length, 0, `C console: ${logs.join(' | ')}`);
      out.normalCannon = {
        shots: s.stats.playerShots,
        hits: s.stats.playerHits,
        launch: launches[0].sample,
        explosion: booms[0].sample,
        hit: 'synth-replacement',
      };
      await page.close();
    }

    // D. Explicit mute must not block charging or firing.
    {
      const { page, logs } = await open(browser);
      await page.click('#sound');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().audio.enabled === true);
      await page.click('#sound');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().audio.enabled === false);
      const muted = await snapshot(page);
      assert.equal(muted.audio.userMuted, true);
      await page.evaluate(() => window.__GUNNY_TEST__.audioReset());
      await page.keyboard.down('Space');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().charging === true, { timeout: 800 });
      await sleep(220);
      await page.keyboard.up('Space');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().phase === 'flight', { timeout: 2500 });
      const s = await snapshot(page);
      assert.equal(s.stats.playerShots, 1, 'muted audio must not block the shot');
      assert.equal((await audioEvents(page)).length, 0, 'muted audio must not emit events');
      assert.equal(logs.length, 0, `D console: ${logs.join(' | ')}`);
      out.muted = { shots: s.stats.playerShots, audioEvents: 0 };
      await page.close();
    }

    // E. If all source files fail to load, the synth fallback still plays and
    // charging/firing still work.
    {
      const { page, logs } = await open(browser, { blockAudio: true });
      await page.keyboard.press('1');
      await page.evaluate(() => window.__GUNNY_TEST__.audioReady());
      let s = await snapshot(page);
      assert.equal(s.audio.enabled, true);
      assert.equal(s.audio.samples.length, 0, 'blocked audio files must not decode');
      assert.ok(s.audio.sampleError.length > 0);
      await page.evaluate(() => window.__GUNNY_TEST__.audioReset());
      await page.keyboard.down('Space');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().charging === true, { timeout: 800 });
      await sleep(260);
      await page.keyboard.up('Space');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().phase === 'flight', { timeout: 2500 });
      await sleep(260);
      const launches = await audioEvents(page, 'fire');
      assert.equal(launches.length, 1);
      assert.equal(launches[0].sample, null, 'missing file must fall back, not pretend to be original');
      assert.ok(launches[0].peak > 0, 'fallback waveform must be audible');
      assert.equal(logs.length, 0, `E console: ${logs.join(' | ')}`);
      out.loadFailureFallback = { samples: 0, launchSample: launches[0].sample, shots: (await snapshot(page)).stats.playerShots };
      await page.close();
    }

    // F. AudioContext construction failure must not block gameplay.
    {
      const { page, logs } = await open(browser, { breakAudio: true });
      await page.keyboard.press('1');
      await page.keyboard.down('Space');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().charging === true, { timeout: 800 });
      await sleep(220);
      await page.keyboard.up('Space');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().phase === 'flight', { timeout: 2500 });
      const s = await snapshot(page);
      assert.equal(s.audio.enabled, false);
      assert.equal(s.stats.playerShots, 3, 'audio-unlock failure must not block an extra2 volley');
      assert.equal(logs.length, 0, `F console: ${logs.join(' | ')}`);
      out.audioUnlockFailure = { enabled: false, shots: s.stats.playerShots };
      await page.close();
    }

    // G. Text inputs and the help dialog keep their original keyboard behavior.
    {
      const { page, logs } = await open(browser);
      await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'probe';
        document.body.appendChild(input);
        input.focus();
      });
      await page.keyboard.press('1');
      await page.keyboard.press('r');
      await page.keyboard.press('Space');
      let s = await snapshot(page);
      assert.equal(s.selectedSkill, null, 'typing 1 in an input must not select a skill');
      assert.equal(s.powSelected, false, 'typing r in an input must not select POW');
      assert.equal(s.charging, false, 'Space in an input must not charge');
      await page.evaluate(() => document.querySelector('#probe').remove());
      await page.click('#help');
      await page.waitForFunction(() => document.querySelector('#modal').hidden === false);
      await page.keyboard.press('1');
      await page.keyboard.down('Space');
      await sleep(100);
      s = await snapshot(page);
      assert.equal(s.charging, false, 'help dialog must keep Space');
      assert.equal(s.selectedSkill, null, 'help dialog must not select skills');
      await page.keyboard.up('Space');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#modal').hidden === true);
      await sleep(120);
      await page.keyboard.press('1');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().selectedSkill === 'extra2');
      await page.keyboard.down('Space');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().charging === true, { timeout: 800 });
      await sleep(180);
      await page.keyboard.up('Space');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().phase === 'flight', { timeout: 2500 });
      assert.equal((await snapshot(page)).stats.playerShots, 3);
      assert.equal(logs.length, 0, `G console: ${logs.join(' | ')}`);
      out.inputIsolation = { inputBlocked: true, helpBlocked: true, postCloseShots: 3 };
      await page.close();
    }

    // H. Touch uses the same pointer event chain: tap skill, hold fire.
    {
      const { page, logs } = await open(browser, { width: 667, height: 375, hasTouch: true });
      await page.evaluate(() => window.__GUNNY_TEST__.audioReset());
      const skill = await center(page, '#skillScatter');
      await page.touchscreen.tap(skill.x, skill.y);
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().selectedSkill === 'scatter');
      assert.equal((await audioEvents(page, 'fire')).length, 0, 'touch skill tap must not fire');
      const fire = await center(page, '#fire');
      await page.touchscreen.touchStart(fire.x, fire.y);
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().charging === true, { timeout: 1200 });
      await sleep(260);
      await page.touchscreen.touchEnd();
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().stats.playerShots === 5, { timeout: 3000 });
      const s = await snapshot(page);
      assert.equal(s.phase, 'flight');
      assert.equal(s.stats.playerShots, 5, 'one touch hold must launch five scatter shells');
      const fireSounds = await audioEvents(page, 'fire');
      assert.equal(fireSounds.length, 1, 'scatter must play launch once, not once per shell');
      assert.equal(fireSounds[0].sample, '114');
      assert.equal(logs.length, 0, `H console: ${logs.join(' | ')}`);
      out.touch = { skill: 'scatter', shells: s.stats.playerShots, fireEvents: fireSounds.length };
      await page.close();
    }

    // H2. A pure terrain graze only explodes: no hit event until HP is lost.
    {
      const { page, logs } = await open(browser);
      const setup = await page.evaluate(() => {
        const api = window.__GUNNY_TEST__;
        api.setWind(0, 0);
        api.setAngle(15);
        api.audioReset();
        const preview = api.simulate(15, 800);
        return { impact: preview.impact, closest: preview.closest };
      });
      assert.equal(setup.impact, 'ground', 'graze test must land on terrain');
      await page.evaluate(() => window.__GUNNY_TEST__.audioEnable());
      await page.evaluate(() => window.__GUNNY_TEST__.audioReady());
      await page.evaluate(() => window.__GUNNY_TEST__.firePlayer(15, 800));
      await page.waitForFunction(() => ['resolve', 'over'].includes(window.__GUNNY_TEST__.snapshot().phase), { timeout: 15000 });
      const s = await snapshot(page);
      assert.equal(s.stats.playerHits, 0, 'terrain graze must not count as hit');
      assert.equal(s.lastImpact.damage, 0, 'terrain graze must not deduct HP');
      assert.ok(s.playerVolley.impacts.every((impact) => impact.damage === 0));
      const booms = await audioEvents(page, 'explosion');
      const hits = await audioEvents(page, 'hit');
      assert.ok(booms.length >= 1 && booms[0].sample === '102', 'terrain contact must play fruit BombSound 102');
      assert.equal(hits.length, 0, 'no HP loss means no hit sound');
      assert.equal(logs.length, 0, `H2 console: ${logs.join(' | ')}`);
      out.grazeOnly = { impact: s.lastImpact.type, damage: s.lastImpact.damage, explosion: booms[0].sample, hitEvents: hits.length };
      await page.close();
    }

    // H3. Heal is an immediate item action: key H heals, reuses 039, never fires.
    {
      const { page, logs } = await open(browser);
      await page.evaluate(() => {
        const api = window.__GUNNY_TEST__;
        api.setHp(0, 5000);
        api.audioReset();
      });
      const before = await snapshot(page);
      const beforeHp = before.actors[0].hp;
      await page.keyboard.press('h');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().phase === 'heal', { timeout: 2500 });
      await page.waitForFunction(
        (hp) => window.__GUNNY_TEST__.snapshot().actors[0].hp > hp,
        { timeout: 2500 },
        beforeHp,
      );
      const s = await snapshot(page);
      assert.equal(s.stats.playerHeals, 1, 'key H must heal immediately');
      assert.ok(s.actors[0].hp > beforeHp);
      assert.equal(s.stats.playerShots, before.stats.playerShots, 'heal must not fire');
      await page.evaluate(() => window.__GUNNY_TEST__.audioReady());
      await sleep(320);
      const heal = await audioEvents(page, 'heal');
      assert.equal(heal.length, 1);
      assert.equal(heal[0].sample, '039');
      assert.ok(heal[0].peak > 0);
      assert.equal((await audioEvents(page, 'fire')).length, 0);
      assert.equal(logs.length, 0, `H3 console: ${logs.join(' | ')}`);
      out.heal = { heals: s.stats.playerHeals, sample: heal[0].sample, shots: s.stats.playerShots };
      await page.close();
    }

    // I. Continuous verified range draws the blue band; empty slot 5 is a
    // no-op and the fixed slot order/keys never change.
    {
      const { page, logs } = await open(browser);
      await page.evaluate(() => {
        const api = window.__GUNNY_TEST__;
        api.setWind(0.8, 8);
        api.setAngle(26);
      });
      await page.keyboard.press('3');
      await page.waitForFunction(() => window.__GUNNY_TEST__.snapshot().selectedSkill === 'extra1');
      await page.waitForFunction(() => document.querySelector('#recommendBand')?.hidden === false, { timeout: 4000 });
      const rangeUi = await page.evaluate(() => {
        const band = document.querySelector('#recommendBand');
        const track = document.querySelector('#chargeTrack');
        return {
          hidden: band.hidden,
          width: band.getBoundingClientRect().width,
          start: track.style.getPropertyValue('--recommend-start'),
          end: track.style.getPropertyValue('--recommend-end'),
          recommend: document.querySelector('#recommendText').textContent,
          title: document.querySelector('#recommendMarker').getAttribute('title'),
          verified: window.__GUNNY_TEST__.recommendation(),
          order: [...document.querySelectorAll('.skill-button')].map((el) => el.id),
          keys: [...document.querySelectorAll('.skill-key')].map((el) => el.textContent),
        };
      });
      assert.equal(rangeUi.hidden, false, 'continuous hit window must show the blue range band');
      assert.ok(rangeUi.width > 1, 'range band must have visible width');
      assert.equal(rangeUi.verified.reachable, true);
      assert.equal(rangeUi.verified.hitType, 'direct');
      assert.equal(rangeUi.start, `${rangeUi.verified.range.minPct}%`);
      assert.equal(rangeUi.end, `${rangeUi.verified.range.maxPct}%`);
      assert.match(rangeUi.recommend, new RegExp(`^推荐 ${rangeUi.verified.pct} ·`));
      assert.match(rangeUi.title, new RegExp(`${rangeUi.verified.pct}%`));
      assert.deepEqual(rangeUi.order, ['skillExtra2', 'skillScatter', 'skillExtra1', 'skillBoost50', 'skillBoost40', 'skillBoost30', 'skillBoost20', 'skillBoost10']);
      assert.deepEqual(rangeUi.keys, ['1', '2', '3', '4', '5', '6', '7', '8', 'R']);
      const before = await snapshot(page);
      await page.keyboard.press('9');
      await sleep(80);
      const after = await snapshot(page);
      assert.equal(after.selectedSkill, 'extra1', 'empty slot 9 must do nothing');
      assert.equal(after.stats.playerShots, before.stats.playerShots);
      assert.equal(logs.length, 0, `I console: ${logs.join(' | ')}`);
      out.rangeAndSlots = { bandWidth: rangeUi.width, recommend: rangeUi.recommend, slots: rangeUi.order };
      await page.close();
    }

    console.log(JSON.stringify(out, null, 2));
    console.log('CONTROLS + AUDIO ACCEPTANCE PASS');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
