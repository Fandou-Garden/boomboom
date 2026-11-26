#!/bin/sh
set -eu
cd "$(dirname "$0")"
GO_BIN="${GO_BIN:-$(command -v go 2>/dev/null || true)}"
if [ -z "$GO_BIN" ]; then
  for candidate in /opt/homebrew/bin/go /usr/local/bin/go /usr/bin/go; do
    if [ -x "$candidate" ]; then GO_BIN="$candidate"; break; fi
  done
fi
if [ -z "$GO_BIN" ]; then
  echo "Go 1.21+ is required. Install Go or set GO_BIN=/path/to/go." >&2
  exit 1
fi
exec "$GO_BIN" run . \
  -addr "${ADDR:-:8000}" \
  -root ../dist \
  -map ../reference/map/1001/fore.map \
  -assets ../dist/assets \
  ${GUNNY_DEBUG:+-debug} \
  "$@"
