package game

type Snapshot struct {
	Seq           uint64      `json:"seq"`
	Phase         string      `json:"phase"`
	Turn          int         `json:"turn"`
	Round         int         `json:"round"`
	Wind          float64     `json:"wind"`
	WindTarget    float64     `json:"windTarget"`
	WindLabel     string      `json:"windLabel"`
	Angle         float64     `json:"angle"`
	AngleMin      float64     `json:"angleMin"`
	AngleMax      float64     `json:"angleMax"`
	Force         float64     `json:"force"`
	Charging      bool        `json:"charging"`
	ChargeElapsed float64     `json:"chargeElapsed"`
	Weapon        string      `json:"weapon"`
	EnemyWeapon   string      `json:"enemyWeapon"`
	Weapons       []WeaponDef `json:"weapons"`

	Actors []Actor      `json:"actors"`
	Shots  []Projectile `json:"shots"`
	Shot   *Projectile  `json:"shot"`

	LastImpact        *Impact  `json:"lastImpact"`
	LastPlayerSummary string   `json:"lastPlayerSummary"`
	LastPower         *float64 `json:"lastPower"`
	Winner            *int     `json:"winner"`

	Stats          Stats          `json:"stats"`
	HealsRemaining int            `json:"healsRemaining"`
	SkillUses      map[string]int `json:"skillUses"`
	SelectedSkill  string         `json:"selectedSkill"`
	SelectedBuffs  []string       `json:"selectedBuffs"`
	PowSelected    bool           `json:"powSelected"`
	CarryArmed     bool           `json:"carryArmed"`
	CanCarry       bool           `json:"canCarry"`
	Energy         float64        `json:"energy"`
	Stamina        float64        `json:"stamina"`

	Countdown     float64 `json:"countdown"`
	ShowCountdown bool    `json:"showCountdown"`
	EnemyAimAngle float64 `json:"enemyAimAngle"`
	MetricsX      float64 `json:"metricsX"`
	MetricsY      float64 `json:"metricsY"`

	Craters       []Crater `json:"craters"`
	Time          float64  `json:"time"`
	TerrainWidth  int      `json:"terrainWidth"`
	TerrainHeight int      `json:"terrainHeight"`
	TerrainHash   uint64   `json:"terrainHash"`
}

func (m *Match) Snapshot() Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshotLocked()
}

func (m *Match) snapshotLocked() Snapshot {
	weapon := m.playerWeapon()
	s := Snapshot{
		Seq: m.Seq, Phase: m.Phase, Turn: m.Turn, Round: m.Round,
		Wind: m.Wind, WindTarget: m.WindTarget, WindLabel: m.WindLabelLocked(),
		Angle: m.Angle, AngleMin: weapon.AngleMin, AngleMax: weapon.AngleMax,
		Force: m.Force, Charging: m.Charging, ChargeElapsed: m.ChargeElapsed,
		Weapon: m.PlayerWeapon, EnemyWeapon: m.EnemyWeapon,
		LastPlayerSummary: m.LastPlayerSummary,
		Stats:             m.Stats, HealsRemaining: m.HealsRemaining,
		SelectedSkill: m.SelectedSkill, SelectedBuffs: append([]string{}, m.SelectedBuffs...),
		PowSelected: m.PowSelected, CarryArmed: m.CarryArmed, CanCarry: m.CanCarry,
		Energy: m.Energy, Stamina: m.Stamina,
		Countdown: m.Countdown, ShowCountdown: m.ShowCountdown,
		EnemyAimAngle: m.EnemyAimAngle,
		Craters:       m.Terrain.CratersCopy(),
		Time:          m.Time,
		TerrainWidth:  m.Terrain.Width, TerrainHeight: m.Terrain.Height,
		TerrainHash: m.Terrain.Hash(),
	}
	if m.LastImpact != nil {
		impact := *m.LastImpact
		s.LastImpact = &impact
	}
	if m.LastPower != nil {
		v := *m.LastPower
		s.LastPower = &v
	}
	if m.Winner != nil {
		v := *m.Winner
		s.Winner = &v
	}
	for _, a := range m.Actors {
		if a != nil {
			s.Actors = append(s.Actors, *a)
		}
	}
	for _, p := range m.Shots {
		if p != nil {
			s.Shots = append(s.Shots, copyProjectile(p))
		}
	}
	if m.Shot != nil {
		cp := copyProjectile(m.Shot)
		s.Shot = &cp
	}
	s.SkillUses = map[string]int{}
	for k, v := range m.SkillUses {
		s.SkillUses[k] = v
	}
	for _, id := range WeaponOrder {
		s.Weapons = append(s.Weapons, WeaponDefs[id])
	}
	s.MetricsX, s.MetricsY = m.MetricsLocked()
	return s
}

func copyProjectile(p *Projectile) Projectile {
	c := *p
	c.Trail = append([]TrailPoint(nil), p.Trail...)
	return c
}

func (m *Match) SnapshotEvent() Event {
	m.mu.Lock()
	defer m.mu.Unlock()
	return Event{Seq: m.Seq, Type: "state", Data: m.snapshotLocked()}
}
