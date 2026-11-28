# 原版音乐与音效证据表（阶段 9）

> 结论先行：**已接入按场景切换的原版 BGM、翻牌 048、倒计时 067/014、胜负 063/064**；
> **战前加载独立音乐仍不接入**（未找到调用证据）；**铁匠铺没有独立 BGM**（原版是暂停/恢复全局音乐）。
> 本文只记录可核查的文件、行号与实测数据；查不到的机制保持未实现。

## 1. 用户给出的原码证据（本轮按此核对，不凭印象配乐）

| 场景 | 调用点 | SoundID |
| --- | --- | --- |
| 房间 | `BaseRoomState.as` `playMusic("065")` | 065 |
| 大厅 | `HallStateView.as` `playMusic("062")` | 062 |
| 战斗 | `GameViewBase.as` 读取地图 `BackMusic` 字段 | 按地图 |
| 翻牌 | `LuckyCard.as` | 048 |
| 翻牌倒计时 | `CardCountDown.as` | 067、014 |
| 胜负提示 | `ExpView.as` | 063、064 |
| 铁匠铺 | `Source Flash/src/store/states/BaseStoreView.as` | 暂停/恢复音乐 + 结果音效 |

> `CardCountDown.as`、`BaseRoomState.as`、`GameViewBase.as`、`ExpView.as` 的正文在本地上游检出中
> **未找到**，上表来自用户提供的原码证据，标记「源码正文未本地复核」。
> `BaseStoreView.as`、`StoreIIStrengthBG.as`、`SoundManager.as`、`LuckyCard` 相关映射已在本地复核
> （`docs/AUDIO_MAPPING.md` 记录 `LuckyCard.as:256` 的 048、`LuckyCard.as:174` 的 008）。

## 2. 地图音乐映射（`LoadMapsItems.xml` 的 `BackMusic`）

- 源文件：`/tmp/gunny-30/inetpub/wwwroot/Request/Tank.Request/LoadMapsItems.xml`（zlib 压缩）
  与 `/tmp/ddt-research/LoadMapsItems.xml.dec`（解压后 454 条 `<Item>`，逐条含 `BackMusic`）。
- `SoundManager.as:395`：`this._ns.play(SITE_MAIN + "sound/" + this._currentMusic + ".flv")`，
  即播放的是 `BackMusic` **值**，不是地图 ID。
- **反例实测**：`ID="1157" Name="Rừng hoàng hôn" BackMusic="1071"`、
  `ID="1049" Name="Thành Cổ (nhỏ)" BackMusic="1032"`。另有 44 条 `BackMusic="qx01"` 等非数字值，
  进一步证明不能默认「音乐编号 = 地图编号」。

| 地图 ID | 原版名称 | BackMusic | 本项目文件 | FLV 原件 |
| --- | --- | --- | --- | --- |
| 1001 | Cầu vồng | 1001 | `bgm-map-1001.mp3` | `1001.flv` |
| 1002 | Đường bay ma quái | 1002 | `bgm-map-1002.mp3` | `1002.flv` |
| 1003 | Công trường | 1003 | `bgm-map-1003.mp3` | `1003.flv` |
| 1008 | Phố nấm lùn | 1008 | `bgm-map-1008.mp3` | `1008.flv` |
| 1014 | Bờ biển ngà | 1014 | `bgm-map-1014.mp3` | `1014.flv` |
| 1035 | Mộc Diệp trấn | 1035 | `bgm-map-1035.mp3` | `1035.flv` |
| 1038 | Ưu linh quỷ thành | 1038 | `bgm-map-1038.mp3` | `1038.flv` |
| 1156 | Atlantis | 1156 | `bgm-map-1156.mp3` | `1156.flv` |
| **1157** | Rừng hoàng hôn | **1071** | `bgm-map-1071.mp3` | `1071.flv` |
| 1190 | Di tích miếu thần | 1190 | `bgm-map-1190.mp3` | `1190.flv` |
| 1192 | Trạm tu dưỡng không gian | 1192 | `bgm-map-1192.mp3` | `1192.flv` |
| **1049** | Thành Cổ (nhỏ) | **1032** | `bgm-map-1032.mp3` | `1032.flv` |
| 房间 | — | 065 | `bgm-room-065.mp3` | `065.flv` |
| 大厅 | — | 062 | `bgm-hall-062.mp3` | `062.flv` |

**关于 1156 的更正**：用户此前记录「1156.flv 在已检查目录缺失」。在旧版对照库
`/tmp/gunny-30/inetpub/wwwroot/Resource/sound/1156.flv` 实测**存在且有效**
（1,531,899 字节，Macromedia Flash Video），已导出为 `dist/assets/audio/bgm-map-1156.mp3`。
14 个目标 FLV 全部存在，无缺失。

## 3. 资源导出与转换（实测）

- 长音乐原件目录：`/tmp/gunny-30/inetpub/wwwroot/Resource/sound/*.flv`。
  文件头 `FLV\x01\x04`，首个 tag type=8，flags `0x2b` → `soundFormat=2`（MP3），
  **内嵌 MPEG-2 Layer III / 64 kbps / 22.05 kHz**。
  采用 FLV tag 解析**无损抽出 MP3 帧**（跳过每 tag 的 1 字节 flags），不重编码、不生成新音频。
  `afinfo dist/assets/audio/bgm-map-1156.mp3` 实测 `MPG3 / 2 ch / 22050 Hz / 177.87 s / 6809 packets`。
