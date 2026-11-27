package game

import (
	"math"
	"math/rand"
)

// Euler mirrors Game.Logic/Phy/Maths/EulerVector. x0 is an int in C#, so the
// position update truncates toward zero every 0.04 s step.
type Euler struct {
	X0 float64
	X1 float64
	X2 float64
}

func (e *Euler) Step(m, af, f, dt float64) {
	e.X2 = (f - af*e.X1) / m
	e.X1 += e.X2 * dt
	e.X0 = math.Trunc(e.X0 + e.X1*dt)
}

type TrailPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Projectile is the JSON projection of one SimpleBomb.
type Projectile struct {
	Owner       int          `json:"owner"`
	X           float64      `json:"x"`
	Y           float64      `json:"y"`
	PrevX       float64      `json:"prevX"`
	PrevY       float64      `json:"prevY"`
	VX          float64      `json:"vx"`
	VY          float64      `json:"vy"`
	AX          float64      `json:"ax"`
	AY          float64      `json:"ay"`
	Age         float64      `json:"age"`
	Alive       bool         `json:"alive"`
	Impact      string       `json:"impact,omitempty"`
	Direction   int          `json:"direction"`
	Elevation   float64      `json:"elevation"`
	Force       float64      `json:"force"`
	Trail       []TrailPoint `json:"trail"`
	VolleyID    string       `json:"volleyId"`
	Slot        int          `json:"slot"`
	Shells      int          `json:"shells"`
	Wave        int          `json:"wave,omitempty"`
	Waves       int          `json:"waves,omitempty"`
	WaveSize    int          `json:"waveSize,omitempty"`
	Skill       string       `json:"skill,omitempty"`
	Weapon      string       `json:"weapon,omitempty"`
	CraterArt   string       `json:"craterArt,omitempty"`
	DamageScale float64      `json:"damageScale"`
	Pow         bool         `json:"pow"`
	Resolved    bool         `json:"resolved"`
}

// NextWind is the exact branch shape of BaseGame.GetNextWind. The original
// compares the *old* num after updating; that quirk is intentionally kept.
func NextWind(value, target float64, rng *rand.Rand) (float64, float64) {
	num := trunc10(value)
	nextTarget := target
	var next float64
	if num > nextTarget {
		next = num - float64(randomInt(rng, 0, 11))
		if num <= nextTarget {
			nextTarget = float64(randomInt(rng, -40, 40))
		}
	} else {
		next = num + float64(randomInt(rng, 0, 11))
		if num >= nextTarget {
			nextTarget = float64(randomInt(rng, -40, 40))
		}
	}
	return next / 10, nextTarget
}

func trunc10(v float64) float64 {
	scaled := v * 10
	if scaled < 0 {
		return math.Ceil(scaled - 1e-7)
	}
	return math.Floor(scaled + 1e-7)
}

func randomInt(rng *rand.Rand, minInclusive, maxExclusive int) int {
	if maxExclusive <= minInclusive {
		return minInclusive
	}
	return minInclusive + rng.Intn(maxExclusive-minInclusive)
}

// Launch is the force*cos/sin part of Living.ShootImp with C# int truncation.
// Browser Y grows down, so the upward component is negated.
func Launch(force, elevation float64, direction int) (vx, vy float64) {
	rad := DegToRad(elevation)
	vx = float64(int(force*math.Cos(rad))) * float64(direction)
	vy = -float64(int(force * math.Sin(rad)))
	return vx, vy
}

// MuzzlePoint mirrors the browser's body-slope + weapon-grip transform.
func MuzzlePoint(a *Actor, elevation float64, direction int) (x, y float64) {
	slope := DegToRad(a.Slope)
	dx := float64(direction) * WeaponGripX
	dy := WeaponGripY
	gx := a.X + dx*math.Cos(slope) - dy*math.Sin(slope)
	gy := a.Y + dx*math.Sin(slope) + dy*math.Cos(slope)
	rad := DegToRad(elevation)
	return gx + float64(direction)*math.Cos(rad)*WeaponBarrelLength,
		gy - math.Sin(rad)*WeaponBarrelLength
}

type SimResult struct {
	X, Y       float64
	Impact     string
	Closest    float64
	ClosestX   float64
	ClosestY   float64
	Age        float64
	Path       []TrailPoint
	HitActor   bool
	HitGround  bool
	OutOfWorld bool
}

