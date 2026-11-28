# Gunny 战斗音效映射（网页版）

素材来自原版仓库 `Tank.Flash/flash/audio.swf`，按
`Source Flash/src/ddt/manager/SoundManager.as` 的 `SoundID -> SoundXXX` 映射
用 FFDec 导出，再由完整版 FFmpeg 解码为 MP3。网页运行时不加载 Flash。

## 武器音效（按 `BombConfig.xml` + `BallList.xml` 逐武器取）

`Tank.Request/BombConfig.xml` 的 `Common` 字段才是武器的普通弹体；
`TemplateAlllist.xml` 的 `Property1` 会被它覆盖。五种武器的实际对应如下：

| 武器 | 模板 ID | Pic | Common Ball | ShootSound | BombSound |
|---|---|---|---|---|---|
| 烈火 | 7006 / 7103 | `bombpack` | 161 | `025` | `087` |
| 轰天 | 7007 / 7104 | `bomb` | 101 | `023` | `087` |
| 水果篮 | 7011 / 7108 | `fruit` | 401 | `114` | `102` |
| 黑白家电 | 7014 / 7111 | `television` | 321 | `110` | `100` |
| 风神 | 7008 / 7105 | `dart` | 121 | `029` | `089` |

> 注意：`7055 Storch` 是“WOW-奥运火炬”皮肤，不是烈火。官方 4399 资料明确
> 烈火的造型是“炸药包”，轰天是“大炮”；本地 `bombpack` 图标就是炸药包，
> `bomb` 图标是短管大炮。上一版把两者对调了，已修正。

## 事件表

| 战斗事件 | 原版触发点 | 声音 ID | 网页文件 |
|---|---|---|---|
| 烈火开炮 | `ShootBombAction.executeImp()` 读取 Ball 161 的 `ShootSound` | 025 | `sound-025-fire-flame.mp3` |
| 轰天开炮 | Ball 101 的 `ShootSound` | 023 | `sound-023-fire-cannon.mp3` |
| 水果篮开炮 | Ball 401 的 `ShootSound` | 114 | `sound-114-fire-fruit.mp3` |
| 黑白家电开炮 | Ball 321 的 `ShootSound` | 110 | `sound-110-fire-appliance.mp3` |
| 风神开炮 | Ball 121 的 `ShootSound` | 029 | `sound-029-fire-wind.mp3` |
| 烈火 / 轰天爆炸 | `SimpleBomb.bomb()` 读取 `BombSound` | 087 | `sound-087-boom-flame.mp3` |
| 水果篮爆炸 | 同上 | 102 | `sound-102-boom-fruit.mp3` |
| 黑白家电爆炸 | 同上 | 100 | `sound-100-boom-appliance.mp3` |
| 风神爆炸 | 同上 | 089 | `sound-089-boom-wind.mp3` |
| 选技能 / 选道具 | `RightPropBar.__itemClicked()` | 008 | `sound-008-ui.mp3` |
| 点击翻牌 | `LuckyCard.__onClick()` | 008 | `sound-008-ui.mp3` |
| 翻开卡牌 | `LuckyCard.play()` | 048 | `sound-048-card-flip.mp3` |
| 道具 / POW | `GameLiving.doUseItemAnimation()` | 039 | `sound-039-item.mp3` |
| 角色阵亡 | `GamePlayer.die()` | 042 | `sound-042-death.mp3` |
| 玩家回合开始 | `ChangePlayerAction`（本地玩家分支） | 016 | `sound-016-turn-self.mp3` |
| 敌方回合开始 | `ChangePlayerAction`（敌方分支） | 038 | `sound-038-turn-enemy.mp3` |
| 出手倒计时起始（**复用**原版采样） | 原版战斗回合未找到专属 SoundID；采样取自 `CardCountDown.as` | 067 | `sound-067-countdown.mp3` |
| 出手倒计时最后 10 秒每秒（**复用**） | 同上，`CardCountDown.as` | 014 | `sound-014-countdown.mp3` |
| 胜利 | `ExpView` 胜利分支 | 063 | `sound-063-win.mp3` |
| 失败 | `ExpView` 失败分支 | 064 | `sound-064-lose.mp3` |
| 受击（仅扣血） | 原版无独立 SoundID | — | **不播放**，爆炸声即受击反馈 |
| 炮弹出界 / 落地 | 原版无独立 SoundID | — | 不播放额外音效 |

## 触发规则

- 开炮整轮只播一次，不逐枚播放；`fire` 事件携带 `weapon`，前端按武器选
  `025/023/114/110/029`。
- 每枚炮弹爆炸各播一次；Go `resolveImpactLocked()` 的 `explosion` 事件携带
  弹体上的 `weapon`，前端按武器选 `087/102/100/089`。
