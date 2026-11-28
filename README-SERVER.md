# DDT 本地服务端版（Mac 原生运行）

在**保留现有网页前端**的前提下，新增一个 Mac 本机运行的完整后端：
Node.js + TypeScript + SQLite（WAL）+ HTTP API + WebSocket。
站点版（纯静态 / Go 服务端）保持不变，两种模式共用同一份 `dist/` 前端。

> 原版 Gunny 客户端是 ActionScript/Flash，**不能直接当作 JS 前端加载**；
> 它的代码与素材只用于核对、提取和移植，见 `docs/ASSET_MANIFEST.md`。

## 1. 环境要求（实测环境）

- macOS（实测 `darwin/arm64`）、Node.js **≥ 22.5**（使用内置 `node:sqlite`）、npm
- Chrome 仅在运行浏览器验收 / 性能脚本时需要（可用 `CHROME_PATH` 指定）
- 不需要 Windows、IIS、SQL Server、Docker、Go 虚拟机（Go 只用于原有站点版）

## 2. 启动（在仓库根目录执行）

```bash
cd /Users/123jiaru/Desktop/project/game/boomboom
npm install
npm run start:server
# 打开 http://127.0.0.1:8100/
```

其它命令：

| 命令 | 作用 |
| --- | --- |
| `npm run start:server` | 服务端版，默认 `127.0.0.1:8100`，提供 API / WebSocket / 静态前端 |
| `npm run dev:server` | 同上但 `DDT_DEBUG=1` + 文件监听（仅开发/自动化测试用，会开放调试命令） |
| `npm run typecheck:server` | 服务端 TypeScript 类型检查 |
| `npm run test:server` | 服务端完整业务闭环 + 事务防重 + 重启存档（自动起隔离实例） |
| `npm run test:server:browser` | 浏览器 UI 全流程 + 站点版 offline 回归 |
| `npm run test:server:perf` | 后端 RSS / 浏览器内存 / 资源体积实测 |
| `npm start` | **原有** Go 站点版服务端（8000），未改动 |
| `npm run serve:dist` | **原有** 纯静态站点版（8077），此时前端自动回退 offline 模式 |

配置：复制 `.env.example` 为 `.env` 后按需修改（`.env` 已被 gitignore，不提交任何凭证）。
`DDT_MODE=server` 开启服务端 API；`?mode=offline` 可在同一页面强制回退到站点版数据实现。
服务默认**只监听 127.0.0.1**。

## 3. 完整闭环操作

1. 打开 `http://127.0.0.1:8100/` → **个人房间**（12 张地图、13 把武器、金币/材料、弱机器人摘要）。
2. 点击地图缩略图 → 服务端保存选择并整页重载，按需加载该地图资源（其余地图只加载缩略图）。
3. 点击武器 → 服务端切换装备；点击「铁匠铺」可直接打开再关闭，回到同一个房间。
4. 点击「开始战斗」→ 服务端冻结本局武器属性、创建独立种子战斗记录，前端沿用原版 Canvas 战斗界面。
5. 与固定规则弱机器人打完一局 → 服务端判定胜负并创建奖励盘。
6. 结算九宫格（原版 `gameover.swf` 卡背）最多翻 3 张；奖励**逐张由服务端事务写入 SQLite**。
7. 「返回房间」→ 未翻完的奖励盘保留，房间显示「继续翻牌」入口；刷新页面、重启后端都可继续。
8. 房间打开铁匠铺 → 选武器与材料 → 确认强化 → 单事务扣金币/材料、更新等级与攻击。
9. 再开一局：服务端使用**强化后的攻击属性**（`actor.attack` 进入原版 MakeDamage 公式）。

## 4. 数据库与备份恢复

- 默认位置：`data/ddt.sqlite`（相对仓库根目录），WAL 模式、外键开启、同步 NORMAL。
- 可用 `DDT_DATA_DIR` / `DDT_DB_PATH` 改到任意目录；`data/`、`*.sqlite*`、`.env` 均在 `.gitignore` 中，
  **更新代码不会覆盖存档**。
- 主要表：`players`、`item_catalog`、`inventory`、`weapon_instances`、`rooms`、`battles`、
  `reward_boards`、`reward_picks`、`forge_operations`、`unmatched_items`、`schema_migrations`。
