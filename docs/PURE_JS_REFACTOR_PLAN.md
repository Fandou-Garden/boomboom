# 纯 JS 全量重构规划（Pure-JS Rewrite Roadmap）

> **状态：仅规划，未实施。** 本文只回答「如果要把整个项目重构成纯 JS，应该怎么写」，
> 不改变任何运行时代码，也不需要重新部署站点。
>
> 对应基线：功能提交 `0b61643`（`feat: 补齐原版地图/飞行/死亡结算/暴击并发布静态站点源码`），
> 文档提交 `ea40ca4`；当前远程 `main` HEAD = `ea40ca4`，分支仅 `main`。
> 静态站点：`https://a49f3350593822301.app.workbuddy.host/?sharecode=UMJ5YC3KWL`，
> 已按「1 推送 → 2 重新发布 → 3 文档收尾」重新发布并验证（详见文末附录 B）。
> 站点产物 `dist/` 与 `0b61643` 完全一致；本文位于 `docs/`，不影响线上产物。

---

## 0. 一句话结论

**不需要从零重写。** 当前项目里 `physics.js`、`ai.js`、`terrain.js`、`config.js` 已经是原版
`SimpleBomb.cs` / `ChooseShot` / `Tile.cs` / `BallList.xml` 的纯 JS 移植，只是被当作「瞄准推荐 +
表现层」使用，权威结算仍在 Go→WASM。重构的本质是：

1. 把这几块**提升为权威**，补齐与 Go 引擎的数值一致性；
2. 新写一个 JS 版 `Match`（状态机 + 命令 + 回合 + 快照 + 事件），对应 `match.go` + `actions.go`；
3. 用一个 **JS 引擎门面**替换 `window.GunnyWasm`，改造 `offline-api.js`；
4. 删掉 Go/WASM 工具链。

因为前端只认「`EventSource` + `fetch('/api/command')`」这层契约，
`net-client.js` / `renderer.js` / `main.js` 几乎可以零改动。

---

## 1. 现状架构与接缝

### 1.1 三层结构

```text
浏览器 dist/*.js
   │  EventSource('/api/events')  →  state / game 事件（JSON）
   │  fetch('/api/command', POST) →  Command JSON
   ▼
┌──────────────────────────────────────────────────────────┐
│ 两种实现，二选一（由 index.html 底部 probe /api/state 决定）│
│  A. 在线：Go HTTP 服务 server/main.go + server/game/*      │
│  B. 静态：dist/offline-api.js → window.GunnyWasm（WASM）   │
└──────────────────────────────────────────────────────────┘
   ▼
server/game/  ← 唯一权威战斗引擎（约 2.7k 行 Go）
   config.go / terrain.go / physics.go / ai.go
   match.go / actions.go / snapshot.go / events.go
```

静态部署走的就是 B 分支：`dist/index.html` probe `/api/state` 失败后，
依次加载 `wasm/wasm_exec.js`、`offline-api.js`，由后者把 `EventSource` 和
`fetch('/api/command')` 整体替换成对 `window.GunnyWasm` 的调用。

### 1.2 天然接缝：`offline-api.js`

这是整个项目最干净的替换点。它只做三件事：

| 机制 | 替换成 |
| --- | --- |
| `window.EventSource` | `LocalEventSource`（`setInterval` 40ms 驱动 `update(dt)`，再 `flush` 出 `game` / `state` 事件） |
| `window.fetch`（仅拦截 `/api/command`） | `window.GunnyWasm.command(JSON)` |
| 引擎初始化 | `boot()` 里 fetch `.wasm` + `fore.map` + 3 张 `crater-*.png`，调 `init(...)` |

也就是说：**只要提供一个行为一致的 JS 引擎门面，前端一行都不用改。**

### 1.3 现状痛点（重构动机）

- 3.6 MB 的 `gunny.wasm` + `wasm_exec.js` 需要 Go 工具链才能重建；沙箱 Go 1.21 与仓库
  `go.mod` 声明的 1.25 不一致，每次构建都要临时降级版本号（见 `scripts/build-wasm.sh`）。
- 同一套物理存在两份实现（Go `physics.go` 与 JS `physics.js`），改一处必须同步另一处，
  否则「推荐力度线」和真实弹道会分叉。
- 引擎逻辑藏在 WASM 里，浏览器里无法断点、无法热更、无法做单测。
- 静态站点是「夜游部署」，服务端 `server/main.go` 本来就不参与，属于保留成本。

---

## 2. 目标、范围与原则

### 2.1 目标

> 一个 **零 Go 依赖、零 WASM、纯 ES Module** 的静态站点：`dist/` 直接扔到任意静态托管
> 即可运行，构建只需 Node（甚至不需要构建），全部战斗逻辑在浏览器 JS 里可调试、可单测。

### 2.2 不做的事（范围边界）

