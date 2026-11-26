# 源码映射与参数来源

固定版本：`phucdz2kk4/Gunny@057c71aab877b42ebf08258aa5c642adc6a039ec`。
本文件区分 **SOURCE（原版）**、**PORT（移植调整）**、**TEMP（缺数据库参数）**、
**NEW（浏览器新增）**，并给出对应源文件。所有可调数值集中在
`dist/js/config.js`。

---

## 1. 从画面到弹道的调用链

### 1.1 客户端：启动、地图、移动、瞄准、蓄力

| 原版调用链 | 行为 | 浏览器对应 |
| --- | --- | --- |
| `GameManager.as` → `GameView.as` → `MapView.as` | 进入战斗、加载地图与 HUD | `main.js` boot → `Terrain.load` → `Renderer`/`Camera` |
| `GameView.as` 创建 `FightControlBar.as` | 战斗底部按钮与状态 | `dist/index.html` 的 `#controls` + `main.js#setupEvents` |
| `SelfPlayerWalkAction.as#execute`：`KeyboardManager.isDown(A/←)` 持续成立时反复 `getNextWalkPoint()` | 按住键持续移动，每步检查地形 | `input.js#getMoveDirection` 持续状态 → Go `match.go#MoveActor` |
| `LocalPlayer.as#gunAngle` 被 `armMinAngle/armMaxAngle` 夹紧（223–233、263–275 行） | 武器角度上下限来自数据库 | `Match#setAngle` 夹紧 `CONTROLS.angleMin/angleMax` |
| `PowerStrip.as` | **体力/能量条**，显示 `self.energy`，不是开炮力度 | 未使用；记录此项是为了纠正容易混淆的调用链 |
| `EnergyView.as`：`FORCE_MAX=2000`、`SHOOT_FORCE_STEP=20`、`calcForce()` 每帧 `_force += dir*20` | 真正的蓄力条 | `CONTROLS.chargeRate=640/s`（约 20/帧@30fps）；HUD 显示 0–2000 与百分比 |
| `EnergyView.as#__enterFrame` 检测空格按住；`sendShootAction(force)` | 按住蓄力、松开发射 | `input.js` 按住 pointer / Space，Go `match.go#StartCharge/ReleaseCharge` |
| `GameLocalPlayer.as#__shootTimer` → `calcBombAngle()` → `GameInSocketOut.sendGameCMDShoot` | 发送 x,y,force,angle | `createProjectile()` 使用相同 force/角度概念 |
| `GameView.as` 监听 `LIVING_CHAGEANGLE`、`ArrowView.as` 显示扇形瞄准 | 角度实时反馈 | `#angle` 数字 + `Renderer#_drawActor` 的武器仰角；预测线已关闭 |

**`FireCommand.cs` 细节**：包内读取 `x,y,force,angle`；`realAngle` 只用于
`aimUsers` 的异常瞄准检测分支，实际普通分支调用的是
`player.Shoot(x, y, force, angle)`，即**原角度**。浏览器版不复制该反作弊分支，
而是把界面上的正仰角与朝向合成为：`vx = direction*force*cos(angle)`、
`vy = -force*sin(angle)`。这与 `Living.ShootImp()` 的三角公式同构，
用 `direction` 表示左右，避免 Flash 客户端 `calcBombAngle()` 的 180° 约定。
（`PORT`）

### 1.2 服务端：开炮与弹道