- 命中扣血不再播放任何额外音效。早前网页版用合成 `hit` 冒充，已删除；未扣血的擦地也只出爆炸声。
- 选技能 / 选 POW 都只播 `008`（`RightPropBar.as:252`、`PropShortCutView.as:90/97`、`WeaponPropBar.as:61`、`SoulPropBar.as:142`），且在点击瞬间播放，不等引擎回声。
- POW 真正生效（发射必杀弹 / 道具动画）才播 `039`（`GameLiving.as:1550` `doUseItemAnimation()`）。
- 凡是有原版 SoundID 的音效，一律只播原版采样；采样尚未解码完成时等待解码，绝不用浏览器合成音假冒。
- 出手倒计时（60 秒）起始播 067，错开 016 回合音 900 ms；最后 10 秒每秒播 014。
  **067/014 的原始调用点是原版翻牌倒计时 `CardCountDown.as`，不是战斗回合专属音效**；
  本项目把它们复用为出手倒计时反馈，音源仍是原版采样，不冒称原版战斗专属 SoundID。

## 提取与转码

```sh
# 1. 从 audio.swf 导出 DefineSound（文件名末尾是 SoundXXX）
sh ffdec.sh -export sound /tmp/ddt_audio Gunny/Tank.Flash/flash/audio.swf

# 2. FFDec 导出的 FLV 实际是 Nellymoser 编码，需完整版 FFmpeg 解码
ffmpeg -i 61_Sound008.flv -ar 44100 -codec:a libmp3lame -b:a 128k 008-ui.mp3

# 3. 峰值统一到 -2 dB，避免不同武器爆炸声忽大忽小
ffmpeg -i in.mp3 -af "volume=+0.9dB" -codec:a libmp3lame -b:a 128k out.mp3
```

## 文件校验

| 文件 | ID | SHA-256 |
|---|---|---|
| `sound-008-ui.mp3` | 008 | `fd974ec79c3e57c705ff85d9cf7d1c6d30f2fbc7970abaf2d6b7d5f80221201e` |
| `sound-016-turn-self.mp3` | 016 | `cc2a1dfa9b91499a5025e4b73d14da75e6d775b6a9db28b3f7cac86816596c90` |
| `sound-023-fire-cannon.mp3` | 023 | `f5d2b3980f0e22238846c500c819aeac59bb0948f1e78ab5607f6f95358a8347` |
| `sound-025-fire-flame.mp3` | 025 | `1454d6d6577cd4610f2bd01543f813d89cc0e30ca373f37037411bf6e663ceb4` |
| `sound-029-fire-wind.mp3` | 029 | `752a63e3db21ddd5bea9cdbd8d0c13005db6802f178123aba008611da2b3e495` |
| `sound-038-turn-enemy.mp3` | 038 | `e820617fbbddb586fbf7b76fada15b41447d805802fb911c944983c9b8a08d1e` |
| `sound-039-item.mp3` | 039 | `00c1c5150c517676373f3856df63eaae66017c553b20dc9ed1bcb2f1eab2f7fe` |
| `sound-042-death.mp3` | 042 | `1b55dd2fd6dc0bfcc29e7938c3cf4f5919cbde63e6c920e9e63b55f4d5b4c08d` |
| `sound-063-win.mp3` | 063 | `411925dfd7de0d5c83dc6971d92a8c9fb9aed27fea1109b7e4bf179c7637ea0f` |
| `sound-064-lose.mp3` | 064 | `01fda60a39b384db9b360689c3986ca84fb5dbda03a62a2612457a08d9347a77` |
| `sound-087-boom-flame.mp3` | 087 | `8cb0731b0102d3737ffc48fd77785845632bd476dc83f992d8d48c62d8e5e5a4` |
| `sound-089-boom-wind.mp3` | 089 | `46162a05792c0ca6cbfdabd82e321148180ff388e8a382b200cdef05edba1c8a` |
| `sound-100-boom-appliance.mp3` | 100 | `2262b73820223b18bb09a22732b18550f3e6150464756c1d5cca8ce941c5e843` |
| `sound-102-boom-fruit.mp3` | 102 | `e7ae8feb8dced81d1f263a5ae9cc8dba7df8534a556b84f77c5196872d965f30` |
| `sound-110-fire-appliance.mp3` | 110 | `b479e2f67205e021d61943fcb6b73e5703c2e884b0cab079253be89726f236fb` |
| `sound-114-fire-fruit.mp3` | 114 | `a445268b44e986b27bbdea034c9a3de0764ba386983572daed6a13f8ccdff705` |

## 进入战斗 / 加载音效（核实结论）

`audio.swf` 的 `SoundManager.as` 只登记 `001–130` 通用音效与 `1001` 地图 BGM，
**没有**“加载完成/进入战斗”的专用 SoundID；`GameView.as`、`MapView.as` 在构建战场时
也不调用 `SoundManager.play()`。因此网页版不新增“原版加载音”：

| 场景 | 使用音频 | 处理 |
| --- | --- | --- |
| 战斗加载过场 | **当前场景的同一条原版 BGM**（由 `dist/js/audio-scenes.js` 的 `bgmFileFor()` 解析，不再固定 1001） | 音量压到 45% 播放，进入战斗后 0.5 s 内升回 `bgmVolume`；同一条 loop，不会与战斗 BGM 叠加 |
| 首次冷启动 | 当前场景 BGM | 受浏览器手势限制，加载卡片提供「点击开启音效」，点击后才解锁；未点击则静默 |

