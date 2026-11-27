#!/bin/sh
# Build the static-host WASM engine and copy the matching Go runtime.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
GO_BIN="${GO_BIN:-}"
if [ -z "$GO_BIN" ] || [ ! -x "$GO_BIN" ]; then
  for c in /opt/homebrew/bin/go /usr/local/bin/go /usr/bin/go; do
    if [ -x "$c" ]; then GO_BIN="$c"; break; fi
  done
fi
if [ -z "$GO_BIN" ] || [ ! -x "$GO_BIN" ]; then
  echo "Go 1.21+ is required for build:wasm; set GO_BIN=/path/to/go" >&2
  exit 1
fi
GOROOT=$("$GO_BIN" env GOROOT)
mkdir -p "$ROOT/dist/wasm" "$ROOT/dist/data"
(cd "$ROOT/server" && GOOS=js GOARCH=wasm "$GO_BIN" build -o "$ROOT/dist/wasm/gunny.wasm" ./wasm)
if [ -f "$GOROOT/lib/wasm/wasm_exec.js" ]; then
  cp "$GOROOT/lib/wasm/wasm_exec.js" "$ROOT/dist/wasm/wasm_exec.js"
elif [ -f "$GOROOT/misc/wasm/wasm_exec.js" ]; then
  cp "$GOROOT/misc/wasm/wasm_exec.js" "$ROOT/dist/wasm/wasm_exec.js"
else
  echo "wasm_exec.js not found under $GOROOT" >&2
  exit 1
fi
for map_id in 1001 1156; do
  cp "$ROOT/reference/map/$map_id/fore.map" "$ROOT/dist/data/$map_id.fore.map"
done
echo "WASM STATIC BUILD OK: dist/wasm/gunny.wasm"
