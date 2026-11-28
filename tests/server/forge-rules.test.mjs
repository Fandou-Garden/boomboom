/**
 * 原版强化链路 / LOCAL_RULE / 奖励池与武器发放的规则测试（验收要求 2 / 4 / 5）。
 *
 * 随机结果通过可注入随机源 DDT_FORGE_RANDOM 精确控制（always-success / always-fail），
 * 不靠反复运行碰概率。所有服务使用临时端口 + /tmp 临时库，不触碰用户存档。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLAYER = 'local-player';

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function boot(tmpDir, dbPath, env) {
  const port = await freePort();
  const proc = spawn(TSX, ['server-node/src/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DDT_HOST: '127.0.0.1', DDT_PORT: String(port),
      DDT_DATA_DIR: tmpDir, DDT_DB_PATH: dbPath,
      DDT_MODE: 'server', DDT_DEBUG: '0',
      ...env,
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

async function stop(handle) {
  if (!handle?.proc || handle.proc.exitCode !== null) return;
  const exited = new Promise((resolve) => handle.proc.once('exit', resolve));
  handle.proc.kill('SIGTERM');
  await Promise.race([exited, sleep(5000)]);
  if (handle.proc.exitCode === null) handle.proc.kill('SIGKILL');
}

function api(base) {
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

/** 服务停止后往临时库注入可控的资产 / 武器实例 / 奖励盘。 */
function inject(dbPath, { coins, items = {}, extraWeapons = [], board = null }) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (coins !== undefined) {
    db.prepare('UPDATE players SET coins = ? WHERE id = ?').run(coins, PLAYER);
  }
  for (const [key, qty] of Object.entries(items)) {
    db.prepare(`INSERT INTO inventory (player_id, item_key, quantity) VALUES (?, ?, ?)
                ON CONFLICT(player_id, item_key) DO UPDATE SET quantity = excluded.quantity`)
      .run(PLAYER, key, qty);
  }
  for (const w of extraWeapons) {
    db.prepare(`INSERT OR REPLACE INTO weapon_instances
      (id, player_id, weapon_id, label, level, attack, version, equipped, created_at, updated_at,
       template_id, base_weapon_id, variant, rule_version, template_level)
      VALUES (?,?,?,?,?,?,0,0,?,?,?,?,?,?,?)`)
      .run(w.id, PLAYER, w.weaponId, w.label, w.level, w.attack, 1700000000000, 1700000000000,
        w.templateId ?? null, w.baseWeaponId ?? null, w.variant || 'candidate',
        w.ruleVersion || 'LOCAL_RULE', w.templateLevel ?? 2);
  }
  if (board) {
    db.prepare(`INSERT OR REPLACE INTO battles
      (id, player_id, room_id, map_id, weapon_id, weapon_level, weapon_attack, bot_attack,
       seed, status, result, winner, stats_json, started_at, ended_at)
      VALUES (?,?,?,?,?,?,?,?,?,'finished','win',0,'{}',?,?)`)
      .run(board.battleId, PLAYER, `room_${PLAYER}`, '1157', 'fruit', 0, 100, 35, 424242,
        1700000000000, 1700000000001);
    db.prepare(`INSERT OR REPLACE INTO reward_boards
      (id, battle_id, player_id, cards_json, max_picks, picks_used, status, created_at, updated_at,
       pool_mode, pool_note, pool_version, rules_version)
      VALUES (?,?,?,?,3,0,'open',?,?,'test','测试奖励池：验证发放防重','v3-2026-11-28','forge=local/LOCAL_RULE')`)
      .run(board.boardId, board.battleId, PLAYER, JSON.stringify(board.cards),
        1700000000000, 1700000000000);
  }
  db.close();
}

function readDb(dbPath, fn) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return fn(db); } finally { db.close(); }
}

/** 先启动一次建库，再注入数据，最后按目标环境变量重启。 */
async function prepared(env, setup) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-forge-'));
  const dbPath = path.join(tmpDir, 'ddt.sqlite');
  const first = await boot(tmpDir, dbPath, {});
  await stop(first);
  inject(dbPath, setup);
  const handle = await boot(tmpDir, dbPath, env);
  return { handle, base: handle.base, dbPath, tmpDir, a: api(handle.base) };
}

