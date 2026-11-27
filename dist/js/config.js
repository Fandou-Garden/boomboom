/**
 * Central configuration for Gunny Wind Arena.
 *
 * “SOURCE” values are copied from the pinned Gunny commit, including the
 * XML data backups GameAdmin/Backup/XMLReader/XMLImport/LoadMapsItems.xml
 * (map 1156, Atlantis) and BallList.xml (ball 243). “TEMP” marks values whose database
 * rows or art assets are not readable in this checkout. Never scatter tuning
 * constants through gameplay code — change them here.
 */
export const BUILD_VERSION = '3.0.0';
export const SOURCE_COMMIT = '057c71aab877b42ebf08258aa5c642adc6a039ec';
export const SOURCE_REPO = 'https://github.com/phucdz2kk4/Gunny';

export const WORLD = Object.freeze({
  // SOURCE: LoadMapsItems.xml ID=1156 ForegroundWidth/Height = 1843×1020.
  // The shipped back.jpg is 1447×1020 and is tiled horizontally at native
  // resolution. The Go server, renderer and minimap share this one size.
  mapId: 1156,
  name: '亚特兰蒂斯',
  width: 1843,
  height: 1020,
  sourceWidth: 1843,
  mirrorAxis: 1843,
  backgroundTileWidth: 1447,
  // Keep the bottom rows uncarved; 1156 has no source bedrock row.
  bedrockY: 1015,
  // PORT: source MapInfo PosX/PosX1 are not in the readable XML export.
  // These two flat Atlantis ledges keep the original 1400 px / 70 m distance.
  spawnX: [240, 1640],
  spawnProbeY: 200,
  pixelsPerMetre: 20, // NEW: display-only conversion for distance/elevation.
  groundBottom: 1000,
  // Foreground/collision updates are local to 256×256 chunks.
  chunkSize: 256,
});

export const PHYSICS = Object.freeze({
  // SOURCE: SimpleBomb.StartMoving() advances in 0.04 s steps.
  dt: 1 / 25,

  // SOURCE: Player.FORCE_MAX / EnergyView.FORCE_MAX.
  forceMax: 2000,

  // SOURCE: LoadMapsItems.xml, Item ID=1156, Weight=10.
  mapGravity: 10,

  // SOURCE: BallList.xml, Item ID=243 (weapon 70322 common ball), Mass=10.
  mass: 10,

  // SOURCE: BallList.xml ID=243, Weight=70 (gravity multiplier).
  gravityFactor: 70,

  // SOURCE: LoadMapsItems.xml, Item ID=1156, DragIndex=2.
  mapDragIndex: 2,

  // SOURCE: BallList.xml ID=243, DragIndex=1 (air resistance multiplier).
  airResistFactor: 1,

  // SOURCE: BallList.xml ID=243, Wind=240. Multiplied by m_map.wind
  // in BombObject.UpdateAGW().
  windFactor: 240,

  // SOURCE: ShootImp() uses velocity = force * cos/sin(angle), scale 1.0.
  forceToVelocity: 1.0,

  // SOURCE: EnergyView SHOOT_FORCE_STEP=20 per ENTER_FRAME (30 fps), clamps
  // at FORCE_MAX and does not rebound. 20 * 30 = 600 force units per second.
  chargeRate: 600,

  maxFlightSeconds: 14,
});

export const WIND = Object.freeze({
  // SOURCE: GetNextWind() operates in tenths and targets [-40, 40).
  targetMin: -40,
  targetMax: 40,
  stepInclusiveMax: 10,
  valueMin: -4.0,
  valueMax: 4.0,
  // NEW: a mildly windy opening shot so the mechanic is visible immediately.
  initialAbsMax: 2.5,
});

