//go:build js && wasm

// Command wasm exposes the authoritative Go match to the static browser build.
// The HTTP server remains the source of truth for local/online play; this
// adapter only runs when no /api backend is reachable.
package main

import (
	"encoding/json"
	"fmt"
	"syscall/js"
	"time"

	"gunny/server/game"
)

var (
	match   *game.Match
	lastSeq uint64
)

func bytesFromJS(v js.Value) []byte {
	if v.Type() != js.TypeObject {
		return nil
	}
	n := v.Length()
	if n <= 0 {
		return nil
	}
	buf := make([]byte, n)
	js.CopyBytesToGo(buf, v)
	return buf
}

func initMatch(this js.Value, args []js.Value) any {
	if len(args) < 4 {
		return "gunnyInit requires map + three crater PNG buffers"
	}
	mapID := 1156
	if len(args) > 5 && args[5].Truthy() {
		mapID = args[5].Int()
	}
	if err := game.UseMap(mapID); err != nil {
		return err.Error()
	}
	arts := map[string][]byte{
		"50":  bytesFromJS(args[1]),
		"401": bytesFromJS(args[2]),
		"4":   bytesFromJS(args[3]),
	}
	terrain, err := game.LoadTerrainFromBytes(bytesFromJS(args[0]), arts)
	if err != nil {
		return err.Error()
	}
	match = game.NewMatch(terrain, time.Now().UnixNano(), true)
	debug := len(args) > 4 && args[4].Truthy()
	match.SetDebug(debug)
	lastSeq = 0
	return ""
}

func command(this js.Value, args []js.Value) any {
	if match == nil {
		return "match not initialized"
	}
	if len(args) < 1 {
		return "missing command JSON"
	}
	var cmd game.Command
	if err := json.Unmarshal([]byte(args[0].String()), &cmd); err != nil {
		return fmt.Sprintf("invalid command: %v", err)
	}
	if err := match.Command(cmd); err != nil {
		return err.Error()
	}
	return ""
}

func update(this js.Value, args []js.Value) any {
	if match == nil {
		return nil
	}
	dt := 0.0
	if len(args) > 0 {
		dt = args[0].Float()
	}
	match.Update(dt)
	return nil
}

func snapshot(this js.Value, args []js.Value) any {
	if match == nil {
		return "null"
	}
	data, err := json.Marshal(match.Snapshot())
	if err != nil {
		return "null"
	}
	return string(data)
}

func events(this js.Value, args []js.Value) any {
	if match == nil {
		return "[]"
	}
	list := match.EventsSince(lastSeq)
	if len(list) == 0 {
		return "[]"
	}
	lastSeq = list[len(list)-1].Seq
	data, err := json.Marshal(list)
	if err != nil {
		return "[]"
	}
	return string(data)
}

func main() {
	js.Global().Set("GunnyWasm", js.ValueOf(map[string]any{
		"init":     js.FuncOf(initMatch),
		"command":  js.FuncOf(command),
		"update":   js.FuncOf(update),
		"snapshot": js.FuncOf(snapshot),
		"events":   js.FuncOf(events),
	}))
	select {}
}
