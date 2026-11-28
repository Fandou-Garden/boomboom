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
8. 房间打开铁匠铺 → 选武器（5 号槽）与 **1 颗真强化石**（0 号槽）→ 确认强化：
   成功率 100%、等级 +1、金币 `100 × 目标等级`、基础伤害 = 未强化值 ×(1+0.10×等级)；
   单事务扣金币/材料并更新武器，背包与装备展示立即刷新。1/2/3/4 号槽按当前单机规则置灰。
9. 再开一局：服务端使用**强化后的精确基础伤害**（`+1` = 未强化值 110%，
   `actor.attack` 进入原版 MakeDamage 公式）；**当前进行中的战斗不受影响**。

## 4. 数据库与备份恢复

- 默认位置：`data/ddt.sqlite`（相对仓库根目录），WAL 模式、外键开启、同步 NORMAL。
- 可用 `DDT_DATA_DIR` / `DDT_DB_PATH` 改到任意目录；`data/`、`*.sqlite*`、`.env` 均在 `.gitignore` 中，
  **更新代码不会覆盖存档**。
- 主要表：`players`、`item_catalog`、`inventory`、`weapon_instances`、`rooms`、`battles`、
  `reward_boards`、`reward_picks`、`forge_operations`、`weapon_grants`、
  `legacy_weapon_backup`（004 逐件备份旧武器）、`unmatched_items`、`schema_migrations`。
- **备份推荐 SQLite backup API（WAL 安全）**；不要在服务运行中只 `cp` 主库文件，
  那会丢失 WAL 里尚未 checkpoint 的事务：

```bash
python3 - <<'PY'
import sqlite3, datetime, os
os.makedirs('data/backups', exist_ok=True)
src, dst = 'data/ddt.sqlite', 'data/backups/ddt-' + datetime.date.today().isoformat() + '.sqlite'
s = sqlite3.connect(src); d = sqlite3.connect(dst)
s.backup(d); d.close(); s.close()
print(dst)
PY
```

- 恢复：停服务 → 用备份覆盖 `data/ddt.sqlite` → 删除残留 `-wal`/`-shm` → 重新启动。
- 004 迁移在库内自动建立 `legacy_weapon_backup`，逐件保留旧武器的等级/攻击/规则版本与
  推导基础值；验证报告见 `docs/MIGRATION_VERIFICATION.md`。
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
| 3×3 每场翻 3 张、奖励数量与概率 | `SINGLE_PLAYER_RULE` | 单机可配置规则，**不代表原版所有模式默认值**；9 张整体洗牌无固定卡位；正常池武器卡为单机自定义掉率，测试池强制 2 金币 + 1 强化石 + 1 武器 |
| 固定弱机器人角度/力度/攻击倍率 | `LOCAL_RULE` | 服务端固定规则，无必中、无额外伤害、不接大模型 |
| 铁匠铺成功率、消耗、等级收益 | **`SIMPLE_LOCAL_V1`（原版素材 + 单机自定义强化规则）** | 用户已授权简化，**不是原版强化算法**：+0 起 / 上限 +12、每次 1 颗真强化石 + `100×目标等级` 金币、成功率 100%、等级 +1、不降级不损毁；基础伤害 = 未强化基础值 ×(1+0.10×等级)。原版链路研究证据存档于 `docs/RULE_EVIDENCE.md`，**不参与运行时，也不再列为阻塞项** |
| 「神武石」 | `unmatched` | 上游 7642 个物品条目中无「神武」/「Thần Vũ」；未编造 ID，未用玄武石冒充 |

## 7. 测试结果（2026-11-28 阶段 10 实测，非估算）

| 测试 | 结果 |
| --- | --- |
| `npm run typecheck:server` | 通过，0 错误 |
| `npm run test:server` | **7 / 7 通过**：业务闭环（房间 / 选图 / 选武器 / 冻结属性 / 弱机器人 / 胜负 / 翻牌防重 / 强化事务 / 下一局属性 / 重启存档 / WebSocket）＋ `SIMPLE_LOCAL_V1` 公式与消耗 ＋ 金币/材料/合成石/上限/结果字段拦截 ＋ 幂等与并发 ＋ +0→+12 全程 ＋ 正常池无固定卡位/旧盘不重抽/武器实例防重/可装备可强化 ＋ 004 迁移幂等 |
| `npm run test:server:browser` | **19 项全通过**：翻牌真实拿到金币 + 真强化石、6 槽启用/禁用、拖放与禁用槽拒绝、成功率 100%、完整预览、强化成功 +1/110、下一局 110、重复提交不重复扣费、三类不足提示、刷新保留、BGM 映射与音频资源可达、offline 回归，页面无 JS 错误 |
| `npm run test:server:perf` | 通过，数据见下节 |
| `npm test` | **61 / 61 通过**（镜头断言按 v33 shot 设计更新，**未删测试**） |
| `npm run test:engine` | 通过（既有 JS 引擎测试） |

