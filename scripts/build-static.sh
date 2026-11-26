#!/bin/sh
# Build a deployable static archive with index.html at the zip root.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
"$ROOT/scripts/build-wasm.sh"
OUT="${1:-$ROOT/gunny-static.zip}"
rm -f "$OUT"
(cd "$ROOT/dist" && zip -qr "$OUT" . -x '.*' -x '*/.*')
echo "STATIC ARCHIVE: $OUT"
