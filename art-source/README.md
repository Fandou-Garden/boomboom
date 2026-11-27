# 原版美术元件导出台账（FFDec 实证）

> 目的：把「翻牌弹窗」「战斗加载页」从网页手绘 UI 换成 **Gunny 客户端 SWF 里的原始元件**。
> 所有结论都可用本文命令复现，不含推测。

## 0. 结论速览

| 需求 | 元件类名 | 所在 SWF | Character ID | 帧数 |
|---|---|---|---|---|
| 翻牌卡 | `asset.takeoutCard.LuckyCard` | `flash/ui/vietnam/swf/gameover.swf` | 122（容器） | 1 |
| 卡面翻转动画 | `cardMc`（子元件） | 同上 | 102 | **5** |
| 卡外光圈 | `lightFrame` | 同上 | 107 | 35 |
| VIP 卡面 | `vipCardMc` | 同上 | 111 | 5 |
| VIP 光圈 | `vipLightFrame` | 同上 | 115 | 35 |
| 星光 | `starMc` | 同上 | 121 | 14 |
| 加载背景 | `asset.roomLoading.Bg` | `flash/ui/vietnam/swf/room.swf` | 107 | 1（1000×600） |
| 战场缩略框 | `asset.roomLoading.BattleFieldBg` | 同上 | 106 | 1（316×163） |
| 地图名条 | `asset.roomLoading.FieldNameBg` | 同上 | 95 | 1（295×33） |
| 蓝方角色框 | `asset.roomLoading.CharacterBg_Blue` | 同上 | 117 | 1（171×208） |
| 红方角色框 | `asset.roomLoading.CharacterBg_Red` | 同上 | 118 | 1（171×208） |

## 1. 归属验证过程（可复现）

### 1.1 全库符号扫描

SWF 为 zlib 压缩（`CWS` 头），直接 grep 无效，需先解压：

```bash
python3 - <<'EOF'
import os,zlib
for root,_,fs in os.walk('/tmp/gunny-orig/Tank.Flash/flash'):
    for f in fs:
        if not f.endswith('.swf'): continue
        p=os.path.join(root,f); d=open(p,'rb').read()
        if d[:3]==b'CWS': d=d[:8]+zlib.decompress(d[8:])
        for t in [b'takeoutCard',b'roomLoading',b'LuckyCard']:
            if t in d: print(t.decode(),p)
EOF
```

结果（120 个 SWF 全扫，**每个符号仅 1 处命中**）：

```
takeoutCard  -> ui/vietnam/swf/gameover.swf
LuckyCard    -> ui/vietnam/swf/gameover.swf
roomLoading  -> ui/vietnam/swf/room.swf
```

### 1.2 SymbolClass 表

```bash
java -jar ffdec-cli.jar -export symbolClass out/ <swf>
```

`gameover.swf` 共 107 条符号，其中 `asset.takeoutCard.*` 14 条：
`LuckyCard(122)`、`CountDownNum_0..9(65..74)`、`GoldBitmap(40)`、`GoldTxt(39)`、`InstructionBitmap(38)`、`TitleBitmap(29)`。

`room.swf` 共 151 条符号，其中 `asset.roomLoading.*` 43 条（含左右面板 3×3 切片 `left.*` / `rightBottom.*` 各 8 片、`Hexagram`、`VersusAnimation`、`DungeonMapFrame`、`LoadingOK`、`GameMode_*`）。

### 1.3 容器内部结构（swf2xml）

`LuckyCard(122)` 只有 1 帧，内部挂 5 个子元件 —— 与 `LuckyCard.as` 中 `__checkMovie()` 判断 `numChildren == 5` 完全一致：

```xml
<item type="DefineSpriteTag" frameCount="1" spriteId="122">
  cardMc        -> characterId 102   (5 帧)
  lightFrame    -> characterId 107   (35 帧)
  vipCardMc     -> characterId 111   (5 帧)
  vipLightFrame -> characterId 115   (35 帧)
  starMc        -> characterId 121   (14 帧)
</item>
```

且 `LuckyCard.as` 中 `if (this._luckyCardMc.cardMc.totalFrames == 5)` —— 实测 `cardMc` 正是 5 帧，**源码与素材互相印证**。

### 1.4 关键澄清

- 翻牌动画**不是**整卡帧动画，而是 5 个子元件各自播放：卡面翻 5 帧、光圈 35 帧、星光 14 帧，代码用 `gotoAndPlay(2)` 启动。
- `LuckyCard.as` 里 `addChild(this._overShape)` 画的是悬停白框（`lineStyle(1.8, 0xffffff)` + `drawRoundRect(4,2,100,148,15,15)`），**是代码矢量，不是位图**，不要去找图。
- `SmallCardsView.as` / `LargeCardsView.as` 只管行列与倒计时，界面本体就是 `LuckyCard` 实例的阵列。**行列数以源码为准**：`SmallCardsView` 9 张 3 列、`LargeCardsView` 21 张 7 列（均为 3 行）；用户提供的中文版截图是 18 张 6 列，属于另一套配置，别照抄。
- **勘误（对照截图后更正）**：`cardMc/001.png` 是**橙红卷草纹边框 + 中央宝箱**的卡背，不是「木牌带开字」；`005.png` 是米白卡面 + 底部橙色名字条。此前因拼图被压缩导致误读，已放大复核。详见 `REFERENCE_CHECK.md`。
- 卡背中央画的就是宝箱，所以 `docs/HANDOFF_PROMPT.md` 里「`cardbox/*/icon.png` 是宝箱图标不是卡面」只表示该 PNG 是独立图标文件，**不代表原版卡背不含宝箱**。

