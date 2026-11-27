package game

import (
	"math"
	"math/rand"
	"path/filepath"
	"testing"
)

func testTerrain(t *testing.T) *Terrain {
	t.Helper()
	root := filepath.Join("..", "..")
	tr, err := LoadTerrain(filepath.Join(root, "reference/map/1156/fore.map"), filepath.Join(root, "dist/assets"))
	if err != nil {
		t.Fatalf("LoadTerrain: %v", err)
	}
	return tr
}

func TestTerrainHeaderMatchesSource(t *testing.T) {
	tr := testTerrain(t)
	if tr.Width != 1843 || tr.Height != 1020 {
		t.Fatalf("map = %dx%d, want 1843x1020", tr.Width, tr.Height)
	}
	if !tr.IsSolid(240, 389) || tr.IsSolid(240, 388) {
		t.Fatalf("spawn ground mismatch at x=240")
	}
	if !tr.IsSolid(1640, 522) || tr.IsSolid(1640, 521) {
		t.Fatalf("enemy ground mismatch at x=1640")
	}
	if tr.SolidCount() == 0 {
		t.Fatal("empty collision mask")
	}
}

func TestCraterCarveUsesOriginalArt(t *testing.T) {
	tr := testTerrain(t)
	before := tr.SolidCount()
	removed, bounds, ok := tr.Carve(240, 389, "401", "medium")
	if !ok || removed <= 0 {
		t.Fatalf("carve removed=%d ok=%v", removed, ok)
	}
	if bounds[0] < 0 || bounds[1] < 0 {
		t.Fatalf("bad bounds %v", bounds)
	}
	if tr.SolidCount() != before-removed {
		t.Fatalf("solid count changed by %d, removed=%d", before-tr.SolidCount(), removed)
	}
	if len(tr.Craters) != 1 || tr.Craters[0].Art != "401" {
		t.Fatalf("crater record %+v", tr.Craters)
	}
	tr.Reset()
	if tr.SolidCount() != before || len(tr.Craters) != 0 {
		t.Fatal("reset did not restore source mask")
	}
}

func TestWindStaysInSourceRange(t *testing.T) {
	rng := rand.New(rand.NewSource(42))
	wind, target := 0.0, 0.0
	for i := 0; i < 2000; i++ {
		wind, target = NextWind(wind, target, rng)
		// SOURCE GetNextWind adds 0..10 tenths to an already-at-target
		// value, so 4.0 can step to 4.1 before the target is re-rolled.
		if wind < -5 || wind > 5 {
			t.Fatalf("wind out of range: %v", wind)
		}
		if target < -40 || target >= 40 {
			t.Fatalf("target out of range: %v", target)
		}
	}
}

func TestClassicSkillBar(t *testing.T) {
	// SOURCE TemplateAlllist 10001/10003/10002 and AddAttackSpell/AddBallSpell.
	extra1 := SkillDefs["extra1"]
	if len(extra1.Offsets) != 2 || extra1.Offsets[0] != 0 || extra1.Offsets[1] != 0 {
		t.Fatalf("extra1 offsets = %v, want two centred shots", extra1.Offsets)
	}
	if extra1.DamageScale != 0.9 || !extra1.Source || !extra1.Sequential {
		t.Fatalf("extra1 = %+v, want ×0.9 sequential source attack", extra1)
	}
	extra2 := SkillDefs["extra2"]
	if len(extra2.Offsets) != 3 {
		t.Fatalf("extra2 offsets = %v", extra2.Offsets)
	}
	if extra2.DamageScale != 0.6 || !extra2.Source || !extra2.Sequential {
		t.Fatalf("extra2 = %+v, want ×0.6 sequential source attack", extra2)
	}
	scatter := SkillDefs["scatter"]
	if len(scatter.Offsets) != 3 || scatter.Offsets[0] != 0 || scatter.Offsets[1] != -5 || scatter.Offsets[2] != 5 {
		t.Fatalf("scatter = %+v, want three rays at 0/-5/+5", scatter)
	}
	if len(scatter.ForceScales) != 3 || scatter.ForceScales[0] != 1 || scatter.ForceScales[1] != 0.9 || scatter.ForceScales[2] != 1.1 {
		t.Fatalf("scatter force scales = %v", scatter.ForceScales)
	}
	if scatter.DamageScale != 0.5 || !scatter.Source {
		t.Fatalf("scatter = %+v, want ×0.5 source attack", scatter)
	}
	for i, id := range []string{"boost50", "boost40", "boost30", "boost20", "boost10"} {
		def := SkillDefs[id]
		want := []float64{0.5, 0.4, 0.3, 0.2, 0.1}[i]
		if def.Kind != "boost" || def.DamageBonus != want {
			t.Fatalf("%s = %+v", id, def)
		}
	}
}

