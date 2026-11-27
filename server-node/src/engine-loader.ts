/**
 * 复用站点版已有的纯 JS 权威战斗引擎，不复制、不重写物理。
 *
 * dist/js/engine/ 是 Go server/game 的逐字段移植，tests/engine/parity.test.mjs
 * 保存了 Go 金标准。Node 的 ESM loader 支持 file URL 上的 ?v=33 查询串，
 * 因此这里可以直接 import 前端同一份源码，两种模式共用一套规则。
 *
 * 用变量做动态 import 以避免 TypeScript 对带查询串的 JS 模块做静态解析。
 */
const ENGINE_SPEC = '../../dist/js/engine/index.js?v=33';
const CONSTANTS_SPEC = '../../dist/js/engine/constants.js?v=33';
const MAPS_SPEC = '../../dist/js/maps.js?v=33';

export interface EngineLike {
  match: any;
  init(mapBytes: Uint8Array, a: unknown, b: unknown, c: unknown, debug: boolean): string;
  command(json: string): string;
  update(dt: number): null;
  snapshot(): string;
  events(): string;
  setAISolver(fn: ((job: any, done: (best: any) => void) => void) | null): void;
}

export const engineModule: any = await import(ENGINE_SPEC);
export const constants: any = await import(CONSTANTS_SPEC);
export const mapsModule: any = await import(MAPS_SPEC);

export const GunnyEngine: new () => EngineLike = engineModule.GunnyEngine;
export const WEAPON_ORDER: string[] = constants.WEAPON_ORDER;
export const WEAPON_DEFS: Record<string, any> = constants.WEAPON_DEFS;
export const BASE_ATTACK: number = Number(constants.ATTACK ?? 100);
export const MAPS: Array<{ id: string; name: string; trait: string }> = mapsModule.MAPS;
export const DEFAULT_MAP_ID: string = mapsModule.DEFAULT_MAP_ID;

export function isKnownMap(mapId: string): boolean {
  return MAPS.some((m) => m.id === mapId);
}

export function weaponLabel(id: string): string {
  return String(WEAPON_DEFS[id]?.label || id);
}
