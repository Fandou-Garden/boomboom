/**
 * 原版物品与强化规则的逐字段抄录（ORIGINAL / ORIGINAL_ADAPTED / UNCONFIRMED）。
 *
 * 唯一数据来源：上游 phucdz2kk4/Gunny @ 057c71a
 * （与 dist/js/engine/constants.js 的 SOURCE_COMMIT 一致）：
 *   - Tank.Request/TemplateAlllist.xml            （zlib 压缩，7642 条 <Item>）
 *   - Tank.Request/ItemStrengthenList.xml        （等级 1..15 的 Rock / StoneLevelMin）
 *   - Tank.Request/itemstrengthengoodsinfo.xml   （GainEquip 进阶换模板）
 *   - Tank.Request/itemstrengthendata.xml        （只有副手 17003/17004，与武器无关）
 *   - Game.Server/Packets/Client/ItemStrengthenHandler.cs
 *   - Game.Server/Managers/StrengthenMgr.cs
 *   - Source Flash/src/store/view/strength/StoreIIStrengthBG.as
 *   - Source Flash/src/ddt/data/goods/QualityType.as
 *
 * 关键判定（来自 ItemStrengthenHandler.cs:37-81）：
 *   强化石   = CategoryID 11 && (Property1 == 2 || Property1 == 35)，槽位 0/1/2
 *   幸运符   = CategoryID 11 && Property1 == 3，槽位 4
 *   神恩符   = CategoryID 11 && Property1 == 7，槽位 3
 *   待强化装备 = 槽位 5，且 Template.CanStrengthen && Count == 1
 * 四圣兽石 = CategoryID 11 && Property1 == 1，FusionType 1..4，
 *   用途是「合成 Hợp thành」加攻/防/敏/幸，**不是强化材料**。
 *
 * 注意：本版本物品的 CategoryID=11 下 Property1=35 无任何条目（计数为 0），
 * 但服务端与客户端代码都保留了该分支；不据此虚构物品。
 *
 * 「极武器」核对结论（2026-11-28，见 docs/WEAPON_MAPPING_EVIDENCE.md）：
 *   TemplateAlllist.xml 中中文「极」出现 0 次；VIP- 出现 78 次；
 *   QualityType.QUALITY_STRING 共 8 档（粗糙/普通/优秀/精良/卓越/传说/神器），
 *   无「极」品质档。**无法证明上游 VIP 武器对应中文「极·」系列**，
 *   故本模块只登记「高阶品质武器候选」，使用上游真实名称，
 *   标记 中文品质映射待确认，且不进入正常奖励池。
 *
 * 本模块只做数据登记，不含任何随机结果或前端可指定的字段。
 */

export type ItemKind = 'strength-stone' | 'compose-stone' | 'lucky-charm' | 'god-charm';

export interface OriginalItem {
  /** 本服务端内部键，不会发给前端用于决定结果 */
  key: string;
  /** 原版 TemplateID */
  templateId: number;
  nameZh: string;
  /** 原版物品名（越南语） */
  nameSource: string;
  /** 原版 Pic 字段，对应 Resource/v1.1/image/unfrightprop/<pic>/icon.png */
  pic: string;
  icon: string;
  kind: ItemKind;
  /** 原版 Level 字段；强化石 1..6 对应 RateItems 下标 */
  level: number;
  /** 原版 Property2 */
  property2: number;
  /** 强化石：StrengthenMgr.RateItems[level-1] */
  rate?: number;
  /** 合成石：原版 FusionType 1朱雀/2玄武/3青龙/4白虎 */
  fusionType?: number;
  note: string;
}