func TestClassicAttackItemsApplySourceDamagePenalty(t *testing.T) {
	cases := []struct {
		id    string
		buffs []string
		shots int
		scale float64
	}{
		{"extra2", nil, 3, 0.6},
		{"scatter", nil, 3, 0.5},
		{"extra1", nil, 2, 0.9},
		// AddAttackSpell scales ShootMinus; AddWoudSpell adds DamagePlus.
		{"extra2", []string{"boost50"}, 3, 0.9},
	}
	for _, tc := range cases {
		m := NewMatch(testTerrain(t), 7, false)
		m.SelectedSkill = tc.id
		m.SelectedBuffs = tc.buffs
		if !m.fireLocked(0, AngleMax, ForceMax) {
			t.Fatalf("%s fire rejected", tc.id)
		}
		wantActive := tc.shots
		wantQueued := 0
		if tc.id != "scatter" {
			wantActive = 1
			wantQueued = tc.shots - 1
		}
		if len(m.Shots) != wantActive || len(m.QueuedShots) != wantQueued {
			t.Fatalf("%s active/queued = %d/%d, want %d/%d", tc.id, len(m.Shots), len(m.QueuedShots), wantActive, wantQueued)
		}
		allShots := append(append([]*Projectile{}, m.Shots...), m.QueuedShots...)
		for i, shot := range allShots {
			if shot.Skill != tc.id || math.Abs(shot.DamageScale-tc.scale) > 1e-9 {
				t.Fatalf("%s shot %d = skill %q scale %v, want %q ×%v", tc.id, i, shot.Skill, shot.DamageScale, tc.id, tc.scale)
			}
		}
	}
}

func TestSequentialAttackReplaysSameLaunchVector(t *testing.T) {
	m := NewMatch(testTerrain(t), 7, false)
	m.SelectedSkill = "extra2"
	if !m.fireLocked(0, AngleMax, ForceMax) {
		t.Fatal("fire rejected")
	}
	all := append(append([]*Projectile{}, m.Shots...), m.QueuedShots...)
	if len(all) != 3 {
		t.Fatalf("extra2 total shots = %d, want 3", len(all))
	}
	first := all[0]
	for i, shot := range all[1:] {
		if shot.Elevation != first.Elevation || shot.Force != first.Force ||
			shot.VX != first.VX || shot.VY != first.VY ||
			shot.X != first.X || shot.Y != first.Y {
			t.Fatalf("shot %d does not replay the first launch vector: %+v vs %+v", i+1, shot, first)
		}
	}
	if m.VolleyTotal != 3 {
		t.Fatalf("volley total = %d, want 3", m.VolleyTotal)
	}
}

