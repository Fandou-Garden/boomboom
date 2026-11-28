/**
 * 「原版素材 + 单机自定义强化规则」(SIMPLE_LOCAL_V1) 的规则测试。
 *
 * 交付规则已由用户授权简化：不再追求原版强化规则 100% 还原，
 * 因此这里不使用可注入随机源碰概率（成功率恒为 100%），
 * 而是精确验证公式、消耗、边界、幂等、并发、迁移兼容、装备与下一局属性。
 *
 * 所有服务使用临时端口 + /tmp 临时库，不触碰用户存档。
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
const RULE = 'SIMPLE_LOCAL_V1';

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
      (id, player_id, weapon_id, label, level, attack, attack_precise, base_attack,
       version, equipped, created_at, updated_at, template_id, base_weapon_id,
       variant, rule_version, template_level)
      VALUES (?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,?)`)
      .run(w.id, PLAYER, w.weaponId, w.label, w.level, w.attack,
        w.attackPrecise ?? w.attack, w.baseAttack ?? 100,
        1700000000000, 1700000000000,
        w.templateId ?? null, w.baseWeaponId ?? null, w.variant || 'candidate',
        w.ruleVersion || RULE, w.templateLevel ?? 2);
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
      VALUES (?,?,?,?,3,0,'open',?,?,?,?,?,?)`)
      .run(board.boardId, board.battleId, PLAYER, JSON.stringify(board.cards),
        1700000000000, 1700000000000,
        board.poolMode || 'test', '测试奖励池：验证发放防重',
        board.poolVersion || 'legacy-v1', board.rulesVersion || 'legacy-v1');
  }
  db.close();
}

function readDb(dbPath, fn) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return fn(db); } finally { db.close(); }
}

/** 先启动一次建库（跑完 001~004 迁移），再注入数据，最后按目标环境变量重启。 */
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

const qty = (wallet, key) => wallet.items.find((i) => i.itemKey === key)?.quantity ?? 0;
const weaponOf = (forge, id) => forge.weapons.find((w) => w.id === id);
/** 与服务端 attackForLevel 一致：基础值 ×(1+0.10×等级)，保留 6 位小数精度。 */
const attackAt = (base, level) => Math.round(base * (1 + 0.10 * level) * 1e6) / 1e6;

// ------------------------------------------------------------------ 1. 公式 / 消耗 / 精度 / 符咒

