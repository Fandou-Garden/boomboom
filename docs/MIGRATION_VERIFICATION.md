# 旧存档迁移验证（001 → 002 → 003 → 004）

> 验证日期：2026-11-28 · 脚本 `tests/server/migration.test.mjs` · 结果 **通过（7/7 服务端测试）**
> 报告自动生成于 `/tmp/ddt-migration-report.json`（每次运行覆盖，不写入仓库）。

> **阶段 10 交付规则声明**：当前交付是「原版素材 + 单机自定义强化规则」(`SIMPLE_LOCAL_V1`)。
> 004 迁移负责把旧 `LOCAL_RULE` / `ORIGINAL_PARTIAL` 存档的**派生属性一次性重算**到新公式，
> 并逐件备份原始数值；用户已授权简化强化算法，不再追查原版属性成长公式。

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
| 玩家金币 | `1234` |
| 背包 | `xuanwu1=3`、`xuanwu3=2`（玄武石被 001 误登记为 `strengthen-stone`） |
| 武器 1 | `wi_local-player_fruit` Lv3 / attack 175 / version 4 / **已装备**（旧规则 `100 + 3×25`） |
| 武器 2 | `wi_local-player_fire` Lv0 / attack 100 |
| 武器 3 | `wi_local-player_overmax` **Lv15** / attack 475（超出新上限 +12） |
| 武器 4 | `wi_local-player_unknown` Lv2 / attack 20（`attack ≤ 25×level`，无法反推基础值） |
| 战斗 | `battle_legacy`（finished / win） |
| 奖励盘 | `board_legacy`，`cards_json` 为 9 张固定金币卡，`picks_used=1` |
| 领取记录 | `pick_legacy`（card 4 / `req-legacy-1`） |
| 强化记录 | `forge_legacy`（2→3 成功 / 220 金币） |
| unmatched | `神武石` |

## 3. 迁移前后核对（阶段 10 实测）

| 核对项 | 迁移前 | 迁移后 | 结论 |
| --- | --- | --- | --- |
| 金币 | `1234` | `1234` | **不变** |
| 背包 | `[{xuanwu1,3},{xuanwu3,2}]` | `[{xuanwu1,3},{xuanwu3,2}]` | **数量与条目完全不变**；没有凭空出现 `strength*` 库存 |
| 玄武石分类 | 5 条全为 `strengthen-stone` | 5 条全为 `compose-stone` | **只改分类，不兑换、不补发、不删除、不合并** |
| fruit 强化等级 / 装备状态 | `3 / equipped=1` | `3 / equipped=1` | **等级与装备状态保留，实例不删除** |
| fruit 基础伤害 | attack `175`（旧 +25/级） | `base_attack=100`、`attack_precise=130`、`attack=130` | 反推未强化基础值后按新公式**一次性重算**，不叠加旧加成 |
| fire | Lv0 / 100 | Lv0 / `base_attack=100` / 100 | 不变 |
| overmax | **Lv15** / 475 | **Lv12** / `base_attack=100` / `attack_precise=220` | 超出新上限**钳制到 +12**，实例保留、备份记录原等级 |
| unknown | Lv2 / 20 | Lv2 / `base_attack=20` / `attack_precise=24` | 无法反推时以当前 attack 为基础并标记，不静默删除 |
| `rule_version` | 无该列（003 默认 `LOCAL_RULE`） | 全部 `SIMPLE_LOCAL_V1` | 标记已迁移，防止二次加成 |
| 逐件备份 `legacy_weapon_backup` | 无该表 | **4 行**，含原始等级/攻击/规则版本、推导基础值、迁移后数值与 `resolution` | 可追溯、可人工复核 |
| 领取 / 强化历史记录 | 各 1 条 | 各 1 条（内容相同） | 不改写历史 |
| 奖励盘 `cards_json` / `picks_used` / `status` | 原 9 张 / 1 / open | **逐字节相同** | **旧盘不重抽** |
| 奖励盘配置版本 | 无该列 | `pool_version='legacy-v1'`、`rules_version='legacy-v1'` | 旧盘保留生成时版本 |
| 新增列 | — | `weapon_instances.base_attack / attack_precise`、`battles.weapon_attack_precise` | 004 加列 |
| `schema_migrations` | `[1]` | `[1,2,3,4]` | 迁移按版本只应用一次 |

实测输出：

```text
[migration] 旧金币=1234 新金币=1234 背包=[{"item_key":"xuanwu1","quantity":3},{"item_key":"xuanwu3","quantity":2}] 旧武器 attack=175 → 新 attack=130 (base=100, level=3) 超限 level=15 → 12 幂等=true
```

## 4. 004 属性转换方式（避免再次叠加）

旧规则（`LOCAL_RULE` / `ORIGINAL_PARTIAL`）的派生属性为
`attack = 未强化基础伤害 + 25 × level`（`25 = config.LEGACY_ATTACK_PER_LEVEL`，
该常量**仅供迁移反推**，运行时不再使用）。

```sql
base_attack     = CASE WHEN attack - 25*level > 0 THEN attack - 25*level ELSE attack END
level           = MIN(level, 12)
attack_precise  = ROUND(base_attack * (1 + 0.10 * level), 6)
attack          = CAST(ROUND(attack_precise) AS INTEGER)
rule_version    = 'SIMPLE_LOCAL_V1'
```

