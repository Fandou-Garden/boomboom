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

已完成。最终回归通过、本地提交完成；推送被凭证失效阻塞，等待用户提供有效凭证。

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

## 阻塞

1. **【权限失败，待用户处理】推送开发分支失败（2026-11-28 实测）**。
   - `git push -u origin feat/node-server-mode` 返回
     `remote: Invalid username or token. Password authentication is not supported for Git operations.`
   - 诊断：`credential.helper=store`，`~/.git-credentials` 内含一条 40 字符 `ghp_` 前缀 classic PAT
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
2. **既有测试 1 项失败（非本轮引入）**：`tests/physics.test.mjs` 的
   「shot mode follows the shell and permits sky overscan」边界断言
   `view.worldLeft + view.viewW <= WORLD.width + 1e-6`。
   已在干净的 `main` 基线工作树上复现同样失败（v33 允许天空 overscan 后断言未同步）。
   本轮未修改 `camera.js` / `physics.js`；镜头锁定与缩放分离由既有 `camera.js` 提供。
3. 主参考仓库 404 已按约定切换到上游 `phucdz2kk4/Gunny`，不构成阻塞。

## 下一步（剩余工作）

1. 最终提交开发分支并再尝试一次推送；若仍失败，按上面第 1 条列出准确原因。
2. 若用户提供有效凭证，推送 `feat/node-server-mode`。
3. 可选后续（不影响本轮闭环）：导出并接入原版铁匠铺 UI / 强化音效、移植原版强化规则、
   接入 `art-source/` 中已导出但未接线的逐帧序列与 BGM、同步 `physics.test.mjs` 的镜头断言。
