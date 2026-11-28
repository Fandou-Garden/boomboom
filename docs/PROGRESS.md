# PROGRESS — DDT 本地服务端版（Node + TypeScript + SQLite）

> 本文件按任务准则持续更新：已完成 / 当前任务 / 阻塞 / 下一步 / 验证结果。
> 不把估算写成实测，不把未完成写成完成。

## 任务与来源

- 需求文件（位于 `/Users/123jiaru/Desktop/project/game/`）：
  - `参考源码的准则.md` 与 `目标.md`（内容相同）：授权范围、本轮目标、验收要求。
  - `源码实现路径.md`：技术规范、原版代码参考位置、开发顺序、交付清单。
- 开发分支：`feat/node-server-mode`（基于 `main` @ `cbfe149`）。
- 基线仓库：`https://github.com/Fandou-Garden/boomboom`，检出到
  `/Users/123jiaru/Desktop/project/game/boomboom`。
- 站点版前端 = 现有 `dist/`（原生 ESM，无打包器），**保留不改造成另一套前端**。
- 原版 Flash/AS3 客户端仅用于核对、提取与移植素材，不能当作 JS 前端加载。

## 参考仓库可达性（2026-11-28 实测）

| 仓库 | 结果 |
| --- | --- |
| `Fandou-Garden/boomboom` | 可访问，HEAD `cbfe149`，仅 `main` 分支 |
| `Fandou-Garden/gunny-wind-arena` | 可访问，HEAD 同为 `cbfe149`（同一项目） |
| `Fandou-Garden/origin_boomboom` | HTTP 404 / git 认证失败，**不可访问** |
| `Fandou-Garden/Gunny` | HTTP 404 / git 认证失败，**不可访问** |
| `phucdz2kk4/Gunny`（约定上游） | HTTP 200，可访问，HEAD `057c71a` |

按 `源码实现路径.md` 第一节「若主参考地址不可访问，读取上游」，后续原版代码/物品核对以上游仓库为准。

## 基线现状（读取仓库后确认，非推测）

- 前端入口 `dist/index.html` 内联脚本探测 `GET /api/state`：返回含 `phase` 的 JSON 即判定为「有后端」，
  走 `RemoteMatch`（SSE `/api/events` + `POST /api/command`）；否则加载 `dist/standalone-api.js`
  在浏览器内跑纯 JS 引擎（`offline` 站点版）。
- 权威战斗规则已有逐字段移植的**纯 JS 引擎** `dist/js/engine/`（`GunnyEngine` 五方法：
  `init/command/update/snapshot/events`），与 Go `server/game/` 共用常量和地图位图；
  `tests/engine/parity.test.mjs` 是 Go 金标准的一致性回归。WASM 已退役（`dist/wasm` 不存在）。
  → 决策：**复用该纯 JS 引擎作为服务端战斗核心**，不重写物理、不删除 Go 服务端。
- 地图：`dist/data/` 12 张 `*.fore.map`（含 `.gz`），`dist/js/maps.js` 目录；Go 服务只写死 1156 一张。
- 已有功能：选地图（整页重载 `?map=`）、选武器、战斗、结算九宫格翻牌（胜 3 / 负 2 张）、
  加载过场、原版翻牌/加载/音效素材（`dist/assets/ui/`、`dist/assets/audio/`）。
- 存档：仅浏览器 `localStorage`（`dist/js/save.js`）：`coins`、`stones`、`claims[]`、`updatedAt`。
  **无**武器强化等级、背包、用户、房间、服务端数据库。
- **不存在**：房间 / 大厅、铁匠铺 / 强化 / 强化等级、服务端持久化、TypeScript、Node 后端。
- 「神武石」：全库检索**零命中**。只有「玄武石」，`art-source/ITEM_XUANWU.md` 记录原版
  `TemplateAlllist.xml` 映射 `xuanwu1..5` ↔ `TemplateID 11005/11006/11007/11008/11031`，
  图标 `art-source/items/xuanwu1..5.png`，`dist/assets/ui/icon-stones.png` 已按 v33 勘误换成 `xuanwu4`。
  → 待上游仓库核对真实物品名后记录匹配/未匹配状态，**不编造 ID、不擅自替换**。
- 已知既有偏差（记录，不在本轮扩大范围）：Go `server/game/config.go` 体力 100/0，
  JS 引擎 `dist/js/engine/constants.js` 体力 2000/60（README §4.3 的 2000 指 JS/前端）。

## 环境（实测）

- macOS，Node `v22.22.2`，npm `10.9.7`，Go `go1.25.7 darwin/arm64`。
- `npm ping` 成功；Node 原生 TS 类型擦除可用（直接 `node x.ts` 通过）；`node:sqlite` 可用（实验性）。
- 基线 `git status` 干净，无未提交改动需保护。

## 已完成

- [x] 读取三份需求文件；读取 README-ZH.md、package.json、目录结构、git 状态与历史。
- [x] 完成现有架构盘点（见上「基线现状」）。
- [x] 核实参考仓库可达性。
- [x] 创建开发分支 `feat/node-server-mode`。
- [x] 建立本进度文件。
- [x] **阶段 1：Node + TypeScript + SQLite 服务端骨架**（可运行）。
  - `server-node/`：tsx 开发运行器（`npm run start:server` / `dev:server`），`tsconfig.json`，
    迁移 `migrations/001_init.sql`，`node:sqlite`（WAL + 外键 + busy_timeout），
    固定本地玩家 `local-player`，Express 5 + ws，静态托管同一份 `dist/`，只监听 127.0.0.1。
  - 数据库表：players / item_catalog / inventory / weapon_instances / rooms / battles /
    reward_boards / reward_picks / forge_operations / unmatched_items / schema_migrations。
  - `.env.example`、`.gitignore`（data/、*.sqlite*、.env 均排除）、根 `package.json` 新增脚本，
    原 `npm start`（Go 站点版）保持不变。
  - 原版玄武石 1~5 级图标从 `art-source/items/` 移植到 `dist/assets/items/`，
    sha256 逐一核对一致（原文件、导出文件、用途见后续素材清单）。