| 源文件 | 关键代码 | 浏览器实现 |
| --- | --- | --- |
| `Game.Logic/Phy/Object/Player.cs:2416` | `Shoot()` 检查 shootCount，最终 `ShootImp()` | Go `actions.go#Fire` 检查回合、存活、角度/力度后创建炮弹 |
| `Game.Logic/Living.cs:1768` | `ShootImp()` 读取 `BallInfo`，按 `force*cos/sin(angle)` 计算 `num5/num6`，`SetXY` 到炮口，`setSpeedXY`，`StartMoving()` | `physics.js#launchVector/createProjectile`；炮口位置由 `muzzlePoint()` 与渲染共用 |
| `Living.cs:1789-1811` | 多弹循环 `num3=0.9/1.0/1.1`、`num4=-5/0/+5` | 单机版只生成 `num3=1.0, num4=0` 的第一发（`PORT`，明确未实现多弹） |
| `BombObject.cs:38` | 构造参数 `(mass, gravityFactor, windFactor, airResitFactor)` 来自 `BallInfo(Mass, Weight, Wind, DragIndex)` | `config.js#PHYSICS.mass/gravityFactor/windFactor/airResistFactor` |
| `BombObject.cs:59` | `m_vx.ComputeOneEulerStep(mass, m_arf, m_wf, dt)`；`m_vy...(...m_gf...)` | `physics.js#stepProjectile` |
| `BombObject.cs:165-172` | `m_arf = map.airResistance * airResitFactor`；`m_gf = map.gravity * gravityFactor * mass`；`m_wf = map.wind * windFactor` | `physics.js#accelerationFor` 使用完全相同的乘积 |
| `EulerVector.cs` | `x2=(f-af*x1)/m; x1+=x2*dt; x0+=x1*dt` | `physics.js#EulerVector.computeOneEulerStep`，测试逐值验证 |
| `SimpleBomb.cs:558` | `m_lifeTime += 0.04f; CompleteNextMovePoint(0.04f)` | `PHYSICS.dt = 1/25`（SOURCE），`game-core` 以累加器固定步进 |
| `BombObject.cs:93-143` | `MoveTo()` 在起点和终点间按 3 px 子步插值，`m_rect=(-3,-3,6,6)` 检查地图和物理对象 | `physics.js#stepProjectileWithCollision` 每 2 px 采样，检查目标圆与 8 个圆周地形探针 |
| `Map.cs:37-39` | `gravity => mapInfo.Weight`；`airResistance => mapInfo.DragIndex` | **SOURCE** map/1001 行值 `Weight=10`、`DragIndex=2` |

### 1.3 风力与回合

`BaseGame.cs:1476-1501` 的 `GetNextWind()`：

```csharp
int num = (int)(Wind * 10f);
if (num > m_nextWind) {
    num2 = num - m_random.Next(11);
    if (num <= m_nextWind) m_nextWind = m_random.Next(-40, 40);
} else {
    num2 = num + m_random.Next(11);
    if (num >= m_nextWind) m_nextWind = m_random.Next(-40, 40);
}
return (float)num2 / 10f;
```

- `nextWind()` 保留原版 **旧 `num` 比较**（因此多数回合目标不会重置）和
  `Random.Next(11)` 的 0–10 步长，返回值为十分之一单位，范围概念上 `-4.0…4.0`。
- `PVPGame.cs:590-609` 的 `NextTurn()` 在换边时调用
  `UpdateWind(GetNextWind(), sendToClient:false)`；浏览器 `Match.beginTurn()` 在
  每次换边调用 `rollWind()`，开局不额外调用。
- `BaseGame.cs` 的 `Map.wind` 与 `m_nextWind` 默认都是 0。浏览器版保留
  `target=0`，但为让玩家第一发就能看到风力，开局风值取 `[-2.5, 2.5]`
  的随机十分之一值（`NEW`，`WIND.initialAbsMax`）；这不改变 `GetNextWind()` 的
  后续规则。
- `SendGameUpdateWind` 用 `(int)(wind*10)` 传整数；本作直接保留浮点 `wind` 用于
  物理和显示，`PORT`。

### 1.4 命中、扣血、挖洞

- `SimpleBomb.cs:478-547` `MakeDamage()`：
  `DR1=0.95*(baseGuard-3*grade)/(500+baseGuard-3*grade)`；
  `DR2=(defence-lucky>=0)?0.95*(defence-lucky)/(600+defence-lucky):0`；
  `DR3=WorldBossAddDamage*(1-(baseGuard/200+defence*0.003))`；
  `damage=(DR3+baseDamage*(1+attack*0.001)*(1-(DR1+DR2-DR1*DR2)))*damagePlus*shootMinus`；
  当 `distance < radius` 时再乘 `1 - distance/radius/4`，最后 `(int)` 截断。
  `physics.js#sourceDamage` 按此公式实现，`TEMP` 只填数据库缺省数值。
- 原版 `FindHitByHitPiont(GetCollidePoint(), m_radius)` 对范围内所有 Living 生效；
  单机版只结算对方玩家（`PORT`；没有队友/宠物/场景伤害）。当前 `m_radius=55` 来自
  `BallList.xml` ID=243 的 `Radii`。
- 原版 `Map.Dig()` 使用炮弹形状 `Tile`（`BallMgr.FindTile(bombId)`）。
  浏览器版保留原始弹坑图（50/401/4）作为基础 alpha 形状，再叠加固定 seed 的
  lobes/core，用 `destination-out` 只擦除实际地形；随后只对受影响 chunk 读回 alpha，
  更新同坐标的 collision mask。空气爆炸移除 0 像素，不生成 crater。
  原版 `Crater=241` 缺失，替换图与半径标为 `TEMP`；不规则边缘是 `NEW`。