func TestSequentialAttackLaunchesNextShell(t *testing.T) {
	m := NewMatch(testTerrain(t), 7, false)
	m.SelectedSkill = "extra1"
	if !m.fireLocked(0, AngleMax, ForceMax) {
		t.Fatal("fire rejected")
	}
	if len(m.Shots) != 1 || len(m.QueuedShots) != 1 || m.Stats.PlayerShots != 1 {
		t.Fatalf("initial active/queued/shots = %d/%d/%d", len(m.Shots), len(m.QueuedShots), m.Stats.PlayerShots)
	}
	first := *m.Shots[0]
	m.Shots[0].Alive = false
	m.finishFlightLocked()
	if m.Phase != "flight" || len(m.Shots) != 1 || m.Shots[0].Slot != 1 {
		t.Fatalf("next shell was not launched: phase=%s active=%d", m.Phase, len(m.Shots))
	}
	if len(m.QueuedShots) != 0 || m.VolleyTotal != 2 || m.Stats.PlayerShots != 2 {
		t.Fatalf("queue/total/shots = %d/%d/%d", len(m.QueuedShots), m.VolleyTotal, m.Stats.PlayerShots)
	}
	next := m.Shots[0]
	if next.Elevation != first.Elevation || next.Force != first.Force ||
		next.VX != first.VX || next.VY != first.VY || next.X != first.X || next.Y != first.Y {
		t.Fatalf("next shell changed launch vector: %+v vs %+v", next, first)
	}
}

func TestDamageBuffsStackAndSpend(t *testing.T) {
	tr := testTerrain(t)
	m := NewMatch(tr, 7, false)
	m.SelectedBuffs = []string{"boost50", "boost20"}
	if !m.fireLocked(0, AngleMax, ForceMax) {
		t.Fatal("fire rejected")
	}
	for i, shot := range m.Shots {
		if math.Abs(shot.DamageScale-1.7) > 1e-9 {
			t.Fatalf("shot %d damage scale = %v, want 1.7", i, shot.DamageScale)
		}
	}
	for _, id := range []string{"boost50", "boost20"} {
		if m.SkillUses[id] != 0 {
			t.Fatalf("%s uses = %d, want 0", id, m.SkillUses[id])
		}
	}
	if len(m.SelectedBuffs) != 0 {
		t.Fatalf("selected buffs not spent: %v", m.SelectedBuffs)
	}
}

func TestWeaponLocksAfterFirstShot(t *testing.T) {
	tr := testTerrain(t)
	m := NewMatch(tr, 7, false)
	if err := m.Command(Command{Type: "select_weapon", Weapon: "wind"}); err != nil {
		t.Fatalf("select weapon: %v", err)
	}
	if m.PlayerWeapon != "wind" {
		t.Fatalf("weapon = %s, want wind", m.PlayerWeapon)
	}
	if !m.fireLocked(0, m.playerWeapon().StartAngle, ForceMax) {
		t.Fatal("fire rejected")
	}
	// Selection is ignored while the shell is in flight; verify the lock once
	// control returns to the player.
	m.Phase = "player"
	if err := m.Command(Command{Type: "select_weapon", Weapon: "fire"}); err == nil {
		t.Fatal("weapon changed after the first shot")
	}
	if m.PlayerWeapon != "wind" {
		t.Fatalf("weapon changed to %s after lock", m.PlayerWeapon)
	}
}

func TestClassicWeaponProfiles(t *testing.T) {
	checks := []struct {
		id       string
		pic      string
		ball     string
		min, max float64
	}{
		{"fire", "bombpack", "161", 20, 50},
		{"cannon", "bomb", "101", 55, 70},
		{"fruit", "fruit", "401", 20, 50},
		{"appliance", "television", "321", 50, 70},
		{"wind", "dart", "121", 15, 50},
	}
	for _, c := range checks {
		def := WeaponDefs[c.id]
		if def.Pic != c.pic || def.BallID != c.ball || def.AngleMin != c.min || def.AngleMax != c.max {
			t.Fatalf("%s = %+v", c.id, def)
		}
	}
}

func TestSourceDamage(t *testing.T) {
	attacker := &Actor{BaseDamage: 360, Attack: 100, Grade: 10, DamagePlus: 1, ShootMinus: 1}
	defender := &Actor{BaseGuard: 80, Defence: 40}
	if d := SourceDamage(0, 55, attacker, defender); d <= 0 {
		t.Fatalf("center damage = %d", d)
	}
	if d := SourceDamage(55, 55, attacker, defender); d != 0 {
		t.Fatalf("edge damage = %d", d)
	}
	if d := SourceDamage(27.5, 55, attacker, defender); d <= 0 {
		t.Fatalf("half-radius damage = %d", d)
	}
}

