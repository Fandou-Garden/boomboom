/**
 * 战斗引擎宿主：把站点版纯 JS 权威引擎跑在 Node 里。
 *
 * - 按需加载当前地图的碰撞位图并缓存（不每帧读盘、不向前端发送整张地图）。
 * - 开局冻结本局武器属性：强化只按倍率缩放 engine 的 baseDamage（原版 MakeDamage
 *   的基础伤害基数），actor.attack 保持原版 Player 四维攻击值 100 不变。
 *   这是「基础伤害 +10%」与「四维攻击 +10%」的关键区别：伤害公式是
 *   baseDamage * (1 + attack*0.001)，写错字段会只改变约 0.9% 伤害。
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
  /** UI / 存档中的武器基础伤害（未强化值 × 强化倍率），仅用于展示与存档。 */
  weaponAttack: number;
  /** 强化倍率 = 1 + 0.10 × 等级；只乘到 engine 的 baseDamage，不写 actor.attack。 */
  weaponDamageScale: number;
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

    // 先切换武器，再冻结本局属性，避免后续任何命令覆盖强化倍率。
    if (setup && setup.weaponId && m.playerWeaponId !== setup.weaponId) {
      const weaponError = this.engine.command(JSON.stringify({ type: 'select_weapon', weapon: setup.weaponId }));
      if (weaponError) throw new Error(`select weapon failed: ${weaponError}`);
    }

    // 原版 sourceDamage()：baseDamage * (1 + attack*0.001) * 防御减免 * ...
    // 交付规则是「基础伤害 × (1 + 0.10×等级)」，因此只缩放 baseDamage。
    // actor.attack 是原版 Player 四维攻击属性，强化不得改写它——否则
    // 100→110 只会让 (1+attack*0.001) 从 1.10 变 1.11（约 +0.9% 伤害），
    // 与「基础伤害 +10%」不符，也会误改四维属性。
    // 基值直接读引擎 init 后的原版 actor，避免硬编码常量漂移。
    const originalAttack = Number(m.actors[0].attack);
    const originalBaseDamage = Number(m.actors[0].baseDamage);
    m.actors[0].attack = originalAttack;
    // 规整到 6 位，消除 360*1.1=396.00000000000006 这类二进制尾差。
    m.actors[0].baseDamage = Math.round(
      originalBaseDamage * (setup ? setup.weaponDamageScale : 1) * 1e6,
    ) / 1e6;
    m.actors[1].attack = setup ? setup.botAttack : Math.round(originalAttack * config.bot.attackScale);
    // 机器人只改四维 attack（既有固定弱机器人规则），基础伤害保持引擎原版值。

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