test('SIMPLE_LOCAL_V1：伤害公式不叠乘 / 金币与材料消耗 / 符咒与合成石不参与', async () => {
  const ctx = await prepared({}, {
    coins: 5000,
    items: {
      strength1: 10, strength2: 3, strength6: 2,
      lucky15: 5, lucky100: 5, godCharm: 5, xuanwu1: 7,
    },
  });
  try {
    const forge = (await ctx.a.get('/api/server/forge')).body.forge;
    assert.equal(forge.ruleSource, RULE);
    assert.equal(forge.rules, RULE);
    assert.equal(forge.ruleLabel, '原版素材 + 单机自定义强化规则');
    assert.equal(forge.maxLevel, 12);
    assert.equal(forge.successRate, 1);
    assert.equal(forge.stonesPerAttempt, 1);
    assert.equal(forge.coinCostPerTargetLevel, 100);
    assert.equal(forge.attackMultiplierPerLevel, 0.10);
    assert.match(forge.ruleNote, /不降级不损毁/);
    assert.deepEqual(forge.slots, { strength: [0], disabledStrength: [1, 2], god: 3, lucky: 4, equip: 5 });
    assert.match(forge.disabledSlotNote, /幸运符槽、神恩符槽无需使用/);
    assert.equal(forge.availableStones, 15);
    assert.equal(forge.coinsNow, 5000);
    assert.ok(forge.materials.strengthStones.length === 6, '6 种原版真强化石均已登记');
    assert.ok(forge.materials.composeStones.some((i) => i.itemKey === 'xuanwu1'));

    const wid = equippedId(forge);
    const w0 = weaponOf(forge, wid);
    assert.equal(w0.level, 0);
    assert.equal(w0.baseAttack, 100);
    assert.equal(w0.attackPrecise, 100);
    assert.equal(w0.ruleVersion, RULE);
    assert.equal(w0.cost.coins, 100, '+0→+1 = 100 × 目标等级 1');
    assert.equal(w0.cost.stones, 1);
    assert.equal(w0.cost.successRate, 1);
    assert.equal(w0.cost.nextAttackPrecise, 110);
    assert.equal(w0.atMax, false);
    assert.equal(w0.canStrengthen, true);
    assert.equal(w0.reason, null);

    const post = (p) => ctx.a.post('/api/server/forge/strengthen', p);
    // 三次连续强化：分别用自动挑选、6 级石、2 级石，验证所有等级统一「一颗一次机会」。
    const attempts = [
      { req: 'simple-1', itemKey: undefined, stone: 'strength1', coins: 100, level: 1, precise: 110 },
      { req: 'simple-2', itemKey: 'strength6', stone: 'strength6', coins: 200, level: 2, precise: 120 },
      { req: 'simple-3', itemKey: 'strength2', stone: 'strength2', coins: 300, level: 3, precise: 130 },
    ];
    for (const a of attempts) {
      const payload = { weaponInstanceId: wid, requestId: a.req };
      if (a.itemKey) payload.itemKey = a.itemKey;
      const r = await post(payload);
      assert.equal(r.status, 200, `强化失败：${JSON.stringify(r.body)}`);
      assert.equal(r.body.success, true);
      assert.equal(r.body.ruleSource, RULE);
      assert.equal(r.body.weapon.levelBefore, a.level - 1);
      assert.equal(r.body.weapon.levelAfter, a.level);
      assert.equal(r.body.weapon.baseAttack, 100, '始终从未强化基础值重算');
      assert.equal(r.body.weapon.attackPreciseAfter, a.precise,
        `+${a.level} 应为 100 × (1 + 0.10×${a.level}) = ${a.precise}，不得在已强化数值上叠乘`);
      assert.equal(r.body.weapon.attackAfter, Math.round(a.precise));
      assert.equal(r.body.cost.coins, a.coins, `金币 = 100 × 目标等级 ${a.level}`);
      assert.equal(r.body.cost.stones, 1);
      assert.equal(r.body.cost.stoneKey, a.stone);
      assert.equal(r.body.cost.successRate, 1);
      assert.equal(r.body.successRate, 1);
      assert.equal(r.body.weapon.version, a.level, 'version 条件更新防并发');
    }

    const after = (await ctx.a.get('/api/server/forge')).body.forge;
    const w3 = weaponOf(after, wid);
    assert.equal(w3.level, 3);
    assert.equal(w3.attack, 130);
    assert.equal(w3.attackPrecise, 130, '第 3 级是 100×1.3=130，不是 100×1.1³=133.1');
    assert.equal(w3.baseAttack, 100);
    assert.equal(after.wallet.coins, 5000 - 600, '金币累计扣 100+200+300');
    assert.equal(qty(after.wallet, 'strength1'), 9);
    assert.equal(qty(after.wallet, 'strength6'), 1);
    assert.equal(qty(after.wallet, 'strength2'), 2);
    // 幸运符 / 神恩符 / 四圣兽合成石只是保留，绝不消耗。
    assert.equal(qty(after.wallet, 'lucky15'), 5);
    assert.equal(qty(after.wallet, 'lucky100'), 5);
    assert.equal(qty(after.wallet, 'godCharm'), 5);
    assert.equal(qty(after.wallet, 'xuanwu1'), 7);

    const ops = readDb(ctx.dbPath, (db) => db.prepare(
      `SELECT level_before, level_after, success, coins_cost, items_json, rule_source
       FROM forge_operations ORDER BY created_at, id`,
    ).all());
    assert.equal(ops.length, 3, '每次强化一条操作记录');
    assert.deepEqual(ops.map((o) => Number(o.level_after)), [1, 2, 3]);
    assert.deepEqual(ops.map((o) => Number(o.coins_cost)), [100, 200, 300]);
    assert.ok(ops.every((o) => Number(o.success) === 1 && o.rule_source === RULE));
    assert.ok(ops.every((o) => JSON.parse(o.items_json).length === 1), '每次只记录 1 颗真强化石');

    const rules = (await ctx.a.get('/api/server/rules')).body.rules;
    assert.equal(rules.forge.ruleSource, RULE);
    assert.equal(rules.forge.successRate, 1);
    assert.equal(rules.forge.damageFormula, '最终基础伤害 = 未强化基础伤害 × (1 + 0.10 × 强化等级)');
  } finally { await finish(ctx); }
});

