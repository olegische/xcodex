#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: build-xcodex-wasm-tarball.sh [--release-sha <sha>] [--release-ref <ref>] [--run-id <id>] [--dist-dir <path>]

Build the local xcodex-wasm tarball layout used by downstream web consumers.

Defaults:
  --release-sha  git rev-parse HEAD
  --release-ref  git rev-parse --abbrev-ref HEAD
  --run-id       local-macos
  --dist-dir     dist
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

RELEASE_SHA="$(git rev-parse HEAD)"
RELEASE_REF="$(git rev-parse --abbrev-ref HEAD)"
RUN_ID="local-macos"
DIST_DIR="dist"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-sha)
      RELEASE_SHA="${2:-}"
      shift 2
      ;;
    --release-ref)
      RELEASE_REF="${2:-}"
      shift 2
      ;;
    --run-id)
      RUN_ID="${2:-}"
      shift 2
      ;;
    --dist-dir)
      DIST_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command cargo
require_command npm
require_command tar
require_command shasum
require_command wasm-bindgen

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${WASM_ROOT}/../.." && pwd)"

OUT_DIR="${REPO_ROOT}/${DIST_DIR}/xcodex-wasm/current"
mkdir -p "${OUT_DIR}"

cargo build \
  --manifest-path "${REPO_ROOT}/codex-rs/Cargo.toml" \
  -p codex-wasm-browser \
  --target wasm32-unknown-unknown \
  --release

wasm-bindgen \
  "${REPO_ROOT}/codex-rs/target/wasm32-unknown-unknown/release/codex_wasm_browser.wasm" \
  --target web \
  --out-dir "${OUT_DIR}" \
  --out-name xcodex

if [[ ! -d "${REPO_ROOT}/codex-rs/wasm/node_modules" ]]; then
  npm install --prefix "${REPO_ROOT}/codex-rs/wasm"
fi

npm exec --prefix "${REPO_ROOT}/codex-rs/wasm" esbuild -- \
  "${REPO_ROOT}/codex-rs/wasm/ts/browser-runtime/src/index.ts" \
  --bundle \
  --format=esm \
  --platform=browser \
  --target=es2022 \
  --sourcemap \
  --outfile="${OUT_DIR}/xcodex-runtime.js"

cat > "${REPO_ROOT}/${DIST_DIR}/xcodex-wasm/manifest.json" <<EOF
{
  "buildId": "${RELEASE_SHA}",
  "entry": "/xcodex-wasm/current/xcodex.js",
  "wasm": "/xcodex-wasm/current/xcodex_bg.wasm",
  "runtime": "/xcodex-wasm/current/xcodex-runtime.js"
}
EOF

cat > "${REPO_ROOT}/${DIST_DIR}/xcodex-wasm/README.md" <<'EOF'
# xcodex-wasm

Rolling wasm branch build of the browser WASM runtime for xcodex.

Files:
- current/xcodex.js
- current/xcodex_bg.wasm
- current/xcodex.d.ts
- current/xcodex-runtime.js
- current/xcodex-runtime.js.map
- manifest.json
EOF

tar -C "${REPO_ROOT}/${DIST_DIR}" -czf "${REPO_ROOT}/${DIST_DIR}/xcodex-wasm.tar.gz" xcodex-wasm
shasum -a 256 "${REPO_ROOT}/${DIST_DIR}/xcodex-wasm.tar.gz" > "${REPO_ROOT}/${DIST_DIR}/xcodex-wasm.tar.gz.sha256"

cat > "${REPO_ROOT}/${DIST_DIR}/xcodex-wasm-release.txt" <<EOF
xcodex-wasm rolling wasm build
commit=${RELEASE_SHA}
ref=${RELEASE_REF}
run_id=${RUN_ID}
artifact=xcodex-wasm.tar.gz
entry=/xcodex-wasm/current/xcodex.js
wasm=/xcodex-wasm/current/xcodex_bg.wasm
runtime=/xcodex-wasm/current/xcodex-runtime.js
manifest=/xcodex-wasm/manifest.json
EOF
