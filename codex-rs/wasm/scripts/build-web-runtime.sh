#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: build-web-runtime.sh --app <apps/webui|examples/browser-chat-demo|examples/webui-runtime-profiles|examples/browser-terminal-demo|examples/browser-codex-demo|wasm/examples/...|wasm-arch/examples/...> [--runtime <wasm|wasm-arch|1|v1|arch|legacy>]

Builds the selected browser runtime package and prepares web assets for the selected app.

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
RUNTIME_KIND="wasm"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP_PATH="${2:-}"
      shift 2
      ;;
    --runtime)
      RUNTIME_KIND="${2:-}"
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

case "${RUNTIME_KIND}" in
  wasm-arch|arch|legacy|1|v1)
    RUNTIME_KIND="wasm-arch"
    RUNTIME_CRATE="codex-wasm-core"
    RUNTIME_WASM_BASENAME="codex_wasm_core"
    ;;
  wasm)
    RUNTIME_KIND="wasm"
    RUNTIME_CRATE="codex-wasm-core"
    RUNTIME_WASM_BASENAME="codex_wasm_core"
    ;;
  *)
    echo "Unsupported runtime: ${RUNTIME_KIND}" >&2
    usage >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CODEX_RS_ROOT="$(cd "${WASM_ROOT}/.." && pwd)"
if [[ "${APP_PATH}" = wasm/* || "${APP_PATH}" = wasm-arch/* ]]; then
  APP_DIR="${CODEX_RS_ROOT}/${APP_PATH}"
elif [[ "${RUNTIME_KIND}" = "wasm" && -d "${CODEX_RS_ROOT}/wasm/${APP_PATH}" ]]; then
  APP_DIR="${CODEX_RS_ROOT}/wasm/${APP_PATH}"
else
  APP_DIR="${CODEX_RS_ROOT}/wasm-arch/${APP_PATH}"
fi
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

if [[ "${RUNTIME_KIND}" == "wasm-arch" ]]; then
  RUNTIME_CRATE_MANIFEST="${CODEX_RS_ROOT}/wasm-arch/core/Cargo.toml"
else
  RUNTIME_CRATE="codex-wasm-browser"
  RUNTIME_WASM_BASENAME="codex_wasm_browser"
  RUNTIME_CRATE_MANIFEST="${CODEX_RS_ROOT}/wasm/browser/Cargo.toml"
fi

if [[ "${RUNTIME_KIND}" == "wasm" ]] && ! grep -Eq 'crate-type\s*=\s*\[[^]]*"cdylib"' "${RUNTIME_CRATE_MANIFEST}"; then
  cat >&2 <<EOF
Runtime '${RUNTIME_KIND}' is selected, but there is no browser export crate yet.

Expected a wasm-bindgen-ready library configuration in:
  ${RUNTIME_CRATE_MANIFEST}

The script is already wired for both runtime families, but the selected browser export crate is missing or not configured for wasm-bindgen packaging.
EOF
  exit 1
fi

mkdir -p "${OUT_DIR}" "${PUBLIC_OUT_DIR}" "${XROUTER_OUT_DIR}" "${PUBLIC_XROUTER_OUT_DIR}" \
  "${PUBLIC_CURRENT_OUT_DIR}" "${PUBLIC_XROUTER_CURRENT_OUT_DIR}"

cd "${CODEX_RS_ROOT}"
cargo build -p "${RUNTIME_CRATE}" --target wasm32-unknown-unknown --release

RUNTIME_WASM_PATH="${CODEX_RS_ROOT}/target/wasm32-unknown-unknown/release/${RUNTIME_WASM_BASENAME}.wasm"
if [[ ! -f "${RUNTIME_WASM_PATH}" ]]; then
  cat >&2 <<EOF
Selected runtime '${RUNTIME_KIND}' does not currently produce a browser-ready wasm artifact at:
  ${RUNTIME_WASM_PATH}

The build entrypoint is wired for both runtime families, but '${RUNTIME_KIND}' still needs its own browser export package before this command can finish successfully.
EOF
  exit 1
fi

wasm-bindgen \
  "${RUNTIME_WASM_PATH}" \
  --target web \
  --out-dir "${OUT_DIR}"

RUNTIME_JS_FILE="${RUNTIME_WASM_BASENAME}.js"
RUNTIME_WASM_BG_FILE="${RUNTIME_WASM_BASENAME}_bg.wasm"

cp -R "${OUT_DIR}/." "${PUBLIC_OUT_DIR}/"
rm -rf "${PUBLIC_CURRENT_OUT_DIR}"
mkdir -p "${PUBLIC_CURRENT_OUT_DIR}"
cp -R "${OUT_DIR}/." "${PUBLIC_CURRENT_OUT_DIR}/"

cat > "${PKG_ROOT}/manifest.json" <<EOF
{
  "buildId": "${BUILD_ID}",
  "entry": "/pkg/current/${RUNTIME_JS_FILE}",
  "wasm": "/pkg/current/${RUNTIME_WASM_BG_FILE}"
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
echo "  runtime:  ${RUNTIME_KIND}"
echo "  manifest: ${PKG_ROOT}/manifest.json"
echo "  output:   ${OUT_DIR}"
echo "  public:   ${PUBLIC_OUT_DIR}"

if [[ -f "${XROUTER_PKG_ROOT}/manifest.json" ]]; then
  echo "  xrouter:  ${XROUTER_PKG_ROOT}/manifest.json"
fi
