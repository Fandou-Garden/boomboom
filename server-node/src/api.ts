import { Router } from 'express';
import type { Response } from 'express';
import { config, publicRules } from './config.js';
import { ApiError, GameStore } from './services.js';
import type { BattleSession } from './battle/session.js';

interface Deps {
  store: GameStore;
  session: BattleSession;
}

/** 统一错误处理：ApiError 转 JSON，其余 500。 */
function handler(fn: (req: any, res: Response) => unknown) {
  return (req: any, res: Response) => {
    try {
      const result = fn(req, res);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch((error) => sendError(res, error));
      }
    } catch (error) {
      sendError(res, error);
    }
  };
}

function sendError(res: Response, error: unknown): void {
  if (res.headersSent) return;
  if (error instanceof ApiError) {
    res.status(error.status).json({ ok: false, code: error.code, error: error.message });
    return;
  }
  console.error('[ddt-server] unhandled error', error);
  res.status(500).json({ ok: false, code: 'internal-error', error: '服务端内部错误' });
}

function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

export function createApiRouter({ store, session }: Deps): Router {
  const router = Router();

  router.get('/healthz', handler((_req, res) => {
    noStore(res);
    // 实测值（非估算）：用于记录后端常驻内存，也方便本地监控。
    const mem = process.memoryUsage();
    res.json({
      ok: true, mode: config.mode, battleState: session.state, battleId: session.battleId,
      memory: {
        rssBytes: mem.rss, heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal, externalBytes: mem.external,
      },
    });
  }));

  // ---------------------------------------------------------------- 既有前端契约
  router.get('/api/state', handler((_req, res) => {
    noStore(res);
    const state = session.currentState();
    if (!state) { res.status(503).json({ ok: false, error: 'engine not initialized' }); return; }
    res.json(state);
  }));

  router.get('/api/events', (req, res) => {
    noStore(res);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const unsubscribe = session.subscribe((event, payload) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${payload}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15000);
    heartbeat.unref?.();
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  router.post('/api/command', handler((req, res) => {
    noStore(res);
    const result = session.command(req.body);
    if (!result.ok) {
      res.status(result.status ?? 400).type('text/plain').send(result.error || 'command rejected');
      return;
    }
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- 服务端模式 API
  router.get('/api/server/config', handler((_req, res) => {
    noStore(res);
    res.json({
      ok: true,
      mode: config.mode,
      rules: publicRules(),
      version: 1,
      /** 前端据此切换统一数据访问接口；站点版静态部署时此路由 404 -> offline。 */
      contract: 'ddt-server-mode-v1',
    });
  }));

  router.get('/api/server/rules', handler((_req, res) => {
    noStore(res);
    res.json({ ok: true, rules: publicRules() });
  }));

  router.get('/api/server/player', handler((_req, res) => {
    noStore(res);
    res.json({ ok: true, playerId: config.playerId, wallet: store.wallet() });
  }));

  router.get('/api/server/room', handler((_req, res) => {
    noStore(res);
    res.json({ ok: true, room: store.room(), battleState: session.state });
  }));

  router.post('/api/server/room/map', handler((req, res) => {
    noStore(res);
    res.json({ ok: true, room: store.setMap(req.body?.mapId) });
  }));

  router.post('/api/server/room/weapon', handler((req, res) => {
    noStore(res);
    res.json({ ok: true, room: store.equipWeapon(req.body?.weaponInstanceId) });
  }));

  router.post('/api/server/room/start', handler((req, res) => {
    noStore(res);
    res.json({ ok: true, ...session.start() });
  }));

  router.post('/api/server/room/leave', handler((_req, res) => {
    noStore(res);
    res.json({ ok: true, room: session.leave() });
  }));

  router.get('/api/server/battles/:id/rewards', handler((req, res) => {
    noStore(res);
    res.json({ ok: true, board: store.rewardBoard(String(req.params.id)) });
  }));

  router.post('/api/server/battles/:id/rewards/claim', handler((req, res) => {
    noStore(res);
    const result = store.claimCard({
      battleId: String(req.params.id),
      cardIndex: req.body?.cardIndex,
      requestId: req.body?.requestId,
    });
    res.json(result);
  }));

  router.get('/api/server/forge', handler((_req, res) => {
    noStore(res);
    res.json({ ok: true, forge: store.forge() });
  }));

  router.post('/api/server/forge/strengthen', handler((req, res) => {
    noStore(res);
    const result = store.strengthen({
      weaponInstanceId: req.body?.weaponInstanceId,
      itemKey: req.body?.itemKey,
      requestId: req.body?.requestId,
    });
    res.json(result);
  }));

  return router;
}
