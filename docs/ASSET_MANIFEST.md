# 原版代码与导出素材对应清单（服务端版）

> 本文件按《源码实现路径.md》第四节「音频与素材追踪入口」与交付要求整理。
> 只记录**实际读取/核对过**的内容；未读取、未导出、未匹配的项明确标注。

## 1. 参考仓库与提交（2026-11-28 实测）

| 仓库 | 结果 |
| --- | --- |
| `Fandou-Garden/boomboom`（开发仓库） | 可访问，基线 `cbfe149` |
| `Fandou-Garden/gunny-wind-arena` | 可访问，HEAD 同为 `cbfe149`（同一项目） |
| `Fandou-Garden/origin_boomboom` | HTTP 404，不可访问 |
| `Fandou-Garden/Gunny`（主参考） | HTTP 404，不可访问 |
| `phucdz2kk4/Gunny`（约定上游） | 可访问，HEAD `057c71aab877b42ebf08258aa5c642adc6a039ec` |

**重要一致性**：`dist/js/engine/constants.js:10` 的 `SOURCE_COMMIT` 正是
`057c71aab877b42ebf08258aa5c642adc6a039ec`。即既有纯 JS 战斗引擎的物理参数，
本来就是从本轮所核对的上游提交移植而来。本轮**复用该引擎**，未重写物理算法。
上游仓库全程只读，未向其推送任何修改。

## 2. 本轮实际读取的上游原版代码 / 配置

上游的 XML 配置为 **zlib 压缩**（原版客户端格式），需先解压才能阅读。

| 上游路径 | 用途 | 核对结论 |
| --- | --- | --- |
| `GameAdmin/Backup/XMLReader/XMLImport/TemplateAlllist.xml` | 全物品模板 | 解压后 5,568,096 字节、7642 个 `<Item>` 条目；玄武石与「神武石」核对依据 |
| `Tank.Request/TemplateAlllist.xml` | 对外下发的物品表 | 259,162 字节（压缩），同样为 zlib 格式 |
| `Tank.Request/itemstrengthengoodsinfo.xml` | 强化/进阶物品映射 | 解压后 150,121 字节；首条 `<Item ID="1" CurrentEquip="7006" Level="10" GainEquip="70061" OriginalEquip="7006" />` |
| `SqlDataProvider/Data/StrengthenInfo.cs` | 强化数据结构 | 字段 `Rock / Rock1 / Rock2 / Rock3 / StoneLevelMin / StrengthenLevel` |
| `SqlDataProvider/Data/StrengthenGoodsInfo.cs` | 强化装备映射结构 | 字段 `CurrentEquip / GainEquip / ID / Level / OrginEquip` |

**仅定位到路径、本轮未逐行读取**（不冒称已核对）：`Game.Logic/*.cs`、
`Game.Server/GameObjects/RobotGamePlayer.cs`、`Source Flash/src/**`、
`Game.Server/Managers/StrengthenMgr.cs`、`Tank.Data/Tank/Data/StrengThenExpMgr.cs` 等。
本轮战斗核心复用仓库内已有的 `dist/js/engine/`（Go `server/game/` 的逐字段移植），
其一致性由 `tests/engine/parity.test.mjs` 保存的 Go 金标准保证。

仓库内已有的原版摘录：`reference/original/` 20 个 C# / AS3 文件，
由既有 v1–v33 提交移植，参数对应关系见 `docs/SOURCE_MAPPING.md`。

## 3. 结算布局的源码依据

`art-source/README.md:80` 记录：`SmallCardsView` 为 **9 张 3 列（3 行）**，
`LargeCardsView` 为 21 张 7 列；中文版 18 张 6 列属另一套配置。
本轮目标「右侧 3×3 九宫格」对应 `SmallCardsView`，
因此沿用站点版已有的 `dist/assets/ui/card-*.png` 九宫格，不改用 21 卡布局。
`Source Flash/src/cardSystem/` 是另一套卡牌系统，未使用。

## 4. 已导出素材对应表