- [x] **阶段 2：服务端权威战斗**（代码完成，待端到端验证）。
  - 直接 `import('../../dist/js/engine/index.js?v=33')` 复用现有纯 JS 权威引擎，
    **没有复制、没有重写物理**，Go/JS 一致性金标准 `parity.test.mjs` 不受影响。
  - `server-node/src/battle/engine-host.ts`：按需加载并缓存当前地图 `dist/data/<id>.fore.map`，
    开局冻结双方 `actor.attack`（进入原版 MakeDamage 公式），安装 `aiSolver` 钩子实现
    **固定角度/力度、0.35 攻击倍率的弱机器人**，仍走同一弹道/碰撞/伤害/回合入口。
  - `server-node/src/battle/session.ts`：40ms 固定步长；实现既有 `/api/state`、
    `/api/events`(SSE)、`/api/command` 契约；命令白名单只允许操作意图，
    拒绝 `restart`、结果字段与非 debug 的 `debug_*`；服务端检测 winner 后落库并创建奖励盘。
  - WebSocket 只广播房间/钱包/奖励盘等低频事件，战斗帧仍走 SSE，不发送整张地图。
- [x] **阶段 3：房间 / 奖励 / 铁匠铺服务端业务**（代码完成，待端到端验证）。
  - 房间：12 张地图、13 把武器实例、装备切换、地图切换、机器人摘要、钱包与材料。
  - 奖励：服务端种子生成 3x3 卡面，未翻卡不下发内容；`claimCard` 在事务内验证
    归属/次数/卡片状态，`UNIQUE(request_id)` 防重放、`UNIQUE(board_id, card_index)` 防重复领，
    同一请求返回完全相同的已存结果。
  - 铁匠铺：单事务完成「归属→版本/上限→金币材料→结果→扣费扣料→版本条件更新→操作记录」，
    `requestId` 防重放、`version` 条件更新防并发重复消费。
  - 「神武石」在 `unmatched_items` 记录为未匹配，**未编造 TemplateID、未用玄武石冒充**。

- [x] **阶段 4：统一数据访问接口 + 房间 / 铁匠铺前端接入**（可运行，已浏览器验收）。
  - `dist/js/data-api.js`：offline（站点版 localStorage 实现）/ server（HTTP + WebSocket）
    两种实现共用一套接口；`DDT_MODE` 环境变量 + `/api/server/config` 探测 + `?mode=offline` 覆盖。
  - `dist/index.html` 先初始化接口再加载同一份 `main.js` / `server-mode.js`；
    `main.js` 只增加了模式分支与钩子（钱包、结算、返回房间、首屏选择器抑制），
    **没有复制第二套前端**，Canvas / HUD / 手机横屏控件保持原样。
  - 个人房间：原版 `room.swf` 背景与角色框、12 张地图缩略图、13 把武器、金币与 5 种材料、
    弱机器人摘要、铁匠铺入口、开始战斗、未翻完奖励盘的继续领取入口。
  - 房间内打开/关闭铁匠铺回到同一房间；界面明确标注「原版铁匠铺 UI 素材未导出 · 单机临时界面」，
    保留 `data-asset-slot="forge-panel"` 替换入口。
- [x] **阶段 5：九宫格翻牌接入服务端事务**（原版 `gameover.swf` 卡背/卡面/翻牌动画，未重绘）。
  - 未翻卡不下发内容；点击卡片提交 `battleId + cardIndex + requestId`，
    奖励逐张由服务端返回并入库；刷新 / 重启 / 未翻完离开均可恢复。
- [x] **阶段 6：强化属性进入下一局**（浏览器与 HTTP 双层验证）。
  - 服务端开局把 `weapon_instances.attack` 冻结进 `actor.attack`，进入原版 MakeDamage 公式；
    +1 级后下一局实测 `attack=125`（未强化为 100），机器人保持 35。
- [x] **阶段 7：原版核对、素材清单、性能实测与交付文档**。
  - 上游 Gunny @ `057c71a`（= `constants.js` 的 `SOURCE_COMMIT`）已只读核对：
    `TemplateAlllist.xml` 解压后 7642 条物品，玄武石 1~5 级 TemplateID 全部证实；
    「神武石」/「Thần Vũ」0 命中，登记为 `unmatched`，未编造 ID、未冒充。
  - 原版强化机制（Rock / 装备进阶）与本轮规则不同，按准则不混用，保留 `LOCAL_RULE` 并写明证据。
  - `docs/ASSET_MANIFEST.md`（素材对应清单）、`README-SERVER.md`（启动/备份/验收/缺失）已交付。

## 当前任务

**阶段 8 已完成并本地提交推送**（材料分类纠错 / 原版强化链路核对 / 极武器映射撤回 /
迁移验证 / 奖励盘版本化 / 规则测试 / 镜头断言修复）。详见文末「阶段 8」与
`docs/RULE_EVIDENCE.md`、`docs/WEAPON_MAPPING_EVIDENCE.md`、`docs/MIGRATION_VERIFICATION.md`。

