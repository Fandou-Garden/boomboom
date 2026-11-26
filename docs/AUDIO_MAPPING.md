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
| 道具 / POW | `GameLiving.doUseItemAnimation()` | 039 | `sound-039-item.mp3` |
| 角色阵亡 | `GamePlayer.die()` | 042 | `sound-042-death.mp3` |
| 玩家回合开始 | `ChangePlayerAction`（本地玩家分支） | 016 | `sound-016-turn-self.mp3` |
| 敌方回合开始 | `ChangePlayerAction`（敌方分支） | 038 | `sound-038-turn-enemy.mp3` |
| 胜利 | `ExpView` 胜利分支 | 063 | `sound-063-win.mp3` |
| 失败 | `ExpView` 失败分支 | 064 | `sound-064-lose.mp3` |
| 受击（仅扣血） | 原版无独立 SoundID | — | 合成替代（明确标注） |
| 炮弹出界 / 落地 | 原版无独立 SoundID | — | 合成替代（明确标注） |

## 触发规则

- 开炮整轮只播一次，不逐枚播放；`fire` 事件携带 `weapon`，前端按武器选
  `025/023/114/110/029`。
- 每枚炮弹爆炸各播一次；Go `resolveImpactLocked()` 的 `explosion` 事件携带
  弹体上的 `weapon`，前端按武器选 `087/102/100/089`。
- 命中扣血只额外触发合成的 `hit`；不伪造原版 ID。未扣血的擦地只出爆炸声。
- 选技能只播 `008`；真正生成炮弹时才播开炮声。

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
