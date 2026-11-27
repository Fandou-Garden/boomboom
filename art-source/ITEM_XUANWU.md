# 玄武石图标：源码实证与勘误

> 结论先说：站点 v32 及之前用的 `dist/assets/ui/icon-stones.png` **没有任何源码依据**。
> 它是 `image/unfrightprop/stones/icon.png`，原版对应「藏宝图碎片 / 武士碎片」任务道具，
> 不是玄武石。当时只是因为目录名里带 `stones` 就拿来用了。

## 一、旧图标究竟是什么

`md5` 全库反查 `image/unfrightprop/`（811 个目录）：

| 站点文件 | md5 唯一命中 | 尺寸 |
|---|---|---|
| `icon-stones.png` | `unfrightprop/stones/icon.png` | 78×78 |
| `icon-gold.png` | `unfrightprop/gold/icon.png` | 41×28 |

`GameAdmin/Backup/XMLReader/XMLImport/TemplateAlllist.xml`：

- `:3205` `Pic="stones"` → `Name="Đá ngàn năm"`（千年之石），`Description="Tương truyền là bản đồ của kho báu bí mật … Đạo cụ nhiệm vụ"`（传说藏宝图，任务道具），`TemplateID=200100`
- `:3335` `Pic="stones"` → `Name="Mảnh ghép samurai"`（武士碎片），`TemplateID=200319`

视觉上是一张**红框、绿色魔法阵/星盘**的方形图，与蓝色宝石的玄武石完全不同。

## 二、真正的玄武石

同一份 `TemplateAlllist.xml`，越南语 `Đá Huyền Vũ` = 玄武石：

| 行 | Name | Pic | TemplateID | 描述 |
|---|---|---|---|---|
| 1590 | `Đá Huyền Vũ 1` | `xuanwu1` | 11005 | 合成 +10 防御 |
| 1591 | `Đá Huyền Vũ 2` | `xuanwu2` | 11006 | 合成 +20 防御 |
| 1592 | `Đá Huyền Vũ 3` | `xuanwu3` | 11007 | 合成 +30 防御 |
| 1593 | `Đá Huyền Vũ 4` | `xuanwu4` | 11008 | 合成 +40 防御 |
| 1616 | `Đá Huyền Vũ 5` | `xuanwu5` | 11031 | 合成 +50 防御 |

原文 `Description="Hợp thành +N điểm phòng thủ, hợp thành thất bại không mất đi vật phẩm"`
（合成后 +N 点防御，合成失败不消耗）。所以玄武石是**防御属性合成石**，1~5 级。

图标在 `Tank.Flash/resource/v1.1/image/unfrightprop/xuanwu{1..5}/icon.png`，
**60×60 RGBA，蓝色/青色宝石晶体**：1 级是碎块，2~5 级逐层变成完整蓝菱形宝石。

四象石按颜色区分（均已核对 4 级图标）：

| 玄武 | 青龙 | 白虎 | 朱雀 |
|---|---|---|---|
| `xuanwu4` 蓝 | `qinglong4` 绿 | `baihu4` 黄 | `zhuque4` 粉红 |

`Pic` 与 `TemplateID` 全表（`TemplateAlllist.xml` 正则提取）：

```
zhuque1 11001  zhuque2 11002  zhuque3 11003  zhuque4 11004
xuanwu1 11005  xuanwu2 11006  xuanwu3 11007  xuanwu4 11008
qinglong1 11009 qinglong2 11010 qinglong3 11011 qinglong4 11012
baihu1 11013  baihu2 11014  baihu3 11015  baihu4 11016
zhuque5 11030  xuanwu5 11031  qinglong5 11032  baihu5 11033
```

另外 `:3021` `Pic="xuanwujingpo0"` = `Serpent Element` / `:3031` `Huyền vũ tinh thạch`（玄武星石），
是**活动任务材料**，不是合成石，别混用。

## 三、礼包描述里的中文档案

`TemplateAlllist.xml` 中文条目（`:2894`、`:2899`、`:2904`）的奖励列表写的是
「朱雀石4级 / 青龙石4级 / 白虎石4级 / **玄武石4级** ×1」。
这是站点采用 **4 级** `xuanwu4` 的依据 —— 原版作为翻牌/礼包奖励出现的就是 4 级。

## 四、v33 的修改

- `dist/assets/ui/icon-stones.png` ← `unfrightprop/xuanwu4/icon.png`（60×60，原图未重绘）
- `dist/js/main.js` 的 `rewardIcon()` 与 `dist/index.html` 钱包 chip 均加 `?v=33` 破缓存
- 全站版本参数 `v=32` → `v=33`（82 处）
- `art-source/items/` 留档 `xuanwu1..5.png` + 四象 4 级对照图

只换了一张图，**没有改奖励数值、存档结构、翻牌逻辑、战斗物理与 HUD**。

## 五、可复现命令

```bash
# 归属反查
python3 -c "
import os,hashlib
t=hashlib.md5(open('dist/assets/ui/icon-stones.png','rb').read()).hexdigest()
for dp,_,fs in os.walk('/tmp/gunny-orig/Tank.Flash/resource/v1.1/image/unfrightprop'):
    for f in fs:
        p=os.path.join(dp,f)
        if hashlib.md5(open(p,'rb').read()).hexdigest()==t: print(os.path.relpath(p,dp))
"
grep -n 'Pic="xuanwu' /tmp/gunny-orig/GameAdmin/Backup/XMLReader/XMLImport/TemplateAlllist.xml
```

## 六、给后来者的提醒

**别再按目录名猜道具。** `stones` 不是「石头总称」，`unfrightprop` 下 811 个目录名与中文道具名
不是一一对应关系，唯一可靠的映射是 `TemplateAlllist.xml` 的 `Pic` → `Name` → `TemplateID`。