---

## 2. 数值来源表

| 配置项 | 值 | 来源/状态 |
| --- | --- | --- |
| `PHYSICS.dt` | `0.04s` | **SOURCE** `SimpleBomb.cs:558` |
| `PHYSICS.forceMax` | `2000` | **SOURCE** `Player.as:FORCE_MAX` / `EnergyView.as:31` |
| `PHYSICS.forceToVelocity` | `1.0` | **SOURCE** `Living.ShootImp()` 直接以 force 为速度分量 |
| `PHYSICS.mapGravity` | `10` | **SOURCE** `LoadMapsItems.xml` Item ID=1001, `Weight=10` |
| `PHYSICS.mass` | `10` | **SOURCE** `BallList.xml` Item ID=243, `Mass=10` |
| `PHYSICS.gravityFactor` | `70` | **SOURCE** `BallList.xml` ID=243, `Weight=70` |
| `PHYSICS.mapDragIndex` | `2` | **SOURCE** `LoadMapsItems.xml` ID=1001, `DragIndex=2` |
| `PHYSICS.airResistFactor` | `1` | **SOURCE** `BallList.xml` ID=243, `DragIndex=1` |
| `PHYSICS.windFactor` | `240` | **SOURCE** `BallList.xml` ID=243, `Wind=240`；每单位风产生 `240` 横向力 |
| `BATTLE.playerMaxHp/enemyMaxHp` | `10000/2000` | **NEW** 本轮网页平衡值；不是原版 `Player.TOTAL_BLOOD` |
| `COMBAT.blastRadius` | `55` | **SOURCE** `BallList.xml` ID=243, `Radii=55` |
| `COMBAT.baseDamage` | `360` | **TEMP** 玩家战斗数值（DB） |
| `COMBAT.attack/baseGuard/defence/grade/lucky` | `100/80/40/10/0` | **TEMP** 玩家战斗数值（DB） |
| `TERRAIN.craterTemplates` | 30/58/92/84 | **TEMP + NEW** 原 `Crater=241` 缺失；底层图用仓库存在的 50/401/4，多层形状为网页新增 |
| `COMBAT.targetHitRadius` | `36` | **PORT** 人物命中圆半径；配合 112×92 角色包围盒 |
| `CONTROLS.angleMin/angleMax` | `15/65` | **SOURCE** `WeaponInfo.as` 读取 `ItemTemplate.Property5/6`；`TemplateAlllist.xml` TemplateID=70322 为 `15/65` |
| `CONTROLS.moveSpeed` | `170 px/s` | **PORT** `Player.MOVE_SPEED=2`、`GameLiving.stepX=3/stepY=7` 约 90 px/s；为 4000 px 世界调快到 170 |
| `CONTROLS.chargeRate` | `640/s` | **PORT** `EnergyView` 每帧 +20，约 600/s@30fps |
| `WORLD.pixelsPerMetre` | `20` | **NEW** 仅用于 HUD 的米制显示，不参与物理 |
| `WIND.initialAbsMax` | `2.5` | **NEW** 开局风可见；`GetNextWind` 本身仍为 SOURCE |
| `AI.*` | 见配置 | **NEW** 电脑求解与噪声参数 |
| `WORLD.*` | 2000×1425、chunk 256 | **NEW** 1001 前景左右镜像拼接；非官方地图尺寸 |
| `VIEW.*` | 玩家/双方/炮弹 | **NEW** 世界相机、缩放边界、平滑插值 |

### 2.1 数据行实际来自哪里

`Database/Game34.bak` 是 21 MB 的二进制 SQL Server 备份，本次没有启动 SQL Server
去恢复它；但仓库同时提交了后台导出的 XML：

- `GameAdmin/Backup/XMLReader/XMLImport/LoadMapsItems.xml`：
  **Item ID=1001** 给出地图 `Cầu vồng`（彩虹）：
  `ForegroundWidth=2000 ForegroundHeight=1425 BackroundWidht=1526
  BackroundHeight=1425 Weight=10 DragIndex=2`。
- `GameAdmin/Backup/XMLReader/XMLImport/bombconfig.xml`：
  `TemplateID=70322`（`bazooka3`，SUPER-Bazooka）的普通弹 `Common=243`。
