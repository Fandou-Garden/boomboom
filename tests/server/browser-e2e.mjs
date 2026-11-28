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
import { DatabaseSync } from 'node:sqlite';

/**
 * 测试配置：浏览器验收只验证 UI 交互闭环，不该依赖随机奖励构成碰运气。
 * 仅在金币/真强化石不足时，于临时测试库补到刚够一次强化的量。
 * 不改正常掉落规则、不改强化规则、不改生产代码，也不触碰用户存档。
 */
function ensureForgeTestAssets(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'ddt.sqlite'));
  try {
    const coins = db.prepare('SELECT coins FROM players WHERE id = ?').get('local-player');
    if (!coins || coins.coins < 60) {
      db.prepare('UPDATE players SET coins = 100 WHERE id = ?').run('local-player');
    }
    const stock = db.prepare("SELECT quantity FROM inventory WHERE player_id = ? AND item_key = 'strength1'")
      .get('local-player');
    if (!stock || stock.quantity < 1) {
      db.prepare(`INSERT INTO inventory (player_id, item_key, quantity) VALUES ('local-player', 'strength1', 1)
                  ON CONFLICT(player_id, item_key) DO UPDATE SET quantity = 1`).run();
    }
  } finally { db.close(); }
}

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

    // 房间内打开铁匠铺：原版 store.swf 素材 + 真实 DOM 槽位
    await page.click('[data-action="open-forge"]');
    await page.waitForFunction(() => !document.getElementById('ddtForge').hidden
      && document.querySelectorAll('.ddt-slot').length === 6, { timeout: 15000 });
    const forgeUi = await page.evaluate(() => ({
      note: document.querySelector('.ddt-asset-note')?.textContent || '',
      rule: document.getElementById('ddtForgeRuleTop')?.textContent || '',
      slots: [...document.querySelectorAll('.ddt-slot')].map((el) => ({
        index: Number(el.dataset.slot), accept: el.dataset.accept,
        x: el.style.getPropertyValue('--sx'), y: el.style.getPropertyValue('--sy'),
      })),
      bg: document.querySelector('.ddt-strength-bg')?.getAttribute('src') || '',
      rate: document.getElementById('ddtSuccessRate')?.textContent || '',
      bagCount: document.querySelectorAll('.ddt-bag-item').length,
    }));
    assert(forgeUi.note.includes('原版 store.swf') && forgeUi.note.includes('真实可交互 DOM'),
      '铁匠铺必须标明素材来源与真实交互，不冒充原版强化规则');
    assert.equal(forgeUi.slots.length, 6, '六个原版槽位齐全');
    assert.deepEqual(forgeUi.slots.map((s) => s.accept),
      ['strength-stone', 'strength-stone', 'strength-stone', 'god-charm', 'lucky-charm', 'weapon'],
      '槽位类型须与 StoreIIStrengthBG.as 的 StoreCell 顺序一致');
    assert.equal(forgeUi.slots[0].x, '106px', 'Strengthpoint0 x 应与 store.xml 一致');
    assert.equal(forgeUi.slots[0].y, '-6px', 'Strengthpoint0 y 应与 store.xml 一致');
    assert(forgeUi.bg.includes('store-strength-bg.jpg'), '必须使用导出的原版红金色强化台底图');
    assert(forgeUi.rate.includes('成功率'), '成功率区域必须真实渲染');
    assert(forgeUi.rule.includes('LOCAL_RULE'), '界面必须显示当前采用的规则版本');
    assert(forgeUi.bagCount >= 31, '道具栏应展示全部登记材料');
    pass('房间内打开原版素材铁匠铺（6 个真实槽位 / 装备栏 / 道具栏 / 成功率区）');

    // 音效场景映射：地图音乐编号不等于地图编号
    const audioMap = await page.evaluate(() => window.__GUNNY_HOOKS__?.audioDebug?.().sceneMap || null);
    assert(audioMap, '必须暴露原版 BGM 映射供验收');
    assert.equal(audioMap.mapBackMusic['1157'], '1071', '地图 1157 的 BackMusic 应为 1071');
    assert.equal(audioMap.mapBackMusic['1049'], '1032', '地图 1049 的 BackMusic 应为 1032');
    pass('原版 BGM 映射按 LoadMapsItems.xml 的 BackMusic，不默认等于地图编号');

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
    ensureForgeTestAssets(dataDir);
    // 刷新铁匠铺数据后，用真实点选把强化石放入 0 号槽，验证交互不是背景截图。
    await page.evaluate(async () => {
      const r = await fetch('/api/server/forge', { cache: 'no-store' });
      window.__DDT_FORGE_BEFORE__ = (await r.json()).forge;
    });
    await page.click('[data-action="close-forge"]');
    await page.click('[data-action="open-forge"]');
    await page.waitForFunction(() => document.querySelectorAll('.ddt-bag-item').length >= 31, { timeout: 10000 });
    const stoneKey = await page.evaluate(async () => {
      const r = await fetch('/api/server/forge', { cache: 'no-store' });
      const f = (await r.json()).forge;
      const stock = (f.materials?.strengthStones || []).find((i) => Number(i.quantity) > 0);
      return stock?.itemKey || null;
    });
    assert(stoneKey, '测试库应有可用的真强化石');
    const stoneBox = await page.evaluate((key) => {
      const el = document.querySelector(`.ddt-bag-item[data-item="${key}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      el.scrollIntoView({ block: 'center' });
      return { w: r.width, h: r.height, x: r.x, y: r.y, display: s.display, visibility: s.visibility, disabled: el.disabled };
    }, stoneKey);
    assert(stoneBox && stoneBox.w > 0 && stoneBox.h > 0, `可用强化石必须可见可点击：${JSON.stringify(stoneBox)}`);
    await page.click(`.ddt-bag-item[data-item="${stoneKey}"]`);
    const slotPlaced = await page.evaluate(() => ({
      filled: document.querySelector('.ddt-slot[data-slot="0"]')?.classList.contains('is-filled'),
      label: document.querySelector('.ddt-slot[data-slot="0"]')?.textContent || '',
      rate: document.getElementById('ddtSuccessRate')?.textContent || '',
    }));
    assert(slotPlaced.filled, '点选道具必须真实放入 0 号强化石槽');
    assert(slotPlaced.rate.includes('成功率'), '放入材料后成功率区仍须渲染');
    pass('点选道具真实放入强化石槽，成功率区同步更新');

    // 拖放：原版 StoreDragInArea / DragManager 的交互路径也必须真实可用。
    const dragPlaced = await page.evaluate((key) => {
      const item = document.querySelector(`.ddt-bag-item[data-item="${key}"]`);
      const slot = document.querySelector('.ddt-slot[data-slot="1"]');
      if (!item || !slot) return { ok: false, reason: '槽位或道具不存在' };
      const dt = new DataTransfer();
      item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      slot.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      slot.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      // placeIntoS() 会 renderForge() 重绘槽位，必须重新查询 DOM，不能持有旧节点。
      const fresh = document.querySelector('.ddt-slot[data-slot="1"]');
      return { ok: !!fresh && fresh.classList.contains('is-filled'), payload: dt.getData('text/plain') };
    }, stoneKey);
    assert(dragPlaced.ok, `拖放道具必须真实放入 1 号槽：${JSON.stringify(dragPlaced)}`);
    await page.click('.ddt-slot[data-slot="1"]');
    assert(!(await page.evaluate(() =>
      document.querySelector('.ddt-slot[data-slot="1"]').classList.contains('is-filled'))),
    '点击已填充槽位应移除材料');
    pass('拖放道具真实放入槽位，点击槽位可移除（交互不依赖背景截图）');

    // 音频资源实际可达，避免把「文件已导出」误当作「运行时能播放」。
    const audioFiles = await page.evaluate(async () => {
      const urls = [
        'assets/audio/bgm-room-065.mp3', 'assets/audio/bgm-map-1071.mp3',
        'assets/audio/bgm-map-1032.mp3', 'assets/audio/sound-014-countdown.mp3',
        'assets/audio/sound-067-countdown.mp3',
      ];
      return Promise.all(urls.map(async (u) => {
        const r = await fetch(u, { headers: { Range: 'bytes=0-3' } });
        return { u, ok: r.ok, status: r.status };
      }));
    });
    assert(audioFiles.every((x) => x.ok), `原版 BGM / 倒计时音效必须可访问：${JSON.stringify(audioFiles)}`);
    pass('阶段 9 导出的 BGM 与倒计时音效资源实际可达');

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
    await sleep(1800); // 结果特效 1.6s 后消失，交付截图需完整展示 6 个槽位
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
    console.error('阶段：', results.at(-1) || '(首个断言前)');
    if (error.stack) console.error('调用栈：\n' + error.stack.split('\n').slice(0, 8).join('\n'));
    if (errors.length) console.error('页面错误：\n' + errors.slice(-20).join('\n'));
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
