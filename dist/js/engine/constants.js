/**
 * Pure-JS port of server/game/config.go.
 *
 * “SOURCE” values are copied from the pinned Gunny checkout; “PORT” values are
 * coordinate/clock adapters for the browser world; “NEW” values are
 * browser-only features. Keep this file in lockstep with the Go server — it is
 * still the reference implementation.
 */

export const SOURCE_COMMIT = '057c71aab877b42ebf08258aa5c642adc6a039ec';

export const MAP_ID = 1156;
export const MAP_NAME = 'Atlantis';
export const WORLD_WIDTH = 1843;
export const WORLD_HEIGHT = 1020;
export const SOURCE_WIDTH = 1843;
export const BACKGROUND_TILE_WIDTH = 1447;
export const GROUND_BOTTOM = 1000;
export const SPAWN_PROBE_Y = 200;
export const PIXELS_PER_METRE = 20;

export const BEDROCK_Y = 1015;

export const PHYSICS_DT = 0.04;
export const FORCE_MAX = 2000.0;

export const MAP_GRAVITY = 10.0;
export const MAP_DRAG_INDEX = 2.0;

export const BALL_MASS = 10.0;
export const GRAVITY_FACTOR = 70.0;
export const WIND_FACTOR = 240.0;
export const AIR_RESIST_FACTOR = 1.0;
export const BLAST_RADIUS = 55.0;

export const TARGET_HIT_RADIUS = 36.0;

export const BASE_DAMAGE = 360.0;
export const ATTACK = 100.0;
export const BASE_GUARD = 80.0;
export const DEFENCE = 40.0;
export const GRADE = 10.0;
export const LUCKY = 0.0;
export const DAMAGE_PLUS = 1.0;
export const SHOOT_MINUS = 1.0;

export const CRITICAL_LUCKY = 180.0;
export const CRITICAL_REDUCE = 0.0;

export const PLAYER_MAX_HP = 2000;
export const ENEMY_MAX_HP = 2000;

export const HEAL_AMOUNT = 1000;
export const HEALS_PER_ROUND = 1;
export const ENERGY_MAX = 100.0;
export const ENERGY_PER_VOLLEY = 12.0;
export const ENERGY_PER_HIT = 20.0;
export const ENERGY_PER_HEAL = 8.0;
export const STAMINA_MAX = 100.0;
export const STAMINA_MOVE_COST = 0.0;
export const STAMINA_IDLE_REGEN = 0.0;
export const STAMINA_TURN_RESTORE = 0.0;
// POW no longer uses a global multiplier/radius/crater: SOURCE BallList.xml
// gives every ball its own Power/Radii/Crater/Amount, and POW fires the
// weapon's Special ball (see BALL_DEFS).

export const ANGLE_MIN = 15.0;
export const ANGLE_MAX = 65.0;
export const START_ANGLE = 45.0;

export const MOVE_SPEED = 90.0;
export const MOVE_STEP_X = 3;
export const MOVE_STEP_Y = 7;

export const CHARGE_RATE = 600.0;
export const MIN_FIRE_FORCE = 20.0;
export const MIN_CHARGE_SECONDS = 0.08;

export const RESOLVE_DELAY = 2.0;
export const HEAL_DELAY = 0.9;
export const ENEMY_MOVE_SECONDS = 0.72;
export const ENEMY_MOVE_SPEED = 64.8;
export const ENEMY_THINK_SECONDS = 0.9;
export const ENEMY_AIM_SECONDS = 0.48;
export const COUNTDOWN_SECONDS = 30.0;
export const MAX_FLIGHT_SECONDS = 14.0;

export const FIXED_WIND = true;

export const WEAPON_GRIP_X = 19.0;
export const WEAPON_GRIP_Y = -31.0;
export const WEAPON_BARREL_LENGTH = 86.0;
export const ACTOR_WIDTH = 112.0;
export const ACTOR_HEIGHT = 92.0;
export const FALL_GRAVITY = 950.0;
export const FALL_MAX_SPEED = 1100.0;
export const DAMAGE_FLOAT_SECONDS = 1.15;

