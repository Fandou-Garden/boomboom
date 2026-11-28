# 强化材料分类与原版强化规则证据

> 核对日期：2026-11-28 · 上游 `phucdz2kk4/Gunny @ 057c71a`
> 旧版对照 `dk-khoado/Gunny-3.0` 仅用于素材对照，**规则以下列上游 C#/AS/XML 为准**。

> ## ⚠️ 阶段 10 交付规则声明（2026-11-28，用户授权简化）
>
> **当前交付 =「原版素材 + 单机自定义强化规则」(`SIMPLE_LOCAL_V1`)，不是原版强化算法。**
> 用户已明确授权：不再追求强化规则 100% 还原，停止追查 `ItemStrengthenData.xml`、
> 原版属性成长公式与「极·」品质映射；已有研究证据保留、不继续扩大搜索范围。
>
> - 本文件第 1 节的**物品分类映射仍然有效且是运行时依据**（真强化石 / 合成石 / 符咒的区分）。
> - 第 2 节及以下的原版执行链、`ORIGINAL_PARTIAL` / `LOCAL_RULE` 两套规则、
>   `DDT_FORGE_RULES` / `DDT_FORGE_RANDOM`、可注入随机源、概率公式、失败降级等
>   **全部是研究证据存档，已从运行时代码移除，不再生效**。
> - 运行时规则集中在 `server-node/src/config.ts` 的 `forge` 与 `server-node/src/services.ts`
>   的 `strengthen()`：+0 起、上限 +12、每次 1 颗真强化石 + `100×目标等级` 金币、
>   成功率 100%、等级 +1、不降级不损毁、基础伤害 = 未强化基础值 ×(1+0.10×等级)。
> - 幸运符 / 神恩符不参与计算，槽位置灰，物品保留；四圣兽合成石仍禁止作为强化材料。
> - **「原版强化完整规则缺失」不再列为交付阻塞项**，也不得把本项目规则写成「原版已还原」。
> - 现行测试见 `tests/server/forge-rules.test.mjs`（已按 `SIMPLE_LOCAL_V1` 整体重写）。

## 1. 物品分类映射（模板ID → 名称 → 类别 → 用途 → Pic → 图标路径 → 处理方法）

数据来源：`Tank.Request/TemplateAlllist.xml`（zlib 压缩，7642 条）。
判定依据：`Game.Server/Packets/Client/ItemStrengthenHandler.cs:37-81`。
图标路径：`Resource/v1.1/image/unfrightprop/<Pic>/icon.png` → 导出到 `dist/assets/items/<Pic>.png`。

### 1.1 强化石（真）：`CategoryID=11 && Property1=2`

| 模板ID | 原名 | 类别 | 用途 | Level | RateItems | Pic | 图标路径 | 处理方法 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 11019 | `Đá cường hóa 1` | strength-stone | 槽 0/1/2 | 1 | 0.75 | `strength1` | `.../strength1/icon.png` | `Handler:40-57` 累加 `RateItems[Level-1]` 到 `probability` |
| 11021 | `Đá cường hóa 2` | strength-stone | 槽 0/1/2 | 2 | 3.0 | `strength2` | `.../strength2/icon.png` | 同上 |
| 11022 | `Đá cường hóa 3` | strength-stone | 槽 0/1/2 | 3 | 12.0 | `strength3` | `.../strength3/icon.png` | 同上 |
| 11023 | `Đá cường hóa 4` | strength-stone | 槽 0/1/2 | 4 | 48.0 | `strength4` | `.../strength4/icon.png` | 同上 |
| 11024 | `Đá cường hóa 5` | strength-stone | 槽 0/1/2 | 5 | 240.0 | **`strength9`** | `.../strength9/icon.png` | 同上；**Pic 与等级不一一对应，不能按目录名推断** |
| 11025 | `Đá cường hóa 6` | strength-stone | 槽 0/1/2 | 6 | 768.0 | **`strength11`** | `.../strength11/icon.png` | 同上 |