- 不重写 UI / 渲染 / 输入 / 相机 / 音效 / 地图选择器（`renderer.js`、`main.js` 等保持）。
- 不引入前端框架（React/Vue）、不引入打包器（Vite/webpack）；继续用原生 ES Module +
  `?v=<版本>` 缓存串。
- 不改玩法数值：所有 `SOURCE` 常数、伤害公式、暴击、飞行弹、地图位图保持原样。
- 不实现联网对战（当前项目本来就是单机静态站点）。若未来要联机，见 §11 的同构说明。

### 2.3 五条原则

1. **契约冻结**：`GunnyWasm` 的 5 个方法、`Snapshot` 字段、`Event` 形状、`Command` 集合
   先写成文档并录制 golden 基准，再动手（§5）。
2. **复用优先**：`physics.js` / `ai.js` / `terrain.js` / `config.js` 直接升级为权威模块，
   不另起炉灶。
3. **逐函数移植**：`match.go` / `actions.go` 按函数签名 1:1 搬，保留原注释里的
   `SOURCE` 溯源标注，方便日后回查原版。
4. **Golden Parity 驱动**：任何一步都用「同一命令序列分别喂 WASM 与 JS 引擎，逐帧比对
   snapshot JSON」判定是否等价，而不是靠肉眼。
5. **可回退**：Phase 5 之前 `server/`、WASM、`offline-api.js` 全部保留，
   `index.html` 用开关切换新旧引擎，随时可切回。

---

## 3. 有利条件：已有的纯 JS 资产

| 文件 | 已移植的源码 | 当前用途 | 重构后的角色 |
| --- | --- | --- | --- |
| `dist/js/physics.js` (378 行) | `EulerVector.cs`、`BombObject.cs`、`SimpleBomb.cs`、`Living.ShootImp`、`BaseGame.GetNextWind` | 瞄准推荐、轨迹预览 | **权威弹道/伤害**，补齐 `SourceDamage` / `SourceCriticalDamage` / `trunc10` / CCD |
| `dist/js/ai.js` (300 行) | `ChooseShot` 粗搜 + 细搜、`triangularNoise` | 推荐线 | **权威电脑出招**，与 Go `ai.go` 对齐 |
| `dist/js/terrain.js` (737 行) | `Tile.cs`（alpha ≤ 100 为空）、`BaseBomb.DigMap()` | 可见前景 + 局部 mask | **权威地形**，补齐 `FindGroundY` / `FindNextWalkPoint` / `SlopeAt` / `Hash` / `Carve` 的权威版本 |
| `dist/js/config.js` (288 行) | `BallList.xml`、`LoadMapsItems.xml`、原版常数 | 展示参数 | **唯一常数来源**，Go `config.go` 的 `SOURCE` 值并入此处 |
| `dist/js/explosion.js` (100 行) | FNV-1a + mulberry32 | 爆炸粒子形状 | 保持（纯视觉，不参与结算） |

> 结论：真正要新写的只有 `Match` 状态机 + 开火/结算流程 + 快照序列化，约 1.6k 行 Go
> 对应约 1.2–1.5k 行 JS；其余是「对齐」而非「重写」。

---

## 4. 目标架构与目录结构

### 4.1 架构图

```text
dist/index.html
   │  <script type="module">  直接加载（不再 probe /api/state）
   ▼
dist/standalone-api.js          ← 由 offline-api.js 演化：替换 EventSource + fetch
   │  import { GunnyEngine } from './js/engine/index.js'
   ▼
dist/js/engine/                 ← 纯 JS 权威引擎（新增）
   ├── index.js               GunnyEngine 门面（init/command/update/snapshot/events）
   ├── constants.js           单一常数源（re-export config.js + 补权威字段）
   ├── rng.js                 Go math/rand 兼容 PRNG + 独立暴击 RNG
   ├── terrain.js             权威地形（位图解析 + 碰撞 + 挖洞）
   ├── physics.js             权威弹道/伤害（升级自 dist/js/physics.js）
   ├── ai.js                  权威电脑（升级自 dist/js/ai.js）
   ├── actors.js              Actor / Impact / Stats 结构
   ├── match.js               状态机、Command、Update、回合、Emit
   ├── actions.js             fireLocked / updateFlight / resolveImpact / resolveCarry / beginTurn / heal
   └── snapshot.js            Snapshot 序列化 + EventsSince
   │
   │  state / game 事件（JSON，形状不变）
   ▼
dist/js/net-client.js  →  renderer.js / main.js / input.js / camera.js / explosion.js
（表现层，几乎零改动）
```

### 4.2 目录树（重构后）

