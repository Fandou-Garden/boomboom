import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { Broadcaster } from './services.js';

/**
 * WebSocket 只广播低频业务事件（房间 / 钱包 / 奖励盘 / 战斗开始结束）。
 * 战斗帧仍走既有 SSE 契约，避免在每个 WebSocket 消息里传大对象。
 * 服务默认只监听 127.0.0.1，见 index.ts。
 */
export function createWebSocketHub(server: Server): Broadcaster {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'hello', data: { mode: 'server', at: Date.now() } }));
  });
  return (type: string, data: unknown) => {
    const message = JSON.stringify({ type, data, at: Date.now() });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  };
}