注：`CategoryID=11 && Property1=35` 也是服务端判定分支，但**本版本物品表中该 Property1 无条目（计数 0）**，未虚构物品。
`strength10` / `strengthcertificate` / `strength9package` 只是 Pic/名字含 strength，实际不是强化石。

### 1.2 幸运符与神恩符

| 模板ID | 原名 | 类别 | 用途 | Property2 | Pic | 图标路径 | 处理方法 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 11017 | `Bùa may mắn 15%` | lucky-charm | 槽 4 | 15 | `symbol1` | `.../symbol1/icon.png` | `Handler:58-69` `num2 += probability + (Property2/100)` |
| 11018 | `Bùa may mắn 25%` | lucky-charm | 槽 4 | 25 | `symbol3` | `.../symbol3/icon.png` | 同上 |
| 11029 | `Bùa may mắn 50%` | lucky-charm | 槽 4 | 50 | `symbol5` | `.../symbol5/icon.png` | 同上 |
| 11028 | `Bùa may mắn 100%` | lucky-charm | 槽 4 | 100 | `symbol4` | `.../symbol4/icon.png` | 同上 |
| 11020 | `Bùa ma thuật` | god-charm | 槽 3 | 0 | `symbol2` | `.../symbol2/icon.png` | `Handler:70-81` 置 `isGod`，失败时跳过降级/损毁 |

**重要（不得按常识补写）**：`luck.Template.Property2 / 100` 在 C# 中是**整数除法**：
15/25/50 档结果为 `0`，只有 100 档为 `1`。
因此幸运符的主要作用其实是**再叠加一份 `probability`**，并非「+15% 成功率」。
本项目按源码原样实现，并在 `originalDetail.luckyContribution` 中返回该值供核对。

### 1.3 四圣兽合成石（**不是强化材料**）：`CategoryID=11 && Property1=1`

| 家族 | 模板ID | 原名 | FusionType | 用途 | Pic | 图标路径 | 处理方法 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 朱雀 | 11001/11002/11003/11004/11030 | `Đá Chu Tước 1..5` | 1 | 合成加攻击 | `zhuque1..5` | `.../zhuque<N>/icon.png` | **强化消耗拒绝**；仅登记展示 |
| 玄武 | 11005/11006/11007/11008/11031 | `Đá Huyền Vũ 1..5` | 2 | 合成加防御 | `xuanwu1..5` | `.../xuanwu<N>/icon.png` | **强化消耗拒绝**；001 误登记已在 002 迁移纠正 |
| 青龙 | 11009/11010/11011/11012/11032 | `Đá Thanh Long 1..5` | 3 | 合成加敏捷 | `qinglong1..5` | `.../qinglong<N>/icon.png` | 同上 |
| 白虎 | 11013/11014/11015/11016/11033 | `Đá Bạch Hổ 1..5` | 4 | 合成加幸运 | `baihu1..5` | `.../baihu<N>/icon.png` | 同上 |

**「神武石」**：上游 7642 条中 `神武` / `Thần Vũ` 均 0 命中，登记在 `unmatched_items` 为 `unmatched`，
未编造 ID、未用玄武石冒充。

## 2. 完整服务端执行链（逐项证据）

链路：客户端提交 → `ITEM_STRENGTHEN` 包 → 槽位读取 → 配置查找 → 概率/随机 → 属性更新 → 消耗 → 返回。