```text
gunny-wind-arena/
├── dist/                          # 站点根目录，直接可部署
│   ├── index.html                 # 改：去掉 WASM probe，改 module 入口
│   ├── styles.css
│   ├── manifest.webmanifest
│   ├── standalone-api.js          # 新（由 offline-api.js 演化，旧文件删除）
│   ├── js/
│   │   ├── config.js              # 保留，升为唯一常数源
│   │   ├── engine/               # 新：纯 JS 权威引擎
│   │   ├── physics.js            # 保留/增强（或移入 engine/ 并 re-export）
│   │   ├── ai.js                 # 保留/增强
│   │   ├── terrain.js            # 保留/增强
│   │   ├── net-client.js         # 不动（契约不变）
│   │   ├── renderer.js           # 不动
│   │   ├── input.js / camera.js / explosion.js / maps.js / main.js  # 基本不动
│   ├── data/*.fore.map           # 保留（11 张地图碰撞位图，JS 仍要读）
│   ├── assets/                   # 保留（含 3 张 crater-*.png 弹坑形状）
│   └── wasm/                     # 删除
├── reference/                    # 保留（地图原始素材，便于再生成）
├── tests/                        # 改造，见 §9
├── docs/PURE_JS_REFACTOR_PLAN.md # 本文
├── scripts/                      # 删 build-wasm.sh，改 build-static.sh
├── server/                       # 删除（Go 引擎 + HTTP 服务 + go.mod）
├── package.json                  # 改 scripts
└── SOURCE_MANIFEST.sha256        # 重新生成
```

---

## 5. 接口契约冻结（动手前必须先锁死）

> 这一节是重构的「宪法」。`standalone-api.js` 与 `net-client.js` 只依赖下列契约；
> 只要 JS 引擎严格遵守，前端无需任何改动。

### 5.1 引擎门面：5 个方法

当前 `server/wasm/main.go` 挂在 `window.GunnyWasm` 上，`offline-api.js` 调用：

| 方法 | 入参 | 返回 | 语义 |
| --- | --- | --- | --- |
| `init` | `(mapBytes, crater50Bytes, crater401Bytes, crater4Bytes, debug)` | `""` 成功 / 错误字符串 | 载入地形位图 + 3 张弹坑 PNG，建 `Match`，`debug` 开放调试命令 |
| `command` | `(commandJSON: string)` | `""` 成功 / 错误字符串 | 解析 `Command` 并执行 |
| `update` | `(dt: number)` | `void` | 推进一帧（风、飞行、AI、坠落、回合） |
| `snapshot` | `()` | JSON 字符串 / `"null"` | 当前完整 `Snapshot` |
| `events` | `()` | JSON 数组字符串 / `"[]"` | 自上次调用以来的增量事件（按 `seq`） |

JS 版 `GunnyEngine` **保持完全相同的 5 个方法名与签名**。`standalone-api.js` 只需把
`window.GunnyWasm` 换成 `GunnyEngine` 实例，`flush()` / `_startTimer()` / `fetch` 拦截逻辑原样保留。

> 注意 `init` 的 4 个 `Uint8Array`：JS 版不再需要 `WebAssembly.instantiate`，但 `boot()` 里
> `loadBytes()` 读 `.fore.map` 与 `crater-*.png` 的代码保留；PNG 用 `createImageBitmap` +
> `OffscreenCanvas.getImageData` 解析 alpha 形状（等价于 Go `decodeCraterArt`）。

### 5.2 `Snapshot` schema（`server/game/snapshot.go`，逐字段照抄）

```text
seq, phase, turn, round
wind, windTarget, windLabel
angle, angleMin, angleMax, force, charging, chargeElapsed
weapon, enemyWeapon, weapons[]
actors[{ index,id,name,subtitle,x,y,hp,maxHp,facing,alive,walkDirection,
         walkTime,animTime,slope,vy,falling,grounded,fireTimer,hurtTimer,
         aimAngle,flash,weapon, baseDamage,attack,baseGuard,defence,grade,
         lucky,damagePlus,shootMinus,worldBossAddDamage }]
shots[], shot, lastImpact{ x,y,type,owner,damage,critical,distance,removed,
                           craterKind,craterArt,shell,shells }
lastPlayerSummary, lastPower, winner
stats{ playerShots,playerHits,enemyShots,enemyHits,playerDamageDealt,
       playerDamageTaken,playerHeals,playerHealed }
healsRemaining, skillUses{}, selectedSkill, selectedBuffs[]
powSelected, carryArmed, canCarry, energy, stamina
countdown, showCountdown, enemyAimAngle, metricsX, metricsY
craters[], time, terrainWidth, terrainHeight, terrainHash
```

字段名、类型、可空性一个都不能变——`net-client.js` 的 `_applySnapshot()` 与
`renderer.js` 直接按这些字段读。序列化用 `JSON.stringify`，与 Go `encoding/json` 对齐
（`omitempty` 字段如 `critical` 在 0 时省略，JS 需手动省略）。

### 5.3 `Event` schema

```json
{ "seq": 42, "type": "fire|impact|crater|sound|translate|carry|heal|pow|gameover|state", "data": {...} }
```

`events()` 返回 `seq > lastSeq` 的增量数组；`flush()` 里逐个 `emit(source,'game',...)`，
再追加一条 `state` 事件。`net-client.js` 的事件白名单（含 `carry` / `translate`）必须保持一致。