**阶段 9 待开始（未完成，不得写成已完成）**：原版红金色铁匠铺 UI 资源导出与真实交互、
原版音乐与音效接入、极武器专属素材、多局资源增长观测。当前仍是 `LOCAL_RULE` 临时界面，
**明确未还原原版铁匠铺**，不能写成「原版还原已完成」。

## 验证结果（2026-11-28 全部实测，不把估算写成实测）

### 构建与静态检查

- `npm run typecheck:server`（`tsc --noEmit -p server-node/tsconfig.json`）：**通过，0 错误**。
- `node --check` 对 `dist/js/data-api.js`、`dist/js/server-mode.js`、`dist/js/main.js`：**通过**。
- 首次启动曾因空库时查询 `schema_migrations` 报错，已修复并重启验证通过。

### 服务端启动与契约（阶段 1）

- `npm run start:server` 监听 `http://127.0.0.1:8100/`，数据库 `data/ddt.sqlite`（WAL、外键开启）。
- `/healthz` → `ok=true, mode=server, battleState=idle`；`/api/state` → `phase=idle`、
  2 actors、13 weapons（满足 `index.html` 的后端探测契约）。
- `/api/server/room` → 12 张地图、13 把武器、装备 `水果篮` level 0 / attack 100、
  5 种材料、金币 0、机器人 `42°/1180/0.35`、无待领奖励盘。
- `/api/server/forge` → 13 把武器；0 级消耗 60 金币 / 1 材料单位 / 成功率 1（首级保底）、
  强化后 attack 125，规则来源 `LOCAL_RULE`。
- 静态资源 `/`、原版物品图标、`data/1156.fore.map` 均 200。

### 自动化测试

| 套件 | 结果 |
| --- | --- |
| `npm run test:server` | **通过**（1 个端到端用例，约 4.2s）：房间 / 选图 / 选武器 / 冻结属性 / 弱机器人 / 胜负判定 / 9 卡 3 张上限 / requestId 重放幂等 / 重复卡 409 / 超额 409 / 重放不重复发奖 / 强化事务 / 下一局 attack=125 / WebSocket / 重启存档 |
| `npm run test:server:browser` | **通过**：11 项 UI 验收 + 站点版 offline 回归，页面无 JS 错误；截图存于临时目录 |
| `npm run test:server:perf` | 已实测，数据见下 |
| `npm run test:engine` | **48/48 通过**（既有 JS 引擎测试） |
| `sh server/test.sh`（Go） | **通过**：`gunny/server/game ok`，`gunny/server` 无测试文件 |
| `npm test` | **60/61 通过，1 项既有失败**：见「阻塞」第 2 条 |

浏览器测试覆盖：房间 12 地图 / 13 武器 → 开始战斗 → 服务端结算九宫格 → 翻牌奖励上屏
（含 420ms 原版翻牌动画后卡面可见）→ 返回房间保留奖励盘与继续领取入口 →
铁匠铺明确标注临时界面 → 强化成功 +1 / attack 125 → 关闭回同一房间 →
刷新页面等级与金币材料保留 → 纯静态托管下 `backend=js`、`dataMode=offline`、无房间层、无启动错误。

### 实测资源占用（`npm run test:server:perf`）

- 后端 RSS：空闲 **108.50 MB**（heapUsed 12.13 MB），战斗进行中 **109.91 MB**（heapUsed 19.59 MB）。
- 浏览器 JS 堆 **2.59 MB**、DOM 节点 1389、事件监听 173。
- 首屏 144 个请求，encoded **2.86 MB** / transfer **2.87 MB**。
- `dist/` 共 **30.23 MB**（assets 26.87 MB、地图碰撞数据 2.76 MB、JS 0.45 MB）；
  `index.html` 23.4 KB、`styles.css` 78 KB、12 张 `.fore.map`。
- 环境：macOS arm64 / Node v22.22.2 / Chrome headless 1366×768。

### 原版核对

- 上游 Gunny @ `057c71a` 的 `TemplateAlllist.xml`（zlib）解压后 7642 个 `<Item>`：
  「神武」0 条、「Thần Vũ」0 条；`Đá Huyền Vũ 1..5` ↔ 11005/11006/11007/11008/11031 全部证实。
- `itemstrengthengoodsinfo.xml` 与 `StrengthenInfo.cs` / `StrengthenGoodsInfo.cs` 显示原版强化为
  Rock + 装备进阶机制，与本轮规则不同，未混用。详见 `docs/ASSET_MANIFEST.md`。

### 复验（2026-11-28 04:01，代码未改动，工作区干净）

- `npm run typecheck:server`：通过，0 错误。
- `npm run test:server`：通过（1/1，4189ms），临时端口 51316 与 `/tmp` 临时库，未触碰用户存档。
- `npm run test:server:browser`：通过，11 项 UI 验收 + 站点版 offline 回归，页面无 JS 错误。
- `npm run test:server:perf`：通过，报告 `.../ddt-perf-3fYRT7/perf-report.json`。
  本次实测：后端空闲 RSS **108.05 MB**（heapUsed 12.16 MB）、战斗中 **120.28 MB**（heapUsed 19.30 MB）、
  浏览器 JS 堆 **2.67 MB**、首屏 encoded 2.86 MB / 144 请求、`dist/` 30.23 MB。
  与上一轮（108.50 / 109.91 / 2.59 MB）存在正常波动，**两组都是实测值，不互相覆盖**。