// SOURCE: Game.Logic/Living.cs MakeCriticalDamage(). The original rolls
// lucky*45/(800+lucky) against Random.Next(100) and returns
// (int)((0.5 + lucky*0.00015) * baseDamage) reduced by the target's
// ReduceCrit gems/pet value.
func TestSourceCriticalDamageMatchesSource(t *testing.T) {
	lucky := CriticalLucky
	base := 400                        // use variables so the formula is a runtime float, not a constant
	rate := lucky * 45 / (800 + lucky) // ~8.27%
	crit := int((0.5 + lucky*0.00015) * float64(base))
	if got := SourceCriticalDamage(lucky, 0, base, 0); got != crit {
		t.Fatalf("roll 0 crit = %d, want %d", got, crit)
	}
	if got := SourceCriticalDamage(lucky, 0, base, int(math.Ceil(rate))); got != 0 {
		t.Fatalf("roll above %.2f%% threshold crit = %d, want 0", rate, got)
	}
	if got := SourceCriticalDamage(lucky, 0, base, 99); got != 0 {
		t.Fatalf("roll 99 crit = %d, want 0", got)
	}
	if got := SourceCriticalDamage(lucky, 50, base, 0); got != crit/2 {
		t.Fatalf("50%% crit reduction = %d, want %d", got, crit/2)
	}
	if got := SourceCriticalDamage(lucky, 0, 0, 0); got != 0 {
		t.Fatalf("zero damage crit = %d, want 0", got)
	}
}

// critRNGWithFirstRoll returns a deterministic stream whose first Intn(100)
// equals want, so the impact test can force or suppress a critical hit.
func critRNGWithFirstRoll(want int) *rand.Rand {
	for seed := int64(0); seed < 10000; seed++ {
		if r := rand.New(rand.NewSource(seed)); r.Intn(100) == want {
			return rand.New(rand.NewSource(seed))
		}
	}
	return rand.New(rand.NewSource(0))
}

// SOURCE: SimpleBomb.BombImp passes damage and critical separately to
// Living.TakeDamage: the victim loses damage + critical.
func TestCriticalDamageIsAppliedOnImpact(t *testing.T) {
	tr := testTerrain(t)
	makeImpact := func(forceCrit bool) (*Match, int, int) {
		m := NewMatch(tr, 7, false)
		if forceCrit {
			m.CritRNG = critRNGWithFirstRoll(0)
		} else {
			m.CritRNG = critRNGWithFirstRoll(99)
		}
		target := m.Actors[1]
		hpBefore := target.HP
		p := &Projectile{
			Owner: 0, X: target.X, Y: target.Y - 38,
			Impact: "actor", Alive: false, DamageScale: 1,
			Weapon: m.playerWeapon().ID, CraterArt: "401", Shells: 1,
		}
		m.resolveImpactLocked(p)
		if m.LastImpact == nil {
			t.Fatal("missing impact")
		}
		return m, hpBefore, m.LastImpact.Damage + m.LastImpact.Critical
	}

	mCrit, hpCrit, lossCrit := makeImpact(true)
	if mCrit.LastImpact.Critical <= 0 {
		t.Fatalf("forced crit: damage=%d critical=%d", mCrit.LastImpact.Damage, mCrit.LastImpact.Critical)
	}
	if mCrit.Actors[1].HP != hpCrit-lossCrit {
		t.Fatalf("crit hp %d -> %d, want loss %d", hpCrit, mCrit.Actors[1].HP, lossCrit)
	}
	if mCrit.Stats.PlayerDamageDealt != lossCrit {
		t.Fatalf("crit stats damage = %d, want %d", mCrit.Stats.PlayerDamageDealt, lossCrit)
	}

	mPlain, hpPlain, lossPlain := makeImpact(false)
	if mPlain.LastImpact.Critical != 0 {
		t.Fatalf("suppressed crit = %d, want 0", mPlain.LastImpact.Critical)
	}
	if lossCrit <= lossPlain || lossCrit-lossPlain != mCrit.LastImpact.Critical {
		t.Fatalf("crit total %d should be plain total %d + critical %d",
			lossCrit, lossPlain, mCrit.LastImpact.Critical)
	}
	if mPlain.Actors[1].HP != hpPlain-lossPlain {
		t.Fatalf("plain hp %d -> %d, want loss %d", hpPlain, mPlain.Actors[1].HP, lossPlain)
	}
}

