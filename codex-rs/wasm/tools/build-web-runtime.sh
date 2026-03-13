#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: build-web-runtime.sh --app <apps/webui|examples/browser-chat-demo|examples/webui-runtime-profiles>

Builds codex-wasm-core and prepares browser runtime assets for the selected app.

Environment:
  XROUTER_BROWSER_TARBALL  Override xrouter-browser tarball source.
  XROUTER_BROWSER_DIR      Build xrouter-browser from a local checkout instead of a tarball.
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

APP_PATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP_PATH="${2:-}"
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

if [[ -z "${APP_PATH}" ]]; then
  echo "--app is required" >&2
  usage >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_RS_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${CODEX_RS_ROOT}/.." && pwd)"
APP_DIR="${CODEX_RS_ROOT}/wasm/${APP_PATH}"
PKG_ROOT="${APP_DIR}/pkg"
PUBLIC_PKG_ROOT="${APP_DIR}/public/pkg"
XROUTER_PKG_ROOT="${APP_DIR}/xrouter-browser-pkg"
PUBLIC_XROUTER_PKG_ROOT="${APP_DIR}/public/xrouter-browser"
XROUTER_TARGET_DIR="${APP_DIR}/.cargo-target/xrouter-browser"
BUILD_ID="$(date -u +%Y%m%d%H%M%S)"
DEFAULT_XROUTER_BROWSER_TARBALL="https://github.com/olegische/xrouter/releases/download/xrouter-browser-main/xrouter-browser-main.tar.gz"
OUT_DIR="${PKG_ROOT}/${BUILD_ID}"
PUBLIC_OUT_DIR="${PUBLIC_PKG_ROOT}/${BUILD_ID}"
XROUTER_OUT_DIR="${XROUTER_PKG_ROOT}/${BUILD_ID}"
PUBLIC_XROUTER_OUT_DIR="${PUBLIC_XROUTER_PKG_ROOT}/${BUILD_ID}"
PUBLIC_CURRENT_OUT_DIR="${PUBLIC_PKG_ROOT}/current"
PUBLIC_XROUTER_CURRENT_OUT_DIR="${PUBLIC_XROUTER_PKG_ROOT}/current"
XROUTER_BROWSER_TARBALL_SOURCE="${XROUTER_BROWSER_TARBALL:-}"

if [[ ! -d "${APP_DIR}" ]]; then
  echo "App directory not found: ${APP_DIR}" >&2
  exit 1
fi

if [[ -z "${XROUTER_BROWSER_TARBALL_SOURCE}" && -z "${XROUTER_BROWSER_DIR:-}" ]]; then
  XROUTER_BROWSER_TARBALL_SOURCE="${DEFAULT_XROUTER_BROWSER_TARBALL}"
fi

require_command cargo
require_command wasm-bindgen

mkdir -p "${OUT_DIR}" "${PUBLIC_OUT_DIR}" "${XROUTER_OUT_DIR}" "${PUBLIC_XROUTER_OUT_DIR}" \
  "${PUBLIC_CURRENT_OUT_DIR}" "${PUBLIC_XROUTER_CURRENT_OUT_DIR}"

cd "${CODEX_RS_ROOT}"
cargo build -p codex-wasm-core --target wasm32-unknown-unknown --release

wasm-bindgen \
  "${CODEX_RS_ROOT}/target/wasm32-unknown-unknown/release/codex_wasm_core.wasm" \
  --target web \
  --out-dir "${OUT_DIR}"

cp -R "${OUT_DIR}/." "${PUBLIC_OUT_DIR}/"
rm -rf "${PUBLIC_CURRENT_OUT_DIR}"
mkdir -p "${PUBLIC_CURRENT_OUT_DIR}"
cp -R "${OUT_DIR}/." "${PUBLIC_CURRENT_OUT_DIR}/"

cat > "${PKG_ROOT}/manifest.json" <<EOF
{
  "buildId": "${BUILD_ID}",
  "entry": "/pkg/current/codex_wasm_core.js",
  "wasm": "/pkg/current/codex_wasm_core_bg.wasm"
}
EOF

cp "${PKG_ROOT}/manifest.json" "${PUBLIC_PKG_ROOT}/manifest.json"