> **阶段 9 更正**：旧版描述「固定使用 `assets/audio/bgm-map1001.mp3`」已过时。
> 地图音乐按 `LoadMapsItems.xml` 的 `BackMusic` 字段解析（见下节）；旧文件
> `bgm-map1001.mp3` 仅保留为站点版历史资源，运行时改用 `bgm-map-<BackMusic>.mp3`。

## 048（翻卡翻开音）来源

- 定义：`Tank.Flash/flash/audio.swf` 的 `Sound048`（FFDec `-export sound` 得到
  `7_Sound048.flv`）。
- 调用点：`Source Flash/src/game/view/card/LuckyCard.as:256`，
  `SoundManager.instance.play("048")`，位于 `play()`（卡牌翻开）内；
  `LuckyCard.as:174` 的 `play("008")` 是点击音，两者不同。
- 转换：`ffmpeg -i 7_Sound048.flv -ar 44100 -codec:a libmp3lame -b:a 128k
  sound-048-card-flip.mp3`，时长 0.56 s。
- 只在结算翻牌时播放；加载过场没有原版加载音，**不要**拿 048 顶替。

## 阶段 9：原版长音乐 BGM 与倒计时音效（2026-11-28 实测接入）

完整证据（源码行号、FLV 编码、映射差异）见 `docs/AUDIO_EVIDENCE.md`。

### 音乐编号 ≠ 地图编号

`Tank.Request/LoadMapsItems.xml`（zlib 压缩，解压后 454 条 `<Item>`）的 `BackMusic` 字段：

| 本站地图 ID | `BackMusic` | 说明 |
| --- | --- | --- |
| 1157 | **1071** | 明确不等于地图编号 |
| 1049 | **1032** | 旧版对照库 `gunny-30` 的 `LoadMapsItems.xml:63` 同为 1032 |
| 1001 / 1002 / 1003 / 1008 / 1014 / 1035 / 1038 / 1156 / 1190 / 1192 | 同编号 | 恰好相等，但**不是**「默认相等」规则 |

非战斗场景：`BaseRoomState.as` → `playMusic("065")`（房间），
`HallStateView.as` → `playMusic("062")`（大厅）。
`SoundManager.as:395` 的实际播放地址是 `SITE_MAIN + "sound/" + id + ".flv"`。

### 已导出并接入的音频

| 资源 | 原版来源 | 用途 |
| --- | --- | --- |
| `bgm-room-065.mp3` | `Resource/sound/065.flv` | 房间 BGM |
| `bgm-hall-062.mp3` | `Resource/sound/062.flv` | 大厅 BGM |
| `bgm-map-*.mp3`（12 条，含 1032 / 1071 / 1156） | `Resource/sound/<BackMusic>.flv` | 战斗地图 BGM |
| `sound-067-countdown.mp3` | `audio.swf` → `Sound067.flv`（Nellymoser） | 翻牌倒计时起始提示 |
| `sound-014-countdown.mp3` | `audio.swf` → `Sound014.flv`（Nellymoser） | 翻牌倒计时每秒滴答 |

长音乐 FLV 内嵌的是标准 MPEG Layer III 帧，本项目用 FLV tag 解析**无损抽出 MP3 帧**
（不重编码，`afinfo` 校验可播放）；两个短音效为 Nellymoser，用静态 FFmpeg 解码为 MP3。
`1156.flv` 在旧版对照库中确实存在（1.53 MB），已补齐此前记录的「缺失」项。

### 运行时处理

- 场景切换：`setScene(scene, mapId)` 淡出旧 loop → `source.disconnect()` / `gain.disconnect()`
  → 起播新 BGM，解码 buffer 用 LRU 缓存（上限 3 条），避免多局战斗常驻增长。
- 手势解锁：未解锁前只记录 `bgmWanted`，用户点击开启音效后才创建 `AudioContext` 并起播。
- 循环 / 音量 / 静音：`source.loop = true`、`setBgmVolume()`、静音走 `stopBgm()`；
  所有音量变化用 `_fadeBgm()` 斜坡，避免爆音。
- 铁匠铺：`BaseStoreView.as:452/466` 只 `pauseMusic()` / `resumeMusic()`，
  **原版没有铁匠铺独立 BGM**；本项目对应 `audioPause()` / `audioResume()`。
- 战前加载：**未找到独立音乐调用证据**，`audio.swf` 也没有对应 SoundID，
  继续沿用「同一条场景 BGM 压低音量」，不凭印象新增配乐。

### 仍未确认 / 未接线

- 强化成功 / 失败音效封装在原版 `StoreTips` 内，本次上游检出未提供该 AS 源码，
  **未确认具体 SoundID**；界面暂用站点版既有 `win` / `lose`，不冒称原版强化音效。
- `063` / `064` / `1001` 在 `BaseStoreView.as` 中是开孔提示与通用按钮音，
  不是铁匠铺专属 BGM。
- `gunny-30` 与 `ddt-research` 两份 `LoadMapsItems.xml` 条目集不同（111 vs 456 行），
  1157 只存在于后者；本项目按后者（含 12 张本站地图）解析，差异已记录。
