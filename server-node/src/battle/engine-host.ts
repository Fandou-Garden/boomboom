/**
 * 战斗引擎宿主：把站点版纯 JS 权威引擎跑在 Node 里。
 *
 * - 按需加载当前地图的碰撞位图并缓存（不每帧读盘、不向前端发送整张地图）。
 * - 开局冻结本局武器属性（attack 进入原版 MakeDamage 公式），战斗中改装备不影响本局。
 * - 固定弱机器人通过引擎既有的 aiSolver 钩子给出固定角度/力度，
 *   仍走同一套弹道、碰撞、伤害与回合入口，不使用必中或额外伤害。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { GunnyEngine, isKnownMap } from '../engine-loader.js';

export interface BattleSetup {
  battleId: string;
  mapId: string;
  weaponId: string;
  weaponLevel: number;
  weaponAttack: number;
  botAttack: number;
  seed: number;
}

const mapCache = new Map<string, Uint8Array>();

export function loadMapBytes(mapId: string): Uint8Array {
  if (!isKnownMap(mapId)) throw new Error(`unknown map: ${mapId}`);
  let bytes = mapCache.get(mapId);
  if (!bytes) {
    const file = path.join(config.distRoot, 'data', `${mapId}.fore.map`);
    bytes = new Uint8Array(fs.readFileSync(file));
    mapCache.set(mapId, bytes);
    // 只保留最近使用的两张：其余地图仅加载缩略图，避免常驻内存。
    if (mapCache.size > 2) {
      const oldest = mapCache.keys().next().value;
      if (oldest && oldest !== mapId) mapCache.delete(oldest);
    }
  }
  return bytes;
}

export class EngineHost {
  readonly engine = new GunnyEngine();
  private setup: BattleSetup | null = null;

  get match(): any { return this.engine.match; }
  get currentSetup(): BattleSetup | null { return this.setup; }

  /** 房间空闲态：初始化引擎以便 /api/state 与 SSE 有合法快照，但不推进回合。 */
  initIdle(mapId: string): void {
    this.init(mapId, null);
  }

  /** 开局：加载地图、冻结属性、安装固定弱机器人。 */
  initBattle(mapId: string, setup: BattleSetup): void {
    this.init(mapId, setup);
  }

  private init(mapId: string, setup: BattleSetup | null): void {
    const bytes = loadMapBytes(mapId);
    const error = this.engine.init(bytes, null, null, null, config.debug);
    if (error) throw new Error(`engine init failed: ${error}`);
    this.setup = setup;
    const m = this.engine.match;
    if (!m) throw new Error('engine match missing after init');

    // 冻结本局双方攻击属性。actor.attack 是原版 Player 属性，
    // sourceDamage() 用 (1 + attack*0.001) 参与伤害结算。
    m.actors[0].attack = setup ? setup.weaponAttack : 100;
    m.actors[1].attack = setup ? setup.botAttack : Math.round(100 * config.bot.attackScale);

    if (setup && setup.weaponId && m.playerWeaponId !== setup.weaponId) {
      const weaponError = this.engine.command(JSON.stringify({ type: 'select_weapon', weapon: setup.weaponId }));
      if (weaponError) throw new Error(`select weapon failed: ${weaponError}`);
    }

    // 固定规则弱机器人：等待时间由引擎既有 ENEMY_MOVE/THINK/AIM 阶段提供。
    // aiSolver 返回固定角度/力度；引擎仍会 clamp 到武器角度范围并施加极小扰动，
    // 然后经 fireLocked -> 弹道 -> resolveImpactLocked 正常结算。
    this.engine.setAISolver((_job: any, done: (best: any) => void) => {
      done({
        angle: config.bot.angle,
        force: config.bot.force,
        direction: -1,
        expected: null,
        solvedAngle: config.bot.angle,
        solvedForce: config.bot.force,
      });
    });
  }

  command(cmd: Record<string, unknown>): string {
    return this.engine.command(JSON.stringify(cmd));
  }

  update(dt: number): void {
    this.engine.update(dt);
  }

  snapshot(): any {
    const raw = this.engine.snapshot();
    if (!raw || raw === 'null') return null;
    return JSON.parse(raw);
  }

  eventsSince(seq: number): any[] {
    return this.match ? this.match.eventsSince(seq) : [];
  }
}
