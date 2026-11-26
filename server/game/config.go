// Package game is an authoritative server-side port of the Gunny battle rules.
//
// SOURCE values are copied from the pinned Gunny checkout:
//
//	Game.Logic/Living.ShootImp, Game.Logic/Phy/Object/{BombObject,SimpleBomb}.cs,
//	Game.Logic/Phy/Maths/EulerVector.cs, Game.Logic/BaseGame.GetNextWind,
//	Game.Logic/Phy/Maps/{Map,Tile}.cs and the XML rows for map 1001 / ball 243.
//
// PORT values are coordinate/clock adapters required by the browser world.
// NEW values are browser-only features (heal, POW, scatter) kept behind the
// same explicit names so the UI can label them honestly.
package game

import "math"

const (
	SourceCommit = "057c71aab877b42ebf08258aa5c642adc6a039ec"

	// SOURCE: LoadMapsItems.xml Item ID=1001 (map 1001, "Cầu vồng").
	WorldWidth          = 2000
	WorldHeight         = 1425
	SourceWidth         = 2000
	BackgroundTileWidth = 1526
	GroundBottom        = 1410
	SpawnProbeY         = 700
	PixelsPerMetre      = 20

	// SOURCE: fore.map rows y>=1282 are a fully-solid 143-row bedrock base.
	// Craters are small enough in the original game that they never reach it,
	// so this floor survives every blast. PORT: enforce it explicitly so a
	// deep or stacked crater cannot dig through the arena floor.
	BedrockY = 1282

	// SOURCE: SimpleBomb.StartMoving advances in 0.04 s steps.
	PhysicsDT = 0.04

	// SOURCE: Player.FORCE_MAX / EnergyView.FORCE_MAX.
	ForceMax = 2000.0

	// SOURCE: LoadMapsItems.xml ID=1001 Weight=10 DragIndex=2.
	MapGravity   = 10.0
	MapDragIndex = 2.0

	// SOURCE: BallList.xml ID=243 Mass=10 Weight=70 Wind=240 DragIndex=1 Radii=55.
	BallMass        = 10.0
	GravityFactor   = 70.0
	WindFactor      = 240.0
	AirResistFactor = 1.0
	BlastRadius     = 55.0

	// PORT: 6x6 bomb rectangle + browser target body circle.
	TargetHitRadius = 36.0

	// TEMP: player combat rows are not readable from the shipped SQL backup.
	// The formula is source-exact; only these inputs are substitutes.
	BaseDamage = 360.0
	Attack     = 100.0
	BaseGuard  = 80.0
	Defence    = 40.0
	Grade      = 10.0
	Lucky      = 0.0
	DamagePlus = 1.0
	ShootMinus = 1.0

	// NEW browser duel balance: both sides now use the same source-like HP.
	PlayerMaxHP = 2000
	EnemyMaxHP  = 2000

	// NEW browser actions. They are not part of the original battle system.
	HealAmount      = 1000
	HealsPerRound   = 1
	EnergyMax       = 100.0
	EnergyPerVolley = 12.0
	EnergyPerHit    = 20.0
	EnergyPerHeal   = 8.0
	// NEW: 体力无限。保留字段供旧调试接口读取，但移动不扣体力，
	// 服务端也不再因体力耗尽而停下角色。
	StaminaMax          = 100.0
	StaminaMoveCost     = 0.0
	StaminaIdleRegen    = 0.0
	StaminaTurnRestore  = 0.0
	PowBlastRadius      = 82.0
	PowDamageMultiplier = 1.8
	PowCraterArt        = "4"

	// SOURCE: TemplateAlllist.xml TemplateID=70322 Property5/6 = 15/65.
	// 五种武器的实际角度范围来自各自 WeaponDef；这两个常量只作为
	// 旧测试与默认瞄准的后备范围。
	AngleMin   = 15.0
	AngleMax   = 65.0
	StartAngle = 45.0

	// PORT: source client walks 3 px per action frame at 30 fps.
	MoveSpeed = 90.0
	MoveStepX = 3
	MoveStepY = 7

	// SOURCE: EnergyView SHOOT_FORCE_STEP=20 per ENTER_FRAME, clamps at 2000.
	// 30 fps -> 600 force units per second. It does not rebound to zero.
	ChargeRate       = 600.0
	MinFireForce     = 20.0
	MinChargeSeconds = 0.08

	// SOURCE-ish timings. PVPGame waits for the bomb lifetime + 2 s before
	// handing over the turn; browser AI think/aim windows are presentation.
	ResolveDelay      = 2.0
	HealDelay         = 0.9
	EnemyMoveSeconds  = 0.72
	EnemyMoveSpeed    = 64.8
	EnemyThinkSeconds = 0.9
	EnemyAimSeconds   = 0.48
	CountdownSeconds  = 30.0
	MaxFlightSeconds  = 14.0

	// NEW (browser request): keep the wind constant for the whole duel so the
	// same angle + force always produces the same trajectory. The original
	// GetNextWind roll is retained in physics.go but is no longer applied each
	// turn. Set false to restore the original per-turn wind behaviour.
	FixedWind = true

	// PORT: source weapon grip / muzzle geometry measured from bazooka3.
	WeaponGripX        = 19.0
	WeaponGripY        = -31.0
	WeaponBarrelLength = 86.0
	ActorWidth         = 112.0
	ActorHeight        = 92.0
	FallGravity        = 950.0
	FallMaxSpeed       = 1100.0
	DamageFloatSeconds = 1.15
)

