# 原版铁匠铺 UI 证据表（阶段 9 实现 / 阶段 10 规则调整）

> 结论先行：**界面素材与布局已按旧版对照库 `store.swf` + `store.xml` 实证还原并接线**，
> 6 个槽位、装备栏、道具栏、成功率区、强化按钮都是**真实可交互 DOM**，不是背景截图覆盖。
>
> **阶段 10 交付规则 =「原版素材 + 单机自定义强化规则」(`SIMPLE_LOCAL_V1`)，不是原版强化算法。**
> 用户已授权简化、不再追查原版规则（`docs/RULE_EVIDENCE.md` 保留研究证据）。
> 按新规则每次只需 1 颗真强化石，因此只有 **0 号强化石槽与 5 号装备槽启用**；
> 1/2 号强化石槽、3 神恩符槽、4 幸运符槽 `disabled` + `aria-disabled` + 置灰并说明原因，
> 对应物品仍保留在背包中，不消耗、不删除。

## 1. 资源来源与核对

| 项 | 实测 |
| --- | --- |
| 旧版对照包 SWF | `/tmp/gunny-30/inetpub/wwwroot/gunny/ui/vietnam/swf/store.swf`，745 KB，头 `CWS` |
| 布局配置 | `/tmp/gunny-30/inetpub/wwwroot/gunny/ui/vietnam/xml/xml/store.xml` |
| 客户端类 | `/tmp/ddt-research/StoreIIStrengthBG.as`（1093 行，上游 `phucdz2kk4/Gunny` 同名类） |
| 反编译工具 | FFDec v21.0.1（`java -jar ffdec.jar`），`-dumpAS3` 得 **125** 个导出符号，`-export image,symbolClass` 得 **124** 张图片 |
| 红金底图 | `16_asset.store.strengthBG.jpg` → 710×402，橙红底 + 金色曼陀罗花纹 + 金色描边，与用户描述的红金色截图风格一致 |
| 底板 | `18_asset.store.StoreBG.png` → 786×413 纯金底 |
| 槽位底图 | `StrengthStoneBG / LuckyBG / GodBG` 均 80×80，分别带越南文「Đá cường hóa」「Bùa may mắn」「Bùa ma thuật」 |

**与上游 UI 的差异记录**：上游 `phucdz2kk4/Gunny` 的 `Source Flash/FlashSV1/` 完整 store 模块
SWF 与源码在本地检出中**未找到**（只有 `StoreIIStrengthBG.as` 等单文件）。
按用户「如果当前上游 UI 与截图不同，记录差异，从旧版对照库选择匹配资源」的指示，
本轮采用旧版对照库 `gunny-30` 的 `store.swf` 导出素材；该 SWF 的红金配色与截图描述一致。
**没有因为仓库叫 3.0 就假定素材一致**，而是实际导出并查看图片后确认。

## 2. 布局证据（`store.xml` 行号）

| 行 | 原文（节选） | 用途 |
| --- | --- | --- |
| 41 | `store.MainViewBG ... resourceLink="asset.store.strengthBG,..." x="58" y="8"` | 强化页红金底图 |
| 63-67 | `StrengthLuckyBG x=13 y=56` / `StrengthEquipBG x=113 y=101` / `StrengthStoneI x=113 y=1` / `II x=213 y=101` / `III x=113 y=201` | 槽位底图坐标 |
| 72 | `store.StrengthBG resourceLink="store.StrengthLuckyBG,asset.store.GodBG,store.StrengthEquipBG,store.StrengthStoneI,II,III"` | 6 个底图组合 |
| 73 | `store.needMoneyTxt x=101 y=293` | 金币文字区 |
| 81 | `store.StrengthBtn x=72 y=322 backStyle="asset.store.StrengthBtn"` | 强化按钮（160×46） |
| 87 | `store.StrengthNodeBtn x=240 y=345` | 帮助按钮 |
| 174-175 | `store.bagBGI = bagBGI + bagEquip + bagProp` | 道具栏与页签 |
| 183 | `store.bagStrenghMsg = bagStrengthI + bagStrengthII` | 强化说明条 |
| 211 | `StoreIIStrengthBG x=65 y=30` | 强化台容器偏移 |
| 215-220 | `Strengthpoint0..5` 六个点位 | 真实槽位坐标 |
| 70 | `store.StrengthSuccessRates = SuccessRates + BaiFengTxtBGII x=-40` | 成功率区域 |

## 3. 槽位对照表（`StoreIIStrengthBG.as:133-158` + `store.xml:215-220`）

