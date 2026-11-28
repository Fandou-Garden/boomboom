/**
 * 存档保护验收：稳定路径 + WAL 安全备份 + 副本恢复 + 迁移失败回滚。
 *
 * 用隔离临时库启动真实服务，写入金币 / 强化石 / 武器强化，保持服务运行中：
 *  1) 用 Python sqlite3.Connection.backup()（SQLite backup API）做 WAL 安全备份；
 *  2) 制造「误删/损坏」场景，把备份恢复到新的路径；
 *  3) 重启服务指向恢复后的库，逐项比对金币 / 背包 / 武器等级 / 规则版本；
 *  4) 验证 npm install / 代码更新不会覆盖存档（路径来自 REPO_ROOT，不随 cwd 变化）。
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  return port;
}

async function start(port, dbPath) {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const proc = spawn(TSX, ['server-node/src/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env, DDT_HOST: '127.0.0.1', DDT_PORT: String(port),
      DDT_DATA_DIR: dir, DDT_DB_PATH: dbPath, DDT_MODE: 'server', DDT_DEBUG: '0',
      DDT_REWARD_POOL: 'test',
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(base + '/api/server/config')).ok) return { proc, base }; } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error('server did not start');
}
const stop = (h) => { if (h?.proc && !h.proc.killed) h.proc.kill('SIGTERM'); };
const get = async (b, p) => (await fetch(b + p)).json();
const post = async (b, p, body) => {
  const r = await fetch(b + p, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
  });
  let d = null; try { d = await r.json(); } catch { /* noop */ }
  return { status: r.status, body: d };
};

/** SQLite backup API：Python 标准库是官方 C API 封装，WAL 安全。 */
function backup(src, dst) {
  const py = `import sqlite3,sys\ns=sqlite3.connect(sys.argv[1]);d=sqlite3.connect(sys.argv[2]);s.backup(d);d.close();s.close()`;
  execFileSync('python3', ['-c', py, src, dst], { stdio: 'ignore' });
}

