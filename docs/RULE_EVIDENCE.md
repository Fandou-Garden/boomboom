# 强化材料分类与原版强化规则证据

> 核对日期：2026-11-28 · 上游 `phucdz2kk4/Gunny @ 057c71a`
> 旧版对照 `dk-khoado/Gunny-3.0` 仅用于素材对照，**规则以下列上游 C#/AS/XML 为准**。
> **本轮不报告「原版强化已还原」**：属性计算未找到、模板进阶/损毁/VIP/公会/开孔/绑定未接线。

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
本项目 `originalRuleFor()` 返回 `rock / probability / luckyContribution / successRate`，
`successRate = min(1, (probability + luckyContribution) / rock)`，随机源由服务端 `forgeRoll()` 提供。

## 3. 两套规则分离与界面显示

| 配置 | 默认 | 启用方式 | 标记 |
| --- | --- | --- | --- |
| 单机临时规则 | **是** | `DDT_FORGE_RULES=local`（默认） | `LOCAL_RULE` |
| 原版核心链路 | 否 | `DDT_FORGE_RULES=original` | `ORIGINAL_PARTIAL` |

- 默认走 `LOCAL_RULE`，因为原版完整链路尚未还原；**不能默认启用并报告「原版强化完成」**。
- `ORIGINAL_PARTIAL` 已实现：三槽、幸运符、神恩符、概率公式、等级表(1..15)、失败保护/降级、无金币扣费。
- 明确未接线：`VIP num3`、`公会 num4`、`isPlayerWarrior`、`GainEquip 模板进阶`、
  `失败 Count-- 损毁`、`OpenHole 开孔`、`IsBinds 绑定`、`StoneLevelMin 服务端校验`、
  `武器属性成长公式`。
- 属性成长：两套规则目前都用 `LOCAL_ATTACK_PER_LEVEL=25`，但 `original` 分支在
  `originalDetail.attackGrowth` 与响应 `attackGrowthSource` 中明确标注
  `LOCAL_RULE_SUPPLEMENT（原版属性成长未还原）`，**不声称是原版数值**。
- 界面：铁匠铺顶部摘要始终显示「当前规则 / 规则来源 / 属性成长 / 未还原项数 / 武器映射」，
  材料列下方列出逐项证据；右栏显示武器的 `ruleVersion`。
  `GET /api/server/rules` 与 `GET /api/server/forge` 也返回同一份信息。
- 可注入随机源 `DDT_FORGE_RANDOM`：`always-success` / `always-fail` / `fixed:<0..1>` /
  `sequence:a,b,c`，**仅用于自动化测试**，未设置时用单局种子。

## 4. 测试覆盖（`tests/server/forge-rules.test.mjs`）

| 要求 | 覆盖 |
| --- | --- |
| 材料数量与槽位校验 | 重复槽 400、合成石 409、>3 槽截断为 3、成功按槽各扣 1 |
| 幸运符生效 | `luckyContribution` 0 / 0.75 / 1.75 递增，归一化概率分子递增 |
| 神恩符生效 | `Template.Level=3` 且 Lv6 武器：无符失败降 1 级、有符不降级 |
| 成功 / 失败 / 上限 / 金币不足 / 材料不足 | `always-success` / `always-fail` / Lv15 409 / `LOCAL_RULE` 金币 0 → 409 / 只有玄武石 → 409 |
| 同一请求重复执行与并发 | 重放 deepEqual、同 requestId 并发只升 1 级、不同 requestId 并发各升 1 级不丢失更新 |
| 旧存档迁移 / 重启恢复 | `tests/server/migration.test.mjs`、`tests/server/e2e.test.mjs` |
| 装备后下一场属性与表现 | `/api/state` 的 `actors[0].attack`、`battles.weapon_attack/weapon_id/variant` |
| 随机不碰概率 | 全部通过 `DDT_FORGE_RANDOM` 注入 |

## 5. 仍未还原 / 未完成

- 原版铁匠铺红金色 UI（三强化石槽 / 幸运符槽 / 神恩符槽 / 装备栏 / 道具栏 / 成功率区域）、
  拖放或点选交互、原版强化音效：**未实现**，当前为明确标注的单机临时界面。
- 原版音乐与音效（房间 065、大厅 062、翻牌 048、倒计时 067/014、胜负 063/064、
  地图 `BackMusic`、`store.swf`）：**未接入**，见 `docs/AUDIO_MAPPING.md`。
- 模板进阶、损毁、开孔、绑定、VIP/公会加成、武器属性成长公式：**未接线**。
- 「神武石」：`unmatched`。
- 中文「极·」武器映射：`UNCONFIRMED`，见 `docs/WEAPON_MAPPING_EVIDENCE.md`。