| 项 | 源码文件 / 方法 | 配置字段 | 实际分支 | 本轮状态 |
| --- | --- | --- | --- | --- |
| 客户端提交 | `Source Flash/src/store/view/strength/StoreIIStrengthBG.as:582-625` `__strengthClick` → `sendSocket()` | `_items[0..5]`、`rateItems=[0.75,3,12,48,240,768]` | 等级 ≥ `PathManager.solveStrengthMax()` 拒绝；等级 >5 且槽 3 无神恩符时弹确认框；等级 5 弹提示；`SoundManager.play("008")` | 客户端 UI 未还原，仅记录 |
| 三强化石槽 | `ItemStrengthenHandler.cs:40-57` `HandlePacket` | `GetItemAt(0/1/2)`、`CategoryID=11`、`Property1=2\|35`、`RateItems[Level-1]`、`!stones.Contains` | `stones.Count>=1` 才继续，否则发 `Content1` 提示；三个槽不允许同一物品 | **PORTED** |
| 幸运符 | `ItemStrengthenHandler.cs:58-69,82-83` | 槽 4、`Property1=3`、`num2 += probability + trunc(Property2/100)` | 无合法符时 `num2=0` | **PORTED** |
| 神恩符 | `ItemStrengthenHandler.cs:70-81,154-181` | 槽 3、`Property1=7`、`isGod` | 失败且 `isGod` 时原样放回槽 5 | **PARTIAL**（损毁未接线） |
| 概率公式 | `ItemStrengthenHandler.cs:82-83,105-121` | `num5=probability*100/Rock`；`num6=num2*100/Rock`；`num7=floor((num5+num6+num4+num3)*100)`；`num8=RandomSafe.Next(10000)` | `num7>num8` 成功；VIP `num3=0.3*num5`（`typeVIP>0`）；公会 `num4=num5*0.1*SmithLevel`；`isPlayerWarrior()` 时 `num8=0` | **PARTIAL**（VIP/公会/warrior 未接线） |
| 配置查找 | `StrengthenMgr.cs:360-382` `GetNeedRate(ItemInfo)` | `FindStrengthenInfo(StrengthenLevel+1).Rock`（`CategoryID 7/27`）；`Rock1/2/3` 用于其他类别 | `Tank.Request/ItemStrengthenList.xml`：1..15 级 Rock `2,7,28,113,227,854,2008,7816,11692,17430,21287,26079,34079,39079,48800`；`StoneLevelMin` 1..5 **服务端未校验** | **PARTIAL** |
| 等级上限 | `StrengthenMgr.cs:363` + `ItemStrengthenList.xml` 最大 15；客户端 `PathManager.solveStrengthMax()` → `STHRENTH_MAX` | `StrengthenLevel+1` 查表 | 服务端**无显式上限判断**，`FindStrengthenInfo` 无 null 检查，超过配置最大级会异常；客户端另有 `STHRENTH_MAX`（运行期配置，值未在仓库中找到） | **PARTIAL**（本版显式上限 15） |
| 失败降级/损毁 | `ItemStrengthenHandler.cs:154-181` | `item.Template.Level==3`、`StrengthenLevel>=5`、`item.Count--` | `Level==3` → ≥5 降 1 级 + `FindRealStrengthenGoodInfo` 回退模板；否则 `Count--` 销毁；`isGod` 时全部跳过 | **PARTIAL**（降级已实现；损毁/回退模板标记 NOT_PORTED，单机存档不销毁装备） |
| 模板进阶 | `ItemStrengthenHandler.cs:126-136` + `itemstrengthengoodsinfo.xml` | `FindStrengthenGoodsInfo(level, TemplateID).GainEquip > TemplateID` → `ItemInfo.CloneFromTemplate` | 仅 `CategoryID=7`；成功且 10/12/15 级换模板（7006→70061/70062/70064） | **NOT_PORTED** |
| 属性计算 | `ItemStrengthenHandler.cs:137-139,186-189` + `itemstrengthendata.xml` | `ItemInfo.OpenHole`、`EquipBag.UpdatePlayerProperties()` | 武器 attack 成长公式**未导出**；`itemstrengthendata.xml` 只含副手 `17003/17004`（`CategoryID=17`，盾牌），与武器无关；仓库中不存在 `ItemStrengthenData.xml`（客户端 `StrengthDataManager.as:53` 请求它，疑为运行期生成） | **UNKNOWN / 未还原** |
| 扣费 | `ItemStrengthenHandler.cs:113` | `StoreBag.ClearBag()` | **该包处理中没有金币扣费**，只消耗槽位物品 | **PORTED** |
| 绑定/开孔 | `ItemStrengthenHandler.cs:84-87,137,182` | `IsBinds`、`ItemInfo.OpenHole` | 任一道具绑定则装备绑定；成功/失败都开孔 | **NOT_PORTED** |