/** 强化石：Đá cường hóa 1..6。注意 5 级 Pic=strength9、6 级 Pic=strength11。 */
export const STRENGTH_STONES: OriginalItem[] = [
  { key: 'strength1', templateId: 11019, nameZh: '强化石 1 级', nameSource: 'Đá cường hóa 1', pic: 'strength1', icon: 'assets/items/strength1.png', kind: 'strength-stone', level: 1, property2: 1, rate: 0.75, note: 'CategoryID=11 Property1=2 Level=1 Rate=0.75' },
  { key: 'strength2', templateId: 11021, nameZh: '强化石 2 级', nameSource: 'Đá cường hóa 2', pic: 'strength2', icon: 'assets/items/strength2.png', kind: 'strength-stone', level: 2, property2: 4, rate: 3.0, note: 'CategoryID=11 Property1=2 Level=2 Rate=3.0' },
  { key: 'strength3', templateId: 11022, nameZh: '强化石 3 级', nameSource: 'Đá cường hóa 3', pic: 'strength3', icon: 'assets/items/strength3.png', kind: 'strength-stone', level: 3, property2: 15, rate: 12.0, note: 'CategoryID=11 Property1=2 Level=3 Rate=12.0' },
  { key: 'strength4', templateId: 11023, nameZh: '强化石 4 级', nameSource: 'Đá cường hóa 4', pic: 'strength4', icon: 'assets/items/strength4.png', kind: 'strength-stone', level: 4, property2: 55, rate: 48.0, note: 'CategoryID=11 Property1=2 Level=4 Rate=48.0' },
  { key: 'strength5', templateId: 11024, nameZh: '强化石 5 级', nameSource: 'Đá cường hóa 5', pic: 'strength9', icon: 'assets/items/strength9.png', kind: 'strength-stone', level: 5, property2: 215, rate: 240.0, note: 'CategoryID=11 Property1=2 Level=5 Rate=240.0；Pic 为 strength9，不能按目录名推断等级' },
  { key: 'strength6', templateId: 11025, nameZh: '强化石 6 级', nameSource: 'Đá cường hóa 6', pic: 'strength11', icon: 'assets/items/strength11.png', kind: 'strength-stone', level: 6, property2: 10, rate: 768.0, note: 'CategoryID=11 Property1=2 Level=6 Rate=768.0；Pic 为 strength11' },
];

/** 幸运符（槽位 4）与神恩符（槽位 3）。 */
export const CHARMS: OriginalItem[] = [
  { key: 'lucky15', templateId: 11017, nameZh: '幸运符 15%', nameSource: 'Bùa may mắn 15%', pic: 'symbol1', icon: 'assets/items/symbol1.png', kind: 'lucky-charm', level: 1, property2: 15, note: 'CategoryID=11 Property1=3；Handler:63 num2 += probability + trunc(Property2/100)' },
  { key: 'lucky25', templateId: 11018, nameZh: '幸运符 25%', nameSource: 'Bùa may mắn 25%', pic: 'symbol3', icon: 'assets/items/symbol3.png', kind: 'lucky-charm', level: 2, property2: 25, note: 'CategoryID=11 Property1=3' },
  { key: 'lucky50', templateId: 11029, nameZh: '幸运符 50%', nameSource: 'Bùa may mắn 50%', pic: 'symbol5', icon: 'assets/items/symbol5.png', kind: 'lucky-charm', level: 4, property2: 50, note: 'CategoryID=11 Property1=3' },
  { key: 'lucky100', templateId: 11028, nameZh: '幸运符 100%', nameSource: 'Bùa may mắn 100%', pic: 'symbol4', icon: 'assets/items/symbol4.png', kind: 'lucky-charm', level: 5, property2: 100, note: 'CategoryID=11 Property1=3；Property2=100 是唯一使整数除法产生 1 的档位' },
  { key: 'godCharm', templateId: 11020, nameZh: '神恩符', nameSource: 'Bùa ma thuật', pic: 'symbol2', icon: 'assets/items/symbol2.png', kind: 'god-charm', level: 1, property2: 0, note: 'CategoryID=11 Property1=7；Handler:154 失败时跳过降级/损毁分支' },
];