- `npm test`：**60/61 通过**，唯一失败仍是 `tests/physics.test.mjs:207` 的镜头边界断言（v33 既有）。

## 阻塞

> **状态更新（2026-11-28 10:43 之后）**：下列第 1 条「推送凭证失效」已解除；
> 第 2 条「镜头断言失败」已在阶段 8 修复。以下保留当时诊断原文作为历史记录，
> 结论以本段与文末「阶段 8」为准。

1. **【已解决】推送开发分支失败（2026-11-28 早期实测，历史记录）**。
   - `git push -u origin feat/node-server-mode` 返回
     `remote: Invalid username or token. Password authentication is not supported for Git operations.`
   - 诊断：`credential.helper=store`，`~/.git-credentials` 内含一条 40 字符 classic PAT
     （另有 gitlab 条目）；`gh auth status` 亦报告 `The token in default is invalid.`；
     SSH `git@github.com:22` 连接超时（网络侧阻断，非密钥问题）。匿名 HTTPS **读取**正常，
     仅写操作认证失败。
   - 判定：现有 GitHub 凭证已失效或被撤销，属准则第 8 条的「权限失败」真实阻塞。
   - 处理：不打印/记录/提交任何 Token，不猜测或替换凭证，不做强制推送；
     按准则第 9 条保存现场并继续开发，本地持续提交。
   - 最终复核（代码全部完成后）：又尝试 2 次推送，仍返回同样的认证错误。
     期间发现并排除了一个 02:22 留下的陈旧 `~/.git-credentials.lock`
     （已改名保留为 `~/.git-credentials.lock.stale-20261128`，未删除数据）；
     `git credential fill` 能正常读出用户名与 40 字符 PAT，说明**不是锁或读不到凭证**，
     而是该 PAT 已被 GitHub 判定无效（`gh auth status` 亦独立报告 token invalid）。
   - 判定：这是准则第 8 条的「权限失败」真实阻塞，已按第 9 条保存现场并完成全部独立开发任务，
     不再反复重试。
   - 需要用户执行：提供有效 PAT / 重新登录 `gh` / 配置可用的认证方式后执行
     `git push -u origin feat/node-server-mode`。本地分支与全部提交已就绪。
   - 04:01 复核（补充诊断，不是重复盲试）：
     `GIT_TERMINAL_PROMPT=0 git ls-remote origin HEAD` **成功**返回 `cbfe149`——
     公开仓库匿名 HTTPS 读取不触发鉴权，**读通不代表写通**；
     而 `git push` 返回 `fatal: could not read Username for 'https://github.com'`。
     检查发现 `~/.git-credentials`（03:53 更新）现仅剩 `gitlab.kinm.dev` 一条，
     **已无 github.com 条目**；`git credential fill` 无可用 GitHub 凭证，
     `gh auth status` 仍报告 `The token in default is invalid.`
     （合理推断：先前数次鉴权失败后 Git 的 `credential reject` 清除了 store 中失效的 PAT；
     此为机制推断，非实测结论）。即凭证链当前为空 + `gh` token 失效，
     **写权限确实不可用，不再重试**。
2. **【已修复】既有测试 1 项失败（非本轮引入）**：`tests/physics.test.mjs` 的
   「shot mode follows the shell and permits sky overscan」边界断言
   `view.worldLeft + view.viewW <= WORLD.width + 1e-6`。
   已在干净的 `main` 基线工作树上复现同样失败（v33 允许天空 overscan 后断言未同步）。
   本轮未修改 `camera.js` / `physics.js`；镜头锁定与缩放分离由既有 `camera.js` 提供。
   **阶段 8 处理**：实测 `WORLD.width=1843`、`viewW≈1890.26`、`allowWide=true`，
   确认 v33 shot 模式设计上允许有界横向宽视野跟随飞弹，旧断言与该设计冲突。
   改为有界 overscan 断言（左边界不越界、`viewW <= WORLD.width*1.2`、
   `worldLeft+viewW <= WORLD.width*1.2`、`zoom<1`），**未删除测试**，
   测试名同步为「shot mode follows the shell with bounded sky and wide overscan」。
   `npm test` 由 60/61 变为 **61/61 通过**。
3. 主参考仓库 404 已按约定切换到上游 `phucdz2kk4/Gunny`，不构成阻塞。

## 下一步（阶段 9 及剩余工作，均未完成）

1. **原版红金色铁匠铺 UI**：先导出并查看 `Source Flash/FlashSV1/` 实际 store 模块资源与
   旧版对照 `inetpub/wwwroot/gunny/ui/vietnam/swf/store.swf`，记录与用户截图的差异，
   再实现三个强化石槽 / 幸运符槽 / 神恩符槽 / 装备栏 / 道具栏 / 成功率区域。
   禁止用背景截图覆盖交互；槽位、物品、拖放或点选、按钮必须真实可用。
2. **原版音乐与音效接入**：按 `LoadMapsItems.xml` 的 `BackMusic` 字段映射地图音乐，
   不默认「音乐编号 = 地图编号」；战前加载音乐需先找到独立调用证据再接线。
   处理用户手势解锁、循环、切换、音量、静音、资源释放。
3. **原版强化规则剩余项**：属性成长公式（`ItemStrengthenData.xml` 上游仓库缺失）、
   模板进阶、失败损毁、VIP / 公会 / 开孔 / 绑定、`StoneLevelMin` 服务端校验。
   查不到的机制保持未实现，界面明确显示 `ORIGINAL_PARTIAL` 未还原项。
