/**
 * Selectable battle maps. Every map is resampled from the original Gunny
 * resource set (Tank.Flash/resource/v1.1/image/map/<id>/) onto the fixed
 * engine world size 1843x1020, because both authoritative engines (Go and the
 * JS port) read the world dimensions as constants (see server/game/config.go
 * and dist/js/engine/constants.js).
 *
 * For each map the three artefacts are generated from the SAME resampled
 * foreground, so the render alpha (A > 100) and the collision bitmask are
 * pixel-identical:
 *   - assets/map-<id>-back.jpg   tiled background (pre-baked to full width)
 *   - assets/map-<id>-fore.webp（无损）   visible destructible foreground
 *   - data/<id>.fore.map         [int32 w][int32 h][MSB-first row] bitmask
 *
 * The offline adapter (standalone-api.js) loads data/<id>.fore.map and the
 * client (main.js) loads the matching back/fore images. Both read the map id
 * from the ?map= query parameter, so selecting a map simply reloads the page.
 *
 * 1156 (Atlantis) is the original shipped map and stays the default so the
 * existing browser/physics tests (which omit ?map=) keep their terrain.
 */
export const MAPS = Object.freeze([
  { id: '1156', name: '亚特兰蒂斯', trait: '原版 · 竞技主场' },
  { id: '1001', name: '彩虹云端', trait: '经典 · 彩虹与浮空岛' },
  { id: '1002', name: '暗夜城堡', trait: '暗色 · 荆棘古堡' },
  { id: '1003', name: '七彩泡泡', trait: '奇趣 · 泡泡擂台' },
  { id: '1008', name: '瀑布孤岛', trait: '浮空 · 树屋瀑布' },
  { id: '1014', name: '热带海滩', trait: '明媚 · 椰林沙岸' },
  { id: '1035', name: '沙漠枯树', trait: '黄昏 · 荒漠枯木' },
  { id: '1038', name: '岩石岛群', trait: '灰岩 · 浮石群岛' },
  { id: '1157', name: '竹海日落', trait: '东方 · 竹海古道' },
  { id: '1190', name: '天空之城', trait: '遗迹 · 玛雅金字塔' },
  { id: '1192', name: '碧水绿丘', trait: '幻境 · 翡翠神殿' },
  { id: '1049', name: '玛雅废墟', trait: '遗迹 · 石柱古城废墟' },
]);

export const DEFAULT_MAP_ID = '1156';

export function resolveMapId(raw) {
  return MAPS.some((m) => m.id === raw) ? raw : DEFAULT_MAP_ID;
}

export function getMap(id) {
  const mapId = resolveMapId(id);
  return MAPS.find((m) => m.id === mapId);
}