/** 四圣兽合成石：Property1=1，用于「合成」，**不能**作为强化材料。 */
export const COMPOSE_STONES: OriginalItem[] = (() => {
  const families: Array<{ prefix: string; zh: string; source: string; fusionType: number; ids: number[] }> = [
    { prefix: 'zhuque', zh: '朱雀石', source: 'Đá Chu Tước', fusionType: 1, ids: [11001, 11002, 11003, 11004, 11030] },
    { prefix: 'xuanwu', zh: '玄武石', source: 'Đá Huyền Vũ', fusionType: 2, ids: [11005, 11006, 11007, 11008, 11031] },
    { prefix: 'qinglong', zh: '青龙石', source: 'Đá Thanh Long', fusionType: 3, ids: [11009, 11010, 11011, 11012, 11032] },
    { prefix: 'baihu', zh: '白虎石', source: 'Đá Bạch Hổ', fusionType: 4, ids: [11013, 11014, 11015, 11016, 11033] },
  ];
  const out: OriginalItem[] = [];
  for (const f of families) {
    f.ids.forEach((templateId, idx) => {
      const level = idx + 1;
      const pic = `${f.prefix}${level}`;
      out.push({
        key: pic, templateId, nameZh: `${f.zh} ${level} 级`, nameSource: `${f.source} ${level}`,
        pic, icon: `assets/items/${pic}.png`, kind: 'compose-stone', level,
        property2: level === 5 ? 5 : [100, 50, 30, 10][idx], fusionType: f.fusionType,
        note: `CategoryID=11 Property1=1 FusionType=${f.fusionType}；原版用途是合成加属性，不是强化石`,
      });
    });
  }
  return out;
})();

export const ALL_ORIGINAL_ITEMS: OriginalItem[] = [
  ...STRENGTH_STONES, ...CHARMS, ...COMPOSE_STONES,
];

/**
 * ItemStrengthenList.xml：强化到 StrengthenLevel 所需 Rock 与最低石头等级。
 * 服务端 GetNeedRate() 按装备 CategoryID 选 Rock/Rock1/Rock2/Rock3；
 * 本项目全部武器按 CategoryID=7 的 Rock 实现。
 * 注意：StoneLevelMin 在服务端 GetNeedRate() 中**未被校验**，见规则证据表。
 */
export const STRENGTHEN_LEVELS: Array<{ level: number; rock: number; stoneLevelMin: number }> = [
  { level: 1, rock: 2, stoneLevelMin: 1 },
  { level: 2, rock: 7, stoneLevelMin: 1 },
  { level: 3, rock: 28, stoneLevelMin: 2 },
  { level: 4, rock: 113, stoneLevelMin: 2 },
  { level: 5, rock: 227, stoneLevelMin: 3 },
  { level: 6, rock: 854, stoneLevelMin: 3 },
  { level: 7, rock: 2008, stoneLevelMin: 4 },
  { level: 8, rock: 7816, stoneLevelMin: 4 },
  { level: 9, rock: 11692, stoneLevelMin: 4 },
  { level: 10, rock: 17430, stoneLevelMin: 5 },
  { level: 11, rock: 21287, stoneLevelMin: 5 },
  { level: 12, rock: 26079, stoneLevelMin: 5 },
  { level: 13, rock: 34079, stoneLevelMin: 5 },
  { level: 14, rock: 39079, stoneLevelMin: 5 },
  { level: 15, rock: 48800, stoneLevelMin: 5 },
];

/** StrengthenMgr.cs 的常量。 */
export const ORIGINAL_CONSTANTS = {
  rateItems: [0.75, 3.0, 12.0, 48.0, 240.0, 768.0],
  vipStrengthenEx: 0.3,
  /** 配置表 ItemStrengthenList.xml 的最大 StrengthenLevel；服务端无显式上限判断。 */
  maxStrengthenLevel: 15,
  /** StrengthenMgr.NECKLACE_MAX_LEVEL 是项链上限，不是武器上限。 */
  necklaceMaxLevel: 12,
  /**
   * 武器 attack 随强化等级的成长公式**未还原**：
   * itemstrengthendata.xml 只有副手 TemplateID 17003/17004（CategoryID=17），
   * 与武器 CategoryID=7 无关；真正的属性计算在 EquipBag.UpdatePlayerProperties()
   * （ItemStrengthenHandler.cs:186-189 调用）里，本轮未导出。
   * 因此 original 规则下不声称实现了原版属性成长。
   */
  weaponAttackGrowth: null as number | null,
};

/**
 * itemstrengthengoodsinfo.xml 的进阶换模板（节选，代表链）。
 * 原版成功且 StrengthenLevel 达到门槛时，CategoryID=7 的武器会 CloneFromTemplate
 * 到 GainEquip 指向的新模板（原武器被移除），属性继承。本轮**未接线**。
 */