export const BATTLE = Object.freeze({
  // NEW browser balance values. The Go server owns both HP values.
  playerMaxHp: 2000,
  enemyMaxHp: 2000,
  healAmount: 1000,
  healsPerRound: 1,
  healConsumesTurn: true,
  enableTrajectoryPreview: false,
  showLastPowerMarker: true,

  // NEW: mobile-style skills. They are all local, single-player turn actions;
  // there is no shop, inventory, room or networking attached to them.
  energyMax: 100,
  energyPerVolley: 12,
  energyPerHit: 20,
  energyPerHeal: 8,
  // NEW: 体力无限。渲染层显示 ∞；服务端也不再扣体力或阻止移动。
  staminaMax: 100,
  staminaMoveCost: 0,
  staminaIdleRegen: 0,
  staminaTurnRestore: 0,
  powDamageMultiplier: 1.8,
  powBlastRadius: 82,
  powCraterRadius: 78,
  // One tactical use of each battle item per player turn. Slots 1–3 are attack
  // patterns; slots 4–8 are additive damage amplifiers.
  skillUsesPerRound: {
    extra2: 1, scatter: 1, extra1: 1,
    boost50: 1, boost40: 1, boost30: 1, boost20: 1, boost10: 1,
  },
  // SOURCE TemplateAlllist 10001/10003/10002 and the matching game-logic
  // spells. +2 and +1 are counted shots (DamageScale 0.6/0.9); the 10003
  // item is a three-ray fan (DamageScale 0.5) with Living.ShootImp's
  // 0°/-5°/+5° force scales.
  skillDefs: {
    extra2: { label: '攻击 +2', kind: 'attack', badge: '+2', offsets: [0, 0, 0], forceScales: [1, 1, 1], damageScale: 0.6 },
    scatter: { label: '三向散射', kind: 'attack', badge: '×3', offsets: [0, -5, 5], forceScales: [1, 0.9, 1.1], damageScale: 0.5 },
    extra1: { label: '攻击 +1', kind: 'attack', badge: '+1', offsets: [0, 0], forceScales: [1, 1], damageScale: 0.9 },
    boost50: { label: '伤害增幅 50%', kind: 'boost', badge: '50', damageBonus: 0.5 },
    boost40: { label: '伤害增幅 40%', kind: 'boost', badge: '40', damageBonus: 0.4 },
    boost30: { label: '伤害增幅 30%', kind: 'boost', badge: '30', damageBonus: 0.3 },
    boost20: { label: '伤害增幅 20%', kind: 'boost', badge: '20', damageBonus: 0.2 },
    boost10: { label: '伤害增幅 10%', kind: 'boost', badge: '10', damageBonus: 0.1 },
  },
  countdownSeconds: 30,
  countdownDefault: false,
});

export const COMBAT = Object.freeze({
  // SOURCE: BallList.xml ID=243, Radii=55. Damage uses distance < radius
  // with 1 - distance/radius/4 falloff.
  blastRadius: 55,
  blastEdgeDamageFactor: 0.75, // implied by the source formula
  targetHitRadius: 36,

  // TEMP: BallList.xml ID=243 points at Crater=241, but that art folder is
  // absent from this checkout. A matching original crater (401) is used as
  // the alpha template; its radius is a browser tuning value.
  craterRadius: 58,
  craterKind: 'medium',
  // NEW: deterministic extra lobes and a deeper core make the crater less
  // perfectly round than the original single shape bitmap.
  craterLobeCount: 5,
  craterLobeDepth: 0.26,
  // TEMP: player combat statistics are rows in the SQL backup, not in the
  // readable XML dumps. The damage formula itself is from SimpleBomb.cs.
  baseDamage: 360,
  attack: 100,
  baseGuard: 80,
  defence: 40,
  lucky: 0,
  grade: 10,
  damagePlus: 1.0,
  shootMinus: 1.0,

  // SOURCE: GameCharacter uses 114×95 cells (3 rows × 13 frames) and draws
  // the bitmap at -62,-83 from the actor origin. The web build anchors the
  // visible feet/belly to the terrain instead so the prone sprite cannot sink.
  characterFrameWidth: 114,
  characterFrameHeight: 95,
  // SOURCE: 原版仅做水平翻转（GameLiving._actionMovie.scaleX = ±direction），
  // 角色按 114×95 单元格 1:1 原始尺寸绘制，不放大。此前的 1.55 为早期
  // 调屏值，导致角色相对地形（尤其原尺寸的 1156 亚特兰蒂斯）明显偏大。
  characterScale: 1.0,
  characterAnchorY: 95,
  slopeMaxDegrees: 22,

  // SOURCE: GamePlayer places the weapon at GameCharacter.weaponX/Y, and the
  // muzzle is sampled from the equipped weapon's local point. arm/bazooka3
  // is an 78×78 sheet; its barrel/grip were measured from the original PNG.
  weaponGripX: 19,
  weaponGripY: -31,
  weaponBarrelLength: 86,
  // SOURCE: 原版武器 MovieClip 仅随身体水平翻转（GamePlayer: weaponMovie.scaleX
  // = body.scaleX），不做缩放；此前的 1.35 是配合 1.55 角色放大的调屏值。
  weaponDrawScale: 1.0,
  weaponPivotX: 28,
  weaponPivotY: 52,
  weaponArtAngle: 45,

  actorWidth: 112,
  actorHeight: 92,

  // NEW: fall handling after a crater removes the ground under a character.
  // The projectile gravity comes from the source; character gravity is a
  // presentation/playability value.
  fallGravity: 950,
  fallMaxSpeed: 1100,
  fallDamage: 1200,

  // NEW: presentation / feel.
  resolveDelay: 1.25,
  damageFloatSeconds: 1.15,
});

