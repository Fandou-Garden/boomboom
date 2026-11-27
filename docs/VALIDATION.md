# 验证记录

验证日期：2026-11-26（3.0.0 基线），2026-11-27 追加地图分批加载与玛雅废墟复验。环境：本机 Chromium（headless，启用 GPU）+ Node 22，本地
`http://127.0.0.1:8000/?test=1`。这是浏览器设备仿真，不等同于真实 iPhone/Android
硬件；触摸手感、真实 Home Indicator 和低端机性能仍建议在目标手机复测。

## 1. 自动化结果

```text
npm run check
CHECK PASS

npm test
Go: gunny/server/game ok
Node: 61 tests / 61 pass / 0 fail

npm run test:browser:visual
BROWSER ACCEPTANCE PASS

npm run test:browser:controls
CONTROLS + AUDIO ACCEPTANCE PASS

npm run test:browser:static
STATIC WASM ACCEPTANCE PASS

npm run test:browser:mobile
MOBILE ADAPTATION PASS
```

`tests/browser_acceptance.cjs` 使用真实 Pointer Events、游戏循环和 Web Audio，不绕过
战斗规则。结果写入 `tests/screenshots/acceptance.json`。

## 2. 双视口验收

| 视口 | 初始 zoom | 蓄力截图 | 飞行截图 | 结果 |
| --- | --- | --- | --- | --- |
| 844×390 | 1.1449 | `charge-844x390.png` | `flight-844x390.png` | PASS |
| 667×375 | 0.9191 | `charge-667x375.png` | `flight-667x375.png` | PASS |

两个视口均完整跑过“瞄准 → 蓄力 → 发射 → 飞行 → 落地 → 电脑回合”：

- 瞄准与落地取景以行动方为准（`VIEW.defaultMode='player'`，基础 zoom）：行动方角色
  完整在屏，且不与顶部 HUD、小地图、转盘、力度尺、技能栏、POW/蓝色主键相交；对手在
  屏外时显示一条方向正确的边缘提示（`hints`），`both` 取景（残局墓碑）下双方完整入镜
  且无提示。验收断言按此契约分模式校验，不再要求双方始终同屏。
- 蓄力截图显示行动方、左下四向转盘、当前力度百分比、推荐/上一发数字。
- 飞行截图镜头在天空跟弹，双方允许离屏；HUD 容器矩形在蓄力和飞行之间偏差 < 0.51 px。
- 飞行中主键禁用，额外点击不会增加炮弹数；相机缩放单向过渡，不来回振荡。
- 弹坑落定后相机离开 `shot` 跟弹，回到行动方取景（`player` 居中；`over` 时 `both`
  框住双方墓碑），缩放回到接近瞄准值；玩家上一发记录按世界坐标投影，允许在电脑回合
  离屏。
- 667×375 下右侧技能列不会压住行动方；最窄视口仍保留 74 px 蓝色主键。

## 3. 操作与反馈

| 项目 | 实测 |
| --- | --- |
| 右下主键 | 中心命中 `#fire`；按住 700 ms 进入蓄力，松手发射 |
| 底部安全区 | 主键底边距屏幕底部 ≥ 76 px；方向键/技能键 ≥ 34 px |
| 小地图拖动 | `cameraX` 改变、角色 x 不变；落点世界坐标不变，屏幕位置按新相机重算 |
| 回到战场 | `manualPan=false`，重新取景 |
| 倒计时 | 默认关闭；开启 1 s 后只显示秒数，`playerShots` 不变 |
| 不可达角度 | 15° 顺风远距离：`reachable=false`，显示“推荐 — / 调角”，角度仍为 15°，不发射 |
| POW | 能量未满时 disabled；点击只选中，`phase=player`、炮弹数不变 |
| 三向散射 | 3 枚全部 `resolved && !alive` 后回合才从 0 变 1，电脑此前 0 发 |
| 玩家记录 | 电脑完整出手后，上一发站位/落点仍为玩家数据 |
| 落点标记 | 相机拖动后仍与地形世界坐标投影一致（< 1.5 px） |

## 4. 音效

验收先启用 Web Audio，再用真实开炮/命中/大招触发；读取实际波形峰值，不只检查开关。
浏览器自动播放策略要求一次用户手势；验收已先启用音频。

逐武器矩阵同时校验 `BallList.xml` 的 `ShootSound`/`BombSound`：

| 武器 | 开炮样本 | 爆炸样本 |
| --- | --- | --- |
| 烈火 | 025 | 087 |
| 轰天 | 023 | 087 |
| 水果篮 | 114 | 102 |
| 黑白家电 | 110 | 100 |
| 风神 | 029 | 089 |

