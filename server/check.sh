#!/bin/sh
set -eu
cd "$(dirname "$0")"
ROOT=$(cd .. && pwd)
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
GOFMT="$(dirname "$GO_BIN")/gofmt"
if [ ! -x "$GOFMT" ]; then
  echo "gofmt not found next to $GO_BIN" >&2
  exit 1
fi
NODE="sh $ROOT/scripts/node.sh"
for f in "$ROOT"/dist/js/*.js "$ROOT"/dist/js/engine/*.js "$ROOT"/dist/standalone-api.js; do
  $NODE --check "$f"
done
UNFORMATTED=$("$GOFMT" -l .)
if [ -n "$UNFORMATTED" ]; then
  echo "gofmt needed:" >&2
  echo "$UNFORMATTED" >&2
  exit 1
fi
"$GO_BIN" vet ./...
echo "CHECK PASS"
