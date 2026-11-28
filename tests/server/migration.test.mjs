/**
 * 旧存档迁移验证（验收要求 3 / 4 / 5）：
 *  - 在「旧库副本」上验证，先用 SQLite backup API 做 WAL 安全备份，
 *    不在服务运行中直接复制主库文件；
 *  - 逐项核对迁移前后：金币、背包数量、武器实例、强化等级、领取记录、
 *    已生成奖励盘的 cards_json；
 *  - 玄武石只改分类为 compose-stone，保留数量，不自动兑换/补发/删除；
 *  - 旧 LOCAL_RULE 武器保留 rule_version，attack 不重算、不叠加加成；
 *  - 重复执行迁移不重复发物品、不重复加属性；
 *  - 旧奖励盘保持 legacy-v1 配置版本，不重抽。
 *
 * 测试自起隔离服务（临时端口 + /tmp 临时库），不读写用户 data/ddt.sqlite。
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
const MIG = path.join(ROOT, 'server-node', 'migrations');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Python sqlite3 的 backup() 是 SQLite C API sqlite3_backup 的官方封装，WAL 安全。 */
const PY = String.raw`
import sqlite3, json, sys
mode, src, dst = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else '')
if mode == 'backup':
    s = sqlite3.connect(src)
    d = sqlite3.connect(dst)
    s.backup(d)
    d.close(); s.close()
    print('ok')
elif mode == 'snapshot':
    c = sqlite3.connect(src)
    c.row_factory = sqlite3.Row
    def q(sql):
        try: return [dict(r) for r in c.execute(sql)]
        except Exception as e: return {'error': str(e)}
    out = {
      'coins': q("SELECT id, coins FROM players ORDER BY id"),
      'inventory': q("SELECT item_key, quantity FROM inventory ORDER BY item_key"),
      'xuanwuKinds': q("SELECT item_key, kind FROM item_catalog WHERE item_key LIKE 'xuanwu%' ORDER BY item_key"),
      'weapons': q("SELECT id, level, attack, equipped, version FROM weapon_instances ORDER BY id"),
      'weaponCols': [r['name'] for r in c.execute("PRAGMA table_info(weapon_instances)")],
      'weaponMeta': q("SELECT id, rule_version, template_level FROM weapon_instances ORDER BY id")
                    if any(r['name'] == 'rule_version' for r in c.execute("PRAGMA table_info(weapon_instances)")) else [],
      'boards': q("SELECT id, battle_id, cards_json, picks_used, status FROM reward_boards ORDER BY id"),
      'boardMeta': q("SELECT id, pool_version, rules_version FROM reward_boards ORDER BY id")
                    if any(r['name'] == 'pool_version' for r in c.execute("PRAGMA table_info(reward_boards)")) else [],
      'picks': q("SELECT board_id, card_index, request_id, result_json FROM reward_picks ORDER BY card_index"),
      'forges': q("SELECT request_id, level_before, level_after, coins_cost FROM forge_operations ORDER BY request_id"),
      'migrations': q("SELECT version FROM schema_migrations ORDER BY version"),
    }
    print(json.dumps(out, ensure_ascii=False, sort_keys=True))
    c.close()
`;

