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
	Carry    bool    `json:"carry,omitempty"`
	Shells   int     `json:"shells"`
	Shell    int     `json:"shell,omitempty"`
	Followup bool    `json:"followup,omitempty"`
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
	attackPenalty := 1.0
	firedSkill := ""
	sequential := false
	// SOURCE: Player.UseFlySkill() -> CarrySpell:SetBall(3). A carry ball is a
	// single shell with Power=0 / Crater="" (BallList ID=3): it replaces the
	// volley entirely, so POW and attack items are ignored for this shot.
	carry := index == 0 && m.CarryArmed && m.CanCarry
	pow := index == 0 && !carry && m.PowSelected && m.Energy >= EnergyMax
	// SOURCE: bombconfig.xml Common/Special → BallList.xml。普通击用 Common 弹，
	// POW 大招用 Special 弹：弹数(Amount)、伤害系数(Power)、爆炸半径(Radii)与
	// 弹坑(Crater) 全部取自 BallList 该弹行；雷霆(151)/烈火(171)/水果篮(411)/
	// 马桶(371) 的大招是三连发（Amount=3，Power 0.5~0.6），其余大招单发加伤。
	ball := BallFor(weapon.BallID)
	if pow {
		ball = BallFor(weapon.SpecialBallID)
	}
	ballPower := ball.Power
	if carry {
		ballPower = 0
	}
	if carry {
		offsets = []float64{0}
		scales = []float64{1}
	} else if pow && ball.Amount > 1 {
		// SOURCE: BallList Amount=3 的大招（151/171/371/411）按 Player.ShootImp
		// 顺序发射同一向量；scales 必须全 1（make 的零值会把力度压成 1）。
		offsets = make([]float64, ball.Amount)
		scales = make([]float64, ball.Amount)
		for i := range scales {
			scales[i] = 1
		}
		sequential = true
	} else if index == 0 && m.SelectedSkill != "" {
		if def, ok := SkillDefs[m.SelectedSkill]; ok && def.Kind == "attack" && m.SkillUses[m.SelectedSkill] > 0 {
			offsets = def.Offsets
			scales = def.ForceScales
			sequential = def.Sequential
			attackPenalty = def.DamageScale
			firedSkill = def.ID
		}
	}
	// 4–8 are additive damage amplifiers. SOURCE AddWoudSpell adds
	// CurrentDamagePlus, while the attack items scale CurrentShootMinus;
	// the two multipliers therefore apply multiplicatively.
	damageBonus := 0.0
	if index == 0 && !pow {
		for _, id := range m.SelectedBuffs {
			if def, ok := SkillDefs[id]; ok && def.Kind == "boost" && m.SkillUses[id] > 0 {
				damageBonus += def.DamageBonus
			}
		}
	}
	damageScale := (1 + damageBonus) * attackPenalty

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
			Weapon: weapon.ID, CraterArt: ball.Crater, BlastRadius: ball.Radii,
			DamageScale: damageScale * ballPower, Pow: pow,
		}
		if carry {
			// BallList ID=3: Power=0, Crater="" — no damage, no crater. The
			// impact translates the owner to the landing point instead.
			p.Carry = true
			p.DamageScale = 0
			p.CraterArt = ""
		}
		shots = append(shots, p)
	}

	// Extra attack items replay the same launch vector: the first shell flies
	// and resolves, then the next one is launched from the same muzzle with the
	// same angle/force. Scatter keeps all three shells in flight together.
	activeShots := shots
	m.QueuedShots = nil
	m.VolleyTotal = len(shots)
	if sequential && len(shots) > 1 {
		activeShots = shots[:1]
		m.QueuedShots = shots[1:]
	}
	m.Shots = activeShots
	m.Shot = activeShots[0]
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
		m.Stats.PlayerShots += len(activeShots)
		if carry {
			// One fly per turn: consume the armed shot and the availability,
			// mirroring Player.CanFly / m_flyCoolDown in PrepareNewTurn.
			m.CarryArmed = false
			m.CanCarry = false
		} else if pow {
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
		m.Stats.EnemyShots += len(activeShots)
	}

	if pow {
		m.EmitLocked("sound", map[string]any{"name": "pow"})
	}
	m.EmitLocked("sound", map[string]any{"name": "fire", "weapon": weapon.ID})
	m.EmitLocked("fire", FireEvent{
		Actor: index, X: a.X, Y: a.Y, Angle: baseAngle, Force: safeForce,
		Skill: firedSkill, Weapon: weapon.ID, Pow: pow, Carry: carry, Shells: len(shots), VolleyID: volleyID,
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

// resolveCarryImpactLocked ports Game.Logic/Phy/Object/SimpleBomb.cs
// BombType.FLY: the shell is a teleport ball (BallList ID=3, Power=0,
// Crater=""). On landing it steps back 5 px along the reversed velocity to
// sit on the surface, then translates its owner to that point and re-seats
// them on the terrain. No crater is carved and no damage is dealt.
func (m *Match) resolveCarryImpactLocked(p *Projectile, ix, iy int, impactType string) {
	owner := m.Actors[p.Owner]
	// Back off along -v, normalised to 5 (source: PointF(-vX,-vY).Normalize(5)).
	tx, ty := float64(ix), float64(iy)
	if impactType == "ground" || impactType == "actor" {
		vx, vy := p.VX, p.VY
		length := math.Hypot(vx, vy)
		if length > 0.0001 {
			tx -= vx / length * 5
			ty -= vy / length * 5
		}
	}
	lx := int(math.Round(Clamp(tx, 70, WorldWidth-70)))
	// Find the ground at the landing column so the transported actor stands on
	// the surface rather than being left inside the terrain.
	landY := 0
	fromY := int(math.Max(0, math.Min(float64(m.Terrain.Height-1), ty-8)))
	if gy, ok := m.Terrain.FindGroundY(lx, fromY, m.Terrain.Height-1); ok {
		landY = gy
	} else if gy, ok := m.Terrain.FindGroundY(lx, 0, m.Terrain.Height-1); ok {
		landY = gy
	} else {
		landY = GroundBottom
	}
	if owner != nil && owner.Alive {
		owner.X = float64(lx)
		owner.Y = float64(landY)
		owner.VY = 0
		owner.Falling = false
		owner.Grounded = true
		owner.Slope = m.Terrain.SlopeAt(owner.X, owner.Y, 22)
		owner.WalkDirection = 0
		owner.WalkAccum = 0
		m.refreshSupportLocked(owner)
	}
	impact := &Impact{X: float64(lx), Y: float64(landY), Type: "carry", Owner: p.Owner, Shell: p.Slot, Shells: p.Shells}
	m.LastImpact = impact
	if p.Owner == 0 {
		m.LastPlayerSummary = fmt.Sprintf("第 %d 回合 · 传送到落点", m.Round)
	}
	// TRANSLATE is consumed by the client to play the teleport effect; it also
	// carries the final actor position so late joiners stay in sync.
	m.EmitLocked("translate", map[string]any{
		"actor": p.Owner, "x": float64(lx), "y": float64(landY), "shell": p.Slot,
	})
	m.EmitLocked("sound", map[string]any{"name": "carry"})
	m.EmitLocked("impact", impact)
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
	// SOURCE: SimpleBomb.cs BombType.FLY. A carry ball has Power=0/Crater="",
	// so instead of carving and dealing damage it backs off 5 px along the
	// reversed velocity and translates the OWNER to that spot (SetXY +
	// StartMoving); the client plays TRANSLATE -> Living.transmit()).
	if p.Carry {
		m.resolveCarryImpactLocked(p, ix, iy, impactType)
		return
	}
	attacker := m.Actors[p.Owner]
	target := m.Actors[1-p.Owner]
	impact := &Impact{
		X: float64(ix), Y: float64(iy), Type: impactType,
		Owner: p.Owner, Shell: p.Slot, Shells: p.Shells,
	}
	if impactType == "ground" || impactType == "actor" {
		// SOURCE: BallList.xml — 弹坑(Crater)与爆炸半径(Radii)来自该发弹自身，
		// 不再按 POW 全局覆盖。
		art := p.CraterArt
		if art == "" {
			art = m.weaponForActor(p.Owner).CraterArt
		}
		kind := "medium"
		radius := p.BlastRadius
		if radius <= 0 {
			radius = BlastRadius
		}
		if radius >= 60 {
			kind = "large"
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
		// SOURCE: SimpleBomb.MakeDamage —— 弹的 Power 系数在发射时已并入
		// DamageScale（普通弹 1.0，大招弹 1.5/1.3/0.6/0.5，carry 弹 0）。
		damage = int(float64(damage) * p.DamageScale)
		if damage < 0 {
			damage = 0
		}
		// SOURCE: SimpleBomb.BombImp -> Living.MakeCriticalDamage(p2, damage).
		// damage and critical are passed SEPARATELY to Living.TakeDamage, so
		// the victim loses their sum and the client draws two numbers. A
		// dedicated RNG keeps crit rolls out of the wind / AI streams.
		critical := 0
		if damage > 0 && target.Alive {
			roll := 99
			if m.CritRNG != nil {
				roll = m.CritRNG.Intn(100)
			}
			critical = SourceCriticalDamage(CriticalLucky, CriticalReduce, damage, roll)
		}
		total := damage + critical
		impact.Damage = damage
		impact.Critical = critical
		impact.Distance = distance
		if total > 0 && target.Alive {
			target.HP -= total
			target.Flash = 1
			target.HurtTimer = 0.5
			if p.Owner == 0 {
				m.Stats.PlayerHits++
				m.Stats.PlayerDamageDealt += total
				m.Energy = math.Min(EnergyMax, m.Energy+EnergyPerHit)
			} else {
				m.Stats.EnemyHits++
				m.Stats.PlayerDamageTaken += total
			}
			m.EmitLocked("sound", map[string]any{"name": "hit"})
			if critical > 0 {
				m.EmitLocked("sound", map[string]any{"name": "critical"})
			}
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
			if impact.Critical > 0 {
				m.LastPlayerSummary = fmt.Sprintf("第 %d 回合 · 暴击 %d+%d 伤害", m.Round, impact.Damage, impact.Critical)
			} else {
				m.LastPlayerSummary = fmt.Sprintf("第 %d 回合 · 命中 %d 伤害", m.Round, impact.Damage)
			}
		} else {
			m.LastPlayerSummary = fmt.Sprintf("第 %d 回合 · 未命中", m.Round)
		}
	}
	m.LastImpact = impact
	m.EmitLocked("impact", impact)
}

// launchQueuedShotLocked starts the next shell of a sequential attack item.
// The projectile was created at fire time, so it keeps the exact same muzzle,
// elevation and force as the first shell.
func (m *Match) launchQueuedShotLocked() bool {
	if len(m.QueuedShots) == 0 {
		return false
	}
	p := m.QueuedShots[0]
	m.QueuedShots = m.QueuedShots[1:]
	m.Shots = []*Projectile{p}
	m.Shot = p
	m.Phase = "flight"
	m.Timer = 0
	m.FlightAccumulator = 0
	if p.Owner == 0 {
		m.Stats.PlayerShots++
	} else {
		m.Stats.EnemyShots++
	}
	m.EmitLocked("sound", map[string]any{"name": "fire", "weapon": p.Weapon})
	m.EmitLocked("fire", FireEvent{
		Actor: p.Owner, X: p.X, Y: p.Y, Angle: p.Elevation, Force: p.Force,
		Skill: p.Skill, Weapon: p.Weapon, Pow: p.Pow, Shells: p.Shells,
		Shell: p.Slot, Followup: true, VolleyID: p.VolleyID,
	})
	return true
}

func (m *Match) finishFlightLocked() {
	if m.Phase != "flight" {
		return
	}
	// A killed target ends the volley immediately; otherwise replay the same
	// launch vector for the remaining extra shells.
	if m.PendingWinner == nil && m.launchQueuedShotLocked() {
		return
	}
	shotCount := m.VolleyTotal
	if shotCount == 0 {
		shotCount = len(m.Shots)
	}
	m.Shot = nil
	m.Shots = nil
	m.QueuedShots = nil
	m.VolleyTotal = 0
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
		m.CarryArmed = false
		m.CanCarry = true // SOURCE Player.PrepareNewTurn(): CanFly = true
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