### 5.4 `Command` 集合（`server/game/match.go`，19 个外部命令）

| 类别 | `type` | 关键字段 |
| --- | --- | --- |
| 对局 | `restart` | — |
| 武器/瞄准 | `select_weapon`, `aim_delta`, `aim_absolute` | `weapon`, `delta`, `value` |
| 移动/蓄力 | `move`, `charge_start`, `charge_release`, `charge_cancel` | `dir`, `delta` |
| 技能 | `skill`, `carry`, `pow`, `heal` | `skill`, `enabled` |
| 开火 | `fire` | `angle`, `force`, `wind`, `windSet` |
| 调试（`debug=true`） | `debug_set_position`, `debug_set_wind`, `debug_set_hp`, `debug_set_energy`, `debug_set_stamina`, `debug_set_countdown`, `debug_carve` | `x`,`y`,`hp`,`value`,`seconds`,`art`,`kind` |

`Command` 结构本身只有扁平字段（`type/actor/dir/delta/value/angle/force/skill/weapon/x/y/target/hp/enabled/seconds/art/kind/wind/windSet`），
JS 侧不需要类，直接取对象字段即可。

### 5.5 为什么表现层几乎不用改

`net-client.js` 的 `RemoteMatch` 只做三件事：订阅 `EventSource` 的 `state`/`game` 事件、
`_post({type:...})` 命令、维护特效队列。这三件事在 JS 引擎下完全一样。
唯一建议改的是把 `dist/js/main.js` 里的 `__GUNNY_BACKEND__` 取值从 `'go'|'wasm'`
改成 `'go'|'js'`（仅日志/测试钩子用）。

---

## 6. Go → JS 模块映射（逐文件移植表）

| Go 文件 | 行数 | JS 目标 | 工作量 | 要点 |
| --- | --- | --- | --- | --- |
| `config.go` | 368 | `engine/constants.js` | 小 | 把 `SOURCE` 常数并入 `config.js`；`SpawnX=[240,1640]`、`WorldWidth=1843`、`WorldHeight=1020`、`BedrockY=1015`、`FixedWind=true`、`EnergyMax=100`、`PowDamageMultiplier=1.8`、`CriticalLucky=180` 一个不能漏 |
| `terrain.go` | 302 | `engine/terrain.js` | 中 | 复用 `dist/js/terrain.js` 的 chunk/mask/carve；补 `FindGroundY` / `FindNextWalkPoint` / `SlopeAt` / `Hash` / `CratersCopy` / `Carve` 跳过 `y>=BedrockY` |
| `physics.go` | 281 | `engine/physics.js` | 中 | 复用 `dist/js/physics.js`；补 `SourceDamage`（`falloff=1-distance/radius/4`）、`SourceCriticalDamage`、3px 子步 CCD、`trunc10`、`NextWind` |
| `ai.go` | 90 | `engine/ai.js` | 小 | 复用 `dist/js/ai.js`，`ChooseShotForWeapon` 签名对齐 |
| `match.go` | 924 | `engine/match.js` | **大** | `Command` switch、`Update(dt)`、移动/坠落/支撑刷新、回合推进、`Emit`、`BroadcastState`、`RNG`/`CritRNG` |
| `actions.go` | 570 | `engine/actions.js` | **大** | `fireLocked`、`updateFlightLocked`、`resolveImpactLocked`、`resolveCarryImpactLocked`、`launchQueuedShotLocked`、`finishFlightLocked`、`beginTurnLocked`、`healLocked` |
| `snapshot.go` | 127 | `engine/snapshot.js` | 小 | `snapshotLocked()` 逐字段序列化，注意 `omitempty` |
| `events.go` | 16 | 并入 `engine/match.js` | 极小 | `EventsSince(seq)` 过滤 `EventLog` |
| `wasm/main.go` | 120 | `engine/index.js` | 小 | 门面 5 方法；`init` 里 `LoadTerrainFromBytes` → JS 位图解析 |
| `offline-api.js` | 159 | `standalone-api.js` | 小 | 只换引擎实例 + `boot()` 去掉 WASM 实例化 |
| `game_test.go` | 569 | `tests/engine/*.test.mjs` | 中 | 逐用例移植，见 §9 |

预计新增/改写 JS 约 1.3–1.6k 行；删除 Go 约 3.4k 行、WASM 二进制 3.6 MB。

---

## 7. 确定性与数值一致性专项（最大风险）

> 用户明确要求过「同角度同力度轨迹一致」「联机两次轨迹不一样是 bug」。
> 重构后这条必须继续成立。以下每一条都要在 golden parity 里被验证。

### 7.1 PRNG：Go `math/rand` ≠ `Math.random()`

Go `rand.New(rand.NewSource(seed))` 是 **607-tap lagged Fibonacci**（`rngSource` +
`rngCooked` 常量表 + `seedrand`），与 V8 的 xorshift128+ 完全不同。当前用到：