function py(mode, src, dst = '') {
  const r = spawnSync('python3', ['-c', PY, mode, src, dst], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`python sqlite ${mode} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** 先 backup 再读快照，避免 WAL 未 checkpoint 时读到不完整状态。 */
function snapshot(dbPath, tmpDir, tag) {
  const copy = path.join(tmpDir, `snapshot-${tag}.sqlite`);
  assert.equal(py('backup', dbPath, copy), 'ok', `${tag} WAL 安全备份应成功`);
  return JSON.parse(py('snapshot', copy));
}

/** 构造 001 时代的旧库：错误分类的玄武石、金币、已强化武器、已领取的奖励盘。 */
function buildLegacyDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.join(MIG, '001_init.sql'), 'utf8'));
  db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(1, 1700000000000);
  const t = 1700000000000;
  db.prepare('INSERT INTO players (id, display_name, coins, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run('local-player', '本地玩家', 1234, t, t);
  const seed = [
    ['xuanwu1', 11005, '玄武石 1 级', 1], ['xuanwu2', 11006, '玄武石 2 级', 2],
    ['xuanwu3', 11007, '玄武石 3 级', 3], ['xuanwu4', 11008, '玄武石 4 级', 4],
    ['xuanwu5', 11031, '玄武石 5 级', 5],
  ];
  for (const [k, id, name, unit] of seed) {
    db.prepare(`INSERT INTO item_catalog (item_key, template_id, name_zh, name_source, icon, kind, unit_value, note)
                VALUES (?,?,?,?,?,'strengthen-stone',?,?)`)
      .run(k, id, name, 'Đá Huyền Vũ', `assets/items/${k}.png`, unit, '001 误登记');
  }
  db.prepare('INSERT INTO inventory (player_id, item_key, quantity) VALUES (?,?,?)').run('local-player', 'xuanwu1', 3);
  db.prepare('INSERT INTO inventory (player_id, item_key, quantity) VALUES (?,?,?)').run('local-player', 'xuanwu3', 2);
  // 旧 LOCAL_RULE 武器：level=3 -> attack=100+3*25=175，装备中。
  db.prepare(`INSERT INTO weapon_instances
              (id, player_id, weapon_id, label, level, attack, version, equipped, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run('wi_local-player_fruit', 'local-player', 'fruit', '牛顿水果篮', 3, 175, 4, 1, t, t);
  db.prepare(`INSERT INTO weapon_instances
              (id, player_id, weapon_id, label, level, attack, version, equipped, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run('wi_local-player_fire', 'local-player', 'fire', '烈火', 0, 100, 0, 0, t, t);
  db.prepare(`INSERT INTO rooms (id, player_id, map_id, weapon_instance_id, status, active_battle_id, updated_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run('room_local-player', 'local-player', '1157', 'wi_local-player_fruit', 'idle', null, t);
  db.prepare(`INSERT INTO battles
              (id, player_id, room_id, map_id, weapon_id, weapon_level, weapon_attack, bot_attack,
               seed, status, result, winner, stats_json, started_at, ended_at)
              VALUES (?,?,?,?,?,?,?,?,?,'finished','win',0,?,?,?)`)
    .run('battle_legacy', 'local-player', 'room_local-player', '1157', 'fruit', 3, 175, 35,
      424242, '{}', t, t + 1000);
  const cards = JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ kind: 'coin', amount: 50 + i })));
  db.prepare(`INSERT INTO reward_boards
              (id, battle_id, player_id, cards_json, max_picks, picks_used, status, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run('board_legacy', 'battle_legacy', 'local-player', cards, 3, 1, 'open', t, t);
  db.prepare(`INSERT INTO reward_picks (id, board_id, card_index, request_id, result_json, created_at)
              VALUES (?,?,?,?,?,?)`)
    .run('pick_legacy', 'board_legacy', 4, 'req-legacy-1', JSON.stringify({ ok: true, reward: { kind: 'coin', amount: 54 } }), t);
  db.prepare(`INSERT INTO forge_operations
              (id, player_id, weapon_instance_id, request_id, level_before, level_after, success, coins_cost, items_json, result_json, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run('forge_legacy', 'local-player', 'wi_local-player_fruit', 'req-forge-1', 2, 3, 1, 220, '{}', '{}', t);
  db.prepare(`INSERT INTO unmatched_items (query, status, note, checked_at) VALUES (?,?,?,?)`)
    .run('神武石', 'unmatched', '001 未匹配', t);
  db.close();
}

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** 启动真实服务进程，让 openDatabase()/applyMigrations() 走生产路径。 */
async function startServer(port, dataDir, dbPath) {
  const proc = spawn(TSX, ['server-node/src/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DDT_HOST: '127.0.0.1', DDT_PORT: String(port),
      DDT_DATA_DIR: dataDir, DDT_DB_PATH: dbPath,
      DDT_DEBUG: '0', DDT_MODE: 'server',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  proc.stdout.on('data', (d) => { logs += d.toString(); });
  proc.stderr.on('data', (d) => { logs += d.toString(); });
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) return { proc, logs: () => logs };
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

test('旧存档迁移：WAL 安全副本 + 资产不变 + 幂等 + 奖励盘不重抽', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-migration-'));
  const legacy = path.join(tmpDir, 'legacy.sqlite');
  const work = path.join(tmpDir, 'work.sqlite');
  try {
    buildLegacyDb(legacy);
    // 只通过 SQLite backup API 复制，绝不 cp 正在 WAL 模式下的主库文件。
    assert.equal(py('backup', legacy, work), 'ok');
    const before = snapshot(legacy, tmpDir, 'before');
    const port = await freePort();

    let srv = await startServer(port, tmpDir, work);
    await stopServer(srv);
    const after = snapshot(work, tmpDir, 'after');

    // --- 1) 金币不变 ---
    assert.deepEqual(after.coins, before.coins, '迁移不得改动金币');
    // --- 2) 背包数量与内容不变（不自动兑换 / 不补发 / 不删除） ---
    assert.deepEqual(after.inventory, before.inventory, '迁移不得增删或补发任何背包物品');
    assert.deepEqual(after.inventory, [
      { item_key: 'xuanwu1', quantity: 3 },
      { item_key: 'xuanwu3', quantity: 2 },
    ]);
    assert.equal(after.inventory.some((i) => i.item_key.startsWith('strength')), false,
      '不得按等级把玄武石自动兑换成强化石');
    // --- 3) 玄武石只改分类，5 条全部变为 compose-stone ---
    assert.equal(after.xuanwuKinds.length, 5);
    assert.ok(after.xuanwuKinds.every((r) => r.kind === 'compose-stone'), '玄武石应全部改为合成石');
    assert.ok(before.xuanwuKinds.every((r) => r.kind === 'strengthen-stone'), '旧库应确实是误分类');
    // --- 4) 旧 LOCAL_RULE 武器：等级/攻击/版本/装备状态不变，保留规则版本 ---
    const fruitBefore = before.weapons.find((w) => w.id === 'wi_local-player_fruit');
    const fruitAfter = after.weapons.find((w) => w.id === 'wi_local-player_fruit');
    assert.deepEqual(fruitAfter, fruitBefore, '旧武器 level/attack/version 不得被重算或叠加加成');
    assert.equal(fruitAfter.attack, 175);
    assert.equal(fruitAfter.level, 3);
    assert.ok(after.weaponCols.includes('rule_version'), '应新增 rule_version');
    assert.ok(after.weaponCols.includes('template_level'), '应新增 template_level');
    const meta = after.weaponMeta.find((w) => w.id === 'wi_local-player_fruit');
    assert.equal(meta.rule_version, 'LOCAL_RULE', '旧武器保留 LOCAL_RULE 规则版本');
    assert.equal(meta.template_level, 2, '基础武器 Template.Level=2');
    // --- 5) 领取记录、强化记录、奖励盘原结果与配置版本 ---
    assert.deepEqual(after.picks, before.picks, '领取记录不得变化');
    assert.deepEqual(after.forges, before.forges, '强化记录不得变化');
    assert.deepEqual(after.boards, before.boards, '旧奖励盘 cards_json 不得重新抽取或改写');
    assert.deepEqual(after.boardMeta, [{ id: 'board_legacy', pool_version: 'legacy-v1', rules_version: 'legacy-v1' }],
      '旧盘保留 legacy-v1 配置版本');
    assert.deepEqual(after.migrations.map((r) => r.version), [1, 2, 3]);

    // --- 6) 重复执行迁移（再次启动服务）不得重复发物品 / 重复加属性 ---
    const port2 = await freePort();
    srv = await startServer(port2, tmpDir, work);
    await stopServer(srv);
    const again = snapshot(work, tmpDir, 'again');
    for (const key of ['coins', 'inventory', 'xuanwuKinds', 'picks', 'forges', 'boards', 'boardMeta', 'migrations']) {
      assert.deepEqual(again[key], after[key], `重复迁移不得改变 ${key}`);
    }
    assert.deepEqual(again.weapons.find((w) => w.id === 'wi_local-player_fruit'),
      fruitBefore, '重复迁移不得再次叠加武器属性');

    const report = {
      backupMethod: 'python sqlite3.Connection.backup() —— SQLite backup API，WAL 安全',
      before: {
        coins: before.coins, inventory: before.inventory,
        xuanwuKinds: before.xuanwuKinds, weapons: before.weapons,
        picks: before.picks.length, forges: before.forges.length,
        boards: before.boards, migrations: before.migrations,
      },
      after: {
        coins: after.coins, inventory: after.inventory,
        xuanwuKinds: after.xuanwuKinds, weapons: after.weapons,
        weaponMeta: after.weaponMeta, boardMeta: after.boardMeta,
        picks: after.picks.length, forges: after.forges.length,
        boards: after.boards, migrations: after.migrations,
      },
      idempotent: true,
    };
    // 报告放在 tmpDir 之外，避免 finally 清理时一起删掉。
    const reportPath = path.join(os.tmpdir(), 'ddt-migration-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`[migration] 报告: ${reportPath}`);
    console.log(`[migration] 旧金币=${before.coins[0].coins} 新金币=${after.coins[0].coins} 背包=${JSON.stringify(after.inventory)} 武器attack=${fruitAfter.attack} 幂等=true`);
  } finally {
    // 只删除测试自己在 /tmp 建的目录，不触碰用户数据。
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
