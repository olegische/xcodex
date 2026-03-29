#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE_PORT="${CODEXUI_BRIDGE_PORT:-5999}"
BRIDGE_BASE_URL="http://localhost:$BRIDGE_PORT"
BRIDGE_LOG_FILE="${TMPDIR:-/tmp}/xcodex-local-codex-bridge.log"

cleanup() {
  if [ -n "${BRIDGE_PID:-}" ] && kill -0 "$BRIDGE_PID" 2>/dev/null; then
    kill "$BRIDGE_PID" 2>/dev/null || true
    wait "$BRIDGE_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

wait_for_bridge() {
  local attempts=0
  local max_attempts=60
  while [ "$attempts" -lt "$max_attempts" ]; do
    if curl --silent --fail "$BRIDGE_BASE_URL/codex-api/meta/methods" >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
      echo "codex bridge exited before becoming ready" >&2
      return 1
    fi
    attempts=$((attempts + 1))
    sleep 1
  done

  echo "timed out waiting for codex bridge at $BRIDGE_BASE_URL" >&2
  return 1
}

echo "[local-codex] starting codex bridge on $BRIDGE_BASE_URL"
echo "[local-codex] bridge log: $BRIDGE_LOG_FILE"
(
  cd "$ROOT_DIR/codex-rs/wasm/apps/webui"
  node ./scripts/vendor/codex-local-bridge.mjs --port "$BRIDGE_PORT" >>"$BRIDGE_LOG_FILE" 2>&1
) &
BRIDGE_PID=$!

wait_for_bridge

echo "[local-codex] starting wasm webui dev server"
cd "$ROOT_DIR/codex-rs"
./wasm/scripts/build-web-runtime.sh --app apps/webui --runtime wasm
cd wasm/apps/webui
npm run dev