- `RNG`：风向推进（`FixedWind=true` 时基本闲置）、AI 瞄准噪声、敌人移动距离；
- `CritRNG`：`rand.New(rand.NewSource(m.critSeed))`，独立于主 RNG，保证暴击可复现。

**方案 A（推荐）**：在 `engine/rng.js` 里逐行移植 Go `rngSource`（含 607 个 `rngCooked`
常量），实现 `Int63()` / `Intn(n)` / `Float64()` / `Seed(seed)`。这样任意固定 seed 下
JS 与 Go 输出逐位一致。

**方案 B（简化）**：不追求与 Go 逐位一致，改为「固定 seed 的确定性序列」+ 重新录制
golden 基准。代价是旧存档/回放不兼容，但本项目无存档，可接受。

> 无论哪种，`CritRNG` 必须保持**独立于** `RNG`，否则暴击会因 AI 消耗随机数而漂移。

### 7.2 截断与取整（最容易踩坑）

`server/game/physics.go` 里三处必须原样照抄：

```go
// 1) Euler 积分：坐标强制整数截断
e.X0 = math.Trunc(e.X0 + e.X1*dt)

// 2) trunc10 名字有误导性 —— 实际是「保留 1 位小数」（×10 取整，1e-7 抗浮点误差）
func trunc10(v float64) float64 {
    scaled := v * 10
    if scaled < 0 { return math.Ceil(scaled - 1e-7) }
    return math.Floor(scaled + 1e-7)
}

// 3) Launch：初速度分量直接 int() 截断向零
vx = float64(int(force*math.Cos(rad))) * float64(direction)
vy = -float64(int(force * math.Sin(rad)))
```

JS 里 `Math.trunc` 对负数同样是「向零截断」，与 Go `int()`/`math.Trunc` 一致，可直接用；
但 **不能用 `Math.floor` 代替**（负数方向会差 1）。`NextWind` 里 `trunc10` 与
`randomInt(rng,0,11)` 的组合也必须一致，否则风力序列分叉。

### 7.3 固定步长与 `dt`

`offline-api.js` 当前用 `setInterval(tick, 40)`，`dt=(now-last)/1000`，且
`if (dt > 0.12) dt = 0.04`（防止切后台后一次跳太大）。JS 版保持完全相同的驱动方式，
`Match.Update(dt)` 内部按 `dt` 累加（`FlightAccumulator` 等）逐行照搬，不要改成
`requestAnimationFrame` 或固定 1/60——那会改变齐射节奏。

### 7.4 地形位图解析（大端）

`dist/data/<id>.fore.map` 格式：

```text
[int32 big-endian width][int32 big-endian height][MSB-first 行位图字节...]
```

JS 用 `DataView.getUint32(0, false)` / `getUint32(4, false)` 读宽高，再按
`(y*rowBytes + (x>>3))` 取 bit `(0x80 >> (x & 7))`。**不能用小端**。
11 张地图统一 1843×1020，`SpawnX=[240,1640]`、`BedrockY=1015` 硬编码在引擎里，
换地图只换位图，不改世界尺寸。

同时 `Carve()` 必须跳过 `wy >= BedrockY`（硬地板不可破坏），且弹坑形状来自
3 张 `crater-*.png` 的 alpha（Go `decodeCraterArt` 的等价 JS 实现），与可见前景
`carveSource()` 保持像素一致——现状已由 `tests/verify_map_parity.py` 保证 0 偏差。

### 7.5 其他必须逐行照抄的点

| 项 | 来源 | 说明 |
| --- | --- | --- |
| `FixedWind = true` | `config.go` | 风力不随机滚动，保证同角度同力度可复现 |
| 3 px 子步 CCD | `physics.go` `StepProjectile` | 高速弹不穿地形 |
| `SourceDamage` 衰减 | `physics.go` | `falloff = 1 - distance/radius/4`；负值取 1 |
| `SourceCriticalDamage` | `Living.cs` | `critRate = lucky*45/(800+lucky)`，`crit = int((0.5+lucky*0.00015)*base)` |
| `Impact.damage` / `critical` 分离 | `SimpleBomb.BombImp` | 受害方扣 `damage + critical`，前端双飘字 |
| 飞行弹 `BombType.FLY` | `actions.go` `resolveCarryImpactLocked` | 零伤害零弹坑、沿反速度回退 5px、落点 `SetXY`、`translate` 事件 |
| `Terrain.Hash()` | `terrain.go` | 前端用于判断是否需重刷 mask，哈希算法要一致 |
| `CarryArmed` / `CanCarry` | `match.go` | 每回合 `beginTurnLocked` 重置（对应 `Player.PrepareNewTurn` 的 `CanFly`） |

### 7.6 Golden Parity 基准

在删 WASM 之前，用现有 `window.GunnyWasm` 录制一批基准：

```text
for mapId in [1156, 1002, 1192]:
  for seed in [1, 42, 12345]:
    init(map, craters, debug=true)
    for cmd in 固定命令序列:
        command(cmd); update(0.04) × N; 收集每帧 snapshot() + events()
    → 落盘 tests/golden/<mapId>-<seed>.jsonl
```