测试脚本均使用独立端口与 `/tmp` 临时数据库，**不读写用户存档**。
迁移测试用 Python `sqlite3.Connection.backup()`（SQLite backup API，WAL 安全）。
强化规则成功率恒为 100%，测试改为精确断言（不再用可注入随机源碰概率）。

### 实测资源占用

环境：macOS arm64，Node `v22.22.2`，Chrome headless，1366×768（阶段 10 实测）。

| 指标 | 实测值 |
| --- | --- |
| **Node 进程 RSS**（房间空闲） | **109.14 MB**（heapUsed 12.31 MB，external 7.95 MB） |
| **Node 进程 RSS**（战斗进行中，40 ms tick + SSE） | **121.53 MB**（heapUsed 16.65 MB） |
| **浏览器 JS 堆**（房间加载完成） | **2.07 MB**，DOM 节点 1525，事件监听 177 |
| 首屏资源 | 177 个请求，encoded **3.14 MB** / transfer **3.16 MB** |
| `dist/` 静态资源总体积 | **41.13 MB**（assets 37.74 MB、地图碰撞数据 2.76 MB、JS 0.46 MB） |
| 单文件 | `index.html` 23.4 KB、`styles.css` 83.2 KB |

同日收尾复测：Node 空闲 RSS **107.97 MB**（heap 12.37 MB）、战斗中 **95.56 MB**（heap 16.94 MB）；
浏览器 JS 堆 **2.05 MB** / DOM 1506 / 监听 177，`dist/` **41.14 MB**。
Node RSS 在两次采样间受 GC 与采样时机影响（空闲值甚至可能高于战斗中值），
故保留两次原始实测而不取最优值；报告由 `npm run test:server:perf` 生成。

上表区分了 **Node 进程 RSS**、**浏览器 JS 堆**、**首屏传输体积**与**静态资源总体积**，
四者不是同一指标；浏览器进程总内存、Canvas / 解码图片 / 音频 buffer 占用**尚未单独测量**。
`dist/` 较阶段 8 的 30.46 MB 增加约 10.7 MB，来自阶段 9 新增的 14 条原版 BGM、
2 条倒计时音效与 23 张铁匠铺素材；阶段 10 只改代码与样式，未新增大体积素材。
历史版本（04:01 / 10:xx / 阶段 9）的实测数值有正常波动，以本表为当前版本结果。

## 8. 已知缺失 / 剩余问题（阶段 10 复核）

> 用户已授权简化强化算法，**「原版强化完整规则缺失」不再列为交付阻塞项**。
> 当前交付统一标注「原版素材 + 单机自定义强化规则」，不称为原版强化算法。

1. **原版强化结果音效未确认**：阶段 9 已从 `store.swf` 导出 23 张素材，按 `store.xml` 的
   6 个点位实现真实 DOM 槽位（点选 / 拖放 / 移除）、装备栏、道具栏与成功率区；
   阶段 10 按单机规则只启用 0 号强化石槽与 5 号装备槽，其余置灰并说明原因。
   强化成功/失败音封装在原版 `StoreTips`，上游检出未提供该 AS 源码，
   **未确认 SoundID**，暂用站点版既有 `win`，不冒称原版音效。
2. **原版强化算法不实现（已获授权）**：原版属性成长公式、模板进阶、失败损毁、
   VIP / 公会 / 开孔 / 绑定 / `StoneLevelMin` 校验等均未移植；研究证据保留在
   `docs/RULE_EVIDENCE.md`，运行时统一为 `SIMPLE_LOCAL_V1`。**不报告「原版强化完成」**。
3. **「神武石」未匹配**：上游物品表中不存在；已登记 `unmatched`，未编造物品 ID。
4. **中文「极·」品质名称待核对**：上游无中文「极」命名，无法证明 `VIP-` 模板对应中文极武器。
   按用户授权停止追查，使用**已核实的上游真实名称 + 「中文品质名称待核对」**标注，
   不编造模板 / 属性 / 素材；可作为翻牌武器奖励，不阻塞交付。见 `docs/WEAPON_MAPPING_EVIDENCE.md`。
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

> **历史记录**：以下条目是阶段 8 当时的实现状态。其中的「规则分离」
> `DDT_FORGE_RULES=local|original`、「可注入随机源」`DDT_FORGE_RANDOM`、
> 「正常池不含未确认映射的武器候选卡」**均已在阶段 10 下线或调整**，
> 现行规则与掉率一律以第 6 节、第 12 节为准；下表仅为溯源，不代表当前运行时行为。

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