// ------------------------------------------------------------------ 2. 边界与明确提示

test('SIMPLE_LOCAL_V1：金币不足 / 材料不足 / 合成石拒绝 / +12 上限 / 前端不得决定结果', async () => {
  const poor = await prepared({}, { coins: 50, items: { strength1: 5 } });
  try {
    const forge = (await poor.a.get('/api/server/forge')).body.forge;
    const wid = equippedId(forge);
    const w = weaponOf(forge, wid);
    assert.equal(w.canStrengthen, false);
    assert.match(w.reason, /金币不足：需要 100，当前 50/);
    const r = await poor.a.post('/api/server/forge/strengthen', { weaponInstanceId: wid, requestId: 'poor-1' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'not-enough-coins');
    assert.match(r.body.error, /金币不足：需要 100，当前 50/);
    assert.equal((await poor.a.get('/api/server/player')).body.wallet.coins, 50, '失败不扣金币');
  } finally { await finish(poor); }

  const noMat = await prepared({}, { coins: 5000, items: { xuanwu1: 20 } });
  try {
    const forge = (await noMat.a.get('/api/server/forge')).body.forge;
    const wid = equippedId(forge);
    assert.match(weaponOf(forge, wid).reason, /强化石不足：需要 1 颗真强化石，当前 0/);
    const r = await noMat.a.post('/api/server/forge/strengthen', { weaponInstanceId: wid, requestId: 'nomat-1' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'not-enough-materials', '玄武石不得替代强化石');
    const wrong = await noMat.a.post('/api/server/forge/strengthen', {
      weaponInstanceId: wid, requestId: 'nomat-2', itemKey: 'xuanwu1',
    });
    assert.equal(wrong.status, 409);
    assert.equal(wrong.body.code, 'not-enough-materials');
    assert.match(wrong.body.error, /不是真强化石/);
    const unknown = await noMat.a.post('/api/server/forge/strengthen', {
      weaponInstanceId: wid, requestId: 'nomat-3', itemKey: 'does-not-exist',
    });
    assert.equal(unknown.status, 409);
    assert.equal(unknown.body.code, 'not-enough-materials');
    assert.equal(qty((await noMat.a.get('/api/server/player')).body.wallet, 'xuanwu1'), 20,
      '合成石数量不变');
  } finally { await finish(noMat); }

  const capped = await prepared({}, {
    coins: 5000, items: { strength1: 5 },
    extraWeapons: [{
      id: 'wi_at_max', weaponId: 'hq_max#test', label: 'VIP-Pháo（+12）',
      level: 12, attack: 220, attackPrecise: 220, baseAttack: 100,
      templateId: 7006, baseWeaponId: 'fire', templateLevel: 3,
    }],
  });
  try {
    const forge = (await capped.a.get('/api/server/forge')).body.forge;
    const w = weaponOf(forge, 'wi_at_max');
    assert.equal(w.level, 12);
    assert.equal(w.attack, 220, '+12 = 100 × 2.20');
    assert.equal(w.baseAttack, 100);
    assert.equal(w.atMax, true);
    assert.equal(w.canStrengthen, false);
    assert.match(w.reason, /已达 \+12 上限/);
    assert.equal(w.cost.coins, 0, '满级不再预览扣费');
    const r = await capped.a.post('/api/server/forge/strengthen', {
      weaponInstanceId: 'wi_at_max', requestId: 'max-1',
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'max-level');
    assert.match(r.body.error, /\+12 强化上限/);

    const post = (p) => capped.a.post('/api/server/forge/strengthen', p);
    assert.equal((await post({
      weaponInstanceId: equippedId(forge), requestId: 'client-result',
      success: true, level: 12, attack: 9999, coins: 0,
    })).body.code, 'client-cannot-decide-result', '前端不得提交任何强化结果字段');
    assert.equal((await post({
      weaponInstanceId: equippedId(forge), requestId: 'client-charm', luckyCharm: 'lucky15',
    })).body.code, 'client-cannot-decide-result', '幸运符槽已禁用');
    assert.equal((await post({
      weaponInstanceId: equippedId(forge), requestId: 'client-god', godCharm: 'godCharm',
    })).body.code, 'client-cannot-decide-result', '神恩符槽已禁用');
    assert.equal((await post({
      weaponInstanceId: equippedId(forge), requestId: 'client-slots', slots: ['strength1'],
    })).body.code, 'client-cannot-decide-result', '三槽参数已废弃');
    const noReq = await post({ weaponInstanceId: equippedId(forge) });
    assert.equal(noReq.status, 400);
    assert.equal(noReq.body.code, 'bad-request-id');
    const foreign = await post({ weaponInstanceId: 'not-owned-weapon', requestId: 'foreign-1' });
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.code, 'weapon-not-owned');
  } finally { await finish(capped); }
});

// ------------------------------------------------------------------ 3. 幂等与并发

test('SIMPLE_LOCAL_V1：重复提交不重复扣费 / requestId 绑定 / 并发不丢失更新', async () => {
  const once = await prepared({}, { coins: 5000, items: { strength1: 1 } });
  try {
    const forge = (await once.a.get('/api/server/forge')).body.forge;
    const wid = equippedId(forge);
    const other = forge.weapons.find((w) => w.id !== wid).id;
    const post = (p) => once.a.post('/api/server/forge/strengthen', p);
    const first = await post({ weaponInstanceId: wid, requestId: 'idem-1' });
    assert.equal(first.status, 200);
    const replay = await post({ weaponInstanceId: wid, requestId: 'idem-1' });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, first.body, '重试返回完全相同的已存结果');
    const reused = await post({ weaponInstanceId: other, requestId: 'idem-1' });
    assert.equal(reused.status, 409);
    assert.equal(reused.body.code, 'request-id-reused', '同一 requestId 不能套用到另一把武器');
    // 材料恰好 1 颗：重复点击（不同 requestId）不能再扣费或再升级。
    const again = await post({ weaponInstanceId: wid, requestId: 'idem-2' });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'not-enough-materials');
    const after = (await once.a.get('/api/server/forge')).body.forge;
    assert.equal(weaponOf(after, wid).level, 1);
    assert.equal(weaponOf(after, wid).attackPrecise, 110);
    assert.equal(after.wallet.coins, 4900, '金币只扣一次');
    assert.equal(qty(after.wallet, 'strength1'), 0, '材料只扣一次');
    assert.equal(readDb(once.dbPath, (db) => db.prepare('SELECT COUNT(*) n FROM forge_operations').get().n), 1,
      '失败请求不落强化记录');
  } finally { await finish(once); }

  const concurrent = await prepared({}, { coins: 5000, items: { strength1: 6 } });
  try {
    const forge = (await concurrent.a.get('/api/server/forge')).body.forge;
    const wid = equippedId(forge);
    const post = (p) => concurrent.a.post('/api/server/forge/strengthen', p);
    // 不同 requestId 并发：BEGIN IMMEDIATE 串行化，两个请求各自 +1 级，无丢失更新。
    const [c1, c2] = await Promise.all([
      post({ weaponInstanceId: wid, requestId: 'conc-1' }),
      post({ weaponInstanceId: wid, requestId: 'conc-2' }),
    ]);
    assert.equal(c1.status, 200, JSON.stringify(c1.body));
    assert.equal(c2.status, 200, JSON.stringify(c2.body));
    assert.notEqual(c1.body.weapon.version, c2.body.weapon.version, 'version 连续递增');
    const mid = (await concurrent.a.get('/api/server/forge')).body.forge;
    assert.equal(weaponOf(mid, wid).level, 2);
    assert.equal(weaponOf(mid, wid).attackPrecise, 120);
    assert.equal(mid.wallet.coins, 5000 - 100 - 200);
    assert.equal(qty(mid.wallet, 'strength1'), 4);

    // 同一 requestId 并发：一个创建、一个命中重放，只升一级。
    const [i1, i2] = await Promise.all([
      post({ weaponInstanceId: wid, requestId: 'conc-idem' }),
      post({ weaponInstanceId: wid, requestId: 'conc-idem' }),
    ]);
    assert.equal(i1.status, 200);
    assert.deepEqual(i2.body, i1.body, '同一 requestId 并发应返回同一持久化结果');
    const final = (await concurrent.a.get('/api/server/forge')).body.forge;
    assert.equal(weaponOf(final, wid).level, 3, '幂等请求只升一级');
    assert.equal(final.wallet.coins, 5000 - 100 - 200 - 300);
    assert.equal(qty(final.wallet, 'strength1'), 3);

    // 装备后下一场战斗使用精确属性；小数精度不被截断。
    const precise = await prepared({}, {
      coins: 5000, items: { strength1: 2 },
      extraWeapons: [{
        id: 'wi_precise', weaponId: 'precise#test', label: '精度样本',
        level: 1, attack: 105, attackPrecise: 104.5, baseAttack: 95,
        variant: 'candidate', baseWeaponId: 'fruit',
      }],
    });
    try {
      const eq = await precise.a.post('/api/server/room/weapon', { weaponInstanceId: 'wi_precise' });
      assert.equal(eq.status, 200);
      const started = await precise.a.post('/api/server/room/start', {});
      assert.equal(started.status, 200);
      const state = (await precise.a.get('/api/state')).body;
      assert.equal(state.actors[0].attack, 104.5, '属性精度保留到战斗引擎，最终伤害取整由引擎处理');
      const battle = readDb(precise.dbPath, (db) => db.prepare(
        'SELECT weapon_attack_precise, weapon_attack, weapon_id FROM battles WHERE id = ?',
      ).get(started.body.battleId));
      assert.equal(Number(battle.weapon_attack_precise), 104.5);
      assert.equal(battle.weapon_id, 'fruit', '弹道仍复用基础武器，强化不改弹道/风力/爆炸/角度');
    } finally { await finish(precise); }
  } finally { await finish(concurrent); }
});

