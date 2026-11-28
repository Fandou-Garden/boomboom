# 高阶品质武器（「极武器」）映射证据

> 核对日期：2026-11-28 · 上游 `phucdz2kk4/Gunny @ 057c71a`（与 `dist/js/engine/constants.js` 的 `SOURCE_COMMIT` 一致）
> 旧版对照：`dk-khoado/Gunny-3.0`
> **结论：中文「极·」品质映射未证实，全部标记 `NAME_PENDING_VERIFY`（中文品质名称待核对）。**
>
> **阶段 10 更新（用户授权）**：不再追查「极·」品质映射，也不再因此阻塞交付。
> 使用**已核实的上游真实名称、模板 ID、四维属性与 Pic 素材**，标注「中文品质名称待核对」；
> 不编造中文「极·」名称、模板、属性或专属素材。这些武器已验证可正常装备、强化与战斗，
> 因此可作为翻牌武器奖励（正常池按单机自定义掉率，测试池强制含 1 张）。

## 1. 为什么不能凭 Quality / VIP- / 模板编号 / 属性倍率判定

| 证据 | 结果 |
| --- | --- |
| `Tank.Request/TemplateAlllist.xml`（zlib 解压后 7642 条 `<Item>`）中中文「极」出现次数 | **0** |
| `VIP-` 出现次数 | 78 |
| `Source Flash/src/ddt/data/goods/QualityType.as` 的 `QUALITY_STRING` | `["", 粗糙, 普通, 优秀, 精良, 卓越, 传说, 神器]` 共 8 档，**无「极」品质档**；`QUALITY_COLOR` 只用于文字颜色 |
| 客户端物品名显示 | 直接取 `TemplateAlllist.xml` 的 `Name`；`QualityType` 不拼接品质前缀（见 `SellGoodsFrame.as:105-109`） |
| 含 `Cực ` 的两条物品名 | `Ước Mơ Cực Quang`（极光梦想）、`Cực may mắn`（超级幸运），**均非武器品质名** |
| 结论 | 无法证明上游 `VIP-` 武器即中文官服「极·烈火 / 极·轰天…」系列；按验收要求不推测、不翻译、不冒充 |

因此本轮只登记「高阶品质武器候选」，展示**上游真实名称**（`VIP-Pháo` 等），
代码中为 `server-node/src/original-data.ts` 的 `HIGH_QUALITY_WEAPONS`，
每项 `mappingStatus: 'NAME_PENDING_VERIFY'`（中文品质名称待核对），
`nameZh` 形如 `VIP-Pháo（中文品质名称待核对）`。

## 2. 逐件映射证据表

字段来源：`Tank.Request/TemplateAlllist.xml`；`GainEquip` 来源：`Tank.Request/itemstrengthengoodsinfo.xml`。
素材 Pic 为物品表 `Pic` 字段，实际图标目录 `Resource/v1.1/image/arm/<Pic>/1/icon.png`
（另有 `S<Pic>/`、`SS<Pic>/` 前缀变体，见第 4 节）。

| 模板ID | 上游原名 | 品质 | 基础伤害 | 四维（攻/防/敏/幸） | Pic | 同名普通版 | 强化进阶链（Level 10/12/15 → GainEquip） | 中文品质映射 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 7006 | `VIP-Pháo` | Q4, Level=3 | Attack 250 | 250/60/40/30 | `bombpack` | 7103 `Pháo` Q3 150/36/24/18 | 70061 (Lv10, Atk300, `bombpack2`) / 70062 (Lv12, Atk390, `bombpack3`) / 70064 (Lv15, Atk488, `bombpack6`) | 待确认（曾推测「极·烈火」，无证据） |
| 7007 | `VIP-Lựu đạn` | Q4, Level=3 | 40 | 40/250/30/60 | `bomb` | 7104 `Lựu đạn` Q3 24/150/18/36 | 70071 (Lv10, Def300, `bomb2`) / 70072 (Lv12, Def390, `bomb3`) / 70074 (Lv15, Def488, `bomb6`) | 待确认 |
| 7008 | `VIP-Phi tiêu` | Q4, Level=3 | 60 | 60/30/250/40 | `dart` | 7105 `Phi tiêu` Q3 36/18/150/24 | 70081 / 70082 / 70084 (`dart2/3/6`) | 待确认 |
| 7009 | `VIP-Sấm sét` | Q4, Level=3 | 30 | 30/40/60/250 | `electricbar` | 7106 `Sấm sét` Q3 | 70091 / 70092 | 待确认 |
| 7010 | `VIP-Lu gạch` | Q4, Level=3 | 180 | 180/130/30/40 | `brick` | 7107 `Lu sành sứ` Q3 108/78/18/24 | 70101 / 70102 | 待确认 |
| 7011 | `VIP_ GIỎ ĐỒ` | Q4, Level=3 | 40 | 40/30/130/180 | `fruit` | 7108 `Giỏ trái cây` Q3 | 70111 / 70112 | 待确认 |
| 7012 | `VIP-Tủ thuốc` | Q4, Level=3 | 130 | 130/30/180/40 | `OPSbox` | 7109 `Dao phẫu thuật` Q3 | 70121 / 70122 | 待确认 |
| 7013 | `VIP-Túi vũ khí` | Q4, Level=3 | 40 | 40/180/30/130 | `closestool` | 7110 `Cái bô` Q3 | 70131 / 70132 | 待确认 |
| 7014 | `Vip TV, tủ lạnh` | Q4, Level=3 | 95 | 95/95/95/95 | `television` | 7111 `Điện gia dụng` Q3 57/57/57/57 | 70141 / 70142 | 待确认 |