4. **中文「极·」武器映射**：保持 `UNCONFIRMED`，不进入正常奖励池；
   专属持武逐帧 / 弹丸 / 爆炸素材待导入，当前复用基础武器弹道。
5. **性能与多局观测**：区分 Node RSS、浏览器 JS 堆、浏览器进程内存、
   Canvas / 图片 / 音频占用；多局连续检查资源、监听器、WebSocket、计时器是否持续增长。
6. **文档同步**：`docs/ASSET_MANIFEST.md`、`docs/AUDIO_MAPPING.md` 按本轮新证据更新；
   手机横屏控件遮挡检查。
7. 不以「业务闭环已通」代替「原版还原已完成」；逐阶段提交并推送，校验远程 SHA。

---

## 阶段 8（2026-11-28）：材料分类纠错、原版强化链路核对、映射撤回与迁移验证

本阶段按用户新增的 7 条约束执行「先核对、不重做已有成果」。所有结论均为实测或源码逐行核对，
**未确认部分明确标记**，不写成「原版已还原」。

### 8.1 材料分类（最高优先级，已完成）

| 类别 | 上游判据 | 模板 | 处理 |
| --- | --- | --- | --- |
| 强化石 | `CategoryID=11 && Property1=2` | `Đá cường hóa 1..6`（`strength1/2/3/4/9/11`） | 登记为 `strength-stone`，可用于强化 |
| 四圣兽合成石 | `CategoryID=11 && Property1=1`、`FusionType=2` | `xuanwu/qinglong/baihu/zhuque` 各 1..5（20 件） | 从错误的 `strength-stone` 改为 `compose-stone`，用途是合成加四维；**禁止当强化材料** |
| 幸运符 | `Property1=3` | `symbol1..4`（4 件） | 槽位 4 |
| 神恩符 | `Property1=7` | `symbol5`（1 件） | 槽位 3 |
| 神武石 | 上游零命中 | — | 继续保持 `unmatched`，不编造 |

逐件「模板 ID → 名称 → 类别 → 用途 → Pic → 图标路径 → 处理方法」见
`docs/RULE_EVIDENCE.md`。图标导出到 `dist/assets/items/`（共 31 件）。

### 8.2 原版强化链路（ORIGINAL_PARTIAL，非「原版已完成」）

沿「客户端提交 → `ItemStrengthenHandler.cs` → `StrengthenMgr.cs` → XML 配置 →
材料验证 → 概率/经验/进阶 → 属性更新 → 扣费 → 返回」逐项核对，证据表见 `docs/RULE_EVIDENCE.md`。

已按源码移植：三强化石槽 `GetItemAt(0/1/2)` 累加 `RateItems[Level-1]`、幸运符 C# 整数除法
`num2 += probability + (Property2/100)`（15/25/50 档为 0，100 档为 1）、神恩符失败保护、
概率公式 `num5=probability*100/Rock`、`num6=num2*100/Rock`、
`num7=floor((num5+num6+num4+num3)*100)`、`num8=RandomSafe.Next(10000)`、`num7>num8` 成功、
`GetNeedRate()` 读 `ItemStrengthenList.xml` 的 `Rock`、原版**无金币扣费**只有 `ClearBag()` 消耗槽位物品。

**未还原（保持未实现，不按截图或常识补写）**：武器属性成长公式（上游 `ItemStrengthenData.xml`
仓库中不存在，只有副手 `itemstrengthendata.xml`，调用点 `EquipBag.UpdatePlayerProperties()`）、
模板进阶、失败损毁、VIP / 公会 / 开孔 / 绑定、`StoneLevelMin` 服务端校验。

规则分离：默认 `DDT_FORGE_RULES=local` 使用 `LOCAL_RULE`；
`DDT_FORGE_RULES=original` 才启用 `ORIGINAL_PARTIAL`，其攻击成长点数明确标注
`LOCAL_RULE_SUPPLEMENT（原版属性成长未还原）`。铁匠铺顶部常驻规则摘要，
显示当前规则、来源、属性成长来源、未还原项数、武器映射状态。

### 8.3 中文「极·」武器映射撤回（UNCONFIRMED）

`TemplateAlllist.xml` 中中文「极」出现 **0 次**，`VIP-` 出现 **78 次**，
`QualityType.QUALITY_STRING` 无「极」品质档。撤回上一版把 `7006..7014` 直接命名
「极·烈火」等的推测：改称 `HIGH_QUALITY_WEAPONS`，使用上游真实名称（`VIP-Pháo` 等），
`mappingStatus='UNCONFIRMED'`，标注「中文品质映射待确认」。
`70061/70062/70064` 是 `GainEquip` 强化进阶形态，不是另一套「极」品质。
**正常奖励池 `extremeChance=0`，候选武器卡仅在 `DDT_REWARD_POOL=test` 生成 1 张**，
仅用于发放防重验证。证据表见 `docs/WEAPON_MAPPING_EVIDENCE.md`。

### 8.4 奖励盘版本化与领取防重（已完成）

- `reward_boards` 增加 `pool_version` / `rules_version`，生成时固化配置；旧盘保持 `legacy-v1`，
  **修改奖励池后旧盘不重新抽取**。
