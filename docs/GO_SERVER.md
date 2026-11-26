# GO SERVER — 权威战斗服务

## 1. API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/state` | 当前完整快照 |
| GET | `/api/events` | SSE；事件 `state`（每 tick/变更）与 `game`（一次性提示） |
| POST | `/api/command` | `{"type":"move","dir":-1}` 等玩家意图 |
| POST | `/api/command` | `debug` 仅在 `GUNNY_DEBUG=1` 时接受 |

命令类型：`start`、`move`（按下/松开）、`aim`、`chargeStart`、`chargeRelease`、
`fire`、`heal`、`selectSkill`、`debug`。服务端会校验回合与阶段，非法命令返回
`{"ok":false,"reason":"..."}`，不会改变状态。

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
| 出生点 | `x=300 / 1700` | `MapServerList.xml` 的 map/1001 `PosX/PosX1` 缺失，按对称 PORT 值 |
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

## 6. 测试

```bash
cd server && go test ./...
```

覆盖：fore.map 头/尺寸、弹坑像素数、风范围、ShootImp 偏移、伤害衰减、
开局落点、齐射结算、AI 按当前武器的角度范围可达。