## 2. 原版布局坐标（1000×600 舞台）

来源：`Tank.Flash/flash/ui/vietnam/xml/room.xml`（`ComponentFactory` 的 style 定义）。

| style | 坐标 | 说明 |
|---|---|---|
| `roomLoading.VersusItem` | (473, 205) | 中间 VS 区 |
| `roomLoading.CountDownItem` | (469, 351) | 倒计时数字 |
| `roomLoading.BattleFieldItem` | (486, 438) | 底部战场框 |
| `roomLoading.TipsItem` / `ViewerItem` | (797, 438) | 右下提示 |
| `roomLoading.DungeonMapItem` | (646, 19) | 副本小地图 |
| `asset.roomLoading.HexagramPos` | (19, 49) | 相对 VersusItem |
| `asset.roomLoading.VersusAnimationPos` | (16, -31) | 相对 VersusItem |
| `roomLoading.BattleFieldItemMapPos` | (6, 34) | 相对 BattleFieldItem |
| `roomLoading.BattleFieldItemNamePos` | (10, 111) | 相对 BattleFieldItem |
| `asset.roomLoading.LoadingOKStartPos` | (270, 100) | 加载完成印章 |
| `CharacterItemBluePos_2_1 / _2_2` | (10,122) / (186,122) | 蓝方 2v2 |
| `CharacterItemRedPos_2_1 / _2_2` | (643,122) / (819,122) | 红方 2v2 |
| `CharacterItemBluePos_3_x` | (10,12)/(105,225)/(186,12) | 蓝方 3v3 |
| `CharacterItemBluePos_4_x` | (10,12)/(186,12)/(10,225)/(186,225) | 蓝方 4v4 |

> `CharacterBg` 为左上锚点（`RoomLoadingCharacterItem.as` 未设 x/y 偏移），171×208。角色本体由 `displayMC.character` 承载，挂点见 `asset.roomLoading.figurePos1/2`、`listPos`。

## 3. 目录说明

```
art-source/
├── takeoutcard/            gameover.swf 导出
│   ├── LuckyCard_container_122.png   整卡（249×286，卡背）
│   ├── cardMc/001..005.png           翻牌 5 帧（卡背→翻面→发光→卡面）
│   ├── lightFrame/001..035.png       光圈
│   ├── vipCardMc/  vipLightFrame/    VIP 版
│   ├── starMc/001..014.png           星光
│   └── ui/                           title / instruction / gold-icon / gold-label / countdown-0..9
├── roomloading/            room.swf 导出
│   ├── Bg.jpg (1000×600)  BattleFieldBg.png  FieldNameBg.png
│   ├── CharacterBg_Blue.png  CharacterBg_Red.png
│   ├── DungeonMapFrame.png  LoadingOK.png  TipsItemBg.png  ViewerItemBg.png
│   ├── GameMode/GameMode_{0,1,2,7,8,12,14}.png   模式名图
│   ├── Hexagram/001..030.png        八卦阵（**仅示例 30 帧**）
│   ├── VersusAnimation/001..059.png  VS 动画
│   ├── loadingMcAsset/001..022.png   进度条动画
│   ├── displayMC/001..047.png        角色出场动画
│   └── panel-3x3/                    左右面板九宫格切片（40×40 拉伸用）
└── _preview/
    ├── loading-1000x600.png          按原版坐标拼合的还原图
    ├── card-flip-5frames.png         翻牌 5 帧放大
    ├── card-lightFrame.png  card-starMc.png
    └── loading-elements.png          静态元件总览
```

**Hexagram 全量 600 帧约 197 MB**，未全量拷贝。需要时用：

```bash
java -jar ffdec-cli.jar -export sprite out/ \
  /tmp/gunny-orig/Tank.Flash/flash/ui/vietnam/swf/room.swf -selectid 153
```

## 4. 下一步（未执行，待确认）

1. 翻牌：用 `cardMc` 5 帧替换现在的 `card-back.png`，保留现有的 9 卡 3 列布局与领取逻辑。
2. 加载页：按第 2 节坐标重排 DOM，`Bg` 作底、左右 `CharacterBg` + `displayMC`、中间 `Hexagram` + `VersusAnimation` + `GameMode`、底部 `BattleFieldBg` + 地图缩略 + `FieldNameBg`。
3. 文本差异：原版是越南服，`Tự do` / `Đấu trường` 为越南语，接入时需替换为中文「自由模式」「竞技场」或直接用 `GameMode_*` 对应图。
4. 音效维持现状：`LuckyCard.__onClick()` 播 `008`、`play()` 播 `048`，均已在站内；加载页那三个类**没有**专属加载音效调用，不要编造。