- 3×3 卡面整体洗牌，**无固定卡位必得固定奖励的隐含机制**；「前 3 张固定构成」明确标注为单机保底规则。
- 未翻开内容不返回前端。
- 极武器领取与武器实例创建在**同一事务**；`weapon_grants` 的 `UNIQUE(request_id)` 与
  `UNIQUE(battle_id, card_index)` 防重复发武器；重复请求返回同一实例。
- `claimCard()` 重放检查绑定 `board_id + card_index`，同一 `requestId` 换卡位返回 `409 request-id-reused`。

### 8.5 旧存档迁移（已完成，资产不变）

`002_item_classification.sql` 重写：移除上一版「玄武石 1:1 自动补发真强化石」的
`INSERT ... SELECT`。**只改分类，不自动兑换、不补发、不删除、不合并、不重算 `weapon_instances.attack`**。
`003_extreme_weapons.sql` 只加列 / 建表 / 补元数据，不新增玩家资产；
`rule_version` 默认 `LOCAL_RULE` 保留旧武器规则版本，避免属性再次叠加。

`tests/server/migration.test.mjs` 用 Python `sqlite3.Connection.backup()`（SQLite backup API）
在 **WAL 模式下做安全副本**，不在运行中直接复制主库文件。构造 001 时代旧库 →
启动真实服务触发 002/003 → 二次启动验证幂等。实测：

```text
旧金币=1234 新金币=1234 背包=[{"item_key":"xuanwu1","quantity":3},{"item_key":"xuanwu3","quantity":2}] 武器attack=175 幂等=true
```

金币、背包数量、武器实例、强化等级、领取记录、旧奖励盘 `cards_json`、`schema_migrations`
逐项对照见 `docs/MIGRATION_VERIFICATION.md`。

### 8.6 测试补全（可注入随机源，不靠碰概率）

`DDT_FORGE_RANDOM=always-success | always-fail | fixed:<0..1> | sequence:a,b,c`。
`tests/server/forge-rules.test.mjs` 覆盖：槽位数量与互不重复校验、幸运符 / 神恩符实际生效、
成功 / 失败 / 等级上限 / 金币不足 / 材料不足、合成石拒绝、同一 `requestId` 重复与并发、
旧存档迁移与重启恢复、装备后下一场战斗属性与 `baseWeaponId` 弹道表现。
`tests/server/e2e.test.mjs` 旧断言 `items.length===5` 更新为按 `kind` 分类断言
（6 强化石 / 20 合成石 / 4 幸运符 / 1 神恩符 = 31），**未删测试**。
`browser-e2e.mjs` 增加 `ensureForgeTestAssets()` 仅在临时测试库补足一次强化所需金币与
`strength1`，**不改正常掉落规则、不改生产代码、不触碰用户存档**；
`doStrengthen()` 补 `catch`，服务端拒绝时明确显示错误而非静默超时。

### 8.7 真实截图

`docs/screenshots/2026-11-28-settlement.png`（结算九宫格）、
`2026-11-28-forge.png`（铁匠铺顶部规则摘要 + 材料区 + 强化结果）、
`2026-11-28-room-after-reload.png`（刷新后存档保留）。归档自最新浏览器验收临时目录。

### 8.8 推送诊断纠正（按用户反馈）

此前把 403 写成「账号无权限」是**错误结论**。用户指出截图已证明 Token 缺少
`Contents: Read and write`。用户保存该权限后，用同一 Token、经环境变量 + 临时
credential.helper 注入（**Token 未写入远程 URL / 源码 / 文档 / 命令行参数 / 日志**），
`git push -u origin feat/node-server-mode` 非强制推送一次成功；
`git ls-remote` 校验远程 SHA `039b338d68303b15e30ee1ebcd4b14dbfad2cf58` 与本地 HEAD 一致。

### 8.9 阶段 8 全量验证结果（2026-11-28 实测，代码为阶段 8 工作树）

| 项目 | 结果 |
| --- | --- |
| `npm run typecheck:server` | 通过，0 错误 |
| `npm test` | **61 / 61 通过**（镜头断言已按设计更新，未删测试） |
| `npm run test:server` | **6 / 6 通过**：业务闭环 + ORIGINAL 槽位/幸运符/成功/重放/并发/下一局 + 失败降级/神恩符/上限/损毁未接线 + LOCAL_RULE 金币/材料/合成石/扣费 + 奖励池对照与领取防重 + 旧存档迁移幂等 |
| `npm run test:server:browser` | **11 项 UI 验收 + offline 回归通过**，页面无 JS 错误 |
| `npm run test:server:perf` | 通过；后端空闲 RSS **108.39 MB**（heap 12.37 MB）、战斗中 **121.88 MB**（heap 16.38 MB）、浏览器 JS 堆 **2.08 MB**、DOM 1492、监听 173、首屏 170 请求 / encoded **3.04 MB**、`dist/` **30.46 MB** |
| 凭证泄漏扫描 | 待提交文件中 GitHub PAT 与凭证助手用户名字样 **0 命中** |

### 8.10 阶段 8 明确未完成（不得写成已完成）

- 原版红金色铁匠铺 UI 与真实拖放交互 —— **未实现**，当前仍是标注的 `LOCAL_RULE` 临时界面。
- 原版强化完整规则（属性成长 / 模板进阶 / 损毁 / VIP 等）—— **未还原**，保持 `ORIGINAL_PARTIAL`。
- 原版音乐与音效 —— **未接入**（含 `BackMusic` 映射、战前加载音乐证据待查）。
- 中文「极·」武器映射 —— **UNCONFIRMED**，正常池不含候选卡，专属素材未导入。
- 手机横屏遮挡检查、多局连续资源 / 监听器 / WebSocket / 计时器增长观测 —— **未做**。
- `docs/ASSET_MANIFEST.md`、`docs/AUDIO_MAPPING.md` —— 未按本轮证据同步。

