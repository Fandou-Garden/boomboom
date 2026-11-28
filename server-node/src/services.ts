/**
 * 服务端业务服务：玩家存档、房间、奖励盘、铁匠铺。
 *
 * 权威原则：奖励内容、扣费、强化结果全部由服务端计算；
 * 前端只传 battleId / cardIndex / requestId / 选择意图。
 * 所有写操作都在 SQLite 事务内，并使用唯一约束 + requestId 防重放。
 */
import { randomInt } from 'node:crypto';
import type { Db } from './db.js';
import { all, one, run, transaction } from './db.js';
import { config, publicRules } from './config.js';
import { BASE_ATTACK, DEFAULT_MAP_ID, MAPS, WEAPON_DEFS, WEAPON_ORDER, isKnownMap, weaponLabel } from './engine-loader.js';
import { clampInt, newId, nowMs, randInt, seededRng } from './util.js';
import {
  ALL_ORIGINAL_ITEMS, CHARMS, HIGH_QUALITY_WEAPONS, STRENGTHEN_LEVELS,
  STRENGTH_STONES, highQualityWeaponByKey, ORIGINAL_CONSTANTS, ORIGINAL_RULE_TRACE,
  type OriginalItem,
} from './original-data.js';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export type Broadcaster = (type: string, data: unknown) => void;

interface RewardCard {
  kind: 'coin' | 'item' | 'weapon';
  amount: number;
  itemKey?: string;
  weaponKey?: string;
}

/** item_catalog.unit_value：强化石/合成石用等级，幸运符用 Property2，神恩符为 0。 */
function unitValueOf(item: OriginalItem): number {
  if (item.kind === 'lucky-charm') return item.property2;
  if (item.kind === 'god-charm') return 0;
  return item.level;
}

export function strengthStoneKeys(): string[] {
  return STRENGTH_STONES.map((s) => s.key);
}

/**
 * 强化随机源（服务端权威，前端无法指定）。
 * 默认由 requestId / 版本 / 等级派生的可复现种子；
 * DDT_FORGE_RANDOM 可注入 always-success / always-fail / fixed:<0..1> / sequence:a,b,c，
 * 仅用于自动化测试精确控制成功与失败，不靠反复运行碰概率。
 */
let forgeSequenceIndex = 0;
export function forgeRoll(seed: number): number {
  const spec = config.forge.randomSource.trim();
  if (!spec) return seededRng(seed)();
  if (spec === 'always-success') return 0;
  if (spec === 'always-fail') return 0.999999;
  if (spec.startsWith('fixed:')) {
    const v = Number(spec.slice(6));
    if (Number.isFinite(v)) return Math.min(1, Math.max(0, v));
  }
  if (spec.startsWith('sequence:')) {
    const parts = spec.slice(9).split(',').map(Number).filter(Number.isFinite);
    if (parts.length) {
      const v = parts[forgeSequenceIndex % parts.length];
      forgeSequenceIndex += 1;
      return Math.min(1, Math.max(0, v));
    }
  }
  return seededRng(seed)();
}

export class GameStore {
  private emit: Broadcaster = () => {};

  constructor(private db: Db) {
    this.ensurePlayer();
  }

  setBroadcaster(fn: Broadcaster): void { this.emit = fn; }

