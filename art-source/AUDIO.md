# 房间背景音乐核实台账（Sound 065）

> 结论：**房间 BGM 是 `Tank.Flash/resource/v1.1/sound/065.flv`，不在 `audio.swf` 里。**
> 用户给出的事实全部核实通过，本文补上可复现的行号与实测数据。

## 1. 三处源码实证

| 位置 | 内容 |
|---|---|
| `Source Flash/src/room/view/states/BaseRoomState.as:46` | `SoundManager.instance.playMusic("065");` |
| `Source Flash/src/ddt/manager/SoundManager.as:395` | `this._ns.play(SITE_MAIN + "sound/" + this._currentMusic + ".flv");` |
| `Tank.Flash/resource/v1.1/sound/065.flv` | 实际文件，644,774 字节 |

补充：`Source Flash/src/fightLib/FightLibState.as:79` 也调用 `playMusic("065")`，即 **065 同时用于房间和战斗图鉴（FightLib）**。

## 2. 065.flv 实测

```
容器   : Macromedia Flash Video (FLV)
音轨   : mp3, 22050 Hz, 2 ch
时长   : 139.729 s (2:19.7)
大小   : 644,774 B
```

已无损转封装为 `art-source/audio/room-bgm-065.mp3`（`-c:a copy`，559,194 B，139.729 s，音轨未重编码）。

## 3. `audio.swf` 里确实没有 065

```bash
java -jar ffdec-cli.jar -export sound out/ Tank.Flash/flash/audio.swf
```

导出 133 个 Sound，编号为 `001 003 006 … 064 066 067 … 165 1001`，**065 是缺号**；文件名中也无 `Sound065`。
`audio.swf` 装的是**音效**（`008` 按钮、`048` 翻牌、`021/023/…` 开炮、`087/089/…` 爆炸），不是 BGM。

BGM 全部是 `resource/v1.1/sound/*.flv`，由 `playMusicImp()` 用 `NetStream` 按 `sound/{id}.flv` 路径动态拉取 —— 两条完全不同的资源通道。

## 4. BGM 分工（按源码调用点）

| ID | 使用位置 | 说明 |
|---|---|---|
| **065** | `BaseRoomState.as:46`、`FightLibState.as:79` | **房间内 / 战斗图鉴** |
| 062 | `HallStateView.as:253`、`BaseStateView.as:61`、`RoomListController.as:224`、`DungeonListController.as:227`、`HotSpringMainView.as:83` 等 | 大厅 / 房间列表 / 城镇，原版覆盖面最广 |
| 140 | `RouletteFrame.as:422`、`TimesManager.as:147` | 轮盘 / 活动 |
| 3001–3004 | `ChurchRoom*` / `Wedding*` | 教堂婚礼场景 |
| `worldbossroom-{id}` | `WorldBossRoomView.as:82,132` | 世界 Boss |

`resource/v1.1/sound/` 共 **33 个 flv**，其中 27 个 ID 与 `image/map/` 下的地图目录 ID 完全一致（1001、1002、1003、1008、1014、1023、1026、1034、1035、1037、1038、1040、1065、1072、1073、1120、1121、1122、1148、1151、1152、1161、1165、1190、1192、1207、1214 等），即**按地图 ID 命名的战斗 BGM**。
剩余 6 个：`062`、`065` 为固定场景 BGM；`1032`、`1036`、`1071`、`1196` 有音频但客户端 `image/map/` 无对应目录（与 1156 同类情况，资源在服务端）。

> 战斗 BGM 的具体 `playMusic(mapId)` 调用点**未在 AS 源码中直接找到**，可能由配置或服务端下发驱动。此处只陈述 ID 与地图目录的对应关系，不臆断触发逻辑。

## 5. 播放行为（`SoundManager.as:374–405`、`471–488`）

- `playMusic(id, loop = true, replaceSame = false)`：065 用默认参数 → **循环播放**。
- 去重：`if (param3 || this._currentMusic != param1)` —— 同一首重复调用**不会重启、不会叠加**。
- 循环实现：`NetStream.Play.Stop` 时若 `_musicLoop` 为真，重新 `playMusicImp(list, true)`。
- 音量：`this._ns.soundTransform = new SoundTransform(this._musicVolume / 100)`，`playMusic()` **不碰音效音量**。
- 失败重试：`NetConnection.Connect.Failed` / `NetStream.Play.StreamNotFound` 时最多重试 `MusicFailedTryTime` 次。

这几条正好是「加载音只播一次、不重叠、失败有重试」的原版依据 —— 原版靠 `playMusic` 自身的 ID 去重实现，不是额外写状态机。

## 6. 站内现状

`dist/assets/audio/bgm-map1001.mp3` 时长 **144.091 s**，与 `sound/1001.flv`（144.091 s）完全一致，来自**战斗地图 BGM**，不是房间 BGM。文件体积 1,153,536 B 大于 flv 的 664,896 B，说明此前做过重编码/处理，但音源可确认是 1001。

站内目前**没有任何房间/大厅 BGM**，只有战斗 BGM 与音效。这就是之前加载过场只能靠推断配乐的原因。

## 7. 已导出（未接线）

```
art-source/audio/
├── room-bgm-065.mp3   139.729 s  ← 房间 BGM，本次目标
└── hall-bgm-062.mp3    95.791 s  ← 大厅 BGM，顺带作对照
```

`dist/` 一行未改。

## 8. 接入建议（待确认，未执行）

1. 进入房间/加载过场时播 `room-bgm-065.mp3`，`loop = true`，音量单独一路，不与 `bgm-map1001` 同轨。
2. 进入战斗时 duck 或停止 065，切到地图 BGM（1001 等），结算后再切回。
3. 遵守浏览器自动播放手势限制：首次用户交互后才 `play()`；用 `audio.paused` + `currentSrc` 做 ID 去重，避免重复调用重启。
4. 按钮音效仍走 `audio.swf` 那套（`008` 等），不要用 BGM 冒充 —— 这是两条独立通道。