## 12. 阶段 10 交付说明（2026-11-28，稳定可玩版本）

> 用户已授权：**不再追求强化规则 100% 还原，采用简单明确的单机强化规则**；
> 原版铁匠铺 UI、武器素材、强化动画与音效保留。
> 全项目统一标注「**原版素材 + 单机自定义强化规则**」，**不是原版强化算法**。
> 「原版强化完整规则缺失」不再列为阻塞项。

### 12.1 启动与可玩地址

```bash
cd /Users/123jiaru/Desktop/project/game/boomboom
npm install
npm run start:server
# 浏览器打开 http://127.0.0.1:8100/
```

- 后端：Node.js + TypeScript + SQLite（`node:sqlite`），Mac 原生，无需 Docker / 虚拟机 / Windows。
- 数据库：`data/ddt.sqlite`（WAL + 外键，`.gitignore` 已排除 `data/`、`*.sqlite*`、`.env`）；
  可用 `DDT_DB_PATH` / `DDT_DATA_DIR` 改位置，更新代码不会覆盖存档。
- 站点版前端 `dist/` 完全共用：`offline`（localStorage）与 `server`（HTTP/SSE/WS）由
  `dist/js/data-api.js` 统一切换；纯静态托管自动回退 offline。
- 环境变量样例见 `.env.example`（含 `DDT_REWARD_POOL`、`DDT_REWARD_WEAPON_CHANCE`）。

### 12.2 强化规则（服务端权威）

| 项 | 值 |
| --- | --- |
| 规则 | `SIMPLE_LOCAL_V1` / 原版素材 + 单机自定义强化规则 |
| 等级 | 初始 `+0`，上限 `+12`；每次 `+1`，不降级、不损毁 |
| 消耗 | **1 颗真强化石**（`Đá cường hóa 1..6`，所有等级统一一次机会）+ `100 × 目标等级` 金币 |
| 成功率 | 100% |
| 基础伤害 | `未强化基础伤害 × (1 + 0.10 × 强化等级)`；`+1`=110%、`+12`=220% |
| 精度 | 始终从 `base_attack` 重算，`attack_precise` 保留 6 位小数；最终伤害取整沿用战斗引擎 |
| 符咒 / 合成石 | 幸运符、神恩符不参与计算，槽位置灰，物品保留；四圣兽合成石禁止作为材料 |
| 影响范围 | 仅武器基础伤害，不改弹道 / 风力 / 爆炸范围 / 角度范围 |
| 防重 | 扣金币、扣材料、更新武器、写操作记录在同一 `BEGIN IMMEDIATE` 事务；`requestId` 防重放、`version` 条件更新防并发；前端不得提交结果字段 |

铁匠铺原版 6 槽中只有 **0 号强化石槽与 5 号装备槽启用**；界面显示当前等级、目标等级、
当前/强化后基础伤害、未强化基础值、金币与材料消耗（含持有量）、成功率、上限与规则版本；
金币不足 / 材料不足 / `+12` 上限均在预览区与服务端拒绝原因中明确提示。

### 12.3 旧存档迁移与备份

- `server-node/migrations/004_simple_forge.sql`：新增 `legacy_weapon_backup`（逐件备份）、
  `weapon_instances.base_attack / attack_precise`、`battles.weapon_attack_precise`。
- 旧 `LOCAL_RULE` 派生值 `attack = 基础值 + 25×level` 反推基础值后**一次性重算**，
  绝不在已强化数值上叠乘；`level > 12` 钳制到 12；无法反推时以当前 attack 为基础并标记，
  全部保留实例、不静默删除、不自动兑换材料。
- 只处理 `rule_version <> 'SIMPLE_LOCAL_V1'` 的行，重复启动不二次加成、不重复写备份。
- 已生成奖励盘保留原 `cards_json` 与 `pool_version`，规则变更不重抽。
- 备份用 Python `sqlite3.Connection.backup()`（SQLite backup API，WAL 安全），
  命令见第 4 节；完整验证表与实测输出见 `docs/MIGRATION_VERIFICATION.md`。

### 12.4 原版代码 / 素材 / 音频对应清单