- 备份（建议先停服务，WAL 会被 checkpoint 到主库）：

```bash
sqlite3 data/ddt.sqlite ".backup data/ddt-backup.sqlite"
# 或不停服务时的文件系统快照（必须同时带上 -wal / -shm）：
cp data/ddt.sqlite data/ddt.sqlite-wal data/ddt.sqlite-shm /你的备份目录/
```

- 恢复：停服务 → 把备份复制回 `data/ddt.sqlite`（若有 `-wal`/`-shm` 一并放回）→ 重新启动。
- 端口、数据库路径、调试开关均在 `.env.example` 中列出。

## 5. 代码组织

```
dist/                    站点版前端（同一份文件，不复制第二套）
  js/data-api.js         统一数据访问接口：offline / server
  js/server-mode.js       个人房间、铁匠铺、服务端翻牌接入
  js/main.js              既有前端（只加了少量模式分支与钩子）
  assets/items/           本轮移植的原版玄武石 1~5 级图标
server-node/
  src/index.ts            入口：HTTP + WebSocket + 静态托管
  src/config.ts           全部服务端规则与环境变量
  src/db.ts               SQLite 连接、迁移、事务
  src/engine-loader.ts    复用 dist/js/engine（不复制物理）
  src/battle/             引擎宿主（属性冻结 + 弱机器人）、会话（40ms tick / SSE / 结算）
  src/services.ts         玩家、房间、奖励盘、铁匠铺业务
  src/api.ts              既有 /api 契约 + /api/server/* 接口
  src/ws.ts               WebSocket 低频事件广播
  migrations/001_init.sql
data/ddt.sqlite           存档（gitignore）
docs/PROGRESS.md          开发进度与阻塞记录
docs/ASSET_MANIFEST.md    原版代码与素材对应清单
```

### 接口

- 既有契约：`GET /api/state`、`GET /api/events`(SSE)、`POST /api/command`（前端 `RemoteMatch` 无需改动）
- 服务端模式：`/api/server/config`、`/room`、`/room/map`、`/room/weapon`、`/room/start`、
  `/room/leave`、`/player`、`/battles/:id/rewards`、`/battles/:id/rewards/claim`、
  `/forge`、`/forge/strengthen`、`/healthz`
- WebSocket：`ws://127.0.0.1:8100/ws`，只广播房间 / 钱包 / 奖励盘 / 战斗开始结束等低频事件；
  战斗状态帧走 SSE，不在每个消息里传整张地图。

### 权威与防重

- 前端只能提交移动方向、角度、力度、技能等操作意图；命令白名单拒绝 `restart` 与
  `damage / reward / coins / winner / level / attack / success` 等结果字段。
- 翻牌：`UNIQUE(request_id)` 防重放、`UNIQUE(board_id, card_index)` 防重复领，
  同一请求重试返回**完全相同的已存结果**；未翻卡不下发奖励内容。
- 强化：单事务完成「归属 → 版本/上限 → 金币材料 → 结果 → 扣费扣料 → `version` 条件更新 → 操作记录」，
  `requestId` 防重放、装备版本防并发重复消费。
- 战斗开始冻结本局属性；多发/散射结算完毕才切回合；单局独立随机种子。

## 6. 规则来源（不冒称原版）

