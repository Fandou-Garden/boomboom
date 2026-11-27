# CODE LAYOUT — 双后端（Go 服务端 / 纯 JS 引擎）+ JS 渲染前端

## 1. 进程与端口

两条路径对外是同一套 `/api` 契约，前端 `RemoteMatch` 不区分后端：

```text
浏览器 (dist/*.js)
   │  GET  /api/state          一次性 JSON 快照
   │  GET  /api/events         SSE: state / game
   │  POST /api/command        玩家意图
   ├─ 有 Go 服务：──────────────────────────────────┐
   │   Go 服务 (server/main.go)                     │
   │   │  静态文件: ../dist                          │
   │   ▼                                            │
   │   server/game (Go 权威引擎)                     │
   │                                                │
   └─ 无 /api（静态站）：standalone-api.js 在浏览器内 ─┘
       LocalEventSource + /api/command shim
       ▼
       dist/js/engine (纯 JS 权威引擎，server/game 的逐字段移植)
```

`dist/index.html` 启动时探测 `/api/state`，设 `window.__GUNNY_BACKEND__` 为
`'go'` 或 `'js'`；只有离线才 `import('./standalone-api.js')`，随后统一加载
`js/main.js`。静态站没有任何 Go/WASM 运行时。

默认监听 `:8000`，可用 `GUNNY_ADDR=127.0.0.1:9000` 覆盖。
`GUNNY_DEBUG=1` 时开放 `/api/command` 的 `debug` 指令，浏览器验收使用 `?test=1`。

## 2. 服务端文件

| 文件 | 职责 |
| --- | --- |
| `server/main.go` | 静态文件、状态快照、命令入口、SSE 广播、机器人与回合 tick |
| `server/game/config.go` | 原版常数、出生点、伤害/技能/物理参数、`SOURCE/TEMP/PORT/NEW` 标注 |
| `server/game/terrain.go` | 解析 `data/<id>.fore.map`（1843×1020），`Solid/SlopeAt/FindNextWalkPoint/Carve` |
| `server/game/physics.go` | 原版 Euler、风、弹道、3 px 子步 CCD、`MakeDamage` 衰减 |
| `server/game/ai.go` | 与玩家同一套物理的粗搜 + 细搜瞄准 |
| `server/game/match.go` | `Command` 状态机、回合推进、移动、蓄力、坠落、快照 |
| `server/game/actions.go` | 锁定发射、`ShootImp` 多发偏移、弹坑/伤害结算、治疗 |
| `server/game/snapshot.go` | 面向前端的 JSON 结构 |
| `server/game/game_test.go` | 地形、风、弹道、伤害、AI、齐射、出生的回归测试 |

### 2.1 回合状态机

```text
player --fire--> flight --落点/超时--> resolve

resolve --enemy 行动--> enemy_move -> enemy_think -> enemy_aim -> flight -> resolve
resolve --下一回合--> player
任意时刻 HP<=0 -> over；治疗走 heal 分支后回到 resolve
```

服务端以 `Tick(dt)` 推进；前端只显示服务端时间，不自行结算。

### 2.2 快照

`GET /api/state` 与 SSE `state` 事件返回同一结构：

```json
{
  "phase": "player|flight|resolve|enemy_move|enemy_think|enemy_aim|heal|over",
  "seq": 42,
  "world": {"width": 1843, "height": 1020},
  "wind": -3,
  "actors": [{"id":"player","x":240,"y":...,"hp":2000,...}],
  "projectiles": [{"id":7,"x":...,"y":...,"trail":[...]}],
  "craters": [{"x":...,"y":...,"kind":401}],
  "impact": {"x":...,"y":...,"removed":123,...},
  "skills": {...},
  "turn": 1
}
```

`impact` 只在新爆炸后出现一次，前端播放后不重复挖洞。

## 3. 前端文件（只负责表现）

| 文件 | 职责 |
| --- | --- |
| `dist/js/engine/` | 纯 JS 权威引擎：`match/physics/terrain/ai/actions/rng/constants/snapshot/json` |
| `dist/standalone-api.js` | 静态站适配：用 JS 引擎实现 EventSource + `/api/command` |
| `dist/js/config.js` | 镜像服务端常数的展示参数；不参与权威结算 |
| `dist/js/terrain.js` | 前景 chunk、mask、`carveSource()` 精确重放服务端弹坑 |
| `dist/js/net-client.js` | `RemoteMatch`：EventSource、命令、快照插值、特效队列 |
| `dist/js/physics.js` | 仅用于本地瞄准推荐/预览，不提交结果 |
| `dist/js/ai.js` | 固定角度扫力度的推荐线；不再驱动电脑 |
| `dist/js/renderer.js` | 世界层、地形、角色、炮弹、粒子 |
| `dist/js/camera.js` | 玩家/双方/跟弹相机 |
| `dist/js/input.js` | Pointer/键盘/取消，只产生命令 |
| `dist/js/explosion.js` | 粒子形状与视觉噪声（不修改 mask） |
| `dist/js/main.js` | 启动 `RemoteMatch`、HUD、手机全屏说明、PWA、测试钩子 |
| `dist/data/<id>.fore.map` | 权威碰撞位图（11 张图），Go 与 JS 引擎都直接读取 |

前端 `physics.js` 与服务端 `physics.go` 的公式必须保持一致；任何偏差只影响
“推荐力度”，不会影响真实命中。权威引擎的另一份实现 `dist/js/engine/physics.js`
则必须与 `physics.go` 逐位一致，由 `tests/engine/parity.test.mjs` 的金标准守护。

## 4. 启动/测试

```bash
ddt                       # 任意目录：编译、后台启动、打开浏览器
ddt restart               # 改完代码后重启
ddt stop / ddt status     # 停止 / 查看
ddt debug                 # 调试模式（浏览器测试）

# 等价的 npm 入口
npm start                 # sh server/run.sh
GUNNY_DEBUG=1 npm start   # 浏览器测试需要
npm test                  # Go 测试 + JS 物理 + JS 引擎（功能 + Go 金标准）
npm run test:engine       # 只跑 dist/js/engine 的套件，不需要 Go
npm run build:static      # 生成 gunny-static.zip（纯 JS，index.html 在根目录）
npm run build:wasm        # 可选：重建旧 WASM 兜底到 dist/wasm/（不进静态包）
npm run test:browser:static # 无 Go 后端的纯 JS 引擎验收
npm run test:browser:mobile # 手机横屏/竖屏预览验收
npm run check             # JS 语法 + gofmt + go vet
npm run test:browser      # 画面 + 控件 + 手机适配，需要 Chrome + puppeteer-core
```

`ddt` 由 `bin/ddt` 实现，通过 `~/.local/bin/ddt` 软链接进入 PATH；
二进制与 PID/日志放在项目 `.run/`。

## 5. 数据来源

- 碰撞：`dist/data/<id>.fore.map`（1843×1020，每行 231 字节）；
  `reference/map/<id>/fore.map` 仅作生成/校验对照。
- 素材：`dist/assets/`，来自 `Tank.Flash/resource/v1.1/image/`。
- 参数对照：`docs/SOURCE_MAPPING.md`；服务端细节：`docs/GO_SERVER.md`。