## 9. 阶段 9（2026-11-28）：原版铁匠铺 UI 与原版音频接入

### 9.1 开工前 7 条核对（不重做已有成果）

用户再次给出 7 条核对要求；逐项复核**阶段 8 已落地的实现**，确认无需重做：

| 核对项 | 复核结果 | 证据 |
| --- | --- | --- |
| 1 极武器映射 | `HIGH_QUALITY_WEAPONS` 全部 `mappingStatus: 'UNCONFIRMED'`，使用上游真实名称（如 `VIP-Pháo（中文品质映射待确认）`）；正常池 `extremeChance=0`、不含候选卡，仅 `DDT_REWARD_POOL=test` 生成 1 张 | `server-node/src/original-data.ts:208+`、`config.ts:103`、`docs/WEAPON_MAPPING_EVIDENCE.md`（逐件含模板 ID / 品质 / 基础伤害 / 四维 / `Pic` / 强化前后模板关系） |
| 2 原版强化执行链 | 默认 `LOCAL_RULE`；`DDT_FORGE_RULES=original` 才走 `ORIGINAL_PARTIAL`；三槽 / 幸运符 / 神恩符 / 概率 / 等级表逐项有源码证据，属性成长等未还原项保持未实现并在界面顶部显示 | `config.ts:126-165`、`docs/RULE_EVIDENCE.md`、`server-mode.js:374-388` |
| 3 迁移 | `002` 只把 `xuanwu1..5` 改为 `compose-stone`，**无任何 `INSERT ... SELECT` 发放语句**；`003` 加 `rule_version DEFAULT 'LOCAL_RULE'`、不重算 `attack`；迁移测试用 Python `sqlite3.Connection.backup()`（SQLite backup API，WAL 安全） | `migrations/002_*.sql:13-15`、`003_*.sql:16`、`tests/server/migration.test.mjs:29-36,208-209` |
| 4 奖励盘 | `reward_boards.pool_version / rules_version` 固化；`weapon_grants` 有 `UNIQUE(request_id)` + `UNIQUE(battle_id, card_index)`；领取与实例创建同事务，重放返回同一 `weaponInstanceId` | `003_*.sql:37,46-47`、`services.ts:596-636` |
| 5 测试 | `forge-rules.test.mjs` 4 组 + `migration.test.mjs` + `e2e.test.mjs`；可注入随机源 `always-success / always-fail / fixed: / sequence:` | `server-node/src/services.ts:53-70`、`docs/RULE_EVIDENCE.md` 第 4 节 |
| 6 阶段交付 | 阶段 8 已提交 `a639b72534559f692d3d23ad04aa095c701700b8`（57 文件）并推送，远程 SHA 一致；未写成「原版已还原」 | 本文件 8.8 / 8.9 / 8.10 |
| 7 推送归因 | `README-SERVER.md` 已明确「403 的原因是 Token 缺少 Contents 权限，**不是账号无权限**」 | `README-SERVER.md:181-184` |

**新 Token 复核**：`GET https://api.github.com/user` → `200 / login Orlandoo24`，凭证有效；
fine-grained PAT 不返回 `X-OAuth-Scopes` 头，写权限只能以实际非强制推送结果判定，
不预先归因于账号无权限。Token 仅经临时 credential helper 文件（chmod 600）传递，
未写入远程 URL / 源码 / 文档 / 命令行参数 / 日志。

### 9.2 原版铁匠铺 UI（阶段 8 的「未完成」项之一，本阶段实现）

- 资源：`/tmp/gunny-30/.../ui/vietnam/swf/store.swf`（762,769 B）经 FFDec `-export image,symbolClass`
  导出 125 个符号 / 124 张图；按符号名映射 23 张到 `dist/assets/forge/`，
  附 `SOURCE_MANIFEST.json`（字节数 + SHA-256）。
- 布局：`/tmp/gunny-30/.../xml/xml/store.xml` 的 `Strengthpoint0..5`
  （`(106,-6) (206,95) (106,195) (6,141) (6,49) (123,111)`）、
  `StrengthBtn x=72 y=322`、`StoreBagView x=405 y=59`；
  `StoreIIStrengthBG.as:137-151` 定义 0/1/2 强化石、3 神恩符、4 幸运符、5 装备。
- 实现：红金色 `strengthBG` 只作装饰底纹；6 个 `<button class="ddt-slot">` 为真实 DOM，
  支持点选放入、拖放入槽、点击移除；装备栏 / 道具栏 / 成功率区 / 强化按钮均真实可用。
  强化按钮不再叠加中文于原版越南文之上，结果特效 1.6 s 后隐藏。
- 规则透明：顶部常驻当前规则（`LOCAL_RULE` / `ORIGINAL_PARTIAL`）、属性成长来源、
  未还原项数、武器映射状态；界面明确标注「素材来自原版，规则未还原完成」。
- 逐项证据与**明确不是原版还原的部分**（越南文底图占位、购买按钮未接线、
  强化结果音未确认等）见 `docs/FORGE_UI_EVIDENCE.md`。

### 9.3 原版音乐与音效（阶段 8 的「未接入」项，本阶段接入）

- `LoadMapsItems.xml` 的 `BackMusic`：**1157 → 1071、1049 → 1032**，
  证明音乐编号不等于地图编号；`audio-scenes.js` 按字段解析，不默认相等。