**关键辨析**：`70061/70062/70064` 等模板的 `Name` 仍是 `VIP-Pháo`，只是 `Pic` 变为
`bombpack2/3/6`、属性递增。它们由 `itemstrengthengoodsinfo.xml` 在**强化达到 10/12/15 级时
`GainEquip` 换模板**得到（成功分支 `ItemStrengthenHandler.cs:126-136`），
属于**强化进阶形态**，不是另一套「极」品质。上一轮把 7006..7014 直接当作「极武器」是推测，已撤回。

## 3. 素材引用核对

| 项目 | 上游路径 | 本轮导出到 | 状态 |
| --- | --- | --- | --- |
| 持武图标（9 把候选） | `Resource/v1.1/image/arm/<Pic>/1/icon.png` | `dist/assets/items/extreme-<baseWeaponId>.png` | 已导出；正常池与测试池翻牌奖励均使用（名称标注待核对） |
| 进阶形态系列 | `Resource/v1.1/image/arm/{bombpack,bomb,dart}2/3/6/00.png` | 未接入 | 未接线（模板进阶未实现） |
| 弹丸 / 爆炸 / 持武逐帧 | `Resource/v1.1/image/arm/S<Pic>/`、`SS<Pic>/` | 复用站点版既有 13 把经典武器弹道表现 | 通过 `base_weapon_id` 复用，未导入新序列 |
| 旧版对照 `inetpub/wwwroot/Resource/image/unfrightprop/strength*` | 与武器图标无关（材料图标） | — | 见 `RULE_EVIDENCE.md` |

`dk-khoado/Gunny-3.0` 的 `store.swf` 与 `unfrightprop/strength1..10` 属于**材料/商店**资源，
两版 `strength*` 图标集合不同（旧版 1..10 全套，上游仅 1/2/3/4/9/10/11），
**不能因仓库名为 3.0 就认定素材一致**；本轮强化石图标以上游 `TemplateAlllist.xml` 的 `Pic` 字段为准。

## 4. 强化规则关系

- `CanStrengthen=true`、`CategoryID=7`、`Level=3`（`Template.Level`）。
- `Template.Level == 3` 决定 `ItemStrengthenHandler.cs:156` 的**失败降级**分支（等级 ≥5 时降 1 级）；
  基础武器 `7103..7111` 的 `Level=2`，失败走 `item.Count--`（损毁）分支。
- 本轮 `weapon_instances.template_level` 按此登记：基础武器 2、候选武器 3。
- 模板进阶 `GainEquip` **未接线**，见 `RULE_EVIDENCE.md` 的 NOT_PORTED 清单。

## 5. 阶段 10 奖励池策略

| 池 | 是否含候选武器卡 | 说明 |
| --- | --- | --- |
| `normal`（默认） | **是**，按 `DDT_REWARD_WEAPON_CHANCE=0.12` 的**单机自定义掉率** | 使用上游真实名称 +「中文品质名称待核对」标注；沿用已核实模板 ID / 属性 / Pic，不编造「极」字或素材；9 张整体洗牌，**不强制固定卡位发奖** |
| `test`（`DDT_REWARD_POOL=test`） | 是，强制含 1 张 | 独立测试奖励池：强制 2 张金币 + 1 张真强化石 + 1 张武器，用于稳定验证「翻牌 → 独立实例 → 永久入库 → 防重 → 强化」闭环；**自定义测试配置，不代表任何官方概率，也不改变正常掉落规则** |

9 张卡在服务端整体 Fisher-Yates 洗牌后落位，**无固定卡位、不按领取次序派发**；
「至少 2 张真强化石卡」只是盘面构成保底，不约束位置。
奖励盘生成时写入 `pool_version`（阶段 10 为 `v4-2026-11-28-simple-forge`）与
`rules_version`，旧盘永不重抽。

## 6. 已验证的功能（不等于中文品质映射已确认）

`tests/server/forge-rules.test.mjs` 验证：翻出后创建**独立武器实例**、
同一 `requestId` 重复/重启返回**同一实例**、`weapon_grants` 唯一约束、
房间可装备、铁匠铺可选择并可按 `SIMPLE_LOCAL_V1` 强化、
下一局 `battles.weapon_attack_precise` 与引擎 `actors[0].attack` 使用该实例属性、
`base_weapon_id` 复用经典武器弹道。

## 7. 仍未确认 / 不实现（**不再列为交付阻塞**）

- 中文「极·」命名与上游 `VIP-` 模板的对应关系：**未确认**，需中文官服物品表或客户端资源证据。
  按用户授权停止追查，UI 与奖励如实标注「中文品质名称待核对」，不推测、不翻译、不冒充。
- 进阶换模板（GainEquip）、进阶后属性重算、失败损毁/VIP/公会等上游机制：**不实现**
  （交付规则是本项目自定的单机规则，见 `docs/RULE_EVIDENCE.md`）。
- 候选武器的持武逐帧、弹丸、爆炸专属素材：**未导入**，当前复用基础武器表现
  （`base_weapon_id`），不编造专属素材。
- 正式掉率：当前 `weaponChance=0.12` 是**单机自定义概率**，不代表官方概率，
  可通过 `DDT_REWARD_WEAPON_CHANCE` 调整。
