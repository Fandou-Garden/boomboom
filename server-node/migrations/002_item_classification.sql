-- 002 物品分类纠错（可重复执行；版本由 schema_migrations 保证只应用一次）
--
-- 背景：001 把 Đá Huyền Vũ 1..5（玄武石）误登记为 'strengthen-stone' 并作为强化材料。
-- 原版证据：
--   TemplateAlllist.xml   : 玄武石 CategoryID=11 Property1=1 FusionType=2 → 合成石（加防御）
--   ItemStrengthenHandler : 强化石判定 CategoryID=11 && (Property1=2 || 35)
--   强化石真实条目       : Đá cường hóa 1..6 = 11019/11021/11022/11023/11024/11025
--
-- 迁移原则（按验收要求）：
--   * 只改「分类与登记」，不删除/扣减任何 inventory 行，不重置武器等级，不修改金币；
--   * 保留玩家已有的玄武石数量，仅把它正确归类为「四圣兽合成石」；
--   * **不自动兑换、不补发、不合并**两类材料（001 误发的玄武石仍是玩家资产）；
--   * 不重算 weapon_instances.attack，避免旧 LOCAL_RULE 加成被再次叠加；
--   * 旧盘（reward_boards）不重新抽取，cards_json 原样保留；
--   * 无任何 INSERT ... SELECT 发放语句，重复应用不会重复发物品或加属性。
-- 迁移前后核对见 docs/MIGRATION_VERIFICATION.md 与 tests/server/migration.mjs。

CREATE TABLE IF NOT EXISTS migration_notes (
  key        TEXT PRIMARY KEY,
  note       TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

-- 1) 已存在的 5 条玄武石：改为合成石，保留 template_id / icon / inventory 数量。
UPDATE item_catalog
   SET kind = 'compose-stone',
       note = 'CORRECTED in 002: 原版 CategoryID=11 Property1=1 FusionType=2，用途为合成加防御；不是强化材料。001 的 strengthen-stone 分类为错误登记。'
 WHERE item_key IN ('xuanwu1','xuanwu2','xuanwu3','xuanwu4','xuanwu5')
   AND kind = 'strengthen-stone';

-- 2) 补齐另外三系四圣兽合成石（青龙 / 白虎 / 朱雀），同样不是强化材料。
INSERT OR IGNORE INTO item_catalog (item_key, template_id, name_zh, name_source, icon, kind, unit_value, note) VALUES
 ('zhuque1', 11001, '朱雀石 1 级', 'Đá Chu Tước 1', 'assets/items/zhuque1.png', 'compose-stone', 1, 'Property1=1 FusionType=1；合成加攻击，不是强化材料'),
 ('zhuque2', 11002, '朱雀石 2 级', 'Đá Chu Tước 2', 'assets/items/zhuque2.png', 'compose-stone', 2, 'Property1=1 FusionType=1；合成加攻击，不是强化材料'),
 ('zhuque3', 11003, '朱雀石 3 级', 'Đá Chu Tước 3', 'assets/items/zhuque3.png', 'compose-stone', 3, 'Property1=1 FusionType=1；合成加攻击，不是强化材料'),
 ('zhuque4', 11004, '朱雀石 4 级', 'Đá Chu Tước 4', 'assets/items/zhuque4.png', 'compose-stone', 4, 'Property1=1 FusionType=1；合成加攻击，不是强化材料'),
 ('zhuque5', 11030, '朱雀石 5 级', 'Đá Chu Tước 5', 'assets/items/zhuque5.png', 'compose-stone', 5, 'Property1=1 FusionType=1；合成加攻击，不是强化材料'),
 ('qinglong1', 11009, '青龙石 1 级', 'Đá Thanh Long 1', 'assets/items/qinglong1.png', 'compose-stone', 1, 'Property1=1 FusionType=3；合成加敏捷，不是强化材料'),
 ('qinglong2', 11010, '青龙石 2 级', 'Đá Thanh Long 2', 'assets/items/qinglong2.png', 'compose-stone', 2, 'Property1=1 FusionType=3；合成加敏捷，不是强化材料'),
 ('qinglong3', 11011, '青龙石 3 级', 'Đá Thanh Long 3', 'assets/items/qinglong3.png', 'compose-stone', 3, 'Property1=1 FusionType=3；合成加敏捷，不是强化材料'),
 ('qinglong4', 11012, '青龙石 4 级', 'Đá Thanh Long 4', 'assets/items/qinglong4.png', 'compose-stone', 4, 'Property1=1 FusionType=3；合成加敏捷，不是强化材料'),
 ('qinglong5', 11032, '青龙石 5 级', 'Đá Thanh Long 5', 'assets/items/qinglong5.png', 'compose-stone', 5, 'Property1=1 FusionType=3；合成加敏捷，不是强化材料'),
 ('baihu1', 11013, '白虎石 1 级', 'Đá Bạch Hổ 1', 'assets/items/baihu1.png', 'compose-stone', 1, 'Property1=1 FusionType=4；合成加幸运，不是强化材料'),
 ('baihu2', 11014, '白虎石 2 级', 'Đá Bạch Hổ 2', 'assets/items/baihu2.png', 'compose-stone', 2, 'Property1=1 FusionType=4；合成加幸运，不是强化材料'),
 ('baihu3', 11015, '白虎石 3 级', 'Đá Bạch Hổ 3', 'assets/items/baihu3.png', 'compose-stone', 3, 'Property1=1 FusionType=4；合成加幸运，不是强化材料'),
 ('baihu4', 11016, '白虎石 4 级', 'Đá Bạch Hổ 4', 'assets/items/baihu4.png', 'compose-stone', 4, 'Property1=1 FusionType=4；合成加幸运，不是强化材料'),
 ('baihu5', 11033, '白虎石 5 级', 'Đá Bạch Hổ 5', 'assets/items/baihu5.png', 'compose-stone', 5, 'Property1=1 FusionType=4；合成加幸运，不是强化材料');