真实战斗用例使用风神/水果篮各打一轮，确认 `fire`/`explosion` 事件的 `sample` 与上表
一致且 `peak > 0`；道具/POW 仍为 039，选道具 008，阵亡 042，回合 016/038，胜负 063/064。

## 5. 角色动画与帧率

操作验收直接读取 `window.__GUNNY_TEST__.snapshot().poses`，断言角色姿势而不只是截图：

- 待机：玩家和电脑都必须是 `STAND` 帧（`0/8/9/10`；6/7 为仰头反应帧，不参与循环），且 `weaponVisible=false`；
- 按住蓄力：必须是 `SHOWGUN` 帧（`19/20/21`），且 `weaponVisible=true`；
- 开炮后：必须是 `SHOT` 帧（`22/23/26/27`），且 `weaponVisible=true`。

帧序来自 `GameCharacter.as`；武器显隐与 `body → weaponMovie` 层级来自 `GamePlayer.as`。
开炮动画固定 0.28 s，一次齐射（多发战斗道具）只触发一轮，不按炮弹数重复抬手。

流畅度方面：服务器快照 25 Hz，前端用本地 `visualTime` 驱动动画，角色位置按
`tau=22 ms` 指数平滑，炮弹用 `x+v·t+½a·t²` 外推（上限 60 ms）。小地图限制在约 30 Hz，
天空渐变按高度缓存，不再每帧分配；开炮前选择的武器会短暂锁定，避免飞行中的旧快照把 HUD
回退到默认武器。技能按钮和风力条只查询一次 DOM，技能状态变化才写 `disabled/class`；
推荐力度常态按 2% 扫描，整段无命中时才回退到 1%，避免每次调角都同步模拟 100 条弹道；
帮助/武器/竖屏遮罩打开时，画布与 HUD 重绘降到约 10 Hz，避免 `backdrop-filter` 下继续
满帧绘制战场。本机 headless Chromium 启用 GPU 时实测约 120 fps；触摸设备/小窗口将
画布 backing store 限制在 1.5× DPR。挖坑后服务端会重算角色所在列的真实地表高度并立即
刷新支撑点，回归测试 `TestCraterReseatsActorAndWalkStaysOnSurface` 已覆盖角色不陷入弹坑、
行走时脚底贴合地形。行走遇到陡坡时按 `SelfPlayerWalkAction` 的 `canStand` 门停下，
不再走进坡体；`tests/engine/embed.test.mjs`（移植自 `server/game/embed_sim_test.go`）
在 11 张地图上各跑 9000 tick 真实对局，逐 tick 断言角色不嵌入坡体、不悬空。

## 6. 静态站点（纯 JS 引擎）

`npm run test:browser:static` 在 Node 里起一个不带 `/api` 的静态 HTTP 服务，只提供
`dist/`，然后走真实浏览器：

| 项目 | 结果 |
| --- | --- |
| 后端探测 | `__GUNNY_BACKEND__='js'` |
| 引擎 | `GunnyEngine`（`dist/js/engine/`）初始化成功，地图 1843×1020 |
| 待机帧 | `STAND frame 9`，`weaponVisible=false` |
| 帧率 | 120 fps（844×390，headless Chromium） |
| 玩家开炮 | 1 发，落地生成 1 个弹坑，`removed>0` |
| 电脑回合 | `enemyShots=1`；本次 AI 直接命中玩家（弹坑数不变，伤害生效） |
| 重开 | `playerShots=0`，弹坑归零 |
| 页面错误 | 0（只忽略探测 `/api/state` 的 404） |

静态包只含 `dist/` 的 HTML/CSS/JS/素材与 `data/*.fore.map`（默认 1156，349 KB），
没有 WASM 或 Go 运行时；`npm run build:static` 会排除 `wasm/` 与 `offline-api.js`。
`tests/engine/parity.test.mjs` 另用 Go 金标准逐字段校验同一套规则。

## 7. 手机横竖屏适配

`npm run test:browser:mobile` 使用 iPhone UA、`isMobile` 和触摸仿真，覆盖浏览器栏占用
后的短横屏与竖屏预览：

| 项目 | 结果 |
| --- | --- |
| 横屏可视区 | 1024×386，`scrollWidth/Height` 与视口一致，无横纵溢出 |
| 底部控件 | 力度尺 bottom=376、发射键 right=1014，均在 386×1024 视口内 |
| 全屏键 | iPhone 上标题为“如何全屏”，不再调用必然失败的 API |
| 全屏说明 | 顶部非红色说明卡 top=58、bottom=116.9，力度尺 top=280.3，无重叠 |
| 红色警告 | `toast.alert=false`，角度盘、POW、发射键不被遮挡 |
| 竖屏门 | 390×844 显示旋转门，按钮为“如何全屏 / 先看看战场” |
| 竖屏预览 | 关闭旋转门后只读预览，控制层 `pointer-events:none`、opacity 0.18，常驻“竖屏仅预览” |
| 页面错误 | 0（只忽略探测 `/api/state` 的 404） |

