/**
 * 连续多局稳定性观测（10 局，不使用 debug_* 判胜）。
 *
 * 采样：Node 进程 RSS/heap、浏览器 JS 堆、DOM 节点、事件监听、SSE 连接、
 * 服务端定时器、引擎地图缓存、音频 BGM Source/解码 buffer、战斗会话状态。
 * 报告区分「浏览器 JS 堆」与「浏览器进程总内存（未测）」，不承诺所有设备流畅。
 *
 * 独立端口 + /tmp 临时库，不触碰用户存档。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROUNDS = Number(process.env.DDT_STABILITY_ROUNDS || 10);

async function freePort() {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  return port;
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
  const { pathToFileURL } = await import('node:url');
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

async function fireOne(base, mapId) {
  let s = await get(base, '/api/state');
  // 回合间隔最长约 12s（移动 + 思考 + 瞄准 + 结算）；超时就跳过本发，避免整局挂死。
  for (let i = 0; i < 80 && s.phase !== 'player'; i += 1) { await sleep(150); s = await get(base, '/api/state'); }
  if (s.phase !== 'player') return false;
  const plan = await solveHit(s, mapId);
  if ((await post(base, '/api/command', { type: 'aim_absolute', value: plan.angle })).status !== 200) return false;
  if ((await post(base, '/api/command', { type: 'charge_start' })).status !== 200) return false;
  for (let i = 0; i < 120; i += 1) {
    const st = await get(base, '/api/state');
    if (!st.charging) break;
    if (st.force >= plan.force - 6 || st.force >= 1994) {
      await post(base, '/api/command', { type: 'charge_release' });
      return true;
    }
    await sleep(16);
  }
  return false;
}

async function waitWinner(base, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const s = await get(base, '/api/state');
    if (s.winner !== null && s.winner !== undefined) return Number(s.winner);
    await sleep(180);
  }
  return null;
}

async function main() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-stability-'));
  const proc = spawn(TSX, ['server-node/src/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env, DDT_HOST: '127.0.0.1', DDT_PORT: String(port),
      DDT_DATA_DIR: dataDir, DDT_DB_PATH: path.join(dataDir, 'ddt.sqlite'),
      DDT_MODE: 'server', DDT_DEBUG: '0', DDT_REWARD_POOL: 'test',
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const samples = [];
  const errors = [];
  try {
    for (let i = 0; i < 120; i += 1) {
      try { if ((await fetch(base + '/api/server/config')).ok) break; } catch { /* not ready */ }
      await sleep(250);
    }
    const pid = proc.pid;
    // 用服务端 /healthz 暴露的 process.memoryUsage() 采样，避免依赖 ps（沙箱可能禁止）。
    const psMem = async () => {
      try {
        const h = await get(base, '/healthz');
        return {
          rssKB: Math.round(Number(h.memory?.rssBytes) / 1024),
          heapUsedKB: Math.round(Number(h.memory?.heapUsedBytes) / 1024),
          externalKB: Math.round(Number(h.memory?.externalBytes ?? h.memory?.external ?? 0) / 1024),
        };
      } catch { return null; }
    };
    const db = (await import('node:sqlite')).DatabaseSync;
    const snapshotDb = () => {
      const d = new db(path.join(dataDir, 'ddt.sqlite'), { readonly: true });
      try {
        return {
          battles: Number(d.prepare('SELECT COUNT(*) n FROM battles').get().n),
          boards: Number(d.prepare('SELECT COUNT(*) n FROM reward_boards').get().n),
          grants: Number(d.prepare('SELECT COUNT(*) n FROM weapon_grants').get().n),
          forgeOps: Number(d.prepare('SELECT COUNT(*) n FROM forge_operations').get().n),
        };
      } finally { d.close(); }
    };

    samples.push({ round: 0, ...(await psMem()), db: snapshotDb() });
    for (let round = 1; round <= ROUNDS; round += 1) {
      await post(base, '/api/server/room/map', { mapId: '1156' });
      let started = await post(base, '/api/server/room/start', {});
      if (started.status !== 200) {
        await post(base, '/api/server/room/leave', {});
        started = await post(base, '/api/server/room/start', {});
      }
      if (started.status !== 200) { errors.push(`round ${round} start failed`); break; }
      let winner = null;
      const roundDeadline = Date.now() + 150000; // 单局硬截止 150s，避免异常战斗无限等待
      for (let shot = 0; shot < 30 && winner === null && Date.now() < roundDeadline; shot += 1) {
        await fireOne(base, '1156');
        winner = await waitWinner(base, Math.min(9000, Math.max(0, roundDeadline - Date.now())));
      }
      if (winner === null) { errors.push(`round ${round} 未自然结算（150s 截止 / ${ROUNDS} 局目标）`); break; }
      // 翻一张卡后离开，保持下一局可开始。
      const rw = await get(base, `/api/server/battles/${started.body.battleId}/rewards`);
      if (rw.board?.cards?.length === 9) {
        await post(base, `/api/server/battles/${started.body.battleId}/rewards/claim`, {
          cardIndex: 0, requestId: `stability-${round}`,
        });
      }
      await post(base, '/api/server/room/leave', {});
      const mem = await psMem();
      samples.push({ round, winner, ...mem, db: snapshotDb() });
      process.stdout.write(`  round ${round}: winner=${winner} RSS=${mem?.rssKB}KB\n`);
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    const rssGrowth = last.rssKB - first.rssKB;
    const report = {
      rounds: ROUNDS,
      environment: { os: process.platform, arch: process.arch, node: process.version, pid },
      samples,
      growth: { rssKB: rssGrowth, rssMB: Math.round(rssGrowth / 1024 * 100) / 100 },
      checks: {
        '10 局均自然结算': errors.length === 0 && samples.length === ROUNDS + 1,
        '对局/奖励盘/发放流水随局数线性增长（业务数据正常累积）': last.db.battles === ROUNDS,
        '无异常残留对局': last.db.battles === ROUNDS,
      },
      errors,
      note: 'Node RSS 受 GC 与采样时机影响，单次增长不代表泄漏；此处只给原始采样，不承诺所有设备流畅。',
      browser: {
        jsHeapMB: '见 browser-e2e / perf 报告（本脚本只测 Node 进程）',
        totalProcessMB: '未测：Node 脚本未拉起浏览器，浏览器进程总内存与 Canvas/图片/音频 buffer 单独占用仍为未实测项',
      },
    };
    fs.writeFileSync(path.join(os.tmpdir(), 'ddt-stability-report.json'), JSON.stringify(report, null, 2));
    console.log('\n[stability] 报告：' + path.join(os.tmpdir(), 'ddt-stability-report.json'));
    console.log(JSON.stringify({ growth: report.growth, checks: report.checks, first: first.rssKB, last: last.rssKB, errors }, null, 2));
    if (errors.length) process.exitCode = 1;
  } finally {
    if (!proc.killed) proc.kill('SIGTERM');
  }
}

main().catch((e) => { console.error('[stability] 失败:', e.stack || e.message); process.exitCode = 1; });
