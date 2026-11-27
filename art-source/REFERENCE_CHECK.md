# 原版截图 ↔ 仓库导出元件 逐项核对

> 输入：用户提供的 4 张原版截图（存 `_reference/01-battle.png` … `04-loading.png`）。
> 方法：把截图与 `art-source/` 里 FFDec 导出的元件放大并排比对，不靠印象、不靠截图臆造。
> `dist/` 一行未改。

## 0. 先勘误：我上一轮把卡背看错了

上一轮我把 `cardMc` 第 1 帧描述成「木牌带开字」——**错的**。原因是当时把 5 帧拼成 8050 px 宽的窄条，图片被压缩后细节丢失，我又没有放大复核。

放大 2 倍重看 `art-source/takeoutcard/cardMc/001.png`：

> **橙红色卷草纹边框 + 中央木纹宝箱**，与截图 03 里的卡背**完全一致**。

`LuckyCard_container_122.png`（249×286）同样是该卡背加白色外框。
`cardMc/005.png` 是翻开后的**米白卡面 + 底部橙色名字条**，也与截图一致。

顺带澄清 `docs/HANDOFF_PROMPT.md` 第 46 行「`cardbox/*/icon.png` 是宝箱图标不是卡面」：这句说的是**它单独只是一个图标文件**，没错；但不要据此以为原版卡背不含宝箱 —— 卡背中央画的正是宝箱。

## 1. 逐项对照

| 截图元素 | 仓库元件 | 出处 | 结论 |
|---|---|---|---|
| 橙红卷草纹 + 宝箱卡背 | `cardMc/001.png` / `LuckyCard(122)` | `gameover.swf` id 102 / 122 | ✅ 一致 |
| 翻牌过程（卡背→窄条→发光→卡面） | `cardMc/001..005.png` | 同上，5 帧 | ✅ 一致 |
| 米白卡面 + 底部橙色名字条 | `cardMc/005.png` | 同上 | ✅ 一致 |
| 已翻卡的**绿色荧光描边** | `lightFrame/001..035.png` | 同上 id 107，黄绿发光圆角框 | ✅ 一致 |
| VIP 卡的**橙红描边** | `vipLightFrame/001..035.png` | 同上 id 115 | ✅ 一致 |
| 翻卡星光 | `starMc/001..014.png` | 同上 id 121 | ✅ 有 |
| 中央**火焰 VS** | `VersusAnimation/001..059.png` | `room.swf` id 161 | ✅ 一致 |
| VS 背后暗紫八卦法阵 | `Hexagram/001..030.png`（全量 600 帧） | `room.swf` id 153 | ✅ 一致 |
| 加载页深蓝紫背景 | `Bg.jpg` 1000×600 | `room.swf` id 107 | ✅ 一致 |
| 蓝/红角色底板 | `CharacterBg_Blue/Red.png` 171×208 | `room.swf` id 117/118 | ✅ 蓝红渐变 + 细边框 |
| 底部战场框 / 名称条 / 小贴士底板 / OK 印章 | `BattleFieldBg` / `FieldNameBg` / `TipsItemBg` / `LoadingOK` | `room.swf` id 106/95/60/41 | ✅ 有 |
| 倒计时数字 0–9 | `takeoutcard/ui/countdown-0..9.png` | `gameover.swf` id 65–74 | ✅ 有 |

## 2. 明确对不上的 4 处（版本差异，不硬凑）

### 2.1 翻牌行列数

| | 列 × 行 | 总数 |
|---|---|---|
| 截图 03 | **6 × 3** | 18 |
| `SmallCardsView.as:35,68` | 3 × 3 | **9**（`SMALL_CARD_CNT=9`, `_cardColumns=3`） |
| `LargeCardsView.as:27,29` | 7 × 3 | **21**（`LARGE_CARD_CNT=21`, `LARGE_CARD_COLUMNS=7`） |

三者都是 3 行，列数不同。素材（单卡）一致，**布局参数不一致**，截图应来自另一套配置/版本。接这份仓库源码就用 9 或 21，不要照截图写 18。

