/**
 * 性能实测（非估算）：后端 RSS / 浏览器 JS 堆 / 首屏资源体积。
 * 独立端口 + /tmp 临时数据库，不触碰用户存档。
 * 运行：npm run test:server:perf
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  return port;
}

function dirBytes(target) {
  let total = 0;
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)); }
    else total += st.size;
  };
  walk(target);
  return total;
}

const mb = (bytes) => +(bytes / 1024 / 1024).toFixed(2);

async function main() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-perf-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'server-node/src/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env, DDT_HOST: '127.0.0.1', DDT_PORT: String(port),
      DDT_DATA_DIR: dataDir, DDT_DB_PATH: path.join(dataDir, 'ddt.sqlite'),
      DDT_MODE: 'server', DDT_DEBUG: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  proc.stdout.on('data', (d) => { logs += d.toString(); });
  proc.stderr.on('data', (d) => { logs += d.toString(); });
  const base = `http://127.0.0.1:${port}`;
  let browser;
  try {
    for (let i = 0; i < 120; i += 1) {
      try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* wait */ }
      await sleep(150);
    }
    const health = await (await fetch(`${base}/healthz`)).json();
    if (!health.ok) throw new Error(`server failed: ${logs}`);

    const idle = health.memory;
    const report = {
      measuredAt: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      server: {
        idle: { rssMB: mb(idle.rssBytes), heapUsedMB: mb(idle.heapUsedBytes), externalMB: mb(idle.externalBytes) },
      },
    };

    if (fs.existsSync(CHROME)) {
      browser = await puppeteer.launch({
        executablePath: CHROME, headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });
      await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => document.querySelectorAll('.ddt-map').length === 12, { timeout: 30000 });
      await sleep(1500);

      const cdp = await page.target().createCDPSession();
      await cdp.send('Performance.enable');
      const { metrics } = await cdp.send('Performance.getMetrics');
      const value = (name) => metrics.find((m) => m.name === name)?.value ?? null;
      const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => ({
        name: r.name.replace(location.origin, ''),
        encoded: r.encodedBodySize, transfer: r.transferSize, decoded: r.decodedBodySize,
      })));
      const sumEncoded = resources.reduce((s, r) => s + (r.encoded || 0), 0);
      const sumTransfer = resources.reduce((s, r) => s + (r.transfer || 0), 0);
      const largest = [...resources].sort((a, b) => b.encoded - a.encoded).slice(0, 5);

      report.browser = {
        jsHeapUsedMB: value('JSHeapUsedSize') === null ? null : mb(value('JSHeapUsedSize')),
        domNodes: value('Nodes'), jsEventListeners: value('JSEventListeners'),
        firstScreenRequests: resources.length,
        firstScreenEncodedMB: mb(sumEncoded),
        firstScreenTransferMB: mb(sumTransfer),
        largestResources: largest.map((r) => ({ file: r.name, encodedMB: mb(r.encoded) })),
      };

      // 战斗进行中（40ms 固定 tick + SSE 广播）的后端内存
      await fetch(`${base}/api/server/room/start`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      await sleep(4000);
      const busy = await (await fetch(`${base}/healthz`)).json();
      report.server.inBattle = {
        rssMB: mb(busy.memory.rssBytes),
        heapUsedMB: mb(busy.memory.heapUsedBytes),
        battleState: busy.battleState,
      };
      await page.close();
    } else {
      report.browser = 'Chrome 未找到，跳过浏览器指标（设置 CHROME_PATH 可复测）';
    }

    const dist = path.join(ROOT, 'dist');
    report.bundle = {
      distTotalMB: mb(dirBytes(dist)),
      assetsMB: mb(dirBytes(path.join(dist, 'assets'))),
      dataMapsMB: mb(dirBytes(path.join(dist, 'data'))),
      jsMB: mb(dirBytes(path.join(dist, 'js'))),
      indexHtmlKB: +(fs.statSync(path.join(dist, 'index.html')).size / 1024).toFixed(1),
      stylesCssKB: +(fs.statSync(path.join(dist, 'styles.css')).size / 1024).toFixed(1),
      mapAssetsCount: fs.readdirSync(path.join(dist, 'data')).filter((f) => f.endsWith('.fore.map')).length,
    };

    console.log(JSON.stringify(report, null, 2));
    const out = path.join(dataDir, 'perf-report.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\n报告已保存：${out}`);
  } finally {
    if (browser) await browser.close();
    const exited = new Promise((r) => proc.once('exit', r));
    proc.kill('SIGTERM');
    await Promise.race([exited, sleep(5000)]);
    if (proc.exitCode === null) proc.kill('SIGKILL');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
