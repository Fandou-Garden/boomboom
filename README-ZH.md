# 风场弹道 · Gunny Wind Arena

基于 [phucdz2kk4/Gunny](https://github.com/phucdz2kk4/Gunny) 提交
`057c71aab877b42ebf08258aa5c642adc6a039ec` 的可直接游玩 HTML5 单机弹道对战。
玩家与电脑轮流行动：按住移动、调整角度、蓄力开炮；每回合按原版
`BaseGame.GetNextWind()` 更新风力，命中会扣血、局部挖空地形，一方归零后结算并可重开。

线上试玩：**https://slnp165x30zq.reakh.fun/**（测试钩子：`?test=1`）

当前版本把权威战斗逻辑整体迁到 **Go 服务端**（`server/`），前端只保留 Canvas 渲染、
输入、音效和非权威的瞄准推荐。同一份 Go 战斗逻辑也能编译成 **WebAssembly**，在没有
`/api` 后端的纯静态站点里直接运行（见「纯静态部署」）。世界恢复为原版 **2000×1425**
单幅地图，出生点
`300 / 1700`，初始水平距离 1400 px（HUD 显示 70 m）。瞄准时双方同屏，炮弹飞行时
镜头跟弹而 HUD 固定；瞄准只显示角色旁的短方向提示，不画完整抛物线。没有加入商城、
房间、登录或联机。

## 运行

### 一键启动（推荐）

本机已安装 `ddt`，在**任意目录**打开终端输入：

```bash
ddt
```

它会自动编译 Go 服务端、在后台启动、打开
**http://127.0.0.1:8000/**；如果服务已在运行则直接打开浏览器。

```bash
ddt status    # 查看 PID / 端口 / 地址
ddt logs      # 跟看服务端日志
ddt restart   # 改完代码后重启（会重新编译）
ddt stop      # 停止由 ddt 启动的服务
ddt debug     # 以调试模式启动（浏览器测试用）
ddt open      # 只打开浏览器
```

`ddt` 实际是仓库里的 [`bin/ddt`](bin/ddt)，通过
`~/.local/bin/ddt` 软链接到 PATH。换机器或移动目录后重新安装：

```bash
ln -sf "$PWD/bin/ddt" "$HOME/.local/bin/ddt"
```

### 手动启动

```bash
cd gunny-wind-arena
npm start                 # sh server/run.sh，默认 http://127.0.0.1:8000/
GUNNY_DEBUG=1 npm start   # 开放 ?test=1 所需的调试命令
```

需要 **Go 1.21+**（服务端/WASM）和 Node 18+（仅测试/开发脚本）。Go 进程同时提供
`dist/` 静态文件、`GET /api/state`、`GET /api/events`（SSE）和
`POST /api/command`。

> 不要直接双击 `dist/index.html`：页面使用 ES Module 和 EventSource，`file://`
> 无法连接服务端。`server/run.sh` 会自动寻找 `go`，找不到时可用
> `GO_BIN=/path/to/go npm start` 指定。

### 纯静态部署（公网）

```bash
npm run build:static
# 产物：gunny-static.zip，index.html 在压缩包根目录
```

`dist/index.html` 启动时先探测 `/api/state`：

- 返回 JSON：走本地/线上 **Go 服务端**，SSE 同步状态；
- 返回 404/HTML：自动加载 `wasm/wasm_exec.js` 与 `wasm/gunny.wasm`，由
  **浏览器内 Go 引擎**接管 `/api/events` 与 `/api/command`，不需要任何后端。

静态引擎使用同一份 `server/game` 代码、同一张 `reference/map/1001/fore.map` 和同一组
原版弹坑 PNG；`dist/data/1001.fore.map` 与 `dist/wasm/gunny.wasm` 必须一起部署。
首次加载约 3.6 MB WASM + 349 KB 地图，之后由浏览器缓存。公网站点
**https://slnp165x30zq.reakh.fun/** 使用这条路径。

**首屏加载优化（v23）**：发布主机（openresty）忽略 `Accept-Encoding`、不做任何
压缩传输，因此大资源全部预压缩、由前端解压：

| 资源 | 之前 | 现在 | 手段 |
| --- | --- | --- | --- |
| `wasm/gunny.wasm` | 3.36 MB | **0.92 MB** | `gzip -9` → `gunny.wasm.gz`，浏览器用 `DecompressionStream('gzip')` 解压后实例化 |
| `data/<id>.fore.map` | 232 KB/张 | **约 10 KB** | 同上走 `.gz`（`loadBytesGz`，无 DecompressionStream 时回退原始文件） |
| `assets/map-<id>-fore.png` | 231 KB–1.7 MB | **约 74%** | 无损 WebP（`exact=True`，与原 PNG **逐像素一致**，`verify_map_parity.py` 仍比对 PNG 原图，0 diff） |
| 音效+BGM（约 2 MB） | 与首屏并行抢带宽 | **延后** | `sound.preload()` 从模块顶层移到 boot 完成、加载屏隐藏之后 |

首屏（默认地图 1156）传输量从约 6.7 MB 降到约 2.3 MB，且音频在首帧渲染后才解码。

`npm run test:browser:static` 会在本机起一个没有 `/api` 的静态服务器，验证
WASM 启动、完整回合、AI 行动、弹坑和重开，不需要 Go 服务端。
`npm run test:browser:mobile` 另外用 iPhone UA 模拟 1024×386 浏览器剩余可视区和
390×844 竖屏，检查控件不越界、全屏说明不遮挡 HUD、竖屏只进入只读预览。

> **后续方向**：仓库已规划把 Go/WASM 权威引擎**全量重构为纯 JS**（零 Go 依赖、静态站点直接部署）。
> 完整路线、接口契约冻结、Go→JS 模块映射、确定性/PRNG 风险与分阶段验收清单见
> [`docs/PURE_JS_REFACTOR_PLAN.md`](docs/PURE_JS_REFACTOR_PLAN.md)。该文档仅为规划，未改动任何运行时代码。

### 操作

| 操作 | 手机 | 电脑 |
| --- | --- | --- |
| 持续移动 | 按住左下四向转盘 `左` / `右` | 按住 `A`/`D` 或 `←`/`→` |
| 调整角度 | 按住转盘 `上` / `下`，中心显示当前角度 | 按住 `W`/`S` 或 `↑`/`↓` |
| 蓄力 / 发射 | 按住右下蓝色主键蓄力，松手开炮 | 按住 `空格` 或鼠标按住主键 |
| 小地图拖动 | 在左上小地图内拖动，只移动镜头 | 鼠标拖动小地图 |
| 回到战场 | 点小地图旁 `回到战场` | 同按钮 |
| 主武器 | 开局从烈火 / 轰天 / 水果篮 / 黑白家电 / 风神中选一把 | 弹窗选择，或点顶部武器按钮；第一发后锁定 |
| 战斗道具 | 右侧 1–8 格：1 攻击+2 / 2 三向散射 / 3 攻击+1 / 4–8 伤害增幅 50/40/30/20/10% | 点击按钮或按 `1`–`8` |
| 治疗 | 顶部心形按钮，消耗本回合 | 点击或按 `H` |
| 大招 | 独立 `POW` 键；满能量才亮，选中后用蓝色主键发射 | 同按钮或按 `R`；R 只选中，不自动开炮 |
| 全屏 / 音效 / 说明 / 重开 | 右上角悬浮图标（iPhone 全屏键显示安装说明） | 右上角悬浮图标 |

各武器角度范围不同：风神 15°–50°、烈火/水果篮 20°–50°、黑白家电 50°–70°、轰天 55°–70°；力度均为 `0–2000`。
按住后按原版 `EnergyView` 的 `SHOOT_FORCE_STEP=20 / 30fps` 线性增加（600 力度/秒），
到顶保持 2000，不会回弹；松手时服务端按自己的时钟取力，小于 20 或按住不足 80 ms
会提示蓄力不足。倒计时默认关闭，只有手动开启后才显示，单机练习不会催出手。
飞行中不能移动或再次开火。
`pointercancel`、窗口失焦、切后台、旋转提示出现都会取消当前蓄力，不会误发射。
手机端使用 Pointer Events 与 `touch-action: none`；底部按钮整体避开 Home Indicator
和右下平台浮层。最窄横屏先压缩装饰和文字，蓝色主键仍保留 74 px 触控直径。
iPhone Safari 和常见嵌入浏览器不能由网页隐藏地址栏；右上角全屏键在 iPhone 上改为
可关闭的顶部说明，不再弹红色错误遮住角度盘。按“分享 → 添加到主屏幕”后从主屏幕图标
打开，可获得无地址栏画面。竖屏会出现旋转门；“先看看战场”只进入禁用操控的预览，
并保留“竖屏仅预览”提示，不把横屏 HUD 伪装成可玩竖屏。

## 一、大地图与相机

### 1.1 世界尺寸

- 世界（world）为 **2000 × 1425 px**，就是原版 map/1001 的单幅尺寸；不再是 v5 的
  4000 px 镜像竞技场。
- 玩家出生在 `x=300`，电脑出生在 `x=1700`，初始水平距离 1400 px（HUD 显示 70 m）。
- 手机或桌面窗口只是世界的一个视口；移动端常见视口只能看到约 1000–1300 世界像素宽，
  因而玩家有真实的移动、瞄准和炮弹飞行空间。
- 世界坐标、相机坐标、屏幕坐标严格分开：

```text
world:  worldX, worldY, velocityX, velocityY
camera: cameraX, cameraY, viewportWidth, viewportHeight, zoom
screen: screenX = worldX - cameraX
        screenY = worldY - cameraY
```

实际绘制使用 `screen = (world - camera) * zoom + viewport / 2`；`camera.js#computeView`
负责夹紧和投影，`renderer.js` 只画相机附近的背景、地形 chunk 和世界对象。
HUD、血条、风力、回合、距离、移动/调角/发射按钮全部是 Canvas 之外的 DOM，
坐标与相机无关，所以炮弹飞行时 HUD 不会跟着移动。

### 1.2 瞄准与飞行镜头

| 状态 | 行为 |
| --- | --- |
| 瞄准 / 结算 / 电脑回合（`both`） | 用同一个等比 `zoom` 把双方角色与脚下地形装进视口，角色位于画面中下部，上方留出抛射空间；不移动出生点、不做 X/Y 非等比压缩 |
| 炮弹飞行（`shot`） | 跟随炮弹并允许镜头进入天空；飞行开始时锁定缩放，不在飞行中反复缩放 |
| 落地 | 平滑回 `both`，重新把双方装回画面；位置平滑 `0.36 s`，缩放平滑 `0.32 s` |

- `main.js#effectiveCameraMode()` 只在 `phase === 'flight'` 时使用 `shot`，其余时间一律
  `both`。因此不存在“我方近景、对手只剩屏外箭头”的默认构图。
- 双方取景会按视口宽高计算 `fitZoom`，最小可到 `VIEW.minZoomWide = 0.11`；仍使用单一
  `zoom`，不会把地图横向压扁。窄屏再给右侧技能栏留 20 px 构图偏移，避免对手被按钮压住。
- `computeView()` 正常情况下把相机中心夹在地图内；`shot` 模式允许天空 overscan，
  但左右仍不越界。炮弹飞出画面只是跟弹视角的正常结果，双方角色允许暂时离屏。
- 小地图拖动通过 `camera.panBy()` 只改变 `manualX/manualY`；飞行开始会清除手动偏移，
  `回到战场` 清空偏移并重新取景。世界坐标、角色位置和落点记录都不受影响。
- 屏外方向箭头只作为远距离兜底，不再承担“看见对手”的主要职责；飞行/结算阶段不画。
- HUD 全部是 Canvas 之外的 DOM，相机移动、缩放或跟弹时按钮矩形保持不变。

### 1.3 世界层 / 屏幕层

| 层 | 内容 | 坐标 |
| --- | --- | --- |
| 世界层 | 背景、前景地形、dead 层、角色、炮弹、爆炸、碎片、风力线、角色头顶名字/血条 | world + camera 投影 |
| 屏幕层 | 左上小地图/回战场、顶部双方头像/血条/风力、回合提示、左下四向转盘、底部力度尺与血量/体力/能量、右侧技能列、POW/蓝色主键、设置/全屏/重开、竖屏提示、结算 | 固定屏幕坐标 |

角色的屏幕标签虽然是 Canvas 绘制，但每帧由 `projectPoint()` 投影并夹紧到屏幕安全区，
不参与 DOM 布局；DOM HUD 完全固定。

### 1.4 角色动画与插值

角色帧序取自原版 `GameCharacter.as` 的常量，不是按“行走/站立/开炮”猜的；仅待机跳过
6/7 两个会导致循环头部抽动的仰头反应帧：

| 动作 | 原版帧序列（3×13 sheet 索引） | 触发 |
| --- | --- | --- |
| `STAND` | `0, 8, 9, 10` | 自己/敌方待机（移除 6/7 的仰头反应帧） |
| `WALK` | `1, 2, 3, 4, 5` | 左右移动 |
| `SHOWGUN` | `19, 20, 21` | 按住蓄力、轮到该角色 |
| `SHOT` | `22, 23, 26, 27` | 开炮后的 0.28 s |
| `HIT` | `12, 24, 25, 38, 11` | 被炮弹命中 |

武器贴图只在 `SHOWGUN`/`SHOT` 时绘制；待机和行走时隐藏，背上的武器由人物帧本身表现。
这与原版 `GamePlayer.as` 先 `addChild(body)`、再 `addChild(weaponMovie)` 的层级一致。

服务器快照是 25 Hz，而屏幕通常 60/120 Hz，所以前端不直接照搬快照坐标：

- `visualTime` 在本地按真实帧间隔累加，动画不随网络抖动跳帧；
- 角色位置用 `tau = 22 ms` 的指数平滑追服务器坐标；
- 炮弹用 `x + v·t + ½a·t²` 做 dead-reckoning，最多外推 60 ms；
- 一次开火（含多发战斗道具的多发）只播一轮 `SHOWGUN → SHOT`，`FireTimer = 0.28 s`；
- 触摸设备/小窗口把画布 backing store 限制在 1.5× DPR，减少填充率开销。

## 二、地图素材与拼接方式

### 2.1 原始素材

使用仓库 **map/1001（Cầu vồng / 彩虹海湾）**：

| 站点文件 | 原仓库路径 | 原始尺寸 | 用途 |
| --- | --- | --- | --- |
| `dist/assets/map-1001-fore.png` | `Tank.Flash/resource/v1.1/image/map/1001/fore.png` | 2000×1425 | 前景地形、显示、Alpha 碰撞、可破坏层 |
| `dist/assets/map-1001-back.jpg` | `Tank.Flash/resource/v1.1/image/map/1001/back.jpg` | 1526×1425 | 背景，按原始尺寸平铺/镜像，不拉伸 |
| `reference/map/1001/fore.map` | `Fighting.Service/bin/Debug/net48/map/1001/fore.map` | 2000×1425 位图 | 服务端碰撞对照，仅验证用 |

map/1001 在本次 checkout 中没有 `dead.png`，所以本版没有 dead 装饰层；不会拿其他地图的
dead 图层硬拼，以免风格混杂。曾评估 map/1014（2106×1500，自带 dead），其镜像接缝在
中景过于明显，最终没有采用。

### 2.2 单幅原版地图（SOURCE）

- 世界 `x=0..1999` 直接使用 map/1001 前景原图，不做镜像第二份。
- 背景 `back.jpg` 原始宽度 1526，按原尺寸平铺/镜像补齐到 2000 px；这是背景绘制，
  不是碰撞地形的复制。
- 前景与碰撞都不缩放、不拉伸；服务端 `terrain.go` 与前端 `terrain.js` 读取同一张
  2000×1425 位图。
- v5 的 4000 px 镜像世界已移除，因为它会让右侧角色站在服务端不存在的镜像地形上。

### 2.3 地形碰撞转换（SOURCE + PORT）

- 原版 `Game.Logic/Phy/Maps/Tile.cs` 以 PNG `alpha > 100` 为实心，
  服务端 `.map` 是 `[int32 width][int32 height][每行 ceil(width/8) 字节]`、MSB-first。
- 本作在加载时把每个 256×256 chunk 的 PNG alpha 转成 `Uint8Array mask`；
  `isSolid()` 只查该像素所属 chunk，不扫描整图。
- map/1001 的 `fore.png` 与服务端 `fore.map` 已全图逐像素比较：
  **2000×1425、615,968 个实心像素、0 个不一致**。
- 浏览器完整校验 2000×1425 = 2,850,000 像素，显示 alpha 与 collision mask
  **0 个不一致**（`terrainDisplaySync()`，只在测试中执行）。
- 每个地图加载时生成：`terrainChunks`、每 chunk `mask`、`surfaceY[]`（每列地表）、
  `dirtyChunks`；没有每帧全图扫描。

## 三、真实地形破坏

### 3.1 数据结构

- 本作按 256×256 分块：2000×1425 → **8×6 = 48 chunks**。
- 每 chunk 拥有：
  - 可见 Canvas（前景 alpha，实际绘制）；
  - 同尺寸 `Uint8Array` collision mask（浏览器显示镜像）；
  - 可选 `holeCanvas`（仅旧版程序化弹坑使用；v6 默认不写深色背衬）；
  - chunk 的 world 原点 `x/y`、尺寸 `w/h`。
- 权威碰撞在 Go 服务器的 `Terrain.Mask`；浏览器 mask 只用于本地推荐和显示同步。
- 地形显示层与 mask 使用 **完全相同的世界坐标和 chunk 原点**，没有额外偏移。

### 3.2 爆炸如何修改 terrainMask

1. 炮弹在 Go 服务端按 0.04 s Euler + 3 px 子步 CCD 得到命中点 `(cx, cy)`。
2. `Terrain.Carve()` 取原版 crater 位图（普通 `401`，POW `4`），以命中点为位图中心，
   只删除“当前实心且位图 alpha > 100”的像素；没有程序化 lobes。
3. 服务端返回 `impact.removed` 和 `craters` 列表；前端收到后调用
   `Terrain#carveSource()` 用同一张位图的二值 mask 重放，移除像素数必须一致。
4. 前端只在受影响的 chunk 内 `getImageData()` 读回 alpha，以 `alpha > 100` 更新 mask；
   同时更新这些 chunk 的 `surfaceY` 和 `dirtyChunks`。
5. 重绘时只画视口内的 chunk；不在每帧调用 `getImageData`，不重建整张地图。

弹坑形状完全由原版位图决定；v5 的 `explosionSeed/mulberry32` lobes 仅保留在
`explosion.js` 供视觉粒子使用，不再参与地形 mask。
命中速度还会把核心沿飞行方向偏移。`destination-out` 只删除已有地形像素，所以：

- 空中爆炸 `removed = 0`，不登记 crater，也不会留下悬空黑圆；
- 爆炸只擦除实际与地形重叠的部分，不会凭空生成完整圆坑；
- 被挖空的像素在 mask 里变为 0，后续炮弹的 CCD 会直接穿过。

### 3.3 模板与可复现性

| 等级 | 半径（网页调参） | 原始弹坑图 | 形状 |
| --- | --- | --- | --- |
| small | 30 px | `crater-50.png` / `craterbrink-50.png` | 3 lobes，浅 |
| medium | 58 px | `crater-401.png` / `craterbrink-401.png` | 5 lobes，标准 |
| large | 92 px | `crater-4.png` / `craterbrink-4.png` | 6 lobes，深 |
| special | 84 px | `crater-4.png` | 7 lobes，按武器配置 |

`BallList.xml` ID=243 指向 `Crater=241`，但该素材目录在仓库中缺失；因此使用仓库中
真实存在的 50/401/4 作为替代，并在 `config.js` 标为 `TEMP`。同一炮弹参数和同一命中点
生成完全相同的 `circles/seed`；测试 `tests/physics.test.mjs` 验证可复现，浏览器验收
再次用相同参数挖两次并比较形状。没有每帧随机，所以地形不会闪烁。

### 3.4 碰撞与连续检测

- `physics.js#stepProjectileWithCollision()`：先按原版 `0.04 s` Euler 步进，再把
  `prev → current` 线段按 **2 px** 采样；每个采样点检查弹体中心 + 8 个圆周探针，
  不是只检查一个像素。
- 因此高速炮弹不会从两帧之间穿过薄地形；测试用 3 px 薄墙验证不会 tunnelling。
- 原版 `BombObject.MoveTo()` 使用约 3 px 子步和 6×6 矩形；网页版用 2 px 采样 + 8 探针，
  更保守（PORT），落点可能有亚像素差异。
- 命中后只更新局部 chunk 的 mask；后续炮弹读取同一个 mask，能穿过已挖空区域。
- 角色移动只查询当前位置附近的 `findGroundY()`/`surfaceAt()`；每次爆炸后对角色重新
  `_refreshActorSupport()`。地面消失时进入重力下落，落到新地表停止，掉出世界才判坠落。
- 碎裂后不会重建整张地图，也不会重新加载地图图片。

### 3.5 边缘/碎片效果

- 地形只做原版位图挖除；不再绘制程序化边缘焦痕或深色坑内背衬。
- Canvas 绘制少量泥土/石块、烟雾、闪光、伤害数字和落点标记；移动端粒子更少。
  `lowPower` 视口进一步减少碎片/烟雾。
- 这些粒子是 **网页版表现层新增**，不改变服务端碰撞或伤害。

## 四、战斗规则与网页新增

- 玩家与电脑 HP 都是 2000（**NEW** 网页平衡值；原版玩家行在 SQL 备份中不可读）。
- 权威回合、移动、蓄力、弹道、伤害、挖洞、AI 和坠落在 `server/game/`；前端
  `net-client.js` 只发送意图并渲染快照，不再本地推进 `Match`。
- 每回合可用一次自我治疗，恢复 1000，不能超过上限，治疗消耗该回合；电脑不治疗。
  这是网页新增规则，不是原版技能。
- 开局从五种经典主武器中选一把：烈火、轰天、水果篮、黑白家电、风神；各自使用原版
  炮塔贴图、BallID、飞行粒子、角度范围与弹坑图。对应关系以 `BombConfig.xml` 的
  `Common` 为准：烈火 `bombpack` / Ball 161（20°–50°）、轰天 `bomb` / Ball 101
  （55°–70°）、水果篮 `fruit` / Ball 401（20°–50°）、黑白家电 `television` /
  Ball 321（50°–70°）、风神 `dart` / Ball 121（15°–50°）。第一发出手后本局锁定，
  重开可再选。
- 右侧 1–8 战斗道具对应原版 `10001–10008`：1 为攻击 +2（同轨迹连续 3 发，每发伤害
  60%）、2 为三向散射（0°、-5°、+5° 同时各一发，每发伤害 50%）、3 为攻击 +1（同轨迹连续 2 发，
  每发伤害 90%）；4–8 为伤害增幅 50/40/30/20/10%，可叠加并在开火时消耗。
  治疗改为顶部心形按钮与 `H` 键。
- `POW` 是独立按键，只负责选中，不会发射；能量满才解锁，选中后仍由蓝色主键蓄力发射。
- **大招（SOURCE 复刻）**：照抄 `bombconfig.xml` 的 `Common/Special` 与 `BallList.xml`
  各弹行的 `Power/Radii/Crater/Amount`。POW 使用各武器的 **Special 大招弹**——
  三连发：雷霆 151（每发 60%）、烈火 171（每发 60%，半径 45）、水果篮 411（每发 50%，
  原版榴莲弹体与 `crater/411` 榴莲坑）、马桶 371（每发 50%）；单发加伤：石斧/弓箭/AK/
  黄金枪/手术刀/司马砸缸/黑白家电 150%、轰天 130%（半径 65）、风神 131（原版弹坑）。
  弹坑素材缺失的弹按既有映射落到 4/50/401；`crater/121/131/411` 为原版真图。
  旧版全局 POW ×1.8/半径 82 已移除，伤害系数在发射时并入该发弹。
- **开火动作（SOURCE 复刻）**：按 `PrepareShootAction` 的规则，
  `ball.ActionType == 0` 播 `SHOWTHROWS [28,29,30]` 投掷（石斧/风神/烈火/司马砸缸/
  水果篮/手术刀/黑白家电），`== 1` 播 `SHOWGUN [19,20,21]` 举枪（弓箭/AK/黄金枪/
  轰天/雷霆/马桶）；大招弹与普通弹各自取自己的 ActionType。
- **出生点**：固定列 240/1640 在部分地图（如 1157）上方有悬空前景，会出生进墙体。
  现按原版出生语义就地扫描：脚下有连续地面、身体与头顶 110px 净空无碰撞，
  11 张地图全部验证不嵌入。
- 瞄准反馈只在角色旁画 44–58 px 的短虚线/角度扇形，不预测整条抛物线。
- 推荐力度由 `solveForceForAngle()` 按**当前角度、当前技能弹群、POW 与当前风力**
  先以 2% 步长调用真实 `simulateShot`/爆炸伤害复算，整段无命中时回退到 1% 步长；
  优先直击，其次溅射。力度尺用蓝三角显示推荐点、
  蓝带显示连续可命中区间、白线显示上一发实际值，并显示“推荐 96 · 直击 / 上一发 100”。
  当前角度不可达时显示“推荐 —”和“当前角度无可命中力度”，不自动调角、不强给数值、
  不自动发射。推荐值在松手前随时按当前状态复检，不用模拟近似代替真实碰撞。
- 玩家出手后，上一发站位与实际落点以世界坐标记录并投影到地形上；镜头拖动时标记跟随
  地形，不会漂移。电脑炮弹不会覆盖玩家的上一发记录。
- 电脑用同一套物理和地形求解弹道，加入少量瞄准噪声；电脑会沿地形短距离移动。
- 战斗音效按原版调用点移植，开炮与爆炸逐武器取 `BallList.xml` 的
  `ShootSound`/`BombSound`：烈火 025/087、轰天 023/087、水果篮 114/102、
  黑白家电 110/100、风神 029/089；道具/POW `039`、阵亡 `042`、选道具 `008`、
  回合 `016/038`、胜负 `063/064` 均为 `audio.swf` 离线提取 MP3。
  多发战斗道具整轮只播一次开炮声，爆炸逐枚。原版没有独立受击音，网页用合成
  替代并明确标注。完整映射与文件校验见 [`docs/AUDIO_MAPPING.md`](docs/AUDIO_MAPPING.md)。
- 音频在首次点技能、按空格或按发射键时自动尝试解锁，不需要先点空白处；静音、Context
  创建失败或素材加载失败均只降级静音/合成，不阻断蓄力和发射。验收读取实际波形峰值与
  样本 ID，而不只检查静音开关。
- 全屏 API、PWA manifest、横屏锁定和 iPhone 降级说明保留；iPhone Safari 不支持网页
  元素全屏时不会伪造全屏状态，也不会用红色错误覆盖 HUD，而是给出“添加到主屏幕”的
  非阻断说明。

## 五、参数来源

完整对照见 [`docs/SOURCE_MAPPING.md`](docs/SOURCE_MAPPING.md)。

| 参数 | 值 | 来源/状态 |
| --- | --- | --- |
| `PHYSICS.dt` | 0.04 s | **SOURCE** `SimpleBomb.cs` |
| `PHYSICS.forceMax` | 2000 | **SOURCE** `EnergyView.as` / `Player.as` |
| `PHYSICS.mapGravity` | 10 | **SOURCE** map/1001 `LoadMapsItems.xml` `Weight=10` |
| `PHYSICS.mapDragIndex` | 2 | **SOURCE** map/1001 `DragIndex=2` |
| `PHYSICS.mass` | 10 | **SOURCE** `BallList.xml` ID=243 `Mass=10` |
| `PHYSICS.gravityFactor` | 70 | **SOURCE** `BallList.xml` ID=243 `Weight=70` |
| `PHYSICS.windFactor` | 240 | **SOURCE** `BallList.xml` ID=243 `Wind=240` |
| `PHYSICS.airResistFactor` | 1 | **SOURCE** `BallList.xml` ID=243 `DragIndex=1` |
| `COMBAT.blastRadius` | 55 | **SOURCE** `BallList.xml` ID=243 `Radii=55` |
| 角度范围 | 风神 15°–50°、烈火/水果篮 20°–50°、黑白家电 50°–70°、轰天 55°–70° | **SOURCE** 五件原版炮塔模板 `Property5/6` |
| 玩家 `baseDamage/attack/baseGuard/defence` | 360/100/80/40 | **TEMP** 数据库缺明文行；公式结构来自 `SimpleBomb.cs` |
| 弹坑半径/等级 | 30/58/92/84 | **TEMP + NEW**：原 `Crater=241` 缺失，使用 50/401/4 原始图代替 |
| `CONTROLS.moveSpeed` | 90 px/s | **SOURCE** `Player.MOVE_SPEED=2` + `GameLiving.stepX=3` @30fps |
| 相机缩放/平滑/模式 | `VIEW.*` | **NEW** 网页相机 |
| `BATTLE` 的 HP/治疗/力度标记 | 见 `config.js` | **NEW** 网页规则，不是原版功能 |
| 角色重力/坠落伤害/碎片上限 | 见 `COMBAT/TERRAIN` | **NEW** 网页可玩性 |
| 地图尺寸 | 2000×1425 | **SOURCE** map/1001 `ForegroundWidth/Height` |

## 六、素材映射（摘要）

| 站点文件 | 原仓库路径 | 说明 |
| --- | --- | --- |
| `map-1001-fore.png` | `Tank.Flash/resource/v1.1/image/map/1001/fore.png` | 前景/碰撞/挖洞 |
| `map-1001-back.jpg` | `.../map/1001/back.jpg` | 背景，原尺寸平铺 |
| `crater-50.png` 等 | `Tank.Flash/resource/v1.1/image/bomb/crater/50` 等 | 原始弹坑/边缘图 |
| `weapon-bazooka3.png` | `.../image/arm/bazooka3/00.png` | 火箭筒 |
| `shell-bomb.png` | `.../image/arm/bomb/00.png` | 飞行炮弹 |
| `character-player-sheet.png` | `.../image/equip/m/suits/suits571/1/game.png` | 原版完整套装 3×13 图集（114×95/格）；帧序按 `GameCharacter.as` |
| `character-enemy-sheet.png` | `.../image/equip/f/suits/suits45/1/game.png` | 原版完整套装 3×13 图集；女性角色 |
| `portrait-player.png` / `portrait-enemy.png` | 网页从人物 sheet 裁切 | 128×128 驾驶舱头像 |

角色 sheet 直接使用原版完整套装图集，不再由装备图层现场合成；站立/行走/举枪/开炮/
受击的帧序来自 `GameCharacter.as`，其中待机去掉 6/7 两个仰头反应帧以避免循环时头部抽动。
武器显隐与层级来自 `GamePlayer.as`。它不是逐帧导出的完整 SWF 时间线，没有复刻攀爬、
跳跃等本版未使用的动作。地图、武器、炮弹和弹坑是原始素材；相机、分块破坏和粒子为网页实现。

## 七、目录

```text
gunny-wind-arena/
├── dist/                       # 可部署前端（站点根目录）
│   ├── index.html
│   ├── styles.css
│   ├── manifest.webmanifest
│   ├── js/
│   │   ├── config.js           # SOURCE / TEMP / NEW 参数
│   │   ├── physics.js          # Euler、风、弹道、CCD、伤害
│   │   ├── explosion.js        # FNV-1a + mulberry32 确定性爆炸形状
│   │   ├── terrain.js          # 96 chunk、alpha mask、局部破坏
│   │   ├── camera.js           # 玩家/双方/炮弹相机、平滑和夹紧
│   │   ├── renderer.js         # 世界层绘制、视口裁剪、方向提示
│   │   ├── net-client.js       # Go 服务端 SSE/命令客户端
│   │   ├── ai.js               # 非权威瞄准推荐（固定角度扫力度）
│   │   ├── input.js            # Pointer/键盘/取消
│   │   └── main.js             # 启动、HUD、全屏、测试钩子
│   └── assets/                 # map/1001、弹坑、武器、人物 sheet
├── reference/map/1001/fore.map # 服务端权威碰撞位图
├── server/                    # Go 权威战斗服务
│   ├── main.go                 # 静态文件 + JSON/SSE API
│   └── game/                   # config/physics/terrain/match/ai
├── tests/
│   ├── physics.test.mjs
│   ├── browser_acceptance.cjs  # 双视口画面验收
│   ├── browser_controls_audio.cjs
│   ├── browser_mobile.cjs      # 手机横竖屏/全屏说明验收
│   ├── browser_static.cjs      # 无后端 WASM 验收
│   └── verify_map_parity.py
├── docs/SOURCE_MAPPING.md
├── docs/GO_SERVER.md
├── docs/IMMERSIVE_UI.md
├── docs/VALIDATION.md
├── docs/PURE_JS_REFACTOR_PLAN.md # 纯 JS 全量重构规划（仅规划，未实施）
└── package.json
```

## 八、测试

```bash
npm test
# Go: go test ./...（地形、Euler、风、伤害、AI、回合）

npm run check
# 全部 JS node --check + gofmt

python3 tests/verify_map_parity.py
# 2000×1425 · solid 615,968 · mismatches 0 · PASS

# 先启动 GUNNY_DEBUG=1 npm start，再运行浏览器验收
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser
# 也可单独运行手机横竖屏验收（内部自起静态服务器）
npm run test:browser:mobile
```

当前 `tests/browser_acceptance.cjs` 覆盖：

- 844×390 与 667×375 各完整跑一局；初始双方完整入镜且不与 HUD 相交；
- 蓄力截图同时含双方、转盘、当前力度、推荐/上一发数字；飞行截图含跟弹视角，
  小地图/力度尺/转盘/技能栏/POW/主键矩形偏差 < 0.51 px；
- 飞行中主键禁用，点击不会二次发射；相机缩放单向平滑、不来回振荡；
- 落地后双方重新完整入镜，回到 `both`，不留在天空；
- 小地图拖动只改变相机，角色/落点世界坐标不变，标记屏幕位置按投影重算，回战场清零；
- 倒计时默认关闭，开启只显示时间、不自动发射；
- 低角度不可达时显示“推荐 — / 调角”，角度不被自动修改，炮弹数不变；
- POW 只选中不开火，能量满才解锁；
- 三向散射 3 枚全部 `resolved && !alive` 后才把回合交给电脑；
- 开炮/爆炸/命中/大招实际触发非零 Web Audio 波形，并核对样本 ID 023/087/039；
- 真实鼠标点技能后第一次 Space 必定蓄力；数字键只选中不开炮；R 能量不足保留技能、满能量
  只选中；长按数字不重复切换；输入框/帮助弹窗隔离 Space；触摸点技能+长按发射；
- 静音、全部音频文件 404、AudioContext 构造失败三种情况下仍可正常蓄力和发射；
- 连续可命中区间显示蓝带；1–8 固定槽位顺序不变；console/page error 为空；
- 攻击+2 同轨迹连续 3 发、三向散射同时 3 发、攻击+1 同轨迹连续 2 发；五件武器弹体均实际渲染；
- 开局武器弹窗可切换并锁定，治疗 `H` 不发射，增幅在服务端叠加并消耗。

设备矩阵、旧版对比和真实手机限制见 [`docs/VALIDATION.md`](docs/VALIDATION.md)。

## 九、已知边界

- 本版只有一张战斗地图（map/1001 镜像拼接），没有地图选择 UI；`Terrain.dispose()` 已提供
  缓存释放路径，重开会重建 chunk 并清除全部弹坑。没有可切换的第二张地图，因此
  “切换地图”验收项在本版不适用，不能声称已实测。
- 玩家战斗属性没有可读数据库行，`baseDamage` 等为 `TEMP`；不保证与原服具体账号一致。
- `Crater=241` 原始素材缺失，弹坑底层图使用 50/401/4 替代；多层不规则边缘是网页新增。
- 五件主武器的炮塔/炮弹素材、角度与弹坑来自原版资源；1–8 道具、增幅、无限体力、治疗与 POW 是网页新增单机规则；没有宠物技能、队友伤害或联机同步。
- 没有商城、房间、登录、联机；电脑为本地 AI（NEW）。
- 地图/角色/炮弹素材来自仓库；人物 sheet 使用原版完整套装图集。待机/移动/举枪/
  开炮/受击的帧序已按 `GameCharacter.as` 对齐（待机去掉 6/7 仰头帧），但不是完整 SWF 时间线。
- iPhone Safari 及嵌入浏览器无法由网页隐藏地址栏；全屏键会显示“分享 → 添加到主屏幕”
  的非阻断说明，无法把普通网页强行变成全屏 App。竖屏只提供禁用操控的战场预览。
  Android Chrome、桌面浏览器支持度见 [`docs/IMMERSIVE_UI.md`](docs/IMMERSIVE_UI.md)。


## 十、素材与版权

本项目是对原版《Gunny》战斗规则的网页重实现，仅用于学习与研究。原版游戏代码、美术、
音频和地图素材的版权归原权利人所有；仓库公开不构成对原素材的再授权或商业使用许可。