| 槽位 | 客户端类 / 类型 | Strengthpoint | 本项目 DOM | 接受类别 |
| --- | --- | --- | --- | --- |
| 0 | `StrengthStone([STRENGTH, STRENGTH_1], 0)` | (106, -6) | `.ddt-slot[data-slot="0"]` | `strength-stone` |
| 1 | `StrengthStone(..., 1)` | (206, 95) | `[data-slot="1"]` | `strength-stone` |
| 2 | `StrengthStone(..., 2)` | (106, 195) | `[data-slot="2"]` | `strength-stone` |
| 3 | `StoneCell([SOULSYMBOL], 3)` | (6, 141) | `[data-slot="3"]` | `god-charm`（神恩符） |
| 4 | `StoneCell([LUCKY], 4)` | (6, 49) | `[data-slot="4"]` | `lucky-charm`（幸运符） |
| 5 | `StreangthItemCell(5)` | (123, 111) | `[data-slot="5"]` | `weapon`（待强化装备） |

- `StoreIIStrengthBG.as:107` `rateItems = [0.75, 3, 12, 48, 240, 768]`（强化石 Rate 表）。
- `StoreIIStrengthBG.as:187-204` 创建 `ShowSuccessRate`，显示强化石 / 幸运符 / 公会 / VIP / 合计提示。
- `StoreIIStrengthBG.as:209` `_strength_btn.addEventListener(MouseEvent.CLICK, __strengthClick)`；
  `:582` 是提交处理，`:757` `SocketManager.Instance.out.sendItemStrength(...)`（**服务端包，不在 UI 里**）。
- `StoreIIStrengthBG.as:119` `StoreDragInArea` + `DragManager` → 原版是拖放交互。
- 上述客户端槽位**只能证明 UI 结构，不能证明服务端规则**；服务端规则证据另见 `docs/RULE_EVIDENCE.md`。

## 4. 导出素材清单

导出到 `dist/assets/forge/`，逐文件 SHA-256 与 SWF 符号名记录在
`dist/assets/forge/SOURCE_MANIFEST.json`（23 个素材 + 清单）。

| 项目文件 | SWF 符号 | 尺寸 | 用途 |
| --- | --- | --- | --- |
| `store-strength-bg.jpg` | `asset.store.strengthBG` | 710×402 | 红金强化台底图（仅装饰） |
| `store-frame-bg.png` | `asset.store.StoreBG` | 786×413 | 金底板 |
| `slot-strength.png` | `asset.store.StrengthStoneBG` | 80×80 | 三个强化石槽底 |
| `slot-lucky.png` | `asset.store.LuckyBG` | 80×80 | 幸运符槽底 |
| `slot-god.png` | `asset.store.GodBG` | 80×80 | 神恩符槽底 |
| `slot-equip.png` | `asset.store.EquipBG` | 82×82 | 装备槽底 |
| `cell-equip.png` / `cell-blank.png` | `EquipCellBG` / `BlankCellBG` | 60×60 / 92×92 | 格子底 |
| `btn-strength.png` | `asset.store.StrengthBtn` | 160×46 | 强化按钮 |
| `rate-label.png` / `rate-text-bg.png` | `SuccessRates` / `BaiFengTxtBG` | 39×23 / — | 成功率区 |
| `bag-bg.png`, `tab-equip.png`, `tab-prop.png`, `bag-strength.png` | `bagBGI`, `bagEquip`, `bagProp`, `bagStrengthI` | — | 道具栏 |
| `result-success.png` / `result-fail.png` | `StoreIISuccessBitAsset` / `StoreIIFailBitAsset` | 505×124 / 505×125 | 结果特效 |
| `tab-strength.png`, `btn-help.png`, `tip-start.png`, `buy-*.png` | `strengthBtn`, `StrengthNodeBtn`, `StartStrengthTip`, `Buy*BG` | — | 页签/提示/购买按钮 |

`asset.store.cellShine` 在本次 `-export image` 中未产出独立图片（导出为 sprite/movie），
**未编造替身**，清单中已省略。

## 5. 本项目实现（真实交互，不是背景覆盖）