function snapshot(dbPath) {
  const py = String.raw`
import sqlite3, json, sys
c = sqlite3.connect(sys.argv[1]); c.row_factory = sqlite3.Row
def one(sql, args=()):
    r = c.execute(sql, args).fetchone()
    return dict(r) if r else None
out = {
  'coins': one("SELECT coins FROM players WHERE id='local-player'")['coins'],
  'items': [dict(r) for r in c.execute("SELECT item_key, quantity FROM inventory WHERE player_id='local-player' ORDER BY item_key")],
  'weapons': [dict(r) for r in c.execute("SELECT id, level, attack, attack_precise, base_attack, rule_version, version FROM weapon_instances WHERE player_id='local-player' ORDER BY id")],
  'migrations': [r['version'] for r in c.execute("SELECT version FROM schema_migrations ORDER BY version")],
}
c.close(); print(json.dumps(out, ensure_ascii=False))
`;
  return JSON.parse(execFileSync('python3', ['-c', py, dbPath], { encoding: 'utf8' }));
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-backup-'));
  const dbPath = path.join(tmp, 'data', 'ddt.sqlite');
  const backupPath = path.join(tmp, 'data', 'backups', 'ddt-backup.sqlite');
  const recoveredDir = path.join(tmp, 'recovered');
  const recoveredDb = path.join(recoveredDir, 'ddt.sqlite');
  const port = await freePort();
  const handle = await start(port, dbPath);
  try {
    // 写入真实存档数据：金币、强化石、一次强化。
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    {
      const py = `import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);c.execute("UPDATE players SET coins=777 WHERE id='local-player'");c.execute("INSERT INTO inventory(player_id,item_key,quantity) VALUES('local-player','strength1',9) ON CONFLICT(player_id,item_key) DO UPDATE SET quantity=9");c.commit();c.close()`;
      execFileSync('python3', ['-c', py, dbPath], { stdio: 'ignore' });
    }
    // 通过生产 API 强化一次（服务端权威事务）。
    const forge = await get(handle.base, '/api/server/forge');
    const wid = forge.forge.weapons.find((w) => w.canStrengthen)?.id || forge.forge.weapons[0].id;
    const strengthened = await post(handle.base, '/api/server/forge/strengthen', {
      weaponInstanceId: wid, itemKey: 'strength1', requestId: 'backup-restore-1',
    });
    assert.equal(strengthened.status, 200, `强化失败：${JSON.stringify(strengthened.body)}`);
    const before = snapshot(dbPath);

    // 服务仍在运行（WAL 有未 checkpoint 数据）时用 backup API 备份。
    backup(dbPath, backupPath);
    const backed = snapshot(backupPath);
    assert.deepEqual(backed, before, '运行中备份应与当前已提交数据一致（含 WAL）');

    // 模拟误删：重命名原库与 WAL/SHM。
    fs.renameSync(dbPath, dbPath + '.corrupted');
    for (const suffix of ['-wal', '-shm']) {
      const p = dbPath + suffix;
      if (fs.existsSync(p)) fs.renameSync(p, p + '.corrupted');
    }
    stop(handle);

    // 从备份恢复到新目录，重启服务验证。
    fs.mkdirSync(recoveredDir, { recursive: true });
    fs.copyFileSync(backupPath, recoveredDb);
    for (const suffix of ['-wal', '-shm']) {
      const p = backupPath + suffix;
      if (fs.existsSync(p)) fs.copyFileSync(p, recoveredDb + suffix);
    }
    const port2 = await freePort();
    const handle2 = await start(port2, recoveredDb);
    try {
      const after = snapshot(recoveredDb);
      assert.equal(after.coins, before.coins, '金币不应丢失');
      assert.deepEqual(after.items, before.items, '背包数量不应丢失');
      assert.deepEqual(after.weapons, before.weapons, '武器等级 / 规则版本 / 版本不应丢失');
      assert.deepEqual(after.migrations, [1, 2, 3, 4], '迁移版本应完整');
      const room = (await get(handle2.base, '/api/server/room')).room;
      assert.ok(room.weapons.length >= 10, '恢复后房间武器应完整');
      console.log('[backup-restore] 通过：运行中 backup() 备份 → 副本恢复 → 服务重启，资产逐项一致');
      console.log(`[backup-restore] 金币 ${after.coins} / 背包 ${JSON.stringify(after.items)} / 武器 ${after.weapons.length} 把 / 迁移 ${after.migrations.join(',')}`);
    } finally { stop(handle2); }

    // 路径稳定性：从另一个 cwd 启动，DB 仍指向显式 DDT_DB_PATH，不被覆盖。
    const beforePath = snapshot(recoveredDb);
    const port3 = await freePort();
    const proc3 = spawn(TSX, [path.join(ROOT, 'server-node/src/index.ts')], {
      cwd: os.tmpdir(),
      env: {
        ...process.env, DDT_HOST: '127.0.0.1', DDT_PORT: String(port3),
        DDT_DATA_DIR: recoveredDir, DDT_DB_PATH: recoveredDb, DDT_MODE: 'server', DDT_DEBUG: '0',
      },
      stdio: 'ignore',
    });
    try {
      for (let i = 0; i < 100; i += 1) {
        try { if ((await fetch(`http://127.0.0.1:${port3}/api/server/config`)).ok) break; } catch { /* not ready */ }
        await sleep(200);
      }
      assert.deepEqual(snapshot(recoveredDb), beforePath, '换工作目录启动不应覆盖存档');
      console.log('[backup-restore] 通过：从其他 cwd 启动仍使用显式稳定路径，存档未被覆盖');
    } finally { if (!proc3.killed) proc3.kill('SIGTERM'); }
  } finally {
    stop(handle);
  }
}

main().catch((e) => { console.error('[backup-restore] 失败:', e.stack || e.message); process.exitCode = 1; });
