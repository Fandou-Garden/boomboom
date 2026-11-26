package game

// EventsSince returns a copy of the retained event log after seq. The browser
// WASM transport uses it instead of SSE; the HTTP server keeps its subscriber
// channels unchanged.
func (m *Match) EventsSince(seq uint64) []Event {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Event, 0, 8)
	for _, ev := range m.EventLog {
		if ev.Seq > seq {
			out = append(out, ev)
		}
	}
	return out
}