之后 JS 引擎跑同一序列，逐帧比对 `snapshot` 的**数值字段**（允许 `seq`/`time` 等
非玩法字段按规则处理）。这是判定「等价」的唯一标准，见 §9.2。

---

## 8. 分阶段实施路线

| 阶段 | 目标 | 交付物 | 验收标准 |
| --- | --- | --- | --- |
| **P0 契约冻结** | 锁死接口，录基准 | `engine/CONTRACT.md`（§5 的正式版）、`tests/golden/*.jsonl`、录制脚本 `tests/record_golden.cjs` | 基准可重复生成，两次录制 diff 为空 |
| **P1 权威底座** | 常数/地形/物理/AI 升级为权威 | `engine/constants.js`、`rng.js`、`terrain.js`、`physics.js`、`ai.js` | 单元级 parity：`Launch` / `Euler.Step(100 步)` / `SourceDamage` / `NextWind(50 次)` / `ChooseShot` 与 Go 输出逐一相等；`verify_map_parity.py` 仍 0 偏差 |
| **P2 状态机** | 搬 `match.go` + `actions.js` | `engine/match.js`、`actors.js`、`actions.js`、`snapshot.js` | 单机跑通：选武器 → 蓄力 → 单发命中 → 齐射 → 飞行弹传送 → 治疗 → 回合切换 → 电脑出招 → 胜负；`Snapshot` 字段与 golden 对齐率 ≥ 99% |
| **P3 接线** | JS 引擎替换 WASM | `engine/index.js`、`standalone-api.js`、`index.html` 新入口（带新旧开关） | 浏览器四件套全绿；`?engine=js` 与 `?engine=wasm` 双跑，同命令序列 snapshot 一致 |
| **P4 全量回归** | 清掉偏差 | parity 报告、修复清单 | 浏览器 acceptance/controls/mobile/static 4/4；物理 13/13；地图 0 偏差；暴击双飘字 / 9 张翻牌 / 墓碑灵魂 / 11 张地图端到端全通过 |
| **P5 清理** | 删 Go/WASM，收口文档 | 删除 `server/`、`dist/wasm/`、`scripts/build-wasm.sh`、`offline-api.js`；改 `package.json`、`build-static.sh`、`README-ZH.md`、`CODE_LAYOUT.md`、重生成 `SOURCE_MANIFEST.sha256`；`BUILD_VERSION` 3.0.0、缓存串 `?v=22` | `npm run check` 无 Go 依赖；`dist/` 纯静态可部署；线上站点行为不变 |

> P0–P4 期间旧引擎保持可用，`index.html` 用 `?engine=wasm` 兜底，任何阶段出问题都能回退。

---

## 9. 测试迁移策略

### 9.1 现有测试去留

| 测试 | 处理 |
| --- | --- |
| `server/game/game_test.go`（569 行，地形/风/弹道/伤害/暴击/carry/飞行/齐射/出生） | 逐用例移植为 `tests/engine/*.test.mjs`（`node:test`），用例名与断言一一对应 |
| `tests/physics.test.mjs`（13 项） | 保留并扩展，直接测 `engine/physics.js` |
| `tests/verify_map_parity.py` | 保留，继续校验可见前景与碰撞位图像素一致 |
| `tests/browser_acceptance.cjs` / `controls_audio.cjs` / `mobile.cjs` / `static.cjs` | **保留不动**（契约不变）；`static.cjs` 里对 WASM 的断言改为对 JS 引擎 |
| `tests/browser_static.cjs` 的「无后端 WASM 验收」 | 改名/改述为「无后端纯 JS 引擎验收」 |

### 9.2 新增 parity 测试

`tests/golden_parity.cjs`：同一命令序列分别驱动 WASM 与 JS 引擎（P0–P4 期），
逐帧比对 `snapshot()`：

```text
比对字段：phase/turn/round/wind/angle/force/charging/weapon/
          actors[].{x,y,hp,alive,falling,grounded,vy}/shots[]/lastImpact/
          craters[]/stats/energy/stamina/carryArmed/canCarry/winner
忽略字段：seq、time（非玩法），以及浮点末位 1e-9 级误差
输出：tests/golden/parity-report.md（不一致帧的字段级 diff）
```

### 9.3 回归顺序

```text
node --test tests/engine/*.test.mjs
  → node --test tests/physics.test.mjs
  → python3 tests/verify_map_parity.py
  → node tests/golden_parity.cjs
  → 四个 browser_*.cjs
  → 起本地静态服务 + 自定义端到端（飞行弹/暴击/翻牌/墓碑/11 图）
```

---

## 10. 文件增删清单

### 10.1 删除

