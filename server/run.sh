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
# go.mod targets the pinned toolchain; never auto-download a newer one at boot.
export GOTOOLCHAIN="${GOTOOLCHAIN:-local}"
# PORT is injected by the hosting/publish runtime (npm start gets PORT=<port>).
# Fall back to ADDR for local overrides, then to :8000 for plain local dev.
# Binding to ":port" listens on 0.0.0.0 (all interfaces), as required by hosting.
exec "$GO_BIN" run . \
  -addr "${ADDR:-:${PORT:-8000}}" \
  -root ../dist \
  -map ../reference/map/1156/fore.map \
  -assets ../dist/assets \
  ${GUNNY_DEBUG:+-debug} \
  "$@"