| 原始文件 / 符号 | 导出帧 / 尺寸 | 中间产物 | 前端输出 | 使用位置 |
| --- | --- | --- | --- | --- |
| `flash/ui/vietnam/swf/gameover.swf` → `asset.takeoutCard.LuckyCard` (id 122) | 1 帧 / 249×286 | `art-source/takeoutcard/LuckyCard_container_122.png` | `dist/assets/ui/card-back.png` | 结算九宫格卡背（原版宝箱） |
| 同上 → `cardMc` (id 102) | **5 帧** | `art-source/takeoutcard/cardMc/001..005.png` | `dist/assets/ui/card-flip-sprite.png` | CSS `cardFlipFrames` 翻牌动画 |
| 同上 → 空卡框 `DefineSprite_115` 第 20 帧 | 117×163 | `art-source/takeoutcard/` | `dist/assets/ui/card-face.png`、`card-frame.png`、`card-selected.png` | 卡面与选中框 |
| 同上 → `GoldBitmap(40)` / `GoldTxt(39)` / `InstructionBitmap(38)` / `TitleBitmap(29)` | 静态 | `art-source/takeoutcard/ui/*.png` | `dist/assets/ui/card-gold.png`、`card-gold-label.png`、`icon-gold.png` | 金币卡面、钱包 |
| `flash/ui/vietnam/swf/room.swf` → `asset.roomLoading.Bg` (id 107) | 1000×600 | `art-source/roomloading/Bg.jpg` | `dist/assets/ui/load-bg.jpg` | 加载过场 + 房间背景 |
| 同上 → `CharacterBg_Blue/Red` (id 117/118) | 171×208 | `art-source/roomloading/CharacterBg_*.png` | `dist/assets/ui/load-char-blue.png` / `load-char-red.png` | 房间角色框 / 机器人框 |
| 同上 → `BattleFieldBg(106)` / `FieldNameBg(95)` | 316×163 / 295×33 | `art-source/roomloading/` | `dist/assets/ui/load-field.png` / `load-name.png` | 加载过场；房间地图标题区 |
| 同上 → 角色立绘 / 光效 | — | — | `dist/assets/ui/hero-figure.png`（127×253，3 帧）、`character-light.png` | 结算角色；房间玩家角色取第一帧 |
| 地图资源 `Tank.Flash/resource/v1.1/image/map/<id>/` | 重采样至 1843×1020 | `scripts/gen-map-assets.py` | `dist/assets/map-<id>-{thumb.jpg,back.jpg,fore.webp}`、`dist/data/<id>.fore.map(.gz)` | 12 张地图；按需加载当前地图 |
| 音效 `7_Sound008` / `7_Sound048` | — | `docs/AUDIO_MAPPING.md` | `dist/assets/audio/sound-008-*.mp3`、`sound-048-card-flip.mp3` | 翻牌点击 / 翻开 |
| `Tank.Flash/resource/v1.1/image/unfrightprop/xuanwu{1..5}/icon.png` | 60×60 RGBA | `art-source/items/xuanwu1..5.png` | **`dist/assets/items/xuanwu1..5.png`（本轮新增）** | 服务端材料图标；sha256 与源文件逐一核对一致 |

本轮新增的房间 / 铁匠铺界面**没有新画的卡片或宝箱**：九宫格完全复用上表原版素材，
房间背景与角色框也是上表原版素材。

## 5. 「神武石」核对结论（未匹配，不编造）

在上游 `TemplateAlllist.xml` 解压后的 7642 个 `<Item>` 条目中：

- 包含「神武」的条目：**0**
- 包含越南语对应「Thần Vũ」的条目：**0**（含「Thần」的有 219 条，但无「Thần Vũ」组合）
- 包含「Huyền Vũ」（玄武）的条目：50 条 / 文本出现 55 次

原版实际存在的是 `Đá Huyền Vũ 1..5`（玄武石），逐条核对为：