```text
server/                         整个目录（main.go、game/、wasm/、go.mod、run.sh、check.sh、test.sh）
scripts/build-wasm.sh
dist/wasm/gunny.wasm            3.6 MB
dist/wasm/wasm_exec.js
dist/offline-api.js             由 standalone-api.js 取代
package.json 中的 start / start:debug / build:wasm / check 里的 gofmt+go vet
README-ZH.md 中 ddt / Go 服务相关章节（改为纯静态说明）
docs/CODE_LAYOUT.md、docs/GO_SERVER.md（内容并入新文档或标记废弃）
```

### 10.2 新增

```text
dist/js/engine/{index,constants,rng,terrain,physics,ai,actors,match,actions,snapshot}.js
dist/standalone-api.js
tests/engine/*.test.mjs
tests/golden/*.jsonl + tests/record_golden.cjs + tests/golden_parity.cjs
docs/PURE_JS_REFACTOR_PLAN.md（本文，实施时升级为 ROADMAP 进度版）
```

### 10.3 修改

```text
dist/index.html          去掉 /api/state probe 与 wasm_exec.js/offline-api.js 加载；
                         改为 <script type="module"> 引 standalone-api.js + main.js
dist/js/config.js        BUILD_VERSION 2.0.0 → 3.0.0；并入 Go 侧权威常数
dist/js/main.js          __GUNNY_BACKEND__ 取值 'wasm' → 'js'；缓存串 v21 → v22
dist/js/physics.js / ai.js / terrain.js   升级为权威（或移入 engine/ 后 re-export 兼容）
scripts/build-static.sh  去掉 build-wasm.sh 调用，直接 zip dist/
package.json             scripts 收敛为 check / test / test:browser:* / build:static
SOURCE_MANIFEST.sha256   按 git 全量文件重新生成
```

### 10.4 保持不动

```text
dist/js/net-client.js / renderer.js / input.js / camera.js / explosion.js / maps.js
dist/styles.css、dist/manifest.webmanifest
dist/data/*.fore.map（11 张）、dist/assets/（含 crater-50/401/4.png、11 张地图资源）
reference/、docs/SOURCE_MAPPING.md、docs/AUDIO_MAPPING.md、docs/VALIDATION.md
```

---

## 11. 风险与取舍

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **浮点/PRNG 差异导致弹道漂移** | 高：直接破坏「同角度同力度一致」 | 移植 Go PRNG（§7.1）、逐行照抄 `trunc10`/`math.Trunc`（§7.2）、golden parity 逐帧比对（§7.6） |
| 两套物理合并时的遗漏 | 中：推荐线与真实弹道分叉 | `dist/js/physics.js` 与 `engine/physics.js` 收敛为同一模块，禁止再出现第二份公式 |
| 首次加载从「下载 3.6 MB WASM」变成「解析 ~1.5k 行 JS」 | 低：首屏更快，但主线程解析/GC 特征不同 | 用现有预渲染/预烘焙优化（`resize()` 期离屏 canvas）兜底；`standalone-api.js` 启动时 `prewarm()` 一次 |
| 纯 JS 逻辑可被控制台篡改 | 低：本来就是单机静态站点，无排行/无存档 | 不做混淆；如需防作弊再引入服务端 |
| 失去 Go HTTP 服务端（联机/SSE） | 中：未来若想恢复联机会多一步 | **JS 引擎是同构的**：`engine/*.js` 是纯 ES Module，Node 里可直接 import，将来加一层 `ws` + `http` 即可把同一份权威逻辑搬到服务端，前端 `net-client.js` 的 SSE 契约甚至不用改 |
| 调试命令 `debug_*` 暴露 | 低 | 保持 `debug` 由 `?test=1` 控制，与现状一致 |
| 版本号/清单/文档遗漏 | 低 | P5 统一处理 `BUILD_VERSION`、`?v=22`、`SOURCE_MANIFEST.sha256` 全量重建 |

---

## 12. 重构时顺手处理的小问题

- **`manifest.webmanifest` 在带 `?sharecode=` 的托管平台下返回 403**：
  `index.html` 的 `<link rel="manifest" href="manifest.webmanifest?v=21">` 不会自动带上当前页
  的 `sharecode` 查询串，被访问控制拦下，线上 console 有一条 403（不影响可玩性）。
  重构改 `index.html` 时顺手改成由 JS 动态注入：
  `<link rel="manifest">` 的 href 拼上 `location.search` 中的 `sharecode`。
  本地 `http://127.0.0.1:8000` 无此问题，浏览器验收脚本已按文档忽略该探测 404。
- `?test=1` 下开图选择器不自动弹出、按钮带 `event.detail === 0` 防程序化点击保护——
  这是设计行为，端到端脚本要用 `page.click()` 真实鼠标事件，不要用 `element.click()`。
- `dist/js/main.js` 的 `window.__GUNNY_TEST__` 测试钩子（含 `debugEvent` / `debugImpact` /
  `toggleCarry` / `terrainCraterRecords`）在纯 JS 引擎下要继续保留，四个浏览器验收脚本依赖它。

---

## 13. Definition of Done

