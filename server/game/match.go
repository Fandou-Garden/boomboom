package game

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
	"sync"
	"time"
)

type Stats struct {
	PlayerShots       int `json:"playerShots"`
	PlayerHits        int `json:"playerHits"`
	EnemyShots        int `json:"enemyShots"`
	EnemyHits         int `json:"enemyHits"`
	PlayerDamageDealt int `json:"playerDamageDealt"`
	PlayerDamageTaken int `json:"playerDamageTaken"`
	PlayerHeals       int `json:"playerHeals"`
	PlayerHealed      int `json:"playerHealed"`
}

type Impact struct {
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Type       string  `json:"type"`
	Owner      int     `json:"owner"`
	Damage     int     `json:"damage"`
	Distance   float64 `json:"distance"`
	Removed    int     `json:"removed"`
	CraterKind string  `json:"craterKind"`
	CraterArt  string  `json:"craterArt"`
	Shell      int     `json:"shell"`
	Shells     int     `json:"shells"`
}

type Actor struct {
	Index         int     `json:"index"`
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Subtitle      string  `json:"subtitle"`
	X             float64 `json:"x"`
	Y             float64 `json:"y"`
	HP            int     `json:"hp"`
	MaxHP         int     `json:"maxHp"`
	Facing        int     `json:"facing"`
	Alive         bool    `json:"alive"`
	WalkDirection int     `json:"walkDirection"`
	WalkTime      float64 `json:"walkTime"`
	AnimTime      float64 `json:"animTime"`
	Slope         float64 `json:"slope"`
	VY            float64 `json:"vy"`
	Falling       bool    `json:"falling"`
	Grounded      bool    `json:"grounded"`
	FireTimer     float64 `json:"fireTimer"`
	HurtTimer     float64 `json:"hurtTimer"`
	AimAngle      float64 `json:"aimAngle"`
	Flash         float64 `json:"flash"`
	Weapon        string  `json:"weapon"`

	BaseDamage         float64 `json:"baseDamage"`
	Attack             float64 `json:"attack"`
	BaseGuard          float64 `json:"baseGuard"`
	Defence            float64 `json:"defence"`
	Grade              float64 `json:"grade"`
	Lucky              float64 `json:"lucky"`
	DamagePlus         float64 `json:"damagePlus"`
	ShootMinus         float64 `json:"shootMinus"`
	WorldBossAddDamage float64 `json:"worldBossAddDamage"`

	WalkAccum float64 `json:"-"`
}

type Event struct {
	Seq  uint64 `json:"seq"`
	Type string `json:"type"`
	Data any    `json:"data"`
}