if [[ -n "${XROUTER_BROWSER_TARBALL_SOURCE}" ]]; then
  require_command curl
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${TMP_DIR}"' EXIT

  if [[ "${XROUTER_BROWSER_TARBALL_SOURCE}" =~ ^https?:// ]]; then
    curl -L "${XROUTER_BROWSER_TARBALL_SOURCE}" -o "${TMP_DIR}/xrouter-browser.tar.gz"
    TARBALL_PATH="${TMP_DIR}/xrouter-browser.tar.gz"
  else
    TARBALL_PATH="$(cd "$(dirname "${XROUTER_BROWSER_TARBALL_SOURCE}")" && pwd)/$(basename "${XROUTER_BROWSER_TARBALL_SOURCE}")"
  fi

  tar -xzf "${TARBALL_PATH}" -C "${TMP_DIR}"

  if [[ -d "${TMP_DIR}/xrouter-browser" ]]; then
    XROUTER_SOURCE_DIR="${TMP_DIR}/xrouter-browser"
  else
    XROUTER_SOURCE_DIR="$(find "${TMP_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  fi

  if [[ -z "${XROUTER_SOURCE_DIR:-}" || ! -f "${XROUTER_SOURCE_DIR}/xrouter_browser.js" || ! -f "${XROUTER_SOURCE_DIR}/xrouter_browser_bg.wasm" ]]; then
    echo "xrouter-browser tarball did not unpack into a valid browser bundle" >&2
    exit 1
  fi

  cp -R "${XROUTER_SOURCE_DIR}/." "${XROUTER_OUT_DIR}/"
  cp -R "${XROUTER_SOURCE_DIR}/." "${PUBLIC_XROUTER_OUT_DIR}/"
  rm -rf "${PUBLIC_XROUTER_CURRENT_OUT_DIR}"
  mkdir -p "${PUBLIC_XROUTER_CURRENT_OUT_DIR}"
  cp -R "${XROUTER_SOURCE_DIR}/." "${PUBLIC_XROUTER_CURRENT_OUT_DIR}/"
elif [[ -n "${XROUTER_BROWSER_DIR:-}" ]]; then
  XROUTER_BROWSER_DIR="$(cd "${XROUTER_BROWSER_DIR}" && pwd)"
  XROUTER_REPO_ROOT="$(cd "${XROUTER_BROWSER_DIR}/../.." && pwd)"

  cd "${XROUTER_REPO_ROOT}"
  CARGO_TARGET_DIR="${XROUTER_TARGET_DIR}" cargo build -p xrouter-browser --target wasm32-unknown-unknown --release

  wasm-bindgen \
    "${XROUTER_TARGET_DIR}/wasm32-unknown-unknown/release/xrouter_browser.wasm" \
    --target web \
    --out-dir "${XROUTER_OUT_DIR}"

  cp -R "${XROUTER_OUT_DIR}/." "${PUBLIC_XROUTER_OUT_DIR}/"
  rm -rf "${PUBLIC_XROUTER_CURRENT_OUT_DIR}"
  mkdir -p "${PUBLIC_XROUTER_CURRENT_OUT_DIR}"
  cp -R "${XROUTER_OUT_DIR}/." "${PUBLIC_XROUTER_CURRENT_OUT_DIR}/"
fi

if [[ -d "${PUBLIC_XROUTER_CURRENT_OUT_DIR}" && -f "${PUBLIC_XROUTER_CURRENT_OUT_DIR}/xrouter_browser.js" ]]; then
  cat > "${XROUTER_PKG_ROOT}/manifest.json" <<EOF
{
  "buildId": "${BUILD_ID}",
  "entry": "/xrouter-browser/current/xrouter_browser.js",
  "wasm": "/xrouter-browser/current/xrouter_browser_bg.wasm"
}
EOF
  cp "${XROUTER_PKG_ROOT}/manifest.json" "${PUBLIC_XROUTER_PKG_ROOT}/manifest.json"
fi

echo "Built web runtime assets:"
echo "  app:      ${APP_PATH}"
echo "  manifest: ${PKG_ROOT}/manifest.json"
echo "  output:   ${OUT_DIR}"
echo "  public:   ${PUBLIC_OUT_DIR}"

if [[ -f "${XROUTER_PKG_ROOT}/manifest.json" ]]; then
  echo "  xrouter:  ${XROUTER_PKG_ROOT}/manifest.json"
fi
