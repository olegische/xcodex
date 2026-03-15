#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage:
  ./run_apsix_markdown_sections.sh zone --workspace <dir> --target <path> [--target-kind <kind>] [--profile <profile=research_web>] [--date <YYYY-MM-DD>]
  ./run_apsix_markdown_sections.sh refine --zone-id <zone_id>
  ./run_apsix_markdown_sections.sh admit --zone-id <zone_id> (--all | --partition <selector> [...])
  ./run_apsix_markdown_sections.sh spawn --zone-id <zone_id> [--partition <selector> ...] [--max-parallel <n>] [--continue-on-error] [--include-unadmitted]
  ./run_apsix_markdown_sections.sh harvest --zone-id <zone_id> [--partition <selector> ...]
  ./run_apsix_markdown_sections.sh freeze --zone-id <zone_id>
  ./run_apsix_markdown_sections.sh observe --zone-id <zone_id>
  ./run_apsix_markdown_sections.sh report --zone-id <zone_id>
  ./run_apsix_markdown_sections.sh reconcile --zone-id <zone_id>

current target kinds:
  markdown-sections
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

COMMAND="$1"
shift

case "$COMMAND" in
  zone|refine|admit|spawn|harvest|freeze|observe|report|reconcile)
    ;;
  --help|-h|help)
    usage
    exit 0
    ;;
  *)
    usage
    exit 1
    ;;
esac

exec env PYTHONUNBUFFERED=1 python3 -u .spawn/scripts/apsix_markdown_sections_runtime.py "$COMMAND" "$@"
