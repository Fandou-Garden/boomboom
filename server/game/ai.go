package game

import (
	"math"
	"math/rand"
)

// AIPlan is the browser-only opponent solution. The original checkout has no
// concrete aiming brain, so this remains an explicit NEW feature.
type AIPlan struct {
	Angle       float64   `json:"angle"`
	Force       float64   `json:"force"`
	Direction   int       `json:"direction"`
	Expected    SimResult `json:"expected"`
	SolvedAngle float64   `json:"solvedAngle"`
	SolvedForce float64   `json:"solvedForce"`
}

type candidate struct {
	angle            float64
	force            float64
	muzzleX, muzzleY float64
	result           SimResult
	score            float64
}

func scoreCandidate(shooter, target *Actor, terrain *Terrain, wind, angle, force float64, direction int) candidate {
	mx, my := MuzzlePoint(shooter, angle, direction)
	r := SimulateShot(mx, my, angle, force, direction, wind, target, terrain, MaxFlightSeconds, false)
	score := r.Closest
	if r.Impact == "out" {
		score += 600
	}
	if math.IsInf(score, 1) || math.IsNaN(score) {
		score = 9999
	}
	return candidate{angle: angle, force: force, muzzleX: mx, muzzleY: my, result: r, score: score}
}

// ChooseShot ports the browser AI search used by v5. Coordinates and ballistics
// are the same source equations; only the search policy is a NEW addition.
func ChooseShot(shooter, target *Actor, wind float64, terrain *Terrain, rng *rand.Rand) AIPlan {
	return chooseShotInRange(shooter, target, wind, terrain, rng, StartAngle, AngleMin, AngleMax)
}

func ChooseShotForWeapon(shooter, target *Actor, wind float64, terrain *Terrain, rng *rand.Rand, weapon WeaponDef) AIPlan {
	return chooseShotInRange(shooter, target, wind, terrain, rng, weapon.StartAngle, weapon.AngleMin, weapon.AngleMax)
}

func chooseShotInRange(shooter, target *Actor, wind float64, terrain *Terrain, rng *rand.Rand, startAngle, angleMin, angleMax float64) AIPlan {
	direction := 1
	if target.X < shooter.X {
		direction = -1
	}
	best := candidate{score: math.Inf(1), angle: startAngle, force: 1200}

	for angle := angleMin; angle <= angleMax; angle += 3 {
		for force := 300.0; force <= ForceMax; force += 40 {
			c := scoreCandidate(shooter, target, terrain, wind, angle, force, direction)
			adjusted := c.score + math.Abs(force-1400)*0.002
			if adjusted < best.score {
				c.score = adjusted
				best = c
			}
		}
	}

	centerAngle, centerForce := best.angle, best.force
	for angle := math.Max(angleMin, centerAngle-4); angle <= math.Min(angleMax, centerAngle+4); angle += 1 {
		for force := math.Max(300, centerForce-100); force <= math.Min(ForceMax, centerForce+100); force += 10 {
			c := scoreCandidate(shooter, target, terrain, wind, angle, force, direction)
			if c.score < best.score {
				best = c
			}
		}
	}

	angle := best.angle + triangularNoise(rng)*1.6
	force := best.force + triangularNoise(rng)*28
	angle = Clamp(angle, angleMin, angleMax)
	force = Clamp(force, 420, ForceMax)
	return AIPlan{
		Angle: angle, Force: force, Direction: direction,
		Expected: best.result, SolvedAngle: best.angle, SolvedForce: best.force,
	}
}

func triangularNoise(rng *rand.Rand) float64 {
	return (rng.Float64() + rng.Float64() + rng.Float64() - 1.5) / 1.5
}
