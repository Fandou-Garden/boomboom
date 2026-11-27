package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gunny/server/game"
)

type app struct {
	match *game.Match
	root  string
	debug bool
}

func main() {
	addr := flag.String("addr", ":8000", "HTTP listen address")
	root := flag.String("root", "./dist", "static web root (contains index.html)")
	mapID := flag.Int("map-id", 1156, "map id (1001 or 1156)")
	mapPath := flag.String("map", "", "original fore.map collision bitmap; defaults to the selected map id")
	assets := flag.String("assets", "./dist/assets", "directory containing crater-*.png")
	seed := flag.Int64("seed", time.Now().UnixNano(), "RNG seed for wind and AI")
	lowPower := flag.Bool("low-power", false, "reduce AI search cost")
	debug := flag.Bool("debug", false, "enable debug-only fire/teleport commands")
	flag.Parse()

	if _, err := os.Stat(filepath.Join(*root, "index.html")); err != nil {
		log.Fatalf("missing %s/index.html: %v", *root, err)
	}
	if err := game.UseMap(*mapID); err != nil {
		log.Fatalf("map: %v", err)
	}
	if *mapPath == "" {
		*mapPath = fmt.Sprintf("./reference/map/%d/fore.map", *mapID)
	}
	terrain, err := game.LoadTerrain(*mapPath, *assets)
	if err != nil {
		log.Fatalf("terrain: %v", err)
	}
	match := game.NewMatch(terrain, *seed, *lowPower)
	match.SetDebug(*debug)
	s := &app{match: match, root: *root, debug: *debug}

	go func() {
		ticker := time.NewTicker(40 * time.Millisecond)
		defer ticker.Stop()
		last := time.Now()
		for now := range ticker.C {
			dt := now.Sub(last).Seconds()
			last = now
			match.Update(dt)
			match.BroadcastState()
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	mux.HandleFunc("/api/state", s.handleState)
	mux.HandleFunc("/api/events", s.handleEvents)
	mux.HandleFunc("/api/command", s.handleCommand)
	mux.Handle("/", noStore(http.FileServer(http.Dir(*root))))

	log.Printf("Gunny Go server: http://127.0.0.1%s/  map=%d %s %dx%d spawns=%.0f/%.0f debug=%v",
		*addr, game.MapID, game.MapName, terrain.Width, terrain.Height, game.SpawnX[0], game.SpawnX[1], *debug)
	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatal(err)
	}
}

func (s *app) handleState(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.match.Snapshot())
}

func (s *app) handleCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var cmd game.Command
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&cmd); err != nil {
		http.Error(w, fmt.Sprintf("invalid command: %v", err), http.StatusBadRequest)
		return
	}
	if err := s.match.Command(cmd); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *app) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch, unsubscribe := s.match.Subscribe()
	defer unsubscribe()
	writeSSE(w, s.match.SnapshotEvent())
	flusher.Flush()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case ev, open := <-ch:
			if !open {
				return
			}
			writeSSE(w, ev)
			flusher.Flush()
		case <-heartbeat.C:
			_, _ = fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func writeSSE(w http.ResponseWriter, ev game.Event) {
	payload, err := json.Marshal(ev)
	if err != nil {
		return
	}
	name := "game"
	if ev.Type == "state" {
		name = "state"
	}
	_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", name, payload)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, max-age=0")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}
