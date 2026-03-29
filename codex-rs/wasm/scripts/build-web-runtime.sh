#!/usr/bin/env bash
set -euo pipefail

TMP_DIR=""

usage() {
  cat <<'EOF'
Usage: build-web-runtime.sh --app <apps/webui|examples/browser-chat-demo|examples/webui-runtime-profiles|examples/browser-terminal-demo|examples/browser-codex-demo|wasm/examples/...|wasm-arch/examples/...> [--runtime <wasm|wasm-arch|1|v1|arch|legacy>]

Downloads released browser runtime tarballs and prepares web assets for the selected app.

Environment:
  XCODEX_WASM_TARBALL      Override xcodex-wasm tarball source.
  XROUTER_BROWSER_TARBALL  Override xrouter-browser tarball source.
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

download_if_url() {
  local source="$1"
  local target="$2"
  if [[ "${source}" =~ ^https?:// ]]; then
    curl -L "${source}" -o "${target}"
  else
    cp "${source}" "${target}"
  fi
}

find_dir_with_files() {
  local root="$1"
  shift
  python3 - "$root" "$@" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
required = sys.argv[2:]

for candidate in sorted([p for p in root.rglob("*") if p.is_dir()]):
    names = {child.name for child in candidate.iterdir()}
    if all(item in names for item in required):
        print(candidate)
        sys.exit(0)

sys.exit(1)
PY
}

prepare_versioned_dir() {
  local source_dir="$1"
  local target_dir="$2"

  rm -rf "${target_dir}"
  mkdir -p "${target_dir}"
  cp -R "${source_dir}/." "${target_dir}/"
}

prepare_current_dir() {
  local source_dir="$1"
  local target_root="$2"
  local current_dir="${target_root}/current"
  local source_abs
  local current_abs

  source_abs="$(cd "${source_dir}" && pwd)"
  current_abs="$(mkdir -p "${current_dir}" && cd "${current_dir}" && pwd)"

  if [[ "${source_abs}" == "${current_abs}" ]]; then
    return
  fi

  rm -rf "${current_dir}"
  mkdir -p "${current_dir}"
  cp -R "${source_dir}/." "${current_dir}/"
}

write_manifest() {
  local manifest_path="$1"
  local build_id="$2"
  local entry_path="$3"
  local wasm_path="$4"
  local runtime_path="${5:-}"

  mkdir -p "$(dirname "${manifest_path}")"
  if [[ -n "${runtime_path}" ]]; then
    cat > "${manifest_path}" <<EOF
{
  "buildId": "${build_id}",
  "entry": "${entry_path}",
  "wasm": "${wasm_path}",
  "runtime": "${runtime_path}"
}
EOF
    return
  fi

  cat > "${manifest_path}" <<EOF
{
  "buildId": "${build_id}",
  "entry": "${entry_path}",
  "wasm": "${wasm_path}"
}
EOF
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

if [[ "${APP_PATH}" == app=* ]]; then
  APP_PATH="${APP_PATH#app=}"
fi

if [[ "${RUNTIME_KIND}" == runtime=* ]]; then
  RUNTIME_KIND="${RUNTIME_KIND#runtime=}"
fi

case "${RUNTIME_KIND}" in
  wasm-arch|arch|legacy|1|v1)
    echo "Released tarball workflow currently supports only --runtime wasm" >&2
    exit 1
    ;;
  wasm)
    ;;
  *)
    echo "Unsupported runtime: ${RUNTIME_KIND}" >&2
    usage >&2
    exit 1
    ;;
esac

require_command curl
require_command tar
require_command python3

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CODEX_RS_ROOT="$(cd "${WASM_ROOT}/.." && pwd)"

if [[ "${APP_PATH}" = wasm/* || "${APP_PATH}" = wasm-arch/* ]]; then
  APP_DIR="${CODEX_RS_ROOT}/${APP_PATH}"
elif [[ -d "${CODEX_RS_ROOT}/wasm/${APP_PATH}" ]]; then
  APP_DIR="${CODEX_RS_ROOT}/wasm/${APP_PATH}"
else
  APP_DIR="${CODEX_RS_ROOT}/wasm-arch/${APP_PATH}"
fi

if [[ ! -d "${APP_DIR}" ]]; then
  echo "App directory not found: ${APP_DIR}" >&2
  exit 1
fi

PKG_ROOT="${APP_DIR}/pkg"
PUBLIC_PKG_ROOT="${APP_DIR}/public/pkg"
XROUTER_PKG_ROOT="${APP_DIR}/xrouter-browser-pkg"
PUBLIC_XROUTER_PKG_ROOT="${APP_DIR}/public/xrouter-browser"

DEFAULT_XCODEX_WASM_TARBALL="https://github.com/olegische/xcodex/releases/download/xcodex-wasm/xcodex-wasm.tar.gz"
DEFAULT_XROUTER_BROWSER_TARBALL="https://github.com/olegische/xrouter/releases/download/xrouter-browser-main/xrouter-browser-main.tar.gz"
LOCAL_XCODEX_WASM_TARBALL="${CODEX_RS_ROOT}/../dist/xcodex-wasm.tar.gz"
LOCAL_XROUTER_BROWSER_DIR="${XROUTER_PKG_ROOT}/current"
LOCAL_XROUTER_BROWSER_PUBLIC_DIR="${PUBLIC_XROUTER_PKG_ROOT}/current"
if [[ -n "${XCODEX_WASM_TARBALL:-}" ]]; then
  XCODEX_WASM_TARBALL_SOURCE="${XCODEX_WASM_TARBALL}"
elif [[ -f "${LOCAL_XCODEX_WASM_TARBALL}" ]]; then
  XCODEX_WASM_TARBALL_SOURCE="${LOCAL_XCODEX_WASM_TARBALL}"
else
  XCODEX_WASM_TARBALL_SOURCE="${DEFAULT_XCODEX_WASM_TARBALL}"
fi
if [[ -n "${XROUTER_BROWSER_TARBALL:-}" ]]; then
  XROUTER_BROWSER_TARBALL_SOURCE="${XROUTER_BROWSER_TARBALL}"
else
  XROUTER_BROWSER_TARBALL_SOURCE="${DEFAULT_XROUTER_BROWSER_TARBALL}"
fi

TMP_DIR="$(mktemp -d)"
trap '[[ -n "${TMP_DIR:-}" ]] && rm -rf "${TMP_DIR}"' EXIT

XCODEX_TARBALL_PATH="${TMP_DIR}/xcodex-wasm.tar.gz"
XROUTER_TARBALL_PATH="${TMP_DIR}/xrouter-browser.tar.gz"
XCODEX_UNPACK_DIR="${TMP_DIR}/xcodex-wasm"
XROUTER_UNPACK_DIR="${TMP_DIR}/xrouter-browser"

mkdir -p \
  "${PKG_ROOT}" \
  "${PUBLIC_PKG_ROOT}" \
  "${XROUTER_PKG_ROOT}" \
  "${PUBLIC_XROUTER_PKG_ROOT}" \
  "${XCODEX_UNPACK_DIR}" \
  "${XROUTER_UNPACK_DIR}"

echo "Downloading xcodex-wasm tarball from ${XCODEX_WASM_TARBALL_SOURCE}..."
download_if_url "${XCODEX_WASM_TARBALL_SOURCE}" "${XCODEX_TARBALL_PATH}"

echo "Extracting xcodex-wasm tarball..."
tar -xzf "${XCODEX_TARBALL_PATH}" -C "${XCODEX_UNPACK_DIR}"

XCODEX_BUNDLE_DIR="$(find_dir_with_files "${XCODEX_UNPACK_DIR}" manifest.json current)"
XCODEX_CURRENT_DIR="${XCODEX_BUNDLE_DIR}/current"

if [[ -n "${XROUTER_BROWSER_TARBALL:-}" ]]; then
  echo "Downloading xrouter-browser tarball from ${XROUTER_BROWSER_TARBALL_SOURCE}..."
  download_if_url "${XROUTER_BROWSER_TARBALL_SOURCE}" "${XROUTER_TARBALL_PATH}"

  echo "Extracting xrouter-browser tarball..."
  tar -xzf "${XROUTER_TARBALL_PATH}" -C "${XROUTER_UNPACK_DIR}"
  XROUTER_SOURCE_DIR="$(find_dir_with_files "${XROUTER_UNPACK_DIR}" xrouter_browser.js xrouter_browser_bg.wasm)"
elif [[ -f "${LOCAL_XROUTER_BROWSER_DIR}/xrouter_browser.js" && -f "${LOCAL_XROUTER_BROWSER_DIR}/xrouter_browser_bg.wasm" ]]; then
  XROUTER_SOURCE_DIR="${LOCAL_XROUTER_BROWSER_DIR}"
  echo "Using existing xrouter-browser assets from ${XROUTER_SOURCE_DIR}"
elif [[ -f "${LOCAL_XROUTER_BROWSER_PUBLIC_DIR}/xrouter_browser.js" && -f "${LOCAL_XROUTER_BROWSER_PUBLIC_DIR}/xrouter_browser_bg.wasm" ]]; then
  XROUTER_SOURCE_DIR="${LOCAL_XROUTER_BROWSER_PUBLIC_DIR}"
  echo "Using existing xrouter-browser assets from ${XROUTER_SOURCE_DIR}"
else
  echo "Downloading xrouter-browser tarball from ${XROUTER_BROWSER_TARBALL_SOURCE}..."
  download_if_url "${XROUTER_BROWSER_TARBALL_SOURCE}" "${XROUTER_TARBALL_PATH}"

  echo "Extracting xrouter-browser tarball..."
  tar -xzf "${XROUTER_TARBALL_PATH}" -C "${XROUTER_UNPACK_DIR}"
  XROUTER_SOURCE_DIR="$(find_dir_with_files "${XROUTER_UNPACK_DIR}" xrouter_browser.js xrouter_browser_bg.wasm)"
fi

if [[ ! -f "${XCODEX_BUNDLE_DIR}/manifest.json" ]]; then
  echo "xcodex-wasm tarball does not contain manifest.json" >&2
  exit 1
fi
if [[ ! -f "${XCODEX_CURRENT_DIR}/xcodex.js" || ! -f "${XCODEX_CURRENT_DIR}/xcodex_bg.wasm" ]]; then
  echo "xcodex-wasm tarball does not contain expected runtime bundle files" >&2
  exit 1
fi
if [[ ! -f "${XROUTER_SOURCE_DIR}/xrouter_browser.js" || ! -f "${XROUTER_SOURCE_DIR}/xrouter_browser_bg.wasm" ]]; then
  echo "xrouter-browser tarball does not contain expected runtime bundle files" >&2
  exit 1
fi

XCODEX_BUILD_ID="$(python3 - "${XCODEX_BUNDLE_DIR}/manifest.json" <<'PY'
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text())
print(manifest.get("buildId", ""))
PY
)"
if [[ -z "${XCODEX_BUILD_ID}" ]]; then
  XCODEX_BUILD_ID="$(date -u +%Y%m%d%H%M%S)"
fi
XROUTER_BUILD_ID="$(date -u +%Y%m%d%H%M%S)"

echo "Installing xcodex-wasm assets..."
prepare_versioned_dir "${XCODEX_CURRENT_DIR}" "${PKG_ROOT}/${XCODEX_BUILD_ID}"
prepare_versioned_dir "${XCODEX_CURRENT_DIR}" "${PUBLIC_PKG_ROOT}/${XCODEX_BUILD_ID}"
prepare_current_dir "${XCODEX_CURRENT_DIR}" "${PKG_ROOT}"
prepare_current_dir "${XCODEX_CURRENT_DIR}" "${PUBLIC_PKG_ROOT}"
write_manifest \
  "${PKG_ROOT}/manifest.json" \
  "${XCODEX_BUILD_ID}" \
  "/pkg/current/xcodex.js" \
  "/pkg/current/xcodex_bg.wasm" \
  "/pkg/current/xcodex-runtime.js"
cp "${PKG_ROOT}/manifest.json" "${PUBLIC_PKG_ROOT}/manifest.json"

echo "Installing xrouter-browser assets..."
prepare_versioned_dir "${XROUTER_SOURCE_DIR}" "${XROUTER_PKG_ROOT}/${XROUTER_BUILD_ID}"
prepare_versioned_dir "${XROUTER_SOURCE_DIR}" "${PUBLIC_XROUTER_PKG_ROOT}/${XROUTER_BUILD_ID}"
prepare_current_dir "${XROUTER_SOURCE_DIR}" "${XROUTER_PKG_ROOT}"
prepare_current_dir "${XROUTER_SOURCE_DIR}" "${PUBLIC_XROUTER_PKG_ROOT}"
write_manifest \
  "${XROUTER_PKG_ROOT}/manifest.json" \
  "${XROUTER_BUILD_ID}" \
  "/xrouter-browser/current/xrouter_browser.js" \
  "/xrouter-browser/current/xrouter_browser_bg.wasm"
cp "${XROUTER_PKG_ROOT}/manifest.json" "${PUBLIC_XROUTER_PKG_ROOT}/manifest.json"

echo "Prepared web runtime assets:"
echo "  app:              ${APP_PATH}"
echo "  runtime:          wasm"
echo "  xcodex manifest:  ${PKG_ROOT}/manifest.json"
echo "  xcodex public:    ${PUBLIC_PKG_ROOT}/current"
echo "  xrouter manifest: ${XROUTER_PKG_ROOT}/manifest.json"
echo "  xrouter public:   ${PUBLIC_XROUTER_PKG_ROOT}/current"