### 2.1 概率公式（逐行）

```
probability = Σ RateItems[stone.Level - 1]        // 槽 0/1/2，最多 3 颗且互不相同
num2        = lucky ? probability + trunc(Property2/100) : 0   // C# 整数除法
num5        = probability * 100 / GetNeedRate(item)
num6        = num2        * 100 / GetNeedRate(item)
num4        = isconsortia ? num5 * 0.1 * SmithLevel : 0        // 未接线
num3        = typeVIP>0   ? 0.3 * num5 : 0                     // 未接线
num7        = floor((num5 + num6 + num4 + num3) * 100)
num8        = RandomSafe.Next(10000)                            // 服务端随机
成功        = num7 > num8
→ 成功率 ≈ (probability + num2) / Rock
```
阶段 8 曾有 `originalRuleFor()` 返回 `rock / probability / luckyContribution / successRate`、
并由服务端 `forgeRoll()` 提供随机源；**该实现已在阶段 10 从运行时移除**，此处仅保留公式推导记录。
现行规则成功率恒为 100%，不使用随机源。

## 3. 历史两套规则（阶段 8，已下线，仅存档）

| 配置 | 阶段 8 默认 | 当时启用方式 | 标记 | 阶段 10 状态 |
| --- | --- | --- | --- | --- |
| 单机临时规则 | 是 | `DDT_FORGE_RULES=local` | `LOCAL_RULE` | **已移除** |
| 原版核心链路 | 否 | `DDT_FORGE_RULES=original` | `ORIGINAL_PARTIAL` | **已移除** |

- 阶段 8 曾实现三槽、幸运符、神恩符、概率公式、等级表(1..15)、失败降级、无金币扣费；
  明确未接线：`VIP num3`、`公会 num4`、`isPlayerWarrior`、`GainEquip 模板进阶`、
  `失败 Count-- 损毁`、`OpenHole 开孔`、`IsBinds 绑定`、`StoneLevelMin 服务端校验`、
  `武器属性成长公式`。这些结论作为研究证据保留。
- 属性成长当时用 `LOCAL_ATTACK_PER_LEVEL=25`（并标注 `LOCAL_RULE_SUPPLEMENT`）；
  004 迁移据此反推旧存档的未强化基础值，**迁移完成后不再使用该值**。
- 界面当时显示「当前规则 / 规则来源 / 属性成长 / 未还原项数 / 武器映射」；
  阶段 10 改为显示 `SIMPLE_LOCAL_V1`、上限、成功率 100%、每次 1 颗真强化石、
  金币 / 材料 / 伤害预览与禁用槽位说明。
- `DDT_FORGE_RANDOM` 可注入随机源（`always-success` / `always-fail` / `fixed` / `sequence`）
  **已从运行时移除**；现行规则成功率 100%，测试改为精确断言而非碰概率。

## 4. 阶段 10 现行规则与测试覆盖

运行时规则（`server-node/src/config.ts` → `forge`）：