- [ ] `dist/` 内不再有 `.wasm` / Go 运行时，任意静态托管打开即玩，无 404 / pageerror。
- [ ] 11 张地图（`?map=` + 开局选择器）全部可用，前景与碰撞位图 0 偏差。
- [ ] 同角度 / 同力度 / 同风力 / 同种子下，两次开火轨迹逐帧一致。
- [ ] 飞行弹（零伤害零弹坑 + 传送）、暴击双飘字、墓碑灵魂、9 张 3 列 5 秒翻牌、
      轰天等炮弹按原画比例缩放，全部行为与 `0b61643` 一致。
- [ ] 浏览器四件套 + 物理 13 项 + 地图 parity + engine 单测 + golden parity 全绿。
- [ ] `server/`、`scripts/build-wasm.sh`、`dist/wasm/` 已删除；`npm run check` 不再需要 Go。
- [ ] `package.json`、`README-ZH.md`、`docs/CODE_LAYOUT.md`、`SOURCE_MANIFEST.sha256`、
      缓存版本 `?v=22` / `BUILD_VERSION 3.0.0` 全部同步。
- [ ] 远程只剩 `main`，提交并推送；静态站点重新发布并验证。

---

## 附：为什么这条路线成本低

关键在于 **契约与实现早就解耦了**：

```text
net-client.js  ──只认──▶  EventSource + fetch('/api/command')
                              ▲
                              │ 实现可替换
              ┌───────────────┴───────────────┐
              │ Go HTTP        │ WASM(现状)    │ 纯 JS(目标)
              └───────────────┴───────────────┘
```

`offline-api.js` 已经把「换实现」这件事做过一次（Go SSE → WASM）。
再做一次（WASM → JS）是同一个动作，且这次连 `physics/ai/terrain` 都已有 JS 版。
所以全量重构 ≈ **新写 1 个 Match 状态机 + 1 个门面 + 1 个适配器 + 对齐 3 个已有模块**，
而不是重写整个游戏。

---

## 附录 B：本次交付记录（按 1 推送 → 2 重新发布 → 3 文档收尾 顺序执行）

> 本节是「再写 md」这一步的产物：记录在功能代码与站点都已落定之后，按指定顺序
> 完成的推送、重新发布与文档收尾。全文仍为规划，未改动任何运行时代码。

### B.1 三步执行结果

| 顺序 | 动作 | 结果 |
| --- | --- | --- |
| **1** | 推送 `main` | 工作区干净、清单 `sha256sum -c` 失败 0；首次 push 遇 GitHub 间歇 502，重试后 `Everything up-to-date`；远程 `HEAD` 与 `refs/heads/main` 均为 `ea40ca45e64024012ed73c82275e4ae971512d6a`，与本地一致；远程分支仅 `main` |
| **2** | 重新发布静态站点 | `publish.js --dir dist --language static` 返回 `{"shareLink":"…","verified":true}`，链接不变 |
| **3** | 再写 md（本节） | 补充交付记录与基线状态；随后同步 `SOURCE_MANIFEST.sha256`、提交并做一次收尾推送，使远程包含最终版文档 |

### B.2 重新发布后的线上验证

站点：<https://a49f3350593822301.app.workbuddy.host/?sharecode=UMJ5YC3KWL>

| 检查项 | 结果 |
| --- | --- |
| 首页缓存版本 | `?v=21` |
| `gunny.wasm` / `maps.js` / `offline-api.js` / `styles.css`（带 `?v=21`） | 全部 200 |
| `data/1156.fore.map` / `assets/map-1192-back.jpg` | 全部 200 |
| 线上 `gunny.wasm` SHA256 | `3af03676dbf7b31b02933fc6761b0fc73fe533864c33fb9283c36a276b8acd58`，与本地 `dist/wasm/gunny.wasm` 完全一致 |
| 浏览器实测 `?test=1&map=1156 / 1002 / 1192` | 三张地图均进入 `player` 阶段，双方 `hp=2000 / alive=true`，落地坐标随地形变化（1156: y=389/522，1002: y=752/745，1192: y=281/438），`pageerrors: []` |

> 注：带 `?v=` 的资源在带 `sharecode` 的托管平台上要用 `&sharecode=` 拼接；
> 写成两个 `?` 会返回 403，这是 URL 拼接问题，不是资源缺失。

### B.3 结论与后续

- 线上站点行为与规划基线一致；**本次未改动 `dist/` 内任何文件**，站点产物仍是 `0b61643`。
- 本文档与 `README-ZH.md` 索引位于 `docs/` 与仓库根目录，不进入 `dist/`，因此不影响站点。
- 未来真正实施重构时，才需要按 §8 的 **P5** 更新 `BUILD_VERSION`、`?v=`、清单并**重新发布站点**；
  在那之前的任何文档修订都不需要重新部署。
- 文档修订后的收尾推送，只是把最终版 md 同步到远程，不涉及功能代码；
  功能代码已在第 1 步推送完成。
