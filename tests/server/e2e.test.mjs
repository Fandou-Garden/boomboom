/**
 * 服务端版端到端验收：
 * 房间 -> 选地图/武器 -> 服务端权威战斗 + 弱机器人 -> 胜负结算 ->
 * 九宫格翻牌入库 -> 铁匠铺强化 -> 下一局使用强化属性 -> 后端重启后存档保留。
 *
 * 测试自起一个隔离的 Node 服务（独立端口 + /tmp 临时数据库），
 * 不读写用户的 data/ddt.sqlite。DDT_DEBUG=1 仅用于快速打完一局，
 * 正式运行默认关闭调试命令。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function startServer(port, dataDir) {
  const proc = spawn(TSX, ['server-node/src/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DDT_HOST: '127.0.0.1', DDT_PORT: String(port),
      DDT_DATA_DIR: dataDir, DDT_DB_PATH: path.join(dataDir, 'ddt.sqlite'),
      DDT_DEBUG: '1', DDT_MODE: 'server',
      // 主闭环使用独立测试奖励池（强制 2 金币 + 1 强化石 + 1 武器，仍整体洗牌），
      // 确保「翻牌 → 强化」不靠碰概率；正常奖励池在 forge-rules.test.mjs 单独验证。
      DDT_REWARD_POOL: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  proc.stdout.on('data', (d) => { logs += d.toString(); });
  proc.stderr.on('data', (d) => { logs += d.toString(); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return { proc, base, logs: () => logs };
    } catch { /* not up yet */ }
    await sleep(150);
  }
  proc.kill('SIGKILL');
  throw new Error(`server did not start:\n${logs}`);
}

async function stopServer(handle) {
  if (!handle?.proc || handle.proc.exitCode !== null) return;
  const exited = new Promise((resolve) => handle.proc.once('exit', resolve));
  handle.proc.kill('SIGTERM');
  await Promise.race([exited, sleep(5000)]);
  if (handle.proc.exitCode === null) handle.proc.kill('SIGKILL');
}

function client(base) {
  return {
    async get(p) {
      const res = await fetch(base + p, { cache: 'no-store' });
      const text = await res.text();
      let body; try { body = JSON.parse(text); } catch { body = text; }
      return { status: res.status, body };
    },
    async post(p, payload = {}) {
      const res = await fetch(base + p, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let body; try { body = JSON.parse(text); } catch { body = text; }
      return { status: res.status, body };
    },
  };
}

async function solveHit(state, mapId) {
  const url = (rel) => `${pathToFileURL(path.join(ROOT, rel)).href}?v=33`;
  const { loadTerrainFromBytes } = await import(url('dist/js/engine/terrain.js'));
  const { solveShotForWeapon } = await import(url('dist/js/engine/ai.js'));
  const { WEAPON_DEFS } = await import(url('dist/js/engine/constants.js'));
  const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'dist', 'data', `${mapId}.fore.map`)));
  const terrain = loadTerrainFromBytes(bytes);
  const shooter = {
    x: state.actors[0].x, y: state.actors[0].y,
    slope: state.actors[0].slope ?? 0, alive: true,
  };
  const target = { x: state.actors[1].x, y: state.actors[1].y, alive: true };
  const weapon = WEAPON_DEFS[state.weapon] || WEAPON_DEFS.fruit;
  return solveShotForWeapon(shooter, target, state.wind ?? 0, terrain, weapon, 14, 2000);
}

