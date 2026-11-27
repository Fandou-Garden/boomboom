# 优化提示词清单（可直接投喂使用）

> 本文件收录两份「提示词」：复制对应章节全部内容发给 AI 即可执行。
> 1️⃣ 参考《几猫国产3A大作》单文件 3D 游戏的手法优化弹弹堂前端；
> 2️⃣ 地图分批异步加载（首屏 5 张 + 点击加载 5 张）并新增玛雅废墟。

---

## 提示词 1️⃣：参考「几猫3A」的加载/渲染手法优化

```text
你负责优化 DDTank 复刻项目（仓库 Fandou-Garden/gunny-wind-arena）的前端体验。
参考对象是一份单文件 Three.js 游戏《几猫国产3A大作_V1.html》，它的核心手法：
单文件零请求、深色首帧秒出、devicePixelRatio 自适应、OffscreenCanvas 兜底、
pointer/touch 统一操控、safe-area 适配、音频懒解码。

约束：
- 权威引擎是 Go→WASM（server/wasm/main.go），不要改成 WebGL/Three.js 重写渲染层；
- 现有 Canvas2D 渲染（dist/js/renderer.js）与确定性弹道必须保持逐像素/逐帧不变；
- 所有改动只动 dist/ 与 tests/，改完必须跑通 tests/ 四套浏览器回归与 map parity。

请按以下清单逐项实现（每项独立提交）：

1. 单请求 JS 包（对齐「单文件零请求」）
   - 写 scripts/build-bundle.mjs：把 dist/js/*.js + dist/offline-api.js 按 import 顺序
     合并成 dist/js/bundle.js（保持 IIFE 顺序，去掉相互 import 的 ？v= 查询），
     index.html 在 WASM 后端路径下只加载 bundle.js 一个脚本；
   - Go 后端路径（真实 /api）保持原分文件加载，不影响服务器模式。

2. 首帧秒出（对齐「深色首帧」）
   - index.html 的 #loading 已是纯 CSS；把内联 <style> 中加载屏背景改为与游戏
     主色一致的深色渐变 + 微光晕，禁止加载屏出现任何图片请求；
   - <link rel="preload"> 首屏三件套：gunny.wasm.gz、当前地图 fore.webp、back.jpg
     （map id 从 URL ?map= 读取，无则 1156）。

3. devicePixelRatio 自适应与 FPS 保护（对齐「DPR 缩放」）
   - renderer.js/camera.js：画布逻辑尺寸 = CSS 尺寸 × clamp(dpr, 1, 2)，
     lowPower 设备（main.js 已有 matchMedia 判定）clamp(dpr, 1, 1.35)；
   - 帧时间 > 26ms 连续 60 帧 → 临时降 0.85 渲染分辨率（CSS 尺寸不变），
     恢复条件：帧时间 < 17ms 连续 120 帧；变化必须走 Camera 的视口换算，
     保证落点标记 < 1.5px 精度不回退。

4. 操控细节（对齐 pointer/touch 统一）
   - input.js：把 touchstart/touchend 与 mouse 事件统一到 Pointer Events
     （pointerdown/move/up + setPointerCapture），移除双路径去抖逻辑；
   - #view 保持 touch-action: none；蓄力/发射手势在 pointerdown 即预览轨迹。

5. 音频（对齐懒解码，现有实现已接近）
   - 确认 sound.preload() 已延后到 boot 完成后；把 BGM 的 decodeAudioData
     改为首个用户手势后触发（startBgm 已满足则跳过）。

验收：
- 静态站首屏网络请求 ≤ 6 个（html + css + wasm.gz + wasm_exec + bundle + 地图3件）；
- 高 DPR 手机截图像素清晰（角色边缘无糊边）；
- 60fps 桌面 / ≥45fps 低端机模拟（Puppeteer CPU 4x throttle）；
- 四套浏览器测试 + python3 tests/verify_map_parity.py 全部通过。
```

---

## 提示词 2️⃣：地图分批异步加载 + 新增「玛雅废墟」