export const GAIN_EQUIP_SAMPLE: Array<{ currentEquip: number; level: number; gainEquip: number; originalEquip: number }> = [
  { currentEquip: 7006, level: 10, gainEquip: 70061, originalEquip: 7006 },
  { currentEquip: 7006, level: 12, gainEquip: 70062, originalEquip: 7006 },
  { currentEquip: 7006, level: 15, gainEquip: 70064, originalEquip: 7006 },
  { currentEquip: 7007, level: 10, gainEquip: 70071, originalEquip: 7007 },
  { currentEquip: 7008, level: 10, gainEquip: 70081, originalEquip: 7008 },
];

/**
 * 高阶品质武器候选（**不是已证实的中文「极·」武器**）。
 *
 * 逐件核对证据（2026-11-28）：
 *  - 上游越南服 TemplateAlllist.xml 中中文「极」出现 0 次；「VIP-」出现 78 次。
 *  - QualityType.QUALITY_STRING = 粗糙/普通/优秀/精良/卓越/传说/神器，无「极」档。
 *  - 7006..7014：Quality=4、Level=3、VIP- 前缀、Pic 与 7103..7111 相同、四维约 1.6 倍。
 *  - 7103..7111：Quality=3、Level=2、无前缀，同名普通版。
 *  - 70061/70062/70064：Name 仍是 VIP-Pháo，Pic=bombpack2/3/6，
 *    由 itemstrengthengoodsinfo.xml 在强化 10/12/15 级时 GainEquip 换模板得到，
 *    **属于强化进阶形态，不是另一个「极」品质**。
 *  - 客户端物品名直接取 TemplateAlllist.xml 的 Name，无品质前缀拼接
 *    （QualityType 只用于颜色 QUALITY_COLOR）。
 *
 * 结论：无法证明对应中文「极·」系列。按用户要求：
 *  1) 暂用上游真实名称（nameSource），不写「极·烈火」等推测中文名；
 *  2) 全部标记 mappingStatus='UNCONFIRMED'（中文品质映射待确认）；
 *  3) 不进入正常奖励池，仅测试奖励池可生成，且标注自定义/非官方。
 */
export interface HighQualityWeapon {
  key: string;
  templateId: number;
  /** 上游真实名称，直接展示，不翻译成「极·」 */
  nameSource: string;
  /** 中文展示名：与上游真实名称一致，另附待确认标注 */
  nameZh: string;
  mappingStatus: 'UNCONFIRMED';
  mappingNote: string;
  /** 项目内用于弹道/表现的基础武器 id（WEAPON_ORDER 中的键） */
  baseWeaponId: string;
  pic: string;
  attack: number;
  defence: number;
  agility: number;
  luck: number;
  quality: number;
  /** 上游 Template.Level，决定 ItemStrengthenHandler 失败分支走向 */
  templateLevel: number;
  /** 同名普通版模板 ID，用于说明两档关系 */
  normalTemplateId: number;
  /** 强化进阶链示例（来自 itemstrengthengoodsinfo.xml） */
  gainEquipSample: number[];
  ruleSource: 'ORIGINAL_DATA_UNCONFIRMED_MAPPING';
}