// ------------------------------------------------------------------ 4. 全程 +0 → +12

test('SIMPLE_LOCAL_V1：从 +0 连续强化到 +12，伤害 220%，第 13 次明确拒绝', async () => {
  const ctx = await prepared({}, { coins: 20000, items: { strength1: 20 } });
  try {
    const forge0 = (await ctx.a.get('/api/server/forge')).body.forge;
    const wid = equippedId(forge0);
    for (let level = 1; level <= 12; level += 1) {
      const r = await ctx.a.post('/api/server/forge/strengthen', {
        weaponInstanceId: wid, requestId: `to12-${level}`,
      });
      assert.equal(r.status, 200, `+${level} 失败：${JSON.stringify(r.body)}`);
      assert.equal(r.body.weapon.levelAfter, level);
      assert.equal(r.body.cost.coins, 100 * level);
      assert.equal(r.body.weapon.attackPreciseAfter, attackAt(100, level));
      assert.equal(r.body.weapon.attackAfter, Math.round(attackAt(100, level)));
      assert.equal(r.body.weapon.baseAttack, 100);
    }
    const forge12 = (await ctx.a.get('/api/server/forge')).body.forge;
    const w12 = weaponOf(forge12, wid);
    assert.equal(w12.level, 12);
    assert.equal(w12.attackPrecise, 220, '+12 = 基础值 220%');
    assert.equal(w12.attack, 220);
    assert.equal(w12.baseAttack, 100);
    assert.equal(w12.atMax, true);
    assert.equal(w12.ruleVersion, RULE);
    assert.match(w12.reason, /已达 \+12 上限/);
    assert.equal(forge12.wallet.coins, 20000 - 7800, '100×(1+2+…+12) = 7800');
    assert.equal(qty(forge12.wallet, 'strength1'), 8, '消耗 12 颗真强化石');
    const over = await ctx.a.post('/api/server/forge/strengthen', {
      weaponInstanceId: wid, requestId: 'to12-13',
    });
    assert.equal(over.status, 409);
    assert.equal(over.body.code, 'max-level');
    assert.equal((await ctx.a.get('/api/server/forge')).body.forge.wallet.coins,
      20000 - 7800, '超限请求不扣费');
  } finally { await finish(ctx); }
});