| Name | TemplateID | Quality | `CanStrengthen` |
| --- | --- | --- | --- |
| `Đá Huyền Vũ 1` | 11005 | 1 | false |
| `Đá Huyền Vũ 2` | 11006 | 2 | false |
| `Đá Huyền Vũ 3` | 11007 | 3 | false |
| `Đá Huyền Vũ 4` | 11008 | 4 | false |
| `Đá Huyền Vũ 5` | 11031 | 5 | false |

这与 `art-source/ITEM_XUANWU.md` 的记录完全一致。该文件还指出：玄武石在原版是
**防御属性合成石**（描述「合成 +N 点防御，合成失败不消耗物品」），并非武器强化石；
另有 `xuanwujingpo0` = 玄武星石，属活动任务材料，不可混用。

**处理**：「神武石」在数据库 `unmatched_items` 中登记为 `unmatched` 并写明上述证据；
未编造 TemplateID、未改物品名、未用玄武石冒充神武石。
服务端普通强化石链路使用名称、TemplateID、图标均可核对的原版玄武石 1~5 级，
但**明确标注为单机临时规则下的材料用途**，不声称这是原版强化石。

## 6. 原版强化机制核对（不混用不同版本规则）

上游证据显示原版强化涉及：

- `StrengthenInfo.cs`：`Rock / Rock1 / Rock2 / Rock3 / StoneLevelMin / StrengthenLevel`
- `StrengthenGoodsInfo.cs` + `itemstrengthengoodsinfo.xml`：按 `CurrentEquip / Level / GainEquip / OriginalEquip`
  做**装备进阶**（如 Level 10 → GainEquip 70061），不是简单的等级 + 攻击
- 另有 `StrengthenMgr.cs`、`ItemStrengthenHandler.cs`、`StrengThenExpMgr.cs`、
  `StrengthenDataAnalyzer.as` 等共同决定成功率、经验与消耗

本轮**未完整移植**这套机制：它跨多个版本与服务端/客户端配置，直接拼装会把不同版本规则混在一起
（《源码实现路径.md》明确禁止）。因此铁匠铺使用 `server-node/src/config.ts` 中
`ruleSource: 'LOCAL_RULE'` 的**单机临时规则**，界面上写明「不代表原版成功率与消耗」，
并在 `docs/PROGRESS.md` 记录差异。原版配置可作为后续替换入口的数据源。

## 7. 缺失项与可替换入口（不冒充原版）

| 缺失项 | 状态 | 替换入口 |
| --- | --- | --- |
| 原版铁匠铺 UI（`StoreIIStrengthBG`、`StreangthItemCell`、`StrengthStone`、`StrengthTips` 等） | **未导出** | `dist/js/server-mode.js` 中 `data-asset-slot="forge-panel"`；界面已标注「原版铁匠铺 UI 素材未导出 · 单机临时界面」 |
| 原版强化成功 / 失败音效 | **未导出** | 暂用站点版既有 `win` / `lose` 音效（`docs/AUDIO_MAPPING.md`），不冒称原版强化音效 |
| `lightFrame` / `vipCardMc` / `starMc` / `Hexagram` / `VersusAnimation` / `GameMode_*` 逐帧序列 | 已在 `art-source/` 导出，`dist/` **未接入** | `art-source/README.md` 帧清单 + `dist/styles.css` 动画 |
| `art-source/audio/room-bgm-065.mp3`、`hall-bgm-062.mp3` | 已导出**未接线** | `art-source/AUDIO.md` |
| 房间 / 铁匠铺的原版界面布局 | 原版为 Flash/AS3，仓库无对应导出 | 房间布局为服务端版新增，界面内已明确标注 |
| 「神武石」 | **未匹配** | `unmatched_items` 表 + 本文件第 5 节 |

## 8. 规则配置入口

- 机器人 / 翻牌 / 强化数值：`server-node/src/config.ts`（全部服务端权威）
- 物品登记：`server-node/migrations/001_init.sql` 与 `server-node/src/services.ts` 的 `ITEM_SEED`
- 前端模式切换：`dist/js/data-api.js`（offline / server 统一接口）
- 音效事件映射：`docs/AUDIO_MAPPING.md`