- 从 `Resource/sound/*.flv` 用 FLV tag 解析**无损抽出内嵌 MP3 帧**（不重编码，
  `afinfo` 校验）得到 14 条 BGM（房间 065 / 大厅 062 / 12 张地图）；
  从 `audio.swf` 导出 `Sound014` / `Sound067`（Nellymoser）并用静态 FFmpeg 解码为倒计时音效。
  `1156.flv`（1.53 MB）在旧版对照库中存在，已补齐此前记录的缺失项。
- 运行时：场景切换淡出并 `disconnect()` 旧 source/gain，解码 buffer LRU 上限 3 条；
  手势解锁、循环、音量、静音、`releaseBgm()` 均接入；翻牌倒计时 067 起始 + 014 每秒。
- **未确认项如实保留**：原版铁匠铺**没有独立 BGM**（`BaseStoreView.as:452/466` 只
  `pauseMusic` / `resumeMusic`）；战前加载无独立音乐调用证据，沿用同一条 BGM 压低音量；
  强化结果音封装在 `StoreTips`，上游检出无该 AS 源码，SoundID 未确认。
  见 `docs/AUDIO_EVIDENCE.md`。

### 9.4 文档与资源同步

- 新建 `docs/AUDIO_EVIDENCE.md`（118 行）、`docs/FORGE_UI_EVIDENCE.md`（107 行）。
- 更新 `docs/AUDIO_MAPPING.md`（修正过时的「固定 1001 BGM」描述并补阶段 9 章节），
  同步 `dist/docs/AUDIO_MAPPING.md`；更新 `docs/ASSET_MANIFEST.md` 第 7–9 节。
- `SOURCE_MANIFEST.sha256` 从 261 条更新到 **307 条**（新增 14 BGM + 2 音效 +
  24 forge 资源 + 新 js / 文档），`shasum -a 256 -c` 全部 OK。
- 真实截图：`docs/screenshots/2026-11-28-stage9-{forge,settlement,room-after-reload}.png`
  （铁匠铺截图在结果特效消失后拍摄，6 槽完整可见）。
- `tests/server/browser-e2e.mjs` 新增 2 项断言：拖放入槽 + 点击移除、
  BGM/倒计时音效资源实际可达（HTTP Range 请求）。
- **修复既有 e2e 偶发失败（未删测试）**：`tests/server/e2e.test.mjs` 原固定翻
  0/1/2 卡位，但服务端 9 张卡整体洗牌（无固定卡位），有概率三张皆非材料卡，
  导致「原版强化石已入库」偶发失败。改为**白盒测试夹具**：从隔离临时库读
  `cards_json`，挑「≥1 张材料卡 + ≥1 张金币卡」的 3 个卡位，并把宽松的 `>=`
  断言升级为「金币 / 材料**严格等于**已翻卡面之和」+「夹具须足够一次强化」。
  不改正常掉落规则与奖励池配置、不经过前端下发未翻卡内容、不删任何原有断言。

### 9.5 阶段 9 全量验证（2026-11-28 实测）

| 项目 | 结果 |
| --- | --- |
| `npm run typecheck:server` | 通过，0 错误 |
| `npm test` | **61 / 61 通过** |
| `npm run test:server` | **6 / 6 通过**；迁移测试实测 `旧金币=1234 新金币=1234 背包=[xuanwu1:3, xuanwu3:2] 武器attack=175 幂等=true` |
| `npm run test:server:browser` | **15 项全通过**（新增拖放与音频资源可达），页面无 JS 错误；offline 静态托管回退通过 |
| `npm run test:server:perf` | 通过；Node 空闲 RSS **108.55 MB**（heap 12.42 MB）、战斗中 **96.91 MB**（heap 16.91 MB）；浏览器 JS 堆 **2.05 MB**、DOM 1523、监听 177、首屏 177 请求 / encoded **3.14 MB**；`dist/` **41.13 MB**（较阶段 8 增加约 10.7 MB，为新增原版音频与铁匠铺素材） |
| 凭证泄漏扫描 | 待提交文件中 GitHub PAT 与凭证助手用户名字样 **0 命中** |

### 9.6 推送状态

阶段 9 提交后使用用户提供的新 Token 经临时 credential helper
**非强制推送开发分支一次**，`git ls-remote` 校验远程 SHA 与本地 HEAD；
实际结果按成功 / 具体报错如实记录，不重复空转，不自动合并 `main`。

### 9.7 阶段 9 之后仍未完成（不得写成「原版已还原」）

- 原版强化完整规则：属性成长公式、模板进阶、失败损毁、VIP / 公会 / 开孔 / 绑定、
  `StoneLevelMin` 服务端校验 —— 仍未还原，保持 `ORIGINAL_PARTIAL`。
- 中文「极·」武器映射 —— 仍 `UNCONFIRMED`，正常奖励池不发放；专属逐帧 / 弹丸素材未导入。
- 铁匠铺购买按钮（幸运符 / 神恩符 / 强化石 / 礼包）与商城、公会系统 —— 未接线。
- 强化成功 / 失败原版音效 SoundID —— 未确认（`StoreTips` 源码缺失）。
- 手机横屏控件遮挡检查、多局连续资源 / 事件监听 / WebSocket / 计时器增长观测 —— 未实测。
- `art-source/` 已导出的 `lightFrame` / `starMc` / `VersusAnimation` / `GameMode_*` 逐帧序列 —— 未接入。