-- 3) 真正的强化石（Đá cường hóa 1..6）。注意 Pic 与等级不是一一对应：
--    5 级 = strength9，6 级 = strength11。
INSERT OR IGNORE INTO item_catalog (item_key, template_id, name_zh, name_source, icon, kind, unit_value, note) VALUES
 ('strength1', 11019, '强化石 1 级', 'Đá cường hóa 1', 'assets/items/strength1.png', 'strength-stone', 1, 'Property1=2 Level=1 Rate=0.75；ItemStrengthenHandler 槽位 0/1/2'),
 ('strength2', 11021, '强化石 2 级', 'Đá cường hóa 2', 'assets/items/strength2.png', 'strength-stone', 2, 'Property1=2 Level=2 Rate=3.0'),
 ('strength3', 11022, '强化石 3 级', 'Đá cường hóa 3', 'assets/items/strength3.png', 'strength-stone', 3, 'Property1=2 Level=3 Rate=12.0'),
 ('strength4', 11023, '强化石 4 级', 'Đá cường hóa 4', 'assets/items/strength4.png', 'strength-stone', 4, 'Property1=2 Level=4 Rate=48.0'),
 ('strength5', 11024, '强化石 5 级', 'Đá cường hóa 5', 'assets/items/strength9.png',  'strength-stone', 5, 'Property1=2 Level=5 Rate=240.0；Pic=strength9'),
 ('strength6', 11025, '强化石 6 级', 'Đá cường hóa 6', 'assets/items/strength11.png', 'strength-stone', 6, 'Property1=2 Level=6 Rate=768.0；Pic=strength11');

-- 4) 幸运符（槽位 4）与神恩符（槽位 3）。
INSERT OR IGNORE INTO item_catalog (item_key, template_id, name_zh, name_source, icon, kind, unit_value, note) VALUES
 ('lucky15',  11017, '幸运符 15%',  'Bùa may mắn 15%',  'assets/items/symbol1.png', 'lucky-charm', 15,  'Property1=3；num2 += probability + trunc(Property2/100)'),
 ('lucky25',  11018, '幸运符 25%',  'Bùa may mắn 25%',  'assets/items/symbol3.png', 'lucky-charm', 25,  'Property1=3'),
 ('lucky50',  11029, '幸运符 50%',  'Bùa may mắn 50%',  'assets/items/symbol5.png', 'lucky-charm', 50,  'Property1=3'),
 ('lucky100', 11028, '幸运符 100%', 'Bùa may mắn 100%', 'assets/items/symbol4.png', 'lucky-charm', 100, 'Property1=3'),
 ('godCharm', 11020, '神恩符',      'Bùa ma thuật',     'assets/items/symbol2.png', 'god-charm',   0,   'Property1=7；失败时装备不丢失、不降级');

-- 5) 「神武石」维持 unmatched，不因新增条目而改变结论。
UPDATE unmatched_items
   SET note = note || ' 002 迁移补充核对：CategoryID=11 下 Property1=2 的 6 条为 Đá cường hóa 强化石，Property1=1 的 20 条为四圣兽合成石；仍无任何「神武」/「Thần Vũ」条目。'
 WHERE query = '神武石' AND note NOT LIKE '%002 迁移补充核对%';

-- 6) 迁移说明（纯记录，不产生任何资产变动）。
INSERT OR IGNORE INTO migration_notes (key, note, applied_at)
VALUES ('002_classification',
        '玄武石改分类为 compose-stone 并保留数量；登记真强化石/符咒/其余三系合成石；不自动兑换、不补发、不删除、不合并、不重算武器 attack；旧奖励盘不重抽。',
        CAST(strftime('%s','now') AS INTEGER) * 1000);