export const TERRAIN = Object.freeze({
  solidAlphaThreshold: 100, // SOURCE: Tile(Bitmap) uses A <= 100 as empty.
  chunkSize: 256,
  // Original art ids from Tank.Flash/resource/v1.1/image/bomb/crater.
  // Crater=241 is referenced by ball 243 but missing; these are the closest
  // original shape/brink assets and are documented as a web substitution.
  craterTemplates: {
    small: { radius: 30, art: '50', lobes: 3, depth: 0.72 },
    medium: { radius: 58, art: '401', lobes: 5, depth: 1.0 },
    large: { radius: 92, art: '4', lobes: 6, depth: 1.28 },
    special: { radius: 84, art: '4', lobes: 7, depth: 1.35 },
  },
  maxCraters: 160,
  maxParticlesDesktop: 96,
  maxParticlesMobile: 44,
});

export const CONTROLS = Object.freeze({
  // SOURCE: WeaponInfo.as reads ItemTemplate.Property5/Property6.
  // TemplateAlllist.xml TemplateID=70322 (bazooka3) gives 15/65.
  angleMin: 15,
  angleMax: 65,
  startAngle: 45,
  // SOURCE: Player.MOVE_SPEED=2, GameLiving.stepX=3 at ~30 fps => ~90 px/s.
  moveSpeed: 90,
  // NEW continuous hold controls.
  angleSpeed: 42,
  angleTapStep: 1,
  // SOURCE: EnergyView increments 20 force per frame and clamps at 2000.
  // The browser reads the same linear wall-clock ramp; there is no rebound.
  chargeSweepSeconds: 100 / 30,
  // NEW desktop mouse scrub gestures (pixels → degrees).
  angleDragPerPixel: 0.55,
  minFireForce: 20,
  // NEW: prevents a ghost shot if a pointer is cancelled immediately.
  minChargeSeconds: 0.08,
  // Reject climbing ledges taller than this.
  maxStepUp: 10,
  maxStepDownWhileWalking: 16,
});

export const AI = Object.freeze({
  // NEW: local opponent.
  thinkSeconds: 0.9,
  aimSeconds: 0.48,
  coarseAngleStep: 3,
  fineAngleStep: 1,
  coarseForceStep: 40,
  fineForceStep: 10,
  // Imperfect aim keeps the duel beatable; both values are browser additions.
  angleNoise: 1.6,
  forceNoise: 28,
  solveIterations: 2,
});

export const VIEW = Object.freeze({
  // NEW world camera. The screen is only a viewport into WORLD.
  defaultMode: 'player',
  modes: ['player', 'both', 'shot'],
  baseZoomFactor: 2.5,
  baseZoomMin: 0.5,
  baseZoomMax: 1.05,
  minZoomFloor: 0.34,
  // Wide both-player framing may zoom out below the old cover floor. It is a
  // uniform scale (never a non-proportional squeeze) and only adds sky/world
  // margin, so the original 2000 px map and spawn points remain untouched.
  minZoomWide: 0.11,
  maxZoom: 1.15,
  // Put the followed ground line at 62% of screen height.
  focusBottomFraction: 0.62,
  bothPaddingX: 46,
  bothPaddingY: 78,
  bothActorMarginX: 220,
  bothActorMarginY: 210,
  // Shift the pair slightly left of centre so the right skill rail never
  // covers the opponent on narrow landscape phones.
  bothHudRightBias: 20,
  // Negative keeps the camera below the actors so both stay above the HUD.
  bothCameraShift: -0.01,
  shotLookAheadSeconds: 0.14,
  smoothTime: 0.36,
  zoomSmoothTime: 0.32,
  skyOverscan: 900,
  hintMargin: 46,
});

export const COLORS = Object.freeze({
  player: '#56e0d2',
  playerDark: '#0e7f8f',
  enemy: '#ffad66',
  enemyDark: '#a64f31',
  gold: '#ffd36a',
  cream: '#f4fbff',
  ink: '#062735',
});