func TestMatchStartsOnGround(t *testing.T) {
	tr := testTerrain(t)
	m := NewMatch(tr, 7, false)
	s := m.Snapshot()
	if s.Phase != "player" || s.Turn != 0 || s.Round != 1 {
		t.Fatalf("state %+v", s)
	}
	if s.Actors[0].X != 240 || s.Actors[1].X != 1640 {
		t.Fatalf("spawns = %v %v", s.Actors[0].X, s.Actors[1].X)
	}
	if s.Actors[0].Y != 389 || s.Actors[1].Y != 522 {
		t.Fatalf("spawn ground = %v %v", s.Actors[0].Y, s.Actors[1].Y)
	}
	if s.Wind != 0 || s.WindTarget != 0 {
		t.Fatalf("opening wind = %v/%v", s.Wind, s.WindTarget)
	}
}

func TestFireVolleyAndResolve(t *testing.T) {
	tr := testTerrain(t)
	m := NewMatch(tr, 7, false)
	if !m.fireLocked(0, AngleMax, ForceMax) {
		t.Fatal("fire rejected")
	}
	if len(m.Shots) != 1 || m.Phase != "flight" {
		t.Fatalf("phase=%s shots=%d", m.Phase, len(m.Shots))
	}
	for i := 0; i < 500 && m.Phase == "flight"; i++ {
		m.Update(PhysicsDT)
	}
	if m.Phase == "flight" {
		t.Fatal("flight did not resolve")
	}
	if m.LastImpact == nil {
		t.Fatal("missing impact")
	}
	if m.Phase != "resolve" && m.Phase != "player" {
		t.Fatalf("unexpected phase %s", m.Phase)
	}
}

func TestAIPlanIsReachable(t *testing.T) {
	tr := testTerrain(t)
	m := NewMatch(tr, 7, false)
	plan := ChooseShot(m.Actors[1], m.Actors[0], 0, tr, mathRand())
	if plan.Angle < AngleMin || plan.Angle > AngleMax {
		t.Fatalf("angle %v", plan.Angle)
	}
	if plan.Force < 420 || plan.Force > ForceMax {
		t.Fatalf("force %v", plan.Force)
	}
	if plan.Expected.Closest == math.Inf(1) {
		t.Fatal("AI found no trajectory")
	}
}

// Regression: a crater under the actor must not leave the actor floating on
// stale ground, and walking over dug-out terrain must seat the feet on the
// real surface of the destination column (not a leftover shoulder pixel),
// otherwise the character visually sinks into the floor.
func TestCraterReseatsActorAndWalkStaysOnSurface(t *testing.T) {
	tr := testTerrain(t)
	m := NewMatch(tr, 7, false)
	a := m.Actors[0]

	// Carve right under the player's feet, then refresh support as an impact
	// now does. The actor must either start falling or sit on a lower surface.
	feetX, feetY := int(a.X), int(a.Y)
	tr.Carve(feetX, feetY, "401", "medium")
	m.refreshSupportLocked(a)
	if !a.Falling {
		gy, found := tr.FindGroundY(feetX, feetY-4, tr.Height-1)
		if !found {
			t.Fatal("no ground below carved feet")
		}
		if a.Y < float64(gy)-1 {
			t.Fatalf("actor left floating above new ground: y=%v ground=%d", a.Y, gy)
		}
	}

	// Let the actor settle, then walk several steps across the crater and
	// assert its feet are never below the destination column's real surface.
	for i := 0; i < 200 && a.Falling; i++ {
		m.Update(PhysicsDT)
	}
	if a.Falling {
		t.Fatal("actor never landed after crater")
	}
	for step := 0; step < 12; step++ {
		m.stepActorLocked(a, m.Actors[1], 1)
		gy, found := tr.FindGroundY(int(a.X), int(a.Y)-MoveStepY-2, int(a.Y)+MoveStepY+2)
		if found && a.Y < float64(gy)-1 {
			t.Fatalf("step %d: feet sink below surface column x=%d: y=%v ground=%d",
				step, int(a.X), a.Y, gy)
		}
	}
}

