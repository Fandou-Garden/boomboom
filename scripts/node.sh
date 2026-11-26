#!/bin/sh
# Pick a Node.js >= 18 even when the login shell still points at Node 16.
set -eu
pick() {
  for c in "$@"; do
    [ -n "$c" ] || continue
    if [ -x "$c" ]; then
      v=$("$c" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
      if [ "$v" -ge 18 ] 2>/dev/null; then printf '%s\n' "$c"; return 0; fi
    fi
  done
  return 1
}
NODE_BIN="${NODE_BIN:-}"
if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then
  exec "$NODE_BIN" "$@"
fi
CANDIDATE=$(command -v node 2>/dev/null || true)
if [ -n "$CANDIDATE" ]; then
  V=$("$CANDIDATE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "$V" -ge 18 ] 2>/dev/null; then exec "$CANDIDATE" "$@"; fi
fi
FOUND=$(pick /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node || true)
if [ -z "$FOUND" ]; then
  echo "Node.js 18+ is required. Install Node or set NODE_BIN=/path/to/node." >&2
  exit 1
fi
exec "$FOUND" "$@"