  /** 固定本地玩家 + 原版物品登记 + 初始武器实例；可重复调用，不覆盖存档。 */
  ensurePlayer(): void {
    const t = nowMs();
    transaction(this.db, () => {
      run(this.db,
        'INSERT OR IGNORE INTO players (id, display_name, coins, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
        config.playerId, config.playerName, t, t);
      // 原版物品登记：强化石 / 幸运符 / 神恩符 / 四圣兽合成石，类别严格区分。
      // 「神武石」不在此表，保持 unmatched（见下方 unmatched_items）。
      for (const item of ALL_ORIGINAL_ITEMS) {
        run(this.db,
          `INSERT OR IGNORE INTO item_catalog
           (item_key, template_id, name_zh, name_source, icon, kind, unit_value, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          item.key, item.templateId, item.nameZh, item.nameSource, item.icon,
          item.kind, unitValueOf(item), item.note);
      }
      run(this.db,
        `INSERT INTO unmatched_items (query, status, note, checked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(query) DO UPDATE SET status = excluded.status, note = excluded.note, checked_at = excluded.checked_at`,
        '神武石', 'unmatched',
        '已核对上游 Gunny @ 057c71a（与 dist/js/engine/constants.js 的 SOURCE_COMMIT 一致）的 GameAdmin/Backup/XMLReader/XMLImport/TemplateAlllist.xml：zlib 解压后 7642 个 <Item> 条目中无「神武」、无「Thần Vũ」物品。该版本原版存在的是 Đá Huyền Vũ 1..5（玄武石），TemplateID 11005/11006/11007/11008/11031，Quality 1..5。未编造 TemplateID，未用玄武石冒充神武石；普通强化石链路单独实现。',
        t);
      for (const weaponId of WEAPON_ORDER) {
        run(this.db,
          `INSERT OR IGNORE INTO weapon_instances
           (id, player_id, weapon_id, label, level, attack, version, equipped, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, 0, 0, ?, ?)`,
          `wi_${config.playerId}_${weaponId}`, config.playerId, weaponId, weaponLabel(weaponId), BASE_ATTACK, t, t);
      }
      const equipped = one(this.db, 'SELECT id FROM weapon_instances WHERE player_id = ? AND equipped = 1', config.playerId);
      if (!equipped) {
        const preferred = WEAPON_ORDER.includes('fruit') ? 'fruit' : WEAPON_ORDER[0];
        run(this.db, 'UPDATE weapon_instances SET equipped = 1 WHERE player_id = ? AND weapon_id = ?', config.playerId, preferred);
      }
      const equippedRow = one<{ id: string }>(this.db,
        'SELECT id FROM weapon_instances WHERE player_id = ? AND equipped = 1', config.playerId);
      run(this.db,
        `INSERT OR IGNORE INTO rooms (id, player_id, map_id, weapon_instance_id, status, active_battle_id, updated_at)
         VALUES (?, ?, ?, ?, 'idle', NULL, ?)`,
        `room_${config.playerId}`, config.playerId, DEFAULT_MAP_ID, equippedRow?.id ?? null, t);
    });
  }

  // ---------------------------------------------------------------- 读视图

  wallet(): any {
    const player = one<{ coins: number }>(this.db, 'SELECT coins FROM players WHERE id = ?', config.playerId);
    const items = all(this.db,
      `SELECT c.item_key, c.template_id, c.name_zh, c.name_source, c.icon, c.kind, c.unit_value,
              COALESCE(i.quantity, 0) AS quantity
       FROM item_catalog c LEFT JOIN inventory i
         ON i.item_key = c.item_key AND i.player_id = ?
       ORDER BY c.unit_value`, config.playerId);
    return {
      coins: Number(player?.coins ?? 0),
      items: items.map((r: any) => ({
        itemKey: r.item_key, templateId: r.template_id, name: r.name_zh,
        nameSource: r.name_source, icon: r.icon, kind: r.kind,
        unitValue: Number(r.unit_value), quantity: Number(r.quantity),
      })),
    };
  }

  private weaponRows(): any[] {
    return all(this.db,
      `SELECT id, weapon_id, label, level, attack, version, equipped,
              template_id, base_weapon_id, variant, rule_version, template_level
       FROM weapon_instances WHERE player_id = ? ORDER BY weapon_id`, config.playerId);
  }

  /** 极武器用 base_weapon_id 复用经典武器的弹道 / 弹丸 / 爆炸表现。 */
  private ballisticsId(row: any): string {
    return String(row?.base_weapon_id || row?.weapon_id || 'fruit');
  }

  private equippedWeapon(): any {
    const row = one(this.db,
      `SELECT id, weapon_id, label, level, attack, version, template_id, base_weapon_id, variant
       FROM weapon_instances WHERE player_id = ? AND equipped = 1`, config.playerId);
    if (!row) throw new ApiError(500, 'no-equipped-weapon', '没有已装备的武器');
    return row;
  }

  /** LOCAL_RULE 的消耗与成功率；原版规则另见 originalRuleFor()。 */
  private forgeCost(level: number) {
    const f = config.forge;
    return {
      coins: f.coinCostBase + level * f.coinCostPerLevel,
      requiredUnits: f.itemCostBase + level * f.itemCostPerLevel,
      successRate: level === 0 && f.firstLevelGuaranteed
        ? 1
        : Math.max(f.successMin, f.successBase - level * f.successPerLevel),
      nextAttack: BASE_ATTACK + (level + 1) * f.attackPerLevel,
    };
  }

  /**
   * 原版成功率（ItemStrengthenHandler.cs:40-121 逐行移植）：
   *   probability = Σ RateItems[stone.Level - 1]        （三个石头槽，不能重复）
   *   num5 = probability * 100 / GetNeedRate(item)       （GetNeedRate 取 Rock）
   *   幸运符 num2 = probability + trunc(Property2/100)  （C# 整数除法）
   *   num6 = num2 * 100 / GetNeedRate(item)
   *   num7 = floor((num5+num6+num4+num3)*100)，与 random.Next(10000) 比较
   *   → 成功率 = (num5+num6)/100 = (probability + num2) / Rock
   * 原版没有金币扣费：只有 StoreBag.ClearBag() 消耗槽位物品。
   * VIP(num3) / 公会铁匠铺(num4) / 开孔 / 进阶换模板未接线，见 note。
   */
  private originalRuleFor(level: number, stoneKeys: string[], luckyKey: string | null): {
    rock: number; probability: number; luckyContribution: number;
    successRate: number; stoneLevelMin: number;
  } {
    const next = STRENGTHEN_LEVELS.find((r) => r.level === level + 1);
    if (!next) throw new ApiError(409, 'max-level', '已达原版强化等级上限');
    let probability = 0;
    for (const key of stoneKeys) {
      const stone = STRENGTH_STONES.find((s) => s.key === key);
      if (!stone || stone.rate === undefined) throw new ApiError(400, 'invalid-strength-stone', '强化石槽位无效');
      probability += stone.rate;
    }
    const num2Base = luckyKey
      ? probability + Math.trunc((CHARMS.find((c) => c.key === luckyKey)?.property2 ?? 0) / 100)
      : 0;
    const successRate = Math.min(1, Math.max(0, (probability + num2Base) / next.rock));
    return { rock: next.rock, probability, luckyContribution: num2Base, successRate, stoneLevelMin: next.stoneLevelMin };
  }

  private pendingBoard(): any | null {
    return one(this.db,
      `SELECT b.id, b.battle_id, b.max_picks, b.picks_used, b.status, b.created_at
       FROM reward_boards b WHERE b.player_id = ? AND b.status = 'open'
       ORDER BY b.created_at DESC LIMIT 1`, config.playerId) ?? null;
  }

  private lastResult(): any | null {
    const row = one(this.db,
      `SELECT id, result, winner, stats_json, ended_at FROM battles
       WHERE player_id = ? AND status = 'finished' ORDER BY ended_at DESC LIMIT 1`, config.playerId);
    if (!row) return null;
    let stats: any = {};
    try { stats = JSON.parse((row as any).stats_json || '{}'); } catch { /* keep empty */ }
    return {
      battleId: (row as any).id, result: (row as any).result,
      winner: (row as any).winner, stats, endedAt: (row as any).ended_at,
    };
  }

  room(): any {
    const r = one(this.db,
      `SELECT id, map_id, status, active_battle_id, updated_at FROM rooms WHERE player_id = ?`, config.playerId);
    if (!r) throw new ApiError(500, 'no-room', '房间不存在');
    const rr = r as any;
    const equipped = this.equippedWeapon();
    const map = MAPS.find((m) => m.id === rr.map_id) || MAPS[0];
    const pending = this.pendingBoard();
    return {
      id: rr.id,
      playerId: config.playerId,
      playerName: config.playerName,
      mapId: rr.map_id,
      mapName: map.name,
      status: rr.status,
      activeBattleId: rr.active_battle_id ?? null,
      maps: MAPS.map((m) => ({ ...m, thumb: `assets/map-${m.id}-thumb.jpg` })),
      weapons: this.weaponRows().map((w: any) => ({
        id: w.id, weaponId: w.weapon_id, label: w.label,
        level: Number(w.level), attack: Number(w.attack),
        version: Number(w.version), equipped: Number(w.equipped) === 1,
        variant: w.variant || 'normal', templateId: w.template_id ?? null,
        baseWeaponId: w.base_weapon_id ?? null,
        ruleVersion: w.rule_version || 'LOCAL_RULE',
        templateLevel: Number(w.template_level ?? 2),
        angleMin: WEAPON_DEFS[this.ballisticsId(w)]?.angleMin ?? null,
        angleMax: WEAPON_DEFS[this.ballisticsId(w)]?.angleMax ?? null,
      })),
      equipped: {
        id: equipped.id, weaponId: equipped.weapon_id, label: equipped.label,
        level: Number(equipped.level), attack: Number(equipped.attack),
        variant: equipped.variant || 'normal', templateId: equipped.template_id ?? null,
        baseWeaponId: equipped.base_weapon_id ?? null,
      },
      wallet: this.wallet(),
      bot: {
        label: config.bot.label, angle: config.bot.angle, force: config.bot.force,
        attackScale: config.bot.attackScale, ruleSource: config.bot.ruleSource,
      },
      pendingReward: pending ? {
        battleId: pending.battle_id, picksUsed: Number(pending.picks_used),
        maxPicks: Number(pending.max_picks), status: pending.status,
      } : null,
      lastResult: this.lastResult(),
      rules: publicRules(),
    };
  }

  forge(): any {
    const active = config.forge.rules === 'original';
    const maxLevel = active ? config.forge.original.maxLevel : config.forge.maxLevel;
    const wallet = this.wallet();
    const pick = (kind: string) => wallet.items.filter((i: any) => i.kind === kind);
    const decorate = (i: any) => {
      const src = ALL_ORIGINAL_ITEMS.find((o) => o.key === i.itemKey);
      return {
        ...i, level: src?.level ?? null, rate: src?.rate ?? null,
        property2: src?.property2 ?? null, fusionType: src?.fusionType ?? null,
        note: src?.note ?? null,
      };
    };
    return {
      wallet,
      rules: config.forge.rules,
      ruleSource: active ? config.forge.original.ruleSource : config.forge.ruleSource,
      ruleNote: active ? config.forge.original.note
        : '单机临时规则（LOCAL_RULE），与原版规则分开配置；不代表原版成功率与消耗。',
      /** 原版 StoreBag 槽位：0/1/2 强化石、3 神恩符、4 幸运符、5 待强化装备。 */
      slots: { strength: [0, 1, 2], god: 3, lucky: 4, equip: 5 },
      materials: {
        strengthStones: pick('strength-stone').map(decorate),
        luckyCharms: pick('lucky-charm').map(decorate),
        godCharms: pick('god-charm').map(decorate),
        /** 四圣兽合成石只做展示；强化消耗绝不接受这一类。 */
        composeStones: pick('compose-stone').map(decorate),
      },
      composeStoneNote: '四圣兽石（玄武/青龙/白虎/朱雀）原版 Property1=1，用途是合成加属性，不能作为强化材料；服务端强化只接受 Property1=2 的 Đá cường hóa 1~6。',
      levelTable: active ? STRENGTHEN_LEVELS : null,
      /** 原版链路未消耗金币：ItemStrengthenHandler 只调用 StoreBag.ClearBag()。 */
      originalNoCoinCost: active,
      /** 界面明确显示当前采用哪套规则、哪些机制未还原。 */
      activeRuleLabel: active ? '原版核心链路（ORIGINAL_PARTIAL，未还原完成）' : '单机临时规则（LOCAL_RULE）',
      attackGrowthSource: active ? 'LOCAL_RULE_SUPPLEMENT（原版属性成长未还原）' : 'LOCAL_RULE',
      mechanics: active ? ORIGINAL_RULE_TRACE : [],
      notPorted: active ? ORIGINAL_RULE_TRACE.filter((r) => r.status !== 'PORTED').map((r) => `${r.item}(${r.status})`) : [],
      weaponMappingStatus: 'UNCONFIRMED（上游无中文「极」命名，中文品质映射待确认；正常奖励池不发放）',
      weapons: this.weaponRows().map((w: any) => {
        const level = Number(w.level);
        const localCost = this.forgeCost(level);
        // 满级时不再查等级表，避免 originalRuleFor 抛 max-level 影响房间渲染。
        const orig = active && level < maxLevel ? this.originalRuleFor(level, [], null) : null;
        return {
          id: w.id, weaponId: w.weapon_id, label: w.label,
          level, attack: Number(w.attack), equipped: Number(w.equipped) === 1,
          variant: w.variant || 'normal', templateId: w.template_id ?? null,
          baseWeaponId: w.base_weapon_id ?? null,
          ruleVersion: w.rule_version || 'LOCAL_RULE',
          templateLevel: Number(w.template_level ?? 2),
          maxLevel,
          cost: active
            ? {
                coins: 0, requiredUnits: 3, requiredStrengthStones: 3,
                rock: orig?.rock ?? null, stoneLevelMin: orig?.stoneLevelMin ?? null,
                nextAttack: Number(w.attack) + config.forge.original.attackPerLevel,
                /** 无材料时的基准值；实际概率随所选 1~3 颗强化石与幸运符变化。 */
                successRate: 0,
                note: '原版成功率 = (Σ RateItems + 幸运符加成) / Rock，由放入槽位的材料决定',
              }
            : localCost,
          canStrengthen: level < maxLevel,
        };
      }),
    };
  }

  // ---------------------------------------------------------------- 房间写操作

  setMap(mapIdRaw: unknown): any {
    const mapId = String(mapIdRaw ?? '');
    if (!isKnownMap(mapId)) throw new ApiError(400, 'unknown-map', '地图不在已检出的地图目录中');
    const room = this.room();
    if (room.status === 'battle') throw new ApiError(409, 'battle-active', '战斗中不能切换地图');
    transaction(this.db, () => {
      run(this.db, 'UPDATE rooms SET map_id = ?, updated_at = ? WHERE player_id = ?', mapId, nowMs(), config.playerId);
    });
    this.emit('room', this.room());
    return this.room();
  }

  equipWeapon(idRaw: unknown): any {
    const id = String(idRaw ?? '');
    const row = one(this.db,
      'SELECT id FROM weapon_instances WHERE id = ? AND player_id = ?', id, config.playerId);
    if (!row) throw new ApiError(404, 'weapon-not-owned', '武器不属于当前玩家');
    const room = this.room();
    if (room.status === 'battle') throw new ApiError(409, 'battle-active', '战斗中不能更换武器，本局属性已冻结');
    transaction(this.db, () => {
      run(this.db, 'UPDATE weapon_instances SET equipped = 0 WHERE player_id = ?', config.playerId);
      run(this.db, 'UPDATE weapon_instances SET equipped = 1, updated_at = ? WHERE id = ?', nowMs(), id);
      run(this.db, 'UPDATE rooms SET weapon_instance_id = ?, updated_at = ? WHERE player_id = ?', id, nowMs(), config.playerId);
    });
    this.emit('room', this.room());
    return this.room();
  }

  // ---------------------------------------------------------------- 战斗生命周期

  /** 开局：冻结本局武器属性，写入战斗记录。返回给 BattleSession 的初始化参数。 */
  startBattle(): any {
    return transaction(this.db, () => {
      const current = one(this.db,
        'SELECT id, status, active_battle_id, map_id FROM rooms WHERE player_id = ?', config.playerId) as any;
      if (current.status === 'battle' && current.active_battle_id) {
        const existing = one(this.db, 'SELECT * FROM battles WHERE id = ?', current.active_battle_id) as any;
        if (existing && existing.status === 'active') {
          return {
            battleId: existing.id, mapId: existing.map_id, weaponId: existing.weapon_id,
            weaponLevel: Number(existing.weapon_level), weaponAttack: Number(existing.weapon_attack),
            botAttack: Number(existing.bot_attack), seed: Number(existing.seed), resumed: true,
            weaponLabel: null, variant: existing.variant || 'normal',
          };
        }
      }
      const w = this.equippedWeapon();
      // 极武器实例用 base_weapon_id 复用经典武器弹道；攻击力取实例自身属性。
      const ballisticsId = this.ballisticsId(w);
      const battleId = newId('battle');
      const seed = randomInt(1, 0x7fffffff);
      const botAttack = Math.round(BASE_ATTACK * config.bot.attackScale);
      const t = nowMs();
      run(this.db,
        `INSERT INTO battles
         (id, player_id, room_id, map_id, weapon_id, weapon_level, weapon_attack, bot_attack,
          seed, status, started_at, weapon_instance_id, variant)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        battleId, config.playerId, current.id, current.map_id, ballisticsId,
        Number(w.level), Number(w.attack), botAttack, seed, t,
        w.id, w.variant || 'normal');
      run(this.db,
        `UPDATE rooms SET status = 'battle', active_battle_id = ?, updated_at = ? WHERE player_id = ?`,
        battleId, t, config.playerId);
      return {
        battleId, mapId: current.map_id, weaponId: ballisticsId,
        weaponLevel: Number(w.level), weaponAttack: Number(w.attack),
        botAttack, seed, resumed: false,
        weaponLabel: w.label, variant: w.variant || 'normal',
      };
    });
  }

  /** 结算：胜负由服务端判定后创建奖励盘（同一事务）。 */
  finishBattle(battleId: string, winner: number, stats: any): any {
    return transaction(this.db, () => {
      const battle = one(this.db, 'SELECT * FROM battles WHERE id = ?', battleId) as any;
      if (!battle) throw new ApiError(404, 'battle-not-found', '战斗记录不存在');
      if (battle.status === 'finished') {
        const board = one(this.db, 'SELECT * FROM reward_boards WHERE battle_id = ?', battleId) as any;
        return { alreadyFinished: true, boardId: board?.id ?? null };
      }
      const won = winner === 0;
      const t = nowMs();
      run(this.db,
        `UPDATE battles SET status = 'finished', result = ?, winner = ?, stats_json = ?, ended_at = ?
         WHERE id = ?`,
        won ? 'win' : 'lose', winner, JSON.stringify(stats || {}), t, battleId);
      const cards = buildRewardCards(Number(battle.seed), won);
      const boardId = newId('board');
      run(this.db,
        `INSERT INTO reward_boards
         (id, battle_id, player_id, cards_json, max_picks, picks_used, status, created_at, updated_at,
          pool_mode, pool_note, pool_version, rules_version)
         VALUES (?, ?, ?, ?, ?, 0, 'open', ?, ?, ?, ?, ?, ?)`,
        boardId, battleId, config.playerId, JSON.stringify(cards), config.rewards.maxPicks, t, t,
        config.rewards.poolMode,
        config.rewards.poolMode === 'test' ? config.rewards.testPoolNote : null,
        config.rewards.poolVersion,
        `forge=${config.forge.rules}/${config.forge.rules === 'original' ? config.forge.original.ruleSource : config.forge.ruleSource}`);
      run(this.db, `UPDATE rooms SET status = 'result', updated_at = ? WHERE player_id = ?`, t, config.playerId);
      return {
        alreadyFinished: false, boardId, battleId, result: won ? 'win' : 'lose',
        maxPicks: config.rewards.maxPicks,
      };
    });
  }

  /** 返回房间 / 放弃未结束的战斗；已结算的奖励盘原样保留。 */
  leaveBattle(): any {
    return transaction(this.db, () => {
      const room = one(this.db, 'SELECT active_battle_id, status FROM rooms WHERE player_id = ?', config.playerId) as any;
      if (room?.active_battle_id) {
        run(this.db, `UPDATE battles SET status = 'abandoned', ended_at = ? WHERE id = ? AND status = 'active'`,
          nowMs(), room.active_battle_id);
      }
      run(this.db,
        `UPDATE rooms SET status = 'idle', active_battle_id = NULL, updated_at = ? WHERE player_id = ?`,
        nowMs(), config.playerId);
      return this.room();
    });
  }

  activeBattle(): any | null {
    return one(this.db,
      `SELECT * FROM battles WHERE player_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1`,
      config.playerId) ?? null;
  }

  // ---------------------------------------------------------------- 翻牌奖励

  rewardBoard(battleId: string): any {
    const board = one(this.db, 'SELECT * FROM reward_boards WHERE battle_id = ?', battleId) as any;
    if (!board) throw new ApiError(404, 'board-not-found', '奖励盘不存在');
    if (board.player_id !== config.playerId) throw new ApiError(403, 'not-owner', '奖励盘不属于当前玩家');
    const picks = all(this.db,
      'SELECT card_index, result_json FROM reward_picks WHERE board_id = ? ORDER BY card_index', board.id);
    const revealed = new Map<number, any>();
    for (const p of picks as any[]) {
      try { revealed.set(Number(p.card_index), JSON.parse(p.result_json)); } catch { /* skip corrupt row */ }
    }
    let cards: RewardCard[] = [];
    try { cards = JSON.parse(board.cards_json); } catch { /* keep empty */ }
    return {
      battleId,
      maxPicks: Number(board.max_picks),
      picksUsed: Number(board.picks_used),
      status: board.status,
      /** 生成时的配置版本；旧盘保持原值，读取时绝不重新抽取 cards_json。 */
      poolVersion: board.pool_version || 'legacy-v1',
      rulesVersion: board.rules_version || 'legacy-v1',
      poolMode: board.pool_mode || 'normal',
      poolNote: board.pool_note ?? null,
      cards: cards.map((card, index) => {
        const hit = revealed.get(index);
        return {
          index,
          revealed: !!hit,
          reward: hit ? hit.reward : null,
        };
      }),
      wallet: this.wallet(),
    };
  }

  /**
   * 领取一张卡。事务内验证归属 / 次数 / 卡片状态，发奖并标记领取。
   * 同一 requestId 重试返回完全相同的已存结果；同一张卡不能重复领。
   */
  claimCard(args: { battleId: string; cardIndex: unknown; requestId: unknown }): any {
    const battleId = String(args.battleId || '');
    const cardIndex = clampInt(args.cardIndex, 0, 999, -1);
    const requestId = String(args.requestId || '').trim();
    if (!requestId || requestId.length > 200) throw new ApiError(400, 'bad-request-id', 'requestId 缺失或过长');
    if (cardIndex < 0 || cardIndex >= config.rewards.cards) throw new ApiError(400, 'bad-card-index', '卡片序号无效');

    const result = transaction(this.db, () => {
      // 1) 重放：同一请求直接返回第一次持久化的结果
      const replay = one(this.db, 'SELECT * FROM reward_picks WHERE request_id = ?', requestId) as any;
      if (replay) {
        if (replay.board_id !== this.boardIdForBattle(battleId)
          || Number(replay.card_index) !== cardIndex) {
          throw new ApiError(409, 'request-id-reused', 'requestId 已用于另一张奖励卡');
        }
        try { return JSON.parse(replay.result_json); } catch { throw new ApiError(500, 'bad-stored-result', '领取记录损坏'); }
      }

      const board = one(this.db, 'SELECT * FROM reward_boards WHERE battle_id = ?', battleId) as any;
      if (!board) throw new ApiError(404, 'board-not-found', '奖励盘不存在');
      if (board.player_id !== config.playerId) throw new ApiError(403, 'not-owner', '奖励盘不属于当前玩家');
      if (board.status !== 'open') throw new ApiError(409, 'board-closed', '本局翻牌已结束');
      if (Number(board.picks_used) >= Number(board.max_picks)) throw new ApiError(409, 'no-picks-left', '本局翻牌次数已用完');

      const duplicate = one(this.db,
        'SELECT id FROM reward_picks WHERE board_id = ? AND card_index = ?', board.id, cardIndex);
      if (duplicate) throw new ApiError(409, 'card-already-picked', '这张卡已经翻开过了');

      let cards: RewardCard[] = [];
      try { cards = JSON.parse(board.cards_json); } catch { throw new ApiError(500, 'bad-board', '奖励盘数据损坏'); }
      const card = cards[cardIndex];
      if (!card) throw new ApiError(400, 'bad-card-index', '卡片序号无效');

      const reward = this.applyReward(card, {
        boardId: board.id, battleId, cardIndex, requestId,
      });
      const picksUsed = Number(board.picks_used) + 1;
      const status = picksUsed >= Number(board.max_picks) ? 'closed' : 'open';
      const payload = {
        ok: true, battleId, cardIndex, requestId, reward,
        picksUsed, maxPicks: Number(board.max_picks), status,
        wallet: this.wallet(),
      };
      // UNIQUE(board_id, card_index) + UNIQUE(request_id) 作为最后一道防线
      run(this.db,
        `INSERT INTO reward_picks (id, board_id, card_index, request_id, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        newId('pick'), board.id, cardIndex, requestId, JSON.stringify(payload), nowMs());
      run(this.db,
        `UPDATE reward_boards SET picks_used = ?, status = ?, updated_at = ? WHERE id = ?`,
        picksUsed, status, nowMs(), board.id);
      return payload;
    });

    this.emit('wallet', result.wallet);
    this.emit('reward_board', this.rewardBoard(battleId));
    if (result.status === 'closed') this.emit('room', this.room());
    return result;
  }

  private boardIdForBattle(battleId: string): string | null {
    const row = one<{ id: string }>(this.db, 'SELECT id FROM reward_boards WHERE battle_id = ?', battleId);
    return row?.id ?? null;
  }

  /** 只接受服务端自己生成的卡片内容，前端无法指定金额、物品或武器。 */
  private applyReward(
    card: RewardCard,
    ctx: { boardId: string; battleId: string; cardIndex: number; requestId: string },
  ): any {
    const t = nowMs();
    if (card.kind === 'coin') {
      const amount = Math.max(0, Math.trunc(card.amount));
      run(this.db, 'UPDATE players SET coins = coins + ?, updated_at = ? WHERE id = ?', amount, t, config.playerId);
      return { kind: 'coin', amount, label: '金币', icon: 'assets/ui/icon-gold.png' };
    }
    if (card.kind === 'weapon') {
      const ext = highQualityWeaponByKey(String(card.weaponKey || ''));
      if (!ext) throw new ApiError(500, 'unknown-weapon-template', '高阶品质武器候选模板未登记');
      const icon = `assets/items/extreme-${ext.baseWeaponId}.png`;
      const label = `${ext.nameSource}（中文品质映射待确认）`;
      // 防重第一层：同一 requestId 或同一卡位已发放过，直接返回既有实例，不新建。
      // 与 claimCard 的事务同一连接；重复请求返回完全相同的 weaponInstanceId。
      const prior = one(this.db,
        `SELECT * FROM weapon_grants WHERE request_id = ? OR (battle_id = ? AND card_index = ?)`,
        ctx.requestId, ctx.battleId, ctx.cardIndex) as any;
      if (prior) {
        if (prior.weapon_key !== ext.key
          || prior.battle_id !== ctx.battleId
          || Number(prior.card_index) !== ctx.cardIndex) {
          throw new ApiError(409, 'request-id-reused', 'requestId 已用于另一张奖励卡');
        }
        const inst = one(this.db, 'SELECT * FROM weapon_instances WHERE id = ?', prior.weapon_instance_id) as any;
        return {
          kind: 'weapon', amount: 1, weaponKey: ext.key, label: inst?.label ?? label,
          nameSource: ext.nameSource, mappingStatus: ext.mappingStatus,
          mappingNote: ext.mappingNote, icon, templateId: ext.templateId,
          weaponInstanceId: prior.weapon_instance_id,
          attack: Number(inst?.attack ?? ext.attack), baseWeaponId: ext.baseWeaponId,
          variant: 'candidate', deduplicated: true,
        };
      }
      const seq = Number((one(this.db,
        'SELECT COUNT(*) AS n FROM weapon_grants WHERE player_id = ?', config.playerId) as any)?.n ?? 0) + 1;
      const instanceId = newId('wi');
      // 每个候选都是独立实例（weapon_id 带序号），可分别装备 / 强化；
      // template_level=3 对应上游 7006..7014 的 Template.Level，决定失败分支。
      run(this.db,
        `INSERT INTO weapon_instances
         (id, player_id, weapon_id, label, level, attack, version, equipped,
          created_at, updated_at, template_id, base_weapon_id, variant, rule_version, template_level)
         VALUES (?, ?, ?, ?, 0, ?, 0, 0, ?, ?, ?, ?, 'candidate', 'LOCAL_RULE', 3)`,
        instanceId, config.playerId, `${ext.key}#${seq}`, label,
        ext.attack, t, t, ext.templateId, ext.baseWeaponId);
      // 防重第二层：UNIQUE(request_id) + UNIQUE(battle_id, card_index)
      run(this.db,
        `INSERT INTO weapon_grants
         (id, player_id, battle_id, card_index, request_id, weapon_key, weapon_instance_id,
          mapping_status, pool_mode, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId('grant'), config.playerId, ctx.battleId, ctx.cardIndex, ctx.requestId,
        ext.key, instanceId, ext.mappingStatus, config.rewards.poolMode, t);
      return {
        kind: 'weapon', amount: 1, weaponKey: ext.key, label,
        nameSource: ext.nameSource, mappingStatus: ext.mappingStatus,
        mappingNote: ext.mappingNote, icon, templateId: ext.templateId,
        weaponInstanceId: instanceId,
        attack: ext.attack, baseWeaponId: ext.baseWeaponId,
        variant: 'candidate', deduplicated: false,
      };
    }
    const itemKey = String(card.itemKey || '');
    const item = one(this.db, 'SELECT * FROM item_catalog WHERE item_key = ?', itemKey) as any;
    if (!item) throw new ApiError(500, 'unknown-item', '奖励物品未登记');
    const amount = Math.max(1, Math.trunc(card.amount));
    run(this.db,
      `INSERT INTO inventory (player_id, item_key, quantity) VALUES (?, ?, ?)
       ON CONFLICT(player_id, item_key) DO UPDATE SET quantity = quantity + excluded.quantity`,
      config.playerId, itemKey, amount);
    return {
      kind: 'item', amount, itemKey,
      label: item.name_zh, icon: item.icon, templateId: item.template_id,
    };
  }

  // ---------------------------------------------------------------- 铁匠铺

  /**
   * 强化：单个事务内完成
   * 验证归属 -> 版本/上限 -> 金币与材料 -> 计算结果 -> 扣费扣料 -> 更新武器 -> 操作记录 -> 提交。
   * requestId 防重放；version 条件更新防并发重复消费。
   */
  strengthen(args: {
    weaponInstanceId: unknown;
    requestId: unknown;
    /** LOCAL_RULE 兼容字段：指定一种强化石自动折算单位。原版规则下忽略。 */
    itemKey?: unknown;
    /** 原版槽位 0/1/2：1~3 种不同的强化石 key。省略时服务端自动挑选。 */
    slots?: unknown;
    luckyCharm?: unknown;
    godCharm?: unknown;
  }): any {
    const weaponInstanceId = String(args.weaponInstanceId || '');
    const requestId = String(args.requestId || '').trim();
    if (!requestId || requestId.length > 200) throw new ApiError(400, 'bad-request-id', 'requestId 缺失或过长');
    const requestedItem = args.itemKey ? String(args.itemKey) : '';
    const requestedSlots = Array.isArray(args.slots)
      ? args.slots.map((k) => String(k)).filter(Boolean).slice(0, 3)
      : [];
    const luckyKey = args.luckyCharm ? String(args.luckyCharm) : '';
    const godKey = args.godCharm ? String(args.godCharm) : '';

    const result = transaction(this.db, () => {
      const replay = one(this.db, 'SELECT result_json FROM forge_operations WHERE request_id = ?', requestId) as any;
      if (replay) {
        try { return JSON.parse(replay.result_json); } catch { throw new ApiError(500, 'bad-stored-result', '强化记录损坏'); }
      }

      const weapon = one(this.db, 'SELECT * FROM weapon_instances WHERE id = ?', weaponInstanceId) as any;
      if (!weapon || weapon.player_id !== config.playerId) throw new ApiError(404, 'weapon-not-owned', '武器不属于当前玩家');
      const level = Number(weapon.level);
      const version = Number(weapon.version);
      const active = config.forge.rules === 'original';
      const maxLevel = active ? config.forge.original.maxLevel : config.forge.maxLevel;
      if (level >= maxLevel) throw new ApiError(409, 'max-level', '武器已达当前规则强化上限');

      // 只接受 Property1=2 的强化石；四圣兽合成石（compose-stone）在任何规则下都不可用。
      const materials = all(this.db,
        `SELECT c.item_key, c.name_zh, c.icon, c.unit_value, c.kind, COALESCE(i.quantity, 0) AS quantity
         FROM item_catalog c LEFT JOIN inventory i
           ON i.item_key = c.item_key AND i.player_id = ?
         WHERE c.kind = 'strength-stone' ORDER BY c.unit_value`, config.playerId) as any[];
      const stock = new Map<string, any>(materials.map((m) => [m.item_key, m]));
      const itemByKey = (key: string, kind: string, label: string) => {
        const row = one(this.db,
          `SELECT c.item_key, c.name_zh, c.kind, COALESCE(i.quantity, 0) AS quantity
           FROM item_catalog c LEFT JOIN inventory i
             ON i.item_key = c.item_key AND i.player_id = ?
           WHERE c.item_key = ?`, config.playerId, key) as any;
        if (!row || row.kind !== kind || Number(row.quantity) < 1) {
          throw new ApiError(409, 'not-enough-materials', `${label}不足或物品类别不正确`);
        }
        return row;
      };

      const consumed: Array<{ itemKey: string; name: string; quantity: number }> = [];
      let coins = 0;
      let successRate = 0;
      let ruleSource = config.forge.ruleSource;
      let originalDetail: any = null;
      let costPayload: any;
      let success: boolean;
      let nextLevel: number;

      // 结果种子由 requestId + 版本 + 等级派生，服务端计算，前端无法指定。
      const hash = [...requestId].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);
      const roll = forgeRoll(hash ^ version ^ level);
      /** 旧 LOCAL_RULE 装备的 Template.Level=2；高阶候选=3（见 003 迁移）。 */
      const templateLevel = Number(weapon.template_level ?? 2);

      if (active) {
        // ---- 原版链路：三个强化石槽 + 幸运符(4) + 神恩符(3) ----
        let stoneKeys = requestedSlots;
        if (stoneKeys.length === 0) {
          stoneKeys = materials
            .filter((m) => Number(m.quantity) > 0)
            .sort((a, b) => Number(b.unit_value) - Number(a.unit_value))
            .slice(0, 3).map((m) => m.item_key);
        }
        if (stoneKeys.length === 0) throw new ApiError(409, 'not-enough-materials', '至少需要 1 颗原版强化石');
        if (new Set(stoneKeys).size !== stoneKeys.length) {
          throw new ApiError(400, 'duplicate-stone-slot', '三个强化石槽必须使用互不相同的物品');
        }
        for (const key of stoneKeys) {
          const row = itemByKey(key, 'strength-stone', '强化石');
          consumed.push({ itemKey: key, name: row.name_zh, quantity: 1 });
        }
        if (luckyKey) {
          const row = itemByKey(luckyKey, 'lucky-charm', '幸运符');
          consumed.push({ itemKey: luckyKey, name: row.name_zh, quantity: 1 });
        }
        if (godKey) {
          const row = itemByKey(godKey, 'god-charm', '神恩符');
          consumed.push({ itemKey: godKey, name: row.name_zh, quantity: 1 });
        }
        const rule = this.originalRuleFor(level, stoneKeys, luckyKey || null);
        successRate = rule.successRate;
        success = roll < successRate;
        /**
         * 失败分支逐项对应 ItemStrengthenHandler.cs:154-181：
         *   isGod=true            → 原样放回槽 5，不降级、不损毁
         *   Template.Level == 3   → StrengthenLevel>=5 时降 1 级；<5 保持
         *   Template.Level != 3   → item.Count--（销毁装备）
         * 单机存档不销毁玩家装备，故「销毁」与「失败回退模板」均标记 NOT_PORTED。
         */
        const godProtected = !!godKey;
        const wouldDestroy = !godProtected && templateLevel !== 3;
        const downgrade = !godProtected && templateLevel === 3 && level >= 5;
        nextLevel = success ? level + 1 : (downgrade ? level - 1 : level);
        ruleSource = config.forge.original.ruleSource;
        originalDetail = {
          probability: rule.probability, rock: rule.rock,
          luckyContribution: rule.luckyContribution, stoneLevelMin: rule.stoneLevelMin,
          probabilityFormula: 'successRate = (probability + luckyContribution) / Rock',
          stones: stoneKeys, luckyCharm: luckyKey || null, godCharm: godKey || null,
          templateLevel,
          failureBranch: {
            source: 'ItemStrengthenHandler.cs:154-181',
            godProtected, downgrade, wouldDestroy,
            applied: godProtected ? 'protected-by-god-charm（原样放回）'
              : templateLevel === 3 ? (downgrade ? 'level-1' : 'level-unchanged(<5)')
                : 'NOT_PORTED: 原版会 item.Count-- 销毁装备，单机存档不销毁',
          },
          attackGrowth: {
            status: 'LOCAL_RULE_SUPPLEMENT',
            originalGrowthResolved: ORIGINAL_CONSTANTS.weaponAttackGrowth !== null,
            source: 'config.forge.attackPerLevel',
            note: '原版武器属性成长公式未还原（ORIGINAL_CONSTANTS.weaponAttackGrowth=null）；此处为单机补充，不代表原版数值',
            perLevel: config.forge.original.attackPerLevel,
          },
          mechanics: ORIGINAL_RULE_TRACE,
          notPorted: ORIGINAL_RULE_TRACE.filter((r) => r.status !== 'PORTED').map((r) => `${r.item}(${r.status})`),
        };
        costPayload = {
          coins: 0, note: '原版 ItemStrengthenHandler 不扣金币；只由 StoreBag.ClearBag() 消耗槽位物品',
          items: consumed, requiredUnits: consumed.length,
        };
      } else {
        // ---- LOCAL_RULE：保留原有单机闭环（金币 + 按单位值折算一种强化石）----
        const cost = this.forgeCost(level);
        const player = one<{ coins: number }>(this.db, 'SELECT coins FROM players WHERE id = ?', config.playerId);
        if (Number(player?.coins ?? 0) < cost.coins) throw new ApiError(409, 'not-enough-coins', `金币不足，需要 ${cost.coins}`);
        const candidates = requestedItem
          ? materials.filter((m) => m.item_key === requestedItem)
          : materials.filter((m) => Number(m.quantity) > 0);
        let chosen: any = null;
        let need = 0;
        for (const m of candidates) {
          const required = Math.ceil(cost.requiredUnits / Number(m.unit_value));
          if (Number(m.quantity) >= required) { chosen = m; need = required; break; }
        }
        if (!chosen) throw new ApiError(409, 'not-enough-materials', `强化石不足，需要 ${cost.requiredUnits} 点材料单位`);
        coins = cost.coins;
        successRate = cost.successRate;
        success = roll < successRate;
        nextLevel = success ? level + 1 : level;
        consumed.push({ itemKey: chosen.item_key, name: chosen.name_zh, quantity: need });
        costPayload = {
          coins, requiredUnits: cost.requiredUnits,
          itemKey: chosen.item_key, itemName: chosen.name_zh, itemQuantity: need,
          items: consumed,
        };
      }

      /**
       * 属性转换：以「实例当前 attack + 等级差 × 每级点数」推进，
       * 不按旧等级重算整条曲线，避免迁移后再次叠加加成。
       * 两套规则当前都用 LOCAL_ATTACK_PER_LEVEL；original 分支已在 originalDetail
       * 明确标注这是 LOCAL_RULE_SUPPLEMENT，原版属性成长未还原。
       */
      const attackPerLevel = active ? config.forge.original.attackPerLevel : config.forge.attackPerLevel;
      const nextAttack = Math.max(1, Number(weapon.attack) + (nextLevel - level) * attackPerLevel);
      const t = nowMs();
      if (coins > 0) run(this.db, 'UPDATE players SET coins = coins - ?, updated_at = ? WHERE id = ?', coins, t, config.playerId);
      for (const c of consumed) {
        const changed = this.db.prepare(
          `UPDATE inventory SET quantity = quantity - ?
           WHERE player_id = ? AND item_key = ? AND quantity >= ?`,
        ).run(c.quantity, config.playerId, c.itemKey, c.quantity);
        if (Number(changed.changes) !== 1) throw new ApiError(409, 'not-enough-materials', `${c.name}库存不足`);
      }
      const updated = this.db.prepare(
        `UPDATE weapon_instances SET level = ?, attack = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND player_id = ? AND version = ?`,
      ).run(nextLevel, nextAttack, t, weaponInstanceId, config.playerId, version);
      if (Number(updated.changes) !== 1) throw new ApiError(409, 'weapon-version-conflict', '武器已被其他操作更新，请重试');

      const payload = {
        ok: true, requestId, success,
        weapon: {
          id: weaponInstanceId, weaponId: weapon.weapon_id, label: weapon.label,
          levelBefore: level, levelAfter: nextLevel,
          attackBefore: Number(weapon.attack), attackAfter: nextAttack,
          version: version + 1,
        },
        cost: costPayload,
        successRate,
        ruleSource,
        /** 旧存档武器保留其规则版本，不因当前全局规则切换而被重新解释。 */
        weaponRuleVersion: String(weapon.rule_version || 'LOCAL_RULE'),
        attackGrowthSource: active ? 'LOCAL_RULE_SUPPLEMENT（原版属性成长未还原）' : 'LOCAL_RULE',
        originalDetail,
        wallet: this.wallet(),
      };
      run(this.db,
        `INSERT INTO forge_operations
         (id, player_id, weapon_instance_id, request_id, level_before, level_after,
          success, coins_cost, items_json, result_json, created_at, rule_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId('forge'), config.playerId, weaponInstanceId, requestId,
        level, nextLevel, success ? 1 : 0, coins,
        JSON.stringify(consumed), JSON.stringify(payload), t, ruleSource);
      return payload;
    });

    this.emit('wallet', result.wallet);
    this.emit('forge', this.forge());
    this.emit('room', this.room());
    return result;
  }
}

/**
 * 用单局种子生成 3x3 卡面内容；只存服务端，未翻卡不下发内容。
 *
 * 奖励盘设计（LOCAL_RULE，已明确标注）：
 *  - 保底只约束「盘面内容构成」：至少 guaranteedItemCards 张真强化石卡；
 *  - 9 张卡（测试池含 1 张武器候选卡）整体 Fisher-Yates 洗牌后落位；
 *  - **没有固定卡位**，也不按领取次序派发，玩家点固定位置不会必得固定奖励；
 *  - 正常池不含武器候选卡；仅 test 池强制 1 张用于发放防重验证。
 * 生成后写入 reward_boards.cards_json 并附 pool_version，旧盘永不重抽。
 */
export function buildRewardCards(seed: number, won: boolean): RewardCard[] {
  const rng = seededRng(seed ^ 0x52455741);
  const spec = won ? config.rewards.win : config.rewards.lose;
  const testPool = config.rewards.poolMode === 'test';
  const cards: RewardCard[] = [];

  // 正常奖励池**不含**高阶品质武器候选：上游无中文「极」命名，中文品质映射待确认，
  // 按验收要求不把推测武器加入正常掉落（config.rewards.extremeChance 固定为 0）。
  // 仅独立测试池强制 1 张，用于验证「翻出 -> 独立实例 -> 永久入库 -> 防重」链路；
  // 明确是测试配置，不代表任何官方概率，也不改变正常掉落规则。
  if (testPool) {
    const ext = HIGH_QUALITY_WEAPONS[randInt(rng, 0, HIGH_QUALITY_WEAPONS.length - 1)];
    cards.push({ kind: 'weapon', weaponKey: ext.key, amount: 1 });
  }

  const randomItemCard = (): RewardCard => ({
    kind: 'item',
    itemKey: config.rewards.stoneItemKeys[randInt(rng, 0, config.rewards.stoneItemKeys.length - 1)],
    amount: randInt(rng, spec.stoneAmount[0], spec.stoneAmount[1]),
  });
  while (cards.length < config.rewards.cards) {
    if (rng() < config.rewards.stoneChance) cards.push(randomItemCard());
    else cards.push({ kind: 'coin', amount: randInt(rng, spec.coins[0], spec.coins[1]) });
  }

  // 保证材料卡下限，避免随机性导致「翻完牌却没有强化石」的闭环断点。
  let itemCards = cards.filter((c) => c.kind === 'item').length;
  for (let i = 0; i < cards.length && itemCards < config.rewards.guaranteedItemCards; i += 1) {
    if (cards[i].kind === 'coin') { cards[i] = randomItemCard(); itemCards += 1; }
  }

  // 全部卡（含极武器）整体洗牌；同一局种子可复现。
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = randInt(rng, 0, i);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
