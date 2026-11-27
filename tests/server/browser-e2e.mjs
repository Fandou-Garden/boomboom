/**
 * 服务端版浏览器 UI 端到端验收（需要本机 Chrome / CHROME_PATH）。
 * 独立端口 + /tmp 临时数据库，不触碰用户存档。
 *
 * 验证：房间层 -> 开始战斗 -> 服务端结算 -> 原版九宫格翻牌 ->
 * 返回房间 -> 房间内铁匠铺强化 -> 关闭回同一房间 -> 刷新页面存档保留。
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
      DDT_DEBUG: '1', DDT_MODE: 'server',
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

async function solveHit(state) {
  const url = (rel) => `${pathToFileURL(path.join(ROOT, rel)).href}?v=33`;
  const { loadTerrainFromBytes } = await import(url('dist/js/engine/terrain.js'));
  const { solveShotForWeapon } = await import(url('dist/js/engine/ai.js'));
  const { WEAPON_DEFS } = await import(url('dist/js/engine/constants.js'));
  const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'dist', 'data', '1156.fore.map')));
  const terrain = loadTerrainFromBytes(bytes);
  const shooter = { x: state.actors[0].x, y: state.actors[0].y, slope: state.actors[0].slope ?? 0, alive: true };
  const target = { x: state.actors[1].x, y: state.actors[1].y, alive: true };
  return solveShotForWeapon(shooter, target, state.wind ?? 0, terrain, WEAPON_DEFS[state.weapon] || WEAPON_DEFS.fruit, 14, 2000);
}

const post = (base, p, body) => fetch(base + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const get = async (base, p) => (await fetch(base + p, { cache: 'no-store' })).json();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/json',
  '.map': 'application/octet-stream', '.gz': 'application/gzip',
};

/** 纯静态托管（/api 一律 404），用于验证站点版 offline 路径不受影响。 */
async function startStaticServer() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('no api'); return;
    }
    const rel = pathname === '/' ? '/index.html' : pathname;
    const file = path.join(ROOT, 'dist', decodeURIComponent(rel));
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  assert(fs.existsSync(CHROME), `未找到 Chrome：${CHROME}（可设置 CHROME_PATH）`);
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-browser-'));
  const server = await startServer(port, dataDir);
  const base = server.base;
  let browser;
  let staticServer;
  const results = [];
  const pass = (name) => { results.push(`  ✓ ${name}`); };
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!document.getElementById('ddtServerLayer'), { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('.ddt-map').length === 12, { timeout: 30000 });
    pass('房间层显示 12 张地图与 13 把武器');

    const roomStart = await page.evaluate(() => ({
      roomVisible: !document.getElementById('ddtServerLayer').hidden,
      weapons: document.querySelectorAll('.ddt-weapon').length,
      maps: document.querySelectorAll('.ddt-map').length,
      forgeBtn: !!document.querySelector('[data-action="open-forge"]'),
      startBtn: !!document.querySelector('[data-action="start-battle"]'),
      backend: window.__GUNNY_BACKEND__,
      bootError: window.__GUNNY_BOOT_ERROR__ || null,
    }));
    assert(roomStart.roomVisible && roomStart.weapons === 13 && roomStart.forgeBtn && roomStart.startBtn, '房间控件不完整');
    assert.equal(roomStart.backend, 'go', '应识别为后端模式');
    assert(!roomStart.bootError, `前端启动错误：${roomStart.bootError}`);
    pass('前端沿用站点版战斗核心，无启动错误');

    // 开始战斗 -> 房间层隐藏
    await page.click('[data-action="start-battle"]');
    await page.waitForFunction(() => document.getElementById('ddtServerLayer').hidden, { timeout: 15000 });
    pass('从房间开始战斗，覆盖层隐藏');

    // 服务端调试命令快速打完一局（仍走原版弹道与伤害结算）
    assert.equal((await post(base, '/api/command', { type: 'debug_set_hp', actor: 1, hp: 1 })).status, 200, 'debug_set_hp 失败');
    const state = await get(base, '/api/state');
    const plan = await solveHit(state);
    assert.equal((await post(base, '/api/command', {
      type: 'fire', actor: 0, angle: plan.angle, force: plan.force,
    })).status, 200, 'fire 失败');

    await page.waitForFunction(() => {
      const modal = document.getElementById('modal');
      return modal && !modal.hidden && modal.classList.contains('is-result');
    }, { timeout: 45000 });
    await page.waitForFunction(() => document.querySelectorAll('#cardsRow .result-card').length === 9, { timeout: 20000 });
    pass('服务端结算后显示原版 3x3 九宫格');

    const before = await page.evaluate(() => document.getElementById('walletCoins').textContent);
    await page.click('#cardsRow .result-card[data-card="0"]');
    await page.waitForFunction(() => {
      const c = document.querySelector('#cardsRow .result-card[data-card="0"]');
      return c && c.classList.contains('is-flipped') && c.querySelector('.ddt-card-prize b');
    }, { timeout: 15000 });
    const afterFlip = await page.evaluate(() => ({
      prize: document.querySelector('#cardsRow .result-card[data-card="0"] .ddt-card-prize b')?.textContent,
      coins: document.getElementById('walletCoins').textContent,
      sum: document.getElementById('rewardSum')?.textContent,
    }));
    assert(afterFlip.prize && afterFlip.prize.startsWith('+'), '翻牌奖励显示');
    assert(afterFlip.sum.includes('1/3'), '翻牌次数由服务端回传');
    // 原版 cardMc 翻牌序列 420ms 后才切到卡面，验证奖励确实可见。
    await sleep(700);
    const faceVisible = await page.evaluate(() => {
      const face = document.querySelector('#cardsRow .result-card[data-card="0"] .card-face');
      return !!face && Number(getComputedStyle(face).opacity) > 0.9;
    });
    assert(faceVisible, '翻牌动画结束后应显示卡面奖励');
    pass(`翻牌后服务端奖励上屏（${afterFlip.prize}，钱包 ${before} -> ${afterFlip.coins}）`);

    await page.screenshot({ path: path.join(dataDir, 'settlement.png') });

    // 返回房间：奖励盘保留，出现继续翻牌入口
    await page.click('#claimReward');
    await page.waitForFunction(() => !document.getElementById('ddtServerLayer').hidden, { timeout: 15000 });
    const continueVisible = await page.evaluate(() => {
      const b = document.querySelector('[data-action="continue-cards"]');
      return b && !b.hidden;
    });
    assert(continueVisible, '未翻完的奖励盘应给出继续领取入口');
    pass('未翻完离开保留奖励盘，房间给出继续翻牌入口');

    // 房间内打开铁匠铺
    await page.click('[data-action="open-forge"]');
    await page.waitForFunction(() => !document.getElementById('ddtForge').hidden, { timeout: 10000 });
    const forgeText = await page.evaluate(() => document.querySelector('.ddt-asset-note')?.textContent || '');
    assert(forgeText.includes('原版铁匠铺 UI 素材未导出'), '铁匠铺必须明确标注临时界面，不冒充原版');
    pass('房间内打开铁匠铺（原版素材缺失已标注）');

    // 先补翻两张卡以保证强化材料充足，再强化
    const room = await get(base, '/api/server/room');
    const pending = room.room.pendingReward;
    if (pending) {
      for (const idx of [1, 2]) {
        await post(base, `/api/server/battles/${pending.battleId}/rewards/claim`, {
          cardIndex: idx, requestId: `browser-${idx}`,
        });
      }
    }
    await page.evaluate(async () => {
      const r = await fetch('/api/server/forge', { cache: 'no-store' });
      const f = (await r.json()).forge;
      window.__DDT_FORGE_BEFORE__ = f;
    });
    await page.click('[data-action="strengthen"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('ddtForgeResult');
      return el && el.textContent.trim().length > 0;
    }, { timeout: 15000 });
    const forgeResult = await page.evaluate(async () => {
      const r = await fetch('/api/server/forge', { cache: 'no-store' });
      const f = (await r.json()).forge;
      return {
        text: document.getElementById('ddtForgeResult').textContent,
        level: f.weapons.find((w) => w.equipped)?.level,
        attack: f.weapons.find((w) => w.equipped)?.attack,
      };
    });
    assert(forgeResult.text.includes('强化成功'), `强化结果：${forgeResult.text}`);
    assert.equal(forgeResult.level, 1, '强化等级 +1');
    assert.equal(forgeResult.attack, 125, '强化后攻击 125');
    pass('铁匠铺强化成功，等级与攻击属性由服务端更新');
    await page.screenshot({ path: path.join(dataDir, 'forge.png') });

    // 关闭铁匠铺回到同一个房间
    await page.click('[data-action="close-forge"]');
    await page.waitForFunction(() => document.getElementById('ddtForge').hidden && !document.getElementById('ddtRoom').hidden, { timeout: 10000 });
    pass('关闭铁匠铺回到同一个房间');

    // 刷新页面：存档、强化等级、金币材料保留
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!document.getElementById('ddtServerLayer') && document.querySelectorAll('.ddt-map').length === 12, { timeout: 30000 });
    const refreshed = await page.evaluate(() => ({
      equipped: document.getElementById('ddtEquipped')?.textContent || '',
      coins: document.getElementById('walletCoins')?.textContent,
      stones: document.getElementById('walletStones')?.textContent,
      bootError: window.__GUNNY_BOOT_ERROR__ || null,
    }));
    assert(refreshed.equipped.includes('+1'), `刷新后强化等级未保留：${refreshed.equipped}`);
    assert(!refreshed.bootError, `刷新后启动错误：${refreshed.bootError}`);
    pass(`刷新页面后强化等级 / 金币 ${refreshed.coins} / 材料 ${refreshed.stones} 保留`);

    assert.equal(errors.length, 0, `页面出现 JS 错误：\n${errors.join('\n')}`);
    await page.screenshot({ path: path.join(dataDir, 'room-after-reload.png') });

    // 站点版：同一份前端在纯静态托管下必须回退到 offline，且不加载房间层。
    const staticInfo = await startStaticServer();
    staticServer = staticInfo.server;
    const offPage = await browser.newPage();
    const offErrors = [];
    offPage.on('pageerror', (e) => offErrors.push(e.message));
    await offPage.goto(staticInfo.base + '/?test=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await offPage.waitForFunction(() => !!window.__GUNNY_BACKEND__ && !!window.__GUNNY_OFFLINE__, { timeout: 30000 });
    const offline = await offPage.evaluate(async () => {
      const m = await import('/js/data-api.js?v=33');
      return {
        backend: window.__GUNNY_BACKEND__,
        dataMode: m.dataApi.mode,
        layer: !!document.getElementById('ddtServerLayer'),
        offline: !!window.__GUNNY_OFFLINE__,
        bootError: window.__GUNNY_BOOT_ERROR__ || null,
        fatalHidden: document.getElementById('fatal')?.hidden,
      };
    });
    assert.equal(offline.backend, 'js', '站点版应识别为纯 JS 引擎');
    assert.equal(offline.dataMode, 'offline', '统一数据接口应回退到 offline');
    assert.equal(offline.layer, false, '站点版不应出现服务端房间层');
    assert.equal(offline.offline, true, '站点版应加载 standalone-api');
    assert(!offline.bootError, `站点版启动错误：${offline.bootError}`);
    assert.equal(offErrors.length, 0, `站点版 JS 错误：${offErrors.join(' | ')}`);
    pass('站点版（纯静态托管）回退 offline，房间层不加载、无启动错误');
    await offPage.close();

    console.log('\n[ddt-browser-e2e] 全部通过：');
    console.log(results.join('\n'));
    console.log(`\n临时数据库：${dataDir}`);
    console.log(`截图：${dataDir}/settlement.png, forge.png, room-after-reload.png`);
  } catch (error) {
    console.error('\n[ddt-browser-e2e] 失败：', error.message);
    console.error('服务端日志：\n', server.logs().slice(-3000));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (staticServer) await new Promise((r) => staticServer.close(r));
    const exited = new Promise((r) => server.proc.once('exit', r));
    server.proc.kill('SIGTERM');
    await Promise.race([exited, sleep(5000)]);
    if (server.proc.exitCode === null) server.proc.kill('SIGKILL');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
