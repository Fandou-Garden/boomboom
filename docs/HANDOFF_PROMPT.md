# Gunny Wind Arena — 新会话承接提示词

> 用法：把下面整段（从「你接管一个已上线的弹道对战游戏项目」开始）原样粘贴给新的 AI 会话即可。它包含全部背景、路径、流程与待办，无需旧会话上下文。

---

你接管一个已上线的回合制弹道对战游戏项目（Gunny/DDTank 复刻），继续开发和优化。请先通读本提示词再动手，不要重新发明已有结论。

## 一、项目是什么

- 仓库本地路径：`/workspace/gunny-wind-arena`（远端：`github.com/Fandou-Garden/gunny-wind-arena`，main 分支）
- 线上地址：`https://a49f3350593822301.app.workbuddy.host/?sharecode=UMJ5YC3KWL`
- 形态：**纯 JS 静态版**（引擎 3.0.0，无 WASM、无后端依赖）。Go 服务端在 `server/` 保留但当前回归一律用静态模式，**不要再去碰 Go**。
- 原版参考源码：`reference/original/`（C# 服务端 + AS3 客户端关键文件摘录，如 `EnergyView.as`、`GameLiving` 相关、`WeaponPropBar`/`FightControlBar.as`、`SelfPlayerWalkAction.as` 等）。改玩法逻辑前先对照原版源码，不要凭感觉写。
- 详细文档在 `docs/`（CODE_LAYOUT.md、SOURCE_MAPPING.md、AUDIO_MAPPING.md、VALIDATION.md 等），`README-ZH.md` 是中文总览。

## 二、代码结构（改哪里）

```
dist/                     ← 全部用户可见产物，改完必须重新发布
  index.html / styles.css ← UI 布局（底部道具栏：POW=R 槽、飞行=F 槽、发射键）
  js/engine/              ← 权威模拟引擎（actions/match/constants/index…）
  js/main.js              ← 引导与接线（输入→引擎）
  js/input.js             ← 键盘（KeyF→onCarryShortcut 飞机，R→POW）
  js/config.js            ← characterScale/weaponDrawScale 必须 1.0（1:1，勿改大）
  js/map-manifest.js      ← 地图分批懒加载清单（核心 5 图 vs 额外图 + 玛雅废墟 1049）
  standalone-api.js       ← 静态 API
tests/                    ← browser_acceptance / browser_controls_audio / browser_mobile /
                            browser_static（.cjs，Puppeteer）+ engine/（match/parity/embed）
```

## 三、当前已完成状态（版本 v=30，含镜头/结算存档/加载过场）

1. **蓄力条照抄原版 EnergyView**：SHOOT_FORCE_STEP=20/30fps，满 2000 后回减、弹回 0 未松手跳回合；回弹中松手按实时力度。时间源一律用引擎累计模拟时钟 `this.time`（帧率无关），**不要用墙钟**。
2. **飞机（道具 10016）**：底部道具栏 F 键槽，紧邻 POW 的 R 槽；`FlyCommand(40)` → `SetBall(3)` 零伤害不炸坑传送弹，命中沿速度反方向退 5px 瞬移。
3. **角色 1:1 绘制**（对照原版 GameLiving，仅 scaleX=±direction 翻转），已修掉"飘进地形"嵌地 bug。
4. **地图分批懒加载**：核心 5 图随包，其余（含新增玛雅废墟 1049）点击后异步加载，地形显示用无损 WebP（exact=True，逐像素与 PNG 一致，勿改回有损）。
5. **加载优化**：预 gzip + 前端 `DecompressionStream('gzip')` 解压；音效预载延后。
6. **回合镜头拉远（v30）**：`VIEW.baseZoomFactor` 2.5→1.25，回合视角可见宽约 1450 世界像素；地图外由背景图边缘延展填充。
7. **战后翻牌 + 本地存档（v30）**：`dist/js/save.js`（键 `gunny-wind-arena.profile.v1`，含 version/coins/stones/claims），9 张卡翻 3（胜）/2（负），领取后入账，每场 `matchId` 只能领一次，损坏存档自动重建，说明面板有重置入口。
8. **战斗加载过场（v30）**：`boot()` 期间显示地图背景/双方/地图名/真实进度条，淡出后进入战斗；资源失败有重试；加载音用原版 1001 BGM 降音量（原版无加载音，勿伪造）。
9. 版本参数全站统一 `?v=30`（index.html / js/*.js / standalone-api.js）。

## 四、标准流程（每次改动的固定闭环）

1. 改 `dist/` 下的文件。
2. **版本参数 +1**（当前 v=30 → v=31，全站统一替换，别漏 collision 拉取那一处）。
3. 跑回归（在项目根目录）：
   ```bash
   npm run test:engine            # 引擎 55 项
   npm run test:map               # 地形 parity（python3）
   npm run test:browser           # visual + controls + mobile 三套
   npm run test:browser:static    # 静态模式浏览器回归
   ```
   注意：`scripts/node.sh` 会起本地静态服务器（端口 8077 方向），`tests/browser_controls_audio.cjs` 的快捷键 keys 数组里已含 `'F'`，新增快捷键记得同步断言。
4. 推送：
   推送用的 GitHub PAT 在仓库外的 `/workspace/HANDOFF_SECRET.txt`（只读它，**绝不把令牌写进任何会入 git 的文件**，Push Protection 会拦截）。推送命令模板：
   ```bash
   cd /workspace/gunny-wind-arena && git add -A && git commit -m "..." && \
   git push https://<PAT>@github.com/Fandou-Garden/gunny-wind-arena.git main
   ```
   GitHub 偶发 502，失败重试几次即可。
5. 重新发布站点（**必须**，改了 dist 不发布等于白改）：
   ```bash
   node /root/.codebuddy/skills/sites/scripts/publish.js --dir /workspace/gunny-wind-arena/dist --language static
   ```
   必须用绝对路径 `--dir /workspace/gunny-wind-arena/dist`。发布成功返回 shareLink + verified:true。
6. 线上验证后按需补 `README-ZH.md` / `docs/` 文档，随代码一起提交。

## 五、血泪教训（违反会返工）

- `gzip -k`：压缩时必须加 `-k` 保留原文件，历史上曾因漏加把 wasm 原件覆盖掉。
- 蓄力/计时逻辑只用 `this.time` 模拟时钟；快进模拟测试时墙钟取力会导致"不发射"。
- 角色/武器 scale 已按原版 1:1，用户明确确认过，别"看着小"就调大。
- 地形权威碰撞是 fore.map 位图（MSB-first，alpha>100 实心），显示图与碰撞必须逐像素一致。
- Bash 工具不持久工作目录，每条命令都带 `cd /workspace/gunny-wind-arena &&` 前缀。
- 不要把 `.codebuddy/` 目录当缓存删除。
- 沙箱里跑不起 go.mod 1.25（本地 Go 1.21）——但纯 JS 版本根本不需要，忽略。

## 六、待办（你的第一批任务）

`docs/OPTIMIZE_PROMPTS.md` 里已写好两份详细方案提示词，**均未执行**：

1. **按《几猫国产3A大作》手法做视觉/体验升级**（对照文件在仓库根 `参考FPS_game.html`）。
2. **地图懒加载体验完善 + 玛雅废墟资源补齐**（懒加载骨架已上，按提示词补交互与资源）。

请先读 `docs/OPTIMIZE_PROMPTS.md`，逐份按方案执行，每份完成后走第四节完整闭环（测试→推送→发布→线上验证）。有疑问先看 `docs/` 与 `reference/original/` 对照原版，再动手。
