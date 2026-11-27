/**
 * 统一数据访问接口 —— 前端只有这一层区分两种运行模式，不复制两套前端。
 *
 *  offline（站点版）：沿用现有 dist/js/save.js 的 localStorage 实现，
 *                    不启用房间/铁匠铺/服务端奖励，保持站点版原样。
 *  server（服务端版）：HTTP REST + WebSocket，服务端是唯一权威来源，
 *                    前端只提交 battleId / cardIndex / requestId / 选择意图。
 *
 * 模式选择：服务端 DDT_MODE 环境变量决定 /api/server/config 是否可用；
 * URL ?mode=offline 可强制回退到站点版；window.__GUNNY_SERVER_MODE__ 可显式注入。
 */
import { loadSave, claimReward, hasClaimed, resetSave } from './save.js?v=33';

const params = new URLSearchParams(location.search);

class DataApi {
  constructor() {
    this.mode = 'offline';
    this.config = null;
    this.wallet = null;
    this.room = null;
    this.listeners = new Map();
    this.ws = null;
    this.wsRetry = null;
  }

  async init() {
    const injected = window.__GUNNY_SERVER_MODE__;
    const forced = params.get('mode');
    if (forced === 'offline' || injected === 'offline') {
      this.mode = 'offline';
      return this.mode;
    }
    try {
      const res = await fetch('/api/server/config', {
        cache: 'no-store', headers: { accept: 'application/json' },
      });
      const type = res.headers.get('content-type') || '';
      if (res.ok && type.includes('application/json')) {
        const cfg = await res.json();
        if (cfg && cfg.ok && cfg.mode === 'server') {
          this.mode = 'server';
          this.config = cfg;
          this.connectWebSocket();
          return this.mode;
        }
      }
    } catch (error) {
      // 静态站点部署时该路由 404 / 返回 HTML，按站点版运行。
    }
    this.mode = 'offline';
    return this.mode;
  }

  isServer() { return this.mode === 'server'; }

  newRequestId() {
    if (globalThis.crypto?.randomUUID) return `req_${globalThis.crypto.randomUUID()}`;
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }

  // ---------------------------------------------------------------- WebSocket
  connectWebSocket() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      this.ws = ws;
      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (!msg || typeof msg.type !== 'string') return;
        if (msg.type === 'wallet') this.wallet = { ...msg.data };
        if (msg.type === 'room') this.room = msg.data;
        this.dispatch(msg.type, msg.data);
      };
      ws.onclose = () => {
        if (this.mode !== 'server') return;
        clearTimeout(this.wsRetry);
        this.wsRetry = setTimeout(() => this.connectWebSocket(), 2000);
      };
      ws.onerror = () => { /* onclose 负责重连 */ };
    } catch (error) {
      console.warn('[ddt] WebSocket 连接失败，房间状态改为按需轮询', error);
    }
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  dispatch(type, data) {
    for (const fn of this.listeners.get(type) || []) {
      try { fn(data); } catch (error) { console.warn('[ddt] listener failed', type, error); }
    }
    for (const fn of this.listeners.get('*') || []) {
      try { fn({ type, data }); } catch (error) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------- HTTP
  async request(path, options = {}) {
    const res = await fetch(path, {
      method: options.method || 'GET',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      cache: 'no-store',
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let payload;
    try { payload = await res.json(); } catch { payload = null; }
    if (!res.ok) {
      const error = new Error(payload?.error || `HTTP ${res.status}`);
      error.code = payload?.code || 'http-error';
      error.status = res.status;
      throw error;
    }
    return payload;
  }

  // ---------------------------------------------------------------- 统一接口
  async getWallet() {
    if (!this.isServer()) {
      const save = loadSave();
      return { coins: save.coins, stones: save.stones, items: [] };
    }
    const result = await this.request('/api/server/player');
    this.wallet = result.wallet;
    return this.wallet;
  }

  getCachedWallet() { return this.wallet; }

  async getRoom() {
    if (!this.isServer()) return null;
    const result = await this.request('/api/server/room');
    this.room = result.room;
    this.wallet = result.room.wallet;
    return result.room;
  }

  async setMap(mapId) {
    if (!this.isServer()) return null;
    const result = await this.request('/api/server/room/map', { method: 'POST', body: { mapId } });
    this.room = result.room;
    return result.room;
  }

  async equipWeapon(weaponInstanceId) {
    if (!this.isServer()) return null;
    const result = await this.request('/api/server/room/weapon', {
      method: 'POST', body: { weaponInstanceId },
    });
    this.room = result.room;
    return result.room;
  }

  async startBattle() {
    if (!this.isServer()) return null;
    return this.request('/api/server/room/start', { method: 'POST', body: {} });
  }

  async leaveBattle() {
    if (!this.isServer()) return null;
    const result = await this.request('/api/server/room/leave', { method: 'POST', body: {} });
    this.room = result.room;
    return result.room;
  }

  async getRewards(battleId) {
    if (!this.isServer()) return null;
    const result = await this.request(`/api/server/battles/${encodeURIComponent(battleId)}/rewards`);
    this.wallet = result.board.wallet;
    return result.board;
  }

  async claimCard(battleId, cardIndex, requestId) {
    if (!this.isServer()) return null;
    return this.request(`/api/server/battles/${encodeURIComponent(battleId)}/rewards/claim`, {
      method: 'POST', body: { cardIndex, requestId },
    });
  }

  /** 站点版等价实现：一次把本局累计奖励写入 localStorage。 */
  claimOffline(matchId, coins, stones) {
    return claimReward(matchId, coins, stones);
  }

  hasClaimedOffline(matchId) { return hasClaimed(matchId); }

  resetOffline() { return resetSave(); }

  async getForge() {
    if (!this.isServer()) return null;
    const result = await this.request('/api/server/forge');
    this.wallet = result.forge.wallet;
    return result.forge;
  }

  async strengthen(payload) {
    if (!this.isServer()) return null;
    return this.request('/api/server/forge/strengthen', { method: 'POST', body: payload });
  }
}

export const dataApi = new DataApi();
export default dataApi;
