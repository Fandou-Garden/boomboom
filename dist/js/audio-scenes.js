/**
 * 原版 BGM 场景映射（服务端版 + 站点版共用）。
 *
 * 证据来源（2026-11-28 实测，详见 docs/AUDIO_EVIDENCE.md）：
 *  - Tank.Request/LoadMapsItems.xml（zlib 压缩，解压后 454 条 <Item>）的 BackMusic 字段。
 *    地图音乐编号 **不等于** 地图编号：1157 -> 1071、1049 -> 1032。
 *  - BaseRoomState.as  playMusic("065")  房间
 *  - HallStateView.as  playMusic("062")  大厅
 *  - GameViewBase.as   读取地图 BackMusic  战斗
 *  - SoundManager.as:395  SITE_MAIN + "sound/" + id + ".flv" 流式播放
 *
 * 长音乐原件：/tmp/gunny-30/inetpub/wwwroot/Resource/sound/<id>.flv
 * （Macromedia Flash Video，内嵌 MPEG-1/2 Layer III 64 kbps 22.05 kHz 帧）。
 * 本项目用 FLV tag 解析**无损抽出 MP3 帧**，不重编码；文件名见 bgmFileFor()。
 * 1156.flv 在旧版对照库中存在（1.53 MB），已补齐此前记录的「缺失」项。
 *
 * 战前加载：原版未找到独立音乐调用证据，本模块**不提供** loading 场景，
 * 沿用既有「同一条地图 BGM 压低音量」的处理，不凭印象配乐。
 */

/** 本站 12 张地图 -> LoadMapsItems.xml 的 BackMusic。 */
export const MAP_BACK_MUSIC = Object.freeze({
  1001: '1001',
  1002: '1002',
  1003: '1003',
  1008: '1008',
  1014: '1014',
  1035: '1035',
  1038: '1038',
  1156: '1156',
  // 下面两张明确证明「音乐编号 ≠ 地图编号」
  1157: '1071',
  1190: '1190',
  1192: '1192',
  1049: '1032',
});

/** 非战斗场景：房间 / 大厅（原版 ID，不是自造 BGM）。 */
export const SCENE_MUSIC = Object.freeze({
  room: '065',
  hall: '062',
});

/** 把场景 + 地图 ID 解析成本项目 assets/audio 下的文件名。 */
export function bgmFileFor(scene, mapId = null) {
  if (scene === 'room') return 'assets/audio/bgm-room-065.mp3';
  if (scene === 'hall') return 'assets/audio/bgm-hall-062.mp3';
  const id = MAP_BACK_MUSIC[String(mapId)] || '1001';
  return `assets/audio/bgm-map-${id}.mp3`;
}

/** 给 UI / 测试看的映射摘要，不含任何推测值。 */
export function audioSceneDebug() {
  return { mapBackMusic: { ...MAP_BACK_MUSIC }, sceneMusic: { ...SCENE_MUSIC } };
}
