package game

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"hash/fnv"
	"image"
	_ "image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
)

// Crater is one carved original crater bitmap recorded for late joiners.
type Crater struct {
	X    int    `json:"x"`
	Y    int    `json:"y"`
	Art  string `json:"art"`
	Kind string `json:"kind,omitempty"`
}

// CraterArt is the alpha mask of an original Gunny crater PNG. The source
// Map.Dig removes the pre-authored shape; no procedural lobes are added.
type CraterArt struct {
	ID   string
	W, H int
	Mask []uint8
}

// Terrain is the server-side source bitmask plus destructible crater state.
// The map file is [int32 width][int32 height][MSB-first row bytes], exactly the
// format read by Game.Logic/Phy/Maps/Tile.cs.
type Terrain struct {
	Width, Height int
	Mask          []uint8
	Base          []uint8
	Craters       []Crater
	Art           map[string]*CraterArt
}

func LoadTerrain(mapPath, assetsDir string) (*Terrain, error) {
	data, err := os.ReadFile(mapPath)
	if err != nil {
		return nil, fmt.Errorf("read map: %w", err)
	}
	arts := map[string][]byte{}
	for _, id := range []string{"50", "401", "4"} {
		name := filepath.Join(assetsDir, "crater-"+id+".png")
		raw, err := os.ReadFile(name)
		if err != nil {
			return nil, fmt.Errorf("open crater art %s: %w", id, err)
		}
		arts[id] = raw
	}
	// SOURCE: BallList.xml 的 Crater 列按弹引用不同 crater/<id>/crater.png。
	// 除了三张基础坑外，注册 assets 目录下其余 crater-<id>.png（121/131/411
	// 等原版真图），供对应弹的 Carve 使用。
	matches, _ := filepath.Glob(filepath.Join(assetsDir, "crater-*.png"))
	for _, name := range matches {
		base := filepath.Base(name)
		id := strings.TrimSuffix(strings.TrimPrefix(base, "crater-"), ".png")
		if _, ok := arts[id]; ok {
			continue
		}
		raw, err := os.ReadFile(name)
		if err != nil {
			continue
		}
		arts[id] = raw
	}
	return LoadTerrainFromBytes(data, arts)
}

// LoadTerrainFromBytes is the browser/WASM entry point: the map bitmask and
// the three original crater PNGs are supplied by JS instead of the filesystem.
func LoadTerrainFromBytes(data []byte, arts map[string][]byte) (*Terrain, error) {
	if len(data) < 8 {
		return nil, fmt.Errorf("map file too short: %d", len(data))
	}
	w := int(binary.LittleEndian.Uint32(data[0:4]))
	h := int(binary.LittleEndian.Uint32(data[4:8]))
	bw := w/8 + 1
	if w <= 0 || h <= 0 || len(data) < 8+bw*h {
		return nil, fmt.Errorf("invalid map header %dx%d, bytes %d", w, h, len(data))
	}
	mask := make([]uint8, w*h)
	raw := data[8:]
	for y := 0; y < h; y++ {
		row := y * bw
		for x := 0; x < w; x++ {
			if raw[row+x/8]&(1<<uint(7-x%8)) != 0 {
				mask[y*w+x] = 1
			}
		}
	}
	t := &Terrain{
		Width: w, Height: h,
		Mask: mask, Base: append([]uint8(nil), mask...),
		Art: map[string]*CraterArt{},
	}
	// 基础三坑必须存在；其余（BallList Crater 列引用的原版弹坑）一并注册，
	// 缺哪个弹的坑就只影响该弹的 Carve。
	for _, id := range []string{"50", "401", "4"} {
		if _, ok := arts[id]; !ok {
			return nil, fmt.Errorf("missing crater art %s", id)
		}
	}
	for id, raw := range arts {
		art, err := decodeCraterArt(id, raw)
		if err != nil {
			return nil, err
		}
		t.Art[id] = art
	}
	return t, nil
}

func loadCraterArt(dir, id string) (*CraterArt, error) {
	name := filepath.Join(dir, "crater-"+id+".png")
	raw, err := os.ReadFile(name)
	if err != nil {
		return nil, fmt.Errorf("open crater art %s: %w", id, err)
	}
	return decodeCraterArt(id, raw)
}

func decodeCraterArt(id string, raw []byte) (*CraterArt, error) {
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("decode crater art %s: %w", id, err)
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	mask := make([]uint8, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			_, _, _, a := img.At(b.Min.X+x, b.Min.Y+y).RGBA()
			if uint8(a>>8) > 100 { // SOURCE: Tile(Bitmap) treats A <= 100 as empty
				mask[y*w+x] = 1
			}
		}
	}
	return &CraterArt{ID: id, W: w, H: h, Mask: mask}, nil
}

func (t *Terrain) Reset() {
	copy(t.Mask, t.Base)
	t.Craters = t.Craters[:0]
}

func (t *Terrain) InBounds(x, y int) bool {
	return x >= 0 && y >= 0 && x < t.Width && y < t.Height
}

func (t *Terrain) IsSolid(x, y int) bool {
	return t.InBounds(x, y) && t.Mask[y*t.Width+x] == 1
}

