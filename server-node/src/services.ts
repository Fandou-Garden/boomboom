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

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export type Broadcaster = (type: string, data: unknown) => void;

interface RewardCard {
  kind: 'coin' | 'item';
  amount: number;
  itemKey?: string;
}

const ITEM_SEED: Array<[string, number, string, string, number, string]> = [
  // item_key, TemplateID, 中文名, 原版名, 单位值, 图标
  ['xuanwu1', 11005, '玄武石 1 级', 'Đá Huyền Vũ 1', 1, 'assets/items/xuanwu1.png'],
  ['xuanwu2', 11006, '玄武石 2 级', 'Đá Huyền Vũ 2', 2, 'assets/items/xuanwu2.png'],
  ['xuanwu3', 11007, '玄武石 3 级', 'Đá Huyền Vũ 3', 3, 'assets/items/xuanwu3.png'],
  ['xuanwu4', 11008, '玄武石 4 级', 'Đá Huyền Vũ 4', 4, 'assets/items/xuanwu4.png'],
  ['xuanwu5', 11031, '玄武石 5 级', 'Đá Huyền Vũ 5', 5, 'assets/items/xuanwu5.png'],
];

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
      for (const [key, templateId, name, source, unit, icon] of ITEM_SEED) {
        run(this.db,
          `INSERT OR IGNORE INTO item_catalog
           (item_key, template_id, name_zh, name_source, icon, kind, unit_value, note)
           VALUES (?, ?, ?, ?, ?, 'strengthen-stone', ?, ?)`,
          key, templateId, name, source, icon, unit,
          'art-source/ITEM_XUANWU.md 对原版 TemplateAlllist.xml 的核对；图标为原版导出的 60x60 PNG');
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
      `SELECT id, weapon_id, label, level, attack, version, equipped
       FROM weapon_instances WHERE player_id = ? ORDER BY weapon_id`, config.playerId);
  }

  private equippedWeapon(): any {
    const row = one(this.db,
      `SELECT id, weapon_id, label, level, attack, version
       FROM weapon_instances WHERE player_id = ? AND equipped = 1`, config.playerId);
    if (!row) throw new ApiError(500, 'no-equipped-weapon', '没有已装备的武器');
    return row;
  }

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
        angleMin: WEAPON_DEFS[w.weapon_id]?.angleMin ?? null,
        angleMax: WEAPON_DEFS[w.weapon_id]?.angleMax ?? null,
      })),
      equipped: {
        id: equipped.id, weaponId: equipped.weapon_id, label: equipped.label,
        level: Number(equipped.level), attack: Number(equipped.attack),
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
    const f = config.forge;
    return {
      wallet: this.wallet(),
      weapons: this.weaponRows().map((w: any) => ({
        id: w.id, weaponId: w.weapon_id, label: w.label,
        level: Number(w.level), attack: Number(w.attack),
        equipped: Number(w.equipped) === 1,
        maxLevel: f.maxLevel,
        cost: this.forgeCost(Number(w.level)),
        canStrengthen: Number(w.level) < f.maxLevel,
      })),
      ruleSource: f.ruleSource,
      ruleNote: '原版 StrengthenMgr / StrengthenInfo 配置未导出；当前为明确标注的单机临时规则，不代表原版成功率与消耗。',
      itemRules: ITEM_SEED.map(([key, , name, , unit, icon]) => ({
        itemKey: key, name, unitValue: unit, icon,
      })),
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
          };
        }
      }
      const w = this.equippedWeapon();
      const battleId = newId('battle');
      const seed = randomInt(1, 0x7fffffff);
      const botAttack = Math.round(BASE_ATTACK * config.bot.attackScale);
      const t = nowMs();
      run(this.db,
        `INSERT INTO battles
         (id, player_id, room_id, map_id, weapon_id, weapon_level, weapon_attack, bot_attack,
          seed, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        battleId, config.playerId, current.id, current.map_id, w.weapon_id,
        Number(w.level), Number(w.attack), botAttack, seed, t);
      run(this.db,
        `UPDATE rooms SET status = 'battle', active_battle_id = ?, updated_at = ? WHERE player_id = ?`,
        battleId, t, config.playerId);
      return {
        battleId, mapId: current.map_id, weaponId: w.weapon_id,
        weaponLevel: Number(w.level), weaponAttack: Number(w.attack),
        botAttack, seed, resumed: false,
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
         (id, battle_id, player_id, cards_json, max_picks, picks_used, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 'open', ?, ?)`,
        boardId, battleId, config.playerId, JSON.stringify(cards), config.rewards.maxPicks, t, t);
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
        if (replay.board_id !== this.boardIdForBattle(battleId)) {
          throw new ApiError(409, 'request-id-reused', 'requestId 已用于另一张奖励盘');
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

      const reward = this.applyReward(card);
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

  /** 只接受服务端自己生成的卡片内容，前端无法指定金额或物品。 */
  private applyReward(card: RewardCard): any {
    const t = nowMs();
    if (card.kind === 'coin') {
      const amount = Math.max(0, Math.trunc(card.amount));
      run(this.db, 'UPDATE players SET coins = coins + ?, updated_at = ? WHERE id = ?', amount, t, config.playerId);
      return { kind: 'coin', amount, label: '金币', icon: 'assets/ui/icon-gold.png' };
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
  strengthen(args: { weaponInstanceId: unknown; itemKey?: unknown; requestId: unknown }): any {
    const weaponInstanceId = String(args.weaponInstanceId || '');
    const requestId = String(args.requestId || '').trim();
    if (!requestId || requestId.length > 200) throw new ApiError(400, 'bad-request-id', 'requestId 缺失或过长');
    const requestedItem = args.itemKey ? String(args.itemKey) : '';

    const result = transaction(this.db, () => {
      const replay = one(this.db, 'SELECT result_json FROM forge_operations WHERE request_id = ?', requestId) as any;
      if (replay) {
        try { return JSON.parse(replay.result_json); } catch { throw new ApiError(500, 'bad-stored-result', '强化记录损坏'); }
      }

      const weapon = one(this.db, 'SELECT * FROM weapon_instances WHERE id = ?', weaponInstanceId) as any;
      if (!weapon || weapon.player_id !== config.playerId) throw new ApiError(404, 'weapon-not-owned', '武器不属于当前玩家');
      const level = Number(weapon.level);
      const version = Number(weapon.version);
      if (level >= config.forge.maxLevel) throw new ApiError(409, 'max-level', '武器已达当前规则强化上限');

      const cost = this.forgeCost(level);
      const player = one<{ coins: number }>(this.db, 'SELECT coins FROM players WHERE id = ?', config.playerId);
      if (Number(player?.coins ?? 0) < cost.coins) throw new ApiError(409, 'not-enough-coins', `金币不足，需要 ${cost.coins}`);

      // 选择材料：可指定，或由服务端按单位值从低到高自动挑选库存最合适的一种。
      const materials = all(this.db,
        `SELECT c.item_key, c.name_zh, c.icon, c.unit_value, COALESCE(i.quantity, 0) AS quantity
         FROM item_catalog c LEFT JOIN inventory i
           ON i.item_key = c.item_key AND i.player_id = ?
         WHERE c.kind = 'strengthen-stone' ORDER BY c.unit_value`, config.playerId) as any[];
      const candidates = requestedItem
        ? materials.filter((m) => m.item_key === requestedItem)
        : materials.filter((m) => Number(m.quantity) > 0);
      let chosen: any = null;
      let need = 0;
      for (const m of candidates) {
        const qty = Number(m.quantity);
        const unit = Number(m.unit_value);
        const required = Math.ceil(cost.requiredUnits / unit);
        if (qty >= required) { chosen = m; need = required; break; }
      }
      if (!chosen) throw new ApiError(409, 'not-enough-materials', `强化石不足，需要 ${cost.requiredUnits} 点材料单位`);

      // 结果由服务端计算，requestId 派生种子保证可复现。
      const hash = [...requestId].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);
      const rng = seededRng(hash ^ version ^ level);
      const success = rng() < cost.successRate;
      const nextLevel = success ? level + 1 : level;
      const nextAttack = BASE_ATTACK + nextLevel * config.forge.attackPerLevel;
      const t = nowMs();

      run(this.db, 'UPDATE players SET coins = coins - ?, updated_at = ? WHERE id = ?', cost.coins, t, config.playerId);
      run(this.db,
        `UPDATE inventory SET quantity = quantity - ? WHERE player_id = ? AND item_key = ?`,
        need, config.playerId, chosen.item_key);
      // 版本条件更新：并发下只有第一个请求能成功，其余回滚。
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
        cost: {
          coins: cost.coins, itemKey: chosen.item_key, itemName: chosen.name_zh,
          itemQuantity: need, requiredUnits: cost.requiredUnits,
        },
        successRate: cost.successRate,
        ruleSource: config.forge.ruleSource,
        wallet: this.wallet(),
      };
      run(this.db,
        `INSERT INTO forge_operations
         (id, player_id, weapon_instance_id, request_id, level_before, level_after,
          success, coins_cost, items_json, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId('forge'), config.playerId, weaponInstanceId, requestId,
        level, nextLevel, success ? 1 : 0, cost.coins,
        JSON.stringify({ itemKey: chosen.item_key, quantity: need }),
        JSON.stringify(payload), t);
      return payload;
    });

    this.emit('wallet', result.wallet);
    this.emit('forge', this.forge());
    this.emit('room', this.room());
    return result;
  }
}

/** 用单局种子生成 3x3 卡面内容；只存服务端，未翻卡不下发内容。 */
export function buildRewardCards(seed: number, won: boolean): RewardCard[] {
  const rng = seededRng(seed ^ 0x52455741);
  const spec = won ? config.rewards.win : config.rewards.lose;
  const cards: RewardCard[] = [];
  for (let i = 0; i < config.rewards.cards; i += 1) {
    if (rng() < config.rewards.stoneChance) {
      const itemKey = config.rewards.stoneItemKeys[randInt(rng, 0, config.rewards.stoneItemKeys.length - 1)];
      cards.push({ kind: 'item', itemKey, amount: randInt(rng, spec.stoneAmount[0], spec.stoneAmount[1]) });
    } else {
      cards.push({ kind: 'coin', amount: randInt(rng, spec.coins[0], spec.coins[1]) });
    }
  }
  // 保证材料卡下限，避免随机性导致「翻完牌却没有强化石」的闭环断点。
  let itemCards = cards.filter((c) => c.kind === 'item').length;
  for (let i = 0; i < cards.length && itemCards < config.rewards.guaranteedItemCards; i += 1) {
    if (cards[i].kind === 'coin') {
      const itemKey = config.rewards.stoneItemKeys[randInt(rng, 0, config.rewards.stoneItemKeys.length - 1)];
      cards[i] = { kind: 'item', itemKey, amount: randInt(rng, spec.stoneAmount[0], spec.stoneAmount[1]) };
      itemCards += 1;
    }
  }
  // Fisher-Yates，用同一局种子洗牌，可复现。
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = randInt(rng, 0, i);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  // 单机规则：为保证「翻牌 -> 金币与强化石入库 -> 铁匠铺强化」闭环可完成，
  // 前 3 张中固定 1 张原版强化石卡 + 2 张金币卡。卡面内容仍不下发，
  // 玩家可自由选择任意 3 张；这只是排列规则，不改变物品与数值来源。
  const swap = (a: number, b: number) => { [cards[a], cards[b]] = [cards[b], cards[a]]; };
  const itemIdx = cards.findIndex((c) => c.kind === 'item');
  if (itemIdx > 0) swap(itemIdx, 0);
  for (const target of [1, 2]) {
    const coinIdx = cards.findIndex((c, i) => i >= target && c.kind === 'coin');
    if (coinIdx > target) swap(coinIdx, target);
  }
  return cards;
}
