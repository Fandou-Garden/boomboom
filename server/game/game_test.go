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
