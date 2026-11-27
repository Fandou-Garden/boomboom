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

## 当前任务

前端统一数据访问接口（offline / server）与房间、铁匠铺、翻牌界面接入；随后端到端验证完整闭环。

## 阶段 1 实测结果（非估算）

- `npx tsc --noEmit -p server-node/tsconfig.json`：通过（0 错误）。
- 启动 `npm run start:server`：监听 `http://127.0.0.1:8100/`，数据库
  `data/ddt.sqlite`（WAL、外键开启），日志输出正常。
- `GET /healthz` → `{"ok":true,"mode":"server","battleState":"idle","battleId":null}`。
- `GET /api/state` → `phase=idle`、2 个 actors、13 个 weapons（满足 index.html 后端探测契约）。
- `GET /api/server/room` → 地图 12 张、武器 13 把、装备 `水果篮` level 0 attack 100、
  材料 5 种、金币 0、机器人 `42°/1180/0.35`、无待领奖励盘。
- `GET /api/server/forge` → 13 把武器，0 级强化消耗 120 金币 / 1 材料单位 / 成功率 1（首级保底）、
  强化后 attack 125，规则来源标记 `LOCAL_RULE`。
- 静态资源：`/` 200、原版物品图标 200、`data/1156.fore.map` 200。
- 首次启动曾因迁移表查询顺序报错（空库时 `schema_migrations` 尚不存在），已修复并重启验证通过。

## 阻塞

- **【权限失败，待用户处理】推送开发分支失败（2026-11-28 实测）**。
  - 本地提交 `d363a3e` 已生成；`git push -u origin feat/node-server-mode` 返回
    `remote: Invalid username or token. Password authentication is not supported for Git operations.`
  - 诊断：`credential.helper=store`，`~/.git-credentials` 内含一条 40 字符 `ghp_` 前缀 classic PAT
    （另有 gitlab 条目）；`gh auth status` 亦报告 `The token in default is invalid.`；
    SSH `git@github.com:22` 连接超时（网络侧阻断，非密钥问题）。匿名 HTTPS **读取**正常，
    仅写操作认证失败。
  - 判定：现有 GitHub 凭证已失效或被撤销，属准则第 8 条的「权限失败」真实阻塞。
  - 处理：不打印/记录/提交任何 Token，不猜测或替换凭证，不做强制推送。
    按准则第 9 条**保存现场并继续其他独立任务**：本地持续提交，代码全部完成后再尝试一次推送；
    若仍失败，在最终交付中列出准确原因与需要用户执行的动作（提供有效 PAT 或改用可用认证方式）。
- 主参考仓库 404 已按约定切换到上游 `phucdz2kk4/Gunny`，不构成阻塞。

## 下一步（顺序）

1. 服务端运行入口 + SQLite 迁移 + 固定本地玩家。
2. 房间、地图与武器选择 API + 前端 offline/server 统一适配接口。
3. 服务端权威战斗 + 固定弱机器人 + 胜负结算。
4. 九宫格翻牌 + 金币/强化石入库（事务、唯一约束、requestId）。
5. 房间内铁匠铺 + 武器强化（单事务、版本防并发）。
6. 强化属性进入下一场战斗。
7. 原版素材/音效回填、重启/刷新/重复请求验证、文档与交付。
8. 每个可运行阶段提交并推送开发分支。

## 验证结果

- 尚未开始实现，暂无实现侧验证结果。
- 基线基线验证：`git status --short --branch` 显示 `## main...origin/main` 干净；
  `git log -1` = `cbfe149 v33: 修正玄武石图标`。