- **同一条 UPDATE 内所有表达式都读取更新前的行值**（SQLite 语义），因此不会链式叠乘；
  后续运行时强化也始终从 `base_attack` 重算，绝不在已强化数值上乘第二次。
- `UPDATE ... WHERE rule_version IS NULL OR rule_version <> 'SIMPLE_LOCAL_V1'`，
  已迁移的行不会被再次处理。
- 精度保留 6 位小数，消除 `100×1.1 = 110.00000000000001` 这类 IEEE754 尾差；
  战斗引擎内最终伤害取整沿用原有规则。
- 异常处理：
  - `level > 12` → 钳制到 12，`resolution='CLAMPED_LEVEL_TO_12'`，备份保留原等级；
  - `attack - 25*level <= 0` → 以当前 `attack` 为基础值，
    `resolution='UNKNOWN_BASE_ASSUMED_CURRENT'`（两者同时发生时标记为 `... + CLAMPED_LEVEL_TO_12`）；
  - 其余为 `RECALCULATED_FROM_LEGACY_BASE`。
  - **所有情况都保留实例与原始数值，不静默删除、不自动补发物品**。
- 强化等级与属性属于**每件武器实例**，不修改共享武器模板。

## 5. 幂等（重复执行不重复发物品 / 不重复加属性）

同一工作副本**再次启动服务**后，对以下字段逐一 `deepEqual` 对比，全部一致：
`coins`、`inventory`、`xuanwuKinds`、`reward_picks`、`forge_operations`、
`reward_boards`、`boardMeta`、`weaponPrecise`（全部列）、`legacy_weapon_backup`、`schema_migrations`。
重启后 `GET /api/server/room` 仍返回 `attackPrecise=130`，不会再次叠乘。

机制：
- `schema_migrations` 主键版本 + `db.ts` 的 `applyMigrations()` 跳过已应用版本（事务用 `BEGIN IMMEDIATE`）；
- 004 的备份插入用 `INSERT OR IGNORE`，且只选 `rule_version <> 'SIMPLE_LOCAL_V1'` 的行；
- 002 中**不再包含**任何 `INSERT ... SELECT` 发放语句（早期「1:1 自动补发强化石」已按验收要求移除）。

## 6. 旧奖励盘配置版本

- 003 为 `reward_boards` 增加 `pool_version` / `rules_version` / `pool_mode` / `pool_note`，
  旧行默认值 `legacy-v1`。
- `rewardBoard()` 永远只读已持久化的 `cards_json`，**不会**重新调用 `buildRewardCards()`；
  阶段 10 改了奖励池配置版本，旧盘仍保留原结果与 `legacy-v1`。
- 新盘写入 `pool_version='v4-2026-11-28-simple-forge'` 与 `rules_version='forge=SIMPLE_LOCAL_V1'`。
- 「已生成的奖励盘保留原结果和配置版本」另有 `tests/server/forge-rules.test.mjs` 覆盖：
  注入旧盘 → 领取 → 重启 → 再次领取，`cards_json` 逐字节不变。

## 7. 武器领取事务与防重

- `claimCard()` 与 `applyReward()` 在**同一个 SQLite 事务**内完成。
- `weapon_grants` 有 `UNIQUE(request_id)` 与 `UNIQUE(battle_id, card_index)` 双唯一约束。
- 同一 `requestId` 重试返回**第一次持久化的完整结果**（同一 `weaponInstanceId`）；
  同一 requestId 换卡位返回 409；重启服务后重放仍返回同一实例，`weapon_grants` 始终只有 1 行。
- 独立武器实例写入 `base_attack` / `attack_precise` / `rule_version='SIMPLE_LOCAL_V1'`，
  可在房间装备、在铁匠铺按新规则强化、下一局战斗使用该实例属性。
- 验证见 `tests/server/forge-rules.test.mjs` 第 5 个子测试。

## 8. 手工备份 / 恢复（生产环境）

```bash
# 备份（推荐：停服后用 SQLite backup API；Python 标准库即可）
mkdir -p data/backups
python3 - <<'PY'
import sqlite3, datetime, os
src = 'data/ddt.sqlite'
dst = os.path.join('data/backups', 'ddt-' + datetime.date.today().isoformat() + '.sqlite')
s = sqlite3.connect(src); d = sqlite3.connect(dst)
s.backup(d); d.close(); s.close()
print(dst)
PY
# 恢复：停服 → 用备份覆盖 data/ddt.sqlite → 删除残留 -wal/-shm → 启动
```

- 切勿在服务运行中用 `cp data/ddt.sqlite ...` 单独复制主库（WAL 模式下会丢失未 checkpoint 的事务）。
- 004 迁移会在库内自动建立 `legacy_weapon_backup` 表逐件保存旧武器数值；
  如需人工核对，查询
  `SELECT * FROM legacy_weapon_backup ORDER BY weapon_instance_id;`。
- 数据库路径由 `DDT_DB_PATH` 控制，默认 `data/ddt.sqlite`；`data/` 与 `*.sqlite*` 已在 `.gitignore` 中，
  代码更新不会覆盖存档。
