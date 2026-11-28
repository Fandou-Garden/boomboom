import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { openDatabase } from './db.js';
import { GameStore } from './services.js';
import { BattleSession } from './battle/session.js';
import { createApiRouter } from './api.js';
import { createWebSocketHub } from './ws.js';

if (!fs.existsSync(path.join(config.distRoot, 'index.html'))) {
  throw new Error(`前端目录不存在或缺少 index.html: ${config.distRoot}`);
}

const db = openDatabase();
const app = express();
const server = http.createServer(app);

// WebSocket 与 HTTP 同一进程、同一端口；默认只监听 127.0.0.1。
const broadcast = createWebSocketHub(server);
const store = new GameStore(db);
store.setBroadcaster(broadcast);
const session = new BattleSession(store, broadcast);

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(createApiRouter({ store, session }));

// 未知 /api 路由返回 JSON 404，避免前端把静态 HTML 当成后端响应。
app.use('/api', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).json({ ok: false, code: 'not-found', error: 'API 路由不存在' });
});

app.use(express.static(config.distRoot, {
  index: 'index.html',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('.webmanifest')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  console.error('[ddt-server] request error', error?.message || error);
  res.status(400).json({ ok: false, code: 'bad-request', error: '请求体解析失败' });
});

server.listen(config.port, config.host, () => {
  const url = `http://${config.host}:${config.port}/`;
  console.log('');
  console.log('  DDT 本地服务端版 (Node + TypeScript + SQLite)');
  console.log(`  地址        ${url}`);
  console.log(`  前端        ${config.distRoot} (站点版同一份文件)`);
  console.log(`  数据库      ${config.dbPath} (WAL, 外键开启)`);
  console.log(`  模式        ${config.mode}  调试=${config.debug}  步长=${config.tickMs}ms`);
  console.log(`  机器人      固定角度 ${config.bot.angle}° / 力度 ${config.bot.force} / 攻击倍率 ${config.bot.attackScale}`);
  console.log(`  强化规则    ${config.forge.ruleLabel} (${config.forge.ruleSource})`);
  console.log(`              +0 ~ +${config.forge.maxLevel} · 每次 1 颗真强化石 + ${config.forge.coinCostPerTargetLevel}×目标等级金币 · 成功率 100%`);
  console.log('  提示        铁匠铺界面 / 武器素材 / 动画 / 音效来自原版 store.swf；强化算法为单机自定义规则，不是原版强化算法');
  console.log('');
});

function shutdown(): void {
  session.stop();
  server.close(() => {
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