- `GameAdmin/Backup/XMLReader/XMLImport/BallList.xml`：**Item ID=243**：
  `Mass=10 Weight=70 Wind=240 DragIndex=1 Radii=55 Crater=241`。
- `GameAdmin/Backup/XMLReader/XMLImport/TemplateAlllist.xml`：TemplateID=70322 的
  `Property5=15 Property6=65`，`WeaponInfo.as` 把它们读作 `armMinAngle/armMaxAngle`。

所以地图重力/阻力、炮弹质量/重力系数/风力系数/空气阻力、爆炸半径和角度范围
都是 **真实行值（SOURCE）**。真正缺失的是玩家装备/角色战斗属性
（`baseDamage/attack/baseGuard/defence`）与 ID=243 的 `Crater=241` 挖洞形状，
这些使用 `TEMP`，并集中在 `config.js`。仍不能保证与某个具体玩家账号的原服手感一致。

### 2.2 数值对弹道的影响

- 加速度：`ax=(240*wind - 2*vx)/10`，`ay=(10*70*10 - 2*vy)/10 = 700 - 0.2*vy`（px/s²）。
- 因此 `wind=±4` 时横向加速度约 `±96 px/s²`；2 秒飞行约造成数百像素落点偏移。
- 初速 `force*cos/sin(angle)`；4000 px 地图上双方初始 3400 px。
  实测 `25° / force=2000` 可命中站在 3700 的电脑，说明远距离仍有解；
  风力不利时可以走近或调整角度，不存在只能靠辅助线才可玩的情况。

---

## 3. 地形显示与碰撞

- 原版 `Tile.cs:66-79` 从 Bitmap 生成碰撞：`A <= 100` 为空，否则实心；
  `_bw = width/8+1`，按 MSB-first 打包。
- 服务器地图 `Fighting.Service/bin/Debug/net48/map/1001/fore.map` 的格式是
  `[int32 width][int32 height][每行 ceil(width/8) 字节]`。本作把该文件放入
  `reference/map/1001/fore.map` 并用 `tests/verify_map_parity.py` 全图对比。
- **源图结果：2000×1425、615,968 个实心像素、0 个不一致。**
- 世界层把源图正向放左半 `0..1999`，水平镜像放右半 `2000..3999`；背景按 1526
  原始宽度平铺/镜像，不拉伸。镜像后实心像素为 1,231,936（正好 2 倍）。
- 加载时按 256×256 生成 16×6=96 个 chunk，每个 chunk 有可见 Canvas 和同原点的
  `Uint8Array` collision mask；`surfaceY[4000]` 记录每列地表。运行时只查当前 chunk。
- 浏览器测试钩子 `terrainDisplaySync()` 对 2000×1425 全图逐像素比较显示 alpha 与 mask，
  结果 **5,700,000 checked / 0 mismatches**。
- 爆炸只更新形状包围盒覆盖的 chunks（实测 medium 4 个受影响 chunks、2 个 mask 变化 chunks），
  只读取这些矩形，不每帧扫描整图、不重建整图。
- 若替换其他地图，必须确认其 `.map` 与 PNG 符合上述关系；否则需要提供该地图的
  `.map` 或明确接受 PNG 近似。本版只有 map/1001。

## 4. 素材映射

| 文件 | 原仓库路径 | 用途 |
| --- | --- | --- |
| `assets/map-1001-back.jpg` | `Tank.Flash/resource/v1.1/image/map/1001/back.jpg` | 背景；按原 1526×1425 平铺/镜像，不拉伸 |
| `assets/map-1001-fore.png` | `.../map/1001/fore.png` | 前景、显示、alpha 碰撞、挖洞 |
| `assets/portrait-player.png` / `portrait-enemy.png` | 网页从人物 sheet 裁切 | 128×128 驾驶舱头像；不是原版独立头像文件 |
| `assets/shell-bomb.png` | `.../image/arm/bomb/00.png` | 飞行炮弹图标（78×78） |
| `assets/weapon-bazooka3.png` | `.../image/arm/bazooka3/00.png` | 火箭筒武器贴图（78×78） |
| `assets/character-player-sheet.png` | `Resource/v1.1/image/equip/m/...` | 网页合成的男性 3×13 人物 sheet；帧序按 `GameCharacter.as` |
| `assets/character-enemy-sheet.png` | `Resource/v1.1/image/equip/f/...` | 网页合成的女性 3×13 人物 sheet；同上 |