export const SPAWN_X = [240, 1640];

export const DEFAULT_PLAYER_WEAPON = 'fruit';
export const DEFAULT_ENEMY_WEAPON = 'cannon';

export const WEAPON_ORDER = [
  'axe', 'bow', 'gun', 'goldgun', 'fire', 'cannon', 'wind',
  'thunder', 'brick', 'fruit', 'scalpel', 'toilet', 'appliance',
];

// SOURCE: GameAdmin/Backup/XMLReader/XMLImport/BallList.xml. Power = damage
// multiplier, radii = blast radius (px), crater = crater art id, amount =
// shells per volley, actionType = fire pose (0 throw / 1 gun). Missing crater
// art falls back to the existing 4/50/401 mapping; 121/131/411 use originals.
export const BALL_DEFS = {
  20: { id: '20', power: 1.0, radii: 55, crater: '4', amount: 1, actionType: 0 },
  21: { id: '21', power: 1.5, radii: 65, crater: '401', amount: 1, actionType: 0 },
  18: { id: '18', power: 1.0, radii: 50, crater: '50', amount: 1, actionType: 1 },
  19: { id: '19', power: 1.5, radii: 59, crater: '401', amount: 1, actionType: 1 },
  22: { id: '22', power: 1.0, radii: 55, crater: '50', amount: 1, actionType: 1 },
  23: { id: '23', power: 1.5, radii: 65, crater: '401', amount: 1, actionType: 1 },
  30: { id: '30', power: 1.0, radii: 55, crater: '50', amount: 1, actionType: 1 },
  31: { id: '31', power: 1.5, radii: 65, crater: '401', amount: 1, actionType: 1 },
  101: { id: '101', power: 1.0, radii: 55, crater: '401', amount: 1, actionType: 1 },
  111: { id: '111', power: 1.3, radii: 65, crater: '401', amount: 1, actionType: 1 },
  121: { id: '121', power: 1.0, radii: 55, crater: '121', amount: 1, actionType: 0 },
  131: { id: '131', power: 1.5, radii: 65, crater: '131', amount: 1, actionType: 0 },
  141: { id: '141', power: 1.0, radii: 55, crater: '401', amount: 1, actionType: 1 },
  151: { id: '151', power: 0.6, radii: 65, crater: '401', amount: 3, actionType: 1 },
  161: { id: '161', power: 1.0, radii: 55, crater: '401', amount: 1, actionType: 0 },
  171: { id: '171', power: 0.6, radii: 45, crater: '4', amount: 3, actionType: 0 },
  341: { id: '341', power: 1.0, radii: 55, crater: '50', amount: 1, actionType: 0 },
  351: { id: '351', power: 1.5, radii: 65, crater: '401', amount: 1, actionType: 0 },
  381: { id: '381', power: 1.0, radii: 55, crater: '4', amount: 1, actionType: 0 },
  391: { id: '391', power: 1.5, radii: 65, crater: '401', amount: 1, actionType: 0 },
  401: { id: '401', power: 1.0, radii: 55, crater: '401', amount: 1, actionType: 0 },
  411: { id: '411', power: 0.5, radii: 65, crater: '411', amount: 3, actionType: 0 },
  361: { id: '361', power: 1.0, radii: 55, crater: '401', amount: 1, actionType: 1 },
  371: { id: '371', power: 0.5, radii: 65, crater: '401', amount: 3, actionType: 1 },
  321: { id: '321', power: 1.0, radii: 55, crater: '50', amount: 1, actionType: 0 },
  331: { id: '331', power: 1.5, radii: 65, crater: '401', amount: 1, actionType: 0 },
};

export function ballFor(id) {
  const key = String(id);
  return BALL_DEFS[key] || { id: key, power: 1.0, radii: BLAST_RADIUS, crater: '50', amount: 1, actionType: 1 };
}

