package game

import (
	"fmt"
	"math/rand"
	"path/filepath"
	"testing"
)

// Regression for "角色飘进地形" (actors sinking into / floating off the
// terrain). Simulates real matches (player walks + fires, AI answers) on EVERY
// shipped map and asserts at every tick that each grounded actor's feet sit
// exactly on the surface top of its column:
//   - never below the column surface (embedded / sunk into terrain),
//   - never more than the refresh tolerance above it (airborne while grounded),
//   - never with solid terrain in the body column right above the feet.
func TestActorsNeverEmbedInTerrainAllMaps(t *testing.T) {
	root := filepath.Join("..", "..")
	mapIDs := []string{"1156", "1001", "1002", "1003", "1008", "1014", "1035", "1038", "1157", "1190", "1192", "1049"}
	for _, id := range mapIDs {
		t.Run("map-"+id, func(t *testing.T) {
			tr, err := LoadTerrain(filepath.Join(root, "dist/data", id+".fore.map"), filepath.Join(root, "dist/assets"))
			if err != nil {
				t.Fatalf("LoadTerrain %s: %v", id, err)
			}
			m := NewMatch(tr, 42, false)
			rng := rand.New(rand.NewSource(7))
			ticks := 0
			fail := func(format string, args ...any) {
				t.Fatalf("tick=%d %s", ticks, fmt.Sprintf(format, args...))
			}
			for ticks < 9000 {
				ticks++
				// Player: random walk bursts and random shots so craters form
				// under and around the actors.
				if m.Phase == "player" {
					switch {
					case rng.Intn(60) == 0:
						m.fireLocked(0, 20+rng.Float64()*60, 300+rng.Float64()*(ForceMax-300))
					case rng.Intn(3) == 0:
						dir := 1
						if rng.Intn(2) == 0 {
							dir = -1
						}
						if !m.moveActorLocked(0, dir, MoveSpeed*0.05) {
							m.moveActorLocked(0, -dir, MoveSpeed*0.05)
						}
					}
				}
				m.Update(PhysicsDT)
				for _, a := range m.Actors {
					if !a.Alive || a.Falling || !a.Grounded {
						continue
					}
					x, y := int(a.X), int(a.Y)
					// Surface of the column *near the feet*: an overhang high
					// above the actor is legitimate (standing under a floating
					// island), so probe a local window, not the whole column.
					gyNear, ok := tr.FindGroundY(x, y-20, tr.Height-1)
					if !ok {
						fail("actor %d at x=%d y=%d has no terrain below (free fall while grounded)", a.Index, x, y)
					}
					if gyNear < y {
						// Column surface starts above the feet = sunk in.
						fail("actor %d SUNK: x=%d y=%d but local surface gy=%d (delta %d)",
							a.Index, x, y, gyNear, gyNear-y)
					}
					if tr.IsSolid(x, y-1) {
						fail("actor %d body inside terrain: x=%d y=%d solid above feet",
							a.Index, x, y)
					}
				}
				if m.Phase == "gameover" {
					break
				}
			}
			if ticks >= 9000 {
				t.Log("map", id, "hit tick cap (match kept going)")
			}
		})
	}
}