// ------------------------------------------------------------------ 5. 奖励池 / 旧盘 / 武器发放

test('奖励池与武器领取：正常池无固定卡位 / 旧盘不重抽 / 独立实例防重 / 可装备可强化', async () => {
  // 纯函数对照：不改任何存档，用不同环境变量与种子分别生成一盘。
  const build = (pool, seed) => {
    const r = spawnSync(TSX, ['tests/server/build-cards.ts', String(seed)], {
      cwd: ROOT, encoding: 'utf8',
      env: { ...process.env, DDT_REWARD_POOL: pool },
    });
    assert.equal(r.status, 0, `build-cards 失败: ${r.stderr}`);
    const line = r.stdout.trim().split('\n').filter(Boolean).pop();
    return JSON.parse(line);
  };
  const seeds = [1, 2, 3, 4, 5, 12345, 98765, 424242];
  const normals = seeds.map((s) => build('normal', s));
  assert.ok(normals.every((r) => r.poolMode === 'normal'));
  assert.equal(normals[0].poolVersion, 'v4-2026-11-28-simple-forge');
  assert.equal(normals[0].forgeRule, RULE);
  assert.equal(typeof normals[0].weaponChance, 'number');
  assert.ok(normals.every((r) => r.cards.length === 9));
  assert.ok(normals.every((r) => r.cards.filter((c) => c.kind === 'item').length >= 2),
    '保底只约束盘面构成：至少 2 张真强化石卡');
  assert.ok(normals.every((r) => r.cards.filter((c) => c.kind === 'item')
    .every((c) => /^strength[1-6]$/.test(c.itemKey || ''))), '奖励只发真强化石，不发四圣兽合成石');
  assert.ok(normals.every((r) => r.cards.every((c) => ['coin', 'item', 'weapon'].includes(c.kind))));
  // 无固定卡位：不同种子下同一位置不总是同一类奖励。
  const varied = Array.from({ length: 9 }, (_, i) =>
    new Set(normals.map((r) => r.cards[i].kind)).size > 1);
  assert.ok(varied.some(Boolean), '9 张整体洗牌，正常池不存在点固定位置必得固定奖励的机制');
  const testPool = build('test', 12345);
  assert.ok(testPool.cards.filter((c) => c.kind === 'coin').length >= 2, '测试池强制 ≥2 张金币');
  assert.ok(testPool.cards.filter((c) => c.kind === 'item').length >= 1, '测试池强制 ≥1 张真强化石');
  assert.ok(testPool.cards.filter((c) => c.kind === 'weapon').length >= 1, '测试池强制 ≥1 张武器');

  const weaponCard = testPool.cards.find((c) => c.kind === 'weapon');
  const cards = Array.from({ length: 9 }, (_, i) => (i === 3 ? weaponCard : { kind: 'coin', amount: 50 + i }));
  const ctx = await prepared(
    { DDT_REWARD_POOL: 'test' },
    {
      coins: 5000, items: { strength1: 2 },
      board: {
        battleId: 'battle_weapon_test', boardId: 'board_weapon_test', cards,
        poolVersion: 'legacy-v1', rulesVersion: 'forge=legacy',
      },
    },
  );
  try {
    // 旧奖励盘保留原结果与配置版本，规则变更不触发重抽。
    const boardDbBefore = readDb(ctx.dbPath, (db) => db.prepare(
      'SELECT cards_json, pool_version, rules_version FROM reward_boards WHERE id = ?',
    ).get('board_weapon_test'));
    assert.equal(JSON.parse(boardDbBefore.cards_json)[3].kind, 'weapon');
    assert.equal(boardDbBefore.pool_version, 'legacy-v1');
    assert.equal(boardDbBefore.rules_version, 'forge=legacy');
    const boardView = (await ctx.a.get('/api/server/battles/battle_weapon_test/rewards')).body.board;
    assert.equal(boardView.poolVersion, 'legacy-v1');
    assert.equal(boardView.rulesVersion, 'forge=legacy');
    assert.ok(boardView.cards.every((c) => !c.revealed), '未翻开内容不下发前端');

    const url = '/api/server/battles/battle_weapon_test/rewards/claim';
    const claim = await ctx.a.post(url, { cardIndex: 3, requestId: 'weapon-req-1' });
    assert.equal(claim.status, 200, JSON.stringify(claim.body));
    const reward = claim.body.reward;
    assert.equal(reward.kind, 'weapon');
    assert.equal(reward.weaponNameStatus, '中文品质名称待核对');
    assert.match(reward.nameSource, /VIP/i, '使用已核实的上游真实名称，不编造「极」字');
    assert.match(reward.label, /中文品质名称待核对/);
    assert.ok(reward.weaponInstanceId);
    assert.equal(reward.deduplicated, false);
    assert.equal(reward.variant, 'candidate');
    assert.equal(reward.attackPrecise, reward.attack, '独立实例保留未强化基础属性');

    const grant = readDb(ctx.dbPath, (db) => db.prepare('SELECT * FROM weapon_grants').get());
    assert.equal(grant.mapping_status, 'NAME_PENDING_VERIFY');
    assert.equal(grant.pool_mode, 'test');
    const inst = readDb(ctx.dbPath, (db) => db.prepare(
      'SELECT * FROM weapon_instances WHERE id = ?',
    ).get(reward.weaponInstanceId));
    assert.equal(Number(inst.base_attack), reward.attack, '强化等级与属性属于实例，不改共享模板');
    assert.equal(Number(inst.attack_precise), reward.attack);
    assert.equal(inst.rule_version, RULE);
    assert.equal(inst.variant, 'candidate');

    const replay = await ctx.a.post(url, { cardIndex: 3, requestId: 'weapon-req-1' });
    assert.deepEqual(replay.body, claim.body);
    assert.equal((await ctx.a.post(url, { cardIndex: 4, requestId: 'weapon-req-1' })).status, 409);
    assert.equal(readDb(ctx.dbPath, (db) => db.prepare('SELECT COUNT(*) n FROM weapon_grants').get().n), 1);
    assert.equal(readDb(ctx.dbPath, (db) => db.prepare(
      "SELECT COUNT(*) n FROM weapon_instances WHERE variant = 'candidate'",
    ).get().n), 1);

    await stop(ctx.handle);
    const restarted = await boot(ctx.tmpDir, ctx.dbPath, { DDT_REWARD_POOL: 'test' });
    ctx.handle = restarted;
    const a2 = api(restarted.base);
    const afterRestart = await a2.post(url, { cardIndex: 3, requestId: 'weapon-req-1' });
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.body.reward.weaponInstanceId, reward.weaponInstanceId);
    assert.deepEqual(afterRestart.body.reward, reward,
      '重放返回第一次持久化的完整奖励内容，不重新创建实例');
    assert.equal(readDb(ctx.dbPath, (db) => db.prepare('SELECT COUNT(*) n FROM weapon_grants').get().n), 1);
    const boardDbAfter = readDb(ctx.dbPath, (db) => db.prepare(
      'SELECT cards_json, pool_version FROM reward_boards WHERE id = ?',
    ).get('board_weapon_test'));
    assert.equal(boardDbAfter.cards_json, boardDbBefore.cards_json, '重启后旧盘内容不重抽');

    // 房间可装备、铁匠铺可强化、下一局使用该实例属性。
    const equipped = await a2.post('/api/server/room/weapon', { weaponInstanceId: reward.weaponInstanceId });
    assert.equal(equipped.status, 200);
    assert.equal(equipped.body.room.equipped.id, reward.weaponInstanceId);
    const forge = (await a2.get('/api/server/forge')).body.forge;
    const w = weaponOf(forge, reward.weaponInstanceId);
    assert.ok(w, '铁匠铺应能选择翻牌得到的武器');
    assert.equal(w.templateLevel, 3);
    assert.equal(w.baseAttack, reward.attack);
    const strengthened = await a2.post('/api/server/forge/strengthen', {
      weaponInstanceId: reward.weaponInstanceId, requestId: 'candidate-forge-1',
    });
    assert.equal(strengthened.status, 200, JSON.stringify(strengthened.body));
    assert.equal(strengthened.body.weapon.attackPreciseAfter, attackAt(reward.attack, 1),
      '翻牌武器强化同样按未强化基础值 ×1.10');
    const started = await a2.post('/api/server/room/start', {});
    assert.equal(started.status, 200);
    const state = (await a2.get('/api/state')).body;
    assert.equal(state.actors[0].attack, attackAt(reward.attack, 1), '下一局使用该武器强化后的属性');
    const battle = readDb(ctx.dbPath, (db) => db.prepare(
      'SELECT weapon_id, weapon_attack_precise, variant FROM battles WHERE id = ?',
    ).get(started.body.battleId));
    assert.equal(Number(battle.weapon_attack_precise), attackAt(reward.attack, 1));
    assert.equal(battle.weapon_id, reward.baseWeaponId, '复用经典武器弹道表现');
    assert.equal(battle.variant, 'candidate');
  } finally { await finish(ctx); }
});
