# GO SERVER — 权威战斗服务

## 1. API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/state` | 当前完整快照 |
| GET | `/api/events` | SSE；事件 `state`（每 tick/变更）与 `game`（一次性提示） |
| POST | `/api/command` | `{"type":"move","dir":-1}` 等玩家意图 |
| POST | `/api/command` | `debug` 仅在 `GUNNY_DEBUG=1` 时接受 |

命令类型（与 `dist/js/engine/match.js` 完全一致）：`restart`、`select_weapon`、
`move`、`aim_delta`、`aim_absolute`、`charge_start`、`charge_release`、
`charge_cancel`、`skill`、`carry`、`pow`、`heal`、`fire`，以及仅调试模式可用的
`debug_set_position`、`debug_set_wind`、`debug_set_hp`、`debug_set_energy`、
`debug_set_stamina`、`debug_set_countdown`、`debug_carve`。服务端会校验回合与阶段，
非法命令返回错误字符串（HTTP 4xx + 原因），不会改变状态。

## 2. 已按原版还原的部分

| 原版 | Go |
| --- | --- |
| `EnergyView.as` `FORCE_MAX=2000`、每帧 `+20`、30 fps | `config.ForceMax`、`ChargeRate=600/s`、`MinFireForce=20`，到顶保持 |
| `SimpleBomb.cs` `m_lifeTime += 0.04f` | `Physics.DT=0.04`，`StepProjectile` 固定步进 |
| `EulerVector` 重力/风/阻力 | `physics.go` 同名公式；风值 `-9..9` 来自 `BaseGame.GetNextWind` |
| `Player.MOVE_SPEED=2`、`GameLiving._speedX=3` | 约 90 px/s；`Terrain.FindNextWalkPoint` 查 x±1 列 |
| `Living.ShootImp` 多发偏移 | `i=0 (0°,1.0)`、`i=1 (-5°,0.9)`、`i=2 (+5°,1.1)` |
| `SimpleBomb.MakeDamage` | 距离衰减、DR1/DR2/DR3、WorldBossAddDamage、最低伤害 |
| `Map.Dig` / crater 位图 | `Terrain.Carve` 只删除“当前实心且位图 alpha>100”的像素 |
| `Map.FindNextWalkPoint` | 逐列向上/向下找最近实心点，限制单步高度 |

## 3. 仍是 TEMP / PORT 的部分（必须在改动时保留标注）

| 项 | 当前值 | 原因 |
| --- | --- | --- |
| 玩家 `BaseDamage/BaseGuard/Defence/Attack/HP` | 360/80/40/100/2000 | 原版玩家行在 SQL 备份中不可读；公式结构来自 `SimpleBomb.cs`，数值为 TEMP |
| 电脑 HP | 2000 | 与玩家同值，便于练习；原版 PVP 血量未取到 |
| 出生点 | `x=240 / 1640` | 原版 `PosX/PosX1` 不可用，按地图地表探测得到对称 PORT 值 |
| AI 决策 | Go 粗搜+细搜 | 原版 `SimpleBrain.cs` 为空壳、`AMissionControl` 抽象，无法直接移植 |
| 1–8 道具、增幅、无限体力、治疗 | 见 `config.go` / `match.go` | **NEW** 网页规则，不是原版技能 |
| 伤害数字/粒子/相机 | 前端 | **NEW** 表现层 |

## 4. 物理细节

- 单位：位置 px，时间 s，力度 0–2000。
- 重力：`mapGravity=10`、`gravityFactor=70`、`mass=10`，按原版 `Euler` 公式组合；不做额外缩放。
- 风：`windFactor=240`，风值 `-9..9`；每回合结束 `GetNextWind` 重新取。
- 阻力：`airResistFactor=1`、`mapDragIndex=2`，按原版 `Euler` 的速度衰减。
- CCD：每 0.04 s 内按 3 px 子步推进，避免高速穿地。
- 爆炸：先算伤害（含距离衰减），再按 crater mask 挖洞；齐射内每发独立结算。

## 5. 运行

```bash
cd gunny-wind-arena
npm start
# 或
cd server && go run .
```

环境变量：`GUNNY_ADDR`（默认 `:8000`）、`GUNNY_DEBUG=1`、`GO_BIN`（`run.sh` 用）。

## 6. 静态纯 JS 模式

公网站点没有 Go 进程，`dist/index.html` 探测 `/api/state` 失败后加载
`dist/standalone-api.js`，由 `dist/js/engine/` 的纯 JS 引擎在浏览器内结算。
引擎门面与旧的 WASM 绑定逐方法对应（`server/wasm/main.go` 是这层契约的原型）：

| JS（`GunnyEngine`） | Go |
| --- | --- |
| `init(mapBytes, c50, c401, c4, debug)` | `game.LoadTerrainFromBytes` + `game.NewMatch` |
| `command(json) -> '' \| errtext` | `Match.Command` |
| `update(dt) -> null` | `Match.Update` |
| `snapshot() -> jsonString` | `Match.Snapshot` |
| `events() -> jsonArrayString` | `Match.EventsSince` |

`standalone-api.js` 用 `LocalEventSource` 每 40 ms 调用 `update`，把事件包成
`{seq,type,data}` 的 `game` 事件、把快照包成 `{seq,type:"state",data}`，与 SSE 格式
完全一致，因此 `RemoteMatch` 不需要分支。`/api/command` 被同文件拦截并转给
`GunnyEngine.command`。

静态引擎使用同一个 Go `math/rand` 算法的 JS 移植（`rng.js`）、同一张
`data/<id>.fore.map`、同一组 crater 位图常量；`tests/engine/parity.test.mjs`
用从 Go 引擎导出的金标准逐字段校验（seq/血量/伤害/暴击/弹坑/能量/事件/AI 参数）。
唯一已知偏差是 Go `math.Sin` 与 V8 `Math.sin` 的 1 ulp 差异，只影响未截断的炮口
原始浮点坐标。

构建：

```bash
npm run build:static # 打包 gunny-static.zip（纯 JS，不含 wasm/）
npm run build:wasm   # 可选：仍可把 server/wasm 编译成 dist/wasm/ 旧兜底
```

`server/` 与 `server/wasm/` 保留在仓库中；静态包默认不再包含 `dist/wasm/` 与
`dist/offline-api.js`。测试命令在纯 JS 路径下由 `?test=1`（`new Match({debug:true})`）
控制，普通公网页面没有测试钩子。

## 7. 测试

```bash
cd server && go test ./...
npm run test:engine        # dist/js/engine：功能 21 项 + Go 金标准 6 项
npm run test:browser:static
```

覆盖：fore.map 头/尺寸、弹坑像素数、风范围、ShootImp 偏移、伤害衰减、
开局落点、齐射结算、AI 按当前武器的角度范围可达；Go 与 JS 的同一命令序列
逐字段一致。