// Regression: 1156 has solid bottom rows; no crater may dig through the
// protected floor at y >= BedrockY.
func TestBedrockFloorCannotBeCarved(t *testing.T) {
	tr := testTerrain(t)
	// Carve a big POW crater centered right at the bedrock boundary.
	tr.Carve(300, BedrockY-10, "4", "large")
	for _, y := range []int{BedrockY, BedrockY + 1, tr.Height - 1} {
		if !tr.IsSolid(300, y) {
			t.Fatalf("bedrock breached at y=%d (x=300)", y)
		}
	}
	// Sample across several columns to be sure the whole floor survives.
	for x := 260; x <= 340; x += 10 {
		for _, y := range []int{BedrockY, tr.Height - 1} {
			if !tr.IsSolid(x, y) {
				t.Fatalf("bedrock breached at (%d,%d)", x, y)
			}
		}
	}
}

// Regression: with FixedWind enabled, the same angle + force + origin always
// produces the same trajectory, so players can reproduce a shot.
func TestFixedWindTrajectoryIsDeterministic(t *testing.T) {
	if !FixedWind {
		t.Skip("FixedWind disabled")
	}
	tr := testTerrain(t)
	m := NewMatch(tr, 7, false)
	originX, originY := 300.0, 1186.0
	a := &m.Actors[0]
	r1 := SimulateShot(originX, originY, 35, 800, 1, m.Wind, nil, tr, MaxFlightSeconds, true)
	r2 := SimulateShot(originX, originY, 35, 800, 1, m.Wind, nil, tr, MaxFlightSeconds, true)
	if math.Abs(r1.X-r2.X) > 1e-9 || math.Abs(r1.Y-r2.Y) > 1e-9 {
		t.Fatalf("same shot diverged: (%v,%v) vs (%v,%v)", r1.X, r1.Y, r2.X, r2.Y)
	}
	_ = a
}

func mathRand() *rand.Rand { return rand.New(rand.NewSource(7)) }