async function finish(ctx) {
  await stop(ctx.handle);
  fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
}

function equippedId(forge) {
  return forge.weapons.find((w) => w.equipped)?.id || forge.weapons[0].id;
}

// ------------------------------------------------------------------ 原版规则：成功路径

test('ORIGINAL 规则：槽位校验 / 幸运符生效 / 成功 / 重放 / 并发 / 下一局属性', async () => {
  const ctx = await prepared(
    { DDT_FORGE_RULES: 'original', DDT_FORGE_RANDOM: 'always-success' },
    { coins: 5000, items: {
      strength1: 20, strength2: 20, strength3: 20, strength4: 20,
      lucky15: 10, lucky100: 10, godCharm: 10, xuanwu1: 10,
    } },
  );
  try {
    const forge = (await ctx.a.get('/api/server/forge')).body.forge;
    assert.equal(forge.rules, 'original');
    assert.equal(forge.ruleSource, 'ORIGINAL_PARTIAL');
    assert.match(forge.activeRuleLabel, /未还原完成/);
    assert.ok(forge.notPorted.length > 0, '界面应列出未还原机制');
    assert.match(forge.attackGrowthSource, /LOCAL_RULE_SUPPLEMENT/);
    assert.equal(forge.originalNoCoinCost, true);
    assert.deepEqual(forge.slots, { strength: [0, 1, 2], god: 3, lucky: 4, equip: 5 });
    assert.ok(forge.materials.strengthStones.length >= 6, '应登记 6 种真强化石');
    assert.ok(forge.materials.composeStones.some((i) => i.itemKey === 'xuanwu1'));
    assert.match(forge.weaponMappingStatus, /UNCONFIRMED/);

    const wid = equippedId(forge);
    const post = (p) => ctx.a.post('/api/server/forge/strengthen', p);

    // --- 槽位校验 ---
    assert.equal((await post({ weaponInstanceId: wid, requestId: 'dup-slot', slots: ['strength1', 'strength1'] })).status,
      400, '三槽必须使用互不相同的强化石');
    assert.equal((await post({ weaponInstanceId: wid, requestId: 'compose-slot', slots: ['xuanwu1'] })).status,
      409, '四圣兽合成石不能作为强化石');
    const four = await post({ weaponInstanceId: wid, requestId: 'four-slot', slots: ['strength1', 'strength2', 'strength3', 'strength4'] });
    assert.equal(four.status, 200);
    assert.equal(four.body.originalDetail.stones.length, 3, '最多 3 个强化石槽');

    // --- 幸运符实际生效（C# 整数除法：15/100=0，100/100=1） ---
    const base = await post({ weaponInstanceId: wid, requestId: 'rate-base', slots: ['strength1'] });
    const l15 = await post({ weaponInstanceId: wid, requestId: 'rate-15', slots: ['strength1'], luckyCharm: 'lucky15' });
    const l100 = await post({ weaponInstanceId: wid, requestId: 'rate-100', slots: ['strength1'], luckyCharm: 'lucky100' });
    assert.equal(base.status, 200);
    assert.ok(base.body.successRate > 0);
    // 每次成功都会升级、Rock 随之变大，因此比较「分子」而非裸 successRate。
    assert.equal(base.body.originalDetail.luckyContribution, 0, '无幸运符时 num2=0');
    assert.ok(l15.body.originalDetail.luckyContribution > 0,
      '幸运符 15% 的整数除法为 0，但仍额外贡献一份 probability');
    assert.ok(l100.body.originalDetail.luckyContribution > l15.body.originalDetail.luckyContribution,
      '100% 幸运符的 Property2/100 = 1，整数除法加成应生效');
    const effective = (r) => r.body.successRate * r.body.originalDetail.rock;
    assert.ok(effective(l15) > effective(base), '同等级下幸运符应提高概率分子');
    assert.ok(effective(l100) > effective(l15));
    assert.equal(l100.body.originalDetail.luckyCharm, 'lucky100');

    // --- 成功：等级+1、攻击按本地补充成长、不扣金币、材料按槽位消耗 ---
    const before = (await ctx.a.get('/api/server/forge')).body.forge;
    const s1Before = before.wallet.items.find((i) => i.itemKey === 'strength1').quantity;
    const coinsBefore = before.wallet.coins;
    const lvBefore = before.weapons.find((w) => w.id === wid).level;
    const ok = await post({ weaponInstanceId: wid, requestId: 'ok-1', slots: ['strength1', 'strength2'] });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    assert.equal(ok.body.weapon.levelAfter, lvBefore + 1);
    assert.equal(ok.body.cost.coins, 0, '原版链路不扣金币');
    assert.equal(ok.body.weaponRuleVersion, 'LOCAL_RULE');
    assert.match(ok.body.attackGrowthSource, /LOCAL_RULE_SUPPLEMENT/);
    assert.ok(ok.body.originalDetail.mechanics.length > 0, '应返回逐项源码证据');
    const after = (await ctx.a.get('/api/server/forge')).body.forge;
    assert.equal(after.wallet.coins, coinsBefore);
    assert.equal(after.wallet.items.find((i) => i.itemKey === 'strength1').quantity, s1Before - 1);

    // --- 同一 requestId 重复执行：结果完全一致，材料只扣一次 ---
    const replay = await post({ weaponInstanceId: wid, requestId: 'ok-1', slots: ['strength1', 'strength2'] });
    assert.deepEqual(replay.body, ok.body, '重放应返回同一持久化结果');
    const afterReplay = (await ctx.a.get('/api/server/forge')).body.forge;
    assert.equal(afterReplay.wallet.items.find((i) => i.itemKey === 'strength1').quantity, s1Before - 1);

    // --- 并发强化：SQLite 事务同步串行，两个不同 requestId 各自生效且不丢失更新 ---
    const preC = (await ctx.a.get('/api/server/forge')).body.forge;
    const lvPreC = preC.weapons.find((w) => w.id === wid).level;
    const qPreC = preC.wallet.items.find((i) => i.itemKey === 'strength1').quantity;
    const [c1, c2] = await Promise.all([
      post({ weaponInstanceId: wid, requestId: 'concurrent-1', slots: ['strength1'] }),
      post({ weaponInstanceId: wid, requestId: 'concurrent-2', slots: ['strength2'] }),
    ]);
    assert.equal(c1.status, 200);
    assert.equal(c2.status, 200);
    assert.notEqual(c1.body.weapon.version, c2.body.weapon.version, '版本应连续递增，无丢失更新');
    const postC = (await ctx.a.get('/api/server/forge')).body.forge;
    assert.equal(postC.weapons.find((w) => w.id === wid).level, lvPreC + 2, '两个请求各升一级');
    assert.equal(postC.wallet.items.find((i) => i.itemKey === 'strength1').quantity, qPreC - 1,
      '每个请求各扣一次材料，不重复扣费');

    // --- 同一 requestId 并发：幂等，只生效一次 ---
    const lvPreIdem = postC.weapons.find((w) => w.id === wid).level;
    const [i1, i2] = await Promise.all([
      post({ weaponInstanceId: wid, requestId: 'idem-concurrent', slots: ['strength1'] }),
      post({ weaponInstanceId: wid, requestId: 'idem-concurrent', slots: ['strength1'] }),
    ]);
    assert.equal(i1.status, 200);
    assert.deepEqual(i2.body, i1.body, '同一 requestId 并发应返回同一持久化结果');
    assert.equal((await ctx.a.get('/api/server/forge')).body.forge.weapons.find((w) => w.id === wid).level,
      lvPreIdem + 1, '幂等请求只应升一级');

    // --- 装备后下一场战斗使用强化后的属性与武器表现 ---
    const finalForge = (await ctx.a.get('/api/server/forge')).body.forge;
    const finalAttack = finalForge.weapons.find((w) => w.id === wid).attack;
    assert.ok(finalAttack > 100, '强化后攻击应提升');
    const started = await ctx.a.post('/api/server/room/start', {});
    assert.equal(started.status, 200);
    const state = (await ctx.a.get('/api/state')).body;
    assert.equal(state.actors[0].attack, finalAttack, '引擎内攻击应等于强化后属性');
    const battle = readDb(ctx.dbPath, (db) => db.prepare(
      'SELECT weapon_id, weapon_level, weapon_attack FROM battles WHERE id = ?',
    ).get(started.body.battleId));
    assert.equal(Number(battle.weapon_attack), finalAttack, '战斗记录应冻结强化后的攻击');
    assert.equal(Number(battle.weapon_level), finalForge.weapons.find((w) => w.id === wid).level);
    assert.equal(battle.weapon_id, 'fruit', '武器弹道 id 应保持有效');
    await ctx.a.post('/api/server/room/leave', {});
  } finally { await finish(ctx); }
});