| 规则 | 来源 | 说明 |
| --- | --- | --- |
| 弹道、重力、风力、挖坑、伤害、回合、胜负 | **原版移植** | 复用 `dist/js/engine/`（Go `server/game` 逐字段移植），`tests/engine/parity.test.mjs` 为 Go 金标准，本轮未重写物理 |
| 翻牌卡背 / 卡面 / 翻牌动画 / 加载素材 / 地图 / 音效 | **原版导出** | 见 `docs/ASSET_MANIFEST.md` |
| 玄武石 / 青龙石 / 白虎石 / 朱雀石 1~5 级 | **原版配置** | `CategoryID=11 Property1=1`，用途是**四圣兽合成石**（合成加四维），**不是强化材料**；阶段 8 已纠正分类并登记真强化石 `Đá cường hóa 1..6`（`Property1=2`）。见 `docs/RULE_EVIDENCE.md` |
| 3×3 每场翻 3 张、奖励数量与概率 | `LOCAL_RULE` | 单机可配置规则，**不代表原版所有模式默认值** |
| 固定弱机器人角度/力度/攻击倍率 | `LOCAL_RULE` | 服务端固定规则，无必中、无额外伤害、不接大模型 |
| 铁匠铺成功率、消耗、等级收益 | `LOCAL_RULE` / `ORIGINAL_PARTIAL` | 默认 `LOCAL_RULE`；`DDT_FORGE_RULES=original` 才启用已核对的原版核心链路（仍为 `ORIGINAL_PARTIAL`）。原版属性成长、模板进阶、损毁、VIP/公会未还原，界面顶部常驻显示当前规则与未还原项，**不与原版规则混用** |
| 「神武石」 | `unmatched` | 上游 7642 个物品条目中无「神武」/「Thần Vũ」；未编造 ID，未用玄武石冒充 |

## 7. 测试结果（2026-11-28 阶段 9 实测，非估算）

| 测试 | 结果 |
| --- | --- |
| `npm run typecheck:server` | 通过，0 错误 |
| `npm run test:server` | **6 / 6 通过**：业务闭环（房间 / 选图 / 选武器 / 冻结属性 / 弱机器人 / 胜负 / 翻牌防重 / 强化事务 / 下一局属性 / 重启存档 / WebSocket）＋ ORIGINAL 槽位·幸运符·成功·重放·并发·下一局 ＋ 失败降级·神恩符·上限·损毁未接线 ＋ LOCAL_RULE 金币/材料/合成石/扣费 ＋ 奖励池对照与领取防重 ＋ 旧存档迁移幂等。修复随机卡位后**连续 3 次均 6/6** |
| `npm run test:server:browser` | **15 项全通过**（含 6 个原版槽位、点选放入、拖放入槽与移除、`BackMusic` 映射、音频资源可达、强化成功、刷新恢复）＋ 站点版 offline 回归，页面无 JS 错误 |
| `npm run test:server:perf` | 通过，数据见下节 |
| `npm test` | **61 / 61 通过**（镜头断言按 v33 shot 设计更新，**未删测试**） |
| `npm run test:engine` | 通过（既有 JS 引擎测试） |

测试脚本均使用独立端口与 `/tmp` 临时数据库，**不读写用户存档**。
迁移测试用 Python `sqlite3.Connection.backup()`（SQLite backup API，WAL 安全）。

### 实测资源占用

环境：macOS arm64，Node `v22.22.2`，Chrome headless，1366×768（阶段 9 实测）。

| 指标 | 实测值 |
| --- | --- |
| **Node 进程 RSS**（房间空闲） | **108.55 MB**（heapUsed 12.42 MB，external 7.95 MB） |
| **Node 进程 RSS**（战斗进行中，40 ms tick + SSE） | **96.91 MB**（heapUsed 16.91 MB） |
| **浏览器 JS 堆**（房间加载完成） | **2.05 MB**，DOM 节点 1523，事件监听 177 |
| 首屏资源 | 177 个请求，encoded **3.14 MB** / transfer **3.16 MB** |
| `dist/` 静态资源总体积 | **41.13 MB**（assets 37.74 MB、地图碰撞数据 2.76 MB、JS 0.46 MB） |
| 单文件 | `index.html` 23.4 KB、`styles.css` 82.1 KB |

上表区分了 **Node 进程 RSS**、**浏览器 JS 堆**、**首屏传输体积**与**静态资源总体积**，
四者不是同一指标；浏览器进程总内存、Canvas / 解码图片 / 音频 buffer 占用**尚未单独测量**。
`dist/` 较阶段 8 的 30.46 MB 增加约 10.7 MB，来自本阶段新增的 14 条原版 BGM、
2 条倒计时音效与 23 张铁匠铺素材。历史版本（04:01 / 10:xx）的实测数值有正常波动，
以本表为当前版本结果。

## 8. 已知缺失 / 剩余问题