export const WEAPON_DEFS = {
  axe: {
    id: 'axe', label: '石斧', trait: '低角 · 大坑重击', source: 'Template 7001 · Pic axe · Ball 20',
    pic: 'axe', ballId: '20', specialBallId: '21', projectile: 'axe',
    angleMin: 25, angleMax: 60, startAngle: 42, craterArt: '4',
    weaponSprite: 'weapon-axe',
  },
  bow: {
    id: 'bow', label: '弓箭', trait: '高角 · 轻巧速射', source: 'Template 7002 · Pic bow · Ball 18',
    pic: 'bow', ballId: '18', specialBallId: '19', projectile: 'bow',
    angleMin: 35, angleMax: 65, startAngle: 50, craterArt: '50',
    weaponSprite: 'weapon-bow',
  },
  gun: {
    id: 'gun', label: 'AK-48', trait: '高角 · 稳定火力', source: 'Template 7003 · Pic gun · Ball 22',
    pic: 'gun', ballId: '22', specialBallId: '23', projectile: 'gun',
    angleMin: 35, angleMax: 60, startAngle: 48, craterArt: '50',
    weaponSprite: 'weapon-gun',
  },
  goldgun: {
    id: 'goldgun', label: '黄金枪', trait: '低角 · 黄金弹幕', source: 'Template 7005 · Pic goldgun · Ball 30',
    pic: 'goldgun', ballId: '30', specialBallId: '31', projectile: 'goldgun',
    angleMin: 20, angleMax: 40, startAngle: 30, craterArt: '50',
    weaponSprite: 'weapon-goldgun',
  },
  fire: {
    id: 'fire', label: '烈火', trait: '中角 · 高攻爆发', source: 'Template 7006/7103 · Pic bombpack · Ball 161 · Crater 161',
    pic: 'bombpack', ballId: '161', specialBallId: '171', projectile: 'fire',
    angleMin: 20, angleMax: 50, startAngle: 35, craterArt: '401',
    weaponSprite: 'weapon-fire',
  },
  cannon: {
    id: 'cannon', label: '轰天', trait: '高角 · 重炮挖坑', source: 'Template 7007/7104 · Pic bomb · Ball 101 · Crater 101',
    pic: 'bomb', ballId: '101', specialBallId: '111', projectile: 'cannon',
    angleMin: 55, angleMax: 70, startAngle: 65, craterArt: '401',
    weaponSprite: 'weapon-cannon',
  },
  wind: {
    id: 'wind', label: '风神', trait: '低角 · 高敏先手', source: 'Template 7008/7105 · Pic dart · Ball 121',
    pic: 'dart', ballId: '121', specialBallId: '131', projectile: 'wind',
    angleMin: 15, angleMax: 50, startAngle: 35, craterArt: '50',
    weaponSprite: 'weapon-wind',
  },
  thunder: {
    id: 'thunder', label: '雷霆', trait: '中角 · 雷暴爆发', source: 'Template 7009/7106 · Pic electricbar · Ball 141',
    pic: 'electricbar', ballId: '141', specialBallId: '151', projectile: 'thunder',
    angleMin: 25, angleMax: 60, startAngle: 42, craterArt: '401',
    weaponSprite: 'weapon-thunder',
  },
  brick: {
    id: 'brick', label: '司马砸缸', trait: '广角 · 巨坑压制', source: 'Template 7010/7107 · Pic brick · Ball 381',
    pic: 'brick', ballId: '381', specialBallId: '391', projectile: 'brick',
    angleMin: 20, angleMax: 65, startAngle: 42, craterArt: '4',
    weaponSprite: 'weapon-brick',
  },
  fruit: {
    id: 'fruit', label: '水果篮', trait: '中角 · 敏幸均衡', source: 'Template 7011/7108 · Pic fruit · Ball 401',
    pic: 'fruit', ballId: '401', specialBallId: '411', projectile: 'fruit',
    angleMin: 20, angleMax: 50, startAngle: 35, craterArt: '401',
    weaponSprite: 'weapon-fruit',
  },
  scalpel: {
    id: 'scalpel', label: '手术刀', trait: '低角 · 精准切割', source: 'Template 7012/7109 · Pic OPSbox · Ball 341',
    pic: 'OPSbox', ballId: '341', specialBallId: '351', projectile: 'scalpel',
    angleMin: 15, angleMax: 45, startAngle: 30, craterArt: '50',
    weaponSprite: 'weapon-scalpel',
  },
  toilet: {
    id: 'toilet', label: '马桶', trait: '低角 · 刁钻弹道', source: 'Template 7013/7110 · Pic closestool · Ball 361',
    pic: 'closestool', ballId: '361', specialBallId: '371', projectile: 'toilet',
    angleMin: 20, angleMax: 45, startAngle: 32, craterArt: '401',
    weaponSprite: 'weapon-toilet',
  },
  appliance: {
    id: 'appliance', label: '黑白家电', trait: '高角 · 四维均衡', source: 'Template 7014/7111 · Pic television · Ball 321',
    pic: 'television', ballId: '321', specialBallId: '331', projectile: 'appliance',
    angleMin: 50, angleMax: 70, startAngle: 60, craterArt: '50',
    weaponSprite: 'weapon-appliance',
  },
};

