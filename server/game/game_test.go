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
	tr, err := LoadTerrain(filepath.Join(root, "reference/map/1001/fore.map"), filepath.Join(root, "dist/assets"))
	if err != nil {
		t.Fatalf("LoadTerrain: %v", err)
	}
	return tr
}

func TestTerrainHeaderMatchesSource(t *testing.T) {
	tr := testTerrain(t)
	if tr.Width != 2000 || tr.Height != 1425 {
		t.Fatalf("map = %dx%d, want 2000x1425", tr.Width, tr.Height)
	}
	if !tr.IsSolid(300, 1186) || tr.IsSolid(300, 1185) {
		t.Fatalf("spawn ground mismatch at x=300")
	}
	if !tr.IsSolid(1700, 1193) || tr.IsSolid(1700, 1192) {
		t.Fatalf("enemy ground mismatch at x=1700")
	}
	if tr.SolidCount() == 0 {
		t.Fatal("empty collision mask")
	}
}

func TestCraterCarveUsesOriginalArt(t *testing.T) {
	tr := testTerrain(t)
	before := tr.SolidCount()
	removed, bounds, ok := tr.Carve(300, 1186, "401", "medium")
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
	extra1 := SkillDefs["extra1"]
	if len(extra1.Offsets) != 2 || extra1.Offsets[0] != 0 || extra1.Offsets[1] != -5 {
		t.Fatalf("extra1 offsets = %v", extra1.Offsets)
	}
	extra2 := SkillDefs["extra2"]
	if len(extra2.Offsets) != 3 {
		t.Fatalf("extra2 offsets = %v", extra2.Offsets)
	}
	scatter := SkillDefs["scatter"]
	if len(scatter.Offsets) != 5 || scatter.Offsets[4] != 10 {
		t.Fatalf("scatter = %+v", scatter)
	}
	for i, id := range []string{"boost50", "boost40", "boost30", "boost20", "boost10"} {
		def := SkillDefs[id]
		want := []float64{0.5, 0.4, 0.3, 0.2, 0.1}[i]
		if def.Kind != "boost" || def.DamageBonus != want {
			t.Fatalf("%s = %+v", id, def)
		}
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
	if s.Actors[0].X != 300 || s.Actors[1].X != 1700 {
		t.Fatalf("spawns = %v %v", s.Actors[0].X, s.Actors[1].X)
	}
	if s.Actors[0].Y != 1186 || s.Actors[1].Y != 1193 {
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

func mathRand() *rand.Rand { return rand.New(rand.NewSource(7)) }