type Command struct {
	Type    string  `json:"type"`
	Actor   int     `json:"actor"`
	Dir     int     `json:"dir"`
	Delta   float64 `json:"delta"`
	Value   float64 `json:"value"`
	Angle   float64 `json:"angle"`
	Force   float64 `json:"force"`
	Skill   string  `json:"skill"`
	Weapon  string  `json:"weapon"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Target  float64 `json:"target"`
	HP      int     `json:"hp"`
	Enabled bool    `json:"enabled"`
	Seconds float64 `json:"seconds"`
	Art     string  `json:"art"`
	Kind    string  `json:"kind"`
	Wind    float64 `json:"wind"`
	WindSet bool    `json:"windSet"`
}

type Match struct {
	mu sync.Mutex

	Terrain *Terrain
	Actors  [2]*Actor

	Turn  int
	Round int
	Phase string
	Timer float64

	Wind       float64
	WindTarget float64

	Angle         float64
	Force         float64
	Charging      bool
	ChargeStarted time.Time
	ChargeElapsed float64

	PlayerWeapon    string
	EnemyWeapon     string
	SelectedSkill   string
	SelectedAttacks []string
	SelectedBuffs   []string
	PowSelected     bool
	Energy          float64
	Stamina         float64
	SkillUses       map[string]int
	HealsRemaining  int

	Shots             []*Projectile
	Shot              *Projectile
	QueuedShots       []*Projectile
	VolleyTotal       int
	FlightAccumulator float64

	LastImpact        *Impact
	LastPlayerSummary string
	LastPower         *float64
	Winner            *int
	PendingWinner     *int
	Stats             Stats

	Countdown     float64
	ShowCountdown bool

	Time            float64
	MoveDir         int
	AIPlan          *AIPlan
	AIMoveTarget    float64
	EnemyAimAngle   float64
	EnemyAimFrom    float64
	EnemyAimTo      float64
	EnemyAimElapsed float64

	Seq         uint64
	EventLog    []Event
	Subscribers map[chan Event]struct{}
	RNG         *rand.Rand
	LowPower    bool
	AllowDebug  bool
}

func NewMatch(terrain *Terrain, seed int64, lowPower bool) *Match {
	m := &Match{
		Terrain:     terrain,
		Subscribers: map[chan Event]struct{}{},
		RNG:         rand.New(rand.NewSource(seed)),
		LowPower:    lowPower,
	}
	m.resetLocked()
	return m
}

func (m *Match) SetDebug(enabled bool) {
	m.mu.Lock()
	m.AllowDebug = enabled
	m.mu.Unlock()
}

func (m *Match) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resetLocked()
}

func (m *Match) resetLocked() {
	m.Terrain.Reset()
	m.Time = 0
	m.Round = 1
	m.Turn = 0
	m.Phase = "player"
	m.Timer = 0
	if _, ok := WeaponDefs[m.PlayerWeapon]; !ok {
		m.PlayerWeapon = DefaultPlayerWeapon
	}
	if _, ok := WeaponDefs[m.EnemyWeapon]; !ok {
		m.EnemyWeapon = DefaultEnemyWeapon
	}
	playerWeapon := WeaponFor(m.PlayerWeapon)
	enemyWeapon := WeaponFor(m.EnemyWeapon)
	m.Angle = playerWeapon.StartAngle
	m.Force = 0
	m.Charging = false
	m.ChargeElapsed = 0
	m.SelectedSkill = ""
	m.SelectedAttacks = nil
	m.SelectedBuffs = nil
	m.PowSelected = false
	m.Energy = 0
	m.Stamina = StaminaMax
	m.SkillUses = map[string]int{}
	for _, id := range SkillOrder {
		m.SkillUses[id] = 1
	}
	m.HealsRemaining = HealsPerRound
	m.Shots = nil
	m.Shot = nil
	m.QueuedShots = nil
	m.VolleyTotal = 0
	m.FlightAccumulator = 0
	m.LastImpact = nil
	m.LastPlayerSummary = "—"
	m.LastPower = nil
	m.Winner = nil
	m.PendingWinner = nil
	m.Stats = Stats{}
	m.Countdown = CountdownSeconds
	m.ShowCountdown = false
	m.MoveDir = 0
	m.AIPlan = nil
	m.AIMoveTarget = 0
	m.EnemyAimAngle = enemyWeapon.StartAngle
	m.EnemyAimFrom = enemyWeapon.StartAngle
	m.EnemyAimTo = enemyWeapon.StartAngle
	m.EnemyAimElapsed = 0

	spawnY := [2]float64{}
	for i, x := range SpawnX {
		if gy, ok := m.Terrain.FindGroundY(int(x), SpawnProbeY, GroundBottom); ok {
			spawnY[i] = float64(gy)
		} else {
			spawnY[i] = WorldHeight - 60
		}
	}
	m.Actors = [2]*Actor{
		{
			Index: 0, ID: "player", Name: "蓝波", Subtitle: "你",
			X: SpawnX[0], Y: spawnY[0], HP: PlayerMaxHP, MaxHP: PlayerMaxHP,
			Facing: 1, Alive: true, Grounded: true, AimAngle: playerWeapon.StartAngle, Weapon: playerWeapon.ID,
			BaseDamage: BaseDamage, Attack: Attack, BaseGuard: BaseGuard,
			Defence: Defence, Grade: Grade, Lucky: Lucky,
			DamagePlus: DamagePlus, ShootMinus: ShootMinus,
		},
		{
			Index: 1, ID: "enemy", Name: "芽芽", Subtitle: "电脑",
			X: SpawnX[1], Y: spawnY[1], HP: EnemyMaxHP, MaxHP: EnemyMaxHP,
			Facing: -1, Alive: true, Grounded: true, AimAngle: enemyWeapon.StartAngle, Weapon: enemyWeapon.ID,
			BaseDamage: BaseDamage, Attack: Attack, BaseGuard: BaseGuard,
			Defence: Defence, Grade: Grade, Lucky: Lucky,
			DamagePlus: DamagePlus, ShootMinus: ShootMinus,
		},
	}
	m.Actors[0].Slope = m.Terrain.SlopeAt(m.Actors[0].X, m.Actors[0].Y, 22)
	m.Actors[1].Slope = m.Terrain.SlopeAt(m.Actors[1].X, m.Actors[1].Y, 22)

	// SOURCE BaseGame leaves map wind and m_nextWind at 0. The old browser
	// random opening wind was a NEW deviation and is removed.
	m.Wind, m.WindTarget = 0, 0

	m.EmitLocked("reset", map[string]any{})
	m.EmitLocked("turn", map[string]any{"turn": 0, "round": 1})
	m.EmitLocked("wind", map[string]any{"wind": 0.0})
	m.EmitLocked("toast", map[string]any{"text": "按住左右移动 · 上/下调角度 · 按住发射蓄力，松手开炮"})
}

func (m *Match) Player() *Actor { return m.Actors[0] }
func (m *Match) Enemy() *Actor  { return m.Actors[1] }

func (m *Match) playerWeapon() WeaponDef { return WeaponFor(m.PlayerWeapon) }
func (m *Match) enemyWeapon() WeaponDef  { return WeaponFor(m.EnemyWeapon) }

func (m *Match) weaponForActor(index int) WeaponDef {
	if index == 1 {
		return m.enemyWeapon()
	}
	return m.playerWeapon()
}
func (m *Match) ActiveActor() *Actor { return m.Actors[m.Turn] }
func (m *Match) TargetActor() *Actor { return m.Actors[1-m.Turn] }

func (m *Match) CanPlayerControlLocked() bool {
	return m.Phase == "player" && m.Actors[0].Alive && !m.Charging
}

func (m *Match) MetricsLocked() (horizontal, elevation float64) {
	p, e := m.Actors[0], m.Actors[1]
	return math.Abs(e.X-p.X) / PixelsPerMetre, (p.Y - e.Y) / PixelsPerMetre
}

func (m *Match) WindLabelLocked() string {
	v := m.Wind
	if math.Abs(v) < 0.05 {
		return "无风"
	}
	if v > 0 {
		return "向右"
	}
	return "向左"
}

func ChargeForce(elapsed float64) float64 {
	return Clamp(elapsed*ChargeRate, 0, ForceMax)
}

func (m *Match) Command(c Command) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	switch c.Type {
	case "restart":
		m.resetLocked()
		return nil
	case "select_weapon":
		if _, ok := WeaponDefs[c.Weapon]; !ok {
			return errors.New("unknown weapon")
		}
		if m.Phase != "player" || m.Charging {
			return nil
		}
		// The weapon is chosen at the start of a duel. Once the first player
		// volley has been fired it stays locked until restart.
		if m.Stats.PlayerShots > 0 && !m.AllowDebug {
			return errors.New("weapon locked after first shot")
		}
		m.PlayerWeapon = c.Weapon
		def := m.playerWeapon()
		m.Angle = def.StartAngle
		m.Actors[0].Weapon = def.ID
		m.Actors[0].AimAngle = m.Angle
		m.EmitLocked("weapon-select", map[string]any{"weapon": def.ID, "label": def.Label, "angleMin": def.AngleMin, "angleMax": def.AngleMax})
		return nil
	case "move":
		if m.Phase != "player" || m.Charging {
			return nil
		}
		dir := c.Dir
		if dir > 1 {
			dir = 1
		}
		if dir < -1 {
			dir = -1
		}
		m.MoveDir = dir
		return nil
	case "aim_delta":
		if m.Phase != "player" || m.Charging {
			return nil
		}
		def := m.playerWeapon()
		m.Angle = Clamp(m.Angle+c.Delta, def.AngleMin, def.AngleMax)
		m.Actors[0].AimAngle = m.Angle
		return nil
	case "aim_absolute":
		if m.Phase != "player" || m.Charging {
			return nil
		}
		def := m.playerWeapon()
		m.Angle = Clamp(c.Value, def.AngleMin, def.AngleMax)
		m.Actors[0].AimAngle = m.Angle
		return nil
	case "charge_start":
		if !m.CanPlayerControlLocked() {
			return nil
		}
		m.Charging = true
		m.ChargeStarted = time.Now()
		m.ChargeElapsed = 0
		m.Force = 0
		m.MoveDir = 0
		m.Actors[0].WalkDirection = 0
		m.EmitLocked("charge-start", map[string]any{})
		return nil
	case "charge_release":
		if !m.Charging {
			return nil
		}
		elapsed := time.Since(m.ChargeStarted).Seconds()
		force := ChargeForce(elapsed)
		m.Charging = false
		m.Force = 0
		m.ChargeElapsed = 0
		m.EmitLocked("charge-end", map[string]any{})
		if elapsed < MinChargeSeconds || force < MinFireForce {
			m.EmitLocked("toast", map[string]any{"text": "蓄力不足：按住发射键更久一些"})
			return nil
		}
		m.fireLocked(0, m.Angle, force)
		return nil
	case "charge_cancel":
		if !m.Charging {
			return nil
		}
		m.Charging = false
		m.Force = 0
		m.ChargeElapsed = 0
		m.EmitLocked("charge-cancel", map[string]any{})
		return nil
	case "skill":
		if m.Phase != "player" || m.Charging {
			return nil
		}
		def, ok := SkillDefs[c.Skill]
		if !ok || m.SkillUses[c.Skill] <= 0 {
			return nil
		}
		if def.Kind == "boost" {
			found := false
			for i, id := range m.SelectedBuffs {
				if id == c.Skill {
					m.SelectedBuffs = append(m.SelectedBuffs[:i], m.SelectedBuffs[i+1:]...)
					found = true
					break
				}
			}
			if !found {
				m.SelectedBuffs = append(m.SelectedBuffs, c.Skill)
			}
		} else {
			// 1–3 are stackable attack patterns. Selecting a boost or another
			// attack must not clear an earlier attack choice.
			if len(m.SelectedAttacks) == 0 && m.SelectedSkill != "" {
				if prev, ok := SkillDefs[m.SelectedSkill]; ok && prev.Kind == "attack" {
					m.SelectedAttacks = []string{m.SelectedSkill}
				}
			}
			found := false
			for i, id := range m.SelectedAttacks {
				if id == c.Skill {
					m.SelectedAttacks = append(m.SelectedAttacks[:i], m.SelectedAttacks[i+1:]...)
					found = true
					break
				}
			}
			if !found {
				m.SelectedAttacks = append(m.SelectedAttacks, c.Skill)
				m.SelectedSkill = c.Skill
			} else if m.SelectedSkill == c.Skill {
				if len(m.SelectedAttacks) > 0 {
					m.SelectedSkill = m.SelectedAttacks[len(m.SelectedAttacks)-1]
				} else {
					m.SelectedSkill = ""
				}
			}
		}
		m.EmitLocked("skill-select", map[string]any{
			"skill":   m.SelectedSkill,
			"attacks": append([]string(nil), m.SelectedAttacks...),
			"buffs":   append([]string(nil), m.SelectedBuffs...),
		})
		return nil
	case "pow":
		if m.Phase != "player" || m.Charging {
			return nil
		}
		if m.AllowDebug && c.Value >= EnergyMax {
			// Test/debug can arm POW in the same request as setEnergy; the
			// production path still requires m.Energy from real hits.
			m.Energy = EnergyMax
		}
		if m.Energy < EnergyMax && !m.PowSelected {
			return nil
		}
		m.PowSelected = !m.PowSelected
		m.EmitLocked("pow-select", map[string]any{"selected": m.PowSelected, "energy": m.Energy})
		return nil
	case "heal":
		if m.AllowDebug && c.HP > 0 && c.Actor >= 0 && c.Actor < len(m.Actors) {
			a := m.Actors[c.Actor]
			if c.HP > a.MaxHP {
				a.MaxHP = c.HP + HealAmount
			}
			a.HP = c.HP
			a.Alive = true
		}
		m.healLocked()
		return nil
	case "fire":
		if !m.AllowDebug {
			return errors.New("fire command is debug-only")
		}
		actor := c.Actor
		if actor < 0 || actor > 1 {
			actor = 0
		}
		if m.AllowDebug && c.WindSet {
			m.Wind = Clamp(c.Wind, -5, 5)
		}
		m.fireLocked(actor, c.Angle, c.Force)
		return nil
	case "debug_set_position":
		if !m.AllowDebug {
			return errors.New("debug command disabled")
		}
		if c.Dir >= 0 && c.Dir < len(m.Actors) {
			a := m.Actors[c.Dir]
			a.X = Clamp(c.X, 70, WorldWidth-70)
			if gy, ok := m.Terrain.FindGroundY(int(a.X), SpawnProbeY, GroundBottom); ok {
				a.Y = float64(gy)
			}
			a.VY = 0
			a.Falling = false
			a.Grounded = true
			a.Slope = m.Terrain.SlopeAt(a.X, a.Y, 22)
		}
		return nil
	case "debug_set_wind":
		if !m.AllowDebug {
			return errors.New("debug command disabled")
		}
		m.Wind = Clamp(c.Value, -4, 4)
		m.WindTarget = c.Target
		m.EmitLocked("wind", map[string]any{"wind": m.Wind, "label": m.WindLabelLocked()})
		return nil
	case "debug_set_hp":
		if !m.AllowDebug {
			return errors.New("debug command disabled")
		}
		if c.Actor >= 0 && c.Actor < len(m.Actors) {
			a := m.Actors[c.Actor]
			if c.HP > a.MaxHP {
				a.MaxHP = c.HP + HealAmount
			}
			a.HP = max(1, c.HP)
			a.Alive = true
			if a.HP <= 0 {
				a.HP = 0
				a.Alive = false
			}
		}
		return nil
	case "debug_set_energy":
		if !m.AllowDebug {
			return errors.New("debug command disabled")
		}
		m.Energy = Clamp(c.Value, 0, EnergyMax)
		return nil
	case "debug_set_stamina":
		if !m.AllowDebug {
			return errors.New("debug command disabled")
		}
		m.Stamina = Clamp(c.Value, 0, StaminaMax)
		return nil
	case "debug_set_countdown":
		if !m.AllowDebug {
			return errors.New("debug command disabled")
		}
		m.ShowCountdown = c.Enabled
		if c.Seconds > 0 {
			m.Countdown = c.Seconds
		}
		return nil
	case "debug_carve":
		if !m.AllowDebug {
			return errors.New("debug command disabled")
		}
		art := c.Art
		if art == "" {
			art = "401"
		}
		kind := c.Kind
		if kind == "" {
			kind = "debug"
		}
		m.Terrain.Carve(int(c.X), int(c.Y), art, kind)
		m.refreshSupportLocked(m.Actors[0])
		m.refreshSupportLocked(m.Actors[1])
		return nil
	default:
		return fmt.Errorf("unknown command %q", c.Type)
	}
}

func (m *Match) Update(dt float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	step := Clamp(dt, 0, 0.08)
	m.Time += step

	if m.Charging {
		m.ChargeElapsed = time.Since(m.ChargeStarted).Seconds()
		m.Force = ChargeForce(m.ChargeElapsed)
	}
	m.updateFallingLocked(step)

	switch m.Phase {
	case "player":
		if m.MoveDir != 0 && !m.Charging {
			m.movePlayerLocked(step)
		} else {
			m.Actors[0].WalkDirection = 0
		}
		if !m.Charging && m.Actors[0].WalkDirection == 0 {
			m.Stamina = StaminaMax
		}
		if m.ShowCountdown {
			m.Countdown = math.Max(0, m.Countdown-step)
		}
	case "enemy_move":
		m.updateEnemyMoveLocked(step)
	case "flight":
		m.updateFlightLocked(step)
	case "enemy_think":
		m.Timer -= step
		if m.Timer <= 0 {
			m.Phase = "enemy_aim"
			m.Timer = EnemyAimSeconds
			m.EnemyAimElapsed = 0
			m.EnemyAimFrom = m.EnemyAimAngle
			if m.AIPlan != nil {
				m.EnemyAimTo = m.AIPlan.Angle
			} else {
				m.EnemyAimTo = m.enemyWeapon().StartAngle
			}
			m.EmitLocked("enemy-aim", map[string]any{"plan": m.AIPlan})
		}
	case "enemy_aim":
		m.Timer -= step
		m.EnemyAimElapsed += step
		t := Clamp(1-m.Timer/EnemyAimSeconds, 0, 1)
		eased := 1 - math.Pow(1-t, 3)
		m.EnemyAimAngle = m.EnemyAimFrom + (m.EnemyAimTo-m.EnemyAimFrom)*eased
		m.Actors[1].AimAngle = m.EnemyAimAngle
		if m.Timer <= 0 {
			plan := m.AIPlan
			if plan == nil {
				plan = &AIPlan{Angle: m.enemyWeapon().StartAngle, Force: 1200}
			}
			m.fireLocked(1, plan.Angle, plan.Force)
		}
	case "resolve":
		if m.anyFallingLocked() {
			m.Timer = math.Max(m.Timer, 0.25)
		} else {
			m.Timer -= step
			if m.Timer <= 0 {
				m.finishResolveLocked()
			}
		}
	case "heal":
		m.Timer -= step
		if m.Timer <= 0 {
			m.beginTurnLocked(1, true)
		}
	}

	for _, a := range m.Actors {
		a.Flash = math.Max(0, a.Flash-step*2.2)
		a.FireTimer = math.Max(0, a.FireTimer-step)
		a.HurtTimer = math.Max(0, a.HurtTimer-step)
		a.AnimTime += step
		if a.WalkDirection == 0 && !a.Falling {
			a.Slope = m.Terrain.SlopeAt(a.X, a.Y, 22)
		}
	}
}

func (m *Match) anyFallingLocked() bool {
	for _, a := range m.Actors {
		if a.Alive && a.Falling {
			return true
		}
	}
	return false
}

func (m *Match) movePlayerLocked(dt float64) {
	a := m.Actors[0]
	if !a.Alive || a.Falling || m.MoveDir == 0 {
		a.WalkDirection = 0
		return
	}
	if m.moveActorLocked(0, m.MoveDir, MoveSpeed*dt) {
		m.Stamina = StaminaMax
	}
}

func (m *Match) moveActorLocked(index, direction int, distance float64) bool {
	a := m.Actors[index]
	other := m.Actors[1-index]
	if !a.Alive || a.Falling || direction == 0 {
		a.WalkDirection = 0
		return false
	}
	a.WalkAccum += distance
	moved := false
	for a.WalkAccum >= MoveStepX {
		if !m.stepActorLocked(a, other, direction) {
			a.WalkAccum = 0
			break
		}
		a.WalkAccum -= MoveStepX
		moved = true
	}
	return moved
}

func (m *Match) stepActorLocked(a, other *Actor, direction int) bool {
	nextX := Clamp(a.X+float64(direction*MoveStepX), 70, WorldWidth-70)
	if math.Abs(nextX-other.X) < ActorWidth*0.72 {
		a.WalkDirection = 0
		a.Facing = direction
		return false
	}
	if int(nextX)+(15+2)*direction < 0 || int(nextX)+(15+2)*direction > m.Terrain.Width {
		a.WalkDirection = 0
		return false
	}
	x2, y2, ok := m.Terrain.FindNextWalkPoint(int(a.X), int(a.Y), direction, MoveStepX, MoveStepY)
	if ok {
		// FindNextWalkPoint probes the two shoulder columns (x2-1 / x2+1),
		// exactly as the original does. After a crater those shoulders can
		// hold isolated leftover pixels, whose y would seat the actor above or
		// *inside* the surface of the column it actually stands on. Re-seat on
		// the real ground of the destination column so the feet stay planted
		// and never sink into the dug-out terrain.
		if gy, found := m.Terrain.FindGroundY(x2, int(a.Y)-MoveStepY-2, int(a.Y)+MoveStepY+2); found {
			y2 = gy
		}
		a.X = float64(x2)
		a.Y = float64(y2)
		a.VY = 0
		a.Falling = false
		a.Grounded = true
		a.Slope = m.Terrain.SlopeAt(a.X, a.Y, 22)
		a.WalkDirection = direction
		a.Facing = direction
		a.WalkTime += MoveStepX * 0.09
		return true
	}
	// Walking off a ledge is allowed; gravity takes over next tick.
	if gy, found := m.Terrain.FindGroundY(int(nextX), int(a.Y)+MoveStepY+1, m.Terrain.Height-1); found {
		a.X = nextX
		a.Facing = direction
		a.WalkTime += MoveStepX * 0.09
		_ = gy
		m.startFallingLocked(a)
		return true
	}
	a.WalkDirection = 0
	return false
}

func (m *Match) startFallingLocked(a *Actor) {
	if a == nil || !a.Alive {
		return
	}
	a.Falling = true
	a.Grounded = false
	a.VY = 0
	a.WalkDirection = 0
}

func (m *Match) refreshSupportLocked(a *Actor) {
	if a == nil || !a.Alive || a.Falling {
		return
	}
	gy, ok := m.Terrain.FindGroundY(int(a.X), int(a.Y)-4, m.Terrain.Height-1)
	if !ok || gy > int(a.Y)+7 {
		m.startFallingLocked(a)
		return
	}
	if gy < int(a.Y) {
		a.Y = float64(gy)
		a.Slope = m.Terrain.SlopeAt(a.X, a.Y, 22)
	}
	a.Grounded = true
}

func (m *Match) updateFallingLocked(dt float64) {
	for _, a := range m.Actors {
		if !a.Alive || !a.Falling {
			continue
		}
		prevY := a.Y
		a.VY = math.Min(FallMaxSpeed, a.VY+FallGravity*dt)
		nextY := a.Y + a.VY*dt
		toY := int(math.Max(prevY+1, nextY+2))
		if gy, ok := m.Terrain.FindGroundY(int(a.X), int(prevY)+1, toY); ok {
			a.Y = float64(gy)
			a.VY = 0
			a.Falling = false
			a.Grounded = true
			a.Slope = m.Terrain.SlopeAt(a.X, a.Y, 22)
			m.EmitLocked("land", map[string]any{"actor": a.Index, "x": a.X, "y": a.Y})
			m.EmitLocked("sound", map[string]any{"name": "land"})
			continue
		}
		a.Y = nextY
		a.Slope = 0
		if a.Y > WorldHeight+70 {
			m.fallOutLocked(a)
		}
	}
}

func (m *Match) fallOutLocked(a *Actor) {
	if !a.Alive {
		return
	}
	a.Alive = false
	a.HP = 0
	a.Falling = false
	a.VY = 0
	w := 1 - a.Index
	m.PendingWinner = &w
	m.EmitLocked("sound", map[string]any{"name": "out"})
	if m.Phase != "flight" && m.Phase != "resolve" && m.Phase != "over" {
		m.Phase = "resolve"
		m.Timer = ResolveDelay
	}
}

func (m *Match) updateEnemyMoveLocked(dt float64) {
	e := m.Actors[1]
	targetX := m.AIMoveTarget
	dir := 0
	if targetX > e.X {
		dir = 1
	} else if targetX < e.X {
		dir = -1
	}
	if dir != 0 && math.Abs(targetX-e.X) > 3 && m.Timer > 0 {
		m.moveActorLocked(1, dir, EnemyMoveSpeed*dt)
	} else {
		e.WalkDirection = 0
	}
	m.Timer -= dt
	if m.Timer <= 0 {
		m.endEnemyMoveLocked()
	}
}

func (m *Match) endEnemyMoveLocked() {
	e := m.Actors[1]
	e.WalkDirection = 0
	e.Facing = -1
	if e.X < m.Actors[0].X {
		e.Facing = 1
	}
	e.Slope = m.Terrain.SlopeAt(e.X, e.Y, 22)
	m.AIMoveTarget = 0
	plan := ChooseShotForWeapon(e, m.Actors[0], m.Wind, m.Terrain, m.RNG, m.enemyWeapon())
	m.AIPlan = &plan
	m.EnemyAimFrom = m.EnemyAimAngle
	m.EnemyAimTo = plan.Angle
	m.Phase = "enemy_think"
	m.Timer = EnemyThinkSeconds
	m.EmitLocked("toast", map[string]any{"text": "电脑正在测算风向与弹道…"})
}

func (m *Match) chooseEnemyMoveTargetLocked() float64 {
	e := m.Actors[1]
	p := m.Actors[0]
	sign := -1
	if p.X > e.X {
		sign = 1
	}
	for attempt := 0; attempt < 10; attempt++ {
		toward := m.RNG.Float64() < 0.65
		distance := 50 + m.RNG.Float64()*220
		candidate := Clamp(e.X+float64(sign)*distance, 110, WorldWidth-110)
		if !toward {
			candidate = Clamp(e.X-float64(sign)*distance, 110, WorldWidth-110)
		}
		if _, ok := m.Terrain.FindGroundY(int(candidate), int(e.Y)-36, int(e.Y)+36); ok {
			return candidate
		}
	}
	return e.X
}

func (m *Match) EmitLocked(typ string, data any) {
	m.Seq++
	ev := Event{Seq: m.Seq, Type: typ, Data: data}
	m.EventLog = append(m.EventLog, ev)
	if len(m.EventLog) > 512 {
		m.EventLog = m.EventLog[len(m.EventLog)-512:]
	}
	for ch := range m.Subscribers {
		select {
		case ch <- ev:
		default:
		}
	}
}

func (m *Match) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 64)
	m.mu.Lock()
	m.Subscribers[ch] = struct{}{}
	m.mu.Unlock()
	return ch, func() {
		m.mu.Lock()
		if _, ok := m.Subscribers[ch]; ok {
			delete(m.Subscribers, ch)
			close(ch)
		}
		m.mu.Unlock()
	}
}

func (m *Match) BroadcastState() {
	m.mu.Lock()
	defer m.mu.Unlock()
	ev := Event{Seq: m.Seq, Type: "state", Data: m.snapshotLocked()}
	for ch := range m.Subscribers {
		select {
		case ch <- ev:
		default:
		}
	}
}
