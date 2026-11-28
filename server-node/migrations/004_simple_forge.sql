-- 004 单机自定义强化规则：旧存档备份 + 派生属性一次性重算
--
-- 用户已授权简化强化算法；运行时统一为「原版素材 + 单机自定义强化规则」。
-- 本迁移只做四件事：加列、逐件备份旧武器实例、按新公式重算一次、记录异常数据处理。
-- 不删除玩家资产、不自动兑换材料、不修改共享武器模板、不改已生成的奖励盘。
-- 另：003 注释中「高阶品质武器候选仅用于测试奖励池、正常奖励池不发放」是当时的策略，
-- 本轮交付已按用户授权调整——正常池按单机自定义掉率产出使用上游真实名称的武器，
-- 中文品质名称待核对不阻塞交付；历史注释保留不改，以本文件与 docs/ 为准。
--
-- 旧规则（LOCAL_RULE / ORIGINAL_PARTIAL）的派生属性为
--   attack = 未强化基础伤害 + 25 × level
-- 因此反推 base_attack = attack - 25 × level（25 = config.LEGACY_ATTACK_PER_LEVEL）。
-- 新规则：attack_precise = base_attack × (1 + 0.10 × level)，始终从 base_attack 重算，
-- 绝不在已强化的 attack 上叠乘，避免旧加成与新加成叠加。
--
-- schema_migrations 保证本文件只应用一次；且 UPDATE 只处理 rule_version 尚未迁移的行，
-- 即使重复执行也不会二次加成或重复发物品。

-- 逐件备份：迁移前的等级 / 攻击 / 规则版本、推导出的基础值、迁移后数值与处理方式。
CREATE TABLE IF NOT EXISTS legacy_weapon_backup (
  id                   TEXT PRIMARY KEY,
  weapon_instance_id   TEXT NOT NULL,
  player_id            TEXT NOT NULL,
  level_before         INTEGER NOT NULL,
  attack_before        REAL NOT NULL,
  rule_version_before  TEXT,
  base_attack_derived  REAL NOT NULL,
  level_after          INTEGER NOT NULL,
  attack_after_precise REAL NOT NULL,
  resolution           TEXT NOT NULL,
  created_at           INTEGER NOT NULL
);

ALTER TABLE weapon_instances ADD COLUMN base_attack REAL;
ALTER TABLE weapon_instances ADD COLUMN attack_precise REAL;
ALTER TABLE battles ADD COLUMN weapon_attack_precise REAL;

-- 无法反推（attack <= 25×level 或数值异常）时以当前 attack 作为基础值，
-- 标记 UNKNOWN_BASE_ASSUMED_CURRENT；level > 12 的实例钳制到 12 并标记。
-- 两种情况都保留实例与原始数值，不静默删除。
INSERT OR IGNORE INTO legacy_weapon_backup
 (id, weapon_instance_id, player_id, level_before, attack_before, rule_version_before,
  base_attack_derived, level_after, attack_after_precise, resolution, created_at)
SELECT
  'lwb_' || w.id,
  w.id, w.player_id, w.level, w.attack, w.rule_version,
  CASE WHEN w.attack - 25 * w.level > 0 THEN w.attack - 25 * w.level ELSE w.attack END,
  MIN(w.level, 12),
  CASE WHEN w.attack - 25 * w.level > 0
       THEN ROUND((w.attack - 25 * w.level) * (1 + 0.10 * MIN(w.level, 12)), 6)
       ELSE ROUND(w.attack * (1 + 0.10 * MIN(w.level, 12)), 6) END,
  CASE
    WHEN w.attack - 25 * w.level <= 0 AND w.level > 12
      THEN 'UNKNOWN_BASE_ASSUMED_CURRENT + CLAMPED_LEVEL_TO_12'
    WHEN w.attack - 25 * w.level <= 0 THEN 'UNKNOWN_BASE_ASSUMED_CURRENT'
    WHEN w.level > 12 THEN 'CLAMPED_LEVEL_TO_12'
    ELSE 'RECALCULATED_FROM_LEGACY_BASE'
  END,
  CAST(strftime('%s','now') AS INTEGER) * 1000
FROM weapon_instances w
WHERE w.rule_version IS NULL OR w.rule_version <> 'SIMPLE_LOCAL_V1';

-- 一次性重算：同一条 UPDATE 内所有表达式都读取更新前的行值（SQLite 语义），
-- 因此 attack / attack_precise 都由旧 attack 反推，不会出现链式叠乘。
UPDATE weapon_instances
SET base_attack = CASE
      WHEN attack - 25 * level > 0 THEN attack - 25 * level ELSE attack END,
    attack_precise = ROUND(CASE
      WHEN attack - 25 * level > 0
        THEN (attack - 25 * level) * (1 + 0.10 * MIN(level, 12))
      ELSE attack * (1 + 0.10 * MIN(level, 12)) END, 6),
    attack = CAST(ROUND(CASE
      WHEN attack - 25 * level > 0
        THEN (attack - 25 * level) * (1 + 0.10 * MIN(level, 12))
      ELSE attack * (1 + 0.10 * MIN(level, 12)) END) AS INTEGER),
    level = MIN(level, 12),
    rule_version = 'SIMPLE_LOCAL_V1'
WHERE rule_version IS NULL OR rule_version <> 'SIMPLE_LOCAL_V1';

-- 旧战斗记录没有精确攻击列，读取时回退到 weapon_attack（startBattle 已做 ?? 回退）。