export const HIGH_QUALITY_WEAPONS: HighQualityWeapon[] = [
  { key: 'hq_fire', templateId: 7006, nameSource: 'VIP-Pháo', nameZh: 'VIP-Pháo（中文品质映射待确认）', mappingStatus: 'UNCONFIRMED', mappingNote: '上游无中文「极」命名，无法证明即「极·烈火」', baseWeaponId: 'fire', pic: 'bombpack', attack: 250, defence: 60, agility: 40, luck: 30, quality: 4, templateLevel: 3, normalTemplateId: 7103, gainEquipSample: [70061, 70062, 70064], ruleSource: 'ORIGINAL_DATA_UNCONFIRMED_MAPPING' },
  { key: 'hq_cannon', templateId: 7007, nameSource: 'VIP-Lựu đạn', nameZh: 'VIP-Lựu đạn（中文品质映射待确认）', mappingStatus: 'UNCONFIRMED', mappingNote: '上游无中文「极」命名，无法证明即「极·轰天」', baseWeaponId: 'cannon', pic: 'bomb', attack: 40, defence: 250, agility: 30, luck: 60, quality: 4, templateLevel: 3, normalTemplateId: 7104, gainEquipSample: [70071, 70072, 70074], ruleSource: 'ORIGINAL_DATA_UNCONFIRMED_MAPPING' },
  { key: 'hq_wind', templateId: 7008, nameSource: 'VIP-Phi tiêu', nameZh: 'VIP-Phi tiêu（中文品质映射待确认）', mappingStatus: 'UNCONFIRMED', mappingNote: '上游无中文「极」命名，无法证明即「极·神风」', baseWeaponId: 'wind', pic: 'dart', attack: 60, defence: 30, agility: 250, luck: 40, quality: 4, templateLevel: 3, normalTemplateId: 7105, gainEquipSample: [70081, 70082, 70084], ruleSource: 'ORIGINAL_DATA_UNCONFIRMED_MAPPING' },
  { key: 'hq_thunder', templateId: 7009, nameSource: 'VIP-Sấm sét', nameZh: 'VIP-Sấm sét（中文品质映射待确认）', mappingStatus: 'UNCONFIRMED', mappingNote: '上游无中文「极」命名', baseWeaponId: 'thunder', pic: 'electricbar', attack: 30, defence: 40, agility: 60, luck: 250, quality: 4, templateLevel: 3, normalTemplateId: 7106, gainEquipSample: [70091, 70092], ruleSource: 'ORIGINAL_DATA_UNCONFIRMED_MAPPING' },
  { key: 'hq_brick', templateId: 7010, nameSource: 'VIP-Lu gạch', nameZh: 'VIP-Lu gạch（中文品质映射待确认）', mappingStatus: 'UNCONFIRMED', mappingNote: '上游无中文「极」命名', baseWeaponId: 'brick', pic: 'brick', attack: 180, defence: 130, agility: 30, luck: 40, quality: 4, templateLevel: 3, normalTemplateId: 7107, gainEquipSample: [70101, 70102], ruleSource: 'ORIGINAL_DATA_UNCONFIRMED_MAPPING' },
  { key: 'hq_fruit', templateId: 7011, nameSource: 'VIP_ GIỎ ĐỒ', nameZh: 'VIP_ GIỎ ĐỒ（中文品质映射待确认）', mappingStatus: 'UNCONFIRMED', mappingNote: '上游无中文「极」命名', baseWeaponId: 'fruit', pic: 'fruit', attack: 40, defence: 30, agility: 130, luck: 180, quality: 4, templateLevel: 3, normalTemplateId: 7108, gainEquipSample: [70111, 70112], ruleSource: 'ORIGINAL_DATA_UNCONFIRMED_MAPPING' },
  { key: 'hq_scalpel', templateId: 7012, nameSource: 'VIP-Tủ thuốc', nameZh: 'VIP-Tủ thuốc（中文品质映射待确认）', mappingStatus: 'UNCONFIRMED', mappingNote: '上游无中文「极」命名', baseWeaponId: 'scalpel', pic: 'OPSbox', attack: 130, defence: 30, agility: 180, luck: 40, quality: 4, templateLevel: 3, normalTemplateId: 7109, gainEquipSample: [70121, 70122], ruleSource: 'ORIGINAL_DATA_UNCONFIRMED_MAPPING' },
  { key: 'hq_toilet', templateId: 7013, nameSource: 'VIP-Túi vũ khí', nameZh: 'VIP-Túi vũ khí（中文品质映射待确认）', mappingStatus: 'UNCONFIRMED', mappingNote: '上游无中文「极」命名', baseWeaponId: 'toilet', pic: 'closestool', attack: 40, defence: 180, agility: 30, luck: 130, quality: 4, templateLevel: 3, normalTemplateId: 7110, gainEquipSample: [70131, 70132], ruleSource: 'ORIGINAL_DATA_UNCONFIRMED_MAPPING' },
  { key: 'hq_appliance', templateId: 7014, nameSource: 'Vip TV, tủ lạnh', nameZh: 'Vip TV, tủ lạnh（中文品质映射待确认）', mappingStatus: 'UNCONFIRMED', mappingNote: '上游无中文「极」命名', baseWeaponId: 'appliance', pic: 'television', attack: 95, defence: 95, agility: 95, luck: 95, quality: 4, templateLevel: 3, normalTemplateId: 7111, gainEquipSample: [70141, 70142], ruleSource: 'ORIGINAL_DATA_UNCONFIRMED_MAPPING' },
];

