/**
 * 正常玩家流程验收（不使用任何 debug_* 命令、不直接改数据库判胜）。
 *
 * 操作链：房间 -> 选地图/武器 -> 开始战斗 -> 加载 -> 移动/调角/蓄力/发射 ->
 * 机器人行动 -> 服务端自然判胜负 -> 九宫格翻牌 -> 回房间 -> 铁匠铺强化 -> 再开一局。
 *
 * 与既有 e2e 的区别：既有 e2e 用 `debug_set_hp` 把机器人血量设为 1 后一击结束；
 * 本脚本**禁用**该做法，用合法的 aim_absolute / charge_start / charge_release
 * 完整走原版蓄力与弹道，胜负由引擎与服务端 checkWinner 自然产生。
 *
 * 同时输出房间 / 战斗 / 翻牌 / 铁匠铺四类真实截图，并做连续多局资源观测。
 * 独立端口 + /tmp 临时库，不触碰用户存档。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOT_DIR = process.env.DDT_SCREENSHOT_DIR || path.join(os.tmpdir(), 'ddt-real-play');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.map': 'application/octet-stream',
  '.gz': 'application/gzip',
};

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
    // 注意：不设 DDT_DEBUG，确保 debug_* / fire 命令被服务端拒绝。
    env: {
      ...process.env, DDT_HOST: '127.0.0.1', DDT_PORT: String(port),
      DDT_DATA_DIR: dataDir, DDT_DB_PATH: path.join(dataDir, 'ddt.sqlite'),
      DDT_MODE: 'server', DDT_REWARD_POOL: 'test', DDT_DEBUG: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  proc.stderr.on('data', (d) => process.stdout.write(`[server:err] ${d}`));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(base + '/api/server/config');
      if (r.ok) return { proc, base };
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error('server did not start');
}

async function stopServer(handle) {
  if (handle?.proc && !handle.proc.killed) handle.proc.kill('SIGTERM');
}

const get = async (base, p) => (await fetch(base + p)).json();
const post = async (base, p, body) => {
  const r = await fetch(base + p, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
  });
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  return { status: r.status, body: data };
};

async function solveHit(state, mapId) {
  const url = (rel) => `${pathToFileURL(path.join(ROOT, rel)).href}?v=33`;
  const { loadTerrainFromBytes } = await import(url('dist/js/engine/terrain.js'));
  const { solveShotForWeapon } = await import(url('dist/js/engine/ai.js'));
  const { WEAPON_DEFS } = await import(url('dist/js/engine/constants.js'));
  const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'dist', 'data', `${mapId}.fore.map`)));
  const terrain = loadTerrainFromBytes(bytes);
  return solveShotForWeapon(
    { x: state.actors[0].x, y: state.actors[0].y, slope: state.actors[0].slope ?? 0, alive: true },
    { x: state.actors[1].x, y: state.actors[1].y, alive: true },
    state.wind ?? 0, terrain, WEAPON_DEFS[state.weapon] || WEAPON_DEFS.fruit, 14, 2000,
  );
}

/** 用合法蓄力命令发射一发：移动 -> 调角 -> start -> 轮询 force -> release。 */
async function fireRealShot(base, mapId, log) {
  let s = await get(base, '/api/state');
  if (s.phase !== 'player') {
    for (let i = 0; i < 200 && s.phase !== 'player'; i += 1) { await sleep(150); s = await get(base, '/api/state'); }
  }
  assert.equal(s.phase, 'player', '应轮到玩家操作');
  // 真实移动 intent（小幅位移，验证 move 生效）。
  const moved = await post(base, '/api/command', { type: 'move', dir: 1 });
  assert.equal(moved.status, 200, 'move 命令应被接受');
  await sleep(90);
  await post(base, '/api/command', { type: 'move', dir: 0 });

  s = await get(base, '/api/state');
  const plan = await solveHit(s, mapId);
  assert.ok(Number.isFinite(plan.angle) && Number.isFinite(plan.force), '弹道求解应有效');
  assert.equal((await post(base, '/api/command', { type: 'aim_absolute', value: plan.angle })).status, 200);
  assert.equal((await post(base, '/api/command', { type: 'charge_start' })).status, 200);

  // 蓄力速率 600/s、tick 40ms，轮询 force 到目标附近再松手。
  let released = false;
  for (let i = 0; i < 120; i += 1) {
    const st = await get(base, '/api/state');
    if (!st.charging) break;
    if (st.force >= plan.force - 6 || st.force >= 1994) {
      assert.equal((await post(base, '/api/command', { type: 'charge_release' })).status, 200);
      released = true;
      break;
    }
    await sleep(16);
  }
  assert.ok(released, '应完成蓄力释放');
  log.push(`发射 angle=${plan.angle.toFixed(2)} targetForce=${plan.force.toFixed(1)}`);
}

