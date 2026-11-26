# CODE LAYOUT — Go 权威服务端 + JS 渲染前端

## 1. 进程与端口

```text
浏览器 (dist/*.js)
   │  GET  /api/state          一次性 JSON 快照
   │  GET  /api/events         SSE: state / game
   │  POST /api/command        玩家意图
   ▼
Go 服务 (server/main.go)
   │  静态文件: ../dist
   ▼
server/game  (权威战斗引擎)
```

默认监听 `:8000`，可用 `GUNNY_ADDR=127.0.0.1:9000` 覆盖。
`GUNNY_DEBUG=1` 时开放 `/api/command` 的 `debug` 指令，浏览器验收使用 `?test=1`。

## 2. 服务端文件

| 文件 | 职责 |
| --- | --- |
| `server/main.go` | 静态文件、状态快照、命令入口、SSE 广播、机器人与回合 tick |
| `server/game/config.go` | 原版常数、出生点、伤害/技能/物理参数、`SOURCE/TEMP/PORT/NEW` 标注 |
| `server/game/terrain.go` | 解析 `reference/map/1001/fore.map`，`Solid/SlopeAt/FindNextWalkPoint/Carve` |
| `server/game/physics.go` | 原版 Euler、风、弹道、3 px 子步 CCD、`MakeDamage` 衰减 |
| `server/game/ai.go` | 与玩家同一套物理的粗搜 + 细搜瞄准 |
| `server/game/match.go` | `Command` 状态机、回合推进、移动、蓄力、坠落、快照 |
| `server/game/actions.go` | 锁定发射、`ShootImp` 多发偏移、弹坑/伤害结算、治疗 |
| `server/game/snapshot.go` | 面向前端的 JSON 结构 |
| `server/game/game_test.go` | 地形、风、弹道、伤害、AI、齐射、出生的回归测试 |

### 2.1 回合状态机

```text
waiting -> player (蓄力/移动/治疗)
player --fire--> firing (volley 内逐发飞行/爆炸)
firing --resolve done--> enemyThink -> enemy -> ...
任意时刻 HP<=0 -> over
```

服务端以 `Tick(dt)` 推进；前端只显示服务端时间，不自行结算。

### 2.2 快照

`GET /api/state` 与 SSE `state` 事件返回同一结构：

```json
{
  "phase": "player|firing|enemy|over|waiting",
  "revision": 42,
  "world": {"width": 2000, "height": 1425},
  "wind": -3,
  "actors": [{"id":"player","x":300,"y":...,"hp":2000,...}],
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
| `dist/js/config.js` | 镜像服务端常数的展示参数；不参与权威结算 |
| `dist/js/terrain.js` | 前景 chunk、mask、`carveSource()` 精确重放服务端弹坑 |
| `dist/js/net-client.js` | `RemoteMatch`：EventSource、命令、快照插值、特效队列 |
| `dist/js/physics.js` | 仅用于本地瞄准推荐/预览，不提交结果 |
| `dist/js/ai.js` | 固定角度扫力度的推荐线；不再驱动电脑 |
| `dist/js/renderer.js` | 世界层、地形、角色、炮弹、粒子 |
| `dist/js/camera.js` | 玩家/双方/跟弹相机 |
| `dist/js/input.js` | Pointer/键盘/取消，只产生命令 |
| `dist/js/explosion.js` | 粒子形状与视觉噪声（不修改 mask） |
| `dist/js/main.js` | 启动 `RemoteMatch`、HUD、全屏、PWA、测试钩子 |
| `dist/offline-api.js` | 静态站点适配：用 WASM 实现 EventSource + `/api/command` |
| `dist/wasm/gunny.wasm` | `server/game` 经 `server/wasm` 编译的浏览器引擎（3.6 MB） |
| `dist/wasm/wasm_exec.js` | 与 Go 工具链匹配的 WASM 运行时 |
| `dist/data/1001.fore.map` | 服务端地图碰撞位图，WASM 初始化时读取 |

前端 `physics.js` 与服务端 `physics.go` 的公式必须保持一致；任何偏差只影响
“推荐力度”，不会影响真实命中。

## 4. 启动/测试

```bash
ddt                       # 任意目录：编译、后台启动、打开浏览器
ddt restart               # 改完代码后重启
ddt stop / ddt status     # 停止 / 查看
ddt debug                 # 调试模式（浏览器测试）

# 等价的 npm 入口
npm start                 # sh server/run.sh
GUNNY_DEBUG=1 npm start   # 浏览器测试需要
npm test                  # Go + JS 物理测试
npm run build:wasm        # 编译 dist/wasm/gunny.wasm
npm run build:static      # 生成 gunny-static.zip（index.html 在根目录）
npm run test:browser:static # 无 Go 后端的静态 WASM 验收
npm run check             # JS 语法 + gofmt + go vet
npm run test:browser      # 需要 Chrome + puppeteer-core
```

`ddt` 由 `bin/ddt` 实现，通过 `~/.local/bin/ddt` 软链接进入 PATH；
二进制与 PID/日志放在项目 `.run/`。

## 5. 数据来源

- 碰撞：`reference/map/1001/fore.map`（2000×1425，每行 251 字节）。
- 素材：`dist/assets/`，来自 `Tank.Flash/resource/v1.1/image/`。
- 参数对照：`docs/SOURCE_MAPPING.md`；服务端细节：`docs/GO_SERVER.md`。
