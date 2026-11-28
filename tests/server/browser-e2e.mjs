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
 * 服务使用独立测试奖励池；若测试库金币/真强化石仍不足，白盒补到刚够多次强化的量。
 * 不改正常掉落规则、不改强化规则、不改生产代码，也不触碰用户存档。
 */
function ensureForgeTestAssets(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'ddt.sqlite'));
  try {
    const coins = db.prepare('SELECT coins FROM players WHERE id = ?').get('local-player');
    if (!coins || coins.coins < 400) {
      db.prepare('UPDATE players SET coins = 1500 WHERE id = ?').run('local-player');
    }
    const stock = db.prepare("SELECT quantity FROM inventory WHERE player_id = ? AND item_key = 'strength1'")
      .get('local-player');
    if (!stock || stock.quantity < 3) {
      db.prepare(`INSERT INTO inventory (player_id, item_key, quantity) VALUES ('local-player', 'strength1', 3)
                  ON CONFLICT(player_id, item_key) DO UPDATE SET quantity = 3`).run();
    }
  } finally { db.close(); }
}

/** 白盒夹具：把测试库置为「金币不足 / 材料不足 / 满级」场景，用于验证 UI 提示。 */
function setTestScene(dataDir, scene) {
  const db = new DatabaseSync(path.join(dataDir, 'ddt.sqlite'));
  try {
    if (scene === 'no-coins') {
      db.prepare('UPDATE players SET coins = 0 WHERE id = ?').run('local-player');
      db.prepare("UPDATE inventory SET quantity = 3 WHERE player_id = ? AND item_key = 'strength1'").run('local-player');
    } else if (scene === 'no-stones') {
      db.prepare('UPDATE players SET coins = 1500 WHERE id = ?').run('local-player');
      db.prepare("UPDATE inventory SET quantity = 0 WHERE player_id = ? AND item_key LIKE 'strength%'").run('local-player');
    } else if (scene === 'at-max') {
      db.prepare('UPDATE players SET coins = 1500 WHERE id = ?').run('local-player');
      db.prepare("UPDATE inventory SET quantity = 3 WHERE player_id = ? AND item_key = 'strength1'").run('local-player');
      db.prepare("UPDATE weapon_instances SET level = 12, attack = 220, attack_precise = 220 WHERE equipped = 1 AND player_id = ?")
        .run('local-player');
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
  // 默认写临时目录；交付时通过 DDT_SCREENSHOT_DIR 指向 docs/screenshots 归档。
  const shotDir = process.env.DDT_SCREENSHOT_DIR || dataDir;
  fs.mkdirSync(shotDir, { recursive: true });
  const shot = (name) => path.join(shotDir, `2026-11-28-stage10-${name}.png`);
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
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      // 验收会主动触发 4xx（金币不足 / 材料不足 / 未翻卡等）；浏览器把这类响应
      // 记成 console error，属预期拒绝而非前端 JS 错误。其余错误全部保留。
      if (/Failed to load resource/.test(text) && /\b(400|404|409)\b/.test(text)) return;
      errors.push('console: ' + text);
    });

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

    // 白盒夹具：从隔离临时库读本局盘面，挑出「1 张金币卡 + 1 张真强化石卡」的卡位。
    // 测试奖励池 9 张整体洗牌、无固定卡位；这里只选卡位供 UI 点击，不改奖励内容与规则。
    const boardProbe = new DatabaseSync(path.join(dataDir, 'ddt.sqlite'));
    let storedCards;
    try {
      const row = boardProbe.prepare('SELECT cards_json FROM reward_boards ORDER BY created_at DESC LIMIT 1').get();
      assert.ok(row?.cards_json, '临时库应已保存本局奖励盘');
      storedCards = JSON.parse(row.cards_json);
    } finally { boardProbe.close(); }
    const coinIdx = storedCards.findIndex((c) => c.kind === 'coin');
    const itemIdx = storedCards.findIndex((c) => c.kind === 'item');
    assert(coinIdx >= 0 && itemIdx >= 0, '测试奖励池应强制产生金币卡与真强化石卡');
    assert.notEqual(coinIdx, itemIdx);
    const cardSel = (i) => `#cardsRow .result-card[data-card="${i}"]`;

    const before = await page.evaluate(() => document.getElementById('walletCoins').textContent);
    await page.click(cardSel(coinIdx));
    await page.waitForFunction((i) => {
      const c = document.querySelector(`#cardsRow .result-card[data-card="${i}"]`);
      return c && c.classList.contains('is-flipped') && c.querySelector('.ddt-card-prize b');
    }, { timeout: 15000 }, coinIdx);
    const afterFlip = await page.evaluate((i) => ({
      prize: document.querySelector(`#cardsRow .result-card[data-card="${i}"] .ddt-card-prize b`)?.textContent,
      coins: document.getElementById('walletCoins').textContent,
      sum: document.getElementById('rewardSum')?.textContent,
    }), coinIdx);
    assert(afterFlip.prize && afterFlip.prize.startsWith('+'), '翻牌金币奖励显示');
    assert(afterFlip.sum.includes('1/3'), '翻牌次数由服务端回传');
    // 原版 cardMc 翻牌序列 420ms 后才切到卡面，验证奖励确实可见。
    await sleep(700);
    const faceVisible = await page.evaluate((i) => {
      const face = document.querySelector(`#cardsRow .result-card[data-card="${i}"] .card-face`);
      return !!face && Number(getComputedStyle(face).opacity) > 0.9;
    }, coinIdx);
    assert(faceVisible, '翻牌动画结束后应显示卡面奖励');
    pass(`翻牌获得金币：${afterFlip.prize}，钱包 ${before} -> ${afterFlip.coins}`);

    // 第二张翻真强化石卡：确保「翻牌 → 强化」的材料来源在 UI 上真实可见。
    await page.click(cardSel(itemIdx));
    await page.waitForFunction((i) => {
      const c = document.querySelector(`#cardsRow .result-card[data-card="${i}"]`);
      return c && c.classList.contains('is-flipped') && c.querySelector('.ddt-card-prize b');
    }, { timeout: 15000 }, itemIdx);
    const stoneFlip = await page.evaluate((i) => ({
      text: document.querySelector(`#cardsRow .result-card[data-card="${i}"] .ddt-card-prize`)?.textContent || '',
      sum: document.getElementById('rewardSum')?.textContent || '',
    }), itemIdx);
    assert(stoneFlip.text.length > 0 && stoneFlip.sum.includes('2/3'), '第二张材料卡应真实领取');
    pass(`翻牌获得真强化石：${stoneFlip.text.trim()}（${stoneFlip.sum}）`);

    await sleep(700); // 等第二张卡的原版 420ms 翻牌序列结束，交付截图要能看到卡面
    await page.screenshot({ path: shot('settlement') });

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
      ruleBody: document.getElementById('ddtForgeRule')?.textContent || '',
      detail: document.getElementById('ddtForgeDetail')?.textContent || '',
      slots: [...document.querySelectorAll('.ddt-slot')].map((el) => ({
        index: Number(el.dataset.slot), accept: el.dataset.accept,
        x: el.style.getPropertyValue('--sx'), y: el.style.getPropertyValue('--sy'),
        disabled: el.disabled, ariaDisabled: el.getAttribute('aria-disabled'),
        cls: el.className, title: el.getAttribute('title') || '',
      })),
      bg: document.querySelector('.ddt-strength-bg')?.getAttribute('src') || '',
      rate: document.getElementById('ddtSuccessRate')?.textContent || '',
      bagCount: document.querySelectorAll('.ddt-bag-item').length,
      disabledBag: document.querySelectorAll('.ddt-bag-item.is-disabled').length,
    }));
    assert(forgeUi.note.includes('原版 store.swf') && forgeUi.note.includes('真实可交互 DOM'),
      '铁匠铺必须标明素材来源与真实交互，不冒充原版强化规则');
    assert(forgeUi.note.includes('单机自定义强化规则') && forgeUi.note.includes('不是原版强化算法'),
      '界面必须明确「原版素材 + 单机自定义强化规则」');
    assert.equal(forgeUi.slots.length, 6, '六个原版槽位齐全（其中 4 个按当前规则置灰）');
    assert.deepEqual(forgeUi.slots.map((s) => s.accept),
      ['strength-stone', 'strength-stone', 'strength-stone', 'god-charm', 'lucky-charm', 'weapon'],
      '槽位类型须与 StoreIIStrengthBG.as 的 StoreCell 顺序一致');
    assert.equal(forgeUi.slots[0].x, '106px', 'Strengthpoint0 x 应与 store.xml 一致');
    assert.equal(forgeUi.slots[0].y, '-6px', 'Strengthpoint0 y 应与 store.xml 一致');
    assert.equal(forgeUi.slots[0].disabled, false, '0 号强化石槽启用');
    assert.equal(forgeUi.slots[5].disabled, false, '5 号装备槽启用');
    for (const i of [1, 2, 3, 4]) {
      assert.equal(forgeUi.slots[i].disabled, true, `${i} 号槽必须禁用`);
      assert.equal(forgeUi.slots[i].ariaDisabled, 'true', `${i} 号槽须标记 aria-disabled`);
      assert(forgeUi.slots[i].cls.includes('is-disabled'), `${i} 号槽须有置灰样式`);
      assert(forgeUi.slots[i].title.includes('已禁用'), `${i} 号槽须说明禁用原因`);
    }
    assert(forgeUi.bg.includes('store-strength-bg.jpg'), '必须使用导出的原版红金色强化台底图');
    assert(forgeUi.rate.includes('成功率') && forgeUi.rate.includes('100%'), '成功率区固定显示 100%');
    assert(forgeUi.rule.includes('SIMPLE_LOCAL_V1') && forgeUi.rule.includes('原版素材 + 单机自定义强化规则'),
      '界面必须显示当前采用的规则版本与标注');
    assert(forgeUi.ruleBody.includes('中文品质名称待核对'), '翻牌武器名称状态须如实标注');
    for (const label of ['当前等级', '目标等级', '当前基础伤害', '强化后基础伤害',
      '未强化基础值', '消耗金币', '消耗材料', '成功率', '上限', '规则版本']) {
      assert(forgeUi.detail.includes(label), `强化预览应显示「${label}」`);
    }
    assert(forgeUi.bagCount >= 31, '道具栏应展示全部登记材料');
    assert(forgeUi.disabledBag > 0, '非强化石材料必须置灰且不可点选');
    pass('房间内打开原版素材铁匠铺：0/5 槽启用、1~4 槽置灰、100% 成功率与完整强化预览');

    // 音效场景映射：地图音乐编号不等于地图编号
    const audioMap = await page.evaluate(() => window.__GUNNY_HOOKS__?.audioDebug?.().sceneMap || null);
    assert(audioMap, '必须暴露原版 BGM 映射供验收');
    assert.equal(audioMap.mapBackMusic['1157'], '1071', '地图 1157 的 BackMusic 应为 1071');
    assert.equal(audioMap.mapBackMusic['1049'], '1032', '地图 1049 的 BackMusic 应为 1032');
    pass('原版 BGM 映射按 LoadMapsItems.xml 的 BackMusic，不默认等于地图编号');

    // 两张卡由 UI 真实领取（1 金币 + 1 真强化石），第 3 张故意不翻以验证「继续翻牌」入口。
    // 白盒夹具只兜底补足测试库资产，不改正常掉落规则、不改强化规则。
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

    // 拖放：原版 StoreDragInArea / DragManager 交互路径真实可用；
    // 当前单机规则只有 0 号强化石槽与 5 号装备槽接受拖放，禁用槽必须拒绝。
    await page.click('.ddt-slot[data-slot="0"]');
    assert(!(await page.evaluate(() =>
      document.querySelector('.ddt-slot[data-slot="0"]').classList.contains('is-filled'))),
    '点击已填充槽位应移除材料');

    const dragPlaced = await page.evaluate((key) => {
      const fire = (item, slot, type) => {
        const dt = new DataTransfer();
        item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        slot.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        slot.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        return dt;
      };
      const item = document.querySelector(`.ddt-bag-item[data-item="${key}"]`);
      const slot0 = document.querySelector('.ddt-slot[data-slot="0"]');
      if (!item || !slot0) return { ok: false, reason: '槽位或道具不存在' };
      const dt = fire(item, slot0);
      // placeIntoS() 会 renderForge() 重绘槽位，必须重新查询 DOM，不能持有旧节点。
      const fresh0 = document.querySelector('.ddt-slot[data-slot="0"]');
      // 重绘后重新取道具节点，确保禁用槽测试走完整的 dragstart → drop 路径。
      const disabled = document.querySelector('.ddt-slot[data-slot="3"]');
      fire(document.querySelector(`.ddt-bag-item[data-item="${key}"]`), disabled);
      const fresh3 = document.querySelector('.ddt-slot[data-slot="3"]');
      return {
        ok: !!fresh0 && fresh0.classList.contains('is-filled'),
        payload: dt.getData('text/plain'),
        disabledRejected: !!fresh3 && !fresh3.classList.contains('is-filled'),
      };
    }, stoneKey);
    assert(dragPlaced.ok, `拖放道具必须真实放入 0 号强化石槽：${JSON.stringify(dragPlaced)}`);
    assert(dragPlaced.payload.includes('strength-stone'), '拖放载荷应携带真实道具类型');
    assert(dragPlaced.disabledRejected, '禁用槽不得接受拖放');

    const weaponDrag = await page.evaluate(() => {
      const item = document.querySelector('.ddt-forge-weapon.is-active') || document.querySelector('.ddt-forge-weapon');
      const slot = document.querySelector('.ddt-slot[data-slot="5"]');
      if (!item || !slot) return { ok: false };
      const dt = new DataTransfer();
      item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      slot.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      slot.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const fresh = document.querySelector('.ddt-slot[data-slot="5"]');
      return { ok: !!fresh && fresh.classList.contains('is-filled'), payload: dt.getData('text/plain') };
    });
    assert(weaponDrag.ok && weaponDrag.payload.includes('weapon'), '装备栏拖放到 5 号装备槽应真实可用');
    pass('拖放道具/装备真实进入 0、5 号槽，禁用槽拒绝，点击槽位可移除（不依赖背景截图）');

    // 拖放演示结束后把 5 号槽恢复为「已装备武器」，确保后续强化目标与断言对象一致。
    const equippedWeaponId = await page.evaluate(async () => {
      const f = (await (await fetch('/api/server/forge', { cache: 'no-store' })).json()).forge;
      return f.weapons.find((w) => w.equipped)?.id;
    });
    assert(equippedWeaponId, '应有已装备武器');
    await page.click(`.ddt-forge-weapon[data-weapon="${equippedWeaponId}"]`);
    assert.equal(await page.evaluate(() =>
      document.querySelector('.ddt-slot[data-slot="5"]')?.classList.contains('is-filled')), true,
    '恢复装备槽后仍应显示待强化装备');

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

    const beforeForge = await page.evaluate(() => {
      const f = window.__DDT_FORGE_BEFORE__;
      const w = f.weapons.find((x) => x.equipped);
      return {
        coins: f.wallet.coins, stones: f.wallet.items.reduce((s, i) =>
          s + (i.kind === 'strength-stone' ? i.quantity : 0), 0),
        level: w.level, attackPrecise: w.attackPrecise, baseAttack: w.baseAttack,
        cost: w.cost, ruleSource: f.ruleSource,
      };
    });
    assert.equal(beforeForge.ruleSource, 'SIMPLE_LOCAL_V1');
    assert.equal(beforeForge.level, 0);
    assert.equal(beforeForge.baseAttack, 100);
    assert.equal(beforeForge.cost.coins, 100, '+0→+1 需 100 金币');
    assert.equal(beforeForge.cost.stones, 1);
    assert.equal(beforeForge.cost.nextAttackPrecise, 110, '强化后基础伤害预览 = 100 × 1.10');
    assert(beforeForge.coins >= 100 && beforeForge.stones >= 1, '测试库应具备一次强化所需资产');

    await page.click('[data-action="strengthen"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('ddtForgeResult');
      return el && el.textContent.trim().length > 0;
    }, { timeout: 15000 });
    const forgeResult = await page.evaluate(async () => {
      const r = await fetch('/api/server/forge', { cache: 'no-store' });
      const f = (await r.json()).forge;
      const w = f.weapons.find((x) => x.equipped);
      return {
        text: document.getElementById('ddtForgeResult').textContent,
        detail: document.getElementById('ddtForgeDetail').textContent,
        level: w.level, attack: w.attack, attackPrecise: w.attackPrecise,
        baseAttack: w.baseAttack, ruleVersion: w.ruleVersion,
        coins: f.wallet.coins,
        stones: f.wallet.items.reduce((s, i) => s + (i.kind === 'strength-stone' ? i.quantity : 0), 0),
      };
    });
    assert(forgeResult.text.includes('强化成功'), `强化结果：${forgeResult.text}`);
    assert.equal(forgeResult.level, 1, '等级 +0 → +1');
    assert.equal(forgeResult.attack, 110, '基础伤害 = 100 × 1.10 = 110');
    assert.equal(forgeResult.attackPrecise, 110, '精确属性保留');
    assert.equal(forgeResult.baseAttack, 100, '未强化基础值不变，禁止叠乘');
    assert.equal(forgeResult.ruleVersion, 'SIMPLE_LOCAL_V1');
    assert.equal(forgeResult.coins, beforeForge.coins - 100, '金币只扣 100');
    assert.equal(forgeResult.stones, beforeForge.stones - 1, '真强化石只扣 1 颗');
    assert(forgeResult.text.includes('100') && forgeResult.text.includes('1 颗'), '结果文案应显示实际扣费');
    assert(forgeResult.detail.includes('110'), '强化成功后预览立即刷新');
    pass('铁匠铺强化成功：+1 / 基础伤害 110 / 金币 -100 / 材料 -1 / 背包与装备展示即时更新');
    await sleep(1800); // 结果特效 1.6s 后消失，交付截图需完整展示 6 个槽位
    // 侧栏与面板自身可滚动；截图时临时调高视口并展开滚动容器，把顶部规则条、
    // 6 个槽位与「强化预览 / 规则说明」完整呈现（不改动任何 DOM 内容），截完立即恢复。
    await page.setViewport({ width: 1366, height: 1200 });
    await page.evaluate(() => {
      for (const sel of ['.ddt-forge-side', '.ddt-forge-frame']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        el.dataset.shotMaxHeight = el.style.maxHeight || '';
        el.dataset.shotOverflow = el.style.overflow || '';
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';
      }
    });
    const forgeFrame = await page.$('.ddt-forge-frame');
    await forgeFrame.screenshot({ path: shot('forge') });
    await page.evaluate(() => {
      for (const sel of ['.ddt-forge-side', '.ddt-forge-frame']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        el.style.maxHeight = el.dataset.shotMaxHeight || '';
        el.style.overflow = el.dataset.shotOverflow || '';
        delete el.dataset.shotMaxHeight;
        delete el.dataset.shotOverflow;
      }
    });
    await page.setViewport({ width: 1366, height: 768 });

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

    await page.screenshot({ path: shot('room-after-reload') });

    // 下一局：同条件攻击实际使用强化后的基础伤害（读服务端权威状态，不靠 UI 文案）。
    assert.equal((await post(base, '/api/server/room/start', {})).status, 200);
    const nextState = await get(base, '/api/state');
    assert.equal(nextState.actors[0].attack, 110, '下一局引擎内实际使用 110 基础伤害');
    assert.equal(nextState.actors[1].attack, 35, '机器人属性不受强化影响');
    assert.equal((await post(base, '/api/server/room/leave', {})).status, 200);
    pass('下一局同条件攻击验证强化增益：玩家 110 / 机器人 35（当前进行中的战斗不受影响）');

    // 重复提交同一 requestId：返回同一结果，金币与材料只扣一次。
    const forgeBeforeReplay = (await get(base, '/api/server/forge')).forge;
    const replayW = forgeBeforeReplay.weapons.find((w) => w.equipped);
    const replayPayload = { weaponInstanceId: replayW.id, requestId: 'browser-replay-fixed' };
    const replay1 = await (await post(base, '/api/server/forge/strengthen', replayPayload)).json();
    const replay2 = await (await post(base, '/api/server/forge/strengthen', replayPayload)).json();
    assert.deepEqual(replay2, replay1, '重复提交必须返回完全相同的已存结果');
    const forgeAfterReplay = (await get(base, '/api/server/forge')).forge;
    assert.equal(forgeAfterReplay.wallet.coins,
      forgeBeforeReplay.wallet.coins - replay1.cost.coins, '金币只扣一次');
    assert.equal(forgeAfterReplay.weapons.find((w) => w.equipped).level, replayW.level + 1,
      '武器只升一级');
    pass('重复提交同一 requestId 不会重复扣费、不会重复升级');

    // 金币不足 / 材料不足 / +12 上限：UI 明确提示原因，服务端同样拒绝。
    const checkScene = async (scene, expected, clickIt) => {
      setTestScene(dataDir, scene);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => !!document.getElementById('ddtServerLayer')
        && !document.getElementById('ddtServerLayer').hidden
        && document.querySelectorAll('.ddt-map').length === 12, { timeout: 30000 });
      await page.click('[data-action="open-forge"]');
      await page.waitForFunction(() => !document.getElementById('ddtForge').hidden
        && document.querySelectorAll('.ddt-slot').length === 6, { timeout: 15000 });
      const info = await page.evaluate(() => ({
        reason: document.querySelector('.ddt-reason')?.textContent || '',
        detail: document.getElementById('ddtForgeDetail')?.textContent || '',
        btnDisabled: document.getElementById('ddtStrengthBtn')?.disabled,
      }));
      assert((info.reason + info.detail).includes(expected),
        `${scene} 场景须在预览区明确提示「${expected}」：${JSON.stringify(info)}`);
      if (clickIt) {
        await page.click('[data-action="strengthen"]');
        await page.waitForFunction(() =>
          document.getElementById('ddtForgeResult').textContent.includes('强化未完成'), { timeout: 12000 });
        const text = await page.evaluate(() => document.getElementById('ddtForgeResult').textContent);
        assert(text.includes(expected), `${scene} 场景服务端拒绝原因须上屏：${text}`);
      } else {
        assert.equal(info.btnDisabled, true, '+12 上限时强化按钮必须禁用');
      }
    };
    await checkScene('no-coins', '金币不足', true);
    await checkScene('no-stones', '强化石不足', true);
    await checkScene('at-max', '已达 +12 上限', false);
    pass('金币不足 / 材料不足 / +12 上限：预览区与服务端拒绝原因均明确提示');

    assert.equal(errors.length, 0, `页面出现 JS 错误：\n${errors.join('\n')}`);

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
    console.log(`截图：${shotDir}/2026-11-28-stage10-{settlement,forge,room-after-reload}.png`);
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