1. **原版铁匠铺 UI 已导出并接入，但强化音效仍未确认**：阶段 9 已从
   `store.swf` 导出 23 张素材，按 `store.xml` 的 6 个点位实现真实 DOM 槽位
   （点选 / 拖放 / 移除）、装备栏、道具栏与成功率区；结果特效为短暂反馈。
   强化成功/失败音封装在原版 `StoreTips`，上游检出未提供该 AS 源码，
   **未确认 SoundID**，暂用站点版既有 `win` / `lose`，不冒称原版音效。
   界面素材是原版，**强化规则仍未还原完成**（见第 2 条）。
2. **原版强化规则只完成核心链路（`ORIGINAL_PARTIAL`），未完整还原**：
   属性成长公式未找到，模板进阶 / 失败损毁 / VIP / 公会 / 开孔 / 绑定 / `StoneLevelMin` 服务端校验未接线。
   逐项证据见 `docs/RULE_EVIDENCE.md`。默认仍为 `LOCAL_RULE`，**不报告「原版强化完成」**。
3. **「神武石」未匹配**：上游物品表中不存在；已登记 `unmatched`，未编造物品 ID。
4. **中文「极·」武器映射 `UNCONFIRMED`**：上游无中文「极」命名，无法证明 `VIP-` 模板对应中文极武器；
   候选武器使用上游真实名称，**不在正常奖励池**。见 `docs/WEAPON_MAPPING_EVIDENCE.md`。
5. **原版长音乐 / 倒计时音效已接入，仍有未确认项**：房间 065、大厅 062、
   12 张地图按 `LoadMapsItems.xml` 的 `BackMusic`（1157→1071、1049→1032）、
   014 / 067 倒计时音已从原版 FLV / `audio.swf` 导出并接线；手势解锁、循环、
   场景切换、音量、静音、buffer LRU 释放已实现。
   原版**没有铁匠铺独立 BGM**（只 `pauseMusic` / `resumeMusic`）；
   战前加载**无独立音乐调用证据**，不配乐；强化结果 SoundID 仍未确认。
   逐项见 `docs/AUDIO_EVIDENCE.md`。
6. **既有文档/代码不一致**（非本轮引入）：Go `server/game/config.go` 体力 100/0，
   JS 引擎 2000/60；部分资源 URL 仍是 `?v=15` 与 `?v=33` 混用。
7. 未实现商城、公会、聊天、充值、多人匹配、完整副本系统（本轮明确不在范围内）。
8. 部分 `art-source/` 已导出的逐帧序列（`lightFrame`、`starMc`、`VersusAnimation`、
   `GameMode_*`）尚未接入 `dist/`；房间 / 大厅 / 地图 BGM 已不再属于本条（见第 5 条）。
9. 手机横屏控件遮挡检查、多局连续资源/监听器/WebSocket/计时器增长观测：尚未完成实测。

## 9. 开发分支与推送状态

- 开发分支：`feat/node-server-mode`（基于 `main` @ `cbfe149`）。
- **推送已于 2026-11-28 10:43 成功**：用户提供配置了 `Contents: Read and write` 的
  fine-grained PAT 后，用环境变量注入凭证、`git push -u origin feat/node-server-mode` 非强制推送一次成功；
  `git ls-remote` 校验远程分支 SHA 与本地 HEAD 一致（`039b338d68303b15e30ee1ebcd4b14dbfad2cf58`）。
  此前 403 的原因是 Token 缺少 Contents 权限，**不是账号无权限**（权限保存后同一凭证即可推送）。
  Token 未写入远程 URL、源码、文档、命令行参数或日志，仅经环境变量传递。
- **阶段 8 提交已推送**：`a639b72534559f692d3d23ad04aa095c701700b8`（57 个文件），
  用同一凭证非强制推送成功，`git ls-remote` 校验远程 SHA 与本地 HEAD 一致；
  `main` 保持 `cbfe149` **未合并**。
- **2026-11-28 用户提供的新 Token 复核**：`GET https://api.github.com/user` 返回
  `200 / login Orlandoo24`，凭证本身有效；fine-grained PAT 不返回 `X-OAuth-Scopes`，
  写权限只能以**实际非强制推送结果**判定，不预先归因于账号无权限。
  阶段 9 的推送结果见第 11 节。
