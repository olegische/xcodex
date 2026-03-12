#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
PKG_ROOT="${SCRIPT_DIR}/pkg"
PUBLIC_PKG_ROOT="${SCRIPT_DIR}/public/pkg"
XROUTER_PKG_ROOT="${SCRIPT_DIR}/xrouter-browser-pkg"
PUBLIC_XROUTER_PKG_ROOT="${SCRIPT_DIR}/public/xrouter-browser"
XROUTER_TARGET_DIR="${SCRIPT_DIR}/.cargo-target/xrouter-browser"
BUILD_ID="$(date -u +%Y%m%d%H%M%S)"
DEFAULT_XROUTER_BROWSER_TARBALL="https://github.com/olegische/xrouter/releases/download/xrouter-browser-main/xrouter-browser-main.tar.gz"
OUT_DIR="${PKG_ROOT}/${BUILD_ID}"
PUBLIC_OUT_DIR="${PUBLIC_PKG_ROOT}/${BUILD_ID}"
XROUTER_OUT_DIR="${XROUTER_PKG_ROOT}/${BUILD_ID}"
PUBLIC_XROUTER_OUT_DIR="${PUBLIC_XROUTER_PKG_ROOT}/${BUILD_ID}"
PUBLIC_CURRENT_OUT_DIR="${PUBLIC_PKG_ROOT}/current"
PUBLIC_XROUTER_CURRENT_OUT_DIR="${PUBLIC_XROUTER_PKG_ROOT}/current"
XROUTER_BROWSER_TARBALL_SOURCE="${XROUTER_BROWSER_TARBALL:-}"

if [[ -z "${XROUTER_BROWSER_TARBALL_SOURCE}" && -z "${XROUTER_BROWSER_DIR:-}" ]]; then
  XROUTER_BROWSER_TARBALL_SOURCE="${DEFAULT_XROUTER_BROWSER_TARBALL}"
fi

mkdir -p "${OUT_DIR}"
mkdir -p "${PUBLIC_OUT_DIR}"
mkdir -p "${XROUTER_OUT_DIR}"
mkdir -p "${PUBLIC_XROUTER_OUT_DIR}"
mkdir -p "${PUBLIC_CURRENT_OUT_DIR}"
mkdir -p "${PUBLIC_XROUTER_CURRENT_OUT_DIR}"

cd "${REPO_ROOT}"
cargo build -p codex-wasm-core --target wasm32-unknown-unknown --release

wasm-bindgen \
  "${REPO_ROOT}/target/wasm32-unknown-unknown/release/codex_wasm_core.wasm" \
  --target web \
  --out-dir "${OUT_DIR}"

cp -R "${OUT_DIR}/." "${PUBLIC_OUT_DIR}/"
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
  cp -R "${XROUTER_SOURCE_DIR}/." "${PUBLIC_XROUTER_CURRENT_OUT_DIR}/"

  cat > "${XROUTER_PKG_ROOT}/manifest.json" <<EOF
{
  "buildId": "${BUILD_ID}",
  "entry": "/xrouter-browser/current/xrouter_browser.js",
  "wasm": "/xrouter-browser/current/xrouter_browser_bg.wasm"
}
EOF

  cp "${XROUTER_PKG_ROOT}/manifest.json" "${PUBLIC_XROUTER_PKG_ROOT}/manifest.json"
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
  cp -R "${XROUTER_OUT_DIR}/." "${PUBLIC_XROUTER_CURRENT_OUT_DIR}/"

  cat > "${XROUTER_PKG_ROOT}/manifest.json" <<EOF
{
  "buildId": "${BUILD_ID}",
  "entry": "/xrouter-browser/current/xrouter_browser.js",
  "wasm": "/xrouter-browser/current/xrouter_browser_bg.wasm"
}
EOF

  cp "${XROUTER_PKG_ROOT}/manifest.json" "${PUBLIC_XROUTER_PKG_ROOT}/manifest.json"
fi

echo "Built browser chat demo package:"
echo "  manifest: ${PKG_ROOT}/manifest.json"
echo "  output:   ${OUT_DIR}"
echo "  public:   ${PUBLIC_OUT_DIR}"
if [[ -n "${XROUTER_BROWSER_TARBALL_SOURCE}" ]]; then
  echo "Used prebuilt xrouter-browser bundle:"
  echo "  source:   ${XROUTER_BROWSER_TARBALL_SOURCE}"
  echo "  manifest: ${XROUTER_PKG_ROOT}/manifest.json"
  echo "  output:   ${XROUTER_OUT_DIR}"
  echo "  public:   ${PUBLIC_XROUTER_OUT_DIR}"
elif [[ -n "${XROUTER_BROWSER_DIR:-}" ]]; then
  echo "Built xrouter-browser package:"
  echo "  manifest: ${XROUTER_PKG_ROOT}/manifest.json"
  echo "  output:   ${XROUTER_OUT_DIR}"
  echo "  public:   ${PUBLIC_XROUTER_OUT_DIR}"
else
  echo "Skipped xrouter-browser bundle."
fi
