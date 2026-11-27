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

## 当前任务

按 `源码实现路径.md` 第十一节的开发顺序，下一步：搭建 Node + TypeScript + SQLite 服务端骨架
（入口、迁移、固定本地玩家、HTTP/WebSocket、静态托管、配置与 `.env.example`）。

## 阻塞

- 无真实阻塞。主参考仓库 404 已按约定切换到上游，不影响业务闭环开发。

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