- 该 Token 为 7 天有效期（约 2026-12-05 过期），过期后需重新配置。

## 10. 阶段 8 更新（2026-11-28，本轮核对与纠错）

| 项 | 内容 |
| --- | --- |
| 材料分类纠错 | 玄武石（四圣兽合成石 `Property1=1`）不再作为强化材料；真强化石为 `Đá cường hóa 1..6`（`Property1=2`，11019/11021/11022/11023/11024/11025）。见 `docs/RULE_EVIDENCE.md` |
| 版本化迁移 | `002_item_classification.sql` / `003_extreme_weapons.sql`：只改分类、不自动兑换/补发/删除、保留玩家资产；备份用 SQLite backup API。见 `docs/MIGRATION_VERIFICATION.md` |
| 规则分离 | `DDT_FORGE_RULES=local`（默认 `LOCAL_RULE`）与 `=original`（`ORIGINAL_PARTIAL`）；界面顶部显示当前规则、属性成长来源与未还原项 |
| 奖励盘 | 正常池不含未确认映射的武器候选卡；仅 `DDT_REWARD_POOL=test` 生成 1 张用于发放防重验证；9 张随机洗牌无固定卡位；旧盘按 `pool_version` 保留不重抽 |
| 可注入随机源 | `DDT_FORGE_RANDOM=always-success\|always-fail\|fixed:<n>\|sequence:a,b,c`，仅测试用 |
| 镜头断言 | 核实 v33 shot 模式 `allowWide` 设计后更新过时断言（未删测试），`npm test` 61/61 |

新增测试：`tests/server/forge-rules.test.mjs`、`tests/server/migration.test.mjs`、
`tests/server/build-cards.ts`（测试辅助）。真实截图：`docs/screenshots/2026-11-28-*.png`。

## 11. 阶段 9 更新（2026-11-28，原版铁匠铺 UI 与原版音频）

| 项 | 内容 |
| --- | --- |
| 铁匠铺 UI | `store.swf` 导出 23 张素材 → `dist/assets/forge/`；按 `store.xml` 的 6 个 `Strengthpoint` 实现真实 DOM 槽位（点选 / 拖放 / 移除）、装备栏、道具栏、成功率区、原版强化按钮。**素材是原版，规则仍未还原** |
| 地图音乐 | `dist/js/audio-scenes.js` 按 `LoadMapsItems.xml` 的 `BackMusic` 解析（1157→1071、1049→1032），不默认等于地图编号 |
| BGM | 14 条原版长音乐从 `Resource/sound/*.flv` **无损抽出 MP3 帧**；房间 065 / 大厅 062 / 12 张地图；`1156.flv` 补齐 |
| 短音效 | `audio.swf` 的 `Sound067`（倒计时起始）/ `Sound014`（每秒滴答）解码接入 |
| 音频运行时 | 场景切换淡出并释放 source/gain、buffer LRU 上限 3、手势解锁、循环、音量、静音、`releaseBgm()`；进/出铁匠铺 `pauseBgm()` / `resumeBgm()` |
| 未确认项 | 铁匠铺**无独立 BGM**（原版只暂停/恢复全局 BGM）；战前加载**无独立音乐调用证据**；强化结果音在 `StoreTips`，源码缺失、SoundID 未确认 |
| 证据文档 | `docs/AUDIO_EVIDENCE.md`、`docs/FORGE_UI_EVIDENCE.md`；`docs/AUDIO_MAPPING.md` / `docs/ASSET_MANIFEST.md` 已同步，`SOURCE_MANIFEST.sha256` 更新至 307 条并全量校验通过 |
| 截图 | `docs/screenshots/2026-11-28-stage9-{forge,settlement,room-after-reload}.png` |
| 测试 | `typecheck` 0 错误、`npm test` 61/61、`test:server` 6/6、浏览器 **15 项**、性能通过；浏览器验收新增拖放入槽与音频资源可达断言 |

**交付结论**：本阶段完成的是「原版铁匠铺界面素材 + 原版音频资源接入」，
**不是**「原版还原已完成」。规则、极武器映射、专属素材、商城/公会、多局资源观测等
剩余项见第 8 节与 `docs/PROGRESS.md` 9.7。
