// Package game is an authoritative server-side port of the Gunny battle rules.
//
// SOURCE values are copied from the pinned Gunny checkout:
//
//	Game.Logic/Living.ShootImp, Game.Logic/Phy/Object/{BombObject,SimpleBomb}.cs,
//	Game.Logic/Phy/Maths/EulerVector.cs, Game.Logic/BaseGame.GetNextWind,
//	Game.Logic/Phy/Maps/{Map,Tile}.cs and the XML rows for map 1156 / ball 243.
//
// PORT values are coordinate/clock adapters required by the browser world.
// NEW values are browser-only features (heal, POW, scatter) kept behind the
// same explicit names so the UI can label them honestly.
package game

import "math"

const (
	SourceCommit = "057c71aab877b42ebf08258aa5c642adc6a039ec"

	// SOURCE: LoadMapsItems.xml Item ID=1156 (Atlantis).
	// Foreground 1843×1020; the shipped back.jpg is 1447×1020. The XML's
	// declared 1100×775 backdrop is the same art at a 1.316× smaller scale.
	MapID               = 1156
	MapName             = "Atlantis"
	WorldWidth          = 1843
	WorldHeight         = 1020
	SourceWidth         = 1843
	BackgroundTileWidth = 1447
	GroundBottom        = 1000
	SpawnProbeY         = 200
	PixelsPerMetre      = 20

	// PORT: 1156 has solid bottom rows but no fully-solid source bedrock row
	// like 1001. Protect the last five rows so deep or stacked craters cannot
	// dig through the arena floor.
	BedrockY = 1015

	// SOURCE: SimpleBomb.StartMoving advances in 0.04 s steps.
	PhysicsDT = 0.04

	// SOURCE: Player.FORCE_MAX / EnergyView.FORCE_MAX.
	ForceMax = 2000.0

	// SOURCE: LoadMapsItems.xml ID=1156 Weight=10 DragIndex=2.
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
// from its SQL MapInfo row; that row is not in the readable XML export. These
// two flat Atlantis ledges (left y=389, right y=522) are a documented PORT;
// they keep the original 1400 px / 70 m duel distance.
var SpawnX = [2]float64{240, 1640}

// MapProfile carries the per-map world values that cannot be inferred from the
// collision bitmap alone. The browser can switch maps by reloading with
// ?map=1001 or ?map=1156; the WASM constructor selects the matching profile
// from the bitmap header.
type MapProfile struct {
	ID                  int
	Name                string
	Width               int
	Height              int
	SourceWidth         int
	BackgroundTileWidth int
	GroundBottom        int
	SpawnProbeY         int
	BedrockY            int
	SpawnX              [2]float64
}

var MapProfiles = map[int]MapProfile{
	1156: {
		ID: 1156, Name: "Atlantis",
		Width: WorldWidth, Height: WorldHeight,
		SourceWidth: SourceWidth, BackgroundTileWidth: BackgroundTileWidth,
		GroundBottom: GroundBottom, SpawnProbeY: SpawnProbeY,
		BedrockY: BedrockY, SpawnX: SpawnX,
	},
	// SOURCE: LoadMapsItems.xml ID=1001 (Cầu vồng), Foreground 2000×1425;
	// BackroundWidht=1526, Weight=10, DragIndex=2. Spawn/probe values match
	// the pre-Atlantis browser port and land on the two low cloud shelves.
	1001: {
		ID: 1001, Name: "Rainbow",
		Width: 2000, Height: 1425,
		SourceWidth: 2000, BackgroundTileWidth: 1526,
		GroundBottom: 1410, SpawnProbeY: 700,
		BedrockY: 1282, SpawnX: [2]float64{300, 1700},
	},
}

func MapProfileFor(id int) MapProfile {
	if profile, ok := MapProfiles[id]; ok {
		return profile
	}
	return MapProfiles[MapID]
}

func MapProfileForSize(width, height int) MapProfile {
	for _, id := range []int{MapID, 1001} {
		profile := MapProfiles[id]
		if profile.Width == width && profile.Height == height {
			return profile
		}
	}
	// Unknown maps remain usable for tests and future art: keep the Atlantis
	// gameplay constants but use the real bitmap dimensions.
	profile := MapProfiles[MapID]
	profile.ID = 0
	profile.Name = "Custom"
	profile.Width = width
	profile.Height = height
	profile.SourceWidth = width
	profile.GroundBottom = height - 20
	profile.BedrockY = height - 5
	profile.SpawnX = [2]float64{float64(width) * 0.13, float64(width) * 0.87}
	return profile
}

// WeaponDef is the browser's authoritative projection of one classic Gunny
// weapon. Every visual/geometry field is traceable to the original XML/SWF:
//
//	石斧     TemplateAlllist 7001       Pic=axe         Ball=20   Angle=25-60
//	弓箭     TemplateAlllist 7002       Pic=bow         Ball=18   Angle=35-65
//	AK-48   TemplateAlllist 7003       Pic=gun         Ball=22   Angle=35-60
//	黄金枪   TemplateAlllist 7005       Pic=goldgun     Ball=30   Angle=20-40
//	烈火     TemplateAlllist 7006/7103  Pic=bombpack    Ball=161  Angle=20-50
//	轰天     TemplateAlllist 7007/7104  Pic=bomb        Ball=101  Angle=55-70
//	风神     TemplateAlllist 7008/7105  Pic=dart        Ball=121  Angle=15-50
//	雷霆     TemplateAlllist 7009/7106  Pic=electricbar Ball=141  Angle=25-60
//	司马砸缸 TemplateAlllist 7010/7107  Pic=brick       Ball=381  Angle=20-65
//	水果篮   TemplateAlllist 7011/7108  Pic=fruit       Ball=401  Angle=20-50
//	手术刀   TemplateAlllist 7012/7109  Pic=OPSbox      Ball=341  Angle=15-45
//	马桶     TemplateAlllist 7013/7110  Pic=closestool  Ball=361  Angle=20-45
//	黑白家电 TemplateAlllist 7014/7111  Pic=television  Ball=321  Angle=50-70
//
// Ball IDs are the Common column of Tank.Request/BombConfig.xml, not the
// Property1 field (BombConfig overrides it). Official 4399 weapon data uses the
// same angles; 7055 Storch is the Olympic-torch skin, not 烈火.
//
// The browser needs one shared 55 px ball for the duel balance, so only the
// visual particle, weapon sprite, angle range and crater art vary. The crater
// art is selected from the three original shapes shipped by this checkout;
// per-ball crater PNGs are not part of the shared terrain atlas.
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

var WeaponOrder = []string{
	"axe", "bow", "gun", "goldgun", "fire", "cannon", "wind",
	"thunder", "brick", "fruit", "scalpel", "toilet", "appliance",
}

var WeaponDefs = map[string]WeaponDef{
	"axe": {
		ID: "axe", Label: "石斧", Trait: "低角 · 大坑重击", Source: "Template 7001 · Pic axe · Ball 20",
		Pic: "axe", BallID: "20", Projectile: "axe",
		AngleMin: 25, AngleMax: 60, StartAngle: 42, CraterArt: "4",
		WeaponSprite: "weapon-axe",
	},
	"bow": {
		ID: "bow", Label: "弓箭", Trait: "高角 · 轻巧速射", Source: "Template 7002 · Pic bow · Ball 18",
		Pic: "bow", BallID: "18", Projectile: "bow",
		AngleMin: 35, AngleMax: 65, StartAngle: 50, CraterArt: "50",
		WeaponSprite: "weapon-bow",
	},
	"gun": {
		ID: "gun", Label: "AK-48", Trait: "高角 · 稳定火力", Source: "Template 7003 · Pic gun · Ball 22",
		Pic: "gun", BallID: "22", Projectile: "gun",
		AngleMin: 35, AngleMax: 60, StartAngle: 48, CraterArt: "50",
		WeaponSprite: "weapon-gun",
	},
	"goldgun": {
		ID: "goldgun", Label: "黄金枪", Trait: "低角 · 黄金弹幕", Source: "Template 7005 · Pic goldgun · Ball 30",
		Pic: "goldgun", BallID: "30", Projectile: "goldgun",
		AngleMin: 20, AngleMax: 40, StartAngle: 30, CraterArt: "50",
		WeaponSprite: "weapon-goldgun",
	},
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
	"wind": {
		ID: "wind", Label: "风神", Trait: "低角 · 高敏先手", Source: "Template 7008/7105 · Pic dart · Ball 121",
		Pic: "dart", BallID: "121", Projectile: "wind",
		AngleMin: 15, AngleMax: 50, StartAngle: 35, CraterArt: "50",
		WeaponSprite: "weapon-wind",
	},
	"thunder": {
		ID: "thunder", Label: "雷霆", Trait: "中角 · 雷暴爆发", Source: "Template 7009/7106 · Pic electricbar · Ball 141",
		Pic: "electricbar", BallID: "141", Projectile: "thunder",
		AngleMin: 25, AngleMax: 60, StartAngle: 42, CraterArt: "401",
		WeaponSprite: "weapon-thunder",
	},
	"brick": {
		ID: "brick", Label: "司马砸缸", Trait: "广角 · 巨坑压制", Source: "Template 7010/7107 · Pic brick · Ball 381",
		Pic: "brick", BallID: "381", Projectile: "brick",
		AngleMin: 20, AngleMax: 65, StartAngle: 42, CraterArt: "4",
		WeaponSprite: "weapon-brick",
	},
	"fruit": {
		ID: "fruit", Label: "水果篮", Trait: "中角 · 敏幸均衡", Source: "Template 7011/7108 · Pic fruit · Ball 401",
		Pic: "fruit", BallID: "401", Projectile: "fruit",
		AngleMin: 20, AngleMax: 50, StartAngle: 35, CraterArt: "401",
		WeaponSprite: "weapon-fruit",
	},
	"scalpel": {
		ID: "scalpel", Label: "手术刀", Trait: "低角 · 精准切割", Source: "Template 7012/7109 · Pic OPSbox · Ball 341",
		Pic: "OPSbox", BallID: "341", Projectile: "scalpel",
		AngleMin: 15, AngleMax: 45, StartAngle: 30, CraterArt: "50",
		WeaponSprite: "weapon-scalpel",
	},
	"toilet": {
		ID: "toilet", Label: "马桶", Trait: "低角 · 刁钻弹道", Source: "Template 7013/7110 · Pic closestool · Ball 361",
		Pic: "closestool", BallID: "361", Projectile: "toilet",
		AngleMin: 20, AngleMax: 45, StartAngle: 32, CraterArt: "401",
		WeaponSprite: "weapon-toilet",
	},
	"appliance": {
		ID: "appliance", Label: "黑白家电", Trait: "高角 · 四维均衡", Source: "Template 7014/7111 · Pic television · Ball 321",
		Pic: "television", BallID: "321", Projectile: "appliance",
		AngleMin: 50, AngleMax: 70, StartAngle: 60, CraterArt: "50",
		WeaponSprite: "weapon-appliance",
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