### 2.2 角色框内的金色圆形罗盘光环 + 角色立绘

截图 04 每个角色框里有一个金色圆形符文光环。仓库 `CharacterBg_*` 只是纯色底板，不含光环。

实证找过：

- 全库 120 个 SWF 解压扫 `roomLoadingPlayerItem` / `circlelight` / `headFrame` / `RoundFrame` → **0 命中**（仅 `room.swf` 有 `FigureFrame`）
- `room.xml:217` 里 `asset.roomLoadingPlayerItem.iconContainer` 只是个 VBox 容器，不是图形
- `image/equip/circlelight/{1,2,4}.swf` 导出后是 `game.crazyTank.view.light.CircleLightAsset_*`，其中 `4.swf` **确实是金色圆形罗盘光环**（视觉高度相似），但归属是**疯狂坦克战斗特效**，不是加载页组件 → 只能算**相似候选**，不能宣称就是截图那个

结论：这份越南服客户端里**没有**找到加载页金色光环的确定归属。角色立绘本身由运行时 `Player.character` 提供，不是加载页静态素材。

### 2.3 中文文案

截图：「自由战」「游戏结算」「4星绿芽」「巴西之旅」「小贴士」。
仓库是**越南服 v1.1**：`GameMode_*` 图上是 `Tự do`、`FieldNameBg` 上是 `Đấu trường`。文字层必须本地化替换，或直接换成对应中文图，不能把越南语文案当原版画面交付。

### 2.4 加载页底部面板

截图底部是**聊天消息 + 战场 + 小贴士**三栏，左右各 4 个角色框（2×2）。
`room.xml` 定义了 `BattleFieldItem(486,438)`、`TipsItem/ViewerItem(797,438)`、`CharacterItemBluePos_4_x`(10,12)/(186,12)/(10,225)/(186,225) —— 4v4 的 2×2 坐标是有的，我上一轮拼的是 2v2 单行，**拼错了行**，应改用 `_4_x`。
左侧聊天区在 `room.xml` 里没有独立的 roomLoading 符号，疑似由 `asset.room.*` 九宫格切片拼出，未确认。

## 3. 战斗内两张截图（01 / 02）

`01-battle.png`（魔法教室）、`02-win.png`（蛙精洞）是**战斗 HUD**：顶部云朵比分与回合倒计时、「轮到你出手啦!!!」/「胜利 WIN!!」、65° 角度盘、0–100 力度尺、6 格道具槽、Pow 与蓝色水晶球、血量/体力/能量条、小地图、右侧技能列、星级奖励。

这些属于 **`game.swf` / `shape.swf` 那套战斗界面**，与本轮导出的 `gameover.swf`（结算翻牌）、`room.swf`（加载页）不是同一批元件。本轮未导出、未接入，仅登记为视觉基准。

## 4. 结论

- **素材本身找对了**：卡背、翻牌 5 帧、荧光框、火焰 VS、法阵、加载页底板全部与截图吻合，说明「从 Gunny 仓库 SWF 导出原始元件」这条路是通的。
- **不能照截图抄布局/文案/卡数**：这份仓库是越南服 v1.1，与截图的中文版本在行列数、文案、角色光环、面板构成上存在差异。
- 我上一轮对卡背的误读已纠正，本文档与 `art-source/README.md` 同步更正。

## 5. 建议的下一步（未执行）

1. 用 `cardMc` 5 帧 + `LuckyCard(122)` 替换站内单张 `card-back.png`；绿色描边用 `lightFrame`，翻卡音效维持 008/048。
2. 加载页按 `room.xml` 的 `_4_x` 坐标改 4v4 两行布局，补聊天区与小贴士区。
3. 金色光环：要么接受「仓库没有确定归属」用蓝红底板，要么把 `circlelight/4.swf` 当近似素材显式标注为「非原版加载页组件」—— 二选一由你定，不要默认前者。
4. 中文文案全部本地化，越南语文案不进交付。