| 类别 | 来源 | 项目落地 | 证据 |
| --- | --- | --- | --- |
| 弹道 / 重力 / 风力 / 伤害 / 回合 | 上游 `phucdz2kk4/Gunny @ 057c71a`（Go 金标准逐字段移植） | `dist/js/engine/`、`server-node/src/engine-loader.ts` | `docs/ASSET_MANIFEST.md` 1-3 节 |
| 铁匠铺界面（红金底纹、6 槽、按钮、成功率区、结果特效） | 旧版对照 `store.swf` + `store.xml` 的 `Strengthpoint0..5` | `dist/assets/forge/`（23 张）、`dist/js/server-mode.js` 真实 DOM | `docs/FORGE_UI_EVIDENCE.md` |
| 强化石 / 符咒 / 四圣兽石图标 | `TemplateAlllist.xml` 的 `Pic` → `Resource/v1.1/image/unfrightprop/` | `dist/assets/items/` | `docs/RULE_EVIDENCE.md` 1 节 |
| 高阶品质武器图标与属性 | `TemplateAlllist.xml` 7006..7014（上游真实名称） | `dist/assets/items/extreme-*.png`、`original-data.ts` | `docs/WEAPON_MAPPING_EVIDENCE.md` |
| 房间 065 / 大厅 062 / 12 张地图 BGM | `Resource/sound/*.flv` 无损抽出 MP3 帧 | `dist/assets/audio/bgm-*.mp3`（14 条） | `docs/AUDIO_MAPPING.md`、`docs/AUDIO_EVIDENCE.md` |
| 翻牌 048 / 倒计时 067、014 / 胜负 063、064 | `audio.swf` 的 `Sound0xx` | `dist/assets/audio/`、`dist/js/audio-scenes.js` | `docs/AUDIO_EVIDENCE.md` |
| 地图音乐编号 | `LoadMapsItems.xml` 的 `BackMusic`（1157→1071、1049→1032） | `MAP_BACK_MUSIC` 映射，不默认等于地图编号 | `docs/AUDIO_EVIDENCE.md` |
| 翻牌卡背 / 卡面 / 动画 | `gameover.swf` | `dist/assets/`、`dist/styles.css` | `docs/ASSET_MANIFEST.md` 4 节 |

研究证据但**不参与运行时**：原版强化链路（`ItemStrengthenHandler.cs`、
`StrengthenMgr.cs`、`ItemStrengthenList.xml`、概率公式、失败降级等）存档于
`docs/RULE_EVIDENCE.md`；**未确认 / 未接入**：`StoreTips` 强化结果 SoundID、
铁匠铺独立 BGM、战前加载独立音乐调用证据、高阶武器专属逐帧素材。

### 12.5 交付截图与验收结果

- `docs/screenshots/2026-11-28-stage10-settlement.png` —— 翻牌两张卡面（金币 + 真强化石），`已翻开 2/3`。
- `docs/screenshots/2026-11-28-stage10-forge.png` —— 红金铁匠铺、0/5 槽启用、1~4 置灰、
  成功率 100%、装备栏 / 道具栏、完整强化预览与规则说明、强化成功 `+0→+1 / 100→110`。
- `docs/screenshots/2026-11-28-stage10-room-after-reload.png` —— 刷新后 `+1`、金币与材料保留。

验收 8 条逐项通过：正常打一局并结算 → 翻牌获得金币和真强化石 → 返回房间打开铁匠铺 →
强化一次（扣费 / 材料 / 等级 / 伤害预览核对）→ 重复提交不重复扣费 → 重启后数据保留 →
下一局同条件攻击验证强化增益（110 / 机器人 35）→ `+12` 上限、材料不足、金币不足提示正确。
全量测试数字见第 7 节；`docs/PROGRESS.md` 第 10 节为逐项记录。
`SOURCE_MANIFEST.sha256` 已重生成至 **744 条**（覆盖全仓 tracked 文件，清单自身除外），
`shasum -a 256 -c` 返回 **744 OK**；此前 314 条清单遗漏了 `server-node/` 与 `art-source/`。
凭证模式扫描 staged 文件 **0 命中**。

### 12.6 剩余问题（如实标注）

- 原版强化算法**不实现**（已获授权）；界面素材是原版，算法不是原版，不写成「原版还原已完成」。
- 中文「极·」品质名称待核对：使用上游真实名称 + 标注，不编造模板 / 属性 / 素材，不阻塞交付。
- 强化结果原版音效 SoundID 未确认；铁匠铺无独立 BGM；战前加载无独立音乐调用证据。
- 商城 / 公会 / 购买按钮 / 多人匹配 / 副本系统未接线（明确不在范围内）。
- 手机横屏遮挡检查、多局连续资源 / 事件监听 / WebSocket / 计时器增长观测、
  浏览器进程总内存与 Canvas / 图片 / 音频 buffer 单独占用：**尚未实测**。

### 12.7 提交与推送

阶段 10 使用用户已配置的凭证**非强制推送** `feat/node-server-mode`，
`git ls-remote` 校验远程 SHA 与本地 HEAD 一致，不自动合并 `main`；
Token 未写入远程 URL、源码、文档、命令行参数或日志。
实际提交 SHA 与校验结果在推送完成后补记于 `docs/PROGRESS.md` 10.9。