// Regression: the "carry"/fly item (SOURCE FlyCommand.cs / CarrySpell.cs /
// SimpleBomb.cs BombType.FLY / BallList ID=3) arms ONE zero-damage, no-crater
// teleport ball and moves its owner to the landing point. Once used it is
// unavailable until the next own turn (Player.CanFly).
func TestCarryBallTeleportsOwnerWithoutDamageOrCrater(t *testing.T) {
	m := NewMatch(testTerrain(t), 7, false)
	m.SetDebug(true)
	if !m.CanCarry {
		t.Fatal("CanCarry should start true")
	}
	// Arm via the same command the client sends.
	if err := m.Command(Command{Type: "carry"}); err != nil {
		t.Fatalf("carry command: %v", err)
	}
	if !m.CarryArmed {
		t.Fatal("carry should be armed after command")
	}
	before := m.Terrain.SolidCount()
	startX := m.Actors[0].X
	hpBefore := m.Actors[1].HP
	if !m.fireLocked(0, 45, 1200) {
		t.Fatal("carry fire rejected")
	}
	if len(m.Shots) != 1 || !m.Shots[0].Carry {
		t.Fatalf("expected a single carry shell, got %d (carry=%v)", len(m.Shots), len(m.Shots) > 0 && m.Shots[0].Carry)
	}
	if m.Shots[0].DamageScale != 0 || m.Shots[0].CraterArt != "" {
		t.Fatal("carry ball must have zero damage and no crater art")
	}
	if m.CarryArmed || m.CanCarry {
		t.Fatal("carry must be consumed after firing (once per turn)")
	}
	// Run the flight to completion; the shell lands on terrain and translates
	// the player. No crater and no damage must result.
	for i := 0; i < 2000 && m.Phase == "flight"; i++ {
		m.Update(PhysicsDT)
	}
	if m.Actors[1].HP != hpBefore {
		t.Fatalf("carry ball dealt damage: %d -> %d", hpBefore, m.Actors[1].HP)
	}
	if m.Terrain.SolidCount() != before {
		t.Fatalf("carry ball carved terrain: %d -> %d", before, m.Terrain.SolidCount())
	}
	if math.Abs(m.Actors[0].X-startX) < 1 {
		t.Fatalf("owner was not translated (x still %v)", m.Actors[0].X)
	}
	// A second carry command in the same turn must be rejected.
	if err := m.Command(Command{Type: "carry"}); err != nil {
		t.Fatalf("carry command error: %v", err)
	}
	if m.CarryArmed {
		t.Fatal("carry must not re-arm in the same turn")
	}
}

func TestCarryAvailableAgainOnNewPlayerTurn(t *testing.T) {
	m := NewMatch(testTerrain(t), 7, false)
	m.SetDebug(true)
	if err := m.Command(Command{Type: "carry"}); err != nil {
		t.Fatal(err)
	}
	m.fireLocked(0, 45, 1200)
	if m.CanCarry {
		t.Fatal("consumed")
	}
	m.beginTurnLocked(0, false)
	if !m.CanCarry || m.CarryArmed {
		t.Fatalf("new player turn should restore CanCarry (armed=%v available=%v)", m.CarryArmed, m.CanCarry)
	}
}

