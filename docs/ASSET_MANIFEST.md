# 原版代码与导出素材对应清单（服务端版）

> 本文件按《源码实现路径.md》第四节「音频与素材追踪入口」与交付要求整理。
> 只记录**实际读取/核对过**的内容；未读取、未导出、未匹配的项明确标注。
>
> **阶段 10 交付规则声明**：界面 / 武器素材 / 动画 / 音效来自原版，
> 强化算法是本项目自定的**单机自定义强化规则**（`SIMPLE_LOCAL_V1`），
> 统一标注「原版素材 + 单机自定义强化规则」，**不是原版强化算法**。
> 用户已授权简化，不再追查原版属性成长公式与「极·」品质映射；
> 本文件第 6 节的原版机制核对仅作研究证据存档，不参与运行时计算。

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

本项目**未移植**这套机制：它跨多个版本与服务端/客户端配置，直接拼装会把不同版本规则混在一起
（《源码实现路径.md》明确禁止）。阶段 8 曾以 `ORIGINAL_PARTIAL` 局部实现并明确标注未还原项；
**阶段 10 按用户授权彻底简化**，运行时统一为 `server-node/src/config.ts` 的
`SIMPLE_LOCAL_V1`（+0~+12、1 颗真强化石 + 100×目标等级金币、100% 成功、
基础伤害 = 未强化基础值 ×(1+0.10×等级)），界面写明「原版素材 + 单机自定义强化规则，
不是原版强化算法」。本节的源码核对结果保留为研究证据，见 `docs/RULE_EVIDENCE.md`。

## 7. 缺失项与可替换入口（不冒充原版）

> **阶段 9 / 阶段 10 更新（2026-11-28）**：下表状态已变化，以本节为准；
> 原始历史状态保留在 `docs/PROGRESS.md` 的阶段 8 记录中，不回写。
> 阶段 10 的规则标注统一为「原版素材 + 单机自定义强化规则」，不再列「原版规则缺失」为阻塞项。

| 缺失项 | 状态（阶段 10 复核） | 替换入口 / 证据 |
| --- | --- | --- |
| 原版铁匠铺 UI（`StoreIIStrengthBG`、`StreangthItemCell`、`StrengthStone` 等） | **已从 `store.swf` 导出并按 `store.xml` 布局接入**（红金色 `strengthBG` 底纹 + 6 个真实槽位 + 装备栏 + 道具栏 + 成功率区，支持点选与拖放）。阶段 10 按单机规则只启用 0 号强化石槽与 5 号装备槽，其余置灰。**界面素材是原版，强化规则不是原版** | `dist/assets/forge/`（23 个素材 + `SOURCE_MANIFEST.json`）、`dist/js/server-mode.js`、`docs/FORGE_UI_EVIDENCE.md` |
| 原版强化成功 / 失败音效 | **未确认**：结果音封装在上游 `StoreTips`，本次检出无该 AS 源码，无法确认 SoundID | 暂用站点版既有 `win` / `lose`；`docs/AUDIO_EVIDENCE.md` |
| `lightFrame` / `vipCardMc` / `starMc` / `Hexagram` / `VersusAnimation` / `GameMode_*` 逐帧序列 | 已在 `art-source/` 导出，`dist/` **未接入** | `art-source/README.md` 帧清单 + `dist/styles.css` 动画 |
| 房间 / 大厅 / 地图 BGM 与 014 / 067 倒计时音效 | **已接线**：14 条原版长音乐 + 2 条短音效，从 `Resource/sound/*.flv` 与 `audio.swf` 导出 | `dist/assets/audio/`、`dist/js/audio-scenes.js`、`docs/AUDIO_MAPPING.md` |
| 房间 / 铁匠铺的原版界面布局 | 铁匠铺布局已按 `store.xml` 还原；**房间**仍为服务端版新增布局（原版 Flash/AS3 无对应导出），界面内已明确标注 | `docs/FORGE_UI_EVIDENCE.md` |
| 「神武石」 | **未匹配**（保持不变，不编造） | `unmatched_items` 表 + 本文件第 5 节 |

## 8. 阶段 9 新增素材溯源

| 目录 | 数量 | 原版来源 | 导出方式 |
| --- | --- | --- | --- |
| `dist/assets/forge/` | 23 张图 + 1 份 `SOURCE_MANIFEST.json` | `/tmp/gunny-30/inetpub/wwwroot/gunny/ui/vietnam/swf/store.swf`（762,769 B） | FFDec `-export image,symbolClass`，共 125 个符号 / 124 张图；按符号名逐一映射，清单内记录字节数与 SHA-256 |
| `dist/assets/audio/bgm-*.mp3` | 14 条 | `/tmp/gunny-30/inetpub/wwwroot/Resource/sound/<id>.flv` | FLV tag 解析无损抽出内嵌 MP3 帧（不重编码） |
| `dist/assets/audio/sound-014-countdown.mp3`、`sound-067-countdown.mp3` | 2 条 | `/tmp/gunny-30/inetpub/wwwroot/gunny/audio.swf` → `Sound014` / `Sound067` | FFDec `-export sound` 得 FLV（Nellymoser），静态 FFmpeg 解码为 44.1 kHz 单声道 MP3 |

布局坐标来自 `/tmp/gunny-30/inetpub/wwwroot/gunny/ui/vietnam/xml/xml/store.xml`
（`Strengthpoint0..5`、`StrengthBtn x=72 y=322`、`StoreBagView x=405 y=59` 等），
逐项证据见 `docs/FORGE_UI_EVIDENCE.md`。**上游 UI 与用户提供的红金色截图差异、
以及未确认项，均在该文档中如实标注，未写成「原版界面已完全还原」。**

## 9. 规则配置入口（阶段 10）

- 强化 / 翻牌 / 机器人数值：`server-node/src/config.ts` 的 `forge` / `rewards` / `bot`，
  全部服务端权威；当前规则 `SIMPLE_LOCAL_V1`「原版素材 + 单机自定义强化规则」。
- 强化执行、消耗、精度与防重：`server-node/src/services.ts` 的 `strengthen()` /
  `attackForLevel()` / `simpleForgeCost()`。
- 旧存档迁移：`server-node/migrations/004_simple_forge.sql`（逐件备份 + 一次性重算，
  验证见 `docs/MIGRATION_VERIFICATION.md`）。
- 物品登记：`server-node/migrations/001_init.sql`、`002_item_classification.sql`
  与 `server-node/src/services.ts` 的 `ensurePlayer()` / `original-data.ts`。
- 前端模式切换：`dist/js/data-api.js`（offline / server 统一接口）。
- 音效事件映射：`docs/AUDIO_MAPPING.md`；铁匠铺 UI 证据：`docs/FORGE_UI_EVIDENCE.md`；
  原版强化链路研究证据（不参与运行时）：`docs/RULE_EVIDENCE.md`。
