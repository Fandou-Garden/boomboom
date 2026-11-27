#!/bin/sh
# Build a deployable static archive with index.html at the zip root.
#
# The static build is pure JS: index.html probes /api/state, and when it is
# absent it loads dist/standalone-api.js, which drives dist/js/engine/. The Go
# server (server/) stays in the repo for the online path but is not part of
# this archive, so no WASM step runs here. `npm run build:wasm` can still
# rebuild dist/wasm/ from server/wasm if the legacy fallback is wanted.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT="${1:-$ROOT/gunny-static.zip}"
rm -f "$OUT"
(cd "$ROOT/dist" && zip -qr "$OUT" . -x '.*' -x '*/.*' -x 'wasm/*' -x 'offline-api.js')
echo "STATIC ARCHIVE: $OUT"