iPhone 真机地址栏高度、Home Indicator 和嵌入浏览器顶部栏与仿真不完全相同；实际可视区
由 `visualViewport` 与 `env(safe-area-inset-*)` 动态计算，不再使用固定高度。

## 8. 保留项

- 世界为 **1843×1020**，玩家 x=240、电脑 x=1640，初始水平距离 1400 px（70.0 m）。
- 角色图集换成原版完整套装 `m/suits/suits571` 与 `f/suits/suits45`；地形、炮弹、弹坑
  素材未换，没有移动出生点来强行同屏。
- 单机回合、风力、连续碰撞、分块 Alpha Mask 地形破坏和确定性弹坑规则未改。
- 没有商城、房间、登录、联机或网络同步。

## 9. 已知未覆盖

- 真实 iPhone Safari 的元素全屏限制只能按降级逻辑模拟；无法在沙箱验证真实
  Home Indicator、地址栏动画和触摸延迟。
- 设备性能只在 headless Chromium 中观察；低端 Android 的 Canvas/内存表现需真机复测。
- 地图切换走整页重载（`?map=<id>`），没有无刷新热换图；但 extra 地图资源在后台预下载，
  下载期间可正常对局，完成后回到选图面板即解锁（见第 11 节）。
- 角色贴图来自原版完整套装图集，待机/移动/举枪/开炮/受击帧序已按
  `GameCharacter.as` 对齐，但不是完整 SWF 时间线（攀爬、跳跃等动作未使用）。

## 10. 公网发布

- 稳定地址：`https://slnp165x30zq.reakh.fun/`，`site_id=slnp165x30zq`。
- 历史：版本 6 首次切换到浏览器内 WASM；版本 7 修正文档与加载文案尺寸；版本 8 合并
  远端角色支撑、待机与流畅度修复；版本 9 修复 iPhone 横屏体验。
- **3.0.0** 把静态后端从 WASM 换成纯 JS 引擎（`dist/js/engine/` +
  `dist/standalone-api.js`），Go 服务端保留用于在线路径；静态资源查询版本现为 `?v=29`
  （3.0.0 首发为 v24，v25 随「角色/武器回退原版 1:1 尺寸」升级，v26 随「弹道搜索移入
  Web Worker」升级，v27 随「技能改为出牌制」升级，v28 随「原版技能图标 / 音效来源校正 /
  移除伪造的合成击中音」升级，v29 随「帮助文案与音频行为对齐」升级；
  `js/engine/` 内部引用仍为 `?v=25`）。
- 公网 `index.html` 引用 `styles.css?v=29`、`js/main.js?v=29`、`standalone-api.js?v=29`；
  静态包不再包含 `wasm/gunny.wasm`。
- 静态路径同步 v22 规则：`BallList.xml` 每发弹自带 `Power/Radii/Crater/Amount`，
  POW 打各武器 Special 弹（雷霆/烈火/水果篮/马桶三连发）；出生按原版语义扫描列，
  12 张地图均不嵌入悬空地形；`crater/121/131/411` 原版真图随包发布。
- 地图位图走预压缩 `data/<id>.fore.map.gz`（`DecompressionStream` 解压，
  无该 API 时回退原始 `.map`），前景图用无损 WebP，版本串 `?v=29`。
- 公网 844×390 冒烟：后端 `js`、双方 x=240/1640、待机帧 9、120 fps、
  玩家 1 发落地生成 1 个弹坑、console/page error 为 0。
- 静态资源首次加载约 350 KB 地图位图 + 约 1.5k 行 JS；浏览器随后使用版本化缓存。

## 11. 地图分批加载与玛雅废墟（2026-11-27）

`npm run test:map` 扩展为可传 map id：`python3 tests/verify_map_parity.py 1049` 对新图逐像素
校验（solid 620,885；mismatches 0）；1156 基线仍对照 `reference/map/1156/fore.map`（0 失配）。

`sh scripts/node.sh tests/browser_maps.cjs` 自起静态服务，跑真实浏览器：

| 项目 | 结果 |
| --- | --- |
| 清单分组 | core 5 / extra 6（含玛雅废墟 1049） |
| 首屏 extra 请求 | 0（extra 卡片不发 fore/back/thumb/collision） |
| 下载期间 | 可选 core 图开局，不阻塞 |
| 玛雅废墟下载 | 4+ 件资源命中、卡片就地解锁、`localStorage['gunny.map.loaded.1049']=1` |
| `?map=1049` 启动 | 后端 `js`、1843×1020 terrain、玩家开炮 1 发落地 |
| 页面错误 | 0 |

