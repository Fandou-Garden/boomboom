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
  ALL_ORIGINAL_ITEMS, HIGH_QUALITY_WEAPONS, STRENGTH_STONES,
  highQualityWeaponByKey, type OriginalItem,
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
           (id, player_id, weapon_id, label, level, attack, attack_precise, base_attack,
            version, equipped, created_at, updated_at, rule_version)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0, 0, ?, ?, ?)`,
          `wi_${config.playerId}_${weaponId}`, config.playerId, weaponId, weaponLabel(weaponId),
          BASE_ATTACK, BASE_ATTACK, BASE_ATTACK, t, t, config.forge.ruleSource);
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
      `SELECT id, weapon_id, label, level, attack, attack_precise, base_attack,
              version, equipped, template_id, base_weapon_id, variant,
              rule_version, template_level
       FROM weapon_instances WHERE player_id = ? ORDER BY weapon_id`, config.playerId);
  }

  /** 极武器用 base_weapon_id 复用经典武器的弹道 / 弹丸 / 爆炸表现。 */
  private ballisticsId(row: any): string {
    return String(row?.base_weapon_id || row?.weapon_id || 'fruit');
  }

  private equippedWeapon(): any {
    const row = one(this.db,
      `SELECT id, weapon_id, label, level, attack, attack_precise, base_attack,
              version, template_id, base_weapon_id, variant, rule_version
       FROM weapon_instances WHERE player_id = ? AND equipped = 1`, config.playerId);
    if (!row) throw new ApiError(500, 'no-equipped-weapon', '没有已装备的武器');
    return row;
  }

  /** 单机自定义强化规则：消耗与伤害预览，全部由服务端计算。 */
  private simpleForgeCost(level: number, baseAttack: number) {
    const f = config.forge;
    const targetLevel = level + f.levelGain;
    const nextPrecise = this.attackForLevel(baseAttack, targetLevel);
    return {
      targetLevel,
      coins: f.coinCostPerTargetLevel * targetLevel,
      stones: f.stonesPerAttempt,
      successRate: f.successRate,
      nextAttackPrecise: nextPrecise,
      nextAttack: Math.round(nextPrecise),
    };
  }

  /**
   * 最终武器基础伤害 = 未强化基础伤害 × (1 + 0.10 × 强化等级)。
   * 始终从 baseAttack 重算，绝不在已强化数值上叠乘；精度由调用方保留。
   */
  private attackForLevel(baseAttack: number, level: number): number {
    const base = Number.isFinite(Number(baseAttack)) && Number(baseAttack) > 0
      ? Number(baseAttack) : BASE_ATTACK;
    const precise = base * (1 + config.forge.attackMultiplierPerLevel * Math.max(0, level));
    // 保留 6 位小数精度，消除 100×1.1=110.00000000000001 这类 IEEE754 二进制尾差；
    // 战斗引擎内最终伤害取整仍沿用原有规则，这里只规整存档中的精确值。
    return Math.round(precise * 1e6) / 1e6;
  }

  /** 未强化基础伤害；004 迁移前的旧实例由迁移补齐 base_attack。 */
  private baseAttackOf(row: any): number {
    const b = Number(row?.base_attack);
    return Number.isFinite(b) && b > 0 ? b : BASE_ATTACK;
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
        attackPrecise: Number(w.attack_precise ?? w.attack),
        baseAttack: this.baseAttackOf(w),
        version: Number(w.version), equipped: Number(w.equipped) === 1,
        variant: w.variant || 'normal', templateId: w.template_id ?? null,
        baseWeaponId: w.base_weapon_id ?? null,
        ruleVersion: w.rule_version || config.forge.ruleSource,
        templateLevel: Number(w.template_level ?? 2),
        angleMin: WEAPON_DEFS[this.ballisticsId(w)]?.angleMin ?? null,
        angleMax: WEAPON_DEFS[this.ballisticsId(w)]?.angleMax ?? null,
      })),
      equipped: {
        id: equipped.id, weaponId: equipped.weapon_id, label: equipped.label,
        level: Number(equipped.level), attack: Number(equipped.attack),
        attackPrecise: Number(equipped.attack_precise ?? equipped.attack),
        baseAttack: this.baseAttackOf(equipped),
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
    /** 所有已确认的真强化石等级统一提供一次强化机会，按总库存计。 */
    const availableStones = pick('strength-stone')
      .reduce((n: number, i: any) => n + Number(i.quantity || 0), 0);
    const coinsNow = Number(wallet.coins);
    return {
      wallet,
      rules: config.forge.ruleSource,
      ruleSource: config.forge.ruleSource,
      ruleLabel: config.forge.ruleLabel,
      ruleNote: config.forge.note,
      /** 旧前端字段别名：统一指向同一套单机自定义规则。 */
      activeRuleLabel: config.forge.ruleLabel,
      attackGrowthSource: config.forge.ruleSource,
      notPorted: [],
      mechanics: [],
      levelTable: null,
      originalNoCoinCost: false,
      maxLevel: config.forge.maxLevel,
      stonesPerAttempt: config.forge.stonesPerAttempt,
      coinCostPerTargetLevel: config.forge.coinCostPerTargetLevel,
      successRate: config.forge.successRate,
      attackMultiplierPerLevel: config.forge.attackMultiplierPerLevel,
      damageFormula: '最终基础伤害 = 未强化基础伤害 × (1 + 0.10 × 强化等级)',
      /** 原版 StoreBag 六槽位；本轮只有 0 号强化石槽与 5 号装备槽启用。 */
      slots: {
        strength: [0], disabledStrength: [1, 2], god: 3, lucky: 4, equip: 5,
      },
      disabledSlotNote: '当前单机规则每次只需 1 颗强化石；其余强化石槽、幸运符槽、神恩符槽无需使用，已置灰。物品保留在背包中。',
      /** 供前端预览区直接显示不可强化的具体原因；最终判定仍以 strengthen() 为准。 */
      coinsNow,
      availableStones,
      materials: {
        strengthStones: pick('strength-stone').map(decorate),
        luckyCharms: pick('lucky-charm').map(decorate),
        godCharms: pick('god-charm').map(decorate),
        /** 四圣兽合成石只做展示；强化消耗绝不接受这一类。 */
        composeStones: pick('compose-stone').map(decorate),
      },
      composeStoneNote: '四圣兽石（玄武/青龙/白虎/朱雀）原版 Property1=1，用途是合成加属性，不能作为强化材料；服务端强化只接受 Property1=2 的 Đá cường hóa 1~6。',
      weaponNameStatus: '中文品质名称待核对（使用已核实的上游名称与属性，不编造模板/素材）',
      weapons: this.weaponRows().map((w: any) => {
        const level = Number(w.level);
        const baseAttack = this.baseAttackOf(w);
        const cost = this.simpleForgeCost(level, baseAttack);
        const atMax = level >= config.forge.maxLevel;
        const reason = atMax
          ? `已达 +${config.forge.maxLevel} 上限`
          : coinsNow < cost.coins
            ? `金币不足：需要 ${cost.coins}，当前 ${coinsNow}`
            : availableStones < config.forge.stonesPerAttempt
              ? `强化石不足：需要 ${config.forge.stonesPerAttempt} 颗真强化石，当前 ${availableStones}`
              : null;
        return {
          id: w.id, weaponId: w.weapon_id, label: w.label,
          level, attack: Number(w.attack),
          attackPrecise: Number(w.attack_precise ?? w.attack), baseAttack,
          equipped: Number(w.equipped) === 1,
          variant: w.variant || 'normal', templateId: w.template_id ?? null,
          baseWeaponId: w.base_weapon_id ?? null,
          ruleVersion: w.rule_version || config.forge.ruleSource,
          templateLevel: Number(w.template_level ?? 2),
          maxLevel: config.forge.maxLevel,
          cost: atMax ? {
            ...cost, coins: 0, stones: 0, successRate: 0,
            nextAttack: Number(w.attack), nextAttackPrecise: Number(w.attack_precise ?? w.attack),
          } : cost,
          /** atMax 用于禁用按钮；canStrengthen 是含金币/材料的综合可强化状态。 */
          atMax,
          canStrengthen: reason === null,
          reason,
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
            weaponLevel: Number(existing.weapon_level),
            weaponAttack: Number(existing.weapon_attack_precise ?? existing.weapon_attack),
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
         (id, player_id, room_id, map_id, weapon_id, weapon_level, weapon_attack,
          weapon_attack_precise, bot_attack, seed, status, started_at,
          weapon_instance_id, variant)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        battleId, config.playerId, current.id, current.map_id, ballisticsId,
        Number(w.level), Number(w.attack), Number(w.attack_precise ?? w.attack),
        botAttack, seed, t, w.id, w.variant || 'normal');
      run(this.db,
        `UPDATE rooms SET status = 'battle', active_battle_id = ?, updated_at = ? WHERE player_id = ?`,
        battleId, t, config.playerId);
      return {
        battleId, mapId: current.map_id, weaponId: ballisticsId,
        weaponLevel: Number(w.level), weaponAttack: Number(w.attack_precise ?? w.attack),
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
        `forge=${config.forge.ruleSource}`);
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
      if (!ext) throw new ApiError(500, 'unknown-weapon-template', '上游武器模板未登记');
      const icon = `assets/items/extreme-${ext.baseWeaponId}.png`;
      /** 使用已核实的上游真实名称与属性；中文品质名称待核对，不编造「极」字或素材。 */
      const label = `${ext.nameSource}（中文品质名称待核对）`;
      const weaponNameStatus = '中文品质名称待核对';
      // 防重第一层：同一 requestId 或同一卡位已发放过，直接返回既有实例，不新建。
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
          nameSource: ext.nameSource, weaponNameStatus, icon, templateId: ext.templateId,
          weaponInstanceId: prior.weapon_instance_id,
          attack: Number(inst?.attack ?? ext.attack),
          attackPrecise: Number(inst?.attack_precise ?? ext.attack),
          baseAttack: this.baseAttackOf(inst), baseWeaponId: ext.baseWeaponId,
          variant: 'candidate', deduplicated: true,
        };
      }
      const seq = Number((one(this.db,
        'SELECT COUNT(*) AS n FROM weapon_grants WHERE player_id = ?', config.playerId) as any)?.n ?? 0) + 1;
      const instanceId = newId('wi');
      // 独立武器实例：等级 / 基础伤害属于实例，不修改共享武器模板。
      run(this.db,
        `INSERT INTO weapon_instances
         (id, player_id, weapon_id, label, level, attack, attack_precise, base_attack,
          version, equipped, created_at, updated_at, template_id, base_weapon_id,
          variant, rule_version, template_level)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0, 0, ?, ?, ?, ?, 'candidate', ?, 3)`,
        instanceId, config.playerId, `${ext.key}#${seq}`, label,
        ext.attack, ext.attack, ext.attack, t, t,
        ext.templateId, ext.baseWeaponId, config.forge.ruleSource);
      // 防重第二层：UNIQUE(request_id) + UNIQUE(battle_id, card_index)
      run(this.db,
        `INSERT INTO weapon_grants
         (id, player_id, battle_id, card_index, request_id, weapon_key, weapon_instance_id,
          mapping_status, pool_mode, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId('grant'), config.playerId, ctx.battleId, ctx.cardIndex, ctx.requestId,
        ext.key, instanceId, 'NAME_PENDING_VERIFY', config.rewards.poolMode, t);
      return {
        kind: 'weapon', amount: 1, weaponKey: ext.key, label,
        nameSource: ext.nameSource, weaponNameStatus, icon, templateId: ext.templateId,
        weaponInstanceId: instanceId, attack: ext.attack,
        attackPrecise: ext.attack, baseAttack: ext.attack,
        baseWeaponId: ext.baseWeaponId, variant: 'candidate', deduplicated: false,
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
   * 强化（单机自定义规则）：单个事务内完成
   * 验证归属 -> 版本/上限 -> 金币与材料 -> 计算属性 -> 扣费扣料 -> 更新武器 -> 操作记录 -> 提交。
   * requestId 防重放；version 条件更新防并发重复扣费；前端不能提交结果。
   */
  strengthen(args: {
    weaponInstanceId: unknown;
    requestId: unknown;
    /** 选中的 1 颗真强化石；省略时服务端自动挑选库存中的真强化石。 */
    itemKey?: unknown;
  }): any {
    const weaponInstanceId = String(args.weaponInstanceId || '');
    const requestId = String(args.requestId || '').trim();
    if (!requestId || requestId.length > 200) throw new ApiError(400, 'bad-request-id', 'requestId 缺失或过长');
    const requestedItem = args.itemKey ? String(args.itemKey) : '';

    const result = transaction(this.db, () => {
      // 重放：同一 requestId 必须绑定同一把武器，不能拿旧结果套用到另一件实例上。
      const replay = one(this.db,
        'SELECT weapon_instance_id, result_json FROM forge_operations WHERE request_id = ?', requestId) as any;
      if (replay) {
        if (replay.weapon_instance_id !== weaponInstanceId) {
          throw new ApiError(409, 'request-id-reused', 'requestId 已用于另一把武器');
        }
        try { return JSON.parse(replay.result_json); } catch { throw new ApiError(500, 'bad-stored-result', '强化记录损坏'); }
      }
      const weapon = one(this.db, 'SELECT * FROM weapon_instances WHERE id = ?', weaponInstanceId) as any;
      if (!weapon || weapon.player_id !== config.playerId) throw new ApiError(404, 'weapon-not-owned', '武器不属于当前玩家');
      const level = Number(weapon.level);
      const version = Number(weapon.version);
      if (level >= config.forge.maxLevel) {
        throw new ApiError(409, 'max-level', `武器已达 +${config.forge.maxLevel} 强化上限`);
      }
      const baseAttack = this.baseAttackOf(weapon);
      const cost = this.simpleForgeCost(level, baseAttack);
      const player = one<{ coins: number }>(this.db, 'SELECT coins FROM players WHERE id = ?', config.playerId);
      const coinsNow = Number(player?.coins ?? 0);
      if (coinsNow < cost.coins) {
        throw new ApiError(409, 'not-enough-coins', `金币不足：需要 ${cost.coins}，当前 ${coinsNow}`);
      }
      // 只接受 Property1=2 的真强化石；四圣兽合成石与符咒一律拒绝。
      const autoKey = requestedItem ? requestedItem : String((one(this.db,
        `SELECT c.item_key FROM item_catalog c LEFT JOIN inventory i
           ON i.item_key = c.item_key AND i.player_id = ?
         WHERE c.kind = 'strength-stone' AND COALESCE(i.quantity, 0) >= ?
         ORDER BY c.unit_value LIMIT 1`, config.playerId, config.forge.stonesPerAttempt) as any)?.item_key || '');
      const stone = one(this.db,
        `SELECT c.item_key, c.name_zh, c.kind, COALESCE(i.quantity, 0) AS quantity
         FROM item_catalog c LEFT JOIN inventory i
           ON i.item_key = c.item_key AND i.player_id = ?
         WHERE c.item_key = ?`, config.playerId, autoKey) as any;
      if (!stone || stone.kind !== 'strength-stone') {
        throw new ApiError(409, 'not-enough-materials',
          requestedItem ? '所选物品不是真强化石（四圣兽合成石不能用于强化）'
            : '强化石不足：没有可用的真强化石（背包中无 CategoryID=11 / Property1=2 的强化石）');
      }
      if (Number(stone.quantity) < config.forge.stonesPerAttempt) {
        throw new ApiError(409, 'not-enough-materials',
          `强化石不足：需要 ${config.forge.stonesPerAttempt} 颗 ${stone.name_zh}，当前 ${Number(stone.quantity)}`);
      }

      // 成功率 100%，等级 +1；伤害始终从「未强化基础值」重算，不叠乘。
      const nextLevel = level + config.forge.levelGain;
      const nextPrecise = this.attackForLevel(baseAttack, nextLevel);
      const nextAttack = Math.round(nextPrecise);
      const t = nowMs();
      run(this.db, 'UPDATE players SET coins = coins - ?, updated_at = ? WHERE id = ?',
        cost.coins, t, config.playerId);
      const spent = this.db.prepare(
        `UPDATE inventory SET quantity = quantity - ?
         WHERE player_id = ? AND item_key = ? AND quantity >= ?`,
      ).run(config.forge.stonesPerAttempt, config.playerId, stone.item_key, config.forge.stonesPerAttempt);
      if (Number(spent.changes) !== 1) {
        throw new ApiError(409, 'not-enough-materials', `${stone.name_zh} 库存不足`);
      }
      const updated = this.db.prepare(
        `UPDATE weapon_instances
         SET level = ?, attack = ?, attack_precise = ?, base_attack = ?,
             rule_version = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND player_id = ? AND version = ?`,
      ).run(nextLevel, nextAttack, nextPrecise, baseAttack, config.forge.ruleSource,
        t, weaponInstanceId, config.playerId, version);
      if (Number(updated.changes) !== 1) {
        throw new ApiError(409, 'weapon-version-conflict', '武器已被其他操作更新，请重试');
      }
      const payload = {
        ok: true, requestId, success: true,
        weapon: {
          id: weaponInstanceId, weaponId: weapon.weapon_id, label: weapon.label,
          levelBefore: level, levelAfter: nextLevel, targetLevel: nextLevel,
          attackBefore: Number(weapon.attack), attackAfter: nextAttack,
          attackPreciseAfter: nextPrecise, baseAttack,
          version: version + 1,
        },
        cost: {
          coins: cost.coins, stones: config.forge.stonesPerAttempt,
          stoneKey: stone.item_key, stoneName: stone.name_zh,
          successRate: config.forge.successRate,
        },
        successRate: config.forge.successRate,
        ruleSource: config.forge.ruleSource,
        ruleLabel: config.forge.ruleLabel,
        damageFormula: '最终基础伤害 = 未强化基础伤害 × (1 + 0.10 × 强化等级)',
        wallet: this.wallet(),
      };
      run(this.db,
        `INSERT INTO forge_operations
         (id, player_id, weapon_instance_id, request_id, level_before, level_after,
          success, coins_cost, items_json, result_json, created_at, rule_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId('forge'), config.playerId, weaponInstanceId, requestId,
        level, nextLevel, 1, cost.coins,
        JSON.stringify([{ itemKey: stone.item_key, name: stone.name_zh, quantity: config.forge.stonesPerAttempt }]),
        JSON.stringify(payload), t, config.forge.ruleSource);
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
 * 翻牌奖励（单机可配置规则）：
 *  - 正常池产出金币、真强化石，以及使用上游真实名称与属性的武器
 *    （标注「中文品质名称待核对」，已验证可装备与战斗，不编造模板/素材）；
 *  - 测试池额外强制 2 金币 + 1 强化石 + 1 武器，保证「翻牌 → 强化」闭环可验证；
 *  - 保底只约束盘面构成（至少 2 张真强化石卡），9 张整体洗牌，**没有固定卡位**；
 *  - 生成后写入 reward_boards.cards_json 并附 pool_version，旧盘永不重抽。
 */
export function buildRewardCards(seed: number, won: boolean): RewardCard[] {
  const rng = seededRng(seed ^ 0x52455741);
  const spec = won ? config.rewards.win : config.rewards.lose;
  const cards: RewardCard[] = [];
  const coinCard = (): RewardCard => ({ kind: 'coin', amount: randInt(rng, spec.coins[0], spec.coins[1]) });
  const stoneCard = (): RewardCard => ({
    kind: 'item',
    itemKey: config.rewards.stoneItemKeys[randInt(rng, 0, config.rewards.stoneItemKeys.length - 1)],
    amount: randInt(rng, spec.stoneAmount[0], spec.stoneAmount[1]),
  });
  const weaponCard = (): RewardCard => {
    const ext = HIGH_QUALITY_WEAPONS[randInt(rng, 0, HIGH_QUALITY_WEAPONS.length - 1)];
    return { kind: 'weapon', weaponKey: ext.key, amount: 1 };
  };

  if (config.rewards.poolMode === 'test') {
    cards.push(coinCard(), coinCard(), stoneCard(), weaponCard());
  }
  while (cards.length < config.rewards.cards) {
    const r = rng();
    if (r < config.rewards.weaponChance) cards.push(weaponCard());
    else if (r < config.rewards.weaponChance + config.rewards.stoneChance) cards.push(stoneCard());
    else cards.push(coinCard());
  }

  // 保底：至少 N 张真强化石卡（只约束盘面构成，不约束位置）。
  // 可替换任意非材料卡；随后整盘 Fisher-Yates 洗牌，因此不会形成固定卡位。
  let itemCards = cards.filter((c) => c.kind === 'item').length;
  for (let i = cards.length - 1; i >= 0 && itemCards < config.rewards.guaranteedItemCards; i -= 1) {
    if (cards[i].kind !== 'item') { cards[i] = stoneCard(); itemCards += 1; }
  }

  // 全部卡整体 Fisher-Yates 洗牌；同一局种子可复现。
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = randInt(rng, 0, i);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
