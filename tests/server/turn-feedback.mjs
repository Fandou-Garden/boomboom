/**
 * 出手反馈验收：60 秒倒计时、原版大字回合提示、技能点击与战斗音效。
 * 独立端口 + /tmp 临时数据库，不触碰用户存档。
 *
 * 用法：node tests/server/turn-feedback.mjs
 * 可选：DDT_SCREENSHOT_DIR=docs/screenshots 保存回合提示截图。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  return port;
}

async function startServer(port, dataDir) {
  const proc = spawn(TSX, ['server-node/src/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env, DDT_HOST: '127.0.0.1', DDT_PORT: String(port),
      DDT_DATA_DIR: dataDir, DDT_DB_PATH: path.join(dataDir, 'ddt.sqlite'),
      DDT_DEBUG: '1', DDT_MODE: 'server', DDT_REWARD_POOL: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  proc.stdout.on('data', (d) => { logs += d.toString(); });
  proc.stderr.on('data', (d) => { logs += d.toString(); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${base}/healthz`)).ok) return { proc, base, logs: () => logs }; } catch { /* wait */ }
    await sleep(150);
  }
  throw new Error(`server did not start:\n${logs}`);
}

const post = (base, p, body) => fetch(base + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

async function main() {
  assert(fs.existsSync(CHROME), `未找到 Chrome：${CHROME}（可设置 CHROME_PATH）`);
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-turn-feedback-'));
  const shotDir = process.env.DDT_SCREENSHOT_DIR || dataDir;
  fs.mkdirSync(shotDir, { recursive: true });
  const server = await startServer(port, dataDir);
  let browser;
  const results = [];
  const errors = [];
  const pass = (name) => { results.push(`  ✓ ${name}`); };
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(server.base + '/?test=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!document.getElementById('ddtServerLayer'), { timeout: 30000 });
    await page.waitForFunction(() => !!window.__GUNNY_TEST__, { timeout: 30000 });
    await page.evaluate(() => {
      window.__GUNNY_TEST__.audioEnable();
      window.__GUNNY_TEST__.audioReset();
    });
    await page.evaluate(() => window.__GUNNY_TEST__.audioReady());

    await page.click('[data-action="start-battle"]');
    await page.waitForFunction(() => document.getElementById('ddtServerLayer').hidden, { timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('turnFlash');
      return el && el.classList.contains('show') && el.textContent.includes('轮到你出手啦');
    }, { timeout: 15000 });
    const flash = await page.evaluate(() => {
      const el = document.getElementById('turnFlash');
      const style = getComputedStyle(el);
      return { text: el.textContent, fontSize: style.fontSize, stroke: style.webkitTextStrokeColor };
    });
    assert.equal(flash.text, '轮到你出手啦!!!');
    assert.ok(parseFloat(flash.fontSize) >= 28, `大字提示字号过小：${flash.fontSize}`);
    pass(`回合提示使用原版文案与描边大字（${flash.fontSize} / ${flash.stroke}）`);

    const shot = path.join(shotDir, '2026-11-28-turn-feedback.png');
    await page.screenshot({ path: shot });
    pass(`回合提示截图：${shot}`);

    // 等 016 回合音与 900ms 后触发的 067 倒计时起始音落地。
    await sleep(1300);
    const intro = await page.evaluate(() => {
      const api = window.__GUNNY_TEST__;
      const events = api.audioDebug().events;
      return {
        state: api.snapshot(),
        turnSelf: events.filter((e) => e.name === 'turn-self'),
        countdownIntro: events.filter((e) => e.name === '067'),
        audio: api.audioDebug(),
        label: document.getElementById('countdown').textContent,
      };
    });
    assert.equal(intro.state.showCountdown, true, '服务端模式应默认显示倒计时');
    assert.ok(intro.state.countdown >= 57 && intro.state.countdown <= 60,
      `出手时间应为 60 秒：${intro.state.countdown}`);
    assert.match(intro.label, /^(60|59|58)s$/, `倒计时显示异常：${intro.label}`);
    pass(`60 秒出手倒计时（读取 ${intro.state.countdown.toFixed(1)}s，显示 ${intro.label}）`);
    assert.equal(intro.turnSelf[0]?.sample, '016', '玩家回合音应使用原版 016');
    assert.equal(intro.countdownIntro[0]?.sample, '067', '倒计时起始音应使用原版 067');
    assert.ok(intro.turnSelf[0]?.peak > 0 && intro.countdownIntro[0]?.peak > 0,
      `回合/起始音应有波形：${JSON.stringify(intro.audio)}`);
    pass('回合音 016 与倒计时起始音 067 均使用原版采样且有波形');

    // 技能点击：008 必须在点击瞬间播放且有波形，不等引擎回声。
    await page.evaluate(() => window.__GUNNY_TEST__.audioReset());
    await page.click('#skillExtra2');
    await page.evaluate(() => window.__GUNNY_TEST__.audioReady());
    // _measure 用 analyser 在 260ms 窗口内累积峰值，读数要等窗口结束。
    await sleep(350);
    const skill = await page.evaluate(() => window.__GUNNY_TEST__.audioDebug().events
      .filter((e) => e.name === 'skill-select'));
    assert.equal(skill[0]?.sample, '008', '技能点击应使用原版 008');
    assert.ok(skill[0]?.peak > 0.00001, '技能点击音应产生波形');
    pass('技能点击原版 008 音效即时触发且有波形');

    // 最后 10 秒每秒原版 014 滴答：用 debug 命令把读数调到 10 秒，避免等 50 秒。
    assert.equal((await post(server.base, '/api/command', {
      type: 'debug_set_countdown', enabled: true, seconds: 10,
    })).status, 200, 'debug_set_countdown 失败');
    await page.evaluate(() => window.__GUNNY_TEST__.audioReset());
    await sleep(1600);
    const tick = await page.evaluate(() => window.__GUNNY_TEST__.audioDebug().events
      .filter((e) => e.name === '014'));
    assert.ok(tick.length >= 1 && tick[0].sample === '014', '最后 10 秒应播放原版 014 滴答');
    assert.ok(tick[0].peak > 0.00001, '014 滴答应有波形');
    pass(`最后 10 秒倒计时原版 014 滴答（触发 ${tick.length} 次）`);

    // 战斗主音：开炮 / 爆炸按武器取原版采样。
    await page.evaluate(() => {
      const api = window.__GUNNY_TEST__;
      api.audioReset();
      api.audioPlay('fire', 'fruit');
      api.audioPlay('explosion', 'fruit');
    });
    await page.evaluate(() => window.__GUNNY_TEST__.audioReady());
    await sleep(350);
    const combat = await page.evaluate(() => window.__GUNNY_TEST__.audioDebug().events);
    const fire = combat.filter((e) => e.name === 'fire');
    const boom = combat.filter((e) => e.name === 'explosion');
    assert.equal(fire[0]?.sample, '114', '水果篮开炮应为原版 114');
    assert.equal(boom[0]?.sample, '102', '水果篮爆炸应为原版 102');
    assert.ok(fire[0]?.peak > 0 && boom[0]?.peak > 0, '开炮/爆炸应有波形');
    pass('战斗开炮 114 / 爆炸 102 原版采样与波形正常');

    // 第一张截图拍在开战过场里；再打一发，等回到玩家回合拍正常战斗画面。
    await page.waitForFunction(() => document.getElementById('loading').classList.contains('is-hidden'), { timeout: 20000 });
    const played = await page.evaluate(() => window.__GUNNY_TEST__.aimAndFirePlayer());
    assert.ok(played?.ok, `自动瞄准开炮失败：${JSON.stringify(played)}`);
    await page.waitForFunction(() => {
      const el = document.getElementById('turnFlash');
      const state = window.__GUNNY_TEST__.snapshot();
      return state?.phase === 'player' && state.round >= 2
        && el.classList.contains('show') && el.textContent.includes('轮到你出手啦');
    }, { timeout: 45000 });
    const battleShot = path.join(shotDir, '2026-11-28-turn-feedback-battle.png');
    await page.screenshot({ path: battleShot });
    pass(`正常战斗画面回合提示截图：${battleShot}`);

    assert.equal(errors.length, 0, `浏览器错误：${errors.join(' | ')}`);
    console.log('出手反馈验收通过：\n' + results.join('\n'));
  } finally {
    await browser?.close();
    server.proc.kill('SIGTERM');
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