export function highQualityWeaponByKey(key: string): HighQualityWeapon | undefined {
  return HIGH_QUALITY_WEAPONS.find((w) => w.key === key);
}

/**
 * 原版强化执行链逐项证据（供 docs/RULE_EVIDENCE.md 与 /api/server/config 展示）。
 * status: PORTED = 已按源码实现；PARTIAL = 核心实现但有明确未接线分支；
 *         NOT_PORTED = 源码已读到但本轮未实现；UNKNOWN = 源码/配置未找到。
 */
export const ORIGINAL_RULE_TRACE = [
  { item: '三强化石槽', source: 'ItemStrengthenHandler.cs:40-57', fields: 'StoreBag.GetItemAt(0/1/2), CategoryID=11, Property1=2|35, RateItems[Level-1], !stones.Contains', branch: 'stones.Count>=1 才继续；否则发 Content1 提示', status: 'PORTED' },
  { item: '幸运符', source: 'ItemStrengthenHandler.cs:58-69,82-83', fields: '槽4, Property1=3, num2 += probability + (Property2/100 整数除法)', branch: '无合法幸运符时 num2=0；15/25/50% 档整数除法结果为 0，100% 档为 1', status: 'PORTED' },
  { item: '神恩符', source: 'ItemStrengthenHandler.cs:70-81,154-181', fields: '槽3, Property1=7, isGod', branch: '失败且 isGod=true 时跳过降级/损毁分支，原样放回槽5', status: 'PARTIAL' },
  { item: '概率公式', source: 'ItemStrengthenHandler.cs:82-83,105-121', fields: 'num5=probability*100/Rock; num6=num2*100/Rock; num7=floor((num5+num6+num4+num3)*100); num8=RandomSafe.Next(10000)', branch: 'num7>num8 成功；VIP num3=0.3*num5；公会 num4=num5*0.1*SmithLevel；isPlayerWarrior 时 num8=0', status: 'PARTIAL' },
  { item: '等级表/GetNeedRate', source: 'StrengthenMgr.cs:360-382 + ItemStrengthenList.xml', fields: 'FindStrengthenInfo(StrengthenLevel+1).Rock (CategoryID 7/27)', branch: 'Rock 2..48800（1..15 级）；StoneLevelMin 1..5 未被服务端校验；FindStrengthenInfo 无 null 检查', status: 'PARTIAL' },
  { item: '等级上限', source: 'StrengthenMgr.cs:363 + ItemStrengthenList.xml 最大 15；客户端 PathManager.solveStrengthMax()/STHRENTH_MAX', fields: 'StrengthenLevel+1 查表', branch: '服务端无显式上限，超配置最大级会因 null 引用异常；客户端另有 solveStrengthMax（值未确认）', status: 'PARTIAL' },
  { item: '失败降级/损毁', source: 'ItemStrengthenHandler.cs:154-181', fields: 'item.Template.Level==3, item.StrengthenLevel>=5, item.Count--', branch: 'Template.Level==3 → 等级>=5 降 1 级 + FindRealStrengthenGoodInfo 回退模板；否则 Count-- 销毁装备；isGod 时全部跳过', status: 'PARTIAL' },
  { item: '模板进阶', source: 'ItemStrengthenHandler.cs:126-136 + itemstrengthengoodsinfo.xml', fields: 'FindStrengthenGoodsInfo(level, TemplateID).GainEquip > TemplateID → CloneFromTemplate', branch: '仅 CategoryID=7；成功且达到 10/12/15 级换模板（7006→70061/70062/70064）', status: 'NOT_PORTED' },
  { item: '属性计算', source: 'ItemStrengthenHandler.cs:137-139,186-189 + itemstrengthendata.xml', fields: 'ItemInfo.OpenHole, EquipBag.UpdatePlayerProperties()', branch: '武器 attack 成长公式未导出；itemstrengthendata.xml 仅含副手 17003/17004（CategoryID=17）', status: 'UNKNOWN' },
  { item: '扣费', source: 'ItemStrengthenHandler.cs:113', fields: 'StoreBag.ClearBag()', branch: '只消耗槽位物品；该包处理中**没有金币扣费**', status: 'PORTED' },
] as const;