```text
你负责为 DDTank 复刻项目（仓库 Fandou-Garden/gunny-wind-arena）实现
「首屏 5 张地图、其余点击异步加载」的地图系统，并新增一张「玛雅废墟」。

现状：
- 地图 11 张：默认 1156，其余 1001/1002/1003/1008/1014/1035/1038/1157/1190/1192；
- 资源在 dist/assets/：map-<id>-fore.webp（无损）、map-<id>-back.jpg、
  map-<id>-thumb.jpg；碰撞位图在 dist/data/<id>.fore.map(.gz)；
- WASM 后端：dist/offline-api.js 的 boot() 只取当前 mapId 的 fore.map.gz；
  地图切换目前是带 ?map= 重新加载页面（main.js setupMapPicker）；
- 加载屏文案在 dist/index.html #loading。

需求（严格按序实现）：

1. 地图清单元数据
   - 新建 dist/js/map-manifest.js：导出 MAP_MANIFEST = {
       core: [1156, 1001, 1038, 1157, 1190],        // 首屏即用 5 张
       extra: [1002, 1003, 1008, 1014, 1035],       // 点击加载 5 张
       maya: { id: <玛雅废墟的真实地图id>, name: '玛雅废墟' }, // 见第 4 步
     }，每项含 name、worldSize、来源注释（Tank.Flash 路径）。

2. 异步加载管线（extra 五张）
   - main.js：boot() 只为 core 5 张建立缩略图/标题；extra 5 张在地图选择器
     卡片上显示「点击加载」角标；
   - 点击后异步 fetch map-<id>-fore.webp / back.jpg / thumb.jpg /
     data/<id>.fore.map.gz（四件并行，带 ?v= 版本参数），卡片显示进度条；
   - 任一件失败 → 角标变「重试」，console.warn 详情，不影响其他图；
   - 加载完成（四件全部 + Image decode 成功）写入内存 Map 缓存 + 
     localStorage 标记 gunny.map.loaded.<id>=1，下次进入页面直接可用
     （缓存仍按 v= 版本号失效）；
   - 关键体验：点击加载后用户仍可直接选 core 地图进游戏，后台继续下载；
     之后回到地图选择器（不需要刷新页面）能看到已加载完成的图解锁。

3. 玛雅废墟
   - 到原版资源 /tmp/gunny-orig/Tank.Flash/resource/v1.1/image/map/ 逐目录
     对照 fore.png 缩略图找出「玛雅废墟」的真实地图 id（原版名称为 Maya
     系列场景；用 fore.map 尺寸 + 颜色特征辨认，不确定时列出候选问我）；
   - 复刻管线与现有 10 张完全一致：fore.png → 1843×1020 重采样 → 
     dist/data/<id>.fore.map（MSB-first 位图）→ 无损 WebP（exact=True，
     逐像素一致）→ back.jpg/thumb.jpg；加入 verify_map_parity.py 清单；
   - 加入 WASM offline-api.js 的 mapIds 白名单与 embed_sim_test.go 的地图
     数组，跑通 9000 tick 嵌入模拟后才能上架；
   - 该图归入 extra 组（点击加载），选择器卡片名「玛雅废墟」。

4. 选择器 UI
   - core 卡片即点即玩；extra 卡片两态：未加载（点击开始加载→进度）、
     已加载（可进游戏）；玛雅废墟同 extra；
   - 正在游戏中的「更换地图」入口如果目标图未加载，弹出确认：
     「地图加载中 x%，完成后再切换」，不阻塞当前对局。

验收：
- 首屏仅下载 core 5 张的 thumb + 当前图的 fore/back/data（≤ 约 1.2MB）；
- 点击加载期间可正常开局、发射、结算；回选择器后进度/解锁状态正确；
- 断网重试路径有 UI 反馈；四套浏览器测试、map parity、嵌入模拟全过。
```

---

## 附：提示词 1️⃣ 的手法对照表（几猫3A → 弹弹堂）

| 几猫3A 手法 | 弹弹堂现状 | 是否采纳 |
| --- | --- | --- |
| 单 HTML 零请求 | 几十个资源文件（已做 gzip+WebP 优化） | ✅ 折中：JS 合并为单 bundle |
| 深色首帧无图片 | 加载屏已是纯 CSS | ✅ 优化配色 + preload 首屏三件套 |
| devicePixelRatio 渲染缩放 | 未做 DPR 自适应 | ✅ 采用（含 lowPower 降档） |
| OffscreenCanvas 兜底 | 地形 chunk 已在用 | 已有，保持 |
| Pointer Events 统一操控 | touch+mouse 双路径 | ✅ 合并 |
| Three.js/WebGL 渲染 | Canvas2D 确定性渲染 | ❌ 不采纳（逐像素一致性不可破） |
| 音频懒解码 | 已延后预载 | 已有，保持 |