test('服务端版完整业务闭环 + 事务防重 + 重启存档', async (t) => {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-e2e-'));
  let handle = await startServer(port, dataDir);
  let api = client(handle.base);
  t.after(async () => { await stopServer(handle); });

  // --- 1. 配置与房间 ---
  const config = await api.get('/api/server/config');
  assert.equal(config.status, 200);
  assert.equal(config.body.mode, 'server');

  let room = (await api.get('/api/server/room')).body.room;
  assert.equal(room.maps.length, 12, '应有约 10 张以上已检出地图');
  assert.ok(room.weapons.length >= 10, '应有多把已有武器');
  assert.equal(room.wallet.coins, 0);
  // 002 迁移后物品目录按原版分类：6 强化石 + 20 四圣兽合成石 + 4 幸运符 + 1 神恩符。
  const kinds = room.wallet.items.reduce((m, i) => { m[i.kind] = (m[i.kind] || 0) + 1; return m; }, {});
  assert.equal(kinds['strength-stone'], 6, 'Đá cường hóa 1~6 原版强化石均已登记');
  assert.equal(kinds['compose-stone'], 20, '四圣兽合成石 4 系 × 5 级');
  assert.equal(kinds['lucky-charm'], 4);
  assert.equal(kinds['god-charm'], 1);
  assert.equal(room.wallet.items.length, 31);
  assert.ok(room.wallet.items.filter((i) => i.itemKey.startsWith('xuanwu'))
    .every((i) => i.kind === 'compose-stone'), '玄武石应纠正为合成石，不能作为强化材料');

  const unmatched = await api.get('/api/server/player');
  assert.equal(unmatched.status, 200);

  // --- 2. 选地图与武器 ---
  room = (await api.post('/api/server/room/map', { mapId: '1001' })).body.room;
  assert.equal(room.mapId, '1001');
  const badMap = await api.post('/api/server/room/map', { mapId: '99999' });
  assert.equal(badMap.status, 400, '未检出的地图必须拒绝');

  const other = room.weapons.find((w) => w.weaponId !== room.equipped.weaponId);
  room = (await api.post('/api/server/room/weapon', { weaponInstanceId: other.id })).body.room;
  assert.equal(room.equipped.weaponId, other.weaponId, '房间内可切换装备武器');
  const fruit = room.weapons.find((w) => w.weaponId === 'fruit');
  room = (await api.post('/api/server/room/weapon', { weaponInstanceId: fruit.id })).body.room;
  assert.equal(room.equipped.weaponId, 'fruit');

  // --- 3. 开始战斗：属性冻结 ---
  const started = await api.post('/api/server/room/start', {});
  assert.equal(started.status, 200);
  const battleId = started.body.battleId;
  assert.ok(battleId);
  let state = (await api.get('/api/state')).body;
  assert.equal(state.phase, 'player');
  assert.equal(state.actors[0].attack, 100, '本局冻结未强化攻击属性');
  assert.equal(state.actors[1].attack, 35, '弱机器人攻击倍率 0.35');

  // 前端不能提交结果字段 / 不能自行重置引擎
  const forged = await api.post('/api/command', { type: 'aim_absolute', value: 45, damage: 99999 });
  assert.equal(forged.status, 403, '前端不得提交伤害结果');
  const restart = await api.post('/api/command', { type: 'restart' });
  assert.equal(restart.status, 403, '服务端权威，restart 不允许前端触发');
  const foreignWeapon = await api.post('/api/command', { type: 'select_weapon', weapon: 'not-owned' });
  assert.equal(foreignWeapon.status, 403);

  // --- 4. 打完一局（调试模式用原版弹道求解命中，走同一伤害结算入口） ---
  assert.equal((await api.post('/api/command', { type: 'debug_set_hp', actor: 1, hp: 1 })).status, 200);
  state = (await api.get('/api/state')).body;
  const plan = await solveHit(state, room.mapId);
  assert.ok(Number.isFinite(plan.angle) && Number.isFinite(plan.force), '弹道求解应给出合法参数');
  const fire = await api.post('/api/command', {
    type: 'fire', actor: 0, angle: plan.angle, force: plan.force,
  });
  assert.equal(fire.status, 200, `fire 命令被拒绝：${JSON.stringify(fire.body)}`);

  let winner = null;
  for (let i = 0; i < 120; i += 1) {
    const snap = (await api.get('/api/state')).body;
    if (snap.winner !== null && snap.winner !== undefined) { winner = snap.winner; break; }
    await sleep(250);
  }
  assert.equal(winner, 0, `应在一局内由服务端判定胜负，实际 winner=${winner}`);

  room = (await api.get('/api/server/room')).body.room;
  assert.ok(room.lastResult, '结算记录已保存');
  assert.equal(room.lastResult.battleId, battleId);
  assert.ok(room.pendingReward, '结算后创建奖励盘');

  // --- 5. 九宫格翻牌：事务防重 ---
  let board = (await api.get(`/api/server/battles/${battleId}/rewards`)).body.board;
  assert.equal(board.cards.length, 9);
  assert.equal(board.maxPicks, 3);
  assert.equal(board.picksUsed, 0);
  assert.ok(board.cards.every((c) => !c.revealed), '未翻卡不得下发奖励内容');

  // 白盒测试夹具：服务端 9 张卡整体洗牌后落位（没有固定卡位），固定翻 0/1/2
  // 有概率三张都不是材料卡，会让后续强化闭环偶发失败。这里直接读**隔离的临时库**
  // cards_json 来挑选卡位：不经过前端、不下发未翻卡内容、不改正常掉落规则与奖励池配置，
  // 也不删任何原有断言。生产代码与正常掉落规则完全不变。
  const boardDb = new DatabaseSync(path.join(dataDir, 'ddt.sqlite'));
  let storedCards;
  try {
    const row = boardDb.prepare('SELECT cards_json FROM reward_boards WHERE battle_id = ?').get(battleId);
    assert.ok(row?.cards_json, '临时库应已保存本局奖励盘');
    storedCards = JSON.parse(row.cards_json);
  } finally {
    boardDb.close();
  }
  assert.equal(storedCards.length, 9, '服务端奖励盘应为 9 张');
  const itemIndex = storedCards.findIndex((c) => c.kind === 'item');
  assert.ok(itemIndex >= 0, '测试奖励池应强制产生真强化石卡');
  // 取金额最大的 2 张金币卡：测试池强制 2 张，赢局每张 ≥80，合计 ≥160 > +1 的 100 金币。
  const coinIndices = storedCards.map((c, i) => ({ c, i }))
    .filter(({ c }) => c.kind === 'coin')
    .sort((a, b) => Number(b.c.amount) - Number(a.c.amount))
    .map(({ i }) => i);
  assert.ok(coinIndices.length >= 2, '测试奖励池应强制产生至少 2 张金币卡');
  assert.ok(storedCards.some((c) => c.kind === 'weapon'), '测试奖励池应强制产生 1 张武器卡');
  const picked = [itemIndex, coinIndices[0], coinIndices[1]];
  const unclaimed = storedCards.map((_, i) => i).find((i) => !picked.includes(i));
  const expectedCoins = picked.reduce((s, i) =>
    s + (storedCards[i].kind === 'coin' ? Number(storedCards[i].amount) : 0), 0);
  const expectedStones = picked.reduce((s, i) =>
    s + (storedCards[i].kind === 'item' ? Number(storedCards[i].amount) : 0), 0);
  assert.ok(expectedCoins >= 100, '夹具所选金币卡须足够支付 +0→+1 的 100 金币');
  assert.ok(expectedStones >= 1, '夹具所选卡位须含材料卡，保证强化材料闭环');
  assert.equal(board.poolMode, 'test', '主闭环使用独立测试奖励池');
  assert.equal(board.poolVersion, config.body.rules.rewards.poolVersion, '奖励盘记录生成时的配置版本');

  const req1 = 'e2e-request-1';
  const pick1 = await api.post(`/api/server/battles/${battleId}/rewards/claim`, { cardIndex: picked[0], requestId: req1 });
  assert.equal(pick1.status, 200);
  assert.ok(pick1.body.reward, '奖励由服务端返回');

  const replay = await api.post(`/api/server/battles/${battleId}/rewards/claim`, { cardIndex: picked[0], requestId: req1 });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, pick1.body, '同一 requestId 重试必须返回完全相同的已存结果');

  const duplicate = await api.post(`/api/server/battles/${battleId}/rewards/claim`, {
    cardIndex: picked[0], requestId: 'e2e-request-duplicate',
  });
  assert.equal(duplicate.status, 409, '同一张卡不能重复领');
  assert.equal(duplicate.body.code, 'card-already-picked');

  await api.post(`/api/server/battles/${battleId}/rewards/claim`, { cardIndex: picked[1], requestId: 'e2e-request-2' });
  const pick3 = await api.post(`/api/server/battles/${battleId}/rewards/claim`, { cardIndex: picked[2], requestId: 'e2e-request-3' });
  assert.equal(pick3.status, 200);
  assert.equal(pick3.body.status, 'closed');

  const tooMany = await api.post(`/api/server/battles/${battleId}/rewards/claim`, {
    cardIndex: unclaimed, requestId: 'e2e-request-4',
  });
  assert.equal(tooMany.status, 409, '超过 3 张必须拒绝');

  const walletAfterCards = (await api.get('/api/server/player')).body.wallet;
  assert.ok(walletAfterCards.coins >= 60, '翻牌金币已入库');
  assert.equal(walletAfterCards.coins, expectedCoins, '金币严格按已翻卡面入库，不重复发放');
  const totalStones = walletAfterCards.items.reduce((s, i) => s + i.quantity, 0);
  assert.ok(totalStones >= 1, '原版强化石已入库');
  assert.equal(totalStones, expectedStones, '材料严格按已翻卡面入库，不重复发放');
  // 重复请求没有造成二次发奖
  await api.post(`/api/server/battles/${battleId}/rewards/claim`, { cardIndex: picked[0], requestId: req1 });
  const walletAfterReplay = (await api.get('/api/server/player')).body.wallet;
  assert.equal(walletAfterReplay.coins, walletAfterCards.coins, '重放不重复发金币');
  assert.equal(
    walletAfterReplay.items.reduce((s, i) => s + i.quantity, 0), totalStones,
    '重放不重复发材料',
  );

  // --- 6. 铁匠铺强化：单事务 + requestId 防重放 ---
  let forge = (await api.get('/api/server/forge')).body.forge;
  assert.equal(forge.ruleSource, 'SIMPLE_LOCAL_V1', '交付规则为单机自定义强化规则');
  assert.equal(forge.maxLevel, 12);
  assert.equal(forge.successRate, 1);
  assert.deepEqual(forge.slots, { strength: [0], disabledStrength: [1, 2], god: 3, lucky: 4, equip: 5 });
  const equipped = forge.weapons.find((w) => w.equipped);
  assert.equal(equipped.level, 0);
  assert.equal(equipped.baseAttack, 100, '未强化基础伤害');
  assert.equal(equipped.cost.coins, 100, '+0→+1 金币 = 100 × 目标等级 1');
  assert.equal(equipped.cost.stones, 1, '每次仅消耗 1 颗真强化石');
  assert.equal(equipped.cost.successRate, 1, '成功率 100%');
  assert.equal(equipped.cost.nextAttackPrecise, 110, '100 × 1.10 = 110');

  // 前端不能提交强化结果，也不能使用已禁用的符咒槽。
  const clientResult = await api.post('/api/server/forge/strengthen', {
    weaponInstanceId: equipped.id, requestId: 'e2e-forbidden-result', success: true, level: 12,
  });
  assert.equal(clientResult.status, 400, '前端不得决定强化结果');
  assert.equal(clientResult.body.code, 'client-cannot-decide-result');
  const clientCharm = await api.post('/api/server/forge/strengthen', {
    weaponInstanceId: equipped.id, requestId: 'e2e-forbidden-charm', luckyCharm: 'lucky1',
  });
  assert.equal(clientCharm.status, 400, '幸运符 / 神恩符不参与当前单机规则');
  assert.equal(clientCharm.body.code, 'client-cannot-decide-result');

  const forgeReq = 'e2e-forge-request-1';
  const strengthened = await api.post('/api/server/forge/strengthen', {
    weaponInstanceId: equipped.id, requestId: forgeReq,
  });
  assert.equal(strengthened.status, 200, `强化失败：${JSON.stringify(strengthened.body)}`);
  assert.equal(strengthened.body.success, true);
  assert.equal(strengthened.body.weapon.levelAfter, 1);
  assert.equal(strengthened.body.weapon.attackAfter, 110, '100 × 1.10 = 110，不是旧规则 +25');
  assert.equal(strengthened.body.weapon.attackPreciseAfter, 110);
  assert.equal(strengthened.body.weapon.baseAttack, 100, '始终从未强化基础值重算');
  assert.equal(strengthened.body.cost.coins, 100);
  assert.equal(strengthened.body.cost.stones, 1);
  assert.equal(strengthened.body.ruleSource, 'SIMPLE_LOCAL_V1');

  const forgeReplay = await api.post('/api/server/forge/strengthen', {
    weaponInstanceId: equipped.id, requestId: forgeReq,
  });
  assert.equal(forgeReplay.status, 200);
  assert.deepEqual(forgeReplay.body, strengthened.body, '同一强化请求重放返回同一结果');

  forge = (await api.get('/api/server/forge')).body.forge;
  const after = forge.weapons.find((w) => w.id === equipped.id);
  assert.equal(after.level, 1, '重放不能二次升级');
  assert.equal(after.attack, 110);
  assert.equal(after.attackPrecise, 110);
  assert.equal(after.baseAttack, 100, '强化等级与属性属于武器实例，不修改共享模板');
  const walletAfterForge = forge.wallet;
  assert.equal(walletAfterForge.coins, walletAfterCards.coins - 100, '金币只扣一次');
  assert.equal(
    walletAfterForge.items.reduce((s, i) => s + i.quantity, 0), expectedStones - 1,
    '真强化石只扣 1 颗；合成石 / 符咒数量不变',
  );

  // --- 7. 下一局使用强化属性 ---
  await api.post('/api/server/room/leave', {});
  const second = await api.post('/api/server/room/start', {});
  assert.equal(second.status, 200);
  assert.notEqual(second.body.battleId, battleId);
  const state2 = (await api.get('/api/state')).body;
  assert.equal(state2.actors[0].attack, 110, '下一场战斗实际应用强化后的基础伤害');
  assert.equal(state2.actors[1].attack, 35, '机器人倍率不变');

  // 战斗中禁止改装备（本局属性已冻结）
  const midBattleEquip = await api.post('/api/server/room/weapon', { weaponInstanceId: other.id });
  assert.equal(midBattleEquip.status, 409);

  // --- 8. WebSocket 低频事件通道 ---
  const wsMessage = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timer = setTimeout(() => { ws.close(); reject(new Error('WebSocket 超时')); }, 5000);
    ws.on('message', (raw) => {
      clearTimeout(timer); ws.close();
      try { resolve(JSON.parse(raw.toString())); } catch (e) { reject(e); }
    });
    ws.on('error', reject);
  });
  assert.equal(wsMessage.type, 'hello');

  // --- 9. 重启后端后金币、材料、强化等级保留 ---
  const coinsBeforeRestart = walletAfterForge.coins;
  const stonesBeforeRestart = walletAfterForge.items.reduce((s, i) => s + i.quantity, 0);
  await stopServer(handle);
  handle = await startServer(port, dataDir);
  api = client(handle.base);

  const walletRestart = (await api.get('/api/server/player')).body.wallet;
  assert.equal(walletRestart.coins, coinsBeforeRestart, '重启后金币保留');
  assert.equal(
    walletRestart.items.reduce((s, i) => s + i.quantity, 0), stonesBeforeRestart,
    '重启后材料保留',
  );
  const forgeRestart = (await api.get('/api/server/forge')).body.forge;
  const weaponRestart = forgeRestart.weapons.find((w) => w.id === equipped.id);
  assert.equal(weaponRestart.level, 1, '重启后强化等级保留');
  assert.equal(weaponRestart.attack, 110, '重启后基础伤害保留');
  assert.equal(weaponRestart.baseAttack, 100, '重启后未强化基础值保留，不会二次叠乘');
  assert.equal(weaponRestart.ruleVersion, 'SIMPLE_LOCAL_V1', '重启后规则版本保留');
  const roomRestart = (await api.get('/api/server/room')).body.room;
  assert.equal(roomRestart.mapId, '1001', '重启后房间地图选择保留');
  assert.ok(roomRestart.lastResult, '重启后战斗结算记录保留');

  // 重启后未结束的战斗被安全放弃，不会伪造结算
  assert.equal((await api.get('/healthz')).body.battleState, 'idle');

  console.log(`\n[ddt-e2e] 通过：端口 ${port}，临时数据库 ${dataDir}`);
});