// SOURCE: BallList.xml + bombconfig.xml —— POW 使用 bombconfig Special 弹的
// Amount/Power/Radii/Crater：水果篮大招弹 411（三连发榴莲、Power 0.5、半径
// 65、弹坑 411），风神普通弹 121 用原版弹坑。雷霆 151 / 烈火 171 / 马桶 371
// 同为三连发。
func TestPowVolleyUsesSpecialBall(t *testing.T) {
	if b := BallFor("411"); b.Amount != 3 || b.Power != 0.5 || b.Radii != 65 || b.Crater != "411" {
		t.Fatalf("ball 411 = %+v", b)
	}
	if b := BallFor("171"); b.Amount != 3 || b.Power != 0.6 || b.Radii != 45 {
		t.Fatalf("ball 171 = %+v", b)
	}
	if b := BallFor("151"); b.Amount != 3 || b.Power != 0.6 {
		t.Fatalf("ball 151 = %+v", b)
	}
	if b := BallFor("371"); b.Amount != 3 || b.Power != 0.5 {
		t.Fatalf("ball 371 = %+v", b)
	}
	if w := WeaponFor("fruit"); w.SpecialBallID != "411" || w.SpecialActionType != 0 || w.ActionType != 0 {
		t.Fatalf("fruit def = %+v", w)
	}
	if w := WeaponFor("bow"); w.ActionType != 1 || w.SpecialActionType != 1 {
		t.Fatalf("bow def = %+v", w)
	}

	// 水果篮 POW：一击三发 sequential，弹体带 411 坑 / 65 半径 / 0.5 伤害系数。
	m := NewMatch(testTerrain(t), 7, false)
	m.PlayerWeapon = "fruit"
	m.Energy = EnergyMax
	m.PowSelected = true
	if !m.fireLocked(0, 45, 1200) {
		t.Fatal("pow fire rejected")
	}
	if m.VolleyTotal != 3 || len(m.QueuedShots) != 2 || m.Shot == nil {
		t.Fatalf("fruit pow volley = total %d queued %d", m.VolleyTotal, len(m.QueuedShots))
	}
	if m.Shot.CraterArt != "411" || m.Shot.BlastRadius != 65 {
		t.Fatalf("fruit pow shell art=%s radius=%v", m.Shot.CraterArt, m.Shot.BlastRadius)
	}
	if math.Abs(m.Shot.DamageScale-0.5) > 1e-9 {
		t.Fatalf("fruit pow damageScale = %v, want 0.5", m.Shot.DamageScale)
	}
	if !m.Shot.Pow {
		t.Fatal("shell must be flagged pow")
	}

	// 风神普通弹 121：原版弹坑 + 标准半径。
	m2 := NewMatch(testTerrain(t), 7, false)
	m2.PlayerWeapon = "wind"
	if !m2.fireLocked(0, 40, 1200) {
		t.Fatal("wind fire rejected")
	}
	if m2.Shot.CraterArt != "121" || m2.Shot.BlastRadius != 55 {
		t.Fatalf("wind shell art=%s radius=%v", m2.Shot.CraterArt, m2.Shot.BlastRadius)
	}
	if math.Abs(m2.Shot.DamageScale-1.0) > 1e-9 {
		t.Fatalf("wind damageScale = %v", m2.Shot.DamageScale)
	}

	// 轰天大招 111：单发、Power 1.3、半径 65。
	m3 := NewMatch(testTerrain(t), 7, false)
	m3.PlayerWeapon = "cannon"
	m3.Energy = EnergyMax
	m3.PowSelected = true
	if !m3.fireLocked(0, 65, 1200) {
		t.Fatal("cannon pow fire rejected")
	}
	if m3.VolleyTotal != 1 {
		t.Fatalf("cannon pow volley = %d", m3.VolleyTotal)
	}
	if m3.Shot.CraterArt != "401" || m3.Shot.BlastRadius != 65 {
		t.Fatalf("cannon pow shell art=%s radius=%v", m3.Shot.CraterArt, m3.Shot.BlastRadius)
	}
	if math.Abs(m3.Shot.DamageScale-1.3) > 1e-9 {
		t.Fatalf("cannon pow damageScale = %v", m3.Shot.DamageScale)
	}
}

// SOURCE: BaseGame.cs PosX/PosX1 出生列。1157 等地图在固定列上方有悬空
// 前景，出生必须扫描到「脚下有地面 + 净空无碰撞」的站立位。
func TestSpawnColumnAvoidsFloatingTerrain(t *testing.T) {
	root := filepath.Join("..", "..")
	for _, id := range []string{"1156", "1001", "1002", "1003", "1008", "1014", "1035", "1038", "1157", "1190", "1192"} {
		tr, err := LoadTerrain(filepath.Join(root, "dist/data", id+".fore.map"), filepath.Join(root, "dist/assets"))
		if err != nil {
			t.Fatalf("%s: %v", id, err)
		}
		m := NewMatch(tr, 7, false)
		for i, a := range m.Actors {
			x, y := int(a.X), int(a.Y)
			if y < SpawnProbeY || y >= tr.Height-20 {
				t.Fatalf("%s actor %d spawns out of bounds (%d,%d)", id, i, x, y)
			}
			// 身体区（y-40..y-1）与头顶净空不得嵌入实心。
			for sy := y - 110; sy < y; sy++ {
				if sy < 0 {
					continue
				}
				if tr.IsSolid(x, sy) {
					t.Fatalf("%s actor %d embedded in terrain at (%d,%d)", id, i, x, sy)
				}
			}
			// 脚下必须落在地面上（或即将落地——不再悬空）。
			if !tr.IsSolid(x, y) {
				t.Fatalf("%s actor %d has no ground under (%d,%d)", id, i, x, y)
			}
		}
	}
}
