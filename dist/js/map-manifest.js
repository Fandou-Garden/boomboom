/**
 * Map catalogue and staged-loading plan.
 *
 * core  — five maps available from the first frame; thumbnails are rendered
 *         by the picker immediately and their fore/back/collision are already
 *         on disk for the current map.
 * extra — five maps downloaded on demand (four artefacts each) when the user
 *         taps the card; a completed download is remembered in localStorage
 *         so the next visit shows the card as ready without re-downloading.
 * maya  — the new "玛雅废墟" (original map 1049, "Thành Cổ (nhỏ)" stone-ruin
 *         arena). Source: Tank.Flash/resource/v1.1/image/map/1049/.
 *         NOTE: the literal "Maya hoang tán" map (112) has no fore.png /
 *         fore.map in the source tree, so it cannot satisfy the project's
 *         pixel-identical collision rule; 1049 is the resource-complete
 *         stone-ruin map used to fill this slot (see docs/MAPS.md).
 *
 * Asset paths mirror main.js boot() and standalone-api.js so the browser HTTP
 * cache serves a loaded map with no extra request after ?map= reload.
 */
const WORLD_SIZE = Object.freeze({ width: 1843, height: 1020 });

export const MAP_MANIFEST = Object.freeze({
  core: Object.freeze([
    { id: '1156', name: '亚特兰蒂斯', source: 'Tank.Flash/resource/v1.1/image/map/1156/' },
    { id: '1001', name: '彩虹云端', source: 'Tank.Flash/resource/v1.1/image/map/1001/' },
    { id: '1038', name: '岩石岛群', source: 'Tank.Flash/resource/v1.1/image/map/1038/' },
    { id: '1157', name: '竹海日落', source: 'Tank.Flash/resource/v1.1/image/map/1157/' },
    { id: '1190', name: '天空之城', source: 'Tank.Flash/resource/v1.1/image/map/1190/' },
  ]),
  extra: Object.freeze([
    { id: '1002', name: '暗夜城堡', source: 'Tank.Flash/resource/v1.1/image/map/1002/' },
    { id: '1003', name: '七彩泡泡', source: 'Tank.Flash/resource/v1.1/image/map/1003/' },
    { id: '1008', name: '瀑布孤岛', source: 'Tank.Flash/resource/v1.1/image/map/1008/' },
    { id: '1014', name: '热带海滩', source: 'Tank.Flash/resource/v1.1/image/map/1014/' },
    { id: '1035', name: '沙漠枯树', source: 'Tank.Flash/resource/v1.1/image/map/1035/' },
  ]),
  maya: Object.freeze({ id: '1049', name: '玛雅废墟', source: 'Tank.Flash/resource/v1.1/image/map/1049/' }),
  worldSize: WORLD_SIZE,
});

export const CORE_IDS = Object.freeze(MAP_MANIFEST.core.map((m) => m.id));
export const EXTRA_IDS = Object.freeze([...MAP_MANIFEST.extra.map((m) => m.id), MAP_MANIFEST.maya.id]);
export const ALL_IDS = Object.freeze([...CORE_IDS, ...EXTRA_IDS]);
export const LOADED_KEY_PREFIX = 'gunny.map.loaded.';

/** The four artefacts fetched for an on-demand map. */
export function mapAssetUrls(id) {
  return {
    thumb: `assets/map-${id}-thumb.jpg`,
    fore: `assets/map-${id}-fore.webp`,
    back: `assets/map-${id}-back.jpg`,
    collision: `data/${id}.fore.map.gz`,
  };
}

export function isCoreMap(id) {
  return CORE_IDS.includes(String(id));
}
