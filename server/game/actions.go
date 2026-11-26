package game

import (
	"fmt"
	"math"
)

type FireEvent struct {
	Actor    int     `json:"actor"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Angle    float64 `json:"angle"`
	Force    float64 `json:"force"`
	Skill    string  `json:"skill,omitempty"`
	Weapon   string  `json:"weapon,omitempty"`
	Pow      bool    `json:"pow"`
	Shells   int     `json:"shells"`
	VolleyID string  `json:"volleyId"`
}

func (m *Match) fireLocked(index int, angle, force float64) bool {
	if m.Phase == "over" || index < 0 || index > 1 {
		return false
	}
	a := m.Actors[index]
	target := m.Actors[1-index]
	if a == nil || target == nil || !a.Alive || !target.Alive {
		return false
	}
	if index == 0 && m.Phase != "player" {
		return false
	}
	if index == 1 && m.Phase != "enemy_aim" && m.Phase != "enemy_move" {
		return false
	}

	direction := 1
	if target.X < a.X {
		direction = -1
	}
	a.Facing = direction
	a.AimAngle = angle

	weapon := m.weaponForActor(index)
	offsets := []float64{0}
	scales := []float64{1}
	damageScale := 1.0
	firedSkill := ""
	pow := index == 0 && m.PowSelected && m.Energy >= EnergyMax
	if pow {
		// NEW browser POW: one heavy shell with the original crater-4 bitmap.
	} else if index == 0 && m.SelectedSkill != "" {
		if def, ok := SkillDefs[m.SelectedSkill]; ok && def.Kind == "attack" && m.SkillUses[m.SelectedSkill] > 0 {
			offsets = def.Offsets
			scales = def.ForceScales
			damageScale = def.DamageScale
			firedSkill = def.ID
		}
	}
	// 4–8 are additive damage amplifiers. They can be stacked before firing;
	// each selected amplifier is spent with the volley.
	if index == 0 && !pow {
		for _, id := range m.SelectedBuffs {
			if def, ok := SkillDefs[id]; ok && def.Kind == "boost" && m.SkillUses[id] > 0 {
				damageScale += def.DamageBonus
			}
		}
	}

	safeForce := Clamp(force, 1, ForceMax)
	baseAngle := Clamp(angle, weapon.AngleMin, weapon.AngleMax)
	volleyID := fmt.Sprintf("%d-%d-%d", m.Round, m.Turn, int(m.Time*1000))
	shots := make([]*Projectile, 0, len(offsets))
	for i, offset := range offsets {
		elevation := baseAngle + offset
		scale := 1.0
		if i < len(scales) {
			scale = scales[i]
		}
		f := Clamp(safeForce*scale, 1, ForceMax)
		mx, my := MuzzlePoint(a, elevation, direction)
		vx, vy := Launch(f, elevation, direction)
		p := &Projectile{
			Owner: index, X: mx, Y: my, PrevX: mx, PrevY: my,
			VX: vx, VY: vy, Alive: true, Direction: direction,
			Elevation: elevation, Force: f, Trail: []TrailPoint{{X: mx, Y: my}},
			VolleyID: volleyID, Slot: i, Shells: len(offsets), Skill: firedSkill,
			Weapon: weapon.ID, CraterArt: weapon.CraterArt,
			DamageScale: damageScale, Pow: pow,
		}
		shots = append(shots, p)
	}

	m.Shots = shots
	m.Shot = shots[0]
	m.Phase = "flight"
	m.Timer = 0
	m.FlightAccumulator = 0
	m.PendingWinner = nil
	m.Charging = false
	m.Force = 0
	m.ChargeElapsed = 0
	m.MoveDir = 0
	a.WalkDirection = 0
	a.FireTimer = 0.28
	lp := safeForce
	m.LastPower = &lp

	if index == 0 {
		m.Stats.PlayerShots += len(shots)
		if pow {
			m.Energy = 0
			m.PowSelected = false
		} else {
			m.Energy = math.Min(EnergyMax, m.Energy+EnergyPerVolley)
			if m.SelectedSkill != "" {
				if m.SkillUses[m.SelectedSkill] > 0 {
					m.SkillUses[m.SelectedSkill]--
				}
				m.SelectedSkill = ""
			}
			for _, id := range m.SelectedBuffs {
				if m.SkillUses[id] > 0 {
					m.SkillUses[id]--
				}
			}
			m.SelectedBuffs = nil
		}
	} else {
		m.Stats.EnemyShots += len(shots)
	}

	if pow {
		m.EmitLocked("sound", map[string]any{"name": "pow"})
	}
	m.EmitLocked("sound", map[string]any{"name": "fire", "weapon": weapon.ID})
	m.EmitLocked("fire", FireEvent{
		Actor: index, X: a.X, Y: a.Y, Angle: baseAngle, Force: safeForce,
		Skill: firedSkill, Weapon: weapon.ID, Pow: pow, Shells: len(shots), VolleyID: volleyID,
	})
	return true
}

func (m *Match) updateFlightLocked(dt float64) {
	m.FlightAccumulator += dt
	steps := 0
	for m.FlightAccumulator >= PhysicsDT && steps < 8 {
		m.FlightAccumulator -= PhysicsDT
		steps++
		for _, p := range m.Shots {
			if p == nil || !p.Alive {
				continue
			}
			target := m.Actors[1-p.Owner]
			StepProjectile(p, target, m.Terrain, m.Wind)
			if len(p.Trail) == 0 || math.Hypot(p.X-p.Trail[len(p.Trail)-1].X, p.Y-p.Trail[len(p.Trail)-1].Y) > 2 {
				if len(p.Trail) < 600 {
					p.Trail = append(p.Trail, TrailPoint{X: p.X, Y: p.Y})
				}
			}
			if !p.Alive {
				m.resolveImpactLocked(p)
			} else if p.Age >= MaxFlightSeconds {
				p.Alive = false
				p.Impact = "out"
				m.resolveImpactLocked(p)
			}
		}
	}

	alive := false
	for _, p := range m.Shots {
		if p != nil && p.Alive {
			alive = true
			m.Shot = p
			break
		}
	}
	if !alive {
		m.finishFlightLocked()
	}
}

func (m *Match) resolveImpactLocked(p *Projectile) {
	if p == nil || p.Resolved {
		return
	}
	p.Resolved = true
	impactType := p.Impact
	if impactType == "" {
		impactType = "out"
	}
	ix := int(math.Trunc(p.X))
	iy := int(math.Trunc(p.Y))
	p.X, p.Y = float64(ix), float64(iy)
	attacker := m.Actors[p.Owner]
	target := m.Actors[1-p.Owner]
	impact := &Impact{
		X: float64(ix), Y: float64(iy), Type: impactType,
		Owner: p.Owner, Shell: p.Slot, Shells: p.Shells,
	}
	if impactType == "ground" || impactType == "actor" {
		art := p.CraterArt
		if art == "" {
			art = m.weaponForActor(p.Owner).CraterArt
		}
		kind := "medium"
		radius := BlastRadius
		if p.Pow {
			art, kind, radius = PowCraterArt, "large", PowBlastRadius
		}
		removed, _, ok := m.Terrain.Carve(ix, iy, art, kind)
		impact.Removed, impact.CraterKind, impact.CraterArt = removed, kind, art
		_ = ok
		// A crater can erase the ground directly under a living actor. Refresh
		// support at the moment of the blast (not only at volley end) so the
		// actor starts falling / re-seats on the new surface immediately,
		// instead of walking on stale ground and sinking into the hole later.
		for _, a := range m.Actors {
			m.refreshSupportLocked(a)
		}
		damage, distance := BlastDamage(target, float64(ix), float64(iy), attacker, radius)
		damage = int(float64(damage) * p.DamageScale)
		if p.Pow {
			damage = int(float64(damage) * PowDamageMultiplier)
		}
		if damage < 0 {
			damage = 0
		}
		impact.Damage = damage
		impact.Distance = distance
		if damage > 0 && target.Alive {
			target.HP -= damage
			target.Flash = 1
			target.HurtTimer = 0.5
			if p.Owner == 0 {
				m.Stats.PlayerHits++
				m.Stats.PlayerDamageDealt += damage
				m.Energy = math.Min(EnergyMax, m.Energy+EnergyPerHit)
			} else {
				m.Stats.EnemyHits++
				m.Stats.PlayerDamageTaken += damage
			}
			m.EmitLocked("sound", map[string]any{"name": "hit"})
			if target.HP <= 0 {
				target.HP = 0
				target.Alive = false
				target.Falling = false
				target.VY = 0
				w := p.Owner
				m.PendingWinner = &w
				m.EmitLocked("sound", map[string]any{"name": "death"})
			}
		}
		m.EmitLocked("sound", map[string]any{"name": "explosion", "weapon": p.Weapon})
	} else {
		m.EmitLocked("sound", map[string]any{"name": "out"})
	}
	if p.Owner == 0 {
		if impact.Damage > 0 {
			m.LastPlayerSummary = fmt.Sprintf("第 %d 回合 · 命中 %d 伤害", m.Round, impact.Damage)
		} else {
			m.LastPlayerSummary = fmt.Sprintf("第 %d 回合 · 未命中", m.Round)
		}
	}
	m.LastImpact = impact
	m.EmitLocked("impact", impact)
}

func (m *Match) finishFlightLocked() {
	if m.Phase != "flight" {
		return
	}
	shotCount := len(m.Shots)
	m.Shot = nil
	m.Shots = nil
	m.FlightAccumulator = 0
	m.Phase = "resolve"
	m.Timer = ResolveDelay
	m.refreshSupportLocked(m.Actors[0])
	m.refreshSupportLocked(m.Actors[1])
	m.EmitLocked("volley-resolve", map[string]any{"pendingWinner": m.PendingWinner, "shots": shotCount})
}

func (m *Match) finishResolveLocked() {
	if m.PendingWinner != nil {
		w := *m.PendingWinner
		m.Winner = &w
		m.Phase = "over"
		m.Timer = 0
		m.Countdown = 0
		m.ShowCountdown = false
		m.EmitLocked("gameover", map[string]any{"winner": w})
		return
	}
	if !m.Actors[0].Alive || !m.Actors[1].Alive {
		if m.Actors[0].Alive {
			w := 0
			m.Winner = &w
		} else if m.Actors[1].Alive {
			w := 1
			m.Winner = &w
		}
		m.Phase = "over"
		m.EmitLocked("gameover", map[string]any{"winner": m.Winner})
		return
	}
	next := 1 - m.Turn
	if next == 0 {
		m.Round++
	}
	m.beginTurnLocked(next, true)
}

func (m *Match) beginTurnLocked(index int, rollWind bool) {
	m.Turn = index
	m.Force = 0
	m.Charging = false
	m.ChargeElapsed = 0
	m.MoveDir = 0
	m.AIPlan = nil
	m.AIMoveTarget = 0
	m.Shots = nil
	m.Shot = nil
	for _, a := range m.Actors {
		a.WalkDirection = 0
		a.WalkAccum = 0
		m.refreshSupportLocked(a)
		if a.Alive && !a.Falling {
			a.Slope = m.Terrain.SlopeAt(a.X, a.Y, 22)
		}
	}
	m.Actors[0].Facing = 1
	m.Actors[1].Facing = -1
	if m.Actors[1].X < m.Actors[0].X {
		m.Actors[0].Facing = -1
		m.Actors[1].Facing = 1
	}
	if rollWind && !FixedWind {
		m.Wind, m.WindTarget = NextWind(m.Wind, m.WindTarget, m.RNG)
		m.EmitLocked("wind", map[string]any{"wind": m.Wind, "label": m.WindLabelLocked()})
	}
	if index == 0 {
		m.Phase = "player"
		m.Timer = 0
		m.HealsRemaining = HealsPerRound
		for _, id := range SkillOrder {
			m.SkillUses[id] = 1
		}
		m.SelectedSkill = ""
		m.SelectedBuffs = nil
		m.PowSelected = false
		m.Stamina = StaminaMax
		m.Angle = Clamp(m.Angle, m.playerWeapon().AngleMin, m.playerWeapon().AngleMax)
		m.Actors[0].AimAngle = m.Angle
		m.Actors[0].Weapon = m.playerWeapon().ID
		m.Actors[1].Weapon = m.enemyWeapon().ID
		m.Countdown = CountdownSeconds
		m.ShowCountdown = false
		m.EmitLocked("turn", map[string]any{"turn": 0, "round": m.Round})
		m.EmitLocked("toast", map[string]any{"text": "你的回合：瞄准、蓄力、开炮"})
	} else {
		m.Phase = "enemy_move"
		m.Timer = EnemyMoveSeconds
		m.AIMoveTarget = m.chooseEnemyMoveTargetLocked()
		m.EnemyAimAngle = m.Actors[1].AimAngle
		m.EmitLocked("turn", map[string]any{"turn": 1, "round": m.Round})
		m.EmitLocked("toast", map[string]any{"text": "电脑的回合"})
	}
	tx, ty := m.MetricsLocked()
	m.ShowCountdown = false
	_ = tx
	_ = ty
}

func (m *Match) canHealLocked() bool {
	p := m.Actors[0]
	return m.Phase == "player" && !m.Charging && p.Alive && m.HealsRemaining > 0 && p.HP < p.MaxHP
}

func (m *Match) healLocked() bool {
	if !m.canHealLocked() {
		return false
	}
	p := m.Actors[0]
	amount := minInt(HealAmount, p.MaxHP-p.HP)
	if amount <= 0 {
		return false
	}
	p.HP += amount
	p.Flash = 0.5
	m.HealsRemaining--
	m.Stats.PlayerHeals++
	m.Stats.PlayerHealed += amount
	m.Energy = math.Min(EnergyMax, m.Energy+EnergyPerHeal)
	m.Charging = false
	m.MoveDir = 0
	m.Phase = "heal"
	m.Timer = HealDelay
	m.EmitLocked("heal", map[string]any{"amount": amount, "hp": p.HP, "maxHp": p.MaxHP, "heals": m.HealsRemaining})
	m.EmitLocked("sound", map[string]any{"name": "heal"})
	return true
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