// SOURCE: PrepareShootAction.doPrepareToShootAction() — ball.actionType 0 uses
// GameCharacter.SHOWTHROWS (throw), 1 uses SHOWGUN (aim the gun). POW uses the
// Special ball's own action type.
for (const id of Object.keys(WEAPON_DEFS)) {
  const w = WEAPON_DEFS[id];
  w.actionType = ballFor(w.ballId).actionType;
  w.specialActionType = ballFor(w.specialBallId).actionType;
}

export function weaponFor(id) {
  return WEAPON_DEFS[id] || WEAPON_DEFS[DEFAULT_PLAYER_WEAPON];
}

export const SKILL_ORDER = [
  'extra2', 'scatter', 'extra1',
  'boost50', 'boost40', 'boost30', 'boost20', 'boost10',
];

export const SKILL_DEFS = {
  extra2: {
    id: 'extra2', label: '攻击 +2', kind: 'attack', badge: '+2',
    offsets: [0, 0, 0], forceScales: [1.0, 1.0, 1.0],
    sequential: true, damageScale: 0.6, damageBonus: 0, craterArt: '401', source: true,
  },
  scatter: {
    id: 'scatter', label: '三向散射', kind: 'attack', badge: '×3',
    offsets: [0, -5, 5], forceScales: [1.0, 0.9, 1.1],
    sequential: false, damageScale: 0.5, damageBonus: 0, craterArt: '401', source: true,
  },
  extra1: {
    id: 'extra1', label: '攻击 +1', kind: 'attack', badge: '+1',
    offsets: [0, 0], forceScales: [1.0, 1.0],
    sequential: true, damageScale: 0.9, damageBonus: 0, craterArt: '401', source: true,
  },
  boost50: { id: 'boost50', label: '伤害增幅 50%', kind: 'boost', badge: '50', damageScale: 1.0, damageBonus: 0.50, craterArt: '', source: false },
  boost40: { id: 'boost40', label: '伤害增幅 40%', kind: 'boost', badge: '40', damageScale: 1.0, damageBonus: 0.40, craterArt: '', source: false },
  boost30: { id: 'boost30', label: '伤害增幅 30%', kind: 'boost', badge: '30', damageScale: 1.0, damageBonus: 0.30, craterArt: '', source: false },
  boost20: { id: 'boost20', label: '伤害增幅 20%', kind: 'boost', badge: '20', damageScale: 1.0, damageBonus: 0.20, craterArt: '', source: false },
  boost10: { id: 'boost10', label: '伤害增幅 10%', kind: 'boost', badge: '10', damageScale: 1.0, damageBonus: 0.10, craterArt: '', source: false },
};

export function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function degToRad(d) {
  return (d * Math.PI) / 180;
}