// ------------------------------------------------------------------ 原版规则：失败与保护

test('ORIGINAL 规则：失败降级 / 神恩符保护 / 等级上限 / 损毁未接线', async () => {
  const ctx = await prepared(
    { DDT_FORGE_RULES: 'original', DDT_FORGE_RANDOM: 'always-fail' },
    {
      coins: 5000,
      items: { strength1: 40, godCharm: 10 },
      extraWeapons: [
        { id: 'wi_hq_down', weaponId: 'hq_fire#test', label: 'VIP-Pháo（中文品质映射待确认）', level: 6, attack: 250, templateId: 7006, baseWeaponId: 'fire', templateLevel: 3 },
        { id: 'wi_hq_max', weaponId: 'hq_max#test', label: 'VIP-Pháo（满级）', level: 15, attack: 475, templateId: 7006, baseWeaponId: 'fire', templateLevel: 3 },
      ],
    },
  );
  try {
    const post = (p) => ctx.a.post('/api/server/forge/strengthen', p);

    // 无神恩符：Template.Level=3 且等级>=5，原版失败降 1 级。
    const down = await post({ weaponInstanceId: 'wi_hq_down', requestId: 'fail-down', slots: ['strength1'] });
    assert.equal(down.status, 200);
    assert.equal(down.body.success, false);
    assert.equal(down.body.weapon.levelAfter, 5, '失败应降 1 级');
    assert.equal(down.body.originalDetail.failureBranch.downgrade, true);
    assert.equal(down.body.originalDetail.failureBranch.godProtected, false);

    // 有神恩符：失败不降级、不损毁（等级仍 >=5，可对比差异）。
    const protectedRun = await post({ weaponInstanceId: 'wi_hq_down', requestId: 'fail-god', slots: ['strength1'], godCharm: 'godCharm' });
    assert.equal(protectedRun.status, 200);
    assert.equal(protectedRun.body.success, false);
    assert.equal(protectedRun.body.weapon.levelAfter, 5, '神恩符应阻止降级');
    assert.equal(protectedRun.body.originalDetail.failureBranch.godProtected, true);
    assert.equal(protectedRun.body.originalDetail.godCharm, 'godCharm');

    // 基础武器 Template.Level=2：原版会销毁装备，本版明确标记 NOT_PORTED。
    const normalWeapon = (await ctx.a.get('/api/server/forge')).body.forge.weapons.find((w) => w.equipped)?.id;
    const baseFail = await post({ weaponInstanceId: normalWeapon, requestId: 'fail-base', slots: ['strength1'] });
    assert.equal(baseFail.status, 200);
    assert.equal(baseFail.body.originalDetail.failureBranch.wouldDestroy, true);
    assert.match(baseFail.body.originalDetail.failureBranch.applied, /NOT_PORTED/);
    assert.equal(baseFail.body.weapon.levelAfter, baseFail.body.weapon.levelBefore, '单机存档不销毁装备');

    // 等级上限：配置表最大 15 级。
    const capped = await post({ weaponInstanceId: 'wi_hq_max', requestId: 'fail-max', slots: ['strength1'] });
    assert.equal(capped.status, 409);
    assert.equal(capped.body.code, 'max-level');

    // 无效材料 key 应被拒绝（材料不足在 LOCAL_RULE 用例中精确验证）。
    assert.equal((await post({ weaponInstanceId: 'wi_hq_down', requestId: 'no-stone', slots: ['does-not-exist'] })).status, 409);
  } finally { await finish(ctx); }
});