// SpawnX are the two duel spawn columns. The source server reads PosX/PosX1
// from its SQL MapInfo row; that row is not in the readable XML export, so the
// symmetric beach positions are a documented PORT.
var SpawnX = [2]float64{300, 1700}

// WeaponDef is the browser's authoritative projection of one classic Gunny
// weapon. Every visual/geometry field is traceable to the original XML/SWF:
//
//	烈火     TemplateAlllist 7006/7103  Pic=bombpack   Ball=161  Angle=20-50
//	轰天     TemplateAlllist 7007/7104  Pic=bomb       Ball=101  Angle=55-70
//	水果篮   TemplateAlllist 7011/7108  Pic=fruit      Ball=401  Angle=20-50
//	黑白家电 TemplateAlllist 7014/7111  Pic=television Ball=321  Angle=50-70
//	风神     TemplateAlllist 7008/7105  Pic=dart       Ball=121  Angle=15-50
//
// Ball IDs are the Common column of Tank.Request/BombConfig.xml, not the
// Property1 field (BombConfig overrides it). Official 4399 weapon data uses the
// same angles; 7055 Storch is the Olympic-torch skin, not 烈火.
//
// The browser needs one shared 55 px ball for the duel balance, so only the
// visual particle, weapon sprite, angle range and crater art vary.
type WeaponDef struct {
	ID           string  `json:"id"`
	Label        string  `json:"label"`
	Source       string  `json:"source"`
	Trait        string  `json:"trait"`
	Pic          string  `json:"pic"`
	BallID       string  `json:"ballId"`
	Projectile   string  `json:"projectile"`
	AngleMin     float64 `json:"angleMin"`
	AngleMax     float64 `json:"angleMax"`
	StartAngle   float64 `json:"startAngle"`
	CraterArt    string  `json:"craterArt"`
	WeaponSprite string  `json:"weaponSprite"`
}

const (
	DefaultPlayerWeapon = "fruit"
	DefaultEnemyWeapon  = "cannon"
)

var WeaponOrder = []string{"fire", "cannon", "fruit", "appliance", "wind"}

var WeaponDefs = map[string]WeaponDef{
	"fire": {
		ID: "fire", Label: "烈火", Trait: "中角 · 高攻爆发", Source: "Template 7006/7103 · Pic bombpack · Ball 161 · Crater 161",
		Pic: "bombpack", BallID: "161", Projectile: "fire",
		AngleMin: 20, AngleMax: 50, StartAngle: 35, CraterArt: "401",
		WeaponSprite: "weapon-fire",
	},
	"cannon": {
		ID: "cannon", Label: "轰天", Trait: "高角 · 重炮挖坑", Source: "Template 7007/7104 · Pic bomb · Ball 101 · Crater 101",
		Pic: "bomb", BallID: "101", Projectile: "cannon",
		AngleMin: 55, AngleMax: 70, StartAngle: 65, CraterArt: "401",
		WeaponSprite: "weapon-cannon",
	},
	"fruit": {
		ID: "fruit", Label: "水果篮", Trait: "中角 · 敏幸均衡", Source: "Template 7011/7108 · Pic fruit · Ball 401",
		Pic: "fruit", BallID: "401", Projectile: "fruit",
		AngleMin: 20, AngleMax: 50, StartAngle: 35, CraterArt: "401",
		WeaponSprite: "weapon-fruit",
	},
	"appliance": {
		ID: "appliance", Label: "黑白家电", Trait: "高角 · 四维均衡", Source: "Template 7014/7111 · Pic television · Ball 321",
		Pic: "television", BallID: "321", Projectile: "appliance",
		AngleMin: 50, AngleMax: 70, StartAngle: 60, CraterArt: "50",
		WeaponSprite: "weapon-appliance",
	},
	"wind": {
		ID: "wind", Label: "风神", Trait: "低角 · 高敏先手", Source: "Template 7008/7105 · Pic dart · Ball 121",
		Pic: "dart", BallID: "121", Projectile: "wind",
		AngleMin: 15, AngleMax: 50, StartAngle: 35, CraterArt: "50",
		WeaponSprite: "weapon-wind",
	},
}