func (t *Terrain) IsSolidF(x, y float64) bool {
	return t.IsSolid(int(math.Floor(x)), int(math.Floor(y)))
}

// IsSolidCircle is the browser bomb probe: center + eight perimeter samples.
func (t *Terrain) IsSolidCircle(x, y, radius float64) bool {
	if t.IsSolidF(x, y) {
		return true
	}
	for i := 0; i < 8; i++ {
		a := float64(i) / 8 * math.Pi * 2
		if t.IsSolidF(x+math.Cos(a)*radius, y+math.Sin(a)*radius) {
			return true
		}
	}
	return false
}

// IsSolidRect mirrors the source 6x6 rectangle test. A full scan is cheap and
// conservative (the source quick path can only be more permissive).
func (t *Terrain) IsSolidRect(x, y, w, h int) bool {
	for py := y; py < y+h; py++ {
		for px := x; px < x+w; px++ {
			if t.IsSolid(px, py) {
				return true
			}
		}
	}
	return false
}

func (t *Terrain) FindGroundY(x, fromY, toY int) (int, bool) {
	if x < 0 || x >= t.Width {
		return 0, false
	}
	start := max(0, fromY)
	end := min(t.Height-1, toY)
	for y := start; y <= end; y++ {
		if t.Mask[y*t.Width+x] == 1 {
			return y, true
		}
	}
	return 0, false
}

// FindNextWalkPoint is a direct port of Game.Logic/Phy/Maps/Map.cs.
// It scans two adjacent columns (x-1 and x+1), not the center pixel.
func (t *Terrain) FindNextWalkPoint(x, y, direction, stepX, stepY int) (int, int, bool) {
	if direction != 1 && direction != -1 {
		return 0, 0, false
	}
	x2 := x + direction*stepX
	if x2 < 0 || x2 > t.Width {
		return 0, 0, false
	}
	for py := y - stepY - 1; py < t.Height; py++ {
		if py < 0 {
			continue
		}
		if t.IsSolid(x2-1, py) || t.IsSolid(x2+1, py) {
			if absInt(py-y) > stepY {
				return 0, 0, false
			}
			return x2, py, true
		}
	}
	return 0, 0, false
}

// SlopeAt ports the browser's calcObjectAngle(16) average. The source body
// slope affects weapon grip/muzzle; the server must match the renderer.
func (t *Terrain) SlopeAt(x, y, maxDegrees float64) float64 {
	leftSum, rightSum := 0.0, 0.0
	leftCount, rightCount := 0, 0
	for offset := 2; offset <= 16; offset += 2 {
		if gy, ok := t.FindGroundY(int(x)-offset, int(y)-10, int(y)+10); ok {
			leftSum += float64(gy)
			leftCount++
		}
		if gy, ok := t.FindGroundY(int(x)+offset, int(y)-10, int(y)+10); ok {
			rightSum += float64(gy)
			rightCount++
		}
	}
	if leftCount == 0 || rightCount == 0 {
		return 0
	}
	leftY := leftSum / float64(leftCount)
	rightY := rightSum / float64(rightCount)
	angle := math.Atan2(rightY-leftY, 16) * 180 / math.Pi
	return Clamp(angle, -maxDegrees, maxDegrees)
}

// Carve removes the original crater bitmap centered at (cx, cy). It mirrors
// Game.Logic/Phy/Maps/Tile.cs Dig(cx, cy, surface, border): the shape is
// centered on the impact and only removes existing solid pixels.
func (t *Terrain) Carve(cx, cy int, artID, kind string) (removed int, bounds [4]int, ok bool) {
	art := t.Art[artID]
	if art == nil {
		return 0, bounds, false
	}
	x0 := cx - art.W/2
	y0 := cy - art.H/2
	bounds = [4]int{x0, y0, x0 + art.W, y0 + art.H}
	any := false
	for ay := 0; ay < art.H; ay++ {
		wy := y0 + ay
		// Keep the source bedrock floor intact: craters may never dig into
		// the fully-solid base rows at y >= BedrockY.
		if wy < 0 || wy >= t.Height || wy >= BedrockY {
			continue
		}
		row := wy * t.Width
		arow := ay * art.W
		for ax := 0; ax < art.W; ax++ {
			if art.Mask[arow+ax] == 0 {
				continue
			}
			wx := x0 + ax
			if wx < 0 || wx >= t.Width {
				continue
			}
			if t.Mask[row+wx] == 1 {
				t.Mask[row+wx] = 0
				removed++
				any = true
			}
		}
	}
	if !any {
		return 0, bounds, false
	}
	t.Craters = append(t.Craters, Crater{X: cx, Y: cy, Art: artID, Kind: kind})
	return removed, bounds, true
}

func (t *Terrain) SolidCount() int {
	n := 0
	for _, v := range t.Mask {
		if v == 1 {
			n++
		}
	}
	return n
}

func (t *Terrain) Hash() uint64 {
	h := fnv.New64a()
	_, _ = h.Write(t.Mask)
	return h.Sum64()
}

func (t *Terrain) CratersCopy() []Crater {
	return append([]Crater(nil), t.Craters...)
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