| 交互 | 阶段 10 实现 | 验证 |
| --- | --- | --- |
| 6 个槽位 | `server-mode.js` `SLOT_LAYOUT` 按上表坐标定位 `.ddt-slot`，每个都是 `<button>`；0/5 启用、1~4 `disabled` | 浏览器验收断言 6 槽齐全、启用/禁用状态、`aria-disabled`、置灰样式与 title 原因 |
| 点选放入 | 点道具栏真强化石 → 放入 0 号槽；点已填充槽 → 移除。非 `strength-stone` 的道具按钮禁用 | 验收「点选道具真实放入强化石槽」「禁用槽拒绝」 |
| 拖放 | `dragstart / dragover / drop` 按 `data-accept` 校验，只有 0/5 号槽接受；禁用槽直接拒绝 | 验收派发 `DragEvent` 断言「拖放道具进 0 号槽、装备进 5 号槽、3 号禁用槽拒绝」 |
| 装备栏 | 点击或拖放武器放入 5 号槽；强化前恢复为已装备武器 | 装备栏 DOM 与槽位联动 |
| 道具栏 | 全部 31 项登记材料可见；符咒 / 四圣兽合成石置灰并给出原因 | 验收断言 `.ddt-bag-item.is-disabled` 数量 > 0 |
| 成功率区 | `renderSuccessRate()` 固定显示 **100%**，附「每次 1 颗真强化石 · 金币 N · 已放入 x/1」 | 验收断言含「成功率」与「100%」 |
| 强化按钮 | 原版 `store.StrengthBtn`；仅提交 `weaponInstanceId` / `itemKey` / `requestId`，**不含任何结果字段** | 验收强化成功 +1 / 基础伤害 110 / 金币 -100 / 材料 -1；服务端 400 拦截结果字段 |
| 强化预览 | 当前等级、目标等级、当前/强化后基础伤害、未强化基础值、金币消耗（含持有量）、材料消耗（含持有量）、成功率、上限、规则版本 | 验收逐字段断言；金币/材料不足时 `.ddt-reason` 显示具体原因 |
| 结果反馈 | 原版成功素材浮现 1.6 s 后隐藏（`pointer-events:none`）；失败沿用 frame 抖动并显示服务端拒绝原因 | 截图 `docs/screenshots/2026-11-28-stage10-forge.png`；三类不足提示验收 |
| 规则透明 | 顶部常驻 `原版素材 + 单机自定义强化规则 · SIMPLE_LOCAL_V1 · 上限 +12 · 成功率 100% · 每次 1 颗真强化石`；底部注明「不是原版强化算法」与禁用槽原因 | 验收断言 header / rule / ruleBody 文案 |
| 音乐 | 进/出铁匠铺 `pauseBgm()` / `resumeBgm()`（原版 `BaseStoreView.as:452/469`），音量/静音按钮 | `docs/AUDIO_EVIDENCE.md` |

**交付截图**：`docs/screenshots/2026-11-28-stage10-forge.png`。为完整呈现可滚动侧栏内的
「强化预览 / 规则说明」，截图时临时调高视口并展开滚动容器（DOM 内容不变，截完立即恢复），
因此左侧红金强化台下方会出现留白；正常使用时侧栏可滚动、无此留白。

## 6. 明确不是原版还原的部分

1. **强化算法**：界面 / 武器素材 / 动画 / 音效来自原版 `store.swf`，但强化规则是本项目自定的
   单机规则 `SIMPLE_LOCAL_V1`（+0~+12、1 石 + 100×目标等级金币、100% 成功、
   伤害 = 基础值 ×(1+0.10×等级)）。**不称为原版强化算法**，也不把「原版规则缺失」列为阻塞项。
2. **原版三槽 / 符咒机制**：上游三强化石槽、幸运符、神恩符、概率公式、失败降级/损毁、
   模板进阶、VIP/公会/开孔/绑定等**未实现**。槽位按原版坐标保留但置灰，物品保留在背包。
3. **文案**：槽位内的越南文（`Đá cường hóa` / `Bùa may mắn` / `Bùa ma thuật`）来自
   原版 `StrengthStoneBG` / `LuckyBG` / `GodBG` **底图自带的占位文字**，不是残留物品；
   实际放入物品时由 `.ddt-slot.is-filled` 叠加真实图标与数量（DOM 类控制，非静态背景覆盖）。
   中文标签是本项目的 `aria-label` / 提示，不是原版文字替换。成功率区的 `Tỉ lệ` 同理来自原版底图。
4. **大厅/公会/VIP/购买按钮**：`BuyLuckyBtn` 等素材已导出但**未接线**（当前无商城与公会系统），
   不做出可点击却无效的假按钮。
5. **强化结果音效**：`StoreTips` 源码未提供，成功沿用站点版 `win` 音效并标记未确认。
6. **高阶品质武器中文名**：中文「极·」映射无法证明，使用上游真实名称 +「中文品质名称待核对」，
   不编造模板 / 属性 / 素材；不阻塞交付。见 `docs/WEAPON_MAPPING_EVIDENCE.md`。
7. 多局连续资源 / 监听器 / WebSocket / 计时器增长观测、手机横屏遮挡检查仍未完成
   （性能验证见 `docs/PROGRESS.md` 阶段 8/9 与 `tests/server/perf.mjs`）。