`npm test` 当时升至 **58/58**（当前 61/61）：新增玛雅废墟 1049 的 9000 tick 真实对局嵌入模拟（Go 金标准与
JS 移植各一套），逐 tick 断言角色不嵌入/不悬空；另有 3 个异步 AI 搜索用例（Worker 计划与
同步计划一致、重开后丢弃过期结果、超时回退可打）。`npm run check` PASS。

关于玛雅废墟的选取：原版字面「Maya hoang tán」的 112 只有 icon/show 图，缺 fore.png /
fore.map，无法满足逐像素一致规则；改用资源完整的石柱古城遗迹 1049（原版「Thành Cổ
(nhỏ)」），沿用同一重采样/碰撞生成管线，选图面板显示为「玛雅废墟」。

## 12. 战斗场景性能：搜索移入 Web Worker（2026-11-27）

战斗场景里两处重计算原先都在主线程同步跑：电脑回合的角度搜索（14 s 预算、粗+细两轮，
单次约 120–130 ms@6× 限速）和玩家角度推荐（2% 力度扫描 + 回退验证，约 12 ms@1× /
75–82 ms@6×）。现在两者都在 `dist/js/search-worker.js` 里跑：

- 主线程仍是唯一权威：`standalone-api.js` 每 40 ms `flush()` 时把新增弹坑以
  `{reset, list}` 差分发给 Worker，Worker 用同一份 `.fore.map` 和烘焙弹坑掩码重放，
  掩码与主线程逐字节一致（`window.__GUNNY_SEARCH__.hash()` 对比 FNV-1a，测试场景
  scatter 后一致）。
- Worker 只跑无随机数的 `solveShotForWeapon` / `solveForceForAngle`；电脑的三角瞄准
  误差仍在主线程用 `Match.rng` 施加，随机流与 Go 金标准不变（`npm run test:engine`
  45/45，含完整 AI 回合对拍）。
- 结果有效性：`Match.aiToken` 丢弃过期搜索结果；推荐以 `recommendationKey()`
  （角度/风/双方坐标/弹坑数/技能/武器/POW）为键，飞行中的旧结果不落缓存，
  HUD 显示「推荐计算中…」，Worker 失败或走 Go 后端时自动回到同步计算。
- 地形同步只在弹坑列表增长时发增量；重开或换图（列表变短）自动发 `reset` 全量重放。

`tests/browser_perf.cjs` 新增 `--search=sync` 开关，同一构建 A/B（关闭 Worker 即回到
改动前路径）。测量方式：本机 headless Chromium（844×390、DPR 1）自起静态服务，
`Emulation.setCPUThrottlingRate` 6× 模拟低端机；数值不是真机实测。

同一构建在 `6a7d302`（v28）上重测的 A/B（`tests/screenshots/perf-6x.json` /
`perf-6x-sync.json`）：

| 场景 | 指标 | 同步（改动前） | Worker（改动后） |
| --- | --- | --- | --- |
| 推荐计算（UI 路径） | 主线程阻塞 | 75.3–79.9 ms@6× | 0–0.1 ms（往返 17.4–18.2 ms） |
| 电脑回合 | long task | 1 次 138 ms@6×（t≈4.86 s） | 无 |
| 电脑回合 | 最慢帧 | 133.5 ms@6× | 24.9 ms@6× |
| 电脑回合 | P95 | 10.1 ms@6× | 10.1 ms@6× |
| 连按角度（2 s） | P95 / 最慢帧 | 10.0 / 50.6 ms@6× | 10.2 / 49.2 ms@6× |
| 散射弹坑 | P95 / long task | 10.0 ms / 无 | 10.2 ms / 无 |

同场景的主线程同步求解耗时（`engine.aiSearchMs`）为 106–114 ms@6×（同步模式）与
139–146 ms@6×（Worker 模式测量的是线程内直接调用，不代表 UI 阻塞）。Worker 与主线程
弹坑掩码 FNV-1a 哈希相同（scatter 后 2 个弹坑，`match: true`）。

角度拖拽开场约 344–350 ms 处有一次 54–59 ms@6×（≈9 ms@1×）的一次性长任务，改动前后
相同，属首帧预热，未在本轮处理。全部浏览器回归（static / visual / controls+mobile /
maps）、`npm test`（61/61）、`npm run test:map`（1156 / 1049 均 0 失配）与
`go test ./...` 均通过。