| 项 | 值 |
| --- | --- |
| 规则名 / 标注 | `SIMPLE_LOCAL_V1` / 原版素材 + 单机自定义强化规则 |
| 初始 / 上限 | `+0` / `+12` |
| 每次消耗 | 1 颗真强化石（所有已确认等级统一一次机会）+ `100 × 目标等级` 金币 |
| 成功率 / 等级变化 | 100% / `+1`，不降级、不损毁 |
| 基础伤害 | 未强化基础值 × `(1 + 0.10 × 强化等级)`；`+1`=110%，`+12`=220% |
| 引擎接入字段 | 原版 `sourceDamage()`（`dist/js/engine/physics.js`）为 `baseDamage * (1 + attack*0.001)`；`attack` 是 Player 四维属性。倍率只乘 `actor.baseDamage`（原版 360），`actor.attack` 恒 100。证据：`dist/js/engine/match.js` 的 `BASE_DAMAGE/ATTACK` 与 `server-node/src/battle/engine-host.ts` |
| 精度 | `weapon_instances.attack_precise` 保留 6 位小数，最终伤害取整沿用战斗引擎 |
| 符咒 / 合成石 | 不参与计算、槽位置灰、物品保留；服务端拒绝作为材料 |
| 影响范围 | 仅武器基础伤害；不改弹道 / 风力 / 爆炸范围 / 角度范围 |

`tests/server/forge-rules.test.mjs`（已整体重写）覆盖：

| 要求 | 覆盖 |
| --- | --- |
| 公式不叠乘 | +0→+1→+2→+3 断言 100/110/120/130，`base_attack` 恒为 100 |
| 消耗与预览 | 金币 100/200/300、材料恒 1 颗、成功率 100%、伤害预览 |
| 金币 / 材料不足 / 合成石 | 409 + 明确文案；`forge()` 的 `reason` 同步给出原因 |
| `+12` 上限 | 从 +0 连续强化 12 次到 220%，第 13 次 409 `max-level` |
| 前端不得决定结果 | `success/level/attack/coins/slots/luckyCharm/godCharm` 一律 400 |
| 幂等 / 并发 | 同 `requestId` 重放 deepEqual、跨武器复用 409、并发不丢失更新、重复点击不重复扣费 |
| 旧存档 / 重启 | `tests/server/migration.test.mjs`（004）、`tests/server/e2e.test.mjs` |
| 装备后下一局 | `/api/state` 的 `actors[0].attack`、`battles.weapon_attack_precise/variant`、小数精度保留 |

## 5. 研究证据中仍未还原项（**不再列为交付阻塞**）

> 阶段 10 更新：用户已授权简化强化算法，以下「未还原」是**对上游原版的研究结论**，
> 不是本项目交付缺口，也不再阻塞交付。阶段 9 已接入原版铁匠铺 UI 与原版音乐音效。

- 原版铁匠铺红金色 UI（三强化石槽 / 幸运符槽 / 神恩符槽 / 装备栏 / 道具栏 / 成功率区域）、
  点选 / 拖放交互：**阶段 9 已实现**（`store.swf` 素材 + `store.xml` 点位 + 真实 DOM）；
  阶段 10 按单机规则只启用 0 号强化石槽与 5 号装备槽，其余置灰并说明原因。
  原版强化结果音效仍**未确认**（`StoreTips` 源码缺失）。
- 原版音乐与音效（房间 065、大厅 062、翻牌 048、倒计时 067/014、胜负 063/064、
  地图 `BackMusic`）：**阶段 9 已接入**；铁匠铺无独立 BGM，战前加载无独立音乐调用证据。
  见 `docs/AUDIO_MAPPING.md`、`docs/AUDIO_EVIDENCE.md`。
- 上游原版未接线/未导出：模板进阶、损毁、开孔、绑定、VIP/公会加成、武器属性成长公式。
  本项目不实现这些机制，也不声称还原。
- 「神武石」：`unmatched`（上游无此物品，未编造 ID）。
- 中文「极·」品质映射：无法证明，改用**上游真实名称 + 「中文品质名称待核对」**标注；
  不阻塞交付，可作为翻牌武器奖励。见 `docs/WEAPON_MAPPING_EVIDENCE.md`。