// StepProjectile advances one 0.04 s Euler step and then walks the source
// BombObject.MoveTo 3 px sub-steps with a 6x6 terrain rectangle.
func StepProjectile(p *Projectile, target *Actor, terrain *Terrain, wind float64) {
	startX, startY := p.X, p.Y
	p.PrevX, p.PrevY = startX, startY
	arf := MapDragIndex * AirResistFactor
	gf := MapGravity * GravityFactor * BallMass
	wf := wind * WindFactor
	p.AX = (wf - arf*p.VX) / BallMass
	p.AY = (gf - arf*p.VY) / BallMass
	p.VX += p.AX * PhysicsDT
	p.VY += p.AY * PhysicsDT
	p.X = math.Trunc(p.X + p.VX*PhysicsDT)
	p.Y = math.Trunc(p.Y + p.VY*PhysicsDT)
	p.Age += PhysicsDT

	dx, dy := p.X-startX, p.Y-startY
	dist := math.Hypot(dx, dy)
	substeps := int(math.Ceil(dist / MoveStepX))
	if substeps < 1 {
		substeps = 1
	}
	for i := 1; i <= substeps; i++ {
		t := float64(i) / float64(substeps)
		x, y := startX+dx*t, startY+dy*t
		if p.Age > 0.07 && target != nil && target.Alive {
			tx, ty := target.X, target.Y-38
			if (x-tx)*(x-tx)+(y-ty)*(y-ty) <= TargetHitRadius*TargetHitRadius {
				p.X, p.Y = x, y
				p.Impact = "actor"
				p.Alive = false
				return
			}
		}
		if terrain.IsSolidRect(int(math.Floor(x))-3, int(math.Floor(y))-3, 6, 6) {
			p.X, p.Y = x, y
			p.Impact = "ground"
			p.Alive = false
			return
		}
		if isProjectileOut(x, y, terrain.Width, terrain.Height) {
			p.X, p.Y = x, y
			p.Impact = "out"
			p.Alive = false
			return
		}
	}
	p.X = startX + dx
	p.Y = startY + dy
}

func isProjectileOut(x, y float64, width, height int) bool {
	return x < -60 || x > float64(width)+60 || y > float64(height)+80 || y < -float64(height)*2
}

// IsProjectileOut keeps the original 1156 helper for callers outside Match.
func IsProjectileOut(x, y float64) bool {
	return isProjectileOut(x, y, WorldWidth, WorldHeight)
}

// SimulateShot is the deterministic AI/acceptance simulator. It uses the same
// Euler + 3 px collision model as a live shell but does not mutate terrain.
func SimulateShot(originX, originY, angle, force float64, direction int, wind float64, target *Actor, terrain *Terrain, maxSeconds float64, includePath bool) SimResult {
	vx, vy := Launch(force, angle, direction)
	p := &Projectile{
		X: originX, Y: originY, VX: vx, VY: vy,
		Alive: true, Direction: direction, Elevation: angle, Force: force,
	}
	r := SimResult{Closest: math.Inf(1), ClosestX: originX, ClosestY: originY}
	if includePath {
		r.Path = []TrailPoint{{X: originX, Y: originY}}
	}
	centerY := 0.0
	if target != nil {
		centerY = target.Y - 38
	}
	maxSteps := int(math.Ceil(maxSeconds / PhysicsDT))
	for step := 0; step < maxSteps && p.Alive; step++ {
		StepProjectile(p, target, terrain, wind)
		if target != nil {
			d := math.Hypot(p.X-target.X, p.Y-centerY)
			if d < r.Closest {
				r.Closest, r.ClosestX, r.ClosestY = d, p.X, p.Y
			}
		}
		if includePath {
			r.Path = append(r.Path, TrailPoint{X: p.X, Y: p.Y})
		}
	}
	r.X, r.Y, r.Impact, r.Age = p.X, p.Y, p.Impact, p.Age
	r.HitActor = p.Impact == "actor"
	r.HitGround = p.Impact == "ground"
	r.OutOfWorld = p.Impact == "out"
	return r
}

// SourceDamage is MakeDamage from SimpleBomb.cs. C# (int) truncates toward
// zero; 0 is a valid return, while a negative formula returns 1.
func SourceDamage(distance, radius float64, attacker, defender *Actor) int {
	if math.IsNaN(distance) || distance >= radius {
		return 0
	}
	baseGuard := defender.BaseGuard
	defence := defender.Defence
	attack := attacker.Attack
	baseDamage := attacker.BaseDamage
	grade := attacker.Grade
	lucky := attacker.Lucky
	damagePlus := attacker.DamagePlus
	shootMinus := attacker.ShootMinus

	dr1 := 0.95 * (baseGuard - 3*grade) / (500 + baseGuard - 3*grade)
	dr2 := 0.0
	if defence-lucky >= 0 {
		dr2 = 0.95 * (defence - lucky) / (600 + defence - lucky)
	}
	dr3 := attacker.WorldBossAddDamage * (1 - (baseGuard/200 + defence*0.003))
	raw := (dr3 + baseDamage*(1+attack*0.001)*(1-(dr1+dr2-dr1*dr2))) * damagePlus * shootMinus
	falloff := 1 - distance/radius/4
	value := int(raw * falloff)
	if value < 0 {
		return 1
	}
	return value
}

func BlastDamage(target *Actor, impactX, impactY float64, attacker *Actor, radius float64) (damage int, distance float64) {
	dx := impactX - target.X
	dy := impactY - (target.Y - 38)
	distance = math.Hypot(dx, dy)
	return SourceDamage(distance, radius, attacker, target), distance
}