func WeaponFor(id string) WeaponDef {
	if def, ok := WeaponDefs[id]; ok {
		return def
	}
	return WeaponDefs[DefaultPlayerWeapon]
}

// SkillDef maps one battle-item slot to its effect. The eight slots follow the
// classic right-side battle-item bar (SharedManager.KEY_SET_ABLE):
//
//	10001 攻击 +2: 3 sequential shots on the same launch vector, damage ×0.6
//	10003 三向散射: 3 simultaneous shots at 0°/-5°/+5°, force ×1.0/×0.9/×1.1, damage ×0.5
//	10002 攻击 +1: 2 sequential shots on the same launch vector, damage ×0.9
//	10004–10008 伤害增幅 50/40/30/20/10%
//
// SOURCE AddAttackSpell.cs multiplies CurrentShootMinus by 0.6/0.9.
// SOURCE AddBallSpell.cs sets BallCount=3 and CurrentDamagePlus *= 0.5.
// SOURCE Living.ShootImp offsets the extra two scatter shells by -5°/+5°.
type SkillDef struct {
	ID          string    `json:"id"`
	Label       string    `json:"label"`
	Kind        string    `json:"kind"`
	Badge       string    `json:"badge"`
	Offsets     []float64 `json:"offsets,omitempty"`
	ForceScales []float64 `json:"forceScales,omitempty"`
	Sequential  bool      `json:"sequential,omitempty"`
	DamageScale float64   `json:"damageScale"`
	DamageBonus float64   `json:"damageBonus"`
	CraterArt   string    `json:"craterArt"`
	Source      bool      `json:"source"`
}

var SkillOrder = []string{
	"extra2", "scatter", "extra1",
	"boost50", "boost40", "boost30", "boost20", "boost10",
}

var SkillDefs = map[string]SkillDef{
	"extra2": {
		ID: "extra2", Label: "攻击 +2", Kind: "attack", Badge: "+2",
		Offsets: []float64{0, 0, 0}, ForceScales: []float64{1.0, 1.0, 1.0},
		Sequential: true, DamageScale: 0.6, CraterArt: "401", Source: true,
	},
	"scatter": {
		ID: "scatter", Label: "三向散射", Kind: "attack", Badge: "×3",
		Offsets: []float64{0, -5, 5}, ForceScales: []float64{1.0, 0.9, 1.1},
		DamageScale: 0.5, CraterArt: "401", Source: true,
	},
	"extra1": {
		ID: "extra1", Label: "攻击 +1", Kind: "attack", Badge: "+1",
		Offsets: []float64{0, 0}, ForceScales: []float64{1.0, 1.0},
		Sequential: true, DamageScale: 0.9, CraterArt: "401", Source: true,
	},
	"boost50": {
		ID: "boost50", Label: "伤害增幅 50%", Kind: "boost", Badge: "50",
		DamageScale: 1.0, DamageBonus: 0.50, Source: false,
	},
	"boost40": {
		ID: "boost40", Label: "伤害增幅 40%", Kind: "boost", Badge: "40",
		DamageScale: 1.0, DamageBonus: 0.40, Source: false,
	},
	"boost30": {
		ID: "boost30", Label: "伤害增幅 30%", Kind: "boost", Badge: "30",
		DamageScale: 1.0, DamageBonus: 0.30, Source: false,
	},
	"boost20": {
		ID: "boost20", Label: "伤害增幅 20%", Kind: "boost", Badge: "20",
		DamageScale: 1.0, DamageBonus: 0.20, Source: false,
	},
	"boost10": {
		ID: "boost10", Label: "伤害增幅 10%", Kind: "boost", Badge: "10",
		DamageScale: 1.0, DamageBonus: 0.10, Source: false,
	},
}

func Clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func DegToRad(d float64) float64 { return d * math.Pi / 180 }
