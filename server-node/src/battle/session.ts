/**
 * 单局会话：固定 40ms 模拟步长、SSE 增量事件广播、服务端胜负判定。
 *
 * 与现有前端契约完全兼容：
 *   GET /api/state      -> 快照（含 phase 字符串，供 index.html 判定后端模式）
 *   GET /api/events     -> SSE，event: state / event: game
 *   POST /api/command   -> 玩家操作意图
 * 战斗状态只走这条既有链路；WebSocket 只广播房间/钱包/奖励盘等低频事件。
 */
import { config } from '../config.js';
import type { Broadcaster } from '../services.js';
import { GameStore } from '../services.js';
import { EngineHost } from './engine-host.js';

interface Subscriber {
  id: number;
  lastSeq: number;
  send: (event: string, payload: string) => void;
}

/** 前端只能提交这些操作意图，不能提交伤害 / 奖励 / 强化结果。 */
const PLAYER_INTENTS = new Set([
  'move', 'aim_delta', 'aim_absolute', 'charge_start', 'charge_release',
  'charge_cancel', 'skill', 'carry', 'pow', 'heal', 'select_weapon',
]);
const FORBIDDEN_FIELDS = new Set([
  'damage', 'reward', 'rewards', 'coins', 'winner', 'level', 'attack',
  'success', 'itemKey', 'quantity', 'hp', 'forceResult',
]);

export class BattleSession {
  private host = new EngineHost();
  private subs = new Map<number, Subscriber>();
  private nextSubId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = Date.now();
  private lastEventSeq = 0;
  private settled = false;

  state: 'idle' | 'active' | 'finished' = 'idle';
  battleId: string | null = null;

  constructor(private store: GameStore, private broadcast: Broadcaster) {
    // 后端重启后内存中不可能恢复未结束的战斗：标记放弃，已结算的奖励盘保留。
    if (store.activeBattle()) store.leaveBattle();
    this.host.initIdle(store.room().mapId);
    this.timer = setInterval(() => this.tick(), config.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** /api/state：房间空闲时也返回合法快照。 */
  currentState(): any {
    const snap = this.host.snapshot();
    if (snap && this.state === 'idle') snap.phase = 'idle';
    return snap;
  }

  /** SSE 订阅：首次连接立即补发一份完整状态。 */
  subscribe(send: (event: string, payload: string) => void): () => void {
    const id = this.nextSubId++;
    const sub: Subscriber = { id, lastSeq: this.lastEventSeq, send };
    this.subs.set(id, sub);
    const snap = this.currentState();
    if (snap) send('state', JSON.stringify({ seq: this.host.match?.seq ?? 0, type: 'state', data: snap }));
    return () => { this.subs.delete(id); };
  }

  /** 房间点击「开始战斗」。 */
  start(): any {
    if (this.state === 'active' && this.battleId) {
      return { ok: true, battleId: this.battleId, resumed: true };
    }
    const setup = this.store.startBattle();
    this.host.initBattle(setup.mapId, setup);
    this.state = 'active';
    this.battleId = setup.battleId;
    this.settled = false;
    this.resetEventCursors();
    this.broadcast('battle_start', {
      battleId: setup.battleId, mapId: setup.mapId,
      weaponId: setup.weaponId, weaponLevel: setup.weaponLevel,
      weaponAttack: setup.weaponAttack, botAttack: setup.botAttack,
    });
    this.broadcast('room', this.store.room());
    return { ok: true, battleId: setup.battleId, resumed: setup.resumed ?? false };
  }

  /** 返回房间（未翻完的奖励盘保留，下一次回房间给出继续领取入口）。 */
  leave(): any {
    const room = this.store.leaveBattle();
    this.host.initIdle(room.mapId);
    this.state = 'idle';
    this.battleId = null;
    this.settled = false;
    this.resetEventCursors();
    this.broadcast('room', room);
    return room;
  }

  private resetEventCursors(): void {
    this.lastEventSeq = 0;
    for (const sub of this.subs.values()) sub.lastSeq = 0;
  }

  /** POST /api/command 的唯一入口：白名单 + 服务端权威校验。 */
  command(cmd: any): { ok: boolean; error?: string; status?: number } {
    if (this.state !== 'active') {
      return { ok: false, status: 409, error: '当前没有进行中的战斗，请先在房间开始战斗' };
    }
    if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) {
      return { ok: false, status: 400, error: 'invalid command' };
    }
    const type = String(cmd.type || '');
    const isDebug = type === 'fire' || type.startsWith('debug_');
    if (!PLAYER_INTENTS.has(type) && !(config.debug && isDebug)) {
      return { ok: false, status: 403, error: `命令 ${type || '(空)'} 不是允许的操作意图` };
    }
    if (!config.debug) {
      for (const key of Object.keys(cmd)) {
        if (FORBIDDEN_FIELDS.has(key)) {
          return { ok: false, status: 403, error: `命令不得包含结果字段 ${key}` };
        }
      }
    }
    if (type === 'select_weapon') {
      const owned = this.store.room().weapons.some((w: any) => w.weaponId === cmd.weapon);
      if (!owned) return { ok: false, status: 403, error: '该武器不属于当前玩家' };
    }
    const error = this.host.command(cmd);
    if (error) return { ok: false, status: 400, error };
    return { ok: true };
  }

  private tick(): void {
    const now = Date.now();
    let dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (!Number.isFinite(dt) || dt > 0.12) dt = 0.04;

    if (this.state === 'active') {
      this.host.update(dt);
      this.checkWinner();
    }

    const events = this.host.eventsSince(this.lastEventSeq);
    if (events.length) this.lastEventSeq = events[events.length - 1].seq;
    const snap = this.currentState();
    if (!snap || this.subs.size === 0) return;

    const statePayload = JSON.stringify({
      seq: this.host.match?.seq ?? 0, type: 'state', data: snap,
    });
    for (const sub of this.subs.values()) {
      for (const ev of events) {
        if (ev.seq > sub.lastSeq) sub.send('game', JSON.stringify(ev));
      }
      sub.send('state', statePayload);
      sub.lastSeq = this.lastEventSeq;
    }
  }

  /** 胜负由服务端在引擎判定后落库，并创建奖励盘；前端无法指定结果。 */
  private checkWinner(): void {
    if (this.settled || this.state !== 'active' || !this.battleId) return;
    const winner = this.host.match?.winner;
    if (winner === null || winner === undefined) return;
    this.settled = true;
    this.state = 'finished';
    const snap = this.host.snapshot();
    const stats = { ...(snap?.stats || {}), round: snap?.round ?? 0 };
    const settled = this.store.finishBattle(this.battleId, Number(winner), stats);
    this.broadcast('battle_end', {
      battleId: this.battleId, winner: Number(winner),
      result: Number(winner) === 0 ? 'win' : 'lose',
      boardId: settled.boardId, stats,
    });
    try { this.broadcast('reward_board', this.store.rewardBoard(this.battleId)); } catch { /* no board yet */ }
    this.broadcast('room', this.store.room());
  }
}
