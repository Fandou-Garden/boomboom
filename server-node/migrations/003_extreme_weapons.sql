-- 003 武器实例扩展、奖励盘配置版本与发放防重（schema_migrations 保证只应用一次）
--
-- 说明：003 只做「加列 / 建表 / 补元数据」，不新增任何玩家资产、不重算属性、
-- 不改写已生成奖励盘的 cards_json。旧 LOCAL_RULE 装备的 level/attack 原样保留，
-- 另加 rule_version 标记其规则来源，避免把旧等级按新规则再叠加一次加成。
--
-- 「高阶品质武器候选」仅用于测试奖励池的发放防重验证：
-- 上游无中文「极」命名，中文品质映射待确认，正常奖励池不发放（见 002/config）。
-- weapon_id 使用 hq_* 键 + 序号，不会与 13 把基础武器的 UNIQUE(player_id, weapon_id) 冲突；
-- 战斗时通过 base_weapon_id 复用对应经典武器的弹道 / 弹丸 / 爆炸表现。

ALTER TABLE weapon_instances ADD COLUMN template_id INTEGER;
ALTER TABLE weapon_instances ADD COLUMN base_weapon_id TEXT;
ALTER TABLE weapon_instances ADD COLUMN variant TEXT NOT NULL DEFAULT 'normal';
-- 旧存档全部来自 LOCAL_RULE；迁移不重算 attack，仅标记规则版本。
ALTER TABLE weapon_instances ADD COLUMN rule_version TEXT NOT NULL DEFAULT 'LOCAL_RULE';
-- 原版 Template.Level：基础武器对应 7103..7111（Level=2）；高阶候选对应 7006..7014（Level=3）。
-- 决定 ItemStrengthenHandler.cs:156 失败分支走「降级」还是「Count-- 损毁」。
ALTER TABLE weapon_instances ADD COLUMN template_level INTEGER NOT NULL DEFAULT 2;

-- 强化操作记录补充规则来源，便于区分原版规则与 LOCAL_RULE 的历史操作。
ALTER TABLE forge_operations ADD COLUMN rule_source TEXT NOT NULL DEFAULT 'LOCAL_RULE';

-- 发放流水：request_id UNIQUE 防重放，(battle_id, card_index) UNIQUE
-- 保证「重试 / 重复点击 / 刷新 / 重启」都不会重复生成武器实例。
CREATE TABLE IF NOT EXISTS weapon_grants (
  id                  TEXT PRIMARY KEY,
  player_id           TEXT NOT NULL REFERENCES players(id),
  battle_id           TEXT NOT NULL REFERENCES battles(id),
  card_index          INTEGER NOT NULL,
  request_id          TEXT NOT NULL UNIQUE,
  weapon_key          TEXT NOT NULL,
  weapon_instance_id  TEXT NOT NULL REFERENCES weapon_instances(id),
  mapping_status      TEXT NOT NULL DEFAULT 'UNCONFIRMED',
  pool_mode           TEXT NOT NULL DEFAULT 'test',
  created_at          INTEGER NOT NULL,
  UNIQUE (battle_id, card_index)
);

-- 战斗记录关联实际武器实例与品质，便于结算追溯。
ALTER TABLE battles ADD COLUMN weapon_instance_id TEXT;
ALTER TABLE battles ADD COLUMN variant TEXT NOT NULL DEFAULT 'normal';

-- 奖励盘生成时写入配置版本：旧盘保持 'legacy-v1'，不因后续规则/奖励池变更重抽。
-- rewardBoard() 永远只读取已持久化的 cards_json，不重新调用 buildRewardCards()。
ALTER TABLE reward_boards ADD COLUMN pool_version TEXT NOT NULL DEFAULT 'legacy-v1';
ALTER TABLE reward_boards ADD COLUMN rules_version TEXT NOT NULL DEFAULT 'legacy-v1';
ALTER TABLE reward_boards ADD COLUMN pool_mode TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE reward_boards ADD COLUMN pool_note TEXT;
