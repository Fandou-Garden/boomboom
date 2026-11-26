# 验证记录

验证日期：2026-11-26。环境：本机 Chromium（headless，启用 GPU）+ Node 22，本地
`http://127.0.0.1:8000/?test=1`。这是浏览器设备仿真，不等同于真实 iPhone/Android
硬件；触摸手感、真实 Home Indicator 和低端机性能仍建议在目标手机复测。

## 1. 自动化结果

```text
npm run check
CHECK PASS

npm test
Go: gunny/server/game ok
Node: 13 tests / 13 pass / 0 fail

npm run test:browser:visual
BROWSER ACCEPTANCE PASS

npm run test:browser:controls
CONTROLS + AUDIO ACCEPTANCE PASS

npm run test:browser:static
STATIC WASM ACCEPTANCE PASS
```

`tests/browser_acceptance.cjs` 使用真实 Pointer Events、游戏循环和 Web Audio，不绕过
战斗规则。结果写入 `tests/screenshots/acceptance.json`。

## 2. 双视口验收

| 视口 | 初始 zoom | 蓄力截图 | 飞行截图 | 结果 |
| --- | --- | --- | --- | --- |
| 844×390 | 0.4494 | `charge-844x390.png` | `flight-844x390.png` | PASS |
| 667×375 | 0.3541 | `charge-667x375.png` | `flight-667x375.png` | PASS |

两个视口均完整跑过“瞄准 → 蓄力 → 发射 → 飞行 → 落地 → 电脑回合”：

- 初始和落地后，双方角色完整在屏，且不与顶部 HUD、小地图、转盘、力度尺、技能栏、
  POW/蓝色主键相交。
- 蓄力截图同时显示双方、左下四向转盘、当前力度百分比、推荐/上一发数字。
- 飞行截图镜头在天空跟弹，双方允许离屏；HUD 容器矩形在蓄力和飞行之间偏差 < 0.51 px。
- 飞行中主键禁用，额外点击不会增加炮弹数；相机缩放单向过渡，不来回振荡。
- 落地后相机回到 `both`，双方重新完整入镜，缩放回到接近瞄准值。
- 667×375 下右侧技能列不会压住对手；最窄视口仍保留 74 px 蓝色主键。

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
| 散弹 | 5 枚全部 `resolved && !alive` 后回合才从 0 变 1，电脑此前 0 发 |
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

- 待机：玩家和电脑都必须是 `STAND` 帧（`0/6/7/8/9/10`），且 `weaponVisible=false`；
- 按住蓄力：必须是 `SHOWGUN` 帧（`19/20/21`），且 `weaponVisible=true`；
- 开炮后：必须是 `SHOT` 帧（`22/23/26/27`），且 `weaponVisible=true`。

帧序来自 `GameCharacter.as`；武器显隐与 `body → weaponMovie` 层级来自 `GamePlayer.as`。
开炮动画固定 0.28 s，一次齐射（附加攻击/散弹）只触发一轮，不按炮弹数重复抬手。

流畅度方面：服务器快照 25 Hz，前端用本地 `visualTime` 驱动动画，角色位置按
`tau=22 ms` 指数平滑，炮弹用 `x+v·t+½a·t²` 外推（上限 60 ms）。本机 headless Chromium
启用 GPU 时实测约 120 fps；触摸设备/小窗口将画布 backing store 限制在 1.5× DPR。

## 6. 静态站点（WASM）

`npm run test:browser:static` 在 Node 里起一个不带 `/api` 的静态 HTTP 服务，只提供
`dist/`，然后走真实浏览器：

| 项目 | 结果 |
| --- | --- |
| 后端探测 | `__GUNNY_BACKEND__='wasm'` |
| 引擎 | `GunnyWasm` 初始化成功，地图 2000×1425 |
| 待机帧 | `STAND frame 0`，`weaponVisible=false` |
| 帧率 | 121 fps（844×390，headless Chromium） |
| 玩家开炮 | 1 发，落地生成 1 个弹坑，`removed>0` |
| 电脑回合 | `enemyShots=1`，再生成 1 个弹坑（共 2 个） |
| 重开 | `playerShots=0`，弹坑归零 |
| 页面错误 | 0（只忽略探测 `/api/state` 的 404） |

WASM 包 3.6 MB，地图 349 KB；`dist/wasm/gunny.wasm`、`dist/wasm/wasm_exec.js`、
`dist/data/1001.fore.map` 和 `dist/offline-api.js` 必须一起部署。

## 7. 保留项

- 世界为 **2000×1425**，玩家 x=300、电脑 x=1700，初始水平距离 1400 px（70.0 m）。
- 角色图集换成原版完整套装 `m/suits/suits571` 与 `f/suits/suits45`；地形、炮弹、弹坑
  素材未换，没有移动出生点来强行同屏。
- 单机回合、风力、连续碰撞、分块 Alpha Mask 地形破坏和确定性弹坑规则未改。
- 没有商城、房间、登录、联机或网络同步。

## 8. 已知未覆盖

- 真实 iPhone Safari 的元素全屏限制只能按降级逻辑模拟；无法在沙箱验证真实
  Home Indicator、地址栏动画和触摸延迟。
- 设备性能只在 headless Chromium 中观察；低端 Android 的 Canvas/内存表现需真机复测。
- 本版仍只有 map/1001，没有地图选择/切换 UI。
- 角色贴图来自原版完整套装图集，待机/移动/举枪/开炮/受击帧序已按
  `GameCharacter.as` 对齐，但不是完整 SWF 时间线（攀爬、跳跃等动作未使用）。

## 9. 公网发布

- 稳定地址：`https://slnp165x30zq.reakh.fun/`，`site_id=slnp165x30zq`。
- 本轮发布为 **版本 6**，静态资源查询版本 `?v=14`，状态 `PUBLISHED`。
- 公网 `index.html` 已确认引用 `styles.css?v=14` 与 `js/main.js?v=14`；
  `wasm/gunny.wasm?v=14` 返回 HTTP 200。
- 公网 844×390 冒烟：后端 `wasm`、双方 x=300/1700、待机帧 0/8、120 fps、
  玩家 1 发落地生成 1 个弹坑、console/page error 为 0。
- 公网资源首次加载约 3.6 MB WASM + 349 KB 地图；浏览器随后使用版本化缓存。
