# 原版铁匠铺 UI 证据表（阶段 9）

> 结论先行：**界面素材与布局已按旧版对照库 `store.swf` + `store.xml` 实证还原并接线**，
> 6 个槽位、装备栏、道具栏、成功率区、强化按钮都是**真实可交互 DOM**，不是背景截图覆盖。
> **原版强化规则仍未还原完成**，当前界面继续显示 `LOCAL_RULE` / `ORIGINAL_PARTIAL`，
> 不写成「原版已还原」。

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

| 交互 | 实现 | 验证 |
| --- | --- | --- |
| 6 个槽位 | `server-mode.js` `SLOT_LAYOUT` 按上表坐标定位 `.ddt-slot`，每个都是 `<button>` | 浏览器验收断言 6 个槽位与 `data-accept` 顺序 |
| 点选放入 | 点道具栏 → 放入选中槽 / 第一个兼容空槽；点已填充槽 → 移除 | 验收「点选道具真实放入强化石槽」 |
| 拖放 | `dragstart / dragover / drop`，按 `data-accept` 校验类别；`renderForge()` 重绘后 DOM 仍保持 `is-filled` 状态 | 浏览器验收派发 `DragEvent` 断言「拖放道具真实放入 1 号槽 + 点击槽位移除」 |
| 装备栏 | 点击武器放入 5 号槽，也可拖放 | 装备栏 DOM 与槽位联动 |
| 成功率区 | `renderSuccessRate()`：ORIGINAL 用与 `services.ts originalRuleFor()` 同公式预览；LOCAL_RULE 显示固定成功率 | 验收断言渲染 |
| 强化按钮 | `store.StrengthBtn` 原版按钮，点击提交 `slots[0..2]` + `luckyCharm` + `godCharm` + `weaponInstanceId` + `requestId` | 验收强化成功 +1 / attack 125 |
| 结果反馈 | 原版成功/失败素材浮现 1.6 s 后隐藏（`pointer-events:none`，不遮挡交互） | 截图 `docs/screenshots/2026-11-28-stage9-forge.png`（特效消失后拍摄，6 槽完整可见） |
| 规则透明 | 顶部常驻 `LOCAL_RULE` / `ORIGINAL_PARTIAL`、属性成长来源、未还原项、武器映射状态 | 验收断言 |
| 音乐 | 进/出铁匠铺 `pauseBgm()` / `resumeBgm()`（原版 `BaseStoreView.as:452/469`），音量/静音按钮 | `docs/AUDIO_EVIDENCE.md` |

## 6. 明确不是原版还原的部分

1. **规则**：界面素材是原版，但强化规则默认 `LOCAL_RULE`，`DDT_FORGE_RULES=original` 时是
   `ORIGINAL_PARTIAL`；属性成长、模板进阶、失败损毁、VIP/公会/开孔/绑定均未还原。
2. **文案**：槽位内的越南文（`Đá cường hóa` / `Bùa may mắn` / `Bùa ma thuật`）来自
   原版 `StrengthStoneBG` / `LuckyBG` / `GodBG` **底图自带的占位文字**，不是残留物品；
   实际放入物品时由 `.ddt-slot.is-filled` 叠加真实图标与数量（DOM 类控制，非静态背景覆盖）。
   中文标签是本项目的 `aria-label` / 提示，不是原版文字替换。
3. **大厅/公会/VIP/购买按钮**：`BuyLuckyBtn` 等素材已导出但**未接线**（当前无商城与公会系统），
   不做出可点击却无效的假按钮。
4. **强化结果音效**：`StoreTips` 源码未提供，成功/失败沿用 063/064 并标记未确认。
5. **极武器**：中文「极·」映射仍 `UNCONFIRMED`，正常奖励池不发放；专属素材未导入。
6. 多局连续资源 / 监听器 / WebSocket / 计时器增长观测、手机横屏遮挡检查仍未完成。