- 短音效：`/tmp/gunny-30/inetpub/wwwroot/gunny/audio.swf`（1.5 MB），
  FFDec v21.0.1 `-export sound` 导出 120 个 `DefineSound`。
  `26_Sound014.flv`、`108_Sound067.flv`、`7_Sound048.flv` 为 Nellymoser（flags `0x6e`），
  用临时安装的静态 ffmpeg（`imageio-ffmpeg` 提供，仅本机工具，不入库）解码为
  `sound-014-countdown.mp3`（0.157 s 滴答）、`sound-067-countdown.mp3`（1.045 s 起始提示）。
- 既有短音效沿用 `dist/assets/audio/sound-*.mp3`，映射见 `docs/AUDIO_MAPPING.md`；
  本轮修正了一个真实缺陷：`sound.play('048')` 之前只有 `sampleFiles` 条目、没有
  `sampleMap` 映射，翻牌音实际静音。现已补齐 `048/067/014`。
- `store.swf` 内**没有**内嵌音效（FFDec `-export sound` 得到 0 个文件），
  印证铁匠铺音效来自全局 `audio.swf`，不存在独立 BGM。

## 4. 铁匠铺音乐/音效（源码逐行核对）

| 文件:行 | 原文 | 结论 |
| --- | --- | --- |
| `BaseStoreView.as:452-453` | `SoundManager.instance.pauseMusic();` / `play("063",false,false);` | 进商店暂停全局音乐 |
| `BaseStoreView.as:469-471` | `resumeMusic();` / `stop("063"); stop("064");` | 退出恢复全局音乐 |
| `BaseStoreView.as:490` | `play("1001")` | 界面内音效，不是 BGM |
| `BaseStoreView.as:219,533,569` | `play("008")` | 按钮音 |
| `StoreIIStrengthBG.as:330,508,587,660,680,712,733,996` | `play("008")` | 强化页按钮/槽位音 |
| `SoundManager.as:274` | `_dic["1001"] = Sound1001` | 1001 是内嵌短音效，不是地图 BGM |
| `/tmp/gunny-upstream/Music.md` | `playMusic("062", true, false)` in `BaseStateView.as` / `HallStateView.as` | 大厅 062 佐证 |

- **不存在独立铁匠铺 BGM**：本项目进铁匠铺调用 `pauseBgm()`、退出调用 `resumeBgm()`，
  与 `BaseStoreView.as` 一致，不自行编造 BGM。
- **强化结果音效未完全确认**：`StoreTips` 类源码本地未提供，无法逐行确认成功/失败分支的
  SoundID。当前界面沿用原版 `063`（成功）/ `064`（失败）并明确标注「源码未提供，标注未确认」，
  **不声称这就是原版强化结果音**。

## 5. 运行时接线

| 能力 | 实现 | 证据 |
| --- | --- | --- |
| 映射表 | `dist/js/audio-scenes.js` `MAP_BACK_MUSIC` / `SCENE_MUSIC` / `bgmFileFor()` | 本文第 2 节 |
| 场景切换 | `main.js` `SoundEngine.setScene()` 淡出旧 loop → 释放 `source/gain` → 载入新 buffer | `SoundManager.playMusic` 切换语义 |
| 循环 / 音量 / 静音 | `source.loop=true`；`setBgmVolume()`；`stopBgm()`；铁匠铺音量按钮 | `SoundManager.as:387-462` |
| 资源释放 | `bgmBuffers` LRU 上限 3；`_stopBgmSource()` 断开节点；`releaseBgm()` 清缓存 | 用户要求「资源释放」 |
| 用户手势解锁 | 既有 `unlock()`，由真实 pointer/key 事件触发；未点击则静默 | 浏览器自动播放策略 |
| 房间 / 大厅 / 战斗 | `server-mode.js` `showLayer → room`；`startBattle → battle(mapId)`；大厅 062 保留映射（当前无独立大厅界面） | 本文第 1 节 |
| 暂停 / 恢复 | `open-forge → audioPause()`；`close-forge → audioResume()` | `BaseStoreView.as:452/469` |
| 翻牌 / 倒计时 / 胜负 | `048`（修复静音）、`067` 起始 + `014` 每秒、`063/064` | 本文第 1 节 |
| 战前加载 | **不新增独立音乐**：既有 `enterBattleLoading()` 仍只是把「当前场景同一条 BGM」压到 45% 再升回 | 未找到独立调用证据 |

## 6. 明确未接入 / 未确认

1. 战前加载独立音乐：`SoundManager.as` 只登记 `001–130` 通用音效与 `1001` 内嵌音，
   `GameView.as` / `MapView.as` 构建战场时不调用 `SoundManager.play()`；
   **没有证据就不接入**，不用 048 或其它音效顶替。
2. 铁匠铺独立 BGM：原版没有，本项目不编造。
3. 强化结果音：`StoreTips` 源码未提供，成功/失败沿用 063/064 但标记未确认。
4. 大厅 062：当前网页版没有独立大厅界面，`bgm-hall-062.mp3` 与映射已备好，
   **尚未接到任何界面切换**。
5. `CardCountDown.as` / `BaseRoomState.as` / `GameViewBase.as` / `ExpView.as` 正文本地未检出，
   按用户提供的原码证据接线，未做二次源码复核。
6. 浏览器进程内存、Canvas / 图片 / 音频占用分项、多局连续监听器 / WebSocket / 计时器增长观测
   仍属阶段 9 后续工作，本轮未完成。