// ------------------------------------------------------------------ LOCAL_RULE 边界

test('LOCAL_RULE：金币不足 / 材料不足 / 合成石拒绝 / 成功扣费', async () => {
  const poor = await prepared(
    { DDT_FORGE_RULES: 'local', DDT_FORGE_RANDOM: 'always-success' },
    { coins: 0, items: { strength1: 20 } },
  );
  try {
    const forge = (await poor.a.get('/api/server/forge')).body.forge;
    assert.equal(forge.rules, 'local');
    assert.equal(forge.ruleSource, 'LOCAL_RULE');
    const wid = equippedId(forge);
    const r = await poor.a.post('/api/server/forge/strengthen', { weaponInstanceId: wid, requestId: 'poor-1' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'not-enough-coins');
  } finally { await finish(poor); }

  const noMat = await prepared(
    { DDT_FORGE_RULES: 'local', DDT_FORGE_RANDOM: 'always-success' },
    { coins: 5000, items: { xuanwu1: 20 } }, // 只有四圣兽合成石
  );
  try {
    const forge = (await noMat.a.get('/api/server/forge')).body.forge;
    const wid = equippedId(forge);
    const r = await noMat.a.post('/api/server/forge/strengthen', { weaponInstanceId: wid, requestId: 'nomat-1' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'not-enough-materials', '玄武石不得替代强化石');
  } finally { await finish(noMat); }

  const rich = await prepared(
    { DDT_FORGE_RULES: 'local', DDT_FORGE_RANDOM: 'always-success' },
    { coins: 5000, items: { strength1: 20 } },
  );
  try {
    const forge = (await rich.a.get('/api/server/forge')).body.forge;
    const wid = equippedId(forge);
    const r = await rich.a.post('/api/server/forge/strengthen', { weaponInstanceId: wid, requestId: 'local-ok' });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.equal(r.body.ruleSource, 'LOCAL_RULE');
    assert.equal(r.body.attackGrowthSource, 'LOCAL_RULE');
    assert.ok(r.body.cost.coins > 0, 'LOCAL_RULE 扣金币');
    assert.equal(r.body.weapon.levelAfter, 1);
    assert.equal(r.body.weapon.attackAfter, 125);
    const after = (await rich.a.get('/api/server/forge')).body.forge;
    assert.equal(after.wallet.coins, 5000 - r.body.cost.coins);
  } finally { await finish(rich); }
});

// ------------------------------------------------------------------ 奖励池与武器发放防重

test('奖励池对照与武器领取：正常池不含武器 / 测试池防重 / 重启不重复发放', async () => {
  // 纯函数对照：不改任何存档，用不同环境变量分别生成一盘。
  const build = (pool, seed) => {
    const r = spawnSync(TSX, ['tests/server/build-cards.ts', String(seed)], {
      cwd: ROOT, encoding: 'utf8',
      env: { ...process.env, DDT_REWARD_POOL: pool },
    });
    assert.equal(r.status, 0, `build-cards 失败: ${r.stderr}`);
    const line = r.stdout.trim().split('\n').filter(Boolean).pop();
    return JSON.parse(line);
  };
  const normals = [1, 2, 3, 4, 5, 12345].map((s) => build('normal', s));
  assert.ok(normals.every((r) => r.poolMode === 'normal'));
  assert.ok(normals.every((r) => r.cards.length === 9));
  assert.ok(normals.every((r) => r.cards.every((c) => c.kind !== 'weapon')),
    '正常奖励池不得包含未确认映射的武器候选卡');
  assert.equal(normals[0].extremeChance, 0);
  // 无固定卡位：同一 index 在不同 seed 下不总是同一类奖励。
  const firstKinds = new Set(normals.map((r) => r.cards[0].kind));
  assert.ok(firstKinds.size > 1 || normals.some((r, i) => i > 0 && r.cards[0].kind !== normals[0].cards[0].kind),
    '不应存在点固定位置必得固定奖励的隐含机制');
  const testPool = build('test', 12345);
  assert.equal(testPool.cards.filter((c) => c.kind === 'weapon').length, 1);

  // 服务：构造一盘含武器候选卡的测试盘，验证发放事务与防重。
  const weaponCard = testPool.cards.find((c) => c.kind === 'weapon');
  const cards = Array.from({ length: 9 }, (_, i) => (i === 3 ? weaponCard : { kind: 'coin', amount: 50 + i }));
  const ctx = await prepared(
    { DDT_REWARD_POOL: 'test' },
    { coins: 100, board: { battleId: 'battle_weapon_test', boardId: 'board_weapon_test', cards } },
  );
  try {
    const url = '/api/server/battles/battle_weapon_test/rewards/claim';
    const claim = await ctx.a.post(url, { cardIndex: 3, requestId: 'weapon-req-1' });
    assert.equal(claim.status, 200, JSON.stringify(claim.body));
    const reward = claim.body.reward;
    assert.equal(reward.kind, 'weapon');
    assert.equal(reward.mappingStatus, 'UNCONFIRMED');
    assert.match(reward.nameSource, /VIP/i, '应展示上游真实名称（VIP- / VIP_ / Vip 变体）');
    assert.match(reward.label, /中文品质映射待确认/);
    assert.ok(reward.weaponInstanceId);
    assert.equal(reward.deduplicated, false);

    // 同一请求重复：返回完全相同的实例，不重复发放。
    const replay = await ctx.a.post(url, { cardIndex: 3, requestId: 'weapon-req-1' });
    assert.deepEqual(replay.body, claim.body);
    assert.equal(readDb(ctx.dbPath, (db) => db.prepare('SELECT COUNT(*) n FROM weapon_grants').get().n), 1);
    const instCount = readDb(ctx.dbPath, (db) =>
      db.prepare("SELECT COUNT(*) n FROM weapon_instances WHERE variant = 'candidate'").get().n);
    assert.equal(instCount, 1, '只应创建一个独立武器实例');

    // 重复点击另一张卡位用同一 requestId 必须被拒绝。
    assert.equal((await ctx.a.post(url, { cardIndex: 4, requestId: 'weapon-req-1' })).status, 409);

    // 重启服务后再次请求：仍返回同一实例，不重复发放。
    await stop(ctx.handle);
    const restarted = await boot(ctx.tmpDir, ctx.dbPath, { DDT_REWARD_POOL: 'test' });
    ctx.handle = restarted;
    const afterRestart = await api(restarted.base).post(url, { cardIndex: 3, requestId: 'weapon-req-1' });
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.body.reward.weaponInstanceId, reward.weaponInstanceId);
    assert.equal(readDb(ctx.dbPath, (db) => db.prepare('SELECT COUNT(*) n FROM weapon_grants').get().n), 1);

    // 房间可装备、铁匠铺可强化、下一局使用该实例属性。
    const a2 = api(restarted.base);
    const equipped = await a2.post('/api/server/room/weapon', { weaponInstanceId: reward.weaponInstanceId });
    assert.equal(equipped.status, 200);
    assert.equal(equipped.body.room.equipped.id, reward.weaponInstanceId);
    const forge = (await a2.get('/api/server/forge')).body.forge;
    assert.ok(forge.weapons.some((w) => w.id === reward.weaponInstanceId), '铁匠铺应能选择该武器');
    assert.equal(forge.weapons.find((w) => w.id === reward.weaponInstanceId).templateLevel, 3);
    const started = await a2.post('/api/server/room/start', {});
    assert.equal(started.status, 200);
    const state = (await a2.get('/api/state')).body;
    assert.equal(state.actors[0].attack, reward.attack, '引擎内应使用武器候选实例的攻击属性');
    const battle = readDb(ctx.dbPath, (db) => db.prepare(
      'SELECT weapon_id, weapon_attack, variant FROM battles WHERE id = ?',
    ).get(started.body.battleId));
    assert.equal(Number(battle.weapon_attack), reward.attack, '战斗记录应冻结该实例属性');
    assert.equal(battle.weapon_id, reward.baseWeaponId, '应复用对应经典武器的弹道表现');
    assert.equal(battle.variant, 'candidate');
  } finally { await finish(ctx); }
});