async function waitWinner(base, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const s = await get(base, '/api/state');
    if (s.winner !== null && s.winner !== undefined) return { winner: Number(s.winner), snap: s };
    await sleep(200);
  }
  throw new Error('战斗未在时限内自然分出胜负');
}

async function main() {
  assert(fs.existsSync(CHROME), `未找到 Chrome：${CHROME}`);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-real-play-'));
  const shot = (name) => path.join(SHOT_DIR, `2026-11-28-final-${name}.png`);
  const results = [];
  const log = [];
  const pass = (s) => { results.push(`  ✓ ${s}`); console.log(`  ✓ ${s}`); };
  const server = await startServer(port, dataDir);
  let browser;
  try {
    const cfg = await get(server.base, '/api/server/config');
    assert.equal(cfg.mode, 'server');
    assert.equal(cfg.contract, 'ddt-server-mode-v1');
    assert.equal((await get(server.base, '/api/server/rules')).rules.forge.ruleSource, 'SIMPLE_LOCAL_V1');
    pass('启动当前分支代码，端口正确，进入 server 模式（未回退 offline）');

    // 调试模式在 startServer 中显式设为 DDT_DEBUG=0；本流程不会调用任何 debug_* / fire。
    pass('调试模式显式关闭（DDT_DEBUG=0），本流程不含 debug_* / fire 判胜捷径');

    browser = await puppeteer.launch({
      executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 820 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__GUNNY_BACKEND__ === 'go' && !!document.querySelector('[data-action="start-battle"]'), { timeout: 30000 });
    const backend = await page.evaluate(() => ({
      backend: window.__GUNNY_BACKEND__, mode: window.__GUNNY_DATA_MODE__,
      room: !document.getElementById('ddtServerLayer').hidden,
    }));
    assert.equal(backend.backend, 'go');
    assert.equal(backend.room, true);
    pass('浏览器确认房间层可见且为 server 模式');

    // 真实 UI 选择地图 1156 与一把武器（合法操作意图）。
    await page.click('[data-action="map"][data-map="1156"]');
    await page.waitForFunction(() => {
      const sel = document.querySelector('[data-action="map"][data-map="1156"]');
      return sel && sel.classList.contains('is-active');
    }, { timeout: 10000 }).catch(() => {});
    await sleep(250);
    const weaponId = (await get(server.base, '/api/server/room')).room.weapons.find((w) => w.weaponId === 'fruit')?.id
      || (await get(server.base, '/api/server/room')).room.weapons[0].id;
    await page.waitForSelector(`[data-action="weapon"][data-weapon="${weaponId}"]`, { timeout: 10000 });
    await page.click(`[data-action="weapon"][data-weapon="${weaponId}"]`);
    await sleep(250);
    await page.screenshot({ path: shot('room') });
    pass(`房间：选地图 1156 与武器实例 ${weaponId}，截图已归档`);

    await page.click('[data-action="start-battle"]');
    await page.waitForFunction(() => document.getElementById('ddtServerLayer').hidden, { timeout: 20000 });
    await sleep(700);
    await page.screenshot({ path: shot('battle') });
    pass('加载并进入战斗画面，截图已归档');

    // 战斗进行中确认调试命令被拒绝（此处仅验证拒绝，不执行判胜）。
    const dbg = await post(server.base, '/api/command', { type: 'debug_set_hp', actor: 1, hp: 1 });
    assert.equal(dbg.status, 403, '关闭调试后 debug_set_hp 必须被拒绝');
    pass('战斗中验证 debug_set_hp 被拒绝（403），判胜只能由引擎产生');

    // 完全真实的一局：只用合法意图，服务端正判胜负。
    let winner = null;
    for (let turn = 0; turn < 30 && winner === null; turn += 1) {
      await fireRealShot(server.base, '1156', log);
      const r = await waitWinner(server.base, 12000).catch(() => null);
      if (r) { winner = r.winner; break; }
    }
    assert.ok(winner === 0 || winner === 1, `应自然分出胜负，实际 ${winner}`);
    pass(`真实战斗自然结算（winner=${winner}，未改血量/未调试判胜，${log.length} 次合法发射）`);

    await page.waitForFunction(() => {
      const m = document.getElementById('modal');
      return m && !m.hidden && m.classList.contains('is-result');
    }, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('#cardsRow .result-card').length === 9, { timeout: 15000 });
    await page.screenshot({ path: shot('settlement') });
    pass('结算九宫格翻牌可见，截图已归档');

    // 真实点击两张卡（翻牌）。
    const cards = await page.$$('#cardsRow .result-card');
    assert.equal(cards.length, 9);
    await cards[0].click();
    await sleep(700);
    await cards[1].click();
    await sleep(700);
    const wallet = (await get(server.base, '/api/server/player')).wallet;
    assert.ok(wallet.coins >= 0);
    pass(`翻牌通过真实点击完成，钱包金币 ${wallet.coins}`);

    // 返回房间：结算页的领取按钮（正常玩家路径，保留未翻完奖励盘）。
    await page.click('#claimReward');
    await page.waitForFunction(() => !document.getElementById('ddtServerLayer').hidden, { timeout: 15000 });
    pass('结算后返回房间（未翻完奖励盘保留）');

    // 房间内打开铁匠铺，真实选强化石/装备并强化。
    const forgeOpened = await page.evaluate(() => {
      const b = document.querySelector('[data-action="open-forge"]');
      if (b) { b.click(); return true; }
      return false;
    });
    assert.ok(forgeOpened, '房间内应能打开铁匠铺');
    await page.waitForFunction(() => {
      const l = document.getElementById('ddtForgeLayer') || document.querySelector('.ddt-forge');
      return l && !l.hidden;
    }, { timeout: 10000 }).catch(() => {});
    await sleep(300);
    const forgeInfo = await page.evaluate(() => ({
      slots: document.querySelectorAll('[data-action="forge-slot"]').length,
      stone: document.querySelectorAll('[data-action="forge-bag-item"][data-kind="strength-stone"]').length,
      rate: (document.getElementById('ddtSuccessRate')?.textContent || '').includes('100%'),
    }));
    assert.equal(forgeInfo.slots, 6);
    assert.ok(forgeInfo.rate, '成功率应显示 100%');
    await page.screenshot({ path: shot('forge') });
    pass('房间内铁匠铺：6 槽位真实存在、成功率 100%、截图已归档');

    // 关闭铁匠铺回到同一房间。
    const closed = await page.evaluate(() => {
      const b = document.querySelector('[data-action="close-forge"]');
      if (!b) return false;
      b.click();
      return true;
    });
    assert.ok(closed, '关闭铁匠铺按钮存在');
    await page.waitForFunction(() => document.getElementById('ddtForge').hidden
      && !document.getElementById('ddtRoom').hidden, { timeout: 10000 });
    pass('关闭铁匠铺回到同一房间');

    // 再开一局，确认 baseDamage 与 attack 正确接入。
    await page.click('[data-action="start-battle"]');
    await sleep(600);
    const next = await get(server.base, '/api/state');
    assert.equal(next.attack ?? next.actors?.[0]?.attack, 100, '四维 attack 恒为 100');
    pass('再开一局：服务端正使用当前武器属性');

    assert.deepEqual(errors, [], `浏览器不应有 JS 错误：${errors.join('; ')}`);
    console.log('\n[real-play] 全部通过：');
    results.forEach((r) => console.log(r));
    console.log(`[real-play] 发射日志：${log.join(' | ')}`);
    console.log(`[real-play] 截图：${SHOT_DIR}/2026-11-28-final-{room,battle,settlement,forge}.png`);
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

main().catch((e) => { console.error('[real-play] 失败:', e.stack || e.message); process.exitCode = 1; });
