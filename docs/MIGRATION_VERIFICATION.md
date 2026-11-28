# 旧存档迁移验证（002 / 003）

> 验证日期：2026-11-28 · 脚本 `tests/server/migration.test.mjs` · 结果 **通过**
> 报告自动生成于 `/tmp/ddt-migration-report.json`（每次运行覆盖，不写入仓库）。

## 1. 备份方式（WAL 安全）

按验收要求，**没有在服务运行中直接 `cp` 主库文件**：

```python
# python sqlite3.Connection.backup() 是 SQLite C API sqlite3_backup 的官方封装
s = sqlite3.connect(src)   # 源库处于 WAL 模式
d = sqlite3.connect(dst)
s.backup(d)                # 读取已提交的全部内容（含 WAL 中未 checkpoint 的部分）
```

测试流程：构造 001 时代旧库 → 用 `backup()` 复制到工作副本 → 在**副本**上启动真实服务
（`openDatabase()` / `applyMigrations()` 走生产路径）→ 再用 `backup()` 生成前后快照对比。
Node 22.22.2 的 `node:sqlite` 无 `backup()` API（实测 `typeof d.backup === 'undefined'`），
故使用 Python 标准库封装。

## 2. 旧库构造（模拟 001 已应用）

| 项 | 值 |
| --- | --- |
| `schema_migrations` | `[1]` |
| 玩家金币 | 1234 |
| 背包 | `xuanwu1=3`、`xuanwu3=2`（玄武石被 001 误登记为 `strengthen-stone`） |
| 武器 | `wi_local-player_fruit` Lv3 / attack 175 / version 4 / 已装备；`wi_local-player_fire` Lv0 / attack 100 |
| 战斗 | `battle_legacy`（finished / win） |
| 奖励盘 | `board_legacy`，`cards_json` 为 9 张固定金币卡，`picks_used=1` |
| 领取记录 | `pick_legacy`（card 4 / `req-legacy-1`） |
| 强化记录 | `forge_legacy`（2→3 成功 / 220 金币） |
| unmatched | `神武石` |

## 3. 迁移前后核对（实测）

| 核对项 | 迁移前 | 迁移后 | 结论 |
| --- | --- | --- | --- |
| 金币 | `1234` | `1234` | **不变** |
| 背包 | `[{xuanwu1,3},{xuanwu3,2}]` | `[{xuanwu1,3},{xuanwu3,2}]` | **数量与条目完全不变**；没有凭空出现 `strength*` 库存 |
| 玄武石分类 | 5 条全为 `strengthen-stone` | 5 条全为 `compose-stone` | **只改分类，不兑换、不补发、不删除、不合并** |
| 武器 Lv/attack/version/equipped | `3 / 175 / 4 / 1` | `3 / 175 / 4 / 1` | **不重算、不叠加加成** |
| 武器规则版本 | 无该列 | `rule_version='LOCAL_RULE'`、`template_level=2` | 旧 LOCAL_RULE 装备保留来源标记 |
| 领取记录 `reward_picks` | 1 条 | 1 条（内容相同） | 不变 |
| 强化记录 `forge_operations` | 1 条 | 1 条（内容相同） | 不变 |
| 奖励盘 `cards_json` / `picks_used` / `status` | 原 9 张 / 1 / open | **逐字节相同** | **旧盘不重抽** |
| 奖励盘配置版本 | 无该列 | `pool_version='legacy-v1'`、`rules_version='legacy-v1'` | 旧盘保留生成时版本 |
| `schema_migrations` | `[1]` | `[1,2,3]` | 迁移按版本只应用一次 |

## 4. 属性转换方式（避免再次叠加）

- 迁移**不触碰** `weapon_instances.level` / `attack` / `version`。
- 旧装备的 `attack=175` 是 001 时代 `BASE_ATTACK(100) + level(3) × 25` 的结果，
  迁移后按 `rule_version='LOCAL_RULE'` 解释，**不按新规则重算整条曲线**。
- 后续强化采用增量式：`nextAttack = 当前 attack + (nextLevel - level) × 每级点数`，
  不会把历史等级再乘一次。
- `original` 分支的每级点数虽与 LOCAL_RULE 共用，但响应中标注
  `attackGrowthSource='LOCAL_RULE_SUPPLEMENT（原版属性成长未还原）'`，不冒充原版数值。

## 5. 幂等（重复执行不重复发物品 / 不重复加属性）

同一工作副本**再次启动服务**后，对以下字段逐一 `deepEqual` 对比，全部一致：
`coins`、`inventory`、`xuanwuKinds`、`reward_picks`、`forge_operations`、
`reward_boards`、`boardMeta`、`schema_migrations`，以及旧武器的 `level/attack/version`。

机制：`schema_migrations` 主键版本 + `db.ts` 的 `applyMigrations()` 跳过已应用版本；
002 中**不再包含**任何 `INSERT ... SELECT` 发放语句（上一版的「1:1 自动补发强化石」按验收要求已移除）。

## 6. 旧奖励盘配置版本

- 003 为 `reward_boards` 增加 `pool_version` / `rules_version` / `pool_mode` / `pool_note`，
  旧行默认值 `legacy-v1`。
- `rewardBoard()` 永远只读已持久化的 `cards_json`，**不会**重新调用 `buildRewardCards()`。
- 新盘写入 `pool_version='v3-2026-11-28'` 与当时的 `forge=<rules>/<ruleSource>`。

## 7. 极武器/候选武器领取事务

- `claimCard()` 与 `applyReward()` 在**同一个 SQLite 事务**内完成。
- `weapon_grants` 有 `UNIQUE(request_id)` 与 `UNIQUE(battle_id, card_index)` 双唯一约束。
- 同一 `requestId` 重试返回**同一个 `weaponInstanceId`**（`deduplicated=true`）；
  同一 requestId 换卡位返回 409；重启服务后重放仍返回同一实例。
- 验证见 `tests/server/forge-rules.test.mjs` 第 4 个子测试。

## 8. 手工备份 / 恢复（生产环境）

```bash
# 备份（推荐：停服后用 SQLite backup API；Python 标准库即可）
python3 - <<'PY'
import sqlite3
s = sqlite3.connect('data/ddt.sqlite'); d = sqlite3.connect('data/backups/ddt-manual.sqlite')
s.backup(d); d.close(); s.close()
PY
# 恢复：停服 → 用备份覆盖 data/ddt.sqlite → 删除残留 -wal/-shm → 启动
```

切勿在服务运行中用 `cp data/ddt.sqlite ...` 单独复制主库（WAL 模式下会丢失未 checkpoint 的事务）。