**说明（PORT/NEW）**：地图、弹坑、武器和炮弹来自原仓库；人物贴图是把
`Resource/v1.1/image/equip/` 的装备 PNG 合成为 3×13 人物 sheet。动作帧序不是自拟的，
而是按 `GameCharacter.as` 的常量索引同一张 sheet：

| 动作 | 帧索引 |
| --- | --- |
| `STAND` | `0, 6, 7, 8, 9, 10` |
| `WALK` | `1, 2, 3, 4, 5` |
| `SHOWGUN` | `19, 20, 21` |
| `SHOT` | `22, 23, 26, 27` |
| `HIT` | `12, 24, 25, 38, 11` |

`GamePlayer.as` 把 `body` 和 `weaponMovie` 分为两层；本版同样先画人物、再在
`SHOWGUN`/`SHOT` 阶段画手持武器，待机/行走只显示人物帧里背着的武器。
原仓库的 `game/living/*.swf` 仍需要逐帧导出才能复刻攀爬、跳跃等未使用动作；
本版没有把 SWF 说成可直接用的 PNG。人物 sheet 的锚点、武器挂点和贴地姿态由 `COMBAT`
参数控制；驾驶舱头像是从这些 sheet 裁切放大，不是原版独立头像文件。

---

## 5. 与原版的明确差异

1. **连续浮点 vs 整数截断**：原版每个 `CompleteNextMovePoint` 转 `Point(int,int)`，
   初始 `x0/x1` 多处使用 int；浏览器版用连续 float 位置和 2 px CCD 采样。视觉更平滑，
   落点可能有亚像素级差异（PORT）。
2. **多弹/特殊弹**：未实现 `num3=0.9/1.1`、分裂、宠物技能、道具（PORT 简化）。
3. **伤害目标**：只结算对方玩家，不做友军/宠物范围伤害（PORT 简化）。
4. **挖洞形状**：原始弹坑图 + 固定 seed 多层不规则形状，按 chunk 局部更新（PORT/TEMP/NEW）。
5. **回合队列**：原版 `PVPGame` 有 TurnQueue/延迟/状态；单机版固定玩家↔电脑交替，
   仍保留“每次换边更新风”的调用点（PORT 简化）。
6. **地图尺寸**：1001 的 fore 为 2000×1425、back 为 1526×1425。浏览器把前景左右
   镜像成 2000×1425 世界，背景按原始宽度平铺；这是网页版拼接，不是官方地图。
7. **手感参数**：移动、蓄力速度、相机、AI 噪声为浏览器调参（PORT/NEW），
   不影响核心公式。


---

## 6. 大地图相机与 UI 改造（NEW / PORT 边界）

- **不属于原版战斗逻辑**：世界相机、三种视角、平滑插值、屏幕层 HUD、半透明按钮、
  全屏 API、PWA manifest、鼠标拖角/拖力度都属于浏览器展示与输入层（NEW），
  没有改写回合、风力、伤害、重力公式。
- **相机**：`camera.js` 维护 `cameraX/cameraY/zoom`，把 2000×1425 世界投影到视口：
  `screenX = (worldX - cameraX) * zoom + width/2`。位置/缩放用 `smoothDamp()`；
  中心夹紧到地图边界；炮弹飞行允许天空 overscan，但左右仍夹紧。
- **视角**：`player` 默认；`both` 在结算/电脑回合尝试容纳双方，放不下时保持最小可读
  缩放并聚焦当前角色/爆炸点；`shot` 仅在飞行时跟随炮弹。
- **屏幕层**：HUD、血条、风力、回合、距离、移动/调角/发射/治疗、视角和全屏按钮是 DOM，
  不参与相机变换。方向提示在屏幕安全车道绘制，左右去重，不压按钮或角色。
- **输入**：Pointer Events 为主；`pointerdown/up/cancel/move` 独立跟踪 pointerId。
  新增桌面鼠标在角度读数上 `ns-resize` 拖动，以及在发射按钮上按住后上下拖动直接调整
  `force`；`Match.adjustCharge()` 不改变 `releaseCharge()` 的最短蓄力/最小力度校验。
- **全屏**：`document.documentElement.requestFullscreen({navigationUI:'hide'})`，
  成功后尝试 `screen.orientation.lock('landscape')`；退出时 `unlock()`。失败不伪造状态。
- **PWA**：`manifest.webmanifest` 使用 `display: fullscreen` / `orientation: landscape`，
  iOS 使用 `apple-mobile-web-app-capable`、`black-translucent` 与 180px 主屏幕图标。
